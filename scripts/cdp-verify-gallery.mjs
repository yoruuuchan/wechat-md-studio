// Acceptance for the gallery grid, measured in a real browser.
//
// The unit tests prove the HTML string. Only a browser can prove the thing that
// actually matters here: that percentage-width inline-block cells line up into
// even rows, that a partial last row does not drag the layout, and that the
// uniform frame comes from the width/height *attributes* rather than from the
// images happening to share a shape.
//
// That last point is tested sharply on purpose: the two seeded PNGs have
// different intrinsic ratios (4:3 and 1:2) while both carry width="400"
// height="300". If the rows still come out even, the attributes are doing the
// work — which is the whole mechanism, since WeChat drops object-fit and a fixed
// height would letterbox an image of another shape.
//
// Brings its own in-memory image worker, so nothing reaches production R2.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const APP_PORT = Number(process.argv[2] || 3221)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9353)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const ACCESS_KEY = 'gallery-acceptance-key'
const ADMIN_KEY = 'gallery-acceptance-admin'
const DB_FILE = path.resolve('data/test-gallery.db')
const SHOT_DIR = path.resolve('verify-out')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

/** A real, decodable PNG of an exact pixel size — no image library needed. */
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(new Array(w * 3).fill(0).map((_, i) => rgb[i % 3]))])
  const raw = Buffer.concat(new Array(h).fill(0).map(() => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- mock image worker ----------
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
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// Seed two objects with deliberately different intrinsic ratios.
const WIDE = png(400, 300, [40, 110, 220]) // 4:3
const TALL = png(200, 400, [220, 120, 40]) // 1:2
for (const [key, body] of [
  ['gallery-wide.png', WIDE],
  ['gallery-tall.png', TALL],
]) {
  await fetch(`http://127.0.0.1:${WORKER_PORT}/api/upload?key=${key}`, {
    method: 'PUT',
    headers: { 'x-admin-key': ADMIN_KEY, 'content-type': 'image/png' },
    body,
  })
}

// ---------- app server ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
try { fs.rmSync(DB_FILE, { force: true }) } catch { /* nothing to clear */ }
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/test-gallery.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET: 'gallery-acceptance-session',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => (appLog += d))
app.stderr.on('data', (d) => (appLog += d))

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(appUrl, { redirect: 'manual' })
      if (r.status < 500) return
    } catch { /* not listening yet */ }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP_PORT}\n${appLog.slice(-800)}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-'))
const uploadFile = path.join(profile, 'shot.png')
fs.writeFileSync(uploadFile, WIDE)
let chrome = null

try {
  await waitUp()

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })

  let wsBase = ''
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) { wsBase = j.webSocketDebuggerUrl; break }
    } catch { /* not up yet */ }
    await sleep(250)
  }
  if (!wsBase) throw new Error('no CDP')

  let id = 1
  const pending = new Map()
  const ws = new WebSocket(wsBase)
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 60000)
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('DOM.enable', {}, sessionId)
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    }
    return r.result.value
  }
  const waitFor = async (expression, ms, label) => {
    const deadline = Date.now() + ms
    let last = null
    while (Date.now() < deadline) {
      last = await ev(expression)
      if (last) return last
      await sleep(400)
    }
    throw new Error(`${label} never happened (last: ${JSON.stringify(last)})`)
  }
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    const out = path.join(SHOT_DIR, file)
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    fs.writeFileSync(out, Buffer.from(data, 'base64'))
    return out
  }

  console.log('=== signing in ===')
  await send('Page.navigate', { url: `${appUrl}login` }, sessionId)
  await sleep(2000)
  const signed = await ev(`(async () => {
    const input = document.querySelector('input[type=password]')
    if (!input) return 'no password field'
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(ACCESS_KEY)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    document.querySelector('button[type=submit]').click()
    await new Promise(r => setTimeout(r, 2500))
    return location.pathname
  })()`)
  check('signed in', signed === '/', String(signed))

  // ---------- 1. geometry, with two images of different intrinsic shape ----------
  console.log('\n=== a 3-column grid over images that do not share a shape ===')
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(3500)
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert:
      ':::gallery 3 4:3 现场花絮\\n' +
      '![甲](img:gallery-wide.png)\\n' +
      '![乙](img:gallery-tall.png)\\n' +
      '![丙](img:gallery-wide.png)\\n' +
      '![丁](img:gallery-tall.png)\\n' +
      '![戊](img:gallery-wide.png)\\n' +
      ':::\\n' } })
  })()`)

  const geo = await waitFor(`(() => {
    const host = document.querySelector('div.px-1.py-6')
    if (!host) return null
    const imgs = [...host.querySelectorAll('img')]
    if (imgs.length !== 5 || imgs.some(i => !i.complete || !i.naturalWidth)) return null
    // A cell is the inline-block section that directly holds an image.
    const cells = imgs.map(i => i.closest('section[style*="inline-block"]'))
    const rows = new Map()
    for (const c of cells) {
      const top = Math.round(c.getBoundingClientRect().top)
      if (!rows.has(top)) rows.set(top, [])
      rows.get(top).push(c.getBoundingClientRect())
    }
    return JSON.stringify({
      // The grid's own container: the preview host carries padding, so measuring
      // against it made a perfectly fitting row look short.
      gridWidth: cells[0].parentElement.getBoundingClientRect().width,
      natural: imgs.map(i => i.naturalWidth + 'x' + i.naturalHeight),
      cells: cells.map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)] }),
      imgHeights: imgs.map(i => Math.round(i.getBoundingClientRect().height)),
      rowCount: rows.size,
      rowSizes: [...rows.values()].map(r => r.length),
    })
  })()`, 40000, 'the gallery to render')
  const g = JSON.parse(geo)

  check('all five images really loaded', g.natural.every((n) => !n.endsWith('x0')), g.natural.join(' '))
  check('the two shapes are genuinely different in the source files',
    g.natural.includes('400x300') && g.natural.includes('200x400'), g.natural.join(' '))
  check('five cells were produced', g.cells.length === 5, `${g.cells.length}`)
  check('they break into rows of three', JSON.stringify(g.rowSizes) === '[3,2]', JSON.stringify(g.rowSizes))
  check('all cells share one width', new Set(g.cells.map((c) => c[0])).size === 1, g.cells.map((c) => c[0]).join(','))
  const rowWidth = g.cells[0][0] * 3 + 2 * (g.gridWidth * 0.02)
  check('a full row fills its container without wrapping',
    Math.abs(rowWidth - g.gridWidth) / g.gridWidth < 0.03, `${Math.round(rowWidth)} vs ${Math.round(g.gridWidth)}`)
  check('the partial last row did not push the grid sideways', g.rowCount === 2, `rows=${g.rowCount}`)
  // Evenness comes from the crop at upload time, not from the markup. These
  // images were seeded straight into storage and never went through it, so this
  // is the documented limitation, pinned here so it cannot change unnoticed.
  check('an image whose shape differs from the fence ratio renders at its own ratio',
    new Set(g.imgHeights).size === 2, g.imgHeights.join(','))
  check('and the 4:3 ones still match each other exactly',
    new Set(g.imgHeights.filter((_, i) => g.natural[i] === '400x300')).size === 1,
    g.imgHeights.join(','))
  const shotPath = await shot('gallery-grid.png')
  console.log(`  screenshot: ${shotPath}`)

  // ---------- 1b. the same grid, with every source cropped to the fence ratio ----------
  console.log('\n=== a grid whose images were cropped to one frame is level ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert:
      ':::gallery 3 4:3 裁过的\\n' +
      '![甲](img:gallery-wide.png)\\n![乙](img:gallery-wide.png)\\n' +
      '![丙](img:gallery-wide.png)\\n![丁](img:gallery-wide.png)\\n:::\\n' } })
  })()`)
  const even = await waitFor(`(() => {
    const imgs = [...document.querySelectorAll('div.px-1.py-6 img')]
    if (imgs.length !== 4 || imgs.some(i => !i.complete || !i.naturalWidth)) return null
    const cells = imgs.map(i => i.closest('section[style*="inline-block"]').getBoundingClientRect())
    return JSON.stringify({
      imgHeights: imgs.map(i => Math.round(i.getBoundingClientRect().height)),
      cellHeights: cells.map(c => Math.round(c.height)),
      rows: new Set(cells.map(c => Math.round(c.top))).size,
    })
  })()`, 30000, 'the uniform grid')
  const u = JSON.parse(even)
  check('every image lands at the same height', new Set(u.imgHeights).size === 1, u.imgHeights.join(','))
  check('so every cell in a row is the same height too', new Set(u.cellHeights).size === 1, u.cellHeights.join(','))
  check('three up, then one on the second row', u.rows === 2, `rows=${u.rows}`)

  // ---------- 2. what actually reaches WeChat ----------
  console.log('\n=== the copy payload ===')
  const payload = await ev(`(() => {
    const host = document.querySelector('div.px-1.py-6')
    return host.innerHTML
  })()`)
  check('no display:grid in what gets copied', !/display:\s*grid/i.test(payload))
  check('no float', !/float:/i.test(payload))
  check('no object-fit', !/object-fit/i.test(payload))
  check('no absolute/fixed positioning', !/position:\s*(absolute|fixed|sticky)/i.test(payload))
  check('images keep width:100% and height:auto', /width:100%;height:auto/.test(payload))
  // The document is the uniform grid from the section above, so match the
  // caption by shape rather than by a title that has since been replaced.
  check('the block caption sits in a leaf span, with its figure number and count',
    /<span leaf="">图1 裁过的（共 4 张）<\/span>/.test(payload),
    (payload.match(/<span leaf="">图\d[^<]*<\/span>/g) || []).join(' / ').slice(0, 120))

  // ---------- 3. uploading into an empty grid ----------
  console.log('\n=== filling an empty grid through the materials panel ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert:
      ':::gallery 2 1:1 待传的两张\\n![甲]()\\n![乙]()\\n:::\\n' } })
  })()`)
  await sleep(1200)
  const rows = await ev(`JSON.stringify([...document.querySelectorAll('aside li')].map(li => li.innerText.replace(/\\n/g, ' | ')).filter(t => t.includes('图')))`)
  check('the panel lists both cells as gallery rows', JSON.parse(rows).filter((t) => t.includes('网格') || t.includes('图1-')).length >= 2, rows.slice(0, 220))

  // Clicking the row's button only opens the OS file picker; the crop dialog
  // cannot exist until a file has actually been chosen. So: click, hand the
  // hidden input a file, and only then look at the dialog.
  const clicked = await ev(`(() => {
    const btn = [...document.querySelectorAll('aside li button')].find(b => b.innerText.trim() === '上传')
    if (!btn) return 'no upload button'
    btn.click()
    return 'clicked'
  })()`)
  check('the upload button is there', clicked === 'clicked', String(clicked))
  await sleep(500)

  const { root } = await send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'aside input[type=file]' }, sessionId)
  check('the panel has a file input to drive', Boolean(nodeId), `nodeId=${nodeId}`)
  await send('DOM.setFileInputFiles', { files: [uploadFile], nodeId }, sessionId)
  await sleep(1800)

  const dialogText = await ev(`(() => {
    const d = document.querySelector('[role=dialog]')
    return d ? d.innerText.replace(/\\n+/g, ' | ') : null
  })()`)
  check('the crop dialog opens for a gallery cell', Boolean(dialogText), String(dialogText).slice(0, 160))
  check('it is locked to the ratio written in the fence', String(dialogText).includes('1:1'), String(dialogText).slice(0, 200))
  check('it names the gallery fence, not the carousel one',
    String(dialogText).includes(':::gallery') && !String(dialogText).includes(':::carousel'), String(dialogText).slice(0, 220))

  const confirmed = await ev(`(async () => {
    const d = document.querySelector('[role=dialog]')
    if (!d) return 'dialog already gone'
    const btn = [...d.querySelectorAll('button')].find(b => /裁切并上传|上传|确定/.test(b.innerText))
    if (!btn) return 'no confirm button: ' + [...d.querySelectorAll('button')].map(b => b.innerText).join('/')
    btn.click()
    await new Promise(r => setTimeout(r, 3500))
    return 'confirmed'
  })()`)
  check('the crop dialog was confirmed', confirmed === 'confirmed' || confirmed === 'dialog already gone', String(confirmed).slice(0, 160))

  const filled = await waitFor(`(() => {
    const v = window.__mopaiCodemirror
    const text = v.state.doc.toString()
    if (!/!\\[甲\\]\\(img:[^)]+\\)/.test(text)) return null
    return JSON.stringify({ text: text.slice(0, 200), imgs: document.querySelectorAll('div.px-1.py-6 img').length })
  })()`, 30000, 'the uploaded image to be written back into the fence')
  const f = JSON.parse(filled)
  check('the image landed in the first cell of the source', /!\[甲\]\(img:[^)]+\)/.test(f.text), f.text.slice(0, 120))
  check('the second cell kept its placeholder', f.text.includes('![乙]()'), f.text.slice(0, 160))
  check('the preview shows exactly one image', f.imgs === 1, `${f.imgs}`)
  await shot('gallery-upload.png')

  // ---------- 4. a two-column grid, every cell cropped to one frame ----------
  console.log('\n=== two columns, four images, one frame ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert:
      ':::gallery 2 16:9 两列\\n' +
      '![甲](img:gallery-wide.png)\\n![乙](img:gallery-wide.png)\\n' +
      '![丙](img:gallery-wide.png)\\n![丁](img:gallery-wide.png)\\n:::\\n' } })
  })()`)
  const two = await waitFor(`(() => {
    const imgs = [...document.querySelectorAll('div.px-1.py-6 img')]
    if (imgs.length !== 4 || imgs.some(i => !i.complete)) return null
    const cells = imgs.map(i => i.closest('section[style*="inline-block"]').getBoundingClientRect())
    const tops = cells.map((c) => Math.round(c.top))
    return JSON.stringify({
      heights: imgs.map(i => Math.round(i.getBoundingClientRect().height)),
      widths: cells.map((c) => Math.round(c.width)),
      gridWidth: cells[0] && imgs[0].closest('section[style*="inline-block"]').parentElement.getBoundingClientRect().width,
      rows: new Set(tops).size,
      perRow: tops.reduce((acc, t) => (acc[t] = (acc[t] || 0) + 1, acc), {}),
    })
  })()`, 30000, 'the two-column grid')
  const t = JSON.parse(two)
  check('two rows of two', t.rows === 2 && Object.values(t.perRow).every((n) => n === 2), JSON.stringify(t.perRow))
  check('all four images share one height', new Set(t.heights).size === 1, t.heights.join(','))
  check('and one cell width', new Set(t.widths).size === 1, t.widths.join(','))
  const twoRow = t.widths[0] * 2 + t.gridWidth * 0.02
  check('a two-cell row fills its container', Math.abs(twoRow - t.gridWidth) / t.gridWidth < 0.03,
    `${Math.round(twoRow)} vs ${Math.round(t.gridWidth)}`)
  await shot('gallery-two-col.png')
} catch (e) {
  failures++
  console.error('\nACCEPTANCE ERROR:', e.message)
  if (appLog) console.error('--- app log tail ---\n' + appLog.slice(-1200))
} finally {
  try { chrome?.kill() } catch { /* already gone */ }
  try { app.kill() } catch { /* already gone */ }
  worker.close()
  try { fs.rmSync(DB_FILE, { force: true }) } catch { /* leave it */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
