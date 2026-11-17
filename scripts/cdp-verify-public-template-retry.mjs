// Acceptance for A10: the nine public card packages load in parallel, one
// failing package leaves the other eight usable, and a real retry replaces the
// failed promise without a page reload.
//
// The CDP Fetch domain pauses every `.reedcard` request for220 ms and records
// when it was issued. That reproduces the reported waterfall: serial loading
// makes the first and last request start ~1.8 s apart, parallel loading keeps
// them within a few milliseconds.
//
// Scenarios:
// - nine requests start together (span <=300 ms) and the list still follows
// catalog order;
// - the first swiss-grid request fails: eight templates stay usable, the error
// row and its retry show the real state;
// - pressing retry issues nine fresh requests, keeps the stylesheet count at
// nine (no duplicate registration) and needs no reload;
// - the long-image kind fails and retries the same way.
//
// Build first (`npm run build`), then:
// node scripts/cdp-verify-public-template-retry.mjs [appPort] [cdpPort]
// Evidence (timeline JSON + screenshots) lands in
// verify-out/public-template-retry/<timestamp>/.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP_PORT = Number(process.argv[2] || 4113)
const CDP_PORT = Number(process.argv[3] || 9713)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const DB_FILE = path.resolve('data/audit-a10.db')
const ACCESS_KEY = 'public-template-retry-acceptance-key'
const SESSION_SECRET = 'public-template-retry-acceptance-session-secret'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PACKAGE_DELAY_MS = 220
const output = path.resolve('verify-out/public-template-retry', new Date().toISOString().replace(/[:.]/g, '-'))
const expectedOrder = [
  'swiss-grid',
  'editorial-white',
  'book-notes',
  'aurora',
  'deep-night',
  'doc-frame',
  'tech-pulse',
  'fresh-notes',
  'pine-notebook',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(` [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`)
}

// ---------- app server (no image worker: this suite never uploads) ----------
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
    DATABASE_URL: 'file:./data/audit-a10.db',
    IMG_BASE_URL: `http://127.0.0.1:${APP_PORT + 100}`,
    IMG_ADMIN_KEY: 'public-template-retry-acceptance-admin',
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'public-template-retry-'))
let chrome = null
let send = null
let ev = null
let sessionId = null
let onEvent = () => {}

try {
  await waitUp()
  fs.mkdirSync(output, { recursive: true })
  console.log(`evidence: ${output}`)

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
  const handlers = new Map()
  onEvent = (method, fn) => {
    const list = handlers.get(method) ?? []
    list.push(fn)
    handlers.set(method, list)
  }
  const client = (socket) => {
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(event.data)
      if (m.id && pending.has(m.id)) {
        const entry = pending.get(m.id)
        pending.delete(m.id)
        m.error ? entry.reject(new Error(JSON.stringify(m.error))) : entry.resolve(m.result)
        return
      }
      if (m.method) for (const fn of handlers.get(m.method) ?? []) fn(m.params)
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
        }, 120000)
      })
  }

  const ws = new WebSocket(await wsUrl())
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  send = client(ws)

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source:
        'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{};window.__pageLoads=(window.__pageLoads||0)+1',
    },
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

  // ---- record every package request and hold it for220 ms ----
  let failSwissOnce = true
  let failLongOnce = false
  const requests = []
  onEvent('Fetch.requestPaused', (params) => {
    const url = params.request.url
    if (!/\/card-templates\/[^/]+\.reedcard(\?|$)/.test(url)) {
      void send('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {})
      return
    }
    const failed = (failSwissOnce && url.includes('swiss-grid')) || (failLongOnce && url.includes('blue-tech-recap'))
    if (failed) {
      if (url.includes('swiss-grid')) failSwissOnce = false
      if (url.includes('blue-tech-recap')) failLongOnce = false
    }
    requests.push({ url, at: Date.now(), failed })
    setTimeout(() => {
      const call = failed
        ? send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }, sessionId)
        : send('Fetch.continueRequest', { requestId: params.requestId }, sessionId)
      void call.catch(() => {})
    }, PACKAGE_DELAY_MS)
  })
  await send(
    'Fetch.enable',
    {
      patterns: [{ urlPattern: '*/card-templates/*.reedcard*', requestStage: 'Request' }],
    },
    sessionId,
  )

  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(2500)
  const mounted = await waitFor('Boolean(window.__mopaiCodemirror)', 30000)
  check('the editor mounts', mounted)
  if (!mounted) throw new Error('editor never mounted\n' + appLog.slice(-600))

  console.log('\n=== the card packages load in parallel ===')
  check(
    'the card preview opens',
    (await switchMode('cards')) === 'ok' &&
      (await waitFor(`Boolean(document.querySelector('[data-xhs-view]'))`, 25000)),
  )
  check(
    'the partial load is reported',
    await waitFor(`Boolean(document.querySelector('[data-public-card-error]'))`, 30000),
  )
  const tileState = () =>
    ev(`(() => {
 const tiles = [...document.querySelectorAll('[data-card-template-public]')]
 return {
 order: tiles.map((tile) => tile.dataset.cardTemplatePublic),
 enabled: tiles.filter((tile) => !tile.disabled).map((tile) => tile.dataset.cardTemplatePublic),
 error: document.querySelector('[data-public-card-error]')?.innerText ?? '',
 retry: Boolean(document.querySelector('[data-public-card-error] [data-public-templates-retry]')),
 styles: document.querySelectorAll('style[data-card-template-style]').length,
 loads: window.__pageLoads,
 }
 })()`)
  const firstBatch = requests.slice()
  const span =
    firstBatch.length > 1 ? Math.max(...firstBatch.map((r) => r.at)) - Math.min(...firstBatch.map((r) => r.at)) : -1
  const failedRequests = firstBatch.filter((r) => r.failed)
  check(
    'nine package requests were issued',
    firstBatch.length === 9,
    JSON.stringify(firstBatch.map((r) => r.url.split('/').pop())),
  )
  check('their start times stay within300 ms of each other', span >= 0 && span <= 300, `span=${span}ms`)
  check(
    'the first swiss-grid request failed as injected',
    failedRequests.length === 1 && failedRequests[0].url.includes('swiss-grid'),
  )
  const firstState = await tileState()
  const selectionBefore = await ev(
    '(() => { try { return JSON.parse(localStorage.getItem("mopai.card-options.v1") ?? "null") } catch { return null } })()',
  )
  check(
    'the other eight templates stay usable',
    firstState.enabled.length === 8 && !firstState.enabled.includes('swiss-grid'),
    JSON.stringify(firstState.enabled),
  )
  check(
    'the disabled swiss-grid tile stays visible',
    firstState.order.includes('swiss-grid'),
    JSON.stringify(firstState.order),
  )
  check(
    'the list keeps catalog order',
    JSON.stringify(firstState.order) === JSON.stringify(expectedOrder),
    JSON.stringify(firstState.order),
  )
  check('the error row explains the partial load and offers retry', firstState.error.length > 0 && firstState.retry)
  check('eight stylesheets are registered, one per loaded package', firstState.styles === 8, String(firstState.styles))
  check('the page was not reloaded for the partial list', firstState.loads === 1, String(firstState.loads))
  await screenshot('cards-public-error.png')

  console.log('\n=== retry fetches the missing package again, without a reload ===')
  const retried = await ev(
    `(() => { const button = document.querySelector('[data-public-card-error] [data-public-templates-retry]'); if (!button) return 'missing'; button.click(); return 'ok' })()`,
  )
  check('the retry button is clickable', retried === 'ok')
  check(
    'the full list arrives without a reload',
    await waitFor(
      `(() => {
 const tiles = [...document.querySelectorAll('[data-card-template-public]')]
 return tiles.filter((tile) => !tile.disabled).length ===9 && !document.querySelector('[data-public-card-error]')
 })()`,
      40000,
    ),
  )
  const secondBatch = requests.slice(firstBatch.length)
  const secondSpan =
    secondBatch.length > 1 ? Math.max(...secondBatch.map((r) => r.at)) - Math.min(...secondBatch.map((r) => r.at)) : -1
  const secondState = await tileState()
  check(
    'retry issues nine fresh requests, not the cached rejection',
    secondBatch.length === 9,
    JSON.stringify(secondBatch.map((r) => r.url.split('/').pop())),
  )
  check('... and those requests start in parallel too', secondSpan >= 0 && secondSpan <= 300, `span=${secondSpan}ms`)
  check(
    '... swiss-grid is now among the loaded templates',
    secondState.enabled.includes('swiss-grid'),
    JSON.stringify(secondState.enabled),
  )
  check('... no stylesheet is registered twice', secondState.styles === 9, String(secondState.styles))
  check('... still without a reload', secondState.loads === 1, String(secondState.loads))
  check(
    '... the current selection was not silently changed',
    JSON.stringify(
      await ev(
        '(() => { try { return JSON.parse(localStorage.getItem("mopai.card-options.v1") ?? "null") } catch { return null } })()',
      ),
    ) === JSON.stringify(selectionBefore),
    JSON.stringify(selectionBefore),
  )
  await screenshot('cards-public-retry.png')
  fs.writeFileSync(
    path.join(output, 'timeline.json'),
    JSON.stringify(
      {
        firstBatch,
        secondBatch,
        firstSpanMs: span,
        secondSpanMs: secondSpan,
      },
      null,
      2,
    ),
  )

  console.log('\n=== the long-image kind retries the same way ===')
  failLongOnce = true
  const longRequestsBefore = requests.length
  check(
    'the long-image preview opens',
    (await switchMode('long')) === 'ok' &&
      (await waitFor(`Boolean(document.querySelector('[data-long-view]'))`, 30000)),
  )
  check(
    'its failed package is reported',
    await waitFor(`Boolean(document.querySelector('[data-long-public-error]'))`, 30000),
  )
  const longError = await ev(`(() => ({
 error: document.querySelector('[data-long-public-error]')?.innerText ?? '',
 retry: Boolean(document.querySelector('[data-long-public-error] [data-public-templates-retry]')),
 enabled: [...document.querySelectorAll('[data-long-template-public]')].filter((tile) => !tile.disabled).length,
 }))()`)
  check(
    'the long error row explains the failure and offers retry',
    longError.error.length > 0 && longError.retry,
    JSON.stringify(longError),
  )
  check('no long template is selectable before it loads', longError.enabled === 0)
  await screenshot('long-public-error.png')
  check(
    'the long retry is clickable',
    (await ev(
      `(() => { const button = document.querySelector('[data-long-public-error] [data-public-templates-retry]'); if (!button) return 'missing'; button.click(); return 'ok' })()`,
    )) === 'ok',
  )
  check(
    'the long template arrives without a reload',
    await waitFor(
      `(() => {
 const tile = document.querySelector('[data-long-template-public="blue-tech-recap"]')
 return Boolean(tile) && !tile.disabled && !document.querySelector('[data-long-public-error]')
 })()`,
      40000,
    ),
  )
  check(
    '... by fetching the failed package again',
    requests.length === longRequestsBefore + 2,
    `${requests.length - longRequestsBefore}`,
  )
  check(
    '... and without registering a second long stylesheet',
    (await ev(`document.querySelectorAll('style[data-card-template-style]').length`)) === 10,
  )
  await screenshot('long-public-retry.png')
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
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Chrome may hold it */
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
