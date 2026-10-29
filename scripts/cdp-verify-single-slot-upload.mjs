// Acceptance for sidebar single-image uploads.
//
// A sidebar row names one exact image slot, so clicking its 上传 / 替换 button
// must write into that slot and nowhere else. The editor's own paths (toolbar,
// drop, paste) have no slot and must keep inserting at the point they started.
// This script drives the shipped UI against a mock image worker:
//   - the clicked placeholder is filled in place, alt and surrounding text kept,
//     with the cursor at the end or in another paragraph;
//   - two placeholders sharing one caption fill only the one that was clicked;
//   - both auto-crop and hand-crop land in the clicked slot;
//   - a multi-file pick fills the single slot once, uploads only the first file,
//     and tells the author the rest were not uploaded;
//   - switching articles while the request is in flight writes into the article
//     that started it, not the open one;
//   - toolbar / paste / drop still insert at the position they started from, and
//     text typed while the upload is in flight survives;
//   - replacing an image that is already uploaded keeps one line.
//
// Brings its own in-memory image worker and a fresh SQLite database, so nothing
// reaches production R2 or the dev database. Uses data/audit-r06.db in the
// current worktree.
//
// Usage: node scripts/cdp-verify-single-slot-upload.mjs [appPort] [cdpPort] [workerPort]
// Worker defaults to appPort + 100 (4106 -> 4206), matching the audit port plan.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

// Everything here talks to 127.0.0.1, but this host exports a global HTTP proxy
// that would swallow those requests. Drop it for this process.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP_PORT = Number(process.argv[2] || 4106)
const CDP_PORT = Number(process.argv[3] || 9706)
const WORKER_PORT = Number(process.argv[4] || APP_PORT + 100)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const DB_FILE = path.resolve('data/audit-r06.db')
const ACCESS_KEY = 'single-slot-acceptance-key'
const ADMIN_KEY = 'single-slot-acceptance-admin'
const SESSION_SECRET = 'single-slot-acceptance-session-secret'
const SHOT_DIR = path.resolve('verify-out/single-slot-upload')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) })
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`)
}

function crcChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

/** A small real PNG so image decoding / cropping has bytes to work with. */
function makePng(width, height) {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      raw[o++] = (x * 255 / width) | 0
      raw[o++] = (y * 255 / height) | 0
      raw[o++] = 180
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', ihdr),
    crcChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    crcChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- mock image worker (in memory, same protocol as the real one) ----------
const objects = new Map()
let holdUploads = false
const heldUploads = []
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
      const reply = () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ key, size: body.length }))
      }
      if (holdUploads) heldUploads.push(reply)
      else reply()
    })
    return
  }
  if (url.pathname.startsWith('/img/')) {
    const obj = objects.get(decodeURIComponent(url.pathname.slice('/img/'.length)))
    if (!obj) { res.writeHead(404).end('missing'); return }
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
  try { fs.rmSync(DB_FILE + suffix, { force: true }) } catch { /* nothing to clear */ }
}
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/audit-r06.db',
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
    } catch { /* not listening yet */ }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP_PORT}\n${appLog.slice(-800)}`)
}

// ---------- headless Chrome ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'single-slot-'))
fs.mkdirSync(SHOT_DIR, { recursive: true })
let chrome = null
let ws = null
let send = null
let ev = null
let sessionId = null

try {
  await waitUp()

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' })

  let wsBase = ''
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) { wsBase = j.webSocketDebuggerUrl; break }
    } catch { /* not up yet */ }
    await sleep(250)
  }
  if (!wsBase) throw new Error('no CDP')

  let id = 1
  const pending = new Map()
  ws = new WebSocket(wsBase)
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  send = (method, params = {}, sid) => new Promise((resolve, reject) => {
    const i = id++
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 90000)
  })

  const target = await send('Target.createTarget', { url: 'about:blank' })
  sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('DOM.enable', {}, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('mopai.onboarding.v1', 'done') } catch {}`,
  }, sessionId)

  const consoleErrors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.sessionId !== sessionId) return
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text ?? 'exception'))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      consoleErrors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })

  ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }
  const waitFor = async (expression, ms, label) => {
    const deadline = Date.now() + ms
    let last = null
    while (Date.now() < deadline) {
      last = await ev(expression)
      if (last) return last
      await sleep(250)
    }
    throw new Error(`${label} never happened (last: ${JSON.stringify(last)})`)
  }
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(data, 'base64'))
  }
  const setFiles = async (selector, files) => {
    const { root } = await send('DOM.getDocument', {}, sessionId)
    const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector }, sessionId)
    if (!nodeIds.length) throw new Error(`no file input for ${selector}`)
    await send('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files }, sessionId)
  }
  /** Real mouse click: Radix menus need pointer events, not element.click(). */
  const clickElement = async (elementExpression, label) => {
    const coord = await ev(`(() => {
      const el = ${elementExpression}
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return null
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    })()`)
    if (!coord) throw new Error(`nothing to click for ${label}`)
    const { x, y } = JSON.parse(coord)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId)
  }
  const editorText = () => ev(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : ''`)
  const waitText = async (pred, timeout = 25000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const text = await editorText()
      if (text && pred(text)) return text
      await sleep(250)
    }
    throw new Error('the article text never matched ' + pred.toString())
  }
  const toasts = () => ev(`[...document.querySelectorAll('[data-sonner-toast]')].map(e => e.innerText)`)
  const waitNoToasts = async () => {
    for (let i = 0; i < 30; i++) {
      if (!(await ev(`document.querySelector('[data-sonner-toast]') !== null`))) return
      await sleep(400)
    }
  }
  const clickDialog = (matcher) => ev(`(() => {
    const btn = [...document.querySelectorAll('[role=dialog] button')].find(b => ${matcher})
    if (!btn) return 'no-button'
    if (btn.disabled) return 'disabled'
    btn.click()
    return 'clicked:' + btn.textContent.trim()
  })()`)
  const confirmDialog = async (label) => {
    await waitFor(
      `[...document.querySelectorAll('[role=dialog] button')].some(b => b.textContent.trim() === ${JSON.stringify(label)})`,
      15000,
      `dialog button ${label}`,
    )
    const r = await clickDialog(`b.textContent.trim() === ${JSON.stringify(label)}`)
    if (!String(r).startsWith('clicked')) throw new Error(`could not click ${label}: ${r}`)
    return r
  }
  const cachedBody = (name) => ev(`new Promise((resolve, reject) => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    const mine = index.docs.find(d => d.name === ${JSON.stringify(name)})
    if (!mine) { resolve(null); return }
    const open = indexedDB.open('mopai')
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('bodies', 'readonly').objectStore('bodies').get(mine.id)
      read.onsuccess = () => { resolve(read.result?.content || null); db.close() }
      read.onerror = () => reject(read.error)
    }
    open.onerror = () => reject(open.error)
  })`)
  const setDocName = (name) => ev(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    if (!input) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(name)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const setDoc = async (text, selection = 'end') => {
    await ev(`(() => {
      const v = window.__mopaiCodemirror
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} } })
      const t = v.state.doc.toString()
      let pos = t.length
      if (${JSON.stringify(selection)} === 'tail middle') pos = Math.max(0, t.indexOf('TAIL_MARKER') + 2)
      else if (${JSON.stringify(selection)} === 'before tail') pos = Math.max(0, t.indexOf('TAIL') - 2)
      else if (${JSON.stringify(selection)} === 'drop target') pos = Math.max(0, t.indexOf('DROP_TARGET') + 2)
      v.dispatch({ selection: { anchor: pos } })
      v.focus()
      return true
    })()`)
    await sleep(900)
  }
  /** Click a sidebar row's 上传 / 替换, hand it files, confirm the framing dialog. */
  const uploadRow = async (rowIndex, files, opts = {}) => {
    const clicked = await ev(`(() => {
      const row = [...document.querySelectorAll('aside li')][${rowIndex}]
      if (!row) return 'no-row'
      const btn = [...row.querySelectorAll('button')].find(b => /^(上传|替换)$/.test(b.textContent.trim()))
      if (!btn) return 'no-upload-button'
      btn.click()
      return btn.textContent.trim()
    })()`)
    if (clicked === 'no-row' || clicked === 'no-upload-button') throw new Error(`row upload: ${clicked}`)
    await sleep(300)
    await setFiles('aside input[type=file]', files)
    await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the framing dialog')
    await sleep(200)
    if (opts.extra) {
      const notices = await toasts()
      check('the author is told the extra file was not uploaded', notices.some((x) => /没有上传/.test(x)), JSON.stringify(notices))
    }
    if (opts.size) {
      const r = await clickDialog(`b.dataset.uploadSize === ${JSON.stringify(opts.size)}`)
      if (!String(r).startsWith('clicked')) throw new Error(`upload size ${opts.size}: ${r}`)
      await sleep(200)
    }
    if (opts.manual) {
      const r = await clickDialog(`b.textContent.includes('手动裁切')`)
      if (!String(r).startsWith('clicked')) throw new Error(`manual crop: ${r}`)
      await waitFor(
        `[...document.querySelectorAll('[role=dialog] button')].some(b => b.textContent.trim() === '用这块区域上传' && !b.disabled)`,
        20000,
        'the manual cropper',
      )
      await sleep(400)
      await confirmDialog('用这块区域上传')
      return
    }
    if (opts.ratio) {
      const r = await clickDialog(`b.textContent.trim() === ${JSON.stringify(opts.ratio)}`)
      if (r !== `clicked:${opts.ratio}`) throw new Error(`ratio ${opts.ratio}: ${r}`)
      await sleep(250)
      await confirmDialog('按这个比例上传')
      return
    }
    await confirmDialog('原样上传')
  }
  /** The editor's own file input: inserts at the cursor, no sidebar slot. */
  const uploadEditor = async (files) => {
    await setFiles('input[type=file][accept="image/*"]', files)
    await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the framing dialog')
    await sleep(200)
    await confirmDialog('原样上传')
  }
  const openSwitcher = async () => {
    await clickElement(`document.querySelector('[title="切换稿件"]')`, 'the article switcher')
    await waitFor(`document.querySelector('[role="menu"]') !== null`, 5000, 'the switcher menu')
  }
  const typeAtStart = (text) => ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, insert: ${JSON.stringify(text)} } })
    return true
  })()`)
  const pasteImage = (file) => ev(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(fs.readFileSync(file)))}).buffer], ${JSON.stringify(path.basename(file))}, { type: 'image/png' }))
    const target = document.querySelector('.cm-content')
    if (!target) return 'no-editor'
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    return true
  })()`)
  const dropImage = (file, marker) => ev(`(() => {
    const v = window.__mopaiCodemirror
    if (!v) return 'no-editor'
    const pos = v.state.doc.toString().indexOf(${JSON.stringify(marker)}) + 2
    const coords = v.coordsAtPos(pos)
    if (!coords) return 'no-coords'
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(fs.readFileSync(file)))}).buffer], ${JSON.stringify(path.basename(file))}, { type: 'image/png' }))
    v.contentDOM.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: coords.left + 2, clientY: coords.top + 2,
    }))
    return true
  })()`)

  await send('Page.navigate', { url: appUrl }, sessionId)
  await waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('aside')`, 30000, 'the editor')
  await sleep(1200)

  const fileDir = path.join(profile, 'files')
  fs.mkdirSync(fileDir, { recursive: true })
  const files = {
    a: path.join(fileDir, 'a.png'),
    b: path.join(fileDir, 'b.png'),
    wide: path.join(fileDir, 'wide.png'),
  }
  fs.writeFileSync(files.a, makePng(24, 18))
  fs.writeFileSync(files.b, makePng(18, 24))
  fs.writeFileSync(files.wide, makePng(80, 40))

  const waitHeldUpload = async () => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (heldUploads.length) return
      await sleep(100)
    }
    throw new Error('the upload never reached the mock worker')
  }
  const releaseUploads = () => {
    holdUploads = false
    for (const reply of heldUploads.splice(0)) reply()
  }

  console.log('\n=== the clicked placeholder is filled, wherever the cursor is ===')
  await setDoc('# Article\n\n![target]()\n\nTAIL_MARKER', 'end')
  const beforeEnd = await editorText()
  await uploadRow(0, [files.a], { size: 'original' })
  const filledEnd = await waitText((t) => t.includes('img:') && !t.includes('![target]()'))
  const originalObject = objects.get(filledEnd.match(/img:([^)]+)/)?.[1])
  check('Original uploads the selected PNG byte-for-byte', Boolean(originalObject?.body.equals(fs.readFileSync(files.a))))
  check('the end-of-document cursor does not move the write', /!\[target\]\(img:[^)]+\)/.test(filledEnd), filledEnd)
  check('no second image line is appended', (filledEnd.match(/!\[/g) || []).length === 1, filledEnd)
  check(
    'alt, position and surrounding text are untouched',
    filledEnd.replace(/img:[^)]+/, 'SRC') === beforeEnd.replace('![target]()', '![target](SRC)'),
    filledEnd,
  )
  check('the toast reports the slot was filled', (await toasts()).some((x) => /回填/.test(x)), JSON.stringify(await toasts()))

  console.log('\n=== the cursor in another paragraph changes nothing ===')
  await waitNoToasts()
  await setDoc('# Article\n\n![target]()\n\nTAIL_MARKER', 'tail middle')
  await uploadRow(0, [files.a])
  const filledMid = await waitText((t) => t.includes('img:') && !t.includes('![target]()'))
  check('the slot still receives the image', /!\[target\]\(img:[^)]+\)/.test(filledMid), filledMid)
  check('no image is inserted at the cursor', (filledMid.match(/!\[/g) || []).length === 1, filledMid)

  console.log('\n=== two placeholders with the same caption: the clicked one fills ===')
  await waitNoToasts()
  await setDoc('![same]()\n\nMID\n\n![same]()', 'end')
  await uploadRow(1, [files.b])
  const filledSame = await waitText((t) => t.includes('img:'))
  const sameLines = filledSame.split('\n')
  check('the second placeholder is the one filled', /^!\[same\]\(img:[^)]+\)$/.test(sameLines[4] ?? ''), JSON.stringify(sameLines))
  check('the first placeholder stays empty', sameLines[0] === '![same]()', JSON.stringify(sameLines[0]))
  check('only one image reference exists', (filledSame.match(/img:/g) || []).length === 1, filledSame)

  console.log('\n=== auto-crop lands in the clicked slot ===')
  await waitNoToasts()
  await setDoc('# Crop\n\n![target]()\n\nTAIL', 'end')
  await uploadRow(0, [files.wide], { ratio: '1:1' })
  const filledAuto = await waitText((t) => t.includes('img:') && !t.includes('![target]()'))
  check('the cropped upload fills the placeholder', /!\[target\]\(img:[^)]+\)/.test(filledAuto), filledAuto)
  check('no duplicate image line appears', (filledAuto.match(/!\[/g) || []).length === 1, filledAuto)
  const autoKey = filledAuto.match(/img:([^)]+)/)?.[1]
  const autoObject = objects.get(autoKey)
  const autoDimensions = await ev(`createImageBitmap(new Blob([new Uint8Array(${JSON.stringify(Array.from(autoObject.body))})], { type: ${JSON.stringify(autoObject.type)} })).then(img => ({ width: img.width, height: img.height }))`)
  check('the automatic 1:1 crop uploads square pixels', autoDimensions.width === 40 && autoDimensions.height === 40, JSON.stringify(autoDimensions))

  console.log('\n=== hand-crop lands in the clicked slot ===')
  await waitNoToasts()
  await setDoc('# Crop\n\n![target]()\n\nTAIL', 'end')
  await uploadRow(0, [files.wide], { manual: true })
  const filledManual = await waitText((t) => t.includes('img:') && !t.includes('![target]()'))
  check('the hand-cropped upload fills the placeholder', /!\[target\]\(img:[^)]+\)/.test(filledManual), filledManual)
  check('alt and trailing text survive', filledManual.includes('![target](') && filledManual.includes('TAIL'), filledManual)

  for (const [mode, opts] of [
    ['original', { size: 'original' }],
    ['automatic crop', { ratio: '1:1' }],
    ['manual crop', { manual: true }],
  ]) {
    console.log(`\n=== a multi-file ${mode} pick does not spill into the article ===`)
    await waitNoToasts()
    await setDoc('# Multi\n\n![target]()\n\nTAIL', 'end')
    const beforeCount = objects.size
    await uploadRow(0, [files.a, files.b], { ...opts, extra: true })
    const filledMulti = await waitText((t) => t.includes('img:'))
    await sleep(800)
    check('only the clicked slot receives an image', /^# Multi\n\n!\[target\]\(img:[^)]+\)\n\nTAIL$/.test(filledMulti), filledMulti)
    check('only one file reaches the image worker', objects.size - beforeCount === 1, `${objects.size - beforeCount} upload(s)`)
    if (mode === 'original') {
      const firstObject = objects.get(filledMulti.match(/img:([^)]+)/)?.[1])
      check('the first selected file is the uploaded one', Boolean(firstObject?.body.equals(fs.readFileSync(files.a))))
    }
  }

  console.log('\n=== sidebar uploads keep text typed while their reply is pending ===')
  await waitNoToasts()
  await setDoc('# Article\n\n![target]()\n\nTAIL', 'end')
  holdUploads = true
  await uploadRow(0, [files.a])
  await waitHeldUpload()
  await typeAtStart('SIDEBAR_TYPED\n\n')
  releaseUploads()
  const sidebarTyped = await waitText((t) => t.includes('img:'))
  check('the sidebar upload preserves newly typed text and the original slot', /^SIDEBAR_TYPED\n\n# Article\n\n!\[target\]\(img:[^)]+\)\n\nTAIL$/.test(sidebarTyped), sidebarTyped)

  console.log('\n=== switching articles mid-upload keeps the write in its article ===')
  await waitNoToasts()
  await setDoc('# Article\n\n![target]()\n\nA_TAIL', 'end')
  await setDocName('SLOT-A')
  holdUploads = true
  await uploadRow(0, [files.a])
  await waitHeldUpload()
  await waitFor(`document.querySelector('[role="dialog"]') === null`, 5000, 'the closed framing dialog')
  await openSwitcher()
  await clickElement(`[...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes('新建稿件'))`, 'new article')
  await waitText((t) => !t.includes('A_TAIL'))
  await setDoc('B_BODY')
  await setDocName('SLOT-B')
  await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('B_BODY')`, 10000, 'the second article')
  const pendingBody = await cachedBody('SLOT-A')
  check('the upload is still pending after switching to B', heldUploads.length === 1 && pendingBody?.includes('![target]()'), pendingBody)
  releaseUploads()
  let aBody = ''
  let bBody = ''
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    aBody = (await cachedBody('SLOT-A')) ?? ''
    bBody = (await cachedBody('SLOT-B')) ?? ''
    if (aBody.includes('img:') && bBody.includes('B_BODY')) break
    await sleep(500)
  }
  check('the upload lands in the article that started it', /!\[target\]\(img:[^)]+\)/.test(aBody), aBody)
  check('the article now open is left untouched', bBody === 'B_BODY', bBody)
  check('the originating article gets no extra placeholder', (aBody.match(/!\[/g) || []).length === 1, aBody)
  check('the author is told where the late image landed', (await toasts()).some((x) => /已写入/.test(x)), JSON.stringify(await toasts()))

  console.log('\n=== replacing an uploaded image keeps one line ===')
  await waitNoToasts()
  await setDoc('# Article\n\n![target](img:old-key)\n\nTAIL_MARKER', 'end')
  await uploadRow(0, [files.b])
  const replaced = await waitText((t) => t.includes('img:') && !t.includes('img:old-key'))
  check('the row writes its own image again', /!\[target\]\(img:(?!old-key)[^)]+\)/.test(replaced), replaced)
  check('no second image line is added', (replaced.match(/!\[/g) || []).length === 1, replaced)

  console.log('\n=== the toolbar path still inserts at the cursor ===')
  await waitNoToasts()
  await setDoc('# T\n\nSTART', 'end')
  await uploadEditor([files.a])
  const inserted = await waitText((t) => t.includes('img:'))
  check('the toolbar image lands after the cursor line', /START\n\n!\[a\]\(img:[^)]+\)/.test(inserted), inserted)

  console.log('\n=== text typed while the toolbar upload is in flight survives ===')
  await waitNoToasts()
  await setDoc('# T\n\nSTART', 'end')
  holdUploads = true
  await uploadEditor([files.a])
  await waitHeldUpload()
  await typeAtStart('TYPED_DURING\n\n')
  check('the text edit happened before the upload reply', heldUploads.length === 1 && !(await editorText()).includes('img:'))
  releaseUploads()
  const typedDuring = await waitText((t) => t.includes('img:') && t.includes('TYPED_DURING'))
  check('the typed text survives', typedDuring.startsWith('TYPED_DURING\n\n# T'), typedDuring)
  check('the image still lands at the start position', typedDuring.indexOf('img:') > typedDuring.indexOf('START'), typedDuring)

  console.log('\n=== a pasted image is inserted, not written into a slot ===')
  await waitNoToasts()
  await setDoc('# P\n\nBODY\n\nTAIL', 'before tail')
  const pasted = await pasteImage(files.a)
  check('the paste event reaches the editor', pasted === true, String(pasted))
  if (pasted === true) {
    await confirmDialog('原样上传')
    const pastedDoc = await waitText((t) => t.includes('img:'))
    check('the pasted image stays between BODY and TAIL', /BODY\n\n!\[a\]\(img:[^)]+\)\n+TAIL/.test(pastedDoc), pastedDoc)
    check('the body text survives', pastedDoc.includes('BODY') && pastedDoc.includes('TAIL'), pastedDoc)
  }

  console.log('\n=== a dropped image is inserted at the drop point ===')
  await waitNoToasts()
  await setDoc('# D\n\nDROP_TARGET\n\nTAIL', 'end')
  const dropped = await dropImage(files.a, 'DROP_TARGET')
  check('the drop event reaches the editor', dropped === true, String(dropped))
  if (dropped === true) {
    await confirmDialog('原样上传')
    const droppedDoc = await waitText((t) => t.includes('img:'))
    check('the dropped image stays between DROP_TARGET and TAIL', /DROP_TARGET\n\n!\[a\]\(img:[^)]+\)\n+TAIL/.test(droppedDoc), droppedDoc)
    check('the article text survives', droppedDoc.includes('DROP_TARGET') && droppedDoc.includes('TAIL'), droppedDoc)
  }

  await shot('final.png')
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  console.log(failures ? `\n${failures} CHECK(S) FAILED (${checks.length} total)` : `\nALL CHECKS PASSED (${checks.length} total)`)
  console.log(`screenshots in ${SHOT_DIR}`)
} catch (e) {
  failures++
  console.error('\nHARNESS ERROR:', e?.stack || e)
} finally {
  fs.writeFileSync(path.join(SHOT_DIR, 'result.json'), JSON.stringify({
    when: new Date().toISOString(), appPort: APP_PORT, cdpPort: CDP_PORT,
    workerPort: WORKER_PORT, database: DB_FILE, failures, checks, appLogTail: appLog.slice(-2000),
  }, null, 2))
  try { app.kill() } catch { /* ignore */ }
  try { chrome?.kill() } catch { /* ignore */ }
  try { ws?.close() } catch { /* ignore */ }
  worker.close()
  await sleep(300)
  process.exit(failures ? 1 : 0)
}
