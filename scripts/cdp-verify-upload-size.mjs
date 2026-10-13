// Acceptance for the optional upload size on loose images ("上传大小").
//
// The unit tests pin the budgets; only the assembled UI can prove the rest:
//   - a standalone image's framing dialog offers 自动 / 1–5 MB / 原图, with 自动
//     preselected on a fresh browser;
//   - 自动 re-encodes and lands on the 2048px budget;
//   - a mid tier (2 MB) raises the pixel budget to 2560px — the tiers are real,
//     not labels;
//   - 原图 uploads the source file byte-for-byte (sha256 identical);
//   - the confirmed pick is remembered in mopai.settings.v1 and preselected on
//     the next dialog;
//   - an original over the server's per-image cap (20 MiB) is blocked in the
//     dialog with a warning before anything is sent, and switching to a tier
//     uploads the same file successfully;
//   - a carousel's dialog never shows the size row (cropping keeps the existing
//     pipeline).
//
// Brings its own in-memory image worker and a fresh app database, so nothing
// reaches production R2 or the dev database.
//
// Usage: node scripts/cdp-verify-upload-size.mjs [appPort] [cdpPort]
// Mirroring the other acceptance scripts: worker on appPort + 10.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
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

const APP_PORT = Number(process.argv[2] || 3233)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9357)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const ACCESS_KEY = 'upload-size-acceptance-key'
const ADMIN_KEY = 'upload-size-acceptance-admin'
const DB_FILE = path.resolve('data/test-upload-size.db')
const SHOT_DIR = path.resolve('verify-out/upload-size')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

function crcChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

/**
 * A big "photo" with four-bit per-pixel noise over a ramp. The noise keeps the
 * PNG large (deflate cannot compress it away) while a lossy re-encode lands far
 * below — exactly the camera-file situation the size tiers exist for. The
 * 2800px standard source is above both the 2048 and the 2560 pixel budgets, so
 * each mode's downscale is observable in the uploaded image's intrinsic width;
 * the 4200px one is over the server's 20 MiB per-image cap and exercises the
 * dialog's interception for oversized originals.
 */
const SRC_W = 2800
const SRC_H = 1800
const BIG_W = 4200
const BIG_H = 2400
function cameraPng(width, height) {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  let seed = 2463534242
  const rnd = () => {
    // xorshift32, quantised to 16 levels: still incompressible-ish, 4 bits/byte
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed & 0xf) * 16
  }
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      raw[o++] = (((x * 255) / width) | 0) ^ rnd()
      raw[o++] = (((y * 255) / height) | 0) ^ rnd()
      raw[o++] = rnd()
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

const srcPng = cameraPng(SRC_W, SRC_H)
const srcSha = crypto.createHash('sha256').update(srcPng).digest('hex')
console.log(`source photo: ${SRC_W}x${SRC_H} PNG, ${(srcPng.length / 1024 / 1024).toFixed(1)} MB, sha256 ${srcSha.slice(0, 12)}…`)

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const bigPng = cameraPng(BIG_W, BIG_H)
if (bigPng.length <= MAX_IMAGE_BYTES) {
  throw new Error(`the oversized fixture must exceed ${MAX_IMAGE_BYTES} bytes, got ${bigPng.length}`)
}
console.log(`oversized photo: ${BIG_W}x${BIG_H} PNG, ${(bigPng.length / 1024 / 1024).toFixed(1)} MB (cap ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`)

// ---------- mock image worker (in memory, same protocol as the real one) ----------
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

// ---------- app server ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
try { fs.rmSync(DB_FILE, { force: true }) } catch { /* nothing to clear */ }
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/test-upload-size.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET: 'upload-size-acceptance-session-secret',
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-size-'))
const PNG_FILE = path.join(profile, 'camera-photo.png')
fs.writeFileSync(PNG_FILE, srcPng)
const BIG_FILE = path.join(profile, 'camera-oversized.png')
fs.writeFileSync(BIG_FILE, bigPng)
let chrome = null

try {
  await waitUp()

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1600,900', 'about:blank',
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
  const consoleErrors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.sessionId !== sessionId) return
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(m.params?.exceptionDetails?.text ?? 'exception'))
    }
  })

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
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    const out = path.join(SHOT_DIR, file)
    fs.writeFileSync(out, Buffer.from(data, 'base64'))
    console.log(`  shot → ${out}`)
  }

  /** Point the given hidden file input at the camera PNG (last match in DOM order). */
  const setFiles = async (selector, files) => {
    const { root } = await send('DOM.getDocument', {}, sessionId)
    const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector }, sessionId)
    if (!nodeIds.length) throw new Error(`no file input for ${selector}`)
    await send('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files }, sessionId)
  }
  /** Click a button inside the open dialog whose label matches. */
  const clickDialog = async (label) => {
    const r = await ev(`(() => {
      const btn = [...document.querySelectorAll('[role=dialog] button')]
        .find((b) => ${label}.test(b.textContent))
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked:' + btn.textContent.trim()
    })()`)
    return r
  }
  /** Wait for the newest object the worker received since `before`. */
  const waitNewKey = async (before, ms, label) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      for (const k of objects.keys()) if (!before.has(k)) return k
      await sleep(300)
    }
    throw new Error(`${label}: nothing reached the image worker`)
  }
  /** Intrinsic size of the preview image for one uploaded key. */
  const waitImgDims = (key, label) =>
    waitFor(
      `(() => {
        const img = [...document.querySelectorAll('img')].find((i) => (i.getAttribute('src') || '').includes(${JSON.stringify(key)}))
        return img && img.complete && img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null
      })()`,
      30000,
      label,
    )
  const uploadSizeSetting = () =>
    ev(`(() => { try { return JSON.parse(localStorage.getItem('mopai.settings.v1') || '{}').uploadSize ?? null } catch { return null } })()`)

  console.log('\n=== a standalone image, fresh browser: 自动 by default ===')
  // The first-run tour also auto-starts on a fresh profile and would overlay the
  // UI; seed the seen flag before any app script runs.
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: `try { localStorage.setItem('mopai.onboarding.v1', 'done') } catch {}` },
    sessionId,
  )
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(3200)
  await waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('aside')`, 30000, 'the editor')

  // Three standalone placeholders give the sidebar three rows; the cursor stays
  // at the end of the document for the toolbar-path upload below.
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '![大图一]()\\n\\n![大图二]()\\n\\n![大图三]()\\n\\n' } })
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    return true
  })()`)
  await sleep(900)

  const clicked1 = await ev(`(() => {
    const rows = [...document.querySelectorAll('aside li')]
    const btn = rows[0] && [...rows[0].querySelectorAll('button')].find((b) => b.textContent.trim() === '上传')
    if (!btn) return 'no-upload-button'
    btn.click()
    return 'clicked'
  })()`)
  check('the sidebar offers 上传 for a pending standalone image', clicked1 === 'clicked', String(clicked1))
  await sleep(500)
  await setFiles('aside input[type=file]', [PNG_FILE])
  await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the framing dialog')

  const row = await ev(`(() => {
    const chips = [...document.querySelectorAll('[data-upload-size]')]
    const active = chips.find((c) => c.getAttribute('aria-pressed') === 'true')
    return { count: chips.length, labels: chips.map((c) => c.textContent.trim()), active: active?.dataset.uploadSize ?? null }
  })()`)
  check('the loose dialog offers exactly the seven size choices', row.count === 7, row.labels.join(' | '))
  check('自动 is preselected on a fresh browser', row.active === 'auto', String(row.active))
  await shot('loose-dialog-auto.png')

  const before1 = new Set(objects.keys())
  const confirmed1 = await clickDialog('/原样上传|按这个比例上传/')
  check('the dialog confirms the upload', String(confirmed1).startsWith('clicked'), String(confirmed1))
  const key1 = await waitNewKey(before1, 90000, 'the 自动 upload')
  const dims1 = await waitImgDims(key1, 'the 自动 preview')
  const obj1 = objects.get(key1)
  check('自动 re-encodes instead of uploading the source bytes', obj1.body.length < srcPng.length, `${(obj1.body.length / 1024 / 1024).toFixed(2)} MB vs ${(srcPng.length / 1024 / 1024).toFixed(2)} MB`)
  check('自动 lands on the 2048px pixel budget', dims1.w === 2048, `${dims1.w}x${dims1.h}`)
  check('the remembered default is still auto', (await uploadSizeSetting()) === 'auto', String(await uploadSizeSetting()))
  await shot('upload-auto.png')

  console.log('\n=== the toolbar path shares the setting: 2 MB raises the pixel budget ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    return true
  })()`)
  // The editor's own (non-aside) input; document order puts the sidebar's first.
  await setFiles('input[type=file][accept="image/*"]', [PNG_FILE])
  await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the toolbar-path dialog')
  const seeded = await ev(`(() => {
    const active = [...document.querySelectorAll('[data-upload-size]')].find((c) => c.getAttribute('aria-pressed') === 'true')
    return active?.dataset.uploadSize ?? null
  })()`)
  check('the toolbar dialog starts from the remembered choice', seeded === 'auto', String(seeded))
  const picked = await ev(`(async () => {
    const chip = document.querySelector('[data-upload-size="2"]')
    if (!chip) return 'no-chip'
    chip.click()
    await new Promise((r) => setTimeout(r, 150))
    return document.querySelector('[data-upload-size="2"]').getAttribute('aria-pressed')
  })()`)
  check('clicking 2 MB selects it', picked === 'true', String(picked))
  await shot('loose-dialog-2mb.png')

  const before2 = new Set(objects.keys())
  await clickDialog('/原样上传/')
  const key2 = await waitNewKey(before2, 90000, 'the 2 MB upload')
  const dims2 = await waitImgDims(key2, 'the 2 MB preview')
  check('2 MB raises the pixel budget to 2560px', dims2.w === 2560, `${dims2.w}x${dims2.h}`)
  check('the pick is remembered in mopai.settings.v1', (await uploadSizeSetting()) === '2', String(await uploadSizeSetting()))

  console.log('\n=== 原图 uploads the source file byte-for-byte ===')
  const clicked3 = await ev(`(() => {
    const rows = [...document.querySelectorAll('aside li')]
    const btn = rows[1] && [...rows[1].querySelectorAll('button')].find((b) => b.textContent.trim() === '上传')
    if (!btn) return 'no-upload-button'
    btn.click()
    return 'clicked'
  })()`)
  check('the second pending row offers 上传', clicked3 === 'clicked', String(clicked3))
  await sleep(500)
  await setFiles('aside input[type=file]', [PNG_FILE])
  await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the third dialog')
  const seeded3 = await ev(`(() => {
    const active = [...document.querySelectorAll('[data-upload-size]')].find((c) => c.getAttribute('aria-pressed') === 'true')
    return active?.dataset.uploadSize ?? null
  })()`)
  check('2 MB is preselected on the next upload', seeded3 === '2', String(seeded3))
  const picked3 = await ev(`(async () => {
    const chip = document.querySelector('[data-upload-size="original"]')
    if (!chip) return 'no-chip'
    chip.click()
    await new Promise((r) => setTimeout(r, 150))
    return document.querySelector('[data-upload-size="original"]').getAttribute('aria-pressed')
  })()`)
  check('clicking 原图 selects it', picked3 === 'true', String(picked3))
  await shot('loose-dialog-original.png')

  const before3 = new Set(objects.keys())
  await clickDialog('/原样上传/')
  const key3 = await waitNewKey(before3, 120000, 'the 原图 upload')
  const obj3 = objects.get(key3)
  const sha3 = crypto.createHash('sha256').update(obj3.body).digest('hex')
  check('原图 uploads the file untouched (sha256 identical)', sha3 === srcSha, `sha256 ${sha3.slice(0, 12)}… vs ${srcSha.slice(0, 12)}…`)
  check('原图 keeps the PNG type', obj3.type === 'image/png', obj3.type)
  const dims3 = await waitImgDims(key3, 'the 原图 preview')
  check('原图 keeps the source resolution', dims3.w === SRC_W && dims3.h === SRC_H, `${dims3.w}x${dims3.h}`)
  check('原图 is remembered for the next upload', (await uploadSizeSetting()) === 'original', String(await uploadSizeSetting()))
  await shot('upload-original.png')

  console.log('\n=== an oversized original is blocked in the dialog ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '![超限检查]()\\n\\n' } })
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    return true
  })()`)
  await sleep(900)
  // The remembered choice is 原图 from the section above, so the dialog opens
  // already flagged: the picked file is over the server's per-image cap.
  await setFiles('input[type=file][accept="image/*"]', [BIG_FILE])
  await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the oversized framing dialog')
  const blocked = await ev(`(() => {
    const warn = document.querySelector('[data-upload-size-warning]')
    const active = [...document.querySelectorAll('[data-upload-size]')].find((c) => c.getAttribute('aria-pressed') === 'true')
    const confirm = [...document.querySelectorAll('[role=dialog] button')].find((b) => /原样上传/.test(b.textContent))
    return {
      active: active?.dataset.uploadSize ?? null,
      warn: warn ? warn.textContent.trim() : null,
      confirmDisabled: confirm ? confirm.disabled : null,
    }
  })()`)
  check('原图 is preselected and flagged as impossible', blocked.active === 'original' && !!blocked.warn, JSON.stringify(blocked))
  check(
    'the warning names the file size and the cap',
    String(blocked.warn).includes('20 MB') && /\b2\d(\.\d)? MB\b/.test(String(blocked.warn)),
    String(blocked.warn),
  )
  check('confirm is blocked while 原图 is selected', blocked.confirmDisabled === true, String(blocked.confirmDisabled))
  await shot('loose-dialog-over-limit.png')

  const unblocked = await ev(`(async () => {
    document.querySelector('[data-upload-size="5"]').click()
    await new Promise((r) => setTimeout(r, 150))
    const confirm = [...document.querySelectorAll('[role=dialog] button')].find((b) => /原样上传/.test(b.textContent))
    return {
      warn: !!document.querySelector('[data-upload-size-warning]'),
      confirmDisabled: confirm ? confirm.disabled : null,
    }
  })()`)
  check(
    'switching to 5 MB clears the warning and re-enables the upload',
    unblocked.warn === false && unblocked.confirmDisabled === false,
    JSON.stringify(unblocked),
  )

  const beforeBig = new Set(objects.keys())
  await clickDialog('/原样上传/')
  const keyBig = await waitNewKey(beforeBig, 240000, 'the 5 MB upload of the oversized file')
  const objBig = objects.get(keyBig)
  check(
    'the compressed result is far under the cap',
    objBig.body.length < MAX_IMAGE_BYTES,
    `${(objBig.body.length / 1024 / 1024).toFixed(2)} MB vs cap ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
  )
  const dimsBig = await waitImgDims(keyBig, 'the oversized-file preview')
  check('5 MB scales the 4200px source onto the 4096px budget', dimsBig.w === 4096, `${dimsBig.w}x${dimsBig.h}`)
  check('the tier pick is remembered too', (await uploadSizeSetting()) === '5', String(await uploadSizeSetting()))

  console.log('\n=== a carousel dialog never offers the size row ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ':::carousel 4:3 验收\\n![甲]()\\n![乙]()\\n:::\\n' } })
    return true
  })()`)
  await sleep(1200)
  const clickedC = await ev(`(() => {
    const rows = [...document.querySelectorAll('aside li')]
    for (const row of rows) {
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '上传')
      if (btn) { btn.click(); return 'clicked' }
    }
    return 'no-upload-button'
  })()`)
  check('a carousel slide offers 上传', clickedC === 'clicked', String(clickedC))
  await sleep(500)
  await setFiles('aside input[type=file]', [PNG_FILE])
  await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the carousel dialog')
  const carouselDialog = await ev(`(() => ({
    sizeChips: document.querySelectorAll('[data-upload-size]').length,
    title: document.querySelector('[role=dialog] h2, [role=dialog] [id$=title]')?.textContent ?? document.querySelector('[role=dialog]')?.innerText.slice(0, 40) ?? '',
    ratioCells: [...document.querySelectorAll('[role=dialog] button')].filter((b) => /^\\d+:\\d+$/.test(b.textContent.trim())).length,
  }))()`)
  check('no size row in a carousel dialog', carouselDialog.sizeChips === 0, JSON.stringify(carouselDialog))
  check('the carousel framing choice is still there', carouselDialog.ratioCells === 5, String(carouselDialog.ratioCells))
  const cancelled = await clickDialog('/取消/')
  check('the carousel dialog cancels cleanly', String(cancelled).startsWith('clicked'), String(cancelled))
  await shot('carousel-dialog.png')

  console.log('\n=== the dialog renders in English too ===')
  await ev(`localStorage.setItem('mopai.lang.v1', 'en')`)
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(3000)
  await waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('aside')`, 30000, 'the editor (en)')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '![English check]()\\n\\n' } })
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    return true
  })()`)
  await sleep(900)
  // Toolbar path: no button text to match, the hidden input opens the dialog.
  await setFiles('input[type=file][accept="image/*"]', [PNG_FILE])
  await waitFor(`!!document.querySelector('[role=dialog]')`, 15000, 'the English framing dialog')
  const en = await ev(`(() => {
    const dialog = document.querySelector('[role=dialog]')
    const chips = [...document.querySelectorAll('[data-upload-size]')]
    return {
      label: dialog?.innerText.includes('Upload size') ?? false,
      count: chips.length,
      first: chips[0]?.textContent.trim() ?? '',
      last: chips[chips.length - 1]?.textContent.trim() ?? '',
      active: chips.find((c) => c.getAttribute('aria-pressed') === 'true')?.dataset.uploadSize ?? null,
      tip: dialog?.innerText.includes('Original skips compression') ?? false,
      confirm: [...(dialog?.querySelectorAll('button') ?? [])].some((b) => /Upload as-is/.test(b.textContent)),
    }
  })()`)
  check('the English dialog labels the row and its choices', en.label && en.count === 7 && en.first.includes('Auto') && en.last === 'Original', JSON.stringify(en))
  check('the English tip and confirm button render', en.tip && en.confirm, JSON.stringify(en))
  check('the remembered 5 MB choice carries across the reload', en.active === '5', String(en.active))
  await shot('loose-dialog-en.png')
  await clickDialog('/Cancel/')

  // ------------------------------------------------------- console hygiene
  const knownNoise = /Line decoration ranges must be zero-length/
  const realErrors = consoleErrors.filter((e) => !knownNoise.test(e))
  console.log(`\n  console: ${consoleErrors.length} error(s), ${consoleErrors.length - realErrors.length} known CodeMirror decoration noise`)
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | ').slice(0, 300))
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
