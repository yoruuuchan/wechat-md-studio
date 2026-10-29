// Acceptance for R13: an article whose formulas have not finished rendering
// must not be handed out as if it were done.
//
// Drives the shipped UI against a deliberately slow MathJax load, a disconnected
// one, and a body that changes under it:
//   - while the bundles are still arriving, copy and both HTML exports are
//     refused with a "still rendering" hint, and nothing reaches the clipboard
//     or the disk;
//   - an article opened while the previous one still waits copies at once, so a
//     pending formula cannot leak across an article switch;
//   - once the bundles land, the copied HTML carries the real formula SVG;
//   - broken TeX is refused, and copying the source stays an explicit choice;
//   - a bundle that cannot load is reported as such, is retried, and recovers;
//   - a mermaid fence and a formula run together without either being handed out
//     before it is ready.
//
// Brings its own in-memory image worker and a fresh SQLite database, so nothing
// reaches production R2 or the dev database. Uses data/audit-r13.db.
//
// Build first (`npm run build`), then:
//   node scripts/cdp-verify-math-readiness.mjs [appPort] [cdpPort] [workerPort]
// Worker defaults to appPort + 100 (4113 -> 4213), matching the audit port plan.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

// Everything here talks to 127.0.0.1, but this host exports a global HTTP proxy
// that would swallow those requests. Drop it for this process.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP_PORT = Number(process.argv[2] || 4113)
const CDP_PORT = Number(process.argv[3] || 9713)
const WORKER_PORT = Number(process.argv[4] || APP_PORT + 100)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const DB_FILE = path.resolve('data/audit-r13.db')
const ACCESS_KEY = 'math-readiness-acceptance-key'
const ADMIN_KEY = 'math-readiness-acceptance-admin'
const SESSION_SECRET = 'math-readiness-acceptance-session-secret'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 260) : ''}`)
}

// ---------- mock image worker (in memory, same protocol as the real one) ----------
// The upload is held back on purpose: a diagram on localhost otherwise finishes
// between the 1.2 s rasterizer debounce and the click, which would make the
// "both are pending" assertion a race instead of a check.
const UPLOAD_DELAY_MS = 6000
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
    res.writeHead(200, { 'content-type': obj.type })
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
    DATABASE_URL: 'file:./data/audit-r13.db',
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'math-readiness-'))
let chrome = null
let ws = null
let send = null
let ev = null
let sessionId = null

try {
  await waitUp()

  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' })

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
  // A fresh profile would meet the first-run tour on the editor; this suite
  // drives the app as a returning visitor.
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' },
    sessionId,
  )
  await send('Runtime.enable', {}, sessionId)
  await send('Browser.grantPermissions', {
    origin: `http://127.0.0.1:${APP_PORT}`,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })

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
  const setOffline = (on) =>
    send(
      'Network.emulateNetworkConditions',
      { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      sessionId,
    )

  const toastTexts = () =>
    ev(`[...document.querySelectorAll('[data-sonner-toast]')].map(e => e.innerText)`)
  let toastMark = []
  const markToasts = async () => {
    toastMark = (await toastTexts()) || []
  }
  /** Only what appeared since the mark: stale toasts must not pass a check. */
  const freshToasts = async () => {
    const now = (await toastTexts()) || []
    const fresh = now.filter((t) => !toastMark.includes(t))
    return (fresh.length ? fresh : now).join('\n')
  }
  const toastButton = (label) =>
    ev(`(() => {
      const btn = [...document.querySelectorAll('[data-sonner-toast] button')]
        .find(b => b.textContent.includes(${JSON.stringify(label)}))
      if (!btn) return 'missing'
      btn.click()
      return 'clicked'
    })()`)
  const resetSinks = () =>
    ev(`(() => { window.__copies = []; window.__downloads = []; return true })()`)
  /**
   * The publish check is the single gate in front of copy and both HTML
   * exports, so these read it the way the author sees it: which findings it
   * lists, whether the primary button is an override, and whether it is
   * allowed to run at all.
   */
  const preflight = () =>
    ev(`(() => {
      const root = document.querySelector('[data-preflight]')
      if (!root) return null
      const go = root.querySelector('[data-preflight-go]')
      return {
        items: [...root.querySelectorAll('[data-preflight-item]')].map((el) => el.dataset.preflightItem),
        text: root.innerText,
        state: go ? go.dataset.preflightState : null,
        goLabel: go ? go.innerText.trim() : null,
        goDisabled: go ? Boolean(go.disabled) : null,
        hasAck: Boolean(root.querySelector('[data-preflight-ack]')),
      }
    })()`)
  const preflightGo = () =>
    ev(`(() => { const b = document.querySelector('[data-preflight-go]'); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' })()`)
  const preflightAck = () =>
    ev(`(() => { const c = document.querySelector('[data-preflight-ack]'); if (!c) return 'missing'; c.click(); return 'clicked' })()`)
  const preflightCancel = () =>
    ev(`(() => { const b = document.querySelector('[data-preflight-cancel]'); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  const closePreflight = async () => {
    await preflightCancel()
    await sleep(300)
  }
  const copies = async () => {
    const raw = await ev(`(async () => {
      await new Promise(r => setTimeout(r, 120))
      return JSON.stringify(window.__copies)
    })()`)
    return JSON.parse(raw)
  }
  const downloads = async () => {
    const raw = await ev(`(async () => {
      await new Promise(r => setTimeout(r, 250))
      return JSON.stringify((window.__downloads || []).map(d => ({ name: d.name, text: d.text })))
    })()`)
    return JSON.parse(raw)
  }
  const clickCopy = () =>
    ev(`(async () => {
      const btn = document.querySelector('button[data-onboarding=copy]')
      if (!btn) return 'no copy button'
      btn.click()
      await new Promise(r => setTimeout(r, 250))
      return 'clicked'
    })()`)
  const setContent = (md) =>
    ev(`(() => {
      const v = window.__mopaiCodemirror
      if (!v) return 'no editor'
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(md)} } })
      return 'ok'
    })()`)
  const renameDoc = (name) =>
    ev(`(() => {
      const input = document.querySelector('header input')
      if (!input) return 'no input'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(name)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`)
  const menuItem = (label) =>
    ev(`(() => {
      const item = [...document.querySelectorAll('[role=menuitem]')]
        .find(i => i.textContent.includes(${JSON.stringify(label)}))
      if (!item) return 'missing'
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      item.click()
      return 'ok'
    })()`)
  const docMenu = async (label) => {
    const opened = await ev(`(() => {
      const input = document.querySelector('header input')
      const b = input && input.parentElement ? input.parentElement.querySelector('button') : null
      if (!b) return 'no trigger'
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      b.click()
      return 'ok'
    })()`)
    await sleep(500)
    const picked = await menuItem(label)
    await sleep(700)
    return `${opened}/${picked}`
  }
  const exportMenu = async (label) => {
    const opened = await ev(`(() => {
      const b = [...document.querySelectorAll('header button')].find(x => x.textContent.trim() === '导出')
      if (!b) return 'no export button'
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      b.click()
      return 'ok'
    })()`)
    await sleep(500)
    const picked = await menuItem(label)
    await sleep(500)
    return `${opened}/${picked}`
  }
  const waitFor = async (expr, ms = 20000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (await ev(expr)) return true
      await sleep(200)
    }
    return false
  }
  const previewSvg = `document.querySelectorAll('div.px-1.py-6 svg').length > 0`
  const previewImg = `document.querySelectorAll('div.px-1.py-6 img').length > 0`

  /**
   * Record what a copy or a download actually hands to the browser, instead of
   * trusting the toast. Must be reinstalled after every navigation.
   */
  const installSinks = () =>
    ev(`(() => {
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
        const r = origExec(cmd, ...rest)
        if (cmd === 'copy') window.__copies.push({ via: 'execCommand', ok: r })
        return r
      }
      const origCreate = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (blob) => { window.__lastBlob = blob; return origCreate(blob) }
      HTMLAnchorElement.prototype.click = function () {
        if (!this.download) return
        const entry = { name: this.download }
        window.__downloads.push(entry)
        if (window.__lastBlob) window.__lastBlob.text().then((text) => { entry.text = text })
      }
    })()`)

  console.log('=== loading the editor ===')
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(2500)
  if (!(await waitFor(`Boolean(window.__mopaiCodemirror)`, 30000))) {
    throw new Error('the editor never mounted\n' + appLog.slice(-600))
  }
  await installSinks()
  await renameDoc('A')
  await sleep(400)

  console.log('\n=== a formula-free article copies and exports at once ===')
  check('the article menu offers a new article', (await docMenu('新建')) === 'ok/ok')
  await setContent('B 稿没有公式，点一下就能复制。')
  await sleep(600)
  await resetSinks()
  await markToasts()
  await clickCopy()
  const plainCopies = await copies()
  check(
    'a formula-free article copies on the first click',
    plainCopies.length === 1 && plainCopies[0].ok === true,
    JSON.stringify(plainCopies.map((c) => ({ ok: c.ok, len: c.html?.length }))),
  )
  check(
    '... and its payload is the article itself',
    Boolean(plainCopies[0]?.html?.includes('B 稿没有公式')) && !String(plainCopies[0]?.html).includes('<svg'),
  )
  await markToasts()
  const plainExport = await exportMenu('干净正文')
  const plainDownloads = await downloads()
  check('the clean HTML export runs at once', plainExport === 'ok/ok' && plainDownloads.length === 1, `${plainExport} / ${plainDownloads.length}`)
  check(
    '... and carries no unfinished formula',
    Boolean(plainDownloads[0]?.text?.includes('B 稿没有公式')) && !String(plainDownloads[0]?.text).includes('<svg'),
    String(plainDownloads[0]?.name),
  )

  console.log('\n=== a slow formula blocks copy and both HTML exports ===')
  check('switching back to the first article works', (await docMenu('A')) === 'ok/ok')
  await sleep(600)
  await slowNetwork(true)
  await setContent('正文开头。\n\n$$\nE = mc^2\n$$\n\n正文结尾。\n')
  await sleep(500)
  await resetSinks()
  await markToasts()
  await clickCopy()
  const pendingCheck = await preflight()
  check(
    'the copy opens the publish check while the formula renders',
    Boolean(pendingCheck) && pendingCheck.items.includes('math-pending'),
    JSON.stringify(pendingCheck && pendingCheck.items),
  )
  check('... and names the formula as still rendering', /公式还在渲染/.test(pendingCheck?.text ?? ''))
  check('an unfinished formula cannot be waved through', pendingCheck?.state === 'override' && !pendingCheck?.goDisabled, `${pendingCheck?.state} / ${pendingCheck?.goLabel}`)
  check('nothing reaches the clipboard', (await copies()).length === 0)
  await closePreflight()

  const cleanWhilePending = await exportMenu('干净正文')
  const cleanPending = await preflight()
  check(
    'the clean HTML export opens the same check',
    cleanWhilePending === 'ok/ok' && Boolean(cleanPending) && cleanPending.items.includes('math-pending'),
    `${cleanWhilePending} / ${JSON.stringify(cleanPending && cleanPending.items)}`,
  )
  await closePreflight()
  const pageWhilePending = await exportMenu('预览页')
  const pagePending = await preflight()
  check(
    'the preview page export is refused too',
    pageWhilePending === 'ok/ok' && Boolean(pagePending) && pagePending.items.includes('math-pending'),
    `${pageWhilePending} / ${JSON.stringify(pagePending && pagePending.items)}`,
  )
  await closePreflight()
  check('no HTML file is produced while the formula is pending', (await downloads()).length === 0)

  console.log('\n=== a new article is not held back by the previous one ===')
  check('a third article can be created', (await docMenu('新建')) === 'ok/ok')
  await setContent('C 稿也没有公式。')
  await sleep(500)
  await resetSinks()
  await markToasts()
  await clickCopy()
  const switched = await copies()
  check(
    'the fresh article copies while the other one still renders',
    switched.length === 1 && switched[0].ok === true && switched[0].html?.includes('C 稿'),
    JSON.stringify(switched.map((c) => ({ ok: c.ok, len: c.html?.length }))),
  )

  console.log('\n=== once MathJax lands, the copy carries the SVG ===')
  await slowNetwork(false)
  check('switching back to the formula article works', (await docMenu('A')) === 'ok/ok')
  const rendered = await waitFor(previewSvg, 45000)
  check('the formula rendered after the bundle arrived', rendered)
  await resetSinks()
  await markToasts()
  await clickCopy()
  const formulaCopy = (await copies())[0]
  check(
    'the copy payload carries the real formula SVG',
    Boolean(formulaCopy?.html?.includes('<svg')) && (formulaCopy?.html?.match(/<path /g) ?? []).length > 3,
    formulaCopy ? `${formulaCopy.html.length}B / ${(formulaCopy.html.match(/<path /g) ?? []).length} paths` : 'no copy',
  )
  check('the success toast says it copied', /已复制/.test(await freshToasts()), await freshToasts())

  console.log('\n=== broken TeX is refused, and the source is an explicit choice ===')
  await setContent('$$\n\\frac{1}{\n$$\n')
  const failedBox = await waitFor(`document.querySelector('div.px-1.py-6').innerText.includes('公式无法编译')`, 20000)
  check('the broken formula falls back to a visible error box', failedBox)
  await resetSinks()
  await markToasts()
  await clickCopy()
  const failedCheck = await preflight()
  check(
    'the copy is refused for TeX that does not compile',
    Boolean(failedCheck) && failedCheck.items.includes('math-failed'),
    JSON.stringify(failedCheck && failedCheck.items),
  )
  check('the panel carries the offending TeX', /frac/.test(failedCheck?.text ?? ''), failedCheck?.text?.slice(0, 160))
  check('nothing reaches the clipboard', (await copies()).length === 0)
  check(
    'the override is its own explicit button',
    failedCheck?.state === 'override' && /仍要复制/.test(failedCheck?.goLabel ?? ''),
    `${failedCheck?.state} / ${failedCheck?.goLabel}`,
  )
  check('the override runs the copy', (await preflightGo()) === 'clicked')
  const forced = (await copies())[0]
  check(
    'the author can explicitly copy the source instead',
    Boolean(forced?.html?.includes('公式无法编译')) && !String(forced?.html).includes('<svg'),
    forced ? `${forced.html.length}B` : 'no copy',
  )

  console.log('\n=== editing the formula clears the failure ===')
  await setContent('$$\nE = mc^3\n$$\n')
  await waitFor(previewSvg, 20000)
  await resetSinks()
  await markToasts()
  await clickCopy()
  const edited = (await copies())[0]
  check(
    'the fixed formula is copied as an SVG, not as TeX',
    Boolean(edited?.html?.includes('<svg')) && !String(edited?.html).includes('mc^3'),
  )

  console.log('\n=== a MathJax bundle that cannot load is reported and recoverable ===')
  // A reload is what makes this a real engine failure: in this session the
  // engine is already warm, so only a fresh page can be cut off from the chunk.
  await setContent('准备重载，正文里没有公式。')
  await sleep(800)
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(2500)
  if (!(await waitFor(`Boolean(window.__mopaiCodemirror)`, 30000))) {
    throw new Error('the editor did not come back after the reload')
  }
  await installSinks()
  // Offline alone is not enough any more: the bundle is already in Chrome's HTTP
  // cache from earlier in this session, and an offline page still reads that
  // cache, so the engine would load and the scenario would silently not happen.
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId)
  await setOffline(true)
  await setContent('$$\nx = 1\n$$\n')
  await sleep(1800)
  await markToasts()
  const engineArticle = await ev(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : 'no editor'`)
  await clickCopy()
  const engineCheck = await preflight()
  check('the offline article still carries the formula that cannot render', engineArticle.includes('x = 1'), engineArticle.slice(0, 60))
  check(
    'the failure is reported as an engine problem, not broken TeX',
    Boolean(engineCheck) && engineCheck.items.includes('math-engine'),
    JSON.stringify({ panel: engineCheck && engineCheck.items, toasts: await freshToasts() }),
  )
  check('nothing reaches the clipboard', (await copies()).length === 0)
  check('the source is offered on demand too', (await preflightGo()) === 'clicked')
  check('the source copy carries the TeX', Boolean((await copies()).at(-1)?.html?.includes('x = 1')))
  await setOffline(false)
  await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId)
  await sleep(400)
  // The next click is what asks the loader to try again; the one after it
  // copies the finished result. That click opens the check again, so it is
  // closed before the retry has a chance to land.
  await markToasts()
  await clickCopy()
  await closePreflight()
  check('the retry after a failed bundle renders the formula', await waitFor(previewSvg, 45000))
  await resetSinks()
  await markToasts()
  await clickCopy()
  check('... and the following copy carries the SVG', Boolean((await copies())[0]?.html?.includes('<svg')))

  console.log('\n=== a mermaid fence and a formula coexist ===')
  await setContent('$$\nE = mc^2\n$$\n\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n')
  await sleep(1800) // the rasterizer parks a fence for 1.2 s before it starts
  await resetSinks()
  await markToasts()
  await clickCopy()
  const midway = await preflight()
  check(
    'the copy waits while the diagram is still an image to be',
    Boolean(midway) && midway.items.some((i) => i === 'diagram-pending' || i === 'math-pending'),
    JSON.stringify(midway && midway.items),
  )
  check('nothing reaches the clipboard', (await copies()).length === 0)
  await closePreflight()
  const bothReady = await waitFor(`(${previewSvg}) && (${previewImg})`, 90000)
  check('the diagram becomes an image next to the formula', bothReady)
  await resetSinks()
  await markToasts()
  await clickCopy()
  // The diagram has no caption, which the renderer notes — a warning the author
  // acknowledges rather than a blocker. Nothing here is still unfinished, so
  // the note must not be able to hold the finished article back.
  const coexistNotes = await preflight()
  if (coexistNotes) {
    check(
      'the finished article only carries notes, no blockers',
      coexistNotes.items.length > 0 && coexistNotes.items.every((i) => i !== 'math-pending' && i !== 'diagram-pending' && i !== 'math-failed' && i !== 'diagram-failed'),
      JSON.stringify(coexistNotes.items),
    )
    check(
      'a note has to be acknowledged before the copy is allowed',
      coexistNotes.state === 'needs-ack' && coexistNotes.hasAck && coexistNotes.goDisabled === true,
      `${coexistNotes.state} / ack=${coexistNotes.hasAck} / disabled=${coexistNotes.goDisabled}`,
    )
    await preflightAck()
    const afterAck = await preflight()
    check('acknowledging the note turns the copy on', afterAck?.state === 'ready' && afterAck?.goDisabled === false, `${afterAck?.state} / disabled=${afterAck?.goDisabled}`)
    check('the acknowledged article copies without an override', (await preflightGo()) === 'clicked')
    await sleep(400)
  }
  const bothHtml = (await copies())[0]?.html ?? ''
  check(
    'the finished copy carries both the SVG and the diagram image',
    bothHtml.includes('<svg') && bothHtml.includes('<img'),
    `${bothHtml.length}B`,
  )
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
