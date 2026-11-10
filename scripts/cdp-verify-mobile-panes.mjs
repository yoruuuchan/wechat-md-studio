// Production-browser acceptance for the responsive editor. No production data
// or credentials.
//
// The editor now has three placements by window width:
//
//   * 1536 / 1280px: the original three draggable columns, no pane squeezed
//     below its minimum, with the article-name group and the save status
//     readable in the bar; the preview and sidebar can be dragged past their
//     old 820 / 520px caps (see cdp-verify-resize.mjs);
//   * 1100 / 960 / 768 / 700px: editor + preview side by side, the images and
//     settings column in a right-hand drawer that the compact top bar opens;
//     the drawer closes with its button, Escape or a click outside, and keeps
//     its selected tab and uploaded images while closed;
//   * 320 / 390 / 430px: one pane at a time behind the existing switcher.
//
// Every width must show no page-level horizontal scroll and no clipped or
// overlapping top-bar control. Phone pane switching and rotation keep the typed
// text, caret and scroll offset because the hidden panes stay mounted. The
// actions a phone visitor needs still complete end to end: copying into WeChat,
// importing a Markdown file, and framing/uploading an image. Dialogs fit the
// viewport, both languages and themes work, and a soft-keyboard-sized viewport
// keeps the article.
//
// Also captures the review screenshots (both preview modes at every required
// width, plus the open drawer at 768) and an index.html grouping them.
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
const longBody = Array.from({ length: 400 }, (_, i) => `第${i + 1}行内容，用来撑出滚动条，方便验证滚动位置。`).join('\n')
const fixtureContent = `# U03 A\n\nBASE_A\n\n${longBody}`
// The review screenshots use a short, presentable article instead of the 400
// scrolling lines the interaction checks need.
const captureDoc = `# 把日常写成值得收藏的卡片

在中等宽度的窗口里，编辑、预览和图片设置各得其所。

## 写作与排版

- 左边写 Markdown，右边即时看到公众号里的样子
- 图片与设置收进右侧抽屉，需要时再拉出来
- 分隔线可以随意拖动，版面跟着手感走

> 好的留白，让读者知道自己读到了哪里。

正文示例：记录真实的颜色、声音和人物，比堆砌形容词更能留下画面。

## 下一次出发

把生活写下来，再带着新的眼光出发。`

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
    // `inline:'nearest'`, never `center`: the editor page is an overflow-hidden
    // column, and scrollIntoView will happily scroll such a container sideways,
    // which then reports buttons as clipped on the left edge.
    const position = await evaluate(`(() => { const el=${expression}; if(!el) return null; el.scrollIntoView({block:'center',inline:'nearest'}); const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null })()`)
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
  // Wait for the previous Radix menu to finish closing before opening 更多 again;
  // an exit animation still in the DOM has zero-sized children, which used to
  // make the next language click report "no visible target".
  const openMore = async () => {
    await waitFor(`!document.querySelector('[role=menu]')`, 'previous More menu cleared', 5000).catch(() => {})
    await click(`document.querySelector('[data-topbar-more]')`)
    await waitFor(`(() => { const el = document.querySelector('[role=menu] [role=menuitem]'); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })()`, 'More menu settled')
    await sleep(150)
  }
  // At 390 the side panel is the third pane; the appearance controls moved from
  // 更多 into its 设置 tab.
  const openPhoneSettings = async () => {
    // A closing Radix menu still owns the pointer for an animation frame; a
    // stray click lands on a menu item (this used to open /materials).
    await waitFor(`!document.querySelector('[role=menu]')`, 'More menu cleared before settings', 5000).catch(() => {})
    await sleep(200)
    await click(`document.querySelector('[data-pane-tab="side"]')`)
    await waitFor(`getComputedStyle(document.querySelector('[data-pane="side"]')).visibility !== 'hidden'`, 'phone side pane visible')
    await click(`[...document.querySelectorAll('[data-pane="side"] [role=tab]')].find((el) => el.innerText.trim() === '设置')`)
    await waitFor(`!!document.querySelector('[data-settings-item="language"] [data-lang]')`, 'phone settings language control', 12000)
  }
  const chooseMode = async (mode) => {
    const pill = await evaluate(`!!document.querySelector('[data-topbar-mode-pill]')`)
    if (!pill) {
      await click(`document.querySelector('[data-preview-mode="${mode}"]')`)
      await waitFor(`document.querySelector('[data-preview-mode="${mode}"]')?.getAttribute('aria-pressed') === 'true'`, mode + ' preview selected')
      return
    }
    if ((await evaluate(`document.querySelector('[data-topbar-mode-pill]')?.dataset.mode`)) !== mode) {
      await click(`document.querySelector('[data-topbar-mode-pill]')`)
      await waitFor(`!!document.querySelector('[role=menu] [data-preview-mode="${mode}"]')`, 'phone mode menu')
      await click(`document.querySelector('[role=menu] [data-preview-mode="${mode}"]')`)
    }
    await waitFor(`document.querySelector('[data-topbar-mode-pill]')?.dataset.mode === ${JSON.stringify(mode)}`, mode + ' preview selected')
    await sleep(300)
  }
// Radix flips data-state before the slide animation finishes; measure the
// drawer only once its right edge has reached the viewport edge.
const drawerOpenSettled = () => waitFor(`(() => {
  const d = document.querySelector('[data-side-drawer]')
  if (!d || d.dataset.state !== 'open') return false
  const r = d.getBoundingClientRect()
  return r.width > 0 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5
})()`, 'drawer open and settled', 12_000)
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
    const visibleButtons = [...document.querySelectorAll('[data-topbar] button, [data-topbar] a')].filter((b) => b.getBoundingClientRect().width > 0)
    const buttons = visibleButtons.map((b) => { const r = b.getBoundingClientRect(); return { text: (b.innerText || b.title || '').trim().slice(0, 22), left: r.left, right: r.right, top: r.top, bottom: r.bottom } })
    // Two controls that overlap are as broken as one pushed off screen; the
    // desktop bar used to let the save-status button slide over the drafts
    // button when the header ran out of room. The phone bar has two rows, so
    // only boxes that also share vertical space count as an overlap.
    const sorted = [...buttons].sort((a, b) => a.left - b.left)
    const overlaps = []
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].right > sorted[i].left + 0.5 &&
          sorted[i - 1].bottom > sorted[i].top + 0.5 &&
          sorted[i].bottom > sorted[i - 1].top + 0.5) {
        overlaps.push(sorted[i - 1].text + ' x ' + sorted[i].text)
      }
    }
    const saveEl = document.querySelector('[data-save-status]')
    const sr = saveEl ? saveEl.getBoundingClientRect() : null
    const copyEl = document.querySelector('[data-onboarding="copy"]')
    const cr = copyEl ? copyEl.getBoundingClientRect() : null
    const drawerButton = document.querySelector('[data-open-side-panel]')
    const dr = drawerButton ? drawerButton.getBoundingClientRect() : null
    const drawer = document.querySelector('[data-side-drawer]')
    const drawerState = drawer ? {
      state: drawer.dataset.state,
      display: getComputedStyle(drawer).display,
      visible: getComputedStyle(drawer).display !== 'none' && getComputedStyle(drawer).visibility !== 'hidden',
      rect: (() => { const r = drawer.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } })(),
    } : null
    const sidebar = document.querySelector('[data-onboarding="sidebar"]')
    const tabs = [...document.querySelectorAll('[data-pane-tab]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.paneTab, w: Math.round(r.width), h: Math.round(r.height) } })
    const groups = [...document.querySelector('[data-topbar]').children].map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, left: r.left, right: r.right } }).filter((g) => g.w > 0)
    return {
      vw,
      mode: document.querySelector('[data-layout-mode]')?.dataset.layoutMode,
      overflow: document.documentElement.scrollWidth - vw,
      switcher: !!document.querySelector('[data-pane-switcher]'),
      narrowNote: !!document.querySelector('[data-narrow-note]'),
      paneDivs: document.querySelectorAll('[data-pane]').length,
      visiblePanes: panes.filter((p) => p.visible).map((p) => p.id),
      panesWithBox: panes.filter((p) => p.box).length,
      panels: [...document.querySelectorAll('[data-slot="resizable-panel"]')].map((el) => Math.round(el.getBoundingClientRect().width)),
      panelIds: [...document.querySelectorAll('[data-slot="resizable-panel"]')].map((el) => el.id),
      handles: document.querySelectorAll('[data-slot="resizable-handle"]').length,
      clipped: buttons.filter((b) => b.left < -0.5 || b.right > vw + 0.5).map((b) => b.text),
      overlaps,
      groups,
      save: sr ? { visible: sr.width > 0, w: Math.round(sr.width) } : null,
      copy: cr ? { visible: cr.width > 0, w: Math.round(cr.width), h: Math.round(cr.height), inside: cr.left >= -0.5 && cr.right <= vw + 0.5 } : null,
      drawerButton: dr ? { visible: dr.width > 0, inside: dr.left >= -0.5 && dr.right <= vw + 0.5 } : null,
      drawer: drawerState,
      sidebar: sidebar ? { visible: sidebar.getBoundingClientRect().width > 0, text: sidebar.innerText.trim() } : null,
      tabs,
      docText: window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : '',
    }
  })()`

  // ---------- 1. wide (>=1200): the original three columns ----------
  let wideSidebarText = ''
  for (const width of [1536, 1280]) {
    await setWidth(width, 900)
    const l = await evaluate(layoutProbe)
    check(`${width}px: wide layout shows editor | preview | sidebar`, l.mode === 'wide' && l.switcher === false && JSON.stringify(l.panelIds) === JSON.stringify(['editor', 'preview', 'sidebar']), JSON.stringify({ mode: l.mode, panels: l.panelIds }))
    check(`${width}px: three draggable columns with two handles`, l.panels.length === 3 && l.handles === 2, JSON.stringify({ panels: l.panels, handles: l.handles }))
    check(`${width}px: no column is squeezed below its minimum`, l.panels[0] >= 318 && l.panels[1] >= 378 && l.panels[2] >= 238, JSON.stringify(l.panels))
    check(`${width}px: no page-level horizontal scroll`, l.overflow <= 0, `overflow=${l.overflow}`)
    check(`${width}px: every visible bar control is fully on screen`, l.clipped.length === 0, l.clipped.join(', ') || 'none')
    check(`${width}px: no two bar controls overlap`, l.overlaps.length === 0, l.overlaps.join(', ') || 'none')
    check(`${width}px: the article-name group still has room in the bar`, l.groups[0].w > 0, JSON.stringify(l.groups))
    check(`${width}px: the save status is visible in the bar`, Boolean(l.save && l.save.visible), JSON.stringify(l.save))
    check(`${width}px: the copy button is fully on screen`, Boolean(l.copy && l.copy.visible && l.copy.inside), JSON.stringify(l.copy))
    check(`${width}px: the narrow pane stack and drawer are not rendered`, l.paneDivs === 0 && l.drawer === null, JSON.stringify({ paneDivs: l.paneDivs, drawer: l.drawer }))
    if (width === 1536) {
      // The first tab is the live theme picker now; let its tiles arrive so
      // the drawer comparison below sees the same settled text.
      await waitFor(`!!document.querySelector('[data-theme-quick]')`, 'theme picker settled', 20_000).catch(() => {})
      wideSidebarText = (await evaluate(layoutProbe)).sidebar?.text || ''
    }
    await screenshot(`desktop-${width}.png`)
  }

  // ---------- 2. medium (640–1199): editor + preview, drawer for the rest ----------
  for (const width of [1100, 960, 768, 700]) {
    await setWidth(width, 900)
    const l = await evaluate(layoutProbe)
    check(`${width}px: medium layout shows editor | preview`, l.mode === 'medium' && l.switcher === false && JSON.stringify(l.panelIds) === JSON.stringify(['editor', 'preview']), JSON.stringify({ mode: l.mode, panels: l.panelIds }))
    check(`${width}px: two columns with one handle and no sidebar column`, l.panels.length === 2 && l.handles === 1, JSON.stringify({ panels: l.panels, handles: l.handles }))
    check(`${width}px: panes stay above the 240 / 360px medium minimums`, l.panels[0] >= 238 && l.panels[1] >= 358, JSON.stringify(l.panels))
    check(`${width}px: no page-level horizontal scroll`, l.overflow <= 0, `overflow=${l.overflow}`)
    check(`${width}px: every visible bar control is fully on screen`, l.clipped.length === 0, l.clipped.join(', ') || 'none')
    check(`${width}px: no two bar controls overlap`, l.overlaps.length === 0, l.overlaps.join(', ') || 'none')
    check(`${width}px: the save status is visible in the bar`, Boolean(l.save && l.save.visible), JSON.stringify(l.save))
    check(`${width}px: the copy button is fully on screen`, Boolean(l.copy && l.copy.visible && l.copy.inside), JSON.stringify(l.copy))
    check(`${width}px: the drawer button is visible and fully on screen`, Boolean(l.drawerButton && l.drawerButton.visible && l.drawerButton.inside), JSON.stringify(l.drawerButton))
    check(`${width}px: the drawer starts closed`, l.drawer === null, JSON.stringify(l.drawer))
    check(`${width}px: the phone switcher and its note are not rendered`, l.paneDivs === 0 && l.switcher === false && l.narrowNote === false, JSON.stringify({ paneDivs: l.paneDivs, switcher: l.switcher, note: l.narrowNote }))
    await screenshot(`medium-${width}.png`)
  }

  // ---------- 3. 768px drawer: open, same content as the wide column, all
  // three close paths, and the selected tab survives close/reopen ----------
  await setWidth(768, 900)
  const drawerStart = await evaluate(layoutProbe)
  check('768px: the drawer starts closed', drawerStart.drawer === null, JSON.stringify(drawerStart.drawer))
  await click(`document.querySelector('[data-open-side-panel]')`)
  await drawerOpenSettled()
  await waitFor(`!!document.querySelector('[data-side-drawer] [data-theme-quick]')`, 'drawer theme picker settled', 20_000).catch(() => {})
  const drawerOpen = await evaluate(`(() => {
    const d = document.querySelector('[data-side-drawer]')
    const r = d.getBoundingClientRect()
    const aside = d.querySelector('[data-onboarding="sidebar"]')
    return {
      state: d.dataset.state,
      visible: getComputedStyle(d).display !== 'none',
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width },
      text: aside ? aside.innerText.trim() : '',
    }
  })()`)
  check(
    '768px: the drawer is open and fits fully inside the viewport',
    drawerOpen.visible === true && drawerOpen.rect.left >= -0.5 && drawerOpen.rect.right <= 768.5 && drawerOpen.rect.top >= -0.5 && drawerOpen.rect.bottom <= 900.5,
    JSON.stringify(drawerOpen.rect),
  )
  check('768px: the drawer contains the same right column as the wide layout', drawerOpen.text === wideSidebarText, `${drawerOpen.text.length} vs ${wideSidebarText.length} chars`)
  await click(`[...document.querySelectorAll('[data-side-drawer] [role=tab]')].find((el) => el.innerText.trim() === '设置')`)
  await waitFor(`[...document.querySelectorAll('[data-side-drawer] [role=tab][aria-selected=true]')].some((el) => el.innerText.trim() === '设置')`, 'drawer settings tab selected')
  check('768px: the settings tab renders inside the drawer', await evaluate(`!!document.querySelector('[data-side-drawer] [data-open-remote-mcp]')`))
  // Close path 1: the built-in close button.
  await click(`document.querySelector('[data-side-drawer] > button')`)
  const closedByButton = await waitFor(`!document.querySelector('[data-side-drawer]')`, 'drawer closes with its button').then(() => true).catch(() => false)
  check('768px: the close button closes the drawer', closedByButton)
  await click(`document.querySelector('[data-open-side-panel]')`)
  await drawerOpenSettled()
  const retained = await evaluate(`(() => {
    const d = document.querySelector('[data-side-drawer]')
    return {
      selected: [...d.querySelectorAll('[role=tab][aria-selected=true]')].map((el) => el.innerText.trim()),
      settings: !!d.querySelector('[data-open-remote-mcp]'),
    }
  })()`)
  check('768px: closing and reopening keeps the selected tab', retained.selected.includes('设置') && retained.settings === true, JSON.stringify(retained))
  // Close path 2: Escape.
  await escape()
  const closedByEscape = await waitFor(`!document.querySelector('[data-side-drawer]')`, 'drawer closes with Escape').then(() => true).catch(() => false)
  check('768px: Escape closes the drawer', closedByEscape)
  // Close path 3: a click outside, on the overlay.
  await click(`document.querySelector('[data-open-side-panel]')`)
  await drawerOpenSettled()
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 40, y: 450, button: 'left', buttons: 1, clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 40, y: 450, button: 'left', buttons: 0, clickCount: 1 })
  const closedByOutside = await waitFor(`!document.querySelector('[data-side-drawer]')`, 'drawer closes on outside click').then(() => true).catch(() => false)
  check('768px: clicking outside closes the drawer', closedByOutside)

  // ---------- 4. 768px card preview keeps the cover title visible ----------
  await click(`document.querySelector('[data-preview-mode="cards"]')`)
  await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true' && !!document.querySelector('.xhs-card')`, 'card layout ready', 20_000)
  const coverTitle = await evaluate(`(() => {
    const card = document.querySelector('.xhs-card[data-card-index="0"][data-card-kind="cover"]')
    if (!card) return { error: 'cover card missing' }
    const title = card.querySelector('h1')
    if (!title) return { error: 'cover title missing' }
    const c = card.getBoundingClientRect()
    const r = title.getBoundingClientRect()
    const cs = getComputedStyle(title)
    const scroller = card.closest('[data-card-scroller]')
    const s = scroller.getBoundingClientRect()
    return {
      text: (title.textContent || '').trim(),
      fontSize: parseFloat(cs.fontSize),
      visibility: cs.visibility,
      display: cs.display,
      opacity: parseFloat(cs.opacity),
      insideCard: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5,
      insideScroller: r.bottom > s.top + 1 && r.top < s.bottom - 1,
      width: r.width,
      height: r.height,
    }
  })()`)
  check(
    '768px: the card cover headline is visible and inside its card',
    !coverTitle.error && coverTitle.text.length > 0 && coverTitle.fontSize >= 18 && coverTitle.opacity > 0 && coverTitle.visibility === 'visible' && coverTitle.display !== 'none' && coverTitle.insideCard === true && coverTitle.insideScroller === true,
    JSON.stringify(coverTitle),
  )
  await screenshot('cards-768.png')
  await click(`document.querySelector('[data-preview-mode="wechat"]')`)
  await sleep(400)

  // ---------- 5. phone (<640): one pane, nothing clipped or overlapping ----------
  for (const width of [320, 390, 430]) {
    await setWidth(width)
    const l = await evaluate(layoutProbe)
    check(`${width}px: a pane switcher is shown and exactly one pane is visible`, l.mode === 'phone' && l.switcher === true && l.paneDivs === 3 && l.visiblePanes.length === 1, JSON.stringify({ mode: l.mode, switcher: l.switcher, visible: l.visiblePanes }))
    check(`${width}px: all three panes keep a layout box (so scroll and caret survive)`, l.panesWithBox === 3, `panesWithBox=${l.panesWithBox}`)
    check(`${width}px: no page-level horizontal scroll`, l.overflow <= 0, `overflow=${l.overflow}`)
    check(`${width}px: every visible bar control is fully on screen`, l.clipped.length === 0, l.clipped.join(', ') || 'none')
    check(`${width}px: no two bar controls overlap`, l.overlaps.length === 0, l.overlaps.join(', ') || 'none')
    check(`${width}px: the save status is visible in the bar`, Boolean(l.save && l.save.visible), JSON.stringify(l.save))
    check(`${width}px: the copy button is fully on screen`, Boolean(l.copy && l.copy.visible && l.copy.inside), JSON.stringify(l.copy))
    check(`${width}px: pane tabs are touch-sized`, l.tabs.length === 3 && l.tabs.every((t) => t.h >= 28 && t.w >= 48), JSON.stringify(l.tabs))
    check(`${width}px: the three-column group and the medium drawer are not rendered`, l.panels.length === 0 && l.handles === 0 && l.drawer === null, JSON.stringify({ panels: l.panels, handles: l.handles, drawer: l.drawer }))
    check(`${width}px: the phone-only note is present`, l.narrowNote === true)
    await screenshot(`narrow-${width}.png`)
  }

  // ---------- 6. exact tier boundaries: 1200 / 1199 and 640 / 639 ----------
  for (const [width, expected] of [[1200, 'wide'], [1199, 'medium'], [640, 'medium'], [639, 'phone']]) {
    await setWidth(width, 900)
    const l = await evaluate(layoutProbe)
    check(`${width}px: lands in the ${expected} tier`, l.mode === expected, `mode=${l.mode}`)
    check(`${width}px: no horizontal overflow or clipped bar control at the boundary`, l.overflow <= 0 && l.clipped.length === 0, JSON.stringify({ overflow: l.overflow, clipped: l.clipped }))
    if (expected === 'wide') check(`${width}px: the boundary still has three columns`, JSON.stringify(l.panelIds) === JSON.stringify(['editor', 'preview', 'sidebar']), JSON.stringify(l.panelIds))
    if (expected === 'medium') check(`${width}px: the boundary has two columns plus the drawer button`, JSON.stringify(l.panelIds) === JSON.stringify(['editor', 'preview']) && Boolean(l.drawerButton?.visible), JSON.stringify({ panels: l.panelIds, drawer: l.drawerButton }))
    if (expected === 'phone') check(`${width}px: the boundary has the single-pane switcher`, l.switcher === true && l.visiblePanes.length === 1, JSON.stringify({ switcher: l.switcher, visible: l.visiblePanes }))
  }

  // ---------- 7. switching panes keeps text, caret and scroll ----------
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

  // ---------- 8. rotation crosses from phone to medium and keeps the text ----------
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const rotated = await evaluate(`(() => ({
    mode: document.querySelector('[data-layout-mode]')?.dataset.layoutMode,
    switcher: !!document.querySelector('[data-pane-switcher]'),
    panels: [...document.querySelectorAll('[data-slot="resizable-panel"]')].map((p) => p.id),
    keeps: window.__mopaiCodemirror.state.doc.toString().includes('U03_MARK'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped: [...document.querySelectorAll('header button')].filter((b) => b.getBoundingClientRect().width > 0).filter((b) => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > window.innerWidth + 0.5 }).length,
  }))()`)
  check('landscape 844x390 switches to the medium two-column layout', rotated.mode === 'medium' && rotated.switcher === false && JSON.stringify(rotated.panels) === JSON.stringify(['editor', 'preview']), JSON.stringify(rotated))
  check('crossing into medium keeps the typed text', rotated.keeps === true, JSON.stringify(rotated))
  check('rotation leaves no horizontal scroll or clipped header button', rotated.overflow <= 0 && rotated.clipped === 0, JSON.stringify(rotated))
  await screenshot('rotated-844x390.png')
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const portrait = await evaluate(`(() => ({
    mode: document.querySelector('[data-layout-mode]')?.dataset.layoutMode,
    switcher: !!document.querySelector('[data-pane-switcher]'),
    keeps: window.__mopaiCodemirror.state.doc.toString().includes('U03_MARK'),
  }))()`)
  check('rotating back to portrait returns to the phone switcher with the text', portrait.mode === 'phone' && portrait.switcher === true && portrait.keeps === true, JSON.stringify(portrait))

  // ---------- 9. growing the window back to desktop rebuilds cleanly ----------
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const grew = await evaluate(`(() => ({
    panels: [...document.querySelectorAll('[data-slot="resizable-panel"]')].length,
    keeps: window.__mopaiCodemirror.state.doc.toString().includes('U03_MARK'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`)
  check('crossing back to desktop keeps the article text', grew.keeps === true && grew.panels === 3, JSON.stringify(grew))
  check('crossing back to desktop leaves no horizontal scroll', grew.overflow <= 0, `overflow=${grew.overflow}`)

  // ---------- 10. the actions a phone visitor needs still complete ----------
  await setWidth(390)
  await click(`document.querySelector('[data-onboarding="copy"]')`)
  const copyFeedback = await waitFor(`(() => {
    const b = document.querySelector('button[data-onboarding="copy"]')
    return b && b.dataset.copied === 'true' ? { copied: true, label: b.innerText.trim(), width: Math.round(b.getBoundingClientRect().width) } : null
  })()`, 'copy button confirmation',3000)
  const copied = await waitFor(`navigator.clipboard.readText().then((text) => text.includes('BASE_A'))`, 'copy reached the clipboard', 15_000).then(() => true).catch(() => false)
  const copyToast = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join(' | ')`)
  check('390px: copying the article actually reaches the clipboard', copied, `toast=${copyToast}`)
  check(
    '390px: the copy button confirms in place instead of a toast',
    copyFeedback?.copied === true && /已复制/.test(copyFeedback.label) && !/已复制/.test(copyToast),
    JSON.stringify({ copyFeedback, copyToast }),
  )

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

  // ---------- 11. dialogs open, sit inside the viewport and close ----------
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

  // ---------- 12. language and theme from the settings tab ----------
  await openMore()
  // The narrow bar keeps only the article name, the save status and the copy
  // button, so the owner sign-in entry moves in here; it still has to be
  // reachable. (The wording itself is asserted by the guest-save-guidance
  // suite, which owns the "owner sign-in" rename.)
  const accountEntry = await evaluate(`([...document.querySelectorAll('[role=menuitem]')].find((el) => el.textContent.includes('登录')) || {}).textContent || ''`)
  check('390px: the owner sign-in entry is reachable from the More menu', accountEntry.includes('登录'), accountEntry.trim() || 'not found')
  await escape()
  await openPhoneSettings()
  await evaluate(`document.querySelector('[data-settings-item="language"] [data-lang="en"]').click()`)
  await sleep(800)
  const afterEnglishState = await evaluate(`JSON.stringify({
    width: window.innerWidth,
    lang: document.documentElement.lang,
    layout: document.querySelector('[data-layout-mode]')?.dataset.layoutMode,
    path: location.pathname,
    paneTabs: [...document.querySelectorAll('[data-pane-tab]')].map((el) => ({ id: el.dataset.paneTab, text: el.innerText, w: Math.round(el.getBoundingClientRect().width), visibility: getComputedStyle(el).visibility })),
    switcher: !!document.querySelector('[data-pane-switcher]'),
    sideVisible: document.querySelector('[data-pane="side"]') ? getComputedStyle(document.querySelector('[data-pane="side"]')).visibility : null,
    sideTab: document.querySelector('[data-pane="side"] [role=tab][aria-selected=true]')?.innerText || null,
    settingsControls: document.querySelectorAll('[data-settings-item]').length,
    body: document.body.innerText.slice(0, 180),
  })`)
  console.log('  after English:', afterEnglishState)
  await screenshot('narrow-en-state-390.png')
  // The store notifies synchronously but React commits the new labels on its
  // next render; wait for the actual English pane label, not just a timeout.
  const englishLabels = await waitFor(
    `document.querySelector('[data-pane-tab="editor"]')?.innerText.trim() === 'Edit'`,
    'English pane labels',
    10000,
  ).then(() => true).catch(() => false)
  const english = await evaluate(`(() => ({ lang: document.documentElement.lang, tab: document.querySelector('[data-pane-tab="editor"]')?.innerText.trim() || '', overflow: document.documentElement.scrollWidth - window.innerWidth }))()`)
  check('390px: switching to English from the settings tab works', englishLabels && english.lang === 'en' && english.tab === 'Edit', JSON.stringify({ english, afterEnglishState }))
  check('390px: the English narrow layout does not overflow', english.overflow <= 0, `overflow=${english.overflow}`)
  const overflowEn = await evaluate(`(() => {
    const vw = window.innerWidth
    return [...document.querySelectorAll('header button')].filter((b) => b.getBoundingClientRect().width > 0).filter((b) => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5 }).map((b) => (b.innerText || b.title || '').trim().slice(0, 20))
  })()`)
  check('390px: no English header button is clipped', overflowEn.length === 0, overflowEn.join(', ') || 'none')
  await screenshot('narrow-en-390.png')
  const appearanceRadios = await evaluate(`document.querySelectorAll('[data-settings-item="appearance"] [role=radio]').length`)
  const dark = appearanceRadios === 3
    ? await evaluate(`(() => { document.querySelectorAll('[data-settings-item="appearance"] [role=radio]')[2].click(); return document.documentElement.classList.contains('dark') })()`)
    : false
  await sleep(300)
  check('390px: switching to the dark theme from the settings tab works', dark === true, `dark=${dark} radios=${appearanceRadios} state=${afterEnglishState}`)
  await screenshot('narrow-en-dark-390.png')
  if (appearanceRadios === 3) {
    await evaluate(`document.querySelector('[data-settings-item="appearance"] [role=radio][title="Light"]').click()`)
    await sleep(300)
  }
  await evaluate(`document.querySelector('[data-settings-item="language"] [data-lang="zh"]')?.click()`)
  await sleep(400)
  await click(`document.querySelector('[data-pane-tab="editor"]')`)

  // ---------- 13. keyboard operation of the switcher ----------
  await evaluate(`document.querySelector('[data-pane-tab="editor"]').focus()`)
  await press('ArrowRight', 'ArrowRight', 39)
  const afterArrow = await waitFor(`getComputedStyle(document.querySelector('[data-pane="preview"]')).visibility !== 'hidden'`, 'arrow key switched to preview', 8000).then(() => true).catch(() => false)
  check('390px: arrow keys move between panes', afterArrow)
  await evaluate(`document.querySelector('[data-pane-tab="side"]').focus()`)
  await press('Enter', 'Enter', 13)
  const afterEnter = await waitFor(`getComputedStyle(document.querySelector('[data-pane="side"]')).visibility !== 'hidden'`, 'Enter switched to the side pane', 8000).then(() => true).catch(() => false)
  check('390px: Enter activates the focused pane tab', afterEnter)
  await click(`document.querySelector('[data-pane-tab="editor"]')`)

  // ---------- 14. viewport shrink standing in for the soft keyboard ----------
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

  // ---------- 15. review screenshots: both previews at every tier width ----------
  // 390 is the required phone sample; the other widths are the ones the layout
  // brief names explicitly.
  const captureWidths = [1536, 1280, 1100, 960, 768, 700, 390]
  for (const width of captureWidths) {
    await setWidth(width, width === 390 ? 844 : 900)
    await evaluate(`(() => {
      const v = window.__mopaiCodemirror
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(captureDoc)} } })
      return true
    })()`)
    await sleep(700)
    if (width < 640) {
      await click(`document.querySelector('[data-pane-tab="preview"]')`)
      await waitFor(`getComputedStyle(document.querySelector('[data-pane="preview"]')).visibility !== 'hidden'`, 'phone preview visible for screenshots')
    }
    await waitFor(`document.querySelector('[data-topbar-mode-pill]')?.dataset.mode === 'wechat' || document.querySelector('[data-preview-mode="wechat"]')?.getAttribute('aria-pressed') === 'true'`, 'WeChat preview selected')
    await evaluate('document.fonts.ready.then(() => true)')
    await screenshot(`layout-${width}-wechat.png`)
    await chooseMode('cards')
    await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true' && !!document.querySelector('.xhs-card')`, 'cards ready for screenshot', 20_000)
    await evaluate('document.fonts.ready.then(() => true)')
    await sleep(400)
    await screenshot(`layout-${width}-cards.png`)
  }

  // The drawer's own review shot, on the required 768px width.
  await setWidth(768, 900)
  await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(captureDoc)} } })
    return true
  })()`)
  await sleep(700)
  await click(`document.querySelector('[data-open-side-panel]')`)
  await drawerOpenSettled()
  await sleep(400)
  await screenshot('layout-768-drawer.png')

  check('no page errors along the way', exceptions.length === 0 && consoleErrors.length === 0, { exceptions: exceptions.length, consoleErrors: consoleErrors.slice(0, 3) })
} catch (error) {
  check('script completed without throwing', false, error.stack || error.message)
} finally {
  if (ws) { try { ws.close() } catch { /* already closed */ } }
  await stop(app)
  await stop(chrome)
  if (worker.listening) await new Promise((resolve) => worker.close(resolve))
}

// The review page is plain static HTML next to the screenshots; verify-out/ is
// ignored, so it never enters the commit.
function writeReviewIndex() {
  const widths = [1536, 1280, 1100, 960, 768, 700, 390]
  const figure = (src, label) => {
    if (!fs.existsSync(path.join(output, src))) return ''
    return `<figure><img src="${src}" alt="${label}"><figcaption>${label}</figcaption></figure>`
  }
  const sections = widths.map((width) => {
    const drawer = width === 768 ? figure('layout-768-drawer.png', '768px · 抽屉打开') : ''
    return `<section><h2>${width}px</h2><div class="pair">
      ${figure(`layout-${width}-wechat.png`, `${width}px · 公众号预览`)}
      ${figure(`layout-${width}-cards.png`, `${width}px · 小红书卡片预览`)}
      ${drawer}
    </div></section>`
  }).join('\n')
  const html = `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<title>芦苇布局验收截图</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #f4f1ea; color: #2b2a26; font: 14px/1.5 "Noto Sans SC", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p.lead { margin: 0 0 28px; color: #6b675d; }
  section { margin: 0 0 36px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; align-items: start; }
  figure { margin: 0; background: #fff; border: 1px solid #ddd6c8; border-radius: 10px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { padding: 8px 12px; font-size: 12px; color: #6b675d; border-top: 1px solid #eee7da; }
</style>
<h1>芦苇 · 响应式编辑器布局</h1>
<p class="lead">每个宽度各一张公众号预览与小红书卡片预览；768px 另附抽屉打开状态。窗口高度 900px（390px 宽为 844px）。</p>
${sections}
</html>`
  fs.writeFileSync(path.join(output, 'index.html'), html)
}
writeReviewIndex()

const failed = checks.filter((c) => !c.passed)
const summary = {
  task: 'Responsive editor: wide three columns, medium two columns + drawer, phone single pane',
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
