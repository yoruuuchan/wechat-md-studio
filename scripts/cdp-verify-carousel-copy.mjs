// Acceptance for the carousel copy path, measured in a real browser.
//
// Three failures motivated this script:
//
//   1. Pasting the same article into the WeChat editor twice used to break the
//      carousel images. Before blaming the WeChat side, the clipboard payload
//      has to be provably stable: three consecutive full-article copies must
//      produce byte-identical text/html and text/plain, the ClipboardItem path
//      must be the one that runs, and no blob:/relative/img: source may leak.
//   2. The WeChat editor's layout check flags fixed pixel widths inside the
//      article as an overflow risk ("#1.4 width"). The carousel strip therefore
//      must contain no `width:<n>px` at all: slides take a percentage of the
//      strip, images take 100% of the slide, and the ratio rides on the
//      width/height attributes.
//   3. Every carousel slide must stay fetchable: absolute URLs, HEAD and GET,
//      sequential and under concurrency, byte-identical to what was uploaded.
//
// It also pins the geometry that makes the strip a carousel rather than a
// stack: one row, uniform slide widths, a genuinely scrollable strip, images at
// their crop ratio. Gallery cells and the single-image block are asserted in
// the same payload so the carousel fix cannot silently change them.
//
// Brings its own in-memory image worker and database; nothing reaches
// production. With MOPAI_CAROUSEL_URLS set (comma or newline separated), the
// same HEAD/GET/concurrency checks run against those URLs instead — that is the
// mode for checking the deployed site's real copy payload.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const APP_PORT = Number(process.argv[2] || 3232)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9362)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const ACCESS_KEY = 'carousel-copy-acceptance-key'
const ADMIN_KEY = 'carousel-copy-acceptance-admin'
const DB_FILE = path.resolve('data/test-carousel-copy.db')
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
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(new Array(w * 3).fill(0).map((_, i) => rgb[i % 3]))])
  const raw = Buffer.concat(new Array(h).fill(0).map(() => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- optional: checks against already-copied production URLs ----------
const externalUrls = (process.env.MOPAI_CAROUSEL_URLS || '')
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean)

async function checkUrls(label, urls) {
  console.log(`\n=== ${label}: GET / HEAD, sequential then parallel ===`)
  for (const url of urls) {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    check(`HEAD ${url.slice(0, 90)}`, head.status === 200 && /^image\//.test(head.headers.get('content-type') || ''),
      `${head.status} ${head.headers.get('content-type')}`)
    const get = await fetch(url, { redirect: 'follow' })
    const body = Buffer.from(await get.arrayBuffer())
    check(`GET  ${url.slice(0, 90)}`, get.status === 200 && body.length > 0,
      `${get.status} ${body.length}B`)
  }
  for (let round = 1; round <= 2; round++) {
    const results = await Promise.all(
      urls.map(async (u) => {
        try {
          const r = await fetch(u, { redirect: 'follow' })
          const b = await r.arrayBuffer()
          return r.status === 200 && b.byteLength > 0 ? 'ok' : `${r.status}`
        } catch (e) {
          return `net:${String(e).slice(0, 40)}`
        }
      }),
    )
    check(`round ${round}: ${urls.length} concurrent GETs all succeed`, results.every((r) => r === 'ok'),
      results.filter((r) => r !== 'ok').join(' '))
  }
}

if (externalUrls.length) {
  await checkUrls('deployed copy-payload URLs', externalUrls)
}

// ---------- mock image worker ----------
const objects = new Map()
const worker = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/upload') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) { res.writeHead(403).end('bad admin key'); return }
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
    if (!obj) { res.writeHead(404).end('missing'); return }
    res.writeHead(200, {
      'content-type': obj.type,
      'content-length': obj.body.length,
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    })
    res.end(req.method === 'HEAD' ? undefined : obj.body)
    return
  }
  res.writeHead(404).end('no route')
})
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// Seed: three 4:3, two 16:9, one 4:3 single, four 4:3 grid cells.
const SEEDS = [
  ['car-1.png', png(720, 540, [40, 110, 220])],
  ['car-2.png', png(720, 540, [220, 120, 40])],
  ['car-3.png', png(720, 540, [60, 170, 90])],
  ['car-4.png', png(960, 540, [140, 70, 200])],
  ['car-5.png', png(960, 540, [200, 60, 120])],
  ['single-1.png', png(720, 540, [90, 90, 90])],
  ['gal-1.png', png(720, 540, [200, 180, 40])],
  ['gal-2.png', png(720, 540, [30, 160, 200])],
  ['gal-3.png', png(720, 540, [180, 60, 60])],
  ['gal-4.png', png(720, 540, [70, 70, 180])],
]
for (const [key, body] of SEEDS) {
  await fetch(`http://127.0.0.1:${WORKER_PORT}/api/upload?key=${key}`, {
    method: 'PUT', headers: { 'x-admin-key': ADMIN_KEY, 'content-type': 'image/png' }, body,
  })
}
const seedBytes = new Map(SEEDS.map(([k, b]) => [k, b.length]))

const MARKDOWN =
  '# 轮播复制回归\n\n' +
  '开场段落，本篇覆盖两组轮播、一张单图和一个网格。\n\n' +
  ':::carousel 4:3 第一组轮播\n' +
  '![甲](img:car-1.png)\n![乙](img:car-2.png)\n![丙](img:car-3.png)\n' +
  ':::\n\n' +
  '![单图说明](img:single-1.png)\n\n' +
  ':::carousel 16:9 第二组轮播\n' +
  '![丁](img:car-4.png)\n![戊](img:car-5.png)\n' +
  ':::\n\n' +
  ':::gallery 2 4:3 网格\n' +
  '![庚](img:gal-1.png)\n![辛](img:gal-2.png)\n![壬](img:gal-3.png)\n![癸](img:gal-4.png)\n' +
  ':::\n'

// ---------- app server ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
try { fs.rmSync(DB_FILE, { force: true }) } catch { /* nothing to clear */ }
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/test-carousel-copy.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET: 'carousel-copy-acceptance-secret-7b3e',
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'carousel-copy-'))
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
  // A fresh profile would meet the first-run tour on the editor; this suite
  // drives the app as a returning visitor.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' }, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Browser.grantPermissions', {
    origin: `http://127.0.0.1:${APP_PORT}`,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    }
    return r.result.value
  }

  console.log('=== loading the article ===')
  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(3500)
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(MARKDOWN)} } })
  })()`)
  for (let i = 0; i < 60; i++) {
    const ready = await ev(`(() => {
      const imgs = [...document.querySelectorAll('div.px-1.py-6 img')]
      return imgs.length === 10 && imgs.every(i => i.complete && i.naturalWidth > 0)
    })()`)
    if (ready) break
    if (i === 59) throw new Error('the ten images never finished loading in the preview')
    await sleep(400)
  }
  console.log('  all ten images loaded in the preview')

  // Record what each copy actually hands to the clipboard, and that the
  // ClipboardItem path is the one that runs.
  await ev(`(() => {
    window.__copies = []
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
    window.__nativeExec = document.execCommand.bind(document)
    document.execCommand = (cmd, ...rest) => {
      const r = window.__nativeExec(cmd, ...rest)
      if (cmd === 'copy') window.__copies.push({ via: 'execCommand', ok: r })
      return r
    }
  })()`)

  console.log('\n=== three consecutive full-article copies ===')
  const domFingerprint = () => ev(`(() => {
    const host = document.querySelector('div.px-1.py-6')
    return JSON.stringify({
      len: host.innerHTML.length,
      imgs: [...host.querySelectorAll('img')].map(i => i.getAttribute('src') + '|' + i.getAttribute('style')).join(';'),
      strips: [...host.querySelectorAll('section')].filter(s => /overflow-x:auto/.test(s.getAttribute('style') || '')).map(s => s.outerHTML.length),
    })
  })()`)
  const fingerprintBefore = await domFingerprint()
  const copies = []
  for (let round = 1; round <= 3; round++) {
    const clicked = await ev(`(async () => {
      const btn = document.querySelector('button[data-onboarding=copy]')
      if (!btn) return 'no copy button'
      for (let i = 0; i < 30 && btn.innerText.trim() !== '复制到公众号'; i++) await new Promise(r => setTimeout(r, 200))
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      return 'clicked'
    })()`)
    if (clicked !== 'clicked') throw new Error(clicked)
    await sleep(1200)
    const rec = await ev(`(async () => {
      const r = window.__copies[window.__copies.length - 1] || null
      let readback = null
      try {
        const items = await navigator.clipboard.read()
        for (const it of items) {
          if (it.types.includes('text/html')) readback = await (await it.getType('text/html')).text()
        }
      } catch (e) { readback = 'read-failed: ' + String(e).slice(0, 60) }
      return JSON.stringify({ r, readback })
    })()`)
    const parsed = JSON.parse(rec)
    copies.push(parsed)
    console.log(`  copy #${round}: via=${parsed.r?.via} ok=${parsed.r?.ok} html=${parsed.r?.html?.length}B`)
  }
  const fingerprintAfter = await domFingerprint()
  check('copying leaves the preview DOM untouched', fingerprintBefore === fingerprintAfter)

  const htmls = copies.map((c) => c.r?.html ?? '')
  const plains = copies.map((c) => c.r?.plain ?? '')
  check('every copy went through the ClipboardItem path, not the fallback',
    copies.every((c) => c.r?.via === 'ClipboardItem' && c.r?.ok === true && c.r?.plain))
  check('three consecutive copies are byte-identical (text/html)',
    htmls[0] && htmls[0] === htmls[1] && htmls[0] === htmls[2],
    `lengths: ${htmls.map((h) => h.length).join('/')}`)
  check('three consecutive copies are byte-identical (text/plain)',
    plains[0] && plains[0] === plains[1] && plains[0] === plains[2])
  const readbacks = copies.map((c) => c.readback)
  check('what the OS clipboard holds is identical across copies',
    typeof readbacks[0] === 'string' && readbacks[0] === readbacks[1] && readbacks[0] === readbacks[2],
    typeof readbacks[0] === 'string' ? '' : String(readbacks[0]))

  const payload = htmls[0]
  const imgTags = [...payload.matchAll(/<img\b[^>]*>/g)].map((m) => m[0])

  console.log('\n=== the payload carries the contract ===')
  check('ten images in the payload (5 carousel + 1 single + 4 grid)', imgTags.length === 10, `${imgTags.length}`)
  check('no blob:/relative/img: sources anywhere',
    !/(src="blob:|src="(?!https?:)[^"]*"|src="img:)/.test(payload))
  const urls = imgTags.map((t) => t.match(/src="([^"]+)"/)?.[1] ?? '')
  const originRe = new RegExp(`^http://127\\.0\\.0\\.1:${APP_PORT}/api/img/[^/]+$`)
  check('every image URL is an absolute public URL on the app origin',
    urls.every((u) => originRe.test(u)), urls.find((u) => !originRe.test(u)) ?? '')

  // The strips: no fixed pixel width, percentage slides, 100% images.
  const strips = []
  const stripOpen = /<section style="margin:0;padding:0 0 6px;overflow-x:auto;white-space:nowrap;">/g
  let m
  while ((m = stripOpen.exec(payload)) !== null) {
    const from = m.index
    // The strip is followed by its caption paragraph, which carries 图N.
    const capIdx = payload.indexOf('<span leaf="">图', from)
    const strip = payload.slice(from, payload.lastIndexOf('</section>', capIdx) + '</section>'.length)
    strips.push(strip)
  }
  check('two carousel strips in the payload', strips.length === 2, `${strips.length}`)
  check('no width in px inside any strip', strips.every((s) => !/width\s*:\s*[^;"]*\d+px/i.test(s)),
    (strips.find((s) => /width\s*:\s*[^;"]*\d+px/i.test(s))?.match(/width\s*:\s*[^;"]*\d+px/i) || [''])[0])
  check('strips advertise horizontal scrolling',
    strips.every((s) => /overflow-x:auto;white-space:nowrap;/.test(s)))
  check('the dead -webkit-overflow-scrolling property is gone',
    !/-webkit-overflow-scrolling/.test(payload))
  const slideCounts = strips.map((s) => (s.match(/display:inline-block;vertical-align:top;width:88%/g) || []).length)
  check('slides size in percentages of the strip (3 + 2)', JSON.stringify(slideCounts) === '[3,2]',
    JSON.stringify(slideCounts))
  const carouselImgs = imgTags.filter((t) => /width="240" height="180"/.test(t) || /width="240" height="135"/.test(t))
  check('carousel images keep ratio attributes and 100% width',
    carouselImgs.length === 5 && carouselImgs.every((t) => /style="display:block;width:100%;height:auto;/.test(t)),
    `${carouselImgs.length}/5`)

  // Untouched neighbours.
  const single = imgTags.find((t) => t.includes('single-1.png')) ?? ''
  check('single image is unchanged: 100% width, no fixed-size attributes',
    /style="display:block;width:100%;height:auto;/.test(single) && !/width="\d+"/.test(single), single.slice(0, 120))
  const cells = [...payload.matchAll(/width:([\d.]+)%;display:inline-block/g)].map((x) => Number(x[1]))
  check('grid cells still use percentages', cells.length === 4 && cells.every((c) => c > 0 && c < 50), cells.join(','))

  console.log('\n=== image fetch stability (app route, redirects followed) ===')
  for (const u of urls) {
    const key = decodeURIComponent(u.split('/').pop())
    const head = await fetch(u, { method: 'HEAD', redirect: 'follow' })
    check(`HEAD ${key}`, head.status === 200 && head.headers.get('content-type') === 'image/png',
      `${head.status} ${head.headers.get('content-type')}`)
    const get = await fetch(u, { redirect: 'follow' })
    const body = Buffer.from(await get.arrayBuffer())
    check(`GET ${key} bytes match the upload`, get.status === 200 && body.length === seedBytes.get(key),
      `${get.status} ${body.length}/${seedBytes.get(key)}`)
  }
  for (let round = 1; round <= 2; round++) {
    const results = await Promise.all(urls.map(async (u) => {
      try {
        const r = await fetch(u, { redirect: 'follow' })
        const b = await r.arrayBuffer()
        return r.status === 200 && b.byteLength > 0 ? 'ok' : String(r.status)
      } catch (e) { return 'net:' + String(e).slice(0, 30) }
    }))
    check(`round ${round}: 10 concurrent GETs through the app route all succeed`,
      results.every((r) => r === 'ok'), results.filter((r) => r !== 'ok').join(' '))
  }

  console.log('\n=== strip geometry in the preview ===')
  const geo = await ev(`(() => {
    const strips = [...document.querySelectorAll('div.px-1.py-6 section')].filter(s => /overflow-x:auto/.test(s.getAttribute('style') || ''))
    if (strips.length !== 2) return JSON.stringify({ error: 'strips=' + strips.length })
    return JSON.stringify(strips.map((strip) => {
      const slides = [...strip.children]
      const rects = slides.map(s => s.getBoundingClientRect())
      const imgRects = slides.map(s => { const i = s.querySelector('img'); return i ? i.getBoundingClientRect() : null })
      const stripRect = strip.getBoundingClientRect()
      strip.scrollLeft = 60
      const scrolled = strip.scrollLeft
      strip.scrollLeft = 0
      return {
        stripW: Math.round(stripRect.width),
        slideW: rects.map(r => Math.round(r.width)),
        tops: rects.map(r => Math.round(r.top)),
        heights: imgRects.map(r => r ? Math.round(r.height) : 0),
        imgW: imgRects.map(r => r ? Math.round(r.width) : 0),
        scrollable: strip.scrollWidth > strip.clientWidth + 4,
        scrolledBy: scrolled,
      }
    }))
  })()`)
  const g = JSON.parse(geo)
  if (g.error) throw new Error('preview strips not found: ' + g.error)
  for (const [idx, s] of g.entries()) {
    const tag = idx === 0 ? '4:3 strip' : '16:9 strip'
    check(`${tag}: every slide on one line`, new Set(s.tops).size === 1, JSON.stringify(s.tops))
    check(`${tag}: uniform slide widths`, new Set(s.slideW).size === 1, JSON.stringify(s.slideW))
    check(`${tag}: slide is 88% of the strip`,
      Math.abs(s.slideW[0] - s.stripW * 0.88) <= 3, `${s.slideW[0]} vs ${Math.round(s.stripW * 0.88)}`)
    check(`${tag}: strip actually scrolls`, s.scrollable && s.scrolledBy > 10, `scrollable=${s.scrollable} moved=${s.scrolledBy}`)
    const ratio = idx === 0 ? 0.75 : 9 / 16
    check(`${tag}: images render at the crop ratio`,
      s.heights.every((h, i) => Math.abs(h / s.imgW[i] - ratio) < 0.02),
      s.heights.map((h, i) => (h / s.imgW[i]).toFixed(3)).join(','))
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const shotPath = path.join(SHOT_DIR, 'carousel-copy.png')
  fs.writeFileSync(shotPath, Buffer.from(data, 'base64'))
  console.log(`  screenshot: ${shotPath}`)
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
