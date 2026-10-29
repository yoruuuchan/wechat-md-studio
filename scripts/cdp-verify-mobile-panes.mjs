// Production-browser acceptance for U03. No production data or credentials.
//
// The narrow editor used to keep all three panes side by side: at 390px they
// measured roughly 202/116/70px and up to eleven header buttons were pushed
// past the right edge, the copy button among them. This script proves the fix:
//
//   * 320 / 390 / 430 / 768px show one pane at a time behind a switcher, with
//     no page-level horizontal scroll and no clipped header button or copy
//     button;
//   * 1025 / 1440px keep the three draggable columns, none squeezed below its
//     minimum;
//   * switching panes, and rotating the device, keep the same CodeMirror view:
//     the typed text, the caret and the scroll offset all survive, because the
//     hidden panes stay mounted and laid out;
//   * the actions a phone visitor actually needs still complete end to end:
//     copying into WeChat, importing a Markdown file, and framing/uploading an
//     image (which is the crop path);
//   * dialogs open on a narrow screen, sit fully inside the viewport and close;
//   * both languages and both themes work through the narrow "More" menu, the
//     pane tabs are touch-sized and keyboard-operable, and a viewport shrink
//     that stands in for the soft keyboard keeps the article and the layout.
//
// Usage: node scripts/cdp-verify-mobile-panes.mjs [appPort=4128] [cdpPort=9728] [outputDir]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]
const port = Number(process.argv[2] || 4128)
const cdpPort = Number(process.argv[3] || 9728)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-u03-'))
const output = path.resolve(process.argv[4] || path.join(temporary, 'evidence'))
fs.mkdirSync(output, { recursive: true })
const adminKey = randomBytes(24).toString('hex')
const accessKey = randomBytes(24).toString('hex')
const checks = []
const exceptions = []
const consoleErrors = []
const chooserQueue = []
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

// ---------- a real PNG fixture, so the framing dialog has something to crop ----------
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}
function makePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
const photoPath = path.join(temporary, 'u03-photo.png')
fs.writeFileSync(photoPath, makePng(240, 160, [200, 120, 90]))
const importPath = path.join(temporary, 'u03-import.md')
fs.writeFileSync(importPath, '# Imported U03\n\nIMPORT_MARK\n')

// ---------- mock image worker, same protocol as the real one ----------
const objects = new Map()
const worker = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/upload') {
    if (req.headers['x-admin-key'] !== adminKey) {
      res.writeHead(403).end('bad admin key')
      return
    }
    const key = url.searchParams.get('key') ?? ''
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ key, size: body.length }))
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

let app
let chrome
let ws
let appLog = ''
async function stop(child) {
  if (!child || child.exitCode !== null || typeof child.kill !== 'function') return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
}

// ---------- fixture: a long article so the editor really scrolls ----------
const longBody = Array.from({ length: 400 }, (_, i) => `第${i + 1}行内容，用来撑出滚动条，方便验证滚动位置。`).join('\\n')
const fixtureContent = `# U03 A\\n\\nBASE_A\\n\\n${longBody}`

try {
  await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: accessKey, SESSION_SECRET: randomBytes(32).toString('hex'),
      IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: adminKey,
      ANON_GC_ENABLED: 'false', PUBLIC_BASE_URL: origin,
      RESEND_API_KEY: '', RESEND_FROM: '', FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => { appLog += data })
  app.stderr.on('data', (data) => { appLog += data })
  let up = false
  for (let i = 0; i < 150; i++) {
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 25_000)
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
    // The import menu item calls input.click(); with interception on, that
    // arrives here as an event instead of a native dialog we cannot answer.
    if (message.method === 'Page.fileChooserOpened') {
      chooserQueue.push({ backendNodeId: message.params.backendNodeId, sessionId: message.sessionId })
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('DOM.enable')
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  await call('Page.setInterceptFileChooserDialog', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__u03Document=Math.random().toString(36);if(location.origin===${JSON.stringify(origin)}) {
      localStorage.setItem('mopai.onboarding.v1','done');
      if(!localStorage.getItem('u03-fixture')) {
        localStorage.setItem('mopai.lang.v1','zh');
        localStorage.setItem('mopai.theme.v1','akari');
        localStorage.setItem('mopai.sample.v1','1');
        localStorage.setItem('mopai.docs.v1',${JSON.stringify(JSON.stringify([{ id: 'u03-a', name: 'U03 A', content: fixtureContent, updatedAt: 1000, savedAt: null, deletedAt: null }]))});
        localStorage.setItem('mopai.active.v1','u03-a');
        localStorage.setItem('u03-fixture','1');
      }
    }`,
  })

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
    const position = await evaluate(`(() => { const el=${expression}; if(!el) return null; el.scrollIntoView({block:'center',inline:'center'}); const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null })()`)
    if (!position) throw new Error(`No visible click target: ${expression}`)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  const press = async (key, code, vk) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  }
  const escape = () => press('Escape', 'Escape', 27)
  const screenshot = async (name) => {
    await sleep(200)
    const result = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'))
  }
  const ready = () => waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-topbar]')`, 'editor readiness', 20_000)
  const setWidth = async (width, height = 844) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url: origin })
    await ready()
    await sleep(250)
  }
  /**
   * Radix dialogs zoom in from 95% and slide, so a rect read the moment the
   * content appears is a frame of the animation, not the resting layout. Wait
   * for two identical samples before believing the geometry.
   */
  const settledRect = async (selector, label, timeout = 10_000) => {
    const until = Date.now() + timeout
    let previous = null
    while (Date.now() < until) {
      const rect = await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return null; const r=el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height } })()`)
      if (rect && previous && Math.abs(rect.left - previous.left) < 0.5 && Math.abs(rect.right - previous.right) < 0.5 && Math.abs(rect.top - previous.top) < 0.5 && Math.abs(rect.bottom - previous.bottom) < 0.5) return rect
      previous = rect
      await sleep(200)
    }
    if (!previous) throw new Error(`${label}: no element for ${selector}`)
    return previous
  }
  const layoutProbe = `(() => {
    const vw = window.innerWidth
    const panes = [...document.querySelectorAll('[data-pane]')].map((el) => ({
      id: el.dataset.pane,
      visible: getComputedStyle(el).visibility !== 'hidden',
      box: el.getBoundingClientRect().width > 0,
    }))
    const visibleButtons = [...document.querySelectorAll('header button')].filter((b) => b.getBoundingClientRect().width > 0)
    const buttons = visibleButtons.map((b) => { const r = b.getBoundingClientRect(); return { text: (b.innerText || b.title || '').trim().slice(0, 22), left: r.left, right: r.right } })
    const copyEl = document.querySelector('[data-onboarding="copy"]')
    const cr = copyEl ? copyEl.getBoundingClientRect() : null
    const tabs = [...document.querySelectorAll('[data-pane-tab]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.paneTab, w: Math.round(r.width), h: Math.round(r.height) } })
    return {
      vw,
      overflow: document.documentElement.scrollWidth - vw,
      switcher: !!document.querySelector('[data-pane-switcher]'),
      paneDivs: document.querySelectorAll('[data-pane]').length,
      visiblePanes: panes.filter((p) => p.visible).map((p) => p.id),
      panesWithBox: panes.filter((p) => p.box).length,
      panels: [...document.querySelectorAll('[data-slot="resizable-panel"]')].map((el) => Math.round(el.getBoundingClientRect().width)),
      handles: document.querySelectorAll('[data-slot="resizable-handle"]').length,
      clipped: buttons.filter((b) => b.left < -0.5 || b.right > vw + 0.5).map((b) => b.text),
      copy: cr ? { visible: cr.width > 0, w: Math.round(cr.width), h: Math.round(cr.height), inside: cr.left >= -0.5 && cr.right <= vw + 0.5 } : null,
      tabs,
      docText: window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : '',
    }
  })()`

  // ---------- 1. narrow widths: one pane, nothing clipped ----------
  for (const width of [320, 390, 430, 768]) {
    await setWidth(width)
    const l = await evaluate(layoutProbe)
    check(`${width}px: a pane switcher is shown and exactly one pane is visible`, l.switcher === true && l.paneDivs === 3 && l.visiblePanes.length === 1, JSON.stringify({ switcher: l.switcher, visible: l.visiblePanes }))
    check(`${width}px: all three panes keep a layout box (so scroll and caret survive)`, l.panesWithBox === 3, `panesWithBox=${l.panesWithBox}`)
    check(`${width}px: no page-level horizontal scroll`, l.overflow <= 0, `overflow=${l.overflow}`)
    check(`${width}px: no header button is clipped`, l.clipped.length === 0, l.clipped.join(', ') || 'none')
    check(`${width}px: the copy button is fully on screen`, Boolean(l.copy && l.copy.visible && l.copy.inside), JSON.stringify(l.copy))
    check(`${width}px: pane tabs are touch-sized`, l.tabs.length === 3 && l.tabs.every((t) => t.h >= 28 && t.w >= 48), JSON.stringify(l.tabs))
    check(`${width}px: the three-column group is not rendered`, l.panels.length === 0 && l.handles === 0, JSON.stringify({ panels: l.panels, handles: l.handles }))
    await screenshot(`narrow-${width}.png`)
  }

  // ---------- 2. wide widths: the desktop three columns survive ----------
  for (const width of [1025, 1440]) {
    await setWidth(width, 900)
    const l = await evaluate(layoutProbe)
    check(`${width}px: three draggable columns`, l.switcher === false && l.panels.length === 3 && l.handles === 2, JSON.stringify({ panels: l.panels, handles: l.handles }))
    check(`${width}px: no column is squeezed below its minimum`, l.panels[0] >= 318 && l.panels[1] >= 378 && l.panels[2] >= 238, JSON.stringify(l.panels))
    check(`${width}px: no page-level horizontal scroll`, l.overflow <= 0, `overflow=${l.overflow}`)
    check(`${width}px: no header button is clipped`, l.clipped.length === 0, l.clipped.join(', ') || 'none')
    check(`${width}px: the narrow pane stack is not rendered`, l.paneDivs === 0, `paneDivs=${l.paneDivs}`)
    await screenshot(`desktop-${width}.png`)
  }

  // ---------- 3. switching panes keeps text, caret and scroll ----------
  await setWidth(390)
  const before = await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    window.__u03View = v
    v.dispatch({ changes: { from: v.state.doc.length, insert: '\\nU03_MARK' } })
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    const max = v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight
    v.scrollDOM.scrollTop = Math.min(600, max)
    return { len: v.state.doc.length, sel: v.state.selection.main.anchor, scroll: v.scrollDOM.scrollTop, max }
  })()`)
  check('390px: the fixture really scrolls', before.max > 200 && before.scroll > 0, JSON.stringify(before))
  await click(`document.querySelector('[data-pane-tab="preview"]')`)
  await waitFor(`getComputedStyle(document.querySelector('[data-pane="preview"]')).visibility !== 'hidden'`, 'preview pane visible')
  const away = await evaluate(`(() => { const v = window.__u03View; return { same: v === window.__mopaiCodemirror, len: v.state.doc.length, scroll: v.scrollDOM.scrollTop } })()`)
  check('390px: the editor view is the same object while the preview is up', away.same === true, JSON.stringify(away))
  check('390px: the editor keeps its text while hidden', away.len === before.len, `len=${away.len}`)
  await screenshot('pane-preview-390.png')
  await click(`document.querySelector('[data-pane-tab="editor"]')`)
  await waitFor(`getComputedStyle(document.querySelector('[data-pane="editor"]')).visibility !== 'hidden'`, 'editor pane visible')
  const after = await evaluate(`(() => {
    const v = window.__u03View
    return { same: v === window.__mopaiCodemirror, len: v.state.doc.length, text: v.state.doc.toString(), sel: v.state.selection.main.anchor, scroll: v.scrollDOM.scrollTop }
  })()`)
  check('390px: the same editor view comes back after the switch', after.same === true)
  check('390px: the typed text survived the panel switch', after.text.includes('U03_MARK') && after.len === before.len, `len=${after.len}`)
  check('390px: the caret survived the panel switch', after.sel === before.sel, `${after.sel} vs ${before.sel}`)
  check('390px: the scroll offset survived the panel switch', after.scroll === before.scroll, `${after.scroll} vs ${before.scroll}`)

  // ---------- 4. rotation keeps one mode and the same view ----------
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  const rotated = await evaluate(`(() => ({
    switcher: !!document.querySelector('[data-pane-switcher]'),
    same: window.__mopaiCodemirror === window.__u03View,
    keeps: window.__mopaiCodemirror.state.doc.toString().includes('U03_MARK'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped: [...document.querySelectorAll('header button')].filter((b) => b.getBoundingClientRect().width > 0).filter((b) => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > window.innerWidth + 0.5 }).length,
  }))()`)
  check('landscape 844x390 stays in the single-pane layout', rotated.switcher === true, JSON.stringify(rotated))
  check('rotation keeps the same editor view and the typed text', rotated.same === true && rotated.keeps === true, JSON.stringify(rotated))
  check('rotation leaves no horizontal scroll or clipped header button', rotated.overflow <= 0 && rotated.clipped === 0, JSON.stringify(rotated))
  await screenshot('rotated-844x390.png')

  // ---------- 5. growing the window back to desktop rebuilds cleanly ----------
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const grew = await evaluate(`(() => ({
    panels: [...document.querySelectorAll('[data-slot="resizable-panel"]')].length,
    keeps: window.__mopaiCodemirror.state.doc.toString().includes('U03_MARK'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`)
  check('crossing back to desktop keeps the article text', grew.keeps === true && grew.panels === 3, JSON.stringify(grew))
  check('crossing back to desktop leaves no horizontal scroll', grew.overflow <= 0, `overflow=${grew.overflow}`)

  // ---------- 6. the actions a phone visitor needs still complete ----------
  await setWidth(390)
  await click(`document.querySelector('[data-onboarding="copy"]')`)
  const copied = await waitFor(`navigator.clipboard.readText().then((text) => text.includes('BASE_A'))`, 'copy reached the clipboard', 15_000).then(() => true).catch(() => false)
  const copyToast = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join(' | ')`)
  check('390px: copying the article actually reaches the clipboard', copied, `toast=${copyToast}`)
  check('390px: the copy reports success', /复制|已|Copied/i.test(copyToast), copyToast)

  // import a Markdown file through the narrow "More" menu
  await click(`document.querySelector('[data-topbar-more]')`)
  await waitFor(`!!document.querySelector('[role=menu]')`, 'narrow More menu', 12_000)
  await click(`document.querySelector('[data-import="markdown"]')`)
  let chooser = null
  for (let i = 0; i < 100 && !chooser; i++) {
    chooser = chooserQueue.shift() ?? null
    if (!chooser) await sleep(100)
  }
  check('390px: the import menu item opens a file chooser', Boolean(chooser), chooser ? 'opened' : 'never opened')
  if (chooser) await call('DOM.setFileInputFiles', { files: [importPath], backendNodeId: chooser.backendNodeId })
  const imported = await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('IMPORT_MARK')`, 'imported Markdown opened in the editor', 15_000).then(() => true).catch(() => false)
  check('390px: importing a Markdown file completes on a narrow screen', imported, `docLen=${await evaluate('window.__mopaiCodemirror.state.doc.length')} toast=${await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join(' | ')`)}`)
  await screenshot('after-import-390.png')

  // frame + upload an image (the crop path) from the narrow layout
  const root = await call('DOM.getDocument', {})
  const { nodeIds } = await call('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' })
  await call('DOM.setFileInputFiles', { files: [photoPath], nodeId: nodeIds[nodeIds.length - 1] })
  await waitFor(`!!document.querySelector('[role=dialog] [data-upload-size]')`, 'image framing dialog', 15_000)
  const frameRect = await settledRect('[role=dialog]', 'image framing dialog')
  const dialogBox = await evaluate(`(() => {
    const dlg = document.querySelector('[role=dialog]')
    const rect = dlg.getBoundingClientRect()
    const buttons = [...dlg.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const br = b.getBoundingClientRect(); return { text: (b.innerText || b.title || '').trim().slice(0, 18), left: br.left, right: br.right, top: br.top, bottom: br.bottom } })
    return { vw: window.innerWidth, vh: window.innerHeight, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, clipped: buttons.filter((b) => b.left < -0.5 || b.right > window.innerWidth + 0.5 || b.top < -0.5 || b.bottom > window.innerHeight + 0.5).map((b) => b.text), cropButtons: buttons.filter((b) => (b.text || '').includes('→') || (b.text || '').includes('裁')).length }
  })()`)
  check('390px: the image framing dialog fits inside the viewport', frameRect.left >= -0.5 && frameRect.right <= 390.5 && frameRect.bottom <= 844.5, JSON.stringify(dialogBox))
  check('390px: no framing button is clipped', dialogBox.clipped.length === 0, dialogBox.clipped.join(', ') || 'none')
  await screenshot('framing-dialog-390.png')
  // Selecting a ratio and pressing the primary button auto-crops and uploads:
  // that is the crop path running to completion.
  const cropChip = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find((el) => (el.title || '').includes('裁成')); return b ? b.title : null })()`)
  check('390px: the framing dialog offers a crop ratio', typeof cropChip === 'string' && cropChip.length > 0, cropChip)
  await click(`[...document.querySelectorAll('[role=dialog] button')].find((el) => (el.title || '').includes('裁成'))`)
  await sleep(300)
  const uploadLabel = await evaluate(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find((el) => /上传/.test(el.innerText)); return b ? b.innerText.trim() : null })()`)
  await click(`[...document.querySelectorAll('[role=dialog] button')].find((el) => /上传/.test(el.innerText))`)
  const uploaded = await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('img:')`, 'cropped image inserted into the article', 25_000).then(() => true).catch(() => false)
  check('390px: cropping and uploading an image completes', uploaded, `button=${uploadLabel}; ref=${await evaluate(`(window.__mopaiCodemirror.state.doc.toString().match(/img:[^)]+/) || ['none'])[0]`)}`)

  // ---------- 7. dialogs open, sit inside the viewport and close ----------
  const dialogOpenClose = async (openExpr, label) => {
    // A dialog that is animating out leaves its overlay over the page for a
    // moment and would swallow the next click; wait for it to be gone first.
    await waitFor(`!document.querySelector('[role=dialog]')`, `${label}: previous dialog cleared`, 12_000).catch(() => {})
    await click(openExpr)
    await waitFor(`!!document.querySelector('[role=dialog]')`, `${label} opens`, 15_000)
    const rect = await settledRect('[role=dialog]', label)
    check(`${label} fits inside a 390px viewport`, rect.left >= -0.5 && rect.right <= 390.5 && rect.bottom <= 844.5, JSON.stringify(rect))
    await escape()
    const closed = await waitFor(`!document.querySelector('[role=dialog]')`, `${label} closes`, 12_000).then(() => true).catch(() => false)
    check(`${label} closes with Escape`, closed)
  }
  await click(`document.querySelector('[data-pane-tab="editor"]')`)
  await dialogOpenClose(`document.querySelector('[data-open-ai-writing]')`, 'the AI writing dialog')
  await click(`document.querySelector('[data-pane-tab="side"]')`)
  await waitFor(`getComputedStyle(document.querySelector('[data-pane="side"]')).visibility !== 'hidden'`, 'side pane visible')
  // The MCP entry lives on the side panel's settings tab, inside an "advanced" disclosure.
  await click(`[...document.querySelectorAll('[data-pane="side"] [role=tab]')].find((el) => el.innerText.trim() === '设置')`)
  await waitFor(`!!document.querySelector('[data-open-remote-mcp]')`, 'settings tab rendered', 12_000)
  await evaluate(`(() => { const d = [...document.querySelectorAll('[data-pane="side"] details')].find((el) => el.querySelector('[data-open-remote-mcp]')); if (d) d.open = true; return !!d })()`)
  await waitFor(`document.querySelector('[data-open-remote-mcp]').getBoundingClientRect().height > 0`, 'advanced MCP entry expanded', 12_000)
  await dialogOpenClose(`document.querySelector('[data-open-remote-mcp]')`, 'the single-document MCP dialog')

  // ---------- 8. language and theme through the narrow More menu ----------
  await click(`document.querySelector('[data-topbar-more]')`)
  await waitFor(`!!document.querySelector('[role=menu]')`, 'More menu for appearance')
  await click(`document.querySelector('[role=menu] [data-lang="en"]')`)
  await sleep(200)
  const english = await evaluate(`(() => ({ lang: document.documentElement.lang, tab: document.querySelector('[data-pane-tab="editor"]').innerText.trim(), overflow: document.documentElement.scrollWidth - window.innerWidth }))()`)
  check('390px: switching to English through the More menu works', english.lang === 'en' && english.tab === 'Edit', JSON.stringify(english))
  check('390px: the English narrow layout does not overflow', english.overflow <= 0, `overflow=${english.overflow}`)
  const overflowEn = await evaluate(`(() => {
    const vw = window.innerWidth
    return [...document.querySelectorAll('header button')].filter((b) => b.getBoundingClientRect().width > 0).filter((b) => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5 }).map((b) => (b.innerText || b.title || '').trim().slice(0, 20))
  })()`)
  check('390px: no English header button is clipped', overflowEn.length === 0, overflowEn.join(', ') || 'none')
  await screenshot('narrow-en-390.png')
  await click(`document.querySelector('[role=menu] button[title="Dark"]')`)
  await sleep(200)
  const dark = await evaluate(`document.documentElement.classList.contains('dark')`)
  check('390px: switching to the dark theme through the More menu works', dark === true, `dark=${dark}`)
  await screenshot('narrow-en-dark-390.png')
  await escape()
  await click(`document.querySelector('[data-topbar-more]')`)
  await waitFor(`!!document.querySelector('[role=menu]')`, 'More menu for language reset')
  await click(`document.querySelector('[role=menu] [data-lang="zh"]')`)
  await escape()

  // ---------- 9. keyboard operation of the switcher ----------
  await evaluate(`document.querySelector('[data-pane-tab="editor"]').focus()`)
  await press('ArrowRight', 'ArrowRight', 39)
  const afterArrow = await waitFor(`getComputedStyle(document.querySelector('[data-pane="preview"]')).visibility !== 'hidden'`, 'arrow key switched to preview', 8000).then(() => true).catch(() => false)
  check('390px: arrow keys move between panes', afterArrow)
  await evaluate(`document.querySelector('[data-pane-tab="side"]').focus()`)
  await press('Enter', 'Enter', 13)
  const afterEnter = await waitFor(`getComputedStyle(document.querySelector('[data-pane="side"]')).visibility !== 'hidden'`, 'Enter switched to the side pane', 8000).then(() => true).catch(() => false)
  check('390px: Enter activates the focused pane tab', afterEnter)
  await click(`document.querySelector('[data-pane-tab="editor"]')`)

  // ---------- 10. viewport shrink standing in for the soft keyboard ----------
  // By now the open article is the imported one and it carries an uploaded
  // image, so this also covers "an upload finished and the text is intact".
  const textBeforeShrink = await evaluate(`window.__mopaiCodemirror.state.doc.toString()`)
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 420, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const shrunk = await evaluate(`(() => {
    const vw = window.innerWidth
    const copy = document.querySelector('[data-onboarding="copy"]').getBoundingClientRect()
    return {
      overflow: document.documentElement.scrollWidth - vw,
      copyInside: copy.left >= -0.5 && copy.right <= vw + 0.5,
      text: window.__mopaiCodemirror.state.doc.toString(),
      switcher: !!document.querySelector('[data-pane-switcher]'),
    }
  })()`)
  check('a 390x420 viewport (keyboard-sized) keeps the article text', textBeforeShrink.length > 0 && shrunk.text === textBeforeShrink, `len=${shrunk.text.length} before=${textBeforeShrink.length}`)
  check('a keyboard-sized viewport keeps the uploaded image reference intact', shrunk.text.includes('img:'), (shrunk.text.match(/img:[^)]+/) || ['none'])[0])
  check('a keyboard-sized viewport keeps the copy button and the switcher on screen', shrunk.copyInside === true && shrunk.switcher === true, JSON.stringify(shrunk))
  check('a keyboard-sized viewport has no horizontal scroll', shrunk.overflow <= 0, `overflow=${shrunk.overflow}`)
  await screenshot('keyboard-shrunk-390.png')

  check('no page errors along the way', exceptions.length === 0 && consoleErrors.length === 0, { exceptions: exceptions.length, consoleErrors: consoleErrors.slice(0, 3) })
} catch (error) {
  check('script completed without throwing', false, error.stack || error.message)
} finally {
  if (ws) { try { ws.close() } catch { /* already closed */ } }
  await stop(app)
  await stop(chrome)
  if (worker.listening) await new Promise((resolve) => worker.close(resolve))
}

const failed = checks.filter((c) => !c.passed)
const summary = {
  task: 'U03 · narrow editor as a usable single-pane layout',
  checks,
  exceptions: exceptions.length,
  consoleErrors,
  output,
  result: failed.length === 0 ? 'PASS' : 'FAIL',
  failed: failed.map((c) => c.name),
}
fs.writeFileSync(path.join(output, 'u03-mobile-panes.json'), JSON.stringify(summary, null, 2))
console.log(`\n${summary.result} · ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) {
  console.log(`Failed: ${failed.map((c) => c.name).join('; ')}`)
  process.exitCode = 1
}