// Acceptance for A06: cards and long images must not export a finished looking
// PNG while a formula or Mermaid diagram is still source text inside it.
//
// Drives the shipped UI in a real Chrome:
// - a formula that does not compile blocks both downloads and says why;
// - a Mermaid fence keeps the card export off while the PNG is being made,
// and turns it back on once the diagram is an image;
// - a fence that cannot be rasterized shows the real reason and the retry
// path, and fixing the source recovers without a reload;
// - a slow MathJax download keeps the export off, with no download started,
// then recovers once the bundles land;
// - the long image obeys the same gate and recovers the same way.
//
// Owns its own SQLite database, mock image worker and Chrome profile. Build
// first (`npm run build`), then:
// node scripts/cdp-verify-graphics-gate.mjs [appPort] [cdpPort] [workerPort]
// Screenshots land in verify-out/graphics-gate/<timestamp>/.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

// Everything here talks to127.0.0.1, but this host exports a global HTTP proxy
// that would swallow those requests. Drop it for this process.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP_PORT = Number(process.argv[2] || 4113)
const CDP_PORT = Number(process.argv[3] || 9713)
const WORKER_PORT = Number(process.argv[4] || APP_PORT + 100)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const DB_FILE = path.resolve('data/audit-a06.db')
const ACCESS_KEY = 'graphics-gate-acceptance-key'
const ADMIN_KEY = 'graphics-gate-acceptance-admin'
const SESSION_SECRET = 'graphics-gate-acceptance-session-secret'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const output = path.resolve('verify-out/graphics-gate', new Date().toISOString().replace(/[:.]/g, '-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(` [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`)
}

// ---------- mock image worker (in memory, same protocol as the real one) ----------
// Uploads are held back on purpose: a diagram on localhost otherwise lands
// between the rasterizer debounce and the assertion, making "still pending" a
// race instead of a check.
const UPLOAD_DELAY_MS = 4000
const objects = new Map()
const worker = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/upload') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
      res.writeHead(403).end('bad admin key')
      return
    }
    const key = url.searchParams.get('key') ?? ''
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' })
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ key, size: body.length }))
      }, UPLOAD_DELAY_MS)
    })
    return
  }
  if (url.pathname.startsWith('/img/')) {
    const obj = objects.get(decodeURIComponent(url.pathname.slice('/img/'.length)))
    if (!obj) {
      res.writeHead(404).end('missing')
      return
    }
    // Same cross-origin headers as the real worker: the card image loader fetches the redirected image, and without them the ready diagram counts as a failed image.
    res.writeHead(200, { 'content-type': obj.type, 'access-control-allow-origin': '*' })
    res.end(obj.body)
    return
  }
  res.writeHead(404).end('no route')
})
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// ---------- app server ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(DB_FILE + suffix, { force: true })
  } catch {
    /* nothing to clear */
  }
}
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/audit-a06.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET,
    ANON_GC_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => (appLog += d))
app.stderr.on('data', (d) => (appLog += d))
async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(appUrl, { redirect: 'manual' })
      if (r.status < 500) return
    } catch {
      /* not listening yet */
    }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP_PORT}\n${appLog.slice(-800)}`)
}

// ---------- headless Chrome ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'graphics-gate-'))
let chrome = null
let ws = null
let send = null
let ev = null
let sessionId = null

try {
  await waitUp()
  fs.mkdirSync(output, { recursive: true })
  console.log(`screenshots: ${output}`)

  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--no-proxy-server',
      '--window-size=1600,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  async function wsUrl() {
    for (let i = 0; i < 80; i++) {
      try {
        const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
        if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
      } catch {
        /* not up yet */
      }
      await sleep(250)
    }
    throw new Error('no CDP')
  }

  let id = 1
  const pending = new Map()
  const client = (socket) => {
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(event.data)
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id)
        pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
    })
    return (method, params = {}, sid) =>
      new Promise((resolve, reject) => {
        const i = id++
        pending.set(i, { resolve, reject })
        socket.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }))
        setTimeout(() => {
          if (pending.has(i)) {
            pending.delete(i)
            reject(new Error('timeout ' + method))
          }
        }, 60000)
      })
  }

  ws = new WebSocket(await wsUrl())
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  send = client(ws)

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' },
    sessionId,
  )
  await send('Runtime.enable', {}, sessionId)

  ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    }
    return r.result.value
  }

  const slowNetwork = (on) =>
    send(
      'Network.emulateNetworkConditions',
      on
        ? { offline: false, latency: 300, downloadThroughput: 40 * 1024, uploadThroughput: 40 * 1024 }
        : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      sessionId,
    )

  const screenshot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
  }
  const waitFor = async (expr, ms = 20000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (await ev(expr)) return true
      await sleep(200)
    }
    return false
  }
  const setContent = (md) =>
    ev(`(() => {
 const view = window.__mopaiCodemirror
 if (!view) return 'no editor'
 view.dispatch({ changes: { from:0, to: view.state.doc.length, insert: ${JSON.stringify(md)} } })
 return 'ok'
 })()`)
  const switchMode = async (mode) => {
    const clicked = await ev(`(() => {
 const button = document.querySelector('[data-preview-mode="${mode}"]')
 if (!button) return 'missing'
 button.click()
 return 'ok'
 })()`)
    await sleep(900)
    return clicked
  }
  const exportButton = (selector) =>
    ev(`(() => {
 const button = document.querySelector(${JSON.stringify(selector)})
 return button ? { disabled: Boolean(button.disabled), label: button.innerText.trim() } : null
 })()`)
  /** The gate state and the visible reason for whichever preview is on screen. */
  const viewGraphics = (rootSelector) =>
    ev(`(() => {
 const root = document.querySelector(${JSON.stringify(rootSelector)})
 const warning = document.querySelector('[data-graphics-warning]')
 return {
 root: Boolean(root),
 math: root ? root.getAttribute('data-cards-math') || root.getAttribute('data-long-math') : null,
 diagram: root ? root.getAttribute('data-cards-diagram') || root.getAttribute('data-long-diagram') : null,
 warning: warning ? warning.innerText.trim() : '',
 warningState: warning ? warning.getAttribute('data-graphics-state') : null,
 retry: Boolean(document.querySelector('[data-graphics-warning] button')),
 }
 })()`)
  /** Record downloads instead of opening the save dialog. */
  const installSinks = () =>
    ev(`(() => {
 window.__downloads = []
 HTMLAnchorElement.prototype.click = function () {
 if (!this.download) return
 window.__downloads.push({ name: this.download })
 }
 return true
 })()`)
  const downloads = async () => {
    await sleep(200)
    return (await ev('window.__downloads || []')) || []
  }
  const waitForExportEnabled = async (selector, ms =60000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const state = await exportButton(selector)
      if (state && state.disabled === false) return true
      await sleep(300)
    }
    return false
  }

  const clickExport = async (selector) => {
    const state = await exportButton(selector)
    if (!state) return 'missing'
    if (state.disabled) return 'disabled'
    await ev(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return true })()`)
    return 'clicked'
  }
  const waitForDownload = async (ms = 90000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const list = await downloads()
      if (list.length) return list
      await sleep(400)
    }
    return []
  }
  const openEditor = async () => {
    if (!(await waitFor('Boolean(window.__mopaiCodemirror)', 30000))) {
      throw new Error('the editor never mounted\n' + appLog.slice(-600))
    }
    await installSinks()
  }

  console.log('=== loading the editor ===')
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(2500)
  await openEditor()
  await sleep(400)

  console.log('\n=== a card with broken TeX cannot be exported ===')
  check(
    'the card preview opens',
    (await switchMode('cards')) === 'ok' &&
      (await waitFor(`Boolean(document.querySelector('[data-xhs-view]'))`, 25000)),
  )
  await setContent('$$\n\\frac{1}{\n$$\n')
  const brokenMath = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-math') === 'failed'`,
    30000,
  )
  const brokenState = await viewGraphics('[data-xhs-view]')
  check(
    'the broken formula finishes as failed, not as an endless pending',
    brokenMath && brokenState.math === 'failed',
    JSON.stringify(brokenState),
  )
  check('... the view states the real reason', /公式没能编译/.test(brokenState.warning), brokenState.warning)
  check('... the ZIP button is disabled', (await exportButton('[data-card-export-all]'))?.disabled === true)
  await screenshot('cards-math-failed.png')
  check(
    'a disabled ZIP click starts no download',
    (await clickExport('[data-card-export-all]')) === 'disabled' && (await downloads()).length === 0,
  )

  console.log('\n=== fixing the TeX restores the card export ===')
  await setContent('$$\nE = mc^2\n$$\n')
  const mathFixed = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-math') === 'ready'`,
    45000,
  )
  check('the fixed formula reaches ready', mathFixed, JSON.stringify(await viewGraphics('[data-xhs-view]')))
  check('... and the ZIP button turns back on', (await exportButton('[data-card-export-all]'))?.disabled === false)
  await screenshot('cards-math-ready.png')
  await installSinks()
  check(
    'the ready export really starts a download',
    (await clickExport('[data-card-export-all]')) === 'clicked' && (await waitForDownload()).length === 1,
  )

  console.log('\n=== cards wait for a Mermaid diagram while it uploads ===')
  await setContent('##图表\n\n```mermaid\ngraph TD\n A[开始] --> B[结束]\n```\n')
  const diagramPending = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-diagram') === 'pending'`,
    15000,
  )
  const pendingState = await viewGraphics('[data-xhs-view]')
  check(
    'the fence is pending while its PNG is made',
    diagramPending && pendingState.diagram === 'pending',
    JSON.stringify(pendingState),
  )
  check(
    '... the reason names the diagram, not the formula',
    /图表还在生成图片/.test(pendingState.warning),
    pendingState.warning,
  )
  check('... the ZIP button is disabled', (await exportButton('[data-card-export-all]'))?.disabled === true)
  await screenshot('cards-diagram-pending.png')
  const diagramReady = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-diagram') === 'ready'`,
    60000,
  )
  check(
    'the finished diagram turns the export back on',
    diagramReady && (await waitForExportEnabled('[data-card-export-all]')),
  )
  await screenshot('cards-diagram-ready.png')

  console.log('\n=== a Mermaid fence that cannot rasterize is reported, then recoverable ===')
  await setContent('```mermaid\nthis is not a diagram\n```\n')
  const diagramFailed = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-diagram') === 'failed'`,
    40000,
  )
  const failedDiagram = await viewGraphics('[data-xhs-view]')
  check(
    'the failing fence ends as failed',
    diagramFailed && failedDiagram.diagram === 'failed',
    JSON.stringify(failedDiagram),
  )
  check('... the failure says what happened', /图表没生成图片/.test(failedDiagram.warning), failedDiagram.warning)
  check('... the existing retry path is offered', failedDiagram.retry === true)
  check('... the ZIP button stays disabled', (await exportButton('[data-card-export-all]'))?.disabled === true)
  await screenshot('cards-diagram-failed.png')
  await setContent('```mermaid\ngraph LR\n X --> Y\n```\n')
  const recovered = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-diagram') === 'ready'`,
    60000,
  )
  check(
    'editing the fence recovers without a reload',
    recovered && (await waitForExportEnabled('[data-card-export-all]')),
  )

  console.log('\n=== a slow MathJax keeps the card export off, then recovers ===')
  await setContent('准备重载，正文里没有公式。')
  await sleep(800)
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId)
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(2500)
  await openEditor()
  check(
    'the card preview reopens after the reload',
    (await switchMode('cards')) === 'ok' &&
      (await waitFor(`Boolean(document.querySelector('[data-xhs-view]'))`, 25000)),
  )
  await slowNetwork(true)
  await setContent('$$\nE = mc^2\n$$\n')
  const slowPending = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-math') === 'pending'`,
    20000,
  )
  const slowState = await viewGraphics('[data-xhs-view]')
  check(
    'the formula is pending while MathJax is still arriving',
    slowPending && slowState.math === 'pending',
    JSON.stringify(slowState),
  )
  check('... the reason is a wait, not an error', /公式还在渲染/.test(slowState.warning), slowState.warning)
  check('... the ZIP button is disabled', (await exportButton('[data-card-export-all]'))?.disabled === true)
  await screenshot('cards-math-pending.png')
  check(
    '... a disabled ZIP click starts no download',
    (await clickExport('[data-card-export-all]')) === 'disabled' && (await downloads()).length === 0,
  )
  await slowNetwork(false)
  await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId)
  const slowReady = await waitFor(
    `document.querySelector('[data-xhs-view]')?.getAttribute('data-cards-math') === 'ready'`,
    180000,
  )
  check(
    'the finished formula turns the card export back on',
    slowReady && (await waitForExportEnabled('[data-card-export-all]')),
  )
  await screenshot('cards-math-pending-recovered.png')

  console.log('\n=== the long image obeys the same gate ===')
  check(
    'the long-image preview opens',
    (await switchMode('long')) === 'ok' &&
      (await waitFor(`Boolean(document.querySelector('[data-long-view]'))`, 30000)),
  )
  await setContent('$$\n\\frac{1}{\n$$\n')
  const longFailed = await waitFor(
    `document.querySelector('[data-long-view]')?.getAttribute('data-long-math') === 'failed'`,
    40000,
  )
  const longState = await viewGraphics('[data-long-view]')
  check(
    'a long image with broken TeX reports the failure',
    longFailed && longState.math === 'failed',
    JSON.stringify(longState),
  )
  check('... the reason is visible', /公式没能编译/.test(longState.warning), longState.warning)
  check('... and the long-image export is disabled', (await exportButton('[data-long-export-all]'))?.disabled === true)
  await screenshot('long-math-failed.png')
  await setContent('$$\nE = mc^2\n$$\n')
  const longReady = await waitFor(
    `document.querySelector('[data-long-view]')?.getAttribute('data-long-math') === 'ready'`,
    90000,
  )
  check(
    'a compilable formula turns the long-image export on',
    longReady && (await exportButton('[data-long-export-all]'))?.disabled === false,
  )
  await screenshot('long-math-ready.png')
} catch (e) {
  failures++
  console.log(`\n[FATAL] ${e instanceof Error ? e.message : String(e)}`)
  if (appLog) console.log(appLog.slice(-1200))
} finally {
  try {
    chrome?.kill()
  } catch {
    /* already gone */
  }
  try {
    app.kill()
  } catch {
    /* already gone */
  }
  worker.close()
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Chrome may hold it */
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
