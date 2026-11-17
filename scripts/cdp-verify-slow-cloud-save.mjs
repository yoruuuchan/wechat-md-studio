// Production-browser acceptance: on a slow link the editor must not race its
// own cloud saves. Each docs.save request is held for SLOW_MS before it goes
// out, the writer keeps typing in bursts, and the check asserts that no
// conflict appears, that one article never has two saves on the wire, and that
// the cloud ends up with every burst. A zero-delay burst is the control.
// No production data or credentials.
// Usage: node scripts/cdp-verify-slow-cloud-save.mjs [appPort=4131] [cdpPort=9731] [outputDir]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]
const port = Number(process.argv[2] || 4131)
const cdpPort = Number(process.argv[3] || 9731)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-slow-save-'))
const output = path.resolve(process.argv[4] || path.join(temporary, 'evidence'))
fs.mkdirSync(output, { recursive: true })
const key = randomBytes(24).toString('hex')
const token = randomBytes(32).toString('hex')
const SLOW_MS = 2500
const checks = []
const exceptions = []
const consoleErrors = []
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
      AGENT_TOKENS: `slow-save-reader:${token}`, ANON_GC_ENABLED: 'false', PUBLIC_BASE_URL: origin,
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

  // docs.save bookkeeping: how many are on the wire at once, and the most ever.
  let slow = false
  const onWire = new Set()
  let saves = 0
  let maxOnWire = 0
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
      const isSave = methods.includes('docs.save')
      if (isSave) {
        saves++
        onWire.add(request.networkId)
        maxOnWire = Math.max(maxOnWire, onWire.size)
      }
      const go = () => send('Fetch.continueRequest', { requestId: request.requestId }, message.sessionId).catch((error) => consoleErrors.push(error.message))
      if (isSave && slow) setTimeout(go, SLOW_MS)
      else void go()
    }
    if ((message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') && onWire.has(message.params.requestId)) {
      onWire.delete(message.params.requestId)
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/trpc/*` }] })
  const article = { id: 'slow-save-a', name: 'Slow save', content: '# Slow save\n\nBASE', updatedAt: 1000, savedAt: null, deletedAt: null }
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}) { localStorage.setItem('mopai.onboarding.v1','done'); if(!localStorage.getItem('slow-save-fixture')) { localStorage.setItem('mopai.lang.v1','zh'); localStorage.setItem('mopai.theme.v1','akari'); localStorage.setItem('mopai.sample.v1','1'); localStorage.setItem('mopai.docs.v1',${JSON.stringify(JSON.stringify([article]))}); localStorage.setItem('mopai.active.v1',${JSON.stringify(article.id)}); localStorage.setItem('slow-save-fixture','1'); } }` })
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
  const click = async (expression) => {
    const position = await evaluate(`(() => { const el=${expression}; if(!el) return null; const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null })()`)
    if (!position) throw new Error(`No visible click target: ${expression}`)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  const ready = () => waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-save-status]')`, 'editor readiness', 20_000)
  const status = () => evaluate(`(() => { const el=document.querySelector('[data-save-status]'); return el?{id:el.dataset.saveDoc,local:el.dataset.localState,cloud:el.dataset.cloudState}:null })()`)
  const append = (text) => evaluate(`(() => { const view=window.__mopaiCodemirror; view.focus(); view.dispatch({changes:{from:view.state.doc.length,insert:${JSON.stringify(`\n\n${text}`)}}}); return true })()`)
  const api = async (method, route) => {
    const response = await fetch(origin + route, { method, headers: { authorization: `Bearer ${token}` } })
    const json = await response.json()
    if (!response.ok) throw new Error(`Agent request ${response.status}: ${JSON.stringify(json)}`)
    return json
  }
  const conflictShown = () => evaluate(`document.querySelector('[data-save-status]')?.dataset.cloudState==='conflict' || !!document.querySelector('[role=dialog]')`)
  // Poll for `ms`, remembering whether a conflict ever showed.
  let sawConflict = false
  const watch = async (ms) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (await conflictShown()) sawConflict = true
      await sleep(100)
    }
  }
  const synced = async (timeout) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (await conflictShown()) sawConflict = true
      const current = await status()
      if (current?.cloud === 'synced' && onWire.size === 0) return true
      await sleep(150)
    }
    return false
  }

  await call('Page.navigate', { url: `${origin}/login` })
  await waitFor(`!!document.querySelector('input[type=password]')`, 'login field', 20_000)
  await evaluate(`(()=>{const input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(key)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click(`document.querySelector('button[type=submit]')`)
  await ready()
  await waitFor(`document.querySelector('[data-save-status]')?.dataset.cloudState==='unarchived'`, 'unarchived article')
  await click(`document.querySelector('[data-save-draft-quick]')`)
  check('the article is archived to the cloud before the slow phase', await synced(15_000), await status())

  // Slow phase: each burst lands after the previous save has gone out but
  // before its answer, which is exactly when a second save used to race.
  slow = true
  const savesBefore = saves
  await append('BURST_ONE')
  await watch(1_400)
  await append('BURST_TWO')
  await watch(1_400)
  await append('BURST_THREE')
  const settled = await synced(25_000)
  slow = false
  const cloud = await api('GET', `/api/agent/docs/${article.id}`)
  check('slow saves settle as synced', settled, await status())
  check('no conflict is reported while only this tab writes', !sawConflict)
  check('one article never has two saves on the wire', maxOnWire <= 1, { maxOnWire })
  check('more than one save was needed, so the queue was exercised', saves - savesBefore >= 2, { saves: saves - savesBefore })
  check('the cloud holds every burst typed during slow saves', ['BURST_ONE', 'BURST_TWO', 'BURST_THREE'].every((part) => cloud.content.includes(part)), cloud.content.slice(-80))

  // Control: no delay.
  sawConflict = false
  await append('BURST_FOUR')
  check('a zero-delay save still syncs', await synced(15_000), await status())
  check('the zero-delay burst reaches the cloud without a conflict', !sawConflict && (await api('GET', `/api/agent/docs/${article.id}`)).content.includes('BURST_FOUR'))
  check('no uncaught JavaScript exceptions', exceptions.length === 0, exceptions)
} catch (error) {
  check('slow cloud save runner completes', false, error.stack || error.message)
} finally {
  ws?.close()
  await stop(chrome)
  await stop(app)
  worker.closeAllConnections()
  await new Promise((resolve) => worker.close(resolve))
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ origin, checks, exceptions, consoleErrors, appLog, temporary }, null, 2))
}
const failed = checks.filter((item) => !item.passed).length
console.log(`${checks.length - failed}/${checks.length} passed; evidence: ${output}`)
process.exitCode = failed ? 1 : 0
