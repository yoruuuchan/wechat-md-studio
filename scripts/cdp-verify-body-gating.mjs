// Production-browser acceptance for unreadable article bodies (stub gating).
//
// Cloud-only articles are metadata placeholders: `contentLoaded:false`,
// `bodyState:'stub'`, `content:''`. The editor used to open an empty CodeMirror
// for them, so an empty article could be edited, copied or exported before the
// real body arrived. This suite proves the new gating end to end, against a real
// production build, a real Chrome and a private database:
//
//   1. a delayed `docs.get` shows a loading state, no editable area, every
//      sink-reading action disabled, and nothing reaches the clipboard, a file
//      or a success toast; releasing the request loads the body and editing works;
//   2. a failing `docs.get` shows load-failed with a 重试 button, keeps the sinks
//      empty, and loads the body once the fault is cleared;
//   3. a cloud stub kept after signing out is unavailable (reason mentions
//      登录), with no editable area and no working sinks;
//   4. after the body loads, typing, copy (rich + plain, containing the new
//      text) and the Markdown / clean-HTML exports all carry the article, and
//      switching articles clears the copy receipt;
//   5. the publish check opened on a readable article and raced by an article
//      switch is re-checked at execution time: no clipboard write, no download,
//      an error toast and no success toast;
//   6. no empty body is ever written to IndexedDB for a blocked article.
//
// Usage: node scripts/cdp-verify-body-gating.mjs [appPort=4134] [cdpPort=9734] [outputDir=verify-out/body-gating]
// The suite starts its own app (dist/boot.js), its own mock image host on
// appPort + 100, a temporary database + Chrome profile, and a headless Chrome.
// It needs `npm run build` first and never touches production data.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]

const port = Number(process.argv[2] || 4134)
const cdpPort = Number(process.argv[3] || 9734)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-body-gating-'))
const output = path.resolve(process.argv[4] || 'verify-out/body-gating')
fs.mkdirSync(output, { recursive: true })
const accessKey = 'body-gating-owner-key-20261114'
const agentToken = 'mopai_body_gating_agent_token_20261114'
const adminKey = 'body-gating-image-admin-key-9f2c'
const sessionSecret = randomBytes(32).toString('hex')
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const logPath = path.join(output, 'body-gating.log')
const jsonPath = path.join(output, 'body-gating.json')

const checks = []
const exceptions = []
const consoleErrors = []
const logLines = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (line) => {
  logLines.push(line)
  console.log(line)
}
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
  log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
}
const section = (title) => log(`\n=== ${title} ===`)

// ---------- the cloud fixtures, seeded through the agent door ----------
// Names are asserted on; the markers make "the body really arrived" provable.
const CLOUD_DOCS = [
  { name: 'U03 可读占位稿', content: '---\ntitles:\n  - U03 可读占位稿\n---\n\n# U03 可读占位稿\n\n![封面]()\n\n正文在这里。\n' },
  { name: 'U03 延迟稿', content: '---\ntitles:\n  - U03 延迟稿\n---\n\n# U03 延迟稿\n\nDELAYED_BODY_MARK\n\n这篇的正文会在请求放行后出现。\n' },
  { name: 'U03 失败稿', content: '---\ntitles:\n  - U03 失败稿\n---\n\n# U03 失败稿\n\nFAILED_BODY_MARK\n\n这篇的正文第一次读不下来。\n' },
  { name: 'U03 保留稿', content: '---\ntitles:\n  - U03 保留稿\n---\n\n# U03 保留稿\n\nRETAINED_STUB_BODY\n' },
  { name: 'U03 竞态稿', content: '---\ntitles:\n  - U03 竞态稿\n---\n\n# U03 竞态稿\n\nRACE_STUB_BODY\n' },
  { name: 'U03 竞态二稿', content: '---\ntitles:\n  - U03 竞态二稿\n---\n\n# U03 竞态二稿\n\nRACE_TWO_STUB_BODY\n' },
  { name: 'U03 备份稿', content: '---\ntitles:\n  - U03 备份稿\n---\n\n# U03 备份稿\n\nBACKUP_STUB_BODY\n' },
]
const ids = {}
for (const doc of CLOUD_DOCS) ids[doc.name] = null

async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
for (const value of [port, cdpPort, workerPort]) await freePort(value)

// ---------- inert mock image host (production boot wants the image envs) ----------
const worker = http.createServer((_req, res) => {
  res.writeHead(404).end('no route')
})

let app
let chrome
let ws
let appLog = ''
async function stop(child) {
  if (!child || child.exitCode !== null || typeof child.kill !== 'function') return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
}

if (!fs.existsSync('dist/boot.js')) {
  log('dist/boot.js is missing; run `npm run build` first.')
  fs.writeFileSync(logPath, logLines.join('\n'))
  process.exit(1)
}
// Record which build the evidence covers: the served bundle's timestamp and the
// commit the worktree sits on.
const build = {
  distBootMtime: fs.statSync('dist/boot.js').mtime.toISOString(),
  distPublicMtime: fs.existsSync('dist/public/index.html') ? fs.statSync('dist/public/index.html').mtime.toISOString() : null,
  head: (() => {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return null }
  })(),
}
log(`build: ${JSON.stringify(build)}`)
if (!fs.existsSync(chromePath)) {
  log(`Chrome not found at ${chromePath}`)
  fs.writeFileSync(logPath, logLines.join('\n'))
  process.exit(1)
}

// CDP state driven from Node: the Fetch interception holds or fails docs.get.
let holdGet = false
let failGet = false
const held = []
// Filled in once the page helpers exist, so a throw can still leave evidence.
let snapshotFn = null
let screenshotFn = null

try {
  await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
  fs.mkdirSync(path.dirname(path.join(temporary, 'app.db')), { recursive: true })
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: accessKey,
      SESSION_SECRET: sessionSecret,
      AGENT_TOKENS: `body-gating:${agentToken}`,
      IMG_BASE_URL: `http://127.0.0.1:${workerPort}`,
      IMG_ADMIN_KEY: adminKey,
      ANON_GC_ENABLED: 'false',
      PUBLIC_BASE_URL: origin,
      RESEND_API_KEY: '',
      RESEND_FROM: '',
      FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => { appLog += data })
  app.stderr.on('data', (data) => { appLog += data })
  let up = false
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin)).ok) { up = true; break } } catch { /* starting */ }
    if (app.exitCode !== null) throw new Error(`Application exited: ${appLog.slice(-800)}`)
    await sleep(200)
  }
  if (!up) throw new Error(`Application did not start: ${appLog.slice(-800)}`)

  // ---------- cloud fixtures through the agent door ----------
  const api = async (method, route, body) => {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: { authorization: `Bearer ${agentToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await response.json()
    if (!response.ok) throw new Error(`Agent request ${method} ${route} -> ${response.status}: ${JSON.stringify(json)}`)
    return json
  }
  for (const doc of CLOUD_DOCS) {
    const created = await api('POST', '/api/agent/docs', { name: doc.name, content: doc.content })
    ids[doc.name] = created.id
  }
  const seeded = CLOUD_DOCS.every((doc) => typeof ids[doc.name] === 'string' && ids[doc.name].length > 0)
  check('the cloud fixtures were seeded through the agent API', seeded, ids)

  // ---------- headless Chrome + CDP ----------
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--window-size=1600,1000', `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${path.join(temporary, 'chrome')}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let endpoint
  for (let i = 0; i < 120; i++) {
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 40_000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
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
      const resume = (method, params) => send(method, params, message.sessionId).catch((error) => consoleErrors.push(error.message))
      if (methods.includes('docs.get') && failGet) {
        void resume('Fetch.failRequest', { requestId: request.requestId, errorReason: 'InternetDisconnected' })
      } else if (methods.includes('docs.get') && holdGet) {
        held.push({ requestId: request.requestId, sessionId: message.sessionId })
      } else {
        void resume('Fetch.continueRequest', { requestId: request.requestId })
      }
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('DOM.enable')
  await call('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/trpc/*` }] })
  // A returning visitor: no first-run tour, Chinese UI, the shipped light theme.
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `if (location.origin === ${JSON.stringify(origin)}) {
      try {
        localStorage.setItem('mopai.onboarding.v1', 'done')
        localStorage.setItem('mopai.lang.v1', 'zh')
        localStorage.setItem('mopai.theme.v1', 'akari')
      } catch {}
    }`,
  })

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, timeout = 15_000, interval = 120) => {
    const until = Date.now() + timeout
    let last
    while (Date.now() < until) {
      try { last = await evaluate(expression) } catch (error) { last = `evaluate failed: ${error.message}` }
      if (last) return last
      await sleep(interval)
    }
    throw new Error(`${label} timed out after ${timeout}ms (last=${JSON.stringify(last)})`)
  }
  const waitNode = async (label, predicate, timeout = 10_000, interval = 100) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (predicate()) return true
      await sleep(interval)
    }
    throw new Error(`${label} timed out after ${timeout}ms`)
  }
  const press = async (key, code, vk, text) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  }
  const screenshot = async (name) => {
    await sleep(250)
    const result = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'))
  }
  const releaseHeld = async () => {
    for (const request of held.splice(0)) {
      await send('Fetch.continueRequest', { requestId: request.requestId }, request.sessionId).catch(() => {})
    }
  }
  const activeId = () => evaluate(`localStorage.getItem('mopai.active.v1')`)

  // Everything the assertions need on one place, also saved for a failure.
  const snapshot = () => evaluate(`(() => {
    const q = (selector) => document.querySelector(selector)
    const wrapper = q('[data-body-state]')
    const copy = q('button[data-onboarding=copy]')
    const name = q('[data-doc-name]')
    const topbar = q('[data-topbar]')
    return {
      path: location.pathname + location.search,
      active: localStorage.getItem('mopai.active.v1'),
      bodyState: wrapper ? wrapper.getAttribute('data-body-state') : null,
      bodyLoading: Boolean(q('[data-body-loading]')),
      bodyReason: q('[data-body-state-reason]') ? q('[data-body-state-reason]').innerText : null,
      retry: q('[data-body-retry]') ? q('[data-body-retry]').getAttribute('data-body-retry') : null,
      retryLabel: q('[data-body-retry]') ? q('[data-body-retry]').innerText.trim() : null,
      topbarReadable: topbar ? topbar.getAttribute('data-content-readable') : null,
      cmContent: Boolean(q('.cm-content')),
      editorText: window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString().slice(0, 200) : null,
      copy: copy ? { disabled: copy.disabled === true, blocked: copy.getAttribute('data-copy-blocked'), title: copy.title } : null,
      rename: name ? { disabled: name.disabled === true, title: name.title } : null,
      preflight: Boolean(q('[data-preflight]')),
      toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => ({ type: t.getAttribute('data-type'), text: t.innerText })),
      copies: window.__copies ? window.__copies.length : null,
      downloads: window.__downloads ? window.__downloads.map((d) => d.name) : null,
    }
  })()`)
  snapshotFn = snapshot
  screenshotFn = screenshot

  // ---------- clipboard and download sinks: prove what actually left the app ----------
  const installSinks = () => evaluate(`(() => {
    window.__copies = []
    window.__downloads = []
    const origWrite = navigator.clipboard.write.bind(navigator.clipboard)
    navigator.clipboard.write = async (items) => {
      const rec = { via: 'ClipboardItem' }
      for (const it of items) {
        if (it.types.includes('text/html')) rec.html = await (await it.getType('text/html')).text()
        if (it.types.includes('text/plain')) rec.plain = await (await it.getType('text/plain')).text()
      }
      try { await origWrite(items); rec.ok = true } catch (e) { rec.ok = String(e).slice(0, 80) }
      window.__copies.push(rec)
    }
    const origExec = document.execCommand.bind(document)
    document.execCommand = (cmd, ...rest) => {
      const result = origExec(cmd, ...rest)
      if (cmd === 'copy') window.__copies.push({ via: 'execCommand', ok: result })
      return result
    }
    const origCreate = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => { window.__lastBlob = blob; return origCreate(blob) }
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return
      const entry = { name: this.download }
      window.__downloads.push(entry)
      if (window.__lastBlob) window.__lastBlob.text().then((text) => { entry.text = text })
    }
    return true
  })()`)
  const resetSinks = () => evaluate(`(() => { window.__copies = []; window.__downloads = []; window.__lastBlob = null; return true })()`)
  const copies = () => evaluate(`window.__copies ? window.__copies.slice() : []`)
  const downloads = () => evaluate(`window.__downloads ? window.__downloads.slice() : []`)
  const toastText = () => evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join('\\n')`)
  const hasSuccessToast = (text) => /已复制|已导出|导出成功|复制成功/.test(String(text ?? ''))
  /**
   * Toasts are shared by every action in the page. Before judging what one
   * action said, let earlier messages expire so a passing export cannot be read
   * as this action's success.
   */
  const waitForToastsGone = async (label, timeout = 12_000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if ((await evaluate(`document.querySelectorAll('[data-sonner-toast]').length`)) === 0) return
      await sleep(200)
    }
    throw new Error(`toasts from before ${label} did not clear in ${timeout}ms: ${await toastText()}`)
  }

  // ---------- editor / document helpers ----------
  const slotText = () => evaluate(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : null`)
  const appendEditor = (text) => evaluate(`(() => {
    const view = window.__mopaiCodemirror
    if (!view) return 'no editor'
    view.focus()
    view.dispatch({ changes: { from: view.state.doc.length, insert: ${JSON.stringify(text)} } })
    return 'ok'
  })()`)
  const indexDocs = () => evaluate(`(() => {
    try { return JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}').docs } catch { return null }
  })()`)
  const indexEntry = async (id) => {
    const docs = await indexDocs()
    return (docs ?? []).find((doc) => doc.id === id) ?? null
  }
  const bodyInDb = (id) => evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('mopai')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('bodies', 'readonly').objectStore('bodies').get(${JSON.stringify(id)})
      read.onsuccess = () => { resolve(read.result ? read.result.content : null); db.close() }
      read.onerror = () => { reject(read.error); db.close() }
    }
  })`)
  const idbBodies = () => evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('mopai')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('bodies', 'readonly').objectStore('bodies').getAll()
      read.onsuccess = () => { resolve(read.result.map((row) => ({ id: row.id, content: row.content }))); db.close() }
      read.onerror = () => { reject(read.error); db.close() }
    }
  })`)

  // ---------- menu helpers (Radix needs pointer events, not just .click()) ----------
  const isMenuOpen = () => evaluate(`Boolean(document.querySelector('[role="menu"]'))`)
  const pointerToggle = (elementExpression) => evaluate(`(() => {
    const el = ${elementExpression}
    if (!el) return 'missing'
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    el.click()
    return 'ok'
  })()`)
  const openSwitcher = async () => {
    if (await isMenuOpen()) return
    const opened = await pointerToggle(`document.querySelector('[data-doc-name-group] button')`)
    if (opened !== 'ok') throw new Error(`no article switcher trigger: ${opened}`)
    await waitFor(`Boolean(document.querySelector('[role="menu"]'))`, 'article switcher menu', 8_000)
  }
  const openSwitcherWhileCheck = async () => {
    const opened = await evaluate(`(() => {
      const root = document.getElementById('root')
      if (!root) return 'no root'
      // The switcher trigger lives outside the modal dialog. A pointerdown there
      // would normally make Radix dismiss the dialog, so the event is stopped
      // after React's root listener has handled it: the menu opens and the
      // publish check stays up, which is exactly the race being tested.
      if (!window.__rootSwallowPointerDown) {
        window.__rootSwallowPointerDown = (event) => {
          if (window.__swallowNextPointerDown) event.stopPropagation()
        }
        root.addEventListener('pointerdown', window.__rootSwallowPointerDown)
      }
      const trigger = document.querySelector('[data-doc-name-group] button')
      if (!trigger) return 'missing trigger'
      window.__swallowNextPointerDown = true
      try {
        trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
        trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }))
      } finally {
        window.__swallowNextPointerDown = false
      }
      return 'ok'
    })()`)
    if (opened !== 'ok') throw new Error(`could not open the switcher over the check: ${opened}`)
    try {
      await waitFor(`Boolean(document.querySelector('[role="menu"]'))`, 'switcher over the publish check', 4_000)
    } catch {
      // Radix may need a click on top of the pointerdown in this state.
      await evaluate(`document.querySelector('[data-doc-name-group] button')?.click()`)
      await waitFor(`Boolean(document.querySelector('[role="menu"]'))`, 'switcher over the publish check (click)', 8_000)
    }
  }
  const clickMenuItem = (text) => evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes(${JSON.stringify(text)}))
    if (!item) return 'missing'
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    item.click()
    return 'ok'
  })()`)
  const switchDoc = async (name, { whileCheck = false } = {}) => {
    const id = ids[name]
    if (whileCheck) await openSwitcherWhileCheck()
    else await openSwitcher()
    const picked = await clickMenuItem(name)
    if (picked !== 'ok') throw new Error(`the switcher has no item for ${name}: ${picked}`)
    await waitFor(`localStorage.getItem('mopai.active.v1') === ${JSON.stringify(id)}`, `switch to ${name}`, 10_000)
    await sleep(300)
  }
  const closeMenu = async () => {
    if (!(await isMenuOpen())) return
    await press('Escape', 'Escape', 27)
    await sleep(200)
    if (await isMenuOpen()) {
      await press('Escape', 'Escape', 27)
      await sleep(200)
    }
  }
  const openMore = async () => {
    if (await isMenuOpen()) await closeMenu()
    const opened = await pointerToggle(`document.querySelector('[data-topbar-more]')`)
    if (opened !== 'ok') throw new Error(`no 更多 trigger: ${opened}`)
    await waitFor(`Boolean(document.querySelector('[data-export="markdown"]'))`, '更多 menu', 8_000)
  }
  const clickExport = (kind) => evaluate(`(() => {
    const item = document.querySelector('[data-export=' + JSON.stringify(${JSON.stringify(kind)}) + ']')
    if (!item) return 'missing'
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    item.click()
    return 'ok'
  })()`)
  const clickMoreItem = (item) => evaluate(`(() => {
    const entry = document.querySelector('[data-more-item=' + JSON.stringify(${JSON.stringify(item)}) + ']')
    if (!entry) return 'missing'
    entry.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    entry.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
    entry.click()
    return 'ok'
  })()`)

  // ---------- the gating contract, read the way the author would meet it ----------
  const readExportItems = () => evaluate(`[...document.querySelectorAll('[data-export]')].map((el) => ({
    kind: el.getAttribute('data-export'),
    disabled: el.disabled === true || el.getAttribute('disabled') === 'true' || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled'),
    blocked: el.getAttribute('data-export-blocked'),
    title: el.title,
  }))`)
  const gateDetail = async () => {
    const base = await evaluate(`(() => {
      const copy = document.querySelector('button[data-onboarding=copy]')
      const name = document.querySelector('[data-doc-name]')
      const topbar = document.querySelector('[data-topbar]')
      return {
        topbarReadable: topbar ? topbar.getAttribute('data-content-readable') : null,
        copyDisabled: copy ? copy.disabled === true : null,
        copyBlocked: copy ? copy.getAttribute('data-copy-blocked') : null,
        copyTitle: copy ? copy.title : null,
        renameDisabled: name ? name.disabled === true : null,
        renameTitle: name ? name.title : null,
      }
    })()`)
    await openMore()
    const exports = await readExportItems()
    await closeMenu()
    return { ...base, exports }
  }
  const titleCarries = (title, fragment) => {
    if (typeof title !== 'string' || title.trim().length === 0) return false
    if (!fragment) return true
    return title.includes(fragment)
  }
  const gatePasses = (gate, fragment) => {
    const exportItem = (kind) => gate.exports.find((item) => item.kind === kind) ?? null
    const sinkItems = ['markdown', 'clean', 'page'].map(exportItem)
    const bundle = exportItem('bundle')
    return gate.topbarReadable === 'false'
      && gate.copyDisabled === true
      && gate.copyBlocked === 'true'
      && titleCarries(gate.copyTitle, fragment)
      && gate.renameDisabled === true
      && titleCarries(gate.renameTitle, fragment)
      && sinkItems.every((item) => item && item.disabled === true && item.blocked === 'true' && titleCarries(item.title, fragment))
      && Boolean(bundle) && bundle.disabled === false && bundle.blocked === null
  }
  const gateSummary = (gate) => ({
    topbarReadable: gate.topbarReadable,
    copy: `${gate.copyDisabled}/${gate.copyBlocked}/title=${String(gate.copyTitle).slice(0, 40)}`,
    rename: `${gate.renameDisabled}/title=${String(gate.renameTitle).slice(0, 40)}`,
    exports: gate.exports.map((item) => `${item.kind}:${item.disabled}/${item.blocked}/${String(item.title).slice(0, 24)}`),
  })
  const attemptBlockedActions = async () => {
    await resetSinks()
    await evaluate(`(() => {
      const copy = document.querySelector('button[data-onboarding=copy]')
      if (!copy) return false
      copy.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      copy.click()
      return true
    })()`)
    await openMore()
    for (const kind of ['markdown', 'clean', 'page']) await clickExport(kind)
    await sleep(300)
    await closeMenu()
    await sleep(400)
  }

  // ---------- publish check helpers ----------
  const preflightInfo = () => evaluate(`(() => {
    const root = document.querySelector('[data-preflight]')
    if (!root) return null
    const go = root.querySelector('[data-preflight-go]')
    return {
      items: [...root.querySelectorAll('[data-preflight-item]')].map((el) => el.getAttribute('data-preflight-item')),
      state: go ? go.getAttribute('data-preflight-state') : null,
      goDisabled: go ? Boolean(go.disabled) : null,
      goLabel: go ? go.innerText.trim() : null,
      hasAck: Boolean(root.querySelector('[data-preflight-ack]')),
      text: root.innerText,
    }
  })()`)
  const waitForCheck = async (label, timeout = 15_000) => {
    const until = Date.now() + timeout
    let last = null
    while (Date.now() < until) {
      last = await preflightInfo()
      if (last) return last
      await sleep(150)
    }
    throw new Error(`${label}: no publish check appeared (last=${JSON.stringify(last)})`)
  }
  const ackCheck = () => evaluate(`(() => { const box = document.querySelector('[data-preflight-ack]'); if (!box) return 'missing'; box.click(); return 'clicked' })()`)
  const confirmCheck = () => evaluate(`(() => {
    const button = document.querySelector('[data-preflight-go]')
    if (!button) return 'missing'
    if (button.disabled) return 'disabled'
    button.click()
    return 'clicked'
  })()`)

  // ---------- sign in through the real /login form ----------
  const signIn = async () => {
    await call('Page.navigate', { url: `${origin}/login` })
    await waitFor(`Boolean(document.querySelector('input[type=password]'))`, 'the login form', 25_000)
    await evaluate(`(async () => {
      const input = document.querySelector('input[type=password]')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, ${JSON.stringify(accessKey)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 120))
      document.querySelector('button[type=submit]').click()
      return true
    })()`)
    await waitFor(`location.pathname === '/'`, 'the editor route after login', 30_000)
    await waitFor(`Boolean(document.querySelector('[data-topbar]'))`, 'the editor after login', 25_000)
    await waitFor(`(() => {
      try {
        const docs = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}').docs || []
        return docs.filter((doc) => doc.contentLoaded === false && doc.bodyState === 'stub').length >= ${CLOUD_DOCS.length}
      } catch { return false }
    })()`, 'the login merge creating cloud stubs', 30_000)
    await sleep(400)
  }

  // =====================================================================
  // 0. signed in: the merge created every cloud-only article as a stub
  // =====================================================================
  section('front: signing in to an account that already has articles')
  await signIn()
  await installSinks()
  const mergedDocs = await indexDocs()
  const stubEntries = (mergedDocs ?? []).filter((doc) => doc.contentLoaded === false && doc.bodyState === 'stub')
  check('the login merge created a stub for every cloud-only article', stubEntries.length >= CLOUD_DOCS.length, {
    stubs: stubEntries.map((doc) => doc.name),
    seeded: CLOUD_DOCS.map((doc) => doc.name),
  })
  const front = await snapshot()
  check('the editor opened on a readable local article, not a stub', front.topbarReadable === 'true' && front.cmContent === true, front)

  // =====================================================================
  // 1. docs.get delayed: the body is still arriving
  // =====================================================================
  section('1. a cloud article whose body is still arriving')
  holdGet = true
  await switchDoc('U03 延迟稿')
  await waitFor(`Boolean(document.querySelector('[data-body-state="loading"]'))`, 'the loading state', 15_000)
  await waitNode('the docs.get request is really held', () => held.length > 0, 10_000)
  const loadingNow = await snapshot()
  check('a delayed body shows the loading state', loadingNow.bodyState === 'loading', loadingNow)
  check('the loading state carries the loading marker and no reason or retry', loadingNow.bodyLoading === true && loadingNow.bodyReason === null && loadingNow.retry === null, {
    loading: loadingNow.bodyLoading,
    reason: loadingNow.bodyReason,
    retry: loadingNow.retry,
  })
  check('no editable area is mounted while the body loads', loadingNow.cmContent === false && loadingNow.editorText === null, {
    cmContent: loadingNow.cmContent,
    editorText: loadingNow.editorText,
  })
  const loadingGate = await gateDetail()
  check('the top bar marks the article as not readable', loadingGate.topbarReadable === 'false', loadingGate.topbarReadable)
  check('copy is disabled and carries the reason', loadingGate.copyDisabled === true && loadingGate.copyBlocked === 'true' && titleCarries(loadingGate.copyTitle, '加载'), gateSummary(loadingGate))
  check('rename is disabled and carries the reason', loadingGate.renameDisabled === true && titleCarries(loadingGate.renameTitle, '加载'), gateSummary(loadingGate))
  check('Markdown and HTML exports are disabled with the reason while the whole-library backup stays usable', gatePasses(loadingGate, '加载'), gateSummary(loadingGate))
  await attemptBlockedActions()
  const loadingSinks = { copies: await copies(), downloads: await downloads() }
  check('blocked copy and export attempts write nothing to the clipboard or the download folder', loadingSinks.copies.length === 0 && loadingSinks.downloads.length === 0, loadingSinks)
  check('no success toast appears while the article is blocked', !hasSuccessToast(await toastText()), await toastText())
  check('the blocked stub has no body row in IndexedDB yet', (await bodyInDb(ids['U03 延迟稿'])) === null, await indexEntry(ids['U03 延迟稿']))
  await screenshot('01-loading.png')

  await releaseHeld()
  holdGet = false
  await waitFor(`!document.querySelector('[data-body-state]') && Boolean(window.__mopaiCodemirror) && window.__mopaiCodemirror.state.doc.toString().includes('DELAYED_BODY_MARK')`, 'the released body', 25_000)
  const released = await snapshot()
  check('releasing the request loads the body into the editor', released.bodyState === null && released.cmContent === true && String(released.editorText).includes('DELAYED_BODY_MARK'), released.editorText)
  check('the top bar and copy become usable again automatically', released.topbarReadable === 'true' && released.copy.disabled === false && released.copy.blocked === null, released.copy)
  check('editing works after the body arrives', (await appendEditor('\n\nEDITED_AFTER_LOAD_MARK')) === 'ok')
  await sleep(1300)
  check('the edit is committed to local storage', String((await bodyInDb(ids['U03 延迟稿'])) ?? '').includes('EDITED_AFTER_LOAD_MARK'), String((await bodyInDb(ids['U03 延迟稿'])) ?? '').slice(-60))
  await screenshot('03-loaded.png')

  // =====================================================================
  // 2. docs.get failing: load-failed with a retry
  // =====================================================================
  section('2. a cloud article whose body read fails')
  failGet = true
  await switchDoc('U03 失败稿')
  await waitFor(`Boolean(document.querySelector('[data-body-state="load-failed"]'))`, 'the load-failed state', 20_000)
  const failedNow = await snapshot()
  check('a failed body fetch shows the load-failed state', failedNow.bodyState === 'load-failed', failedNow)
  check('the reason is the existing hydrate-failure text', String(failedNow.bodyReason).includes('没读下来'), failedNow.bodyReason)
  check('the retry button is offered, labelled 重试, and asks for the cloud copy', failedNow.retry === 'cloud' && failedNow.retryLabel === '重试', {
    retry: failedNow.retry,
    label: failedNow.retryLabel,
  })
  check('no editable area is mounted after the failed fetch', failedNow.cmContent === false && failedNow.editorText === null, {
    cmContent: failedNow.cmContent,
    editorText: failedNow.editorText,
  })
  const failedGate = await gateDetail()
  check('every sink-reading control is blocked with the load-failure reason', gatePasses(failedGate, '没读下来'), gateSummary(failedGate))
  await attemptBlockedActions()
  const failedSinks = { copies: await copies(), downloads: await downloads() }
  check('blocked actions stay empty after the failed fetch', failedSinks.copies.length === 0 && failedSinks.downloads.length === 0, failedSinks)
  check('no success toast appears after the failed fetch', !hasSuccessToast(await toastText()), await toastText())
  check('the failed stub has no body row in IndexedDB', (await bodyInDb(ids['U03 失败稿'])) === null)
  await screenshot('02-load-failed.png')

  failGet = false
  const retried = await evaluate(`(() => {
    const button = document.querySelector('[data-body-retry="cloud"]')
    if (!button) return 'missing'
    if (button.disabled) return 'disabled'
    button.click()
    return 'clicked'
  })()`)
  check('the retry button is clickable', retried === 'clicked', retried)
  await waitFor(`!document.querySelector('[data-body-state]') && Boolean(window.__mopaiCodemirror) && window.__mopaiCodemirror.state.doc.toString().includes('FAILED_BODY_MARK')`, 'the body after the retry', 25_000)
  const afterRetry = await snapshot()
  check('the retry loads the body and the editor', afterRetry.cmContent === true && String(afterRetry.editorText).includes('FAILED_BODY_MARK'), afterRetry.editorText)
  check('the controls are usable again after the retry', afterRetry.topbarReadable === 'true' && afterRetry.copy.disabled === false, afterRetry.copy)

  // =====================================================================
  // 3. after the load: copy and both exports carry the article
  // =====================================================================
  section('3. after the body loads, copy and both exports carry the article')
  const appendMark = 'FOURTH_SCENARIO_MARK_AFTER_LOAD'
  check('the article can be edited through the real CodeMirror', (await appendEditor(`\n\n${appendMark}`)) === 'ok')
  await sleep(300)
  await resetSinks()
  const copyClick = await evaluate(`(() => {
    const button = document.querySelector('button[data-onboarding=copy]')
    if (!button) return 'missing'
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    button.click()
    return 'clicked'
  })()`)
  await sleep(800)
  const copied = (await copies())[0]
  check('the copy runs without a publish check on a clean article', copyClick === 'clicked' && (await preflightInfo()) === null, { copyClick, preflight: await preflightInfo() })
  check('the clipboard write carries non-empty rich and plain text', typeof copied?.html === 'string' && copied.html.length > 0 && typeof copied?.plain === 'string' && copied.plain.length > 0, {
    via: copied?.via,
    htmlBytes: String(copied?.html ?? '').length,
    plainBytes: String(copied?.plain ?? '').length,
    ok: copied?.ok,
  })
  check('the copied HTML contains the text just typed', String(copied?.html ?? '').includes(appendMark), String(copied?.html ?? '').slice(0, 80))
  const receipt = await evaluate(`(() => { const b = document.querySelector('button[data-onboarding=copy]'); return b ? b.getAttribute('data-copied') : null })()`)
  check('the copy button confirms the completed write', receipt === 'true', receipt)
  await resetSinks()
  await openMore()
  check('the Markdown export item is enabled again', (await clickExport('markdown')) === 'ok')
  await sleep(500)
  const markdownFile = (await downloads())[0]
  check('the Markdown export downloads a non-empty file containing the article', typeof markdownFile?.text === 'string' && markdownFile.text.length > 0 && markdownFile.text.includes(appendMark), {
    name: markdownFile?.name,
    bytes: String(markdownFile?.text ?? '').length,
  })
  await resetSinks()
  await openMore()
  check('the clean-HTML export item is enabled again', (await clickExport('clean')) === 'ok')
  await sleep(500)
  const cleanFile = (await downloads())[0]
  check('the clean HTML export downloads a non-empty file', typeof cleanFile?.text === 'string' && cleanFile.text.length > 0, {
    name: cleanFile?.name,
    bytes: String(cleanFile?.text ?? '').length,
  })
  check('no publish check held either export up', (await preflightInfo()) === null)
  // Switching articles must clear the copy receipt immediately.
  await resetSinks()
  await evaluate(`document.querySelector('button[data-onboarding=copy]')?.click()`)
  await sleep(300)
  check('the copy receipt is on before switching', (await evaluate(`document.querySelector('button[data-onboarding=copy]')?.getAttribute('data-copied')`)) === 'true')
  await switchDoc('U03 可读占位稿')
  check('switching articles clears the copy receipt', (await evaluate(`document.querySelector('button[data-onboarding=copy]')?.getAttribute('data-copied')`)) !== 'true')
  await waitFor(`!document.querySelector('[data-body-state]') && Boolean(window.__mopaiCodemirror) && window.__mopaiCodemirror.state.doc.toString().includes('封面')`, 'the readable placeholder article', 25_000)

  // =====================================================================
  // 4. the publish check gets raced by an article switch
  // =====================================================================
  section('4. the publish check re-checks the article when the action runs')
  // The placeholder article has an empty image slot: a warning the check shows.
  await waitForToastsGone('the copy and exports before the race')
  await resetSinks()
  await evaluate(`document.querySelector('button[data-onboarding=copy]')?.click()`)
  const openedCheck = await waitForCheck('the publish check on the readable article')
  check('the image placeholder opens the publish check', openedCheck.items.includes('image-placeholder'), openedCheck.items)
  check('nothing reaches the clipboard while the check is up', (await copies()).length === 0)
  holdGet = true
  await switchDoc('U03 竞态稿', { whileCheck: true })
  await waitFor(`Boolean(document.querySelector('[data-body-state="loading"]'))`, 'the raced stub is blocked', 15_000)
  const racedCheck = await preflightInfo()
  check('the switch to a blocked article keeps the check up', racedCheck !== null && (await activeId()) === ids['U03 竞态稿'], { active: await activeId(), check: racedCheck !== null })
  check('the raced article is not readable at execution time', (await snapshot()).topbarReadable === 'false')
  await ackCheck()
  const raceConfirm = await confirmCheck()
  await sleep(900)
  const raceResult = {
    copies: await copies(),
    downloads: await downloads(),
    toasts: await toastText(),
    check: await preflightInfo(),
  }
  check('the confirm was pressed on the stale check', raceConfirm === 'clicked' && raceResult.check === null, { confirm: raceConfirm, panel: raceResult.check })
  check('the stale check writes nothing to the clipboard after the switch', raceResult.copies.length === 0, raceResult.copies)
  check('the stale check downloads nothing after the switch', raceResult.downloads.length === 0, raceResult.downloads)
  check('an error is stated instead of a success', raceResult.toasts.length > 0 && !hasSuccessToast(raceResult.toasts) && /加载|正文|登录/.test(raceResult.toasts), raceResult.toasts)
  await screenshot('05-panel-race.png')
  await releaseHeld()
  holdGet = false
  await waitFor(`!document.querySelector('[data-body-state]') && Boolean(window.__mopaiCodemirror)`, 'the raced body after release', 25_000)

  // The same race, with the clean-HTML export as the pending action.
  await switchDoc('U03 可读占位稿')
  await waitFor(`!document.querySelector('[data-body-state]') && Boolean(window.__mopaiCodemirror)`, 'the readable placeholder article again', 20_000)
  await waitForToastsGone('the first race')
  holdGet = true
  await resetSinks()
  await openMore()
  check('the clean-HTML export opens the check on the readable article', (await clickExport('clean')) === 'ok')
  await waitForCheck('the publish check for the clean-HTML export')
  await switchDoc('U03 竞态二稿', { whileCheck: true })
  await waitFor(`Boolean(document.querySelector('[data-body-state="loading"]'))`, 'the second raced stub is blocked', 15_000)
  check('the export check stays up after the switch too', (await preflightInfo()) !== null)
  await ackCheck()
  const exportConfirm = await confirmCheck()
  await sleep(900)
  const exportRace = { copies: await copies(), downloads: await downloads(), toasts: await toastText() }
  check('the raced export confirm was pressed', exportConfirm === 'clicked', exportConfirm)
  check('the raced export downloads nothing', exportRace.downloads.length === 0, exportRace.downloads)
  check('the raced export copies nothing', exportRace.copies.length === 0, exportRace.copies)
  check('the raced export states an error instead of a success', !hasSuccessToast(exportRace.toasts) && /加载|正文|登录/.test(String(exportRace.toasts)), exportRace.toasts)
  await releaseHeld()
  holdGet = false
  await waitFor(`!document.querySelector('[data-body-state]') && Boolean(window.__mopaiCodemirror)`, 'the second raced body after release', 25_000)

  // =====================================================================
  // 5. a retained stub after signing out is unavailable
  // =====================================================================
  section('5. a cloud stub retained after signing out')
  await openMore()
  check('the sign-out entry is available', (await clickMoreItem('logout')) === 'ok')
  // Signing out navigates to the login page; the editor state is dropped with
  // it. The stub metadata was already written to this browser's index, so
  // coming back to the editor signed out must retain the stub, never invent a
  // body for it.
  await waitFor(`location.pathname === '/login' && Boolean(document.querySelector('input[type=password]'))`, 'the login page after signing out', 25_000)
  await call('Page.navigate', { url: origin })
  await waitFor(`Boolean(document.querySelector('[data-topbar]'))`, 'the editor after signing out', 25_000)
  await waitFor(`(() => {
    try {
      const docs = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}').docs || []
      const retained = docs.find((doc) => doc.id === ${JSON.stringify(ids['U03 保留稿'])})
      return Boolean(retained) && retained.contentLoaded === false && retained.bodyState === 'stub'
    } catch { return false }
  })()`, 'the retained stub in the signed-out index', 20_000)
  const retainedAfterSignOut = ((await indexDocs()) ?? []).find((doc) => doc.id === ids['U03 保留稿'])
  check('signing out keeps the unopened stub in this browser as a stub', retainedAfterSignOut?.contentLoaded === false && retainedAfterSignOut?.bodyState === 'stub', retainedAfterSignOut)
  await installSinks()
  await sleep(500)
  await switchDoc('U03 保留稿')
  await waitFor(`Boolean(document.querySelector('[data-body-state="unavailable"]'))`, 'the unavailable state', 25_000)
  const unavailableNow = await snapshot()
  check('a retained stub without a session is unavailable', unavailableNow.bodyState === 'unavailable', unavailableNow)
  check('the reason tells the author to sign in', String(unavailableNow.bodyReason).includes('登录'), unavailableNow.bodyReason)
  check('there is no retry that could not work', unavailableNow.retry === null, unavailableNow.retry)
  check('no editable area is mounted while the article is unavailable', unavailableNow.cmContent === false && unavailableNow.editorText === null, {
    cmContent: unavailableNow.cmContent,
    editorText: unavailableNow.editorText,
  })
  const unavailableGate = await gateDetail()
  check('every sink-reading control is blocked with the sign-in reason', gatePasses(unavailableGate, '登录'), gateSummary(unavailableGate))
  await attemptBlockedActions()
  const unavailableSinks = { copies: await copies(), downloads: await downloads() }
  check('blocked actions stay empty while unavailable', unavailableSinks.copies.length === 0 && unavailableSinks.downloads.length === 0, unavailableSinks)
  check('no success toast appears while unavailable', !hasSuccessToast(await toastText()), await toastText())
  check('the unavailable stub has no body row in IndexedDB', (await bodyInDb(ids['U03 保留稿'])) === null)
  await screenshot('04-unavailable.png')

  // =====================================================================
  // 6. no empty body was ever written for a blocked article
  // =====================================================================
  section('6. no empty body was written to storage for a blocked article')
  const finalIndex = (await indexDocs()) ?? []
  const finalBodies = await idbBodies()
  const bodyById = new Map(finalBodies.map((row) => [row.id, row.content]))
  const entryByName = (name) => finalIndex.find((doc) => doc.id === ids[name]) ?? null
  const retainedEntry = entryByName('U03 保留稿')
  const backupEntry = entryByName('U03 备份稿')
  check('the retained stub is still an unloaded stub in the index', retainedEntry?.contentLoaded === false && retainedEntry?.bodyState === 'stub', retainedEntry)
  check('the never-opened backup stub is still an unloaded stub in the index', backupEntry?.contentLoaded === false && backupEntry?.bodyState === 'stub', backupEntry)
  check('no blocked stub has a body row in IndexedDB', !bodyById.has(ids['U03 保留稿']) && !bodyById.has(ids['U03 备份稿']), {
    retained: bodyById.has(ids['U03 保留稿']),
    backup: bodyById.has(ids['U03 备份稿']),
  })
  // An article the author really emptied legitimately stores `''`; the claim here
  // is narrower and is the one this suite exists for: a stub (an article whose
  // body this browser does not hold) must never get an empty body row written.
  const stubIds = new Set(finalIndex.filter((doc) => doc.contentLoaded === false).map((doc) => doc.id))
  const emptyStubRows = finalBodies.filter((row) => stubIds.has(row.id) && row.content === '')
  check('no stub id has an empty body row', emptyStubRows.length === 0, {
    stubIds: [...stubIds],
    emptyStubRows: emptyStubRows.map((row) => row.id),
    emptyBodyRowsAnywhere: finalBodies.filter((row) => row.content === '').map((row) => row.id),
  })
  check('the loaded articles hold their real bodies', [
    ['U03 延迟稿', 'DELAYED_BODY_MARK'],
    ['U03 失败稿', 'FAILED_BODY_MARK'],
    ['U03 可读占位稿', '封面'],
    ['U03 竞态稿', 'RACE_STUB_BODY'],
    ['U03 竞态二稿', 'RACE_TWO_STUB_BODY'],
  ].every(([name, marker]) => String(bodyById.get(ids[name]) ?? '').includes(marker)), Object.fromEntries(finalBodies.map((row) => [row.id, String(row.content).slice(0, 20)])))

  // ---------- page health ----------
  section('page health')
  const deliberate = /Failed to fetch|NetworkError|InternetDisconnected|docs\.get|ERR_INTERNET_DISCONNECTED/i
  const realConsoleErrors = consoleErrors.filter((text) => !deliberate.test(String(text)))
  check('no uncaught page exception along the way', exceptions.length === 0, exceptions.slice(0, 3).map((e) => e.text ?? e.exception?.description))
  check('no unexpected console error along the way', realConsoleErrors.length === 0, realConsoleErrors.slice(0, 5))
} catch (error) {
  // Leave the exact DOM/state of the failure behind, not just a message.
  let dom = null
  try { if (snapshotFn) dom = await snapshotFn() } catch { /* page may be gone */ }
  try { if (screenshotFn) await screenshotFn('99-failure.png') } catch { /* page may be gone */ }
  check('script completed without throwing', false, { error: error.stack || error.message, dom })
} finally {
  if (ws) { try { ws.close() } catch { /* already closed */ } }
  await stop(app)
  await stop(chrome)
  if (worker.listening) await new Promise((resolve) => worker.close(resolve))
}

const failed = checks.filter((entry) => !entry.passed)
const summary = {
  task: 'U03 · unreadable article bodies are gated in the editor, copy and exports',
  command: `node scripts/cdp-verify-body-gating.mjs ${port} ${cdpPort}`,
  build,
  result: failed.length === 0 ? 'PASS' : 'FAIL',
  checks,
  passed: checks.length - failed.length,
  total: checks.length,
  failed: failed.map((entry) => entry.name),
  exceptions: exceptions.length,
  consoleErrors,
  appLogTail: appLog.slice(-3000),
  output,
  screenshots: fs.readdirSync(output).filter((name) => name.endsWith('.png')),
}
fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2))
fs.writeFileSync(logPath, logLines.join('\n'))
log(`\n${summary.result} · ${summary.passed}/${summary.total} checks passed`)
if (failed.length) log(`Failed: ${failed.map((entry) => entry.name).join('; ')}`)
log(`Evidence: ${output}`)
process.exitCode = failed.length === 0 ? 0 : 1