// Browser acceptance for Reed's nine public card templates.
//   node scripts/cdp-verify-public-cards.mjs [appPort=3281] [cdpPort=9398]
//
// Requires `npm run build` first (the build packs card-templates/public/ into
// public/card-templates/). Owns only this worktree's test DB, local image
// worker, and a fresh Chrome profile. For every public variant it exports a
// 3:4 cover and body through the normal PNG button, compares each against a
// full-size screenshot of the preview DOM, and checks cover-title ink and text
// contrast in the exported pixels. 1:1 and 9:16 covers get an export + ink check.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const port = Number(process.argv[2] || 3281)
const cdpPort = Number(process.argv[3] || 9398)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const output = path.resolve('verify-out/public-cards')
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-public-cards-'))
const checks = []
const exceptions = []
const consoleErrors = []
const evidence = { output, checks, exports: [], pixels: [], coverTitles: [], contrast: [], templates: [] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), detail })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`)
}

const DRAFT = `# 把日常写成值得收藏的卡片：一份关于观察、记忆与缓慢记录的练习

用一篇固定的测试稿，检验长标题、副标题、列表、引用与多页排版。

## 阅读从这里开始

清晨的城市还没有完全醒来，街边的早餐店已经亮起了灯。我们沿着河岸慢慢走，把看到的细节写进笔记：桥下的水声、便利店门口的灯、骑车人外套上的反光。写作并不总要从一个宏大的观点开始，先说清眼前发生了什么，再去追问它为什么值得记住。

同一段文字出现在长文章和图文卡片里，阅读节奏会变，内容的意思却应当完整保留。好的留白让读者有时间停顿，清楚的层级让他们在滑动时知道自己读到了哪里。记录真实的颜色、声音和人物，比堆砌抽象形容词更能留下画面。

> 写作不是把一切都说尽，而是让读者愿意停下来，多看一眼。

## 可以照着做的步骤

1. 先写下今天真正看见的三件事，不加判断。
2. 为每件事补上一个具体的细节：时间、地点、气味或声音。
3. 删掉重复的形容词，把抽象的词换成看得见的动作。
4. 读一遍，找出最想留给读者的那一句。
5. 把它放到段落的开头或结尾，让文章有呼吸。

- 一张卡片只讲一个意思，别让读者替你找重点。
- 引用要短，但要有分量。
- 列表适合步骤，不适合堆砌观点。
- 留白也是内容的一部分。

## 第二章：慢一点记录

午后光线从窗帘的缝隙里进来，桌上的纸杯留下一个圆形的影子。我们常常以为记录需要完整的句子，其实一个准确的动词、一个没有被修饰的名词，就足以把一天固定下来。把相机放下，先用眼睛看三十秒，再决定要写什么。

每次修改，都试着把一句话说得更具体。不是「天气很好」，而是「风把晾在阳台上的衬衫吹得鼓起来」。不是「他很累」，而是「他把钥匙放在桌上，坐了半分钟才想起要开灯」。具体的句子会自己长出节奏。

## 数据与例子

| 观察 | 记录方式 | 用途 |
|:--|:--|:--|
| 河岸的光 | 照片与一句笔记 | 建立场景 |
| 早餐店的声音 | 三行对话 | 保留人物 |
| 回家的路线 | 时间与地标 | 组织叙事 |

---

## 留给下一次出发

每一次记录都是重新认识日常的机会。把今天写下来，明天再带着新的眼光出发。`

const TEMPLATES = [
  { id: 'swiss-grid', variants: ['day', 'ink'] },
  { id: 'editorial-white', variants: ['paper'] },
  { id: 'book-notes', variants: ['cream', 'night'] },
  { id: 'aurora', variants: ['dawn', 'dusk'] },
  { id: 'deep-night', variants: ['night'] },
  { id: 'doc-frame', variants: ['paper', 'ink'] },
  { id: 'tech-pulse', variants: ['pulse'] },
  { id: 'fresh-notes', variants: ['mint', 'peach'] },
  { id: 'pine-notebook', variants: ['pine', 'dusk'] },
].filter((item) => !process.argv[4] || process.argv[4].split(',').includes(item.id))

async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
await Promise.all([port, cdpPort, workerPort].map(freePort))

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMAAAAwBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const worker = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' })
  res.end(pixel)
})
await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
fs.mkdirSync(path.resolve('data'), { recursive: true })
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: 'file:./data/test-public-cards.db', ANON_GC_ENABLED: 'false',
    IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
    ACCESS_KEY: randomBytes(24).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'), AGENT_TOKENS: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (data) => { appLog += data })
app.stderr.on('data', (data) => { appLog += data })

let chrome
let ws
let send
let sessionId

async function evaluate(expression, session = sessionId) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, timeout = 45000, session = sessionId) {
  const end = Date.now() + timeout
  do {
    if (await evaluate(expression, session)) return
    await sleep(120)
  } while (Date.now() < end)
  throw new Error('waitFor: ' + expression.slice(0, 220))
}
async function click(selector) {
  const clicked = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true })()`)
  if (!clicked) throw new Error('missing or disabled control: ' + selector)
  await sleep(80)
}
async function cardsReady() {
  await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true'`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(100)
}
async function setMarkdown(text) {
  await evaluate(`(() => { const view = window.__mopaiCodemirror; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } }); return true })()`)
  await sleep(300)
  if (await evaluate(`!!document.querySelector('[data-xhs-view]')`)) await cardsReady()
}
async function shot(name, clip) {
  await send('Page.bringToFront', {}, sessionId)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) }, sessionId)
  const file = path.join(output, name + '.png')
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}
/** Full-size clone, because the on-screen card is scaled to 260px. */
async function nativeCardShot(selector, name) {
  const box = await evaluate(`(() => {
    const original = document.querySelector(${JSON.stringify(selector)});
    if (!original) throw new Error('no card');
    const node = original.cloneNode(true); node.id = 'xhs-acceptance-shot';
    Object.assign(node.style, {position:'fixed',left:'8px',top:'8px',margin:'0',transform:'none',zIndex:'2147483647'});
    document.body.append(node); const r = node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(180)
  try {
    return await shot(name, { ...box, scale: 2 })
  } finally {
    await evaluate(`document.querySelector('#xhs-acceptance-shot')?.remove()`)
  }
}
const boundsExpression = `(() => {
  const bad = []; const cards = [...document.querySelectorAll('.xhs-card')];
  for (const [i, card] of cards.entries()) {
    const c = card.getBoundingClientRect(); const scale = c.width / 540;
    for (const el of card.querySelectorAll('*')) {
      // Decorative shapes may intentionally bleed past the 540px frame; the
      // card clips them with overflow:hidden and they never cover text.
      if (el.closest('[aria-hidden="true"]')) continue;
      for (const r of el.getClientRects()) {
        if (!r.width || !r.height) continue;
        if (r.left < c.left - .7 || r.right > c.right + .7 || r.top < c.top - .7 || r.bottom > c.bottom + .7)
          bad.push({i,tag:el.tagName,text:el.textContent?.slice(0,32),r:{x:r.x,y:r.y,w:r.width,h:r.height},c:{x:c.x,y:c.y,w:c.width,h:c.height}});
      }
    }
  }
  return {count:cards.length,bad:bad.slice(0,6),warning:!!document.querySelector('[data-card-image-warning]')};
})()`
async function download(selector, label, extension) {
  await send('Page.bringToFront', {}, sessionId)
  await cardsReady()
  const directory = path.join(output, 'exports', label)
  fs.mkdirSync(directory, { recursive: true })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true })
  await click(selector)
  const end = Date.now() + 180000
  while (Date.now() < end) {
    const files = fs.readdirSync(directory)
    const name = files.find((file) => file.endsWith(extension))
    if (name && !files.some((file) => file.endsWith('.crdownload'))) return path.join(directory, name)
    const error = await evaluate(`document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent`)
    if (error) throw new Error('export: ' + error)
    await sleep(250)
  }
  throw new Error('download timeout: ' + label)
}
const dimensions = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })

async function pixelCompare(domFile, pngFile, label, limits = { mean: 2, bad: 0.025 }) {
  const dom = 'data:image/png;base64,' + fs.readFileSync(domFile).toString('base64')
  const exported = 'data:image/png;base64,' + fs.readFileSync(pngFile).toString('base64')
  const metrics = await evaluate(`(async () => {
    const load = async src => { const img = new Image(); img.src=src; await img.decode(); return img; };
    const [a,b]=await Promise.all([load(${JSON.stringify(dom)}),load(${JSON.stringify(exported)})]);
    const w=540,h=Math.round(b.height/2); const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(a,0,0,w,h); const p=ctx.getImageData(0,0,w,h).data;
    ctx.clearRect(0,0,w,h); ctx.drawImage(b,0,0,w,h); const q=ctx.getImageData(0,0,w,h).data;
    let sum=0,bad=0; const diff=ctx.createImageData(w,h);
    for(let i=0;i<p.length;i+=4){let max=0;for(let j=0;j<3;j++){const d=Math.abs(p[i+j]-q[i+j]);sum+=d;max=Math.max(max,d);diff.data[i+j]=Math.min(255,d*4)}diff.data[i+3]=255;if(max>16)bad++;}
    ctx.putImageData(diff,0,0);
    return {meanAbsoluteError:sum/(w*h*3),differentPixelFraction:bad/(w*h),diff:canvas.toDataURL('image/png')};
  })()`)
  const safeLabel = label.replace(/[\\/:]/g, '-')
  fs.writeFileSync(path.join(output, safeLabel + '-diff.png'), Buffer.from(metrics.diff.split(',')[1], 'base64'))
  delete metrics.diff
  evidence.pixels.push({ label, ...metrics })
  check(label + ': DOM/PNG pixel agreement',
    metrics.meanAbsoluteError < limits.mean && metrics.differentPixelFraction < limits.bad,
    { ...metrics, limits })
  return metrics
}

async function coverTitleInk(pngFile, label, height = 1440) {
  const probe = await evaluate(`(() => {
    const card = document.querySelector('[data-card-index="0"]');
    if (!card) throw new Error('cover card missing');
    const title = card.querySelector('.xhs-cover h1');
    if (!title) throw new Error('cover title missing');
    const c = card.getBoundingClientRect(); const r = title.getBoundingClientRect(); const cs = getComputedStyle(title);
    const scale = c.width / 540;
    return {
      text: (title.textContent || '').trim(),
      fontSize: parseFloat(cs.fontSize), color: cs.color,
      opacity: parseFloat(cs.opacity), visibility: cs.visibility, display: cs.display,
      x: (r.left - c.left) / scale, y: (r.top - c.top) / scale,
      width: r.width / scale, height: r.height / scale,
      cardWidth: c.width / scale, cardHeight: c.height / scale,
    };
  })()`)
  const pad = 6
  const maxW = 1080, maxH = height
  const rx = Math.max(0, Math.min(maxW, Math.round(probe.x * 2) - pad))
  const ry = Math.max(0, Math.min(maxH, Math.round(probe.y * 2) - pad))
  const rw = Math.max(1, Math.min(maxW - rx, Math.round(probe.width * 2) + pad * 2))
  const rh = Math.max(1, Math.min(maxH - ry, Math.round(probe.height * 2) + pad * 2))
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(pngFile).toString('base64')
  const stats = await evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(${rx}, ${ry}, ${rw}, ${rh}).data;
    const border = [[], [], []];
    const add = (x, y) => { const i = (y * ${rw} + x) * 4; for (let c = 0; c < 3; c++) border[c].push(p[i + c]) };
    for (let x = 0; x < ${rw}; x++) { add(x, 0); add(x, ${rh} - 1) }
    for (let y = 1; y < ${rh} - 1; y++) { add(0, y); add(${rw} - 1, y) }
    const bg = border.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
    let ink = 0;
    for (let i = 0; i < p.length; i += 4) {
      const delta = Math.max(Math.abs(p[i] - bg[0]), Math.abs(p[i + 1] - bg[1]), Math.abs(p[i + 2] - bg[2]));
      if (delta > 50) ink++;
    }
    return { ink, area: ${rw} * ${rh}, inkFraction: ink / (${rw} * ${rh}), background: bg };
  })()`)
  const visible = probe.opacity > 0.5 && probe.visibility === 'visible' && probe.display !== 'none' &&
    probe.x >= -0.5 && probe.y >= -0.5 && probe.x + probe.width <= probe.cardWidth + 0.5 &&
    probe.y + probe.height <= probe.cardHeight + 0.5
  const passed = visible && probe.fontSize >= 12 && stats.ink >= 400 && stats.inkFraction >= 0.015
  evidence.coverTitles.push({ label, ...probe, ...stats, visible })
  check(label + ': cover title leaves ink in the exported PNG', passed, { ...probe, ...stats, visible })
}

function parseCssColor(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) return null
  const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some((channel) => !Number.isFinite(channel))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 }
}
const linearChannel = (value) => {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}
const relativeLuminance = (color) => 0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b)
const contrastRatio = (foreground, background) => {
  const fg = relativeLuminance(foreground), bg = relativeLuminance(background)
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
}

async function textContrastChecks(pageIndex, pngFile, label, roles) {
  const probes = await evaluate(`(() => {
    const card = document.querySelector('[data-card-index="${pageIndex}"]');
    if (!card) throw new Error('card missing for contrast probe');
    const c = card.getBoundingClientRect(); const scale = c.width / 540;
    return ${JSON.stringify(roles)}.map((role) => {
      const el = card.querySelector(role.selector);
      if (!el) return { role: role.role, selector: role.selector, missing: true };
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return {
        role: role.role, text: (el.textContent || '').trim().slice(0, 48),
        color: cs.color, fontSize: parseFloat(cs.fontSize),
        fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
        opacity: Number.parseFloat(cs.opacity), display: cs.display, visibility: cs.visibility,
        box: { x: (r.left - c.left) / scale, y: (r.top - c.top) / scale, width: r.width / scale, height: r.height / scale },
      };
    });
  })()`)
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(pngFile).toString('base64')
  const samples = await evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const medians = [];
    for (const box of ${JSON.stringify(probes.map((probe) => probe.box))}) {
      const x = Math.max(0, Math.min(img.naturalWidth - 1, Math.round(box.x * 2)));
      const y = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(box.y * 2)));
      const width = Math.max(1, Math.min(img.naturalWidth - x, Math.round(box.width * 2)));
      const height = Math.max(1, Math.min(img.naturalHeight - y, Math.round(box.height * 2)));
      const data = ctx.getImageData(x, y, width, height).data;
      const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      const total = data.length / 4;
      for (let i = 0; i < data.length; i += 4) { histograms[0][data[i]]++; histograms[1][data[i+1]]++; histograms[2][data[i+2]]++; }
      const median = histograms.map((histogram) => {
        let seen = 0;
        for (let channel = 0; channel < 256; channel++) { seen += histogram[channel]; if (seen >= total / 2) return channel; }
        return 255;
      });
      medians.push({ median, width, height });
    }
    return medians;
  })()`)
  for (const [index, probe] of probes.entries()) {
    const threshold = probe.fontSize >= 24 && probe.fontWeight >= 700 ? 3 : 4.5
    const sample = samples[index]
    const foreground = probe.missing ? null : parseCssColor(probe.color)
    let ratio = 0
    if (foreground && sample) {
      const alpha = Math.max(0, Math.min(1, foreground.a * (Number.isFinite(probe.opacity) ? probe.opacity : 1)))
      const background = { r: sample.median[0], g: sample.median[1], b: sample.median[2] }
      const effective = {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
      }
      ratio = contrastRatio(effective, background)
    }
    const passed = !probe.missing && probe.display !== 'none' && probe.visibility === 'visible' &&
      Number.isFinite(ratio) && ratio >= threshold
    const detail = {
      role: probe.role, text: probe.text ?? '', color: probe.color ?? null,
      background: sample?.median ?? null, fontSize: probe.fontSize, fontWeight: probe.fontWeight,
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null, threshold,
      missing: Boolean(probe.missing),
    }
    evidence.contrast.push({ label, page: pageIndex + 1, passed, ...detail })
    check(`${label}: ${probe.role} contrast >= ${threshold}:1`, passed, detail)
  }
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break } catch { /* booting */ }
    if (i === 99) throw new Error('local application did not start: ' + appLog.slice(-800))
    await sleep(150)
  }
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1600,1100', 'about:blank',
  ], { stdio: 'ignore' })
  let endpoint
  for (let i = 0; i < 100; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl; if (endpoint) break } catch { /* booting */ }
    await sleep(150)
  }
  if (!endpoint) throw new Error('Chrome CDP did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timeout } = pending.get(message.id)
      clearTimeout(timeout); pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
    if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.sessionId === sessionId && message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description).join(' '))
  })
  send = (method, params = {}, session) => new Promise((resolve, reject) => {
    const messageId = ++id
    const timeout = setTimeout(() => { pending.delete(messageId); reject(new Error('CDP timeout: ' + method)) }, 60000)
    pending.set(messageId, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id: messageId, method, params, ...(session ? { sessionId: session } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))
  for (const domain of ['Page', 'Runtime', 'DOM']) await send(domain + '.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {localStorage.setItem('mopai.onboarding.v1','done');localStorage.setItem('mopai.theme.v1','akari');localStorage.setItem('mopai.lang.v1','zh')}catch{}`,
  }, sessionId)
  await send('Page.navigate', { url: origin }, sessionId)
  await waitFor('!!window.__mopaiCodemirror')
  await waitFor(`window.__mopaiCodemirror.state.doc.length > 1000`)
  await setMarkdown(DRAFT)
  const publicFetchesBeforeCards = await evaluate(`performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/card-templates/')).length`)
  check('public packs are not fetched in WeChat mode', publicFetchesBeforeCards === 0, publicFetchesBeforeCards)
  await click('[data-preview-mode="cards"]')
  await cardsReady()
  await evaluate('document.fonts.ready.then(() => true)')

  // Public packages are fetched only when card mode opens; wait for all nine.
  await waitFor(`document.querySelectorAll('[data-card-template-public]:not(:disabled)').length === 9`, 60000)
  const publicFetchesAfterCards = await evaluate(`performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/card-templates/')).length`)
  check('all nine public packs load on entering card mode', publicFetchesAfterCards >= 9, publicFetchesAfterCards)
  check('all nine public templates are selectable in card mode',
    await evaluate(`document.querySelectorAll('[data-card-template-public]:not(:disabled)').length`) === 9)
  check('public templates are badged separately from uploaded templates',
    await evaluate(`document.querySelectorAll('[data-card-template-public]').length`) === 9 &&
    await evaluate(`document.querySelector('[data-card-settings]')?.textContent?.includes('公用')`))

  await click('[data-card-ratio="3:4"]')
  await cardsReady()

  for (const [templateIndex, template] of TEMPLATES.entries()) {
    const runtime = `custom.public-${template.id}`
    await click(`[data-card-template="${runtime}"]`)
    await cardsReady()
    const selected = await evaluate(`document.querySelector('[data-card-template="${runtime}"]')?.getAttribute('aria-pressed') === 'true'`)
    check(`${template.id}: selected from the public group`, selected)
    for (const [variantIndex, variant] of template.variants.entries()) {
      const label = `${template.id}/${variant}`
      await click('[data-card-ratio="3:4"]')
      await cardsReady()
      await click(`[data-card-bg="${variant}"]`)
      await cardsReady()
      const bounds = await evaluate(boundsExpression)
      check(`${label}: every card fits`, bounds.count >= 3 && bounds.bad.length === 0 && !bounds.warning, bounds.bad.length ? bounds.bad : { pages: bounds.count })
      check(`${label}: cover + at least two body pages`, bounds.count >= 3, bounds.count)

      const coverDom = await nativeCardShot('[data-card-index="0"]', `${template.id}-${variant}-3x4-cover-dom`)
      const coverPng = await download('[data-card-export="0"]', `${template.id}-${variant}-3x4-cover`, '.png')
      const coverSize = dimensions(fs.readFileSync(coverPng))
      check(`${label}: cover export is 1080 wide`, coverSize.width === 1080 && coverSize.height === 1440, coverSize)
      await pixelCompare(coverDom, coverPng, `${label}-cover`)
      await coverTitleInk(coverPng, `${label}-cover`)
      await textContrastChecks(0, coverPng, `${label}-cover`, [
        { role: 'cover title', selector: '.xhs-cover h1' },
        { role: 'cover subtitle', selector: '.xhs-cover .cover-subtitle' },
      ])

      const bodyDom = await nativeCardShot('[data-card-index="1"]', `${template.id}-${variant}-3x4-body-dom`)
      const bodyPng = await download('[data-card-export="1"]', `${template.id}-${variant}-3x4-body`, '.png')
      const bodySize = dimensions(fs.readFileSync(bodyPng))
      check(`${label}: body export is 1080 wide`, bodySize.width === 1080, bodySize)
      await pixelCompare(bodyDom, bodyPng, `${label}-body`)
      await textContrastChecks(1, bodyPng, `${label}-body`, [
        { role: 'body paragraph', selector: '.xhs-body p' },
        { role: 'body heading', selector: '.xhs-body h2' },
      ])

      for (const ratio of ['1:1', '9:16']) {
        const size = ratio === '1:1' ? 1080 : 1080
        const height = ratio === '1:1' ? 1080 : 1920
        await click(`[data-card-ratio="${ratio}"]`)
        await cardsReady()
        const file = await download('[data-card-export="0"]', `${template.id}-${variant}-${ratio.replace(':', 'x')}-cover`, '.png')
        const dims = dimensions(fs.readFileSync(file))
        check(`${label} ${ratio}: cover export is ${size} wide`, dims.width === size && dims.height === height, dims)
        await coverTitleInk(file, `${label}-${ratio}-cover`, height)
      }
      evidence.templates.push({ template: template.id, variant, runtime, pages: bounds.count })
      console.log(`[public] ${label} done (${templateIndex + 1}/${TEMPLATES.length})`)
    }
  }

  // Remembered selection: a public runtime id must survive a reload even though
  // the package itself is not stored in IndexedDB.
  await click('[data-card-template="custom.public-aurora"]')
  await cardsReady()
  await click('[data-card-ratio="1:1"]')
  await cardsReady()
  await click('[data-card-bg="dusk"]')
  await cardsReady()
  await sleep(350)
  await send('Page.reload', {}, sessionId)
  await waitFor('!!window.__mopaiCodemirror')
  await setMarkdown(DRAFT)
  await click('[data-preview-mode="cards"]')
  await waitFor(`document.querySelectorAll('[data-card-template-public]:not(:disabled)').length === 9`, 60000)
  await cardsReady()
  const remembered = await evaluate(`(() => ({
    template: document.querySelector('[data-card-template="custom.public-aurora"]')?.getAttribute('aria-pressed'),
    ratio: document.querySelector('[data-card-ratio="1:1"]')?.getAttribute('aria-pressed'),
    background: document.querySelector('[data-card-bg="dusk"]')?.getAttribute('aria-pressed'),
  }))()`)
  check('remembered public template, ratio and variant survive a reload',
    remembered.template === 'true' && remembered.ratio === 'true' && remembered.background === 'true', remembered)

  check('page produced no runtime exceptions', exceptions.length === 0, exceptions.slice(0, 4))
  check('page produced no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4))
} catch (error) {
  console.error('[public-cards] FAILED', error.stack || error)
  check('public card acceptance completes', false, error.stack || String(error))
  fs.writeFileSync(path.join(output, 'failure.log'), String(error.stack || error) + '\n\n' + appLog.slice(-6000))
  process.exitCode = 1
} finally {
  try { ws?.close() } catch { /* already closed */ }
  chrome?.kill()
  app.kill()
  await new Promise((resolve) => worker.close(resolve))
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* profile may still be locked */ }
  const passed = checks.filter((item) => item.passed).length
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({
    ...evidence, summary: { passed, total: checks.length },
    failures: checks.filter((item) => !item.passed),
  }, null, 2))
  console.log(`[public-cards] ${passed}/${checks.length} checks passed -> ${output}`)
  if (checks.some((item) => !item.passed)) process.exitCode = 1
}