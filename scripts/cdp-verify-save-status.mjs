// Production-browser acceptance for U01. No production data or credentials.
// Usage: node scripts/cdp-verify-save-status.mjs [appPort=4126] [cdpPort=9726] [outputDir]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]
const port = Number(process.argv[2] || 4126)
const cdpPort = Number(process.argv[3] || 9726)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-u01-'))
const output = path.resolve(process.argv[4] || path.join(temporary, 'evidence'))
fs.mkdirSync(output, { recursive: true })
const key = randomBytes(24).toString('hex')
const token = randomBytes(32).toString('hex')
const checks = []
const exceptions = []
const consoleErrors = []
const snapshots = []
const pausedMethods = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
}
async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
await freePort(port)
await freePort(cdpPort)
await freePort(workerPort)
let app
let chrome
let ws
let appLog = ''
const worker = http.createServer((_req, res) => res.writeHead(404).end('inert test image service'))
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
}

try {
  await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: key, SESSION_SECRET: randomBytes(32).toString('hex'),
      IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
      AGENT_TOKENS: `status-writer:${token}:write`, ANON_GC_ENABLED: 'false', PUBLIC_BASE_URL: origin,
      RESEND_API_KEY: '', RESEND_FROM: '', FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => { appLog += data })
  app.stderr.on('data', (data) => { appLog += data })
  let up = false
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(origin)).ok) { up = true; break } } catch { /* starting */ }
    if (app.exitCode !== null) throw new Error(`Application exited: ${appLog}`)
    await sleep(200)
  }
  if (!up) throw new Error(`Application did not start: ${appLog}`)
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--window-size=1600,1000',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(temporary, 'chrome')}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let endpoint
  for (let i = 0; i < 100; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl } catch { /* starting */ }
    if (endpoint) break
    await sleep(200)
  }
  if (!endpoint) throw new Error('Chrome did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let sequence = 0
  const pending = new Map()
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 25_000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  let holdCloud = false
  let failCloud = false
  let failInitialRead = false
  const held = []
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(timer)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params
      const methods = new URL(request.request.url).pathname.split('/api/trpc/')[1]?.split(',') ?? []
      pausedMethods.push(methods.join(','))
      const call = (method, params) => send(method, params, message.sessionId).catch((error) => consoleErrors.push(error.message))
      if (failInitialRead && methods.some((method) => method === 'docs.list' || method === 'docs.trash')) {
        void call('Fetch.failRequest', { requestId: request.requestId, errorReason: 'InternetDisconnected' })
      } else if (failCloud && methods.some((method) => method === 'docs.save' || method === 'docs.saveToDrafts')) {
        void call('Fetch.failRequest', { requestId: request.requestId, errorReason: 'InternetDisconnected' })
      } else if (holdCloud && methods.some((method) => method === 'docs.save' || method === 'docs.saveToDrafts')) {
        held.push({ requestId: request.requestId, sessionId: message.sessionId })
      } else void call('Fetch.continueRequest', { requestId: request.requestId })
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('DOM.enable')
  await call('CSS.enable')
  await call('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/trpc/*` }] })
  const first = { id: 'u01-local-a', name: 'U01 A', content: '# U01 A\n\nBASE_A', updatedAt: 1000, savedAt: null, deletedAt: null }
  const second = { id: 'u01-local-b', name: 'U01 B', content: '# U01 B\n\nBASE_B', updatedAt: 1000, savedAt: null, deletedAt: null }
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__u01Document=Math.random().toString(36);if(location.origin===${JSON.stringify(origin)}) { localStorage.setItem('mopai.onboarding.v1','done'); if(!localStorage.getItem('u01-fixture')) { localStorage.setItem('mopai.lang.v1','zh'); localStorage.setItem('mopai.theme.v1','akari'); localStorage.setItem('mopai.sample.v1','1'); localStorage.setItem('mopai.docs.v1',${JSON.stringify(JSON.stringify([first, second]))}); localStorage.setItem('mopai.active.v1','u01-local-a'); localStorage.setItem('u01-fixture','1'); } }` })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, timeout = 12_000) => {
    const until = Date.now() + timeout
    let result
    while (Date.now() < until) {
      result = await evaluate(expression)
      if (result) return result
      await sleep(100)
    }
    throw new Error(`${label} timed out; last=${JSON.stringify(result)}`)
  }
  const keypress = async (keyName, code = keyName, modifiers = 0) => {
    // Native button activation needs the virtual-key/text fields, not just a
    // named key event. This keeps the check closer to a real keyboard.
    const key = keyName === 'Enter'
      ? { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' }
      : keyName === 'Escape'
        ? { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
        : {}
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers, ...key })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers, ...key, text: undefined })
  }
  const click = async (expression) => {
    const position = await evaluate(`(() => { const el=${expression}; if(!el) return null; const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null })()`)
    if (!position) throw new Error(`No visible click target: ${expression}`)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  const keyboardActivate = async (expression) => {
    await evaluate(`(${expression})?.focus()`)
    await keypress('Enter')
  }
  const ready = () => waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-save-status]')`, 'editor readiness', 20_000)
  const reload = async () => {
    const previous = await evaluate('window.__u01Document')
    await call('Page.reload')
    await waitFor(`window.__u01Document!==${JSON.stringify(previous)} && !!window.__mopaiCodemirror && !!document.querySelector('[data-save-status]')`, 'fresh document after reload', 20_000)
  }
  const status = () => evaluate(`(() => { const el=document.querySelector('[data-save-status]'); return el?{id:el.dataset.saveDoc,local:el.dataset.localState,cloud:el.dataset.cloudState,text:el.innerText}:null })()`)
  const expectState = async (local, cloud, id) => {
    const label = `${local || '*'} / ${cloud || '*'} for ${id || 'current article'}`
    try {
      return await waitFor(`(() => { const el=document.querySelector('[data-save-status]'); return el&&${local ? `el.dataset.localState===${JSON.stringify(local)}` : 'true'}&&${cloud ? `el.dataset.cloudState===${JSON.stringify(cloud)}` : 'true'}&&${id ? `el.dataset.saveDoc===${JSON.stringify(id)}` : 'true'} })()`, label)
    } catch (error) {
      throw new Error(`${error.message}; current=${JSON.stringify(await status())}`)
    }
  }
  const openDetails = async () => {
    if (await evaluate(`!!document.querySelector('[data-save-details][data-state="open"]')`)) return
    await keyboardActivate(`document.querySelector('[data-save-status]')`)
    await waitFor(`!!document.querySelector('[data-save-details][data-state="open"]')`, 'keyboard-open save details')
  }
  const closeDetails = async () => {
    await keypress('Escape')
    await waitFor(`!document.querySelector('[data-save-details][data-state="open"]')`, 'save details closed')
  }
  const append = (text) => evaluate(`(() => { const view=window.__mopaiCodemirror; view.focus(); view.dispatch({changes:{from:view.state.doc.length,insert:${JSON.stringify(`\n${text}`)}}}); return true })()`)
  const rename = (name) => evaluate(`(() => { const input=document.querySelector('header input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)}); input.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
  const switchArticle = async (name, id) => {
    await closeDetails()
    await keyboardActivate(`document.querySelector('[title="切换稿件"]')`)
    await waitFor(`!!document.querySelector('[role=menu]')`, 'article switcher')
    await keyboardActivate(`[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.startsWith(${JSON.stringify(name)}))`)
    await waitFor(`document.querySelector('[data-save-status]')?.dataset.saveDoc===${JSON.stringify(id)}`, 'selected article')
  }
  const stored = (id) => evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('mopai');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const read=db.transaction('bodies','readonly').objectStore('bodies').get(${JSON.stringify(id)});read.onsuccess=()=>{resolve(read.result??null);db.close()};read.onerror=()=>{reject(read.error);db.close()}}})`)
  const screenshot = async (name) => {
    await sleep(250)
    const result = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'))
  }
  const api = async (method, route, body) => {
    const response = await fetch(origin + route, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const json = await response.json()
    if (!response.ok) throw new Error(`Agent request ${response.status}: ${JSON.stringify(json)}`)
    return json
  }
  const release = async () => {
    for (const request of held.splice(0)) await send('Fetch.continueRequest', { requestId: request.requestId }, request.sessionId)
  }

  await call('Page.navigate', { url: origin })
  await ready()
  await expectState('saved', 'signed-out', first.id)
  const initial = await stored(first.id)
  check('guest article is locally committed without claiming a cloud save', initial?.content === first.content && initial.storedAt > first.updatedAt, await status())
  await openDetails()
  check('details show the time proved by the stored record', await evaluate(`document.querySelector('[data-save-details] time')?.dateTime`) === new Date(initial.storedAt).toISOString())
  check('keyboard opens meaningful status details and a polite announcement exists', await evaluate(`document.querySelector('[data-save-details]').innerText.includes('当前标题和正文') && !!document.querySelector('[role=status][aria-live=polite]')`))
  await screenshot('local-saved-light-zh.png')
  await closeDetails()

  await evaluate(`window.__u01OriginalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...rest){if(window.__u01WriteFailure&&value.id==='u01-local-a')throw new DOMException('simulated quota','QuotaExceededError');return window.__u01OriginalPut.call(this,value,...rest)};window.__u01WriteFailure=true`)
  await append('MUST_STAY_VISIBLE_ON_FAILED_WRITE')
  await expectState('error', 'signed-out', first.id)
  check('a failed local transaction leaves a persistent banner with export and retry', await evaluate(`!!document.querySelector('[data-local-storage-banner]')&&!!document.querySelector('[data-local-export]')&&window.__mopaiCodemirror.state.doc.toString().includes('MUST_STAY_VISIBLE_ON_FAILED_WRITE')`))
  check('the polite live region announces the local failure', await waitFor(`document.querySelector('[role=status][aria-live=polite]')?.textContent.includes('本机保存异常')`, 'local failure announcement').then(() => true).catch(() => false))
  check('failed local save did not replace the durable body', !(await stored(first.id)).content.includes('MUST_STAY_VISIBLE_ON_FAILED_WRITE'))
  await openDetails()
  await screenshot('local-failure-light-zh.png')
  await evaluate(`window.__u01WriteFailure=false`)
  await keyboardActivate(`document.querySelector('[data-save-retry-local]')`)
  await expectState('saved', 'signed-out', first.id)
  const focusRestored = await waitFor(`document.activeElement?.matches('[data-save-status]')`, 'focus restored after retry', 8_000).then(() => true).catch(() => false)
  const retryBody = await stored(first.id)
  const activeAfterRetry = await evaluate(`({tag:document.activeElement?.tagName, data:document.activeElement?.dataset?.saveStatus ?? null, text:document.activeElement?.textContent?.trim().slice(0,80)})`)
  check('keyboard retry saves the held input and returns focus to the stable status trigger', retryBody.content.includes('MUST_STAY_VISIBLE_ON_FAILED_WRITE') && focusRestored, { durable: retryBody.content.includes('MUST_STAY_VISIBLE_ON_FAILED_WRITE'), focusRestored, activeAfterRetry })
  await evaluate(`IDBObjectStore.prototype.put=window.__u01OriginalPut`)

  await evaluate(`window.__u01Complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');window.__u01Delay=1800;Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...window.__u01Complete,set(callback){const delay=window.__u01Delay;window.__u01Complete.set.call(this,delay?function(event){setTimeout(()=>callback.call(this,event),delay)}:callback)}});true`)
  await append('SAVE_IN_FLIGHT')
  await expectState('saving', 'signed-out', first.id)
  await append('TYPED_AFTER_REQUEST')
  await switchArticle(second.name, second.id)
  await expectState('saved', 'signed-out', second.id)
  const secondBefore = (await stored(second.id)).storedAt
  await sleep(2100)
  check('a late save for A does not stamp B with A’s success', (await status()).id === second.id && (await stored(second.id)).storedAt === secondBefore)
  await evaluate(`window.__u01Delay=0`)
  await switchArticle(first.name, first.id)
  await expectState('saved', 'signed-out', first.id)
  check('typing queued after the first save remains visible and durable', (await stored(first.id)).content.includes('TYPED_AFTER_REQUEST') && await evaluate(`window.__mopaiCodemirror.state.doc.toString().includes('TYPED_AFTER_REQUEST')`))
  await evaluate(`Object.defineProperty(IDBTransaction.prototype,'oncomplete',window.__u01Complete);true`)

  await keyboardActivate(`document.querySelector('[title="切换稿件"]')`)
  await waitFor(`!!document.querySelector('[role=menu]')`, 'delete switcher')
  await click(`[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.startsWith('U01 A')).querySelector('button[title="删除这篇稿件"]')`)
  await keypress('Escape')
  await waitFor(`[...document.querySelectorAll('[data-sonner-toast] button')].some(button=>button.textContent==='撤销')`, 'undo action')
  await keyboardActivate(`[...document.querySelectorAll('[data-sonner-toast] button')].find(button=>button.textContent==='撤销')`)
  await expectState('saved', 'signed-out', first.id)
  await openDetails()
  check('restoring an article leaves a durable recovery entry beyond the toast', await evaluate(`document.querySelector('[data-recovery-status]')?.innerText.includes('已从回收站恢复')`) && (await stored(first.id)).metadata.recovery?.kind === 'restored')
  await closeDetails()
  await waitFor(`localStorage.getItem('mopai.active.v1')===${JSON.stringify(first.id)}`, 'restored article selection committed')
  await reload()
  await expectState('saved', 'signed-out', first.id)
  await openDetails()
  check('recovery information survives an application reload', await evaluate(`document.querySelector('[data-recovery-status]')?.innerText.includes('已从回收站恢复')`))
  await closeDetails()

  await call('Page.navigate', { url: `${origin}/login` })
  await waitFor(`!!document.querySelector('input[type=password]')`, 'login field')
  await evaluate(`(()=>{const input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(key)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click(`document.querySelector('button[type=submit]')`)
  await ready()
  await expectState('saved', 'unarchived', first.id)
  check('signed-in unarchived work is not mislabeled as synced or failed', (await status()).cloud === 'unarchived')
  holdCloud = true
  await click(`[...document.querySelectorAll('header button')].find(button=>button.textContent.trim()==='保存到草稿箱')`)
  await expectState(null, 'saving', first.id)
  for (let i = 0; i < 50 && !held.length; i++) await sleep(100)
  check('a real pending archive request is shown as cloud saving', held.length > 0)
  await append('EDIT_WHILE_CLOUD_SAVE_PENDING')
  await expectState('saved', 'saving', first.id)
  await release()
  await sleep(350)
  check('an older cloud acknowledgement does not mark newer input synced', (await status()).cloud !== 'synced', await status())
  for (let i = 0; i < 50 && !held.length; i++) await sleep(100)
  await switchArticle(second.name, second.id)
  await expectState('saved', 'unarchived', second.id)
  holdCloud = false
  await release()
  await sleep(400)
  check('the previous article’s cloud success does not change the unarchived article status', (await status()).cloud === 'unarchived' && (await status()).id === second.id)
  await switchArticle(first.name, first.id)
  await expectState('saved', 'synced', first.id)
  check('the newest title and text are confirmed by the cloud', (await api('GET', `/api/agent/docs/${first.id}`)).content.includes('EDIT_WHILE_CLOUD_SAVE_PENDING'))

  await rename('U01 A renamed')
  await expectState(null, 'pending', first.id)
  await expectState('saved', 'synced', first.id)
  check('a name-only edit gets its own local and cloud save proof', (await stored(first.id)).metadata.name === 'U01 A renamed' && (await api('GET', `/api/agent/docs/${first.id}`)).name === 'U01 A renamed')

  // Fail only cloud writes. Freezing the whole browser's network also blocks
  // the Runtime domain, which hides the status that this check needs to read.
  failCloud = true
  await append('OFFLINE_TEXT')
  await expectState('saved', 'error', first.id)
  check('offline cloud failure does not turn a successful local save into a failure', (await stored(first.id)).content.includes('OFFLINE_TEXT'), await status())
  await openDetails()
  check('offline details keep export and cloud retry actions available', await evaluate(`!!document.querySelector('[data-save-retry-cloud]')&&!!document.querySelector('[data-save-export]')`))
  await screenshot('offline-local-safe.png')
  await keyboardActivate(`document.querySelector('[data-save-retry-cloud]')`)
  await expectState('saved', 'error', first.id)
  const cloudFocusRestored = await waitFor(`document.activeElement?.matches('[data-save-status]')`, 'focus restored after cloud retry', 5_000).then(() => true).catch(() => false)
  check('cloud keyboard retry returns focus to its stable trigger', cloudFocusRestored)
  failCloud = false
  holdCloud = false
  await release()
  await openDetails()
  await keyboardActivate(`document.querySelector('[data-save-retry-cloud]')`)
  await expectState('saved', 'synced', first.id)

  failInitialRead = true
  await reload()
  await expectState('saved', 'error', first.id)
  await openDetails()
  check('a failed initial cloud list is an actionable error, not endless loading', await evaluate(`!!document.querySelector('[data-save-retry-cloud]')`), await status())
  failInitialRead = false
  await keyboardActivate(`document.querySelector('[data-save-retry-cloud]')`)
  await expectState('saved', 'synced', first.id)
  check('retry after initial cloud loading failure actually reconciles and recovers', (await status()).cloud === 'synced')

  const remote = await api('GET', `/api/agent/docs/${first.id}`)
  await api('PUT', `/api/agent/docs/${first.id}`, { name: 'U01 remote rename', content: remote.content, baseHash: remote.hash })
  await rename('U01 my conflicting rename')
  await expectState('saved', 'conflict', first.id)
  await waitFor(`!!document.querySelector('[role=dialog]')`, 'name conflict dialog')
  check('a concurrent rename remains a visible cloud conflict with a safe local copy', (await stored(first.id)).metadata.name === 'U01 my conflicting rename' && (await api('GET', `/api/agent/docs/${first.id}`)).name === 'U01 remote rename')
  await keypress('Escape')
  await openDetails()
  await keyboardActivate(`document.querySelector('[data-save-review-conflict]')`)
  await waitFor(`!!document.querySelector('[role=dialog]')`, 'review conflict action')
  await keyboardActivate(`[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent.includes('两边都留'))`)
  await waitFor(`!document.querySelector('[role=dialog]')`, 'conflict resolution', 8_000)
  const copies = await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('mopai');request.onsuccess=()=>{const db=request.result;const read=db.transaction('bodies','readonly').objectStore('bodies').getAll();read.onsuccess=()=>{resolve(read.result.filter(row=>row.metadata?.recovery?.kind==='conflict'));db.close()};read.onerror=()=>reject(read.error)};request.onerror=()=>reject(request.error)})`)
  check('keeping both versions persists a named recovery copy', copies.length > 0)
  if (copies[0]) {
    await switchArticle(copies[0].metadata.name, copies[0].id)
    await expectState('saved', 'synced', copies[0].id)
    await openDetails()
    check('the saved conflict copy has persistent recovery details', await evaluate(`document.querySelector('[data-recovery-status]')?.innerText.includes('已保留冲突副本')`))
    await screenshot('conflict-recovery.png')
    await closeDetails()
  }

  await click(`document.querySelector('button[data-lang="en"]')`)
  await waitFor(`document.documentElement.lang==='en'`, 'English language')
  await openDetails()
  check('English save details contain translated states and actions', await evaluate(`document.querySelector('[data-save-details]').innerText.includes('Saved locally')&&document.querySelector('[data-save-details]').innerText.includes('Export backup')`))
  await screenshot('save-details-light-en.png')
  await closeDetails()
  await click(`document.querySelector('button[title="Dark"]')`)
  await waitFor(`document.documentElement.dataset.theme==='yoru'`, 'dark theme')
  await openDetails()
  check('save details remain legible in dark mode', await evaluate(`document.documentElement.classList.contains('dark')&&getComputedStyle(document.querySelector('[data-save-details]')).color!==getComputedStyle(document.querySelector('[data-save-details]')).backgroundColor`))
  await screenshot('save-details-dark-en.png')
  await closeDetails()
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await openDetails()
  const bounds = await evaluate(`(()=>{const r=document.querySelector('[data-save-details]').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()`)
  check('status details stay within a narrow viewport', bounds.left >= 0 && bounds.right <= bounds.width + 1, bounds)
  await screenshot('save-details-narrow.png')
  await closeDetails()
  await call('Emulation.clearDeviceMetricsOverride')
  snapshots.push(await status())
  check('no uncaught JavaScript exceptions during the tested flows', exceptions.length === 0, exceptions)
} catch (error) {
  try { snapshots.push(await status()) } catch { /* page unavailable */ }
  check('save-status acceptance runner completes', false, error.stack || error.message)
} finally {
  ws?.close()
  await stop(chrome)
  await stop(app)
  worker.closeAllConnections()
  await new Promise((resolve) => worker.close(resolve))
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ origin, checks, exceptions, consoleErrors, snapshots, pausedMethods, appLog, temporary }, null, 2))
}
const failed = checks.filter((item) => !item.passed).length
console.log(`${checks.length - failed}/${checks.length} passed; evidence: ${output}`)
process.exitCode = failed ? 1 : 0
