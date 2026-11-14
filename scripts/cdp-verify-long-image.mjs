// Real Chrome acceptance for the long-image mode. Run after npm run build:
// node scripts/cdp-verify-long-image.mjs [appPort=3295] [cdpPort=9405]
// Owns only this worktree's test-long-cdp.db, a local photo/template server and
// a fresh Chrome profile. No private asset and no external page is visited.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import JSZip from 'jszip'

const port = Number(process.argv[2] || 3295)
const cdpPort = Number(process.argv[3] || 9405)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const workerOrigin = `http://127.0.0.1:${workerPort}`
const output = path.resolve('verify-out/long', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(output, { recursive: true })
const exportsDir = path.join(output, 'exports')
fs.mkdirSync(exportsDir, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-long-'))
const checks = []
const errors = []
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), detail })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
await Promise.all([port, cdpPort, workerPort].map(freePort))

// ---- placeholder photos ----------------------------------------------------
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
}
const PALETTE = [[52, 118, 174], [101, 148, 94], [196, 137, 74], [147, 106, 158], [70, 143, 150], [176, 94, 87], [92, 116, 166], [133, 128, 74]]
function drawDigit(raw, w, h, digit, x, y, scale, color) {
  const glyph = GLYPHS[digit]
  for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
    if (glyph[gy][gx] !== '1') continue
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const px = x + gx * scale + dx; const py = y + gy * scale + dy
      if (px < 0 || py < 0 || px >= w || py >= h) continue
      const at = py * (w * 3 + 1) + 1 + px * 3
      raw[at] = color[0]; raw[at + 1] = color[1]; raw[at + 2] = color[2]
    }
  }
}
function placeholder(index, w, h) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(typed) >>> 0)
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const bg = PALETTE[index % PALETTE.length]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * (w * 3 + 1) + 1 + x * 3
    const band = ((x + y) % 160 < 80) ? 10 : 0
    raw[at] = Math.min(255, bg[0] + band); raw[at + 1] = Math.min(255, bg[1] + band); raw[at + 2] = Math.min(255, bg[2] + band)
  }
  const text = String(index).padStart(2, '0')
  const scale = Math.max(4, Math.floor(Math.min(w, h) / 32))
  const digitW = 5 * scale; const gap = scale; const total = digitW * 2 + gap
  let x = Math.floor((w - total) / 2); const y = Math.floor((h - 7 * scale) / 2)
  const ink = [255, 255, 255]
  for (const digit of text) { drawDigit(raw, w, h, digit, x, y, scale, ink); x += digitW + gap }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const photoSize = (index) => {
  if (index === 0) return [1440, 900]
  if (index % 5 === 0) return [1200, 500]
  if (index % 3 === 0) return [600, 900]
  if (index % 7 === 0) return [600, 600]
  return [900, 600]
}
const photos = new Map()
for (let index = 0; index <= 24; index++) {
  const [w, h] = photoSize(index)
  photos.set(`p${String(index).padStart(2, '0')}.png`, placeholder(index, w, h))
}

// ---- example long template package ----------------------------------------
function walk(directory) {
  const out = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) out.push(...walk(absolute))
    else if (entry.isFile()) out.push(absolute)
  }
  return out
}
const exampleDir = path.resolve('examples/card-templates/example-long')
const exampleZip = new JSZip()
for (const absolute of walk(exampleDir)) {
  exampleZip.file(path.relative(exampleDir, absolute).replace(/\\/g, '/'), fs.readFileSync(absolute))
}
const exampleBytes = await exampleZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

const worker = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  if (pathname === '/example-long.reedcard') {
    res.writeHead(200, { 'content-type': 'application/zip', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' })
    res.end(exampleBytes); return
  }
  if (pathname.startsWith('/photos/')) {
    const name = pathname.slice('/photos/'.length)
    const image = photos.get(name)
    if (!image) { res.writeHead(404).end('missing'); return }
    res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' })
    res.end(image); return
  }
  if (pathname.startsWith('/export/')) {
    const relative = decodeURIComponent(pathname.slice('/export/'.length))
    const file = path.resolve(output, relative)
    if (!file.startsWith(path.resolve(output)) || !fs.existsSync(file)) { res.writeHead(404).end('missing'); return }
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-cache' })
    res.end(fs.readFileSync(file)); return
  }
  res.writeHead(404).end('missing')
})
await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))

fs.mkdirSync(path.resolve('data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve('data/test-long-cdp.db' + suffix), { force: true })
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: 'file:./data/test-long-cdp.db', ANON_GC_ENABLED: 'false',
    IMG_BASE_URL: workerOrigin, IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
    ACCESS_KEY: randomBytes(24).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'), AGENT_TOKENS: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (data) => { appLog += data })
app.stderr.on('data', (data) => { appLog += data })
let chrome
let ws
try {
  let up = false
  for (let i = 0; i < 200; i++) {
    try { const response = await fetch(origin + '/'); if (response.ok) { up = true; break } } catch { }
    await sleep(150)
  }
  if (!up) throw new Error('app did not start: ' + appLog.slice(-800))

  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--window-size=1600,1200',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let endpoint
  for (let i = 0; i < 200; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl } catch { }
    if (endpoint) break
    await sleep(150)
  }
  if (!endpoint) throw new Error('chrome did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let seq = 0; const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id)
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable'); await call('CSS.enable'); await call('Log.enable')
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('mopai.onboarding.v1','done')}catch{}` })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, timeout = 30000) => {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
      last = await evaluate(expression)
      if (last) return last
      await sleep(120)
    }
    throw new Error(label + ' timeout: ' + JSON.stringify(last))
  }
  const click = async (selector) => {
    if (!await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return false;el.click();return true})()`)) {
      throw new Error('missing or disabled control: ' + selector)
    }
    await sleep(120)
  }
  const shot = async (name, clip) => {
    await call('Page.bringToFront')
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) })
    const file = path.join(output, name + '.png')
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }
  const longLayout = async (timeout = 60000) => {
    await waitFor(`['ready','empty','error'].includes(document.querySelector('[data-long-view]')?.dataset.longLayout)`, 'long layout', timeout)
  }
  const ready = () => waitFor(`document.querySelector('[data-long-view]')?.dataset.longLayout === 'ready'`, 'long ready', 60000)
  const setMarkdown = async (text, wait = true) => {
    await evaluate(`(()=>{const view=window.__mopaiCodemirror;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:${JSON.stringify(text)}}});return true})()`)
    await sleep(500)
    if (wait && await evaluate(`!!document.querySelector('[data-long-view]')`)) await longLayout()
  }
  const setWidth = async (width) => {
    const before = await evaluate(`document.querySelector('[data-long-view]')?.dataset.longHeight || ''`)
    await click(`[data-long-width="${width}"]`)
    await sleep(250)
    await waitFor(`document.querySelector('[data-long-view]')?.dataset.longHeight && document.querySelector('[data-long-view]')?.dataset.longHeight !== ${JSON.stringify(before)}`, 'width rebuild', 60000).catch(() => { })
    await longLayout()
  }
  const setFormat = async (format) => { await click(`[data-long-format="${format}"]`); await sleep(150) }
  const openLong = async () => {
    await click('[data-preview-mode="long"]')
    await waitFor(`!!document.querySelector('[data-long-view]')`, 'long view')
    await longLayout()
  }

  await call('Page.navigate', { url: origin + '/' })
  await waitFor(`!!window.__mopaiCodemirror`, 'editor', 60000)
  await sleep(1200)

  const photoUrl = (index) => `${workerOrigin}/photos/p${String(index).padStart(2, '0')}.png`
  const section = (title, lede, start, count, extra = '') => {
    const lines = [`## ${title}`, '', lede, '', extra]
    for (let i = 0; i < count; i++) lines.push(`![照片${start + i}](${photoUrl(start + i)})`)
    lines.push('')
    return lines.join('\n')
  }
  const doc = [
    '# 一次读书会',
    '',
    '把一本书读成一条长图',
    '',
    `![封面](${photoUrl(0)})`,
    '',
    section('签到与开场', '读者陆续到场，把带来的书摊在长桌上。', 1, 5),
    section('自由阅读', '一个下午，各自读各自带来的那一本。', 6, 4),
    section('轮流分享', '每个人用三分钟讲一个被划线的句子。', 10, 6, '-先讲书，再讲自己\n-不急着给结论\n\n>一本书被读到哪里，往往正好是生活走到哪里。\n'),
    section('交换批注', '把书传给下一位，在页边留下一条批注。', 16, 5),
    section('收束', '把今天借出去的书登记好，下次见面再还。', 21, 4),
    '---',
    '',
    '把书读完，也把日子读完。',
  ].join('\n')
  fs.writeFileSync(path.join(output, 'sample.md'), doc)
  await setMarkdown(doc, false)
  await openLong()
  check('long mode renders a complete layout', await evaluate(`document.querySelector('[data-long-view]')?.dataset.longLayout === 'ready'`), await evaluate(`({height:document.querySelector('[data-long-view]')?.dataset.longHeight,sections:document.querySelector('[data-long-view]')?.dataset.longSections,summary:document.querySelector('[data-long-summary]')?.textContent})`))
  const summary = await evaluate(`document.querySelector('[data-long-summary]')?.textContent || ''`)
  check('summary reports all five sections and a plausible height', /5/.test(summary) && Number(await evaluate(`document.querySelector('[data-long-view]')?.dataset.longHeight`)) > 4000, summary)

  // Blue public template is the default; select it explicitly and verify fonts.
  await click('[data-long-template="custom.public-blue-tech-recap"]')
  await ready()
  const templateName = await evaluate(`document.querySelector('.reed-long-root')?.dataset.template || ''`)
  check('public blue template is activated through the upload loader', templateName === 'blue-tech-recap', templateName)
  const platformFonts = async (selector) => {
    const { root } = await call('DOM.getDocument', { depth: 0 })
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error('font probe missing: ' + selector)
    const { fonts } = await call('CSS.getPlatformFontsForNode', { nodeId })
    return fonts
  }
  const titleFonts = await platformFonts('.blue-hero-title')
  const labelFonts = await platformFonts('.reed-long-section-label')
  const bodyFonts = await platformFonts('.reed-long-section-body p')
  const footFonts = await platformFonts('.blue-foot-content')
  const family = (fonts) => fonts.map((font) => font.familyName).join(' ')
  check('title and body use the declared Noto Sans SC faces', /Noto Sans SC/.test(family(titleFonts)) && /Noto Sans SC/.test(family(bodyFonts)) && titleFonts.every((font) => font.isCustomFont) && bodyFonts.every((font) => font.isCustomFont), { title: family(titleFonts), body: family(bodyFonts) })
  check('labels and footer use the declared Zhuque Fangsong face', /Zhuque Fangsong/.test(family(labelFonts)) && /Zhuque Fangsong/.test(family(footFonts)) && labelFonts.every((font) => font.isCustomFont), { label: family(labelFonts), footer: family(footFonts) })

  const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
  const jpegSize = (bytes) => {
    let at = 2
    while (at < bytes.length) {
      if (bytes[at] !== 0xFF) { at++; continue }
      const marker = bytes[at + 1]
      if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
      if (marker === 0xd8 || marker === 0xd9) { at += 2; continue }
      const length = bytes.readUInt16BE(at + 2)
      at += 2 + length
    }
    throw new Error('jpeg size not found')
  }
  const downloadExport = async (label, extension) => {
    const directory = path.join(exportsDir, label)
    fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory, { recursive: true })
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true })
    const before = await evaluate(`document.querySelector('[data-long-view]')?.dataset.longLastExport || ''`)
    await click('[data-long-export-all]')
    const end = Date.now() + 240000
    while (Date.now() < end) {
      const files = fs.readdirSync(directory)
      const name = files.find((file) => file.endsWith(extension))
      if (name && !files.some((file) => file.endsWith('.crdownload'))) {
        await sleep(300)
        const after = await evaluate(`document.querySelector('[data-long-view]')?.dataset.longLastExport || ''`)
        return { file: path.join(directory, name), name, before, after }
      }
      const toast = await evaluate(`document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent || ''`)
      if (toast) throw new Error('export failed: ' + toast)
      await sleep(250)
    }
    throw new Error('export download timeout: ' + label)
  }
  const exportPair = async (width) => {
    await setWidth(width)
    await setFormat('jpg')
    await ready()
    const jpg = await downloadExport(`${width}-jpg`, '.jpg')
    const jpgBytes = fs.readFileSync(jpg.file)
    const jpgDim = jpegSize(jpgBytes)
    check(`${width} JPG exports at the selected width`, jpgDim.width === width && jpgDim.height > 1000, { ...jpgDim, bytes: jpgBytes.length, name: jpg.name })
    await setFormat('png')
    await ready()
    const png = await downloadExport(`${width}-png`, '.png')
    const pngBytes = fs.readFileSync(png.file)
    const pngDim = pngSize(pngBytes)
    check(`${width} PNG exports at the selected width`, pngDim.width === width && pngDim.height > 1000, { ...pngDim, bytes: pngBytes.length, name: png.name })
    return { jpg, png, jpgDim, pngDim }
  }
  const jpg1080 = await exportPair(1080)
  const png1080 = jpg1080.png
  const png1440 = await exportPair(1440)
  check('1080 and 1440 exports keep the same aspect ratio', Math.abs(jpg1080.jpgDim.height / 1080 - png1440.pngDim.height / 1440) < .01, { h1080: jpg1080.jpgDim.height, h1440: png1440.pngDim.height })

  // ---- DOM segments against the PNG export ---------------------------------
  const heightCss = Number(await evaluate(`document.querySelector('[data-long-view]')?.dataset.longHeight`))
  const offsets = [0, Math.max(0, Math.floor((heightCss - 1000) / 2)), Math.max(0, heightCss - 1000)]
  const segmentFiles = []
  for (const [index, offset] of offsets.entries()) {
    await evaluate(`(()=>{document.querySelector('#long-acceptance-stage')?.remove();const root=document.querySelector('[data-long-preview-root]')?.firstElementChild;if(!root)throw new Error('no preview root');const clone=root.cloneNode(true);const stage=document.createElement('div');stage.id='long-acceptance-stage';Object.assign(stage.style,{position:'fixed',left:'8px',top:'8px',width:'540px',height:'1000px',overflow:'hidden',zIndex:'2147483647',background:'#0b3b76'});Object.assign(clone.style,{position:'absolute',left:'0',top:${-offset} + 'px',width:'540px',margin:'0',transform:'none'});stage.append(clone);document.body.append(stage);return true})()`)
    await evaluate(`document.fonts.ready.then(()=>true)`)
    await sleep(250)
    segmentFiles.push(await shot(`dom-segment-${index + 1}`, { x: 8, y: 8, width: 540, height: 1000, scale: 2 }))
    await evaluate(`document.querySelector('#long-acceptance-stage')?.remove()`)
  }
  // Exports sit in per-format subfolders, so address files by their path under the output folder.
  const compareUrl = (name) => `${workerOrigin}/export/${path.relative(output, name).split(path.sep).map(encodeURIComponent).join('/')}`
  const compareSegment = async (domFile, pngFile, offset, label) => {
    const metrics = await evaluate(`(async()=>{const load=async src=>{const img=new Image();img.crossOrigin='anonymous';img.src=src;await img.decode();return img};const [a,b]=await Promise.all([load(${JSON.stringify(compareUrl(domFile))}),load(${JSON.stringify(compareUrl(pngFile))})]);const c=document.createElement('canvas');c.width=1080;c.height=2000;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(a,0,0,1080,2000);const p=ctx.getImageData(0,0,1080,2000).data;ctx.clearRect(0,0,1080,2000);ctx.drawImage(b,0,${-offset * 2},1080,b.height);const q=ctx.getImageData(0,0,1080,2000).data;let sum=0,bad=0;for(let i=0;i<p.length;i+=4){let max=0;for(let j=0;j<3;j++){const d=Math.abs(p[i+j]-q[i+j]);sum+=d;max=Math.max(max,d)}if(max>16)bad++}return {mean:sum/(1080*2000*3),bad:bad/(1080*2000)}})()`)
    check(label + ': preview DOM and export agree', metrics.mean < 2 && metrics.bad < .025, metrics)
    return metrics
  }
  for (const [index, offset] of offsets.entries()) {
    await compareSegment(segmentFiles[index], png1080.file, offset, `segment ${index + 1}`)
  }

  // ---- ink inside title and section label -----------------------------------
  const boxes = await evaluate(`(()=>{const root=document.querySelector('[data-long-preview-root]').getBoundingClientRect();const box=(s)=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {x:(r.left-root.left)/root.width*1080,y:(r.top-root.top)/root.width*1080,w:r.width/root.width*1080,h:r.height/root.width*1080}};return {title:box('.blue-hero-title'),label:box('.reed-long-section-label')}})()`)
  const ink = await evaluate(`(async()=>{const img=new Image();img.crossOrigin='anonymous';img.src=${JSON.stringify(compareUrl(png1080.file))};await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const count=(box,bright)=>{const data=ctx.getImageData(Math.max(0,Math.round(box.x)),Math.max(0,Math.round(box.y)),Math.max(1,Math.round(box.w)),Math.max(1,Math.round(box.h))).data;let hit=0;const total=data.length/4;for(let i=0;i<data.length;i+=4){const l=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];if(bright?l>170:l<120)hit++}return {hit,total,fraction:hit/total}};return {title:count(${JSON.stringify(boxes.title)},true),label:count(${JSON.stringify(boxes.label)},false)}})()`)
  check('title box contains bright gradient ink', ink.title.fraction > .04, ink.title)
  check('section label box contains dark text ink', ink.label.fraction > .02, ink.label)

  // ---- gradient continuity at segment joins --------------------------------
  const gradient = await evaluate(`(async()=>{const img=new Image();img.crossOrigin='anonymous';img.src=${JSON.stringify(compareUrl(png1080.file))};await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const rows=[1000,2000,3000,4000].filter(y=>y<img.naturalHeight);const out=[];for(const y of rows){const a=ctx.getImageData(4,y-1,1,1).data;const b=ctx.getImageData(4,y,1,1).data;out.push({y,d:Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]))})}return out})()`)
  check('background gradient has no seam at segment joins', gradient.every((row) => row.d <= 4), gradient)

  // ---- forced canvas limit, split ZIP and notice ---------------------------
  await evaluate(`localStorage.setItem('mopai.long-canvas-limit.v1',JSON.stringify({maxEdge:3000,maxArea:3000*1080}))`)
  await setWidth(1080)
  await setFormat('jpg')
  await ready()
  const zipDownload = await downloadExport('split', '.zip')
  await waitFor(`Number(document.querySelector('[data-long-view]')?.dataset.longSplit ||0) >1`, 'split attribute', 30000)
  const splitCount = Number(await evaluate(`document.querySelector('[data-long-view]')?.dataset.longSplit ||0`))
  const zip = await JSZip.loadAsync(fs.readFileSync(zipDownload.file))
  const zipNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  check('forced limit produces a numbered ZIP', splitCount > 1 && zipNames.length === splitCount && zipNames.every((name, index) => name.includes(`-${index + 1}of${splitCount}.jpg`)), { splitCount, zipNames })
  await evaluate(`localStorage.removeItem('mopai.long-canvas-limit.v1')`)
  await setWidth(1080)
  await ready()

  // ---- empty, title-only, no-image and unreadable-image states -------------
  await setMarkdown('', false)
  await waitFor(`document.querySelector('[data-long-view]')?.dataset.longLayout === 'empty'`, 'empty layout', 30000)
  check('empty document stays a calm empty state', !await evaluate(`!!document.querySelector('[data-long-view]')?.dataset.longError`), await evaluate(`document.querySelector('[data-long-summary]')?.textContent`))
  await setMarkdown('# 只有标题', false)
  await ready()
  check('title-only document renders the plain header without a cover', await evaluate(`!!document.querySelector('.blue-hero-plain') && document.querySelectorAll('.reed-long-section').length ===0`))
  await setMarkdown('# 没有照片\n\n副标题\n\n## 一节\n\n只有文字。', false)
  await ready()
  check('document without photos still lays out sections', await evaluate(`document.querySelectorAll('.reed-long-section').length ===1 && document.querySelectorAll('.reed-long-photos').length ===0`))
  const broken = `${workerOrigin}/photos/missing.png`
  await setMarkdown(`# 读图失败\n\n## 一节\n\n![缺失](${broken})`, false)
  await ready()
  const blocked = await evaluate(`document.querySelector('[data-long-view]')?.dataset.longExportBlocked === 'true'`)
  const warning = await evaluate(`document.querySelector('[data-long-image-warning]')?.innerText || ''`)
  const exportDisabled = await evaluate(`document.querySelector('[data-long-export-all]')?.disabled === true`)
  check('unreadable image lists its address and pauses export', blocked && warning.includes(broken) && exportDisabled, { blocked, warning: warning.slice(0, 120), exportDisabled })
  await setMarkdown(doc, false)
  await ready()
  check('a working document clears the export block', await evaluate(`!document.querySelector('[data-long-view]')?.dataset.longExportBlocked`))

  // ---- upload the example long template, persist, then delete --------------
  await evaluate(`(async()=>{const response=await fetch('${workerOrigin}/example-long.reedcard');const blob=await response.blob();const file=new File([blob],'example-long.reedcard',{type:'application/zip'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('[data-card-template-file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await waitFor(`[...document.querySelectorAll('[data-card-template-item]')].some((el)=>el.textContent.includes('素白'))`, 'example upload', 60000)
  const uploaded = await evaluate(`(()=>{const item=[...document.querySelectorAll('[data-card-template-item]')].find((el)=>el.textContent.includes('素白'));return item?.dataset.cardTemplateItem || ''})()`)
  await click(`[data-card-template="${uploaded}"]`)
  await ready()
  const exampleRoot = await evaluate(`document.querySelector('.reed-long-root')?.dataset.template || ''`)
  const exampleBackground = await evaluate(`getComputedStyle(document.querySelector('.reed-long-root')).backgroundColor`)
  check('example long template uploads and renders through the same path', Boolean(uploaded) && exampleRoot === 'example-long' && exampleBackground !== 'rgba(0,0,0,0)', { uploaded, exampleRoot, exampleBackground })
  // A JPG must keep the template's own ground colour (it once came out white).
  // Sampled at the bottom-left corner, below the footer, where only the ground shows.
  await setFormat('jpg')
  await ready()
  const exampleJpg = await downloadExport('example-jpg', '.jpg')
  const corner = await evaluate(`(async()=>{const img=new Image();img.crossOrigin='anonymous';img.src=${JSON.stringify(compareUrl(exampleJpg.file))};await img.decode();const c=document.createElement('canvas');c.width=8;c.height=8;const ctx=c.getContext('2d');ctx.drawImage(img,0,8-img.naturalHeight);return [...ctx.getImageData(2,5,1,1).data].slice(0,3)})()`)
  check('a JPG export keeps the template ground colour', Math.abs(corner[0] - 246) <= 3 && Math.abs(corner[1] - 245) <= 3 && Math.abs(corner[2] - 241) <= 3, corner)
  const saved = await evaluate(`localStorage.getItem('mopai.long-options.v1') || ''`)
  check('the uploaded template is remembered in the long options key', saved.includes(uploaded), saved.slice(0, 180))

  await sleep(800)
  await call('Page.reload')
  await waitFor(`!!window.__mopaiCodemirror`, 'editor after reload', 60000)
  await sleep(1200)
  await openLong()
  await waitFor(`!!document.querySelector('[data-card-template-item][data-selected]')`, 'restored selected template', 60000)
  const restored = await evaluate(`document.querySelector('[data-card-template-item][data-selected]')?.dataset.cardTemplateItem || ''`)
  check('refresh restores the uploaded template selection', restored === uploaded, restored)
  await evaluate(`window.confirm=()=>true`)
  await click('[data-card-template-manage]')
  await sleep(300)
  await click(`[data-card-template-item="${uploaded}"] [data-card-template-delete]`)
  await waitFor(`![...document.querySelectorAll('[data-card-template-item]')].some((el)=>el.dataset.cardTemplateItem === ${JSON.stringify(uploaded)})`, 'template deleted', 30000)
  await sleep(500)
  await ready()
  const fallback = await evaluate(`document.querySelector('[data-long-template="custom.public-blue-tech-recap"]')?.getAttribute('aria-pressed')`)
  check('deleting the uploaded template returns to the public blue default', fallback === 'true', fallback)

  // ---- light/dark and zh/en ------------------------------------------------
  const uiState = async (theme, lang) => {
    await evaluate(`localStorage.setItem('mopai.theme.v1',${JSON.stringify(theme)});localStorage.setItem('mopai.lang.v1',${JSON.stringify(lang)})`)
    await call('Page.reload')
    await waitFor(`!!window.__mopaiCodemirror`, 'editor ' + lang, 60000)
    await sleep(1000)
    await openLong()
    await ready()
    return evaluate(`({dark:document.documentElement.classList.contains('dark'),lang:document.documentElement.lang,text:document.querySelector('[data-long-settings]')?.innerText || '',overflow:document.documentElement.scrollWidth > innerWidth +1})`)
  }
  const darkEn = await uiState('yoru', 'en')
  check('long mode renders in dark English UI without overflow', darkEn.dark && darkEn.lang === 'en' && /Template/i.test(darkEn.text) && !darkEn.overflow, { dark: darkEn.dark, lang: darkEn.lang, text: darkEn.text.slice(0, 80), overflow: darkEn.overflow })
  const lightZh = await uiState('akari', 'zh')
  check('long mode renders in light Chinese UI without overflow', !lightZh.dark && lightZh.lang.startsWith('zh') && /模板/.test(lightZh.text) && !lightZh.overflow, { dark: lightZh.dark, lang: lightZh.lang, text: lightZh.text.slice(0, 80), overflow: lightZh.overflow })

  // ---- A04: repeated long builds must not mutate the parsed AST -----------
  // A gallery cover: its first item becomes the header photo and the rest the
  // preamble photo group. Every later build (mode switch, width change, another
  // preview) must read the same a/b/c from the untouched parsed document.
  const galleryDoc = [
    '# 画廊长图', '', '副标题', '',
    ':::gallery 3 4:3', `![a](${photoUrl(0)})`, `![b](${photoUrl(1)})`, `![c](${photoUrl(2)})`, ':::', '',
    section('一节', '说明', 3, 2),
    '---', '', '落款文字',
  ].join('\n')
  const longProbe = () => evaluate(`(()=>{
    const root=document.querySelector('[data-long-preview-root]')?.firstElementChild;
    if(!root)return null;
    const hash=(s)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)+':'+s.length};
    const cover=root.querySelector('.blue-hero-image')?.getAttribute('src')||'';
    const groups=[...root.querySelectorAll('.reed-long-photos')];
    const first=groups[0];
    const photos=first?[...first.querySelectorAll('.reed-long-photo')]:[];
    return {cover:cover?hash(cover):'',groups:groups.length,count:first?.getAttribute('data-photo-count')||'',
      photoDigests:photos.map(f=>hash(f.querySelector('img')?.getAttribute('src')||'')),
      geometry:photos.map(f=>{const r=f.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)]})}})()`)
  const previewTopClip = async () => {
    await evaluate(`(()=>{const s=document.querySelector('[data-long-scroller]');if(s)s.scrollTop=0;return true})()`)
    await sleep(200)
    return evaluate(`(()=>{const el=document.querySelector('[data-long-preview-frame]');if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.max(0,Math.round(r.left)),y:Math.max(0,Math.round(r.top)),width:Math.max(1,Math.min(Math.round(r.width),520)),height:Math.max(1,Math.min(600,Math.round(r.height))),scale:2}})()`)
  }
  const sameProbe = (a, b) => Boolean(a?.cover) && a.cover === b?.cover &&
    a.count === b?.count && a.groups === b?.groups &&
    JSON.stringify(a?.photoDigests) === JSON.stringify(b?.photoDigests) &&
    JSON.stringify(a?.geometry) === JSON.stringify(b?.geometry)

  await setMarkdown(galleryDoc, false)
  await longLayout()
  await waitFor(`(document.querySelector('[data-long-preview-root] .blue-hero-title')?.textContent||'').includes('画廊长图')`, 'gallery long build', 60000)
  await ready()
  if (await evaluate(`document.querySelector('[data-long-width="1080"]')?.getAttribute('aria-pressed') !== 'true'`)) await setWidth(1080)
  await ready()
  const a04Build1 = await longProbe()
  check('A04 first build uses the gallery first item and one two-photo group', Boolean(a04Build1?.cover) && a04Build1.count === '2' && a04Build1.groups === 2, a04Build1)
  const a04Shot1 = await shot('a04-build-1-1080', await previewTopClip())

  // Force a fresh renderDoc from the same parsed doc: switch to the article
  // preview and change the theme. With the old mutation the gallery would lose
  // its first photo here. Prefer a first-paint theme so its implementation is
  // already cached and the re-render lands immediately.
  await click('[data-preview-mode="wechat"]')
  await waitFor(`!!document.querySelector('[data-preview-article]')`, 'wechat preview after long')
  await waitFor(`document.querySelectorAll('[data-theme-quick]').length > 0`, 'theme quick picker', 30000)
  const a04Theme = await evaluate(`(()=>{
    const current=document.querySelector('[data-theme-quick].ya-selected')?.getAttribute('data-theme-quick')||'';
    const self=['minimal','steady','golden'].map((id)=>document.querySelector('[data-theme-quick="'+id+'"]')).find((el)=>el&&el.getAttribute('data-theme-quick')!==current);
    const any=[...document.querySelectorAll('[data-theme-quick]')].find((el)=>el.getAttribute('data-theme-quick')!==current);
    const chosen=self||any;
    return {current,other:chosen?.getAttribute('data-theme-quick')||''}})()`)
  if (a04Theme.other) await click(`[data-theme-quick="${a04Theme.other}"]`)
  await sleep(700)
  const a04GalleryImages = await evaluate(`[...document.querySelectorAll('[data-preview-article] img')].filter((img)=>(img.getAttribute('src')||'').includes('/photos/p0')).length`)
  check('A04 article re-render still has all three gallery photos', a04Theme.other !== '' && a04GalleryImages === 3, { theme: a04Theme, images: a04GalleryImages })

  // Mode round-trip rebuilds the long page from the same parsed AST.
  await openLong()
  await ready()
  const a04Build2 = await longProbe()
  check('A04 a mode-switch rebuild keeps cover and photo group', sameProbe(a04Build1, a04Build2), { before: a04Build1, after: a04Build2 })

  // Width change rebuilds at another export scale.
  await setWidth(1440)
  await ready()
  const a04Build3 = await longProbe()
  check('A04 the 1440 rebuild keeps the same cover, photo group and geometry', Boolean(a04Build3?.cover) && a04Build3.count === '2' &&
    JSON.stringify(a04Build3.geometry) === JSON.stringify(a04Build1.geometry) && a04Build3.groups === a04Build1.groups, a04Build3)
  await shot('a04-build-3-1440', await previewTopClip())

  // Back to 1080: the fourth build must render byte-identical photos.
  await setWidth(1080)
  await ready()
  const a04Build4 = await longProbe()
  check('A04 four builds later the gallery mapping is unchanged', sameProbe(a04Build1, a04Build4), { before: a04Build1, after: a04Build4 })
  await shot('a04-build-4-1080', await previewTopClip())

  const a04Compare = await evaluate(`(async()=>{
    const load=async src=>{const img=new Image();img.crossOrigin='anonymous';img.src=src;await img.decode();return img};
    const [a,b]=await Promise.all([load(${JSON.stringify(compareUrl(a04Shot1))}),load(${JSON.stringify(compareUrl(path.join(output,'a04-build-4-1080.png')))})]);
    const w=Math.min(a.naturalWidth,b.naturalWidth);const h=Math.min(a.naturalHeight,b.naturalHeight);
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(a,0,0);const p=ctx.getImageData(0,0,w,h).data;
    ctx.clearRect(0,0,w,h);ctx.drawImage(b,0,0);const q=ctx.getImageData(0,0,w,h).data;
    let sum=0,bad=0;for(let i=0;i<p.length;i+=4){let max=0;for(let j=0;j<3;j++){const d=Math.abs(p[i+j]-q[i+j]);sum+=d;max=Math.max(max,d)}if(max>16)bad++}
    return {mean:sum/(w*h*3),bad:bad/(w*h),w,h}})()`)
  check('A04 repeated-build screenshots are pixel-identical', a04Compare.mean < 1 && a04Compare.bad < 0.005, a04Compare)

  // ---- A05: closing-block photos reach the preview and the exported pixels --
  const footerDoc = [
    '# 落款图片', '', '副标题', '',
    section('一节', '说明一', 0, 2),
    '---', '',
    `![二维码](${photoUrl(20)})`, '',
    ':::gallery 2', `![联署](${photoUrl(21)})`, `![Logo](${photoUrl(22)})`, ':::', '',
    ':::carousel 4:3', `![合影](${photoUrl(23)})`, `![花絮](${photoUrl(24)})`, ':::', '',
    '共同走过这一年。',
  ].join('\n')
  await setMarkdown(footerDoc, false)
  await longLayout()
  await waitFor(`(document.querySelector('[data-long-preview-root] .blue-hero-title')?.textContent||'').includes('落款图片')`, 'footer long build', 60000)
  await ready()
  const footerProbe = await evaluate(`(()=>{const content=document.querySelector('.blue-foot-content');if(!content)return null;
    const groups=[...content.querySelectorAll('.reed-long-photos')];
    return {counts:groups.map((g)=>g.getAttribute('data-photo-count')),
      figures:content.querySelectorAll('.reed-long-photo').length,images:content.querySelectorAll('img').length,
      blocked:document.querySelector('[data-long-view]')?.dataset.longExportBlocked==='true'}})()`)
  check('A05 closing block renders one single image, a gallery and a carousel in order',
    Boolean(footerProbe) && footerProbe.counts.join(',') === '1,2,2' && footerProbe.figures === 5 &&
    footerProbe.images === 5 && !footerProbe.blocked, footerProbe)
  await evaluate(`(()=>{const s=document.querySelector('[data-long-scroller]');if(s)s.scrollTop=s.scrollHeight;return true})()`)
  await sleep(300)
  await shot('a05-footer-preview')

  await setFormat('png')
  await ready()
  const a05Png = await downloadExport('a05-footer', '.png')
  const a05FooterBox = await evaluate(`(()=>{const root=document.querySelector('[data-long-preview-root]')?.firstElementChild;
    const foot=root?.querySelector('.blue-foot');if(!root||!foot)return null;
    const rr=root.getBoundingClientRect();const fr=foot.getBoundingClientRect();
    return {y:(fr.top-rr.top)/rr.width*1080,height:fr.height/rr.width*1080}})()`)
  const a05Ink = await evaluate(`(async()=>{
    const img=new Image();img.crossOrigin='anonymous';img.src=${JSON.stringify(compareUrl(a05Png.file))};await img.decode();
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
    const box=${JSON.stringify(a05FooterBox)};const y=Math.max(0,Math.round(box.y));const h=Math.max(1,Math.min(img.naturalHeight-y,Math.round(box.height)));
    const data=ctx.getImageData(0,y,img.naturalWidth,h).data;
    const targets=[[70,143,150],[176,94,87],[92,116,166],[133,128,74],[52,118,174]];
    const hits=targets.map(()=>0);
    for(let i=0;i<data.length;i+=4){for(let t=0;t<targets.length;t++){const p=targets[t];
      if(Math.abs(data[i]-p[0])<=30&&Math.abs(data[i+1]-p[1])<=30&&Math.abs(data[i+2]-p[2])<=30){hits[t]++;break}}}
    return {hits,box:{y,h,exportHeight:img.naturalHeight}}})()`)
  check('A05 the exported closing block actually contains the QR/logo photo pixels',
    a05Ink.hits.every((hit) => hit > 300), a05Ink)

  // ---- B04: cancellation delivers nothing and every resource is released ----
  // Count the exact resources the preparation opens, instead of guessing from
  // a heap snapshot. Interrupted rebuilds and cancelled exports must balance.
  await evaluate(`(()=>{
    window.__longRes={urls:0,revoked:0,bitmaps:0,closed:0};
    const co=URL.createObjectURL.bind(URL), ro=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{window.__longRes.urls++;return co(blob)};
    URL.revokeObjectURL=(url)=>{window.__longRes.revoked++;return ro(url)};
    const cb=window.createImageBitmap?window.createImageBitmap.bind(window):null;
    if(cb){window.createImageBitmap=async(...args)=>{window.__longRes.bitmaps++;const bm=await cb(...args);
      const close=bm.close.bind(bm);bm.close=()=>{window.__longRes.closed++;return close()};return bm}};
    // Make each sequential photo fetch slow enough that the next width change
    // genuinely interrupts preparation.
    window.__rawFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{const url=typeof input==='string'?input:(input&&input.url)||'';
      if(url.includes('/photos/')){return new Promise((resolve,reject)=>{setTimeout(()=>{window.__rawFetch(input,init).then(resolve,reject)},120)})}
      return window.__rawFetch(input,init)};
    return true})()`)
  await setMarkdown(doc, false)
  await longLayout()
  await ready()
  for (let i = 0; i < 20; i++) {
    await click(`[data-long-width="${i % 2 === 0 ? 1440 : 1080}"]`)
    await sleep(260)
  }
  await ready()
  await sleep(1500)
  await evaluate(`(()=>{window.fetch=window.__rawFetch;return true})()`)
  const longRes = await evaluate(`window.__longRes`)
  check('B04 twenty interrupted rebuilds release every object URL and bitmap',
    longRes.urls <= longRes.revoked && longRes.bitmaps === longRes.closed && longRes.bitmaps > 0,
    { ...longRes, urlsOutstanding: Math.max(0, longRes.urls - longRes.revoked), bitmapsOutstanding: longRes.bitmaps - longRes.closed })

  // A long single export cancelled mid-render must not download a file. The
  // click happens as soon as the cancel control is on screen: cancelling is
  // what the user does while the canvas render is running.
  await setWidth(1440)
  await ready()
  const cancelSingleDir = path.join(exportsDir, 'cancel-single')
  fs.rmSync(cancelSingleDir, { recursive: true, force: true }); fs.mkdirSync(cancelSingleDir, { recursive: true })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: cancelSingleDir, eventsEnabled: true })
  await evaluate(`document.querySelectorAll('[data-sonner-toast]').forEach((el)=>{el.remove()})`)
  const cancelBefore = await evaluate(`document.querySelector('[data-long-view]')?.dataset.longLastExport || ''`)
  await click('[data-long-export-all]')
  await waitFor(`!!document.querySelector('[data-long-export-cancel]')`, 'cancel control', 30000)
  const cancelClicked = await evaluate(`(()=>{const el=document.querySelector('[data-long-export-cancel]');
    if(!el)return {clicked:false,reason:'gone'};if(el.disabled)return {clicked:false,reason:'disabled'};el.click();return {clicked:true}})()`)
  await waitFor(`!document.querySelector('[data-long-export-cancel]')`, 'cancelled single export settles', 180000)
  await sleep(800)
  const cancelSingleFiles = fs.readdirSync(cancelSingleDir).filter((file) => !file.endsWith('.crdownload'))
  const cancelToasts = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((el)=>({type:el.dataset.type||'',text:el.textContent||''}))`)
  const cancelAfter = await evaluate(`document.querySelector('[data-long-view]')?.dataset.longLastExport || ''`)
  await shot('b04-canceled')
  check('B04 a cancelled single export delivers no file, no success state and a cancel message',
    cancelClicked.clicked && cancelSingleFiles.length === 0 && !cancelToasts.some((item) => item.type === 'success') &&
    cancelToasts.some((item) => /取消/.test(item.text)) && cancelAfter === cancelBefore,
    { cancel: cancelClicked, files: cancelSingleFiles, toasts: cancelToasts, lastExportBefore: cancelBefore, lastExportAfter: cancelAfter })

  // The split/ZIP path must behave the same when cancelled between tiles.
  await evaluate(`localStorage.setItem('mopai.long-canvas-limit.v1',JSON.stringify({maxEdge:3000,maxArea:3000*1080}))`)
  await setWidth(1080)
  await setFormat('jpg')
  await ready()
  const cancelSplitDir = path.join(exportsDir, 'cancel-split')
  fs.rmSync(cancelSplitDir, { recursive: true, force: true }); fs.mkdirSync(cancelSplitDir, { recursive: true })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: cancelSplitDir, eventsEnabled: true })
  await evaluate(`document.querySelectorAll('[data-sonner-toast]').forEach((el)=>{el.remove()})`)
  await click('[data-long-export-all]')
  await waitFor(`!!document.querySelector('[data-long-export-cancel]')`, 'split cancel control', 30000)
  await sleep(250)
  const splitCancelClicked = await evaluate(`(()=>{const el=document.querySelector('[data-long-export-cancel]');
    if(!el)return {clicked:false,reason:'gone'};if(el.disabled)return {clicked:false,reason:'disabled'};el.click();return {clicked:true}})()`)
  await waitFor(`!document.querySelector('[data-long-export-cancel]')`, 'cancelled split export settles', 180000)
  await sleep(800)
  const cancelSplitFiles = fs.readdirSync(cancelSplitDir).filter((file) => !file.endsWith('.crdownload'))
  const cancelSplitToasts = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((el)=>({type:el.dataset.type||'',text:el.textContent||''}))`)
  check('B04 a cancelled split export delivers no ZIP and reports cancellation',
    splitCancelClicked.clicked && cancelSplitFiles.length === 0 && !cancelSplitToasts.some((item) => item.type === 'success') &&
    cancelSplitToasts.some((item) => /取消/.test(item.text)),
    { cancel: splitCancelClicked, files: cancelSplitFiles, toasts: cancelSplitToasts })
  await evaluate(`localStorage.removeItem('mopai.long-canvas-limit.v1')`)

  // Normal export still works after the cancelled attempts.
  await setFormat('png')
  await ready()
  const recovery = await downloadExport('b04-recovery', '.png')
  check('B04 a normal export still downloads after cancelled attempts', fs.existsSync(recovery.file), recovery.name)

  const realErrors = errors.filter((item) => !/missing\.png|404|Failed to load resource/.test(item))
  check('no console errors or uncaught exceptions', realErrors.length === 0, realErrors.slice(0, 6))
} finally {
  try { if (ws) ws.close() } catch { }
  try { chrome?.kill() } catch { }
  try { app.kill() } catch { }
  worker.close()
}
const failed = checks.filter((item) => !item.passed)
fs.writeFileSync(path.join(output, 'SUMMARY.json'), JSON.stringify({ checks, errors, failed: failed.length }, null, 2))
console.log(`\n[long-image] ${checks.length - failed.length}/${checks.length} checks passed; output ${output}`)
if (failed.length) {
  console.error('FAILED:\n' + failed.map((item) => '- ' + item.name + ': ' + JSON.stringify(item.detail)).join('\n'))
  process.exit(1)
}
