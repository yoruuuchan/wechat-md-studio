// Real Chrome acceptance. Run after npm run build:
//   node scripts/cdp-verify-xhs-cards.mjs [appPort=3201] [cdpPort=9334]
// Owns only this worktree's test-xhs.db, a local image worker, and a fresh
// Chrome profile. The only public page visited is the requested mopai reference.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { transformSync } from 'esbuild'
import JSZip from 'jszip'

const port = Number(process.argv[2] || 3201)
const cdpPort = Number(process.argv[3] || 9334)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const rootOutput = path.resolve('verify-out/xhs')
const output = path.join(rootOutput, new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-xhs-'))
const checks = []
const exceptions = []
const consoleErrors = []
const evidence = { output, matrix: [], exports: [], fonts: {}, pixels: [], reference: {} }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), detail })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`)
}
async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
await Promise.all([port, cdpPort, workerPort].map(freePort))

function png(w, h) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0)
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const palette = [[52, 118, 174], [225, 205, 172], [108, 154, 127], [233, 237, 241]]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * (w * 3 + 1) + 1 + x * 3
    const color = palette[(Math.floor(x / (w / 3)) + Math.floor(y / (h / 3))) % palette.length]
    for (let c = 0; c < 3; c++) raw[at + c] = color[c]
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const wideImage = png(720, 480)
const tallImage = png(180, 600)
const worker = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  const image = pathname.endsWith('xhs-wide.png') || pathname === '/nocors.png' ? wideImage
    : pathname.endsWith('xhs-tall.png') ? tallImage : null
  if (!image) { res.writeHead(404).end('missing'); return }
  res.writeHead(200, { 'content-type': 'image/png', ...(pathname === '/nocors.png' ? {} : { 'access-control-allow-origin': '*' }) })
  res.end(image)
})
await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
fs.mkdirSync(path.resolve('data'), { recursive: true })
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: 'file:./data/test-xhs.db', ANON_GC_ENABLED: 'false',
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

const { code: sampleCode } = transformSync(fs.readFileSync('src/lib/sample.ts', 'utf8'), { loader: 'ts', format: 'esm' })
const { SAMPLE_DOC } = await import('data:text/javascript;base64,' + Buffer.from(sampleCode).toString('base64'))
const prose = [
  '清晨的城市还没有完全醒来，街边的早餐店已经亮起了灯。我们沿着河岸慢慢走，把看到的细节写进笔记。',
  '写作并不总要从一个宏大的观点开始，先说清眼前发生了什么，再去追问它为什么值得记住。',
  '同一段文字出现在长文章和图文卡片里，阅读节奏会变，内容的意思却应当完整保留。',
  '好的留白让读者有时间停顿，清楚的层级让他们在滑动时知道自己读到了哪里。',
  '记录真实的颜色、声音和人物，比堆砌抽象形容词更能留下画面。每次修改，都试着把一句话说得更具体。',
].join('')
let longDoc = '# 把日常写成值得收藏的卡片\n\n用一篇长文，检验文字、图片与留白。\n\n## 阅读从这里开始\n\n**芦苇卡片** *Reed* `2026` ==，。！？==\n\n![河岸色彩示意](img:xhs-wide.png)\n\n'
for (let i = 0; i < 8; i++) longDoc += `## 第${i + 1}节：观察与记录\n\n${prose}\n\n> 用自己的眼睛看，用自己的语言写。慢一点，也能抵达。\n\n`
longDoc += '## 可以照着做的步骤\n\n' + Array.from({ length: 35 }, (_, i) => `${7 + i}. 记录第${i + 1}个细节，保留观察、时间与当时的感受。`).join('\n')
longDoc += '\n\n- 把观点写清楚，再用例子支持。\n- 图片应当帮助理解，而不是占住版面。\n- 发布前通读一次，删掉重复的话。\n\n## 数据与例子\n\n| 项目 | 观察 | 次数 |\n|:--|:--|--:|\n'
longDoc += Array.from({ length: 24 }, (_, i) => `| 第${i + 1}次记录 | 沿河散步与街边小店 | ${i + 1} |`).join('\n')
longDoc += '\n\n```js\n' + Array.from({ length: 42 }, (_, i) => `  const note${i} = "记录 ${i} / Reed";`).join('\n') + '\n```\n\n![竖向色彩示意](img:xhs-tall.png)\n\n---\n\n## 留给下一次出发\n\n每一次记录都是重新认识日常的机会。\n'
while ((longDoc.match(/[\u3400-\u9fff]/g)?.length ?? 0) < 3000) longDoc += '\n' + prose + '\n'
fs.writeFileSync(path.join(output, 'long-document.md'), longDoc)
fs.writeFileSync(path.join(output, 'SAMPLE_DOC.md'), SAMPLE_DOC)
evidence.longDocumentCjk = (longDoc.match(/[\u3400-\u9fff]/g) ?? []).length

async function evaluate(expression, session = sessionId) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, timeout = 30000, session = sessionId) {
  const end = Date.now() + timeout
  do {
    if (await evaluate(expression, session)) return
    await sleep(120)
  } while (Date.now() < end)
  throw new Error('waitFor: ' + expression.slice(0, 250))
}
async function click(selector, session = sessionId) {
  if (!await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true })()`, session)) {
    throw new Error('missing or disabled control: ' + selector)
  }
  await sleep(80)
}
async function press(key, code, virtualKey) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey }, sessionId)
}
async function cardsReady(session = sessionId) {
  await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true'`, 45000, session)
  await evaluate('document.fonts.ready.then(() => true)', session)
  await sleep(100)
}
async function setMarkdown(text) {
  await evaluate(`(() => { const view = window.__mopaiCodemirror; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } }); return true })()`)
  await sleep(250)
  if (await evaluate(`!!document.querySelector('[data-xhs-view]')`)) await cardsReady()
}
async function shot(name, session = sessionId, clip) {
  await send('Page.bringToFront', {}, session)
  // captureBeyondViewport temporarily resizes Chrome to 1x1 on some Windows
  // versions, remounting the responsive editor. All our clips fit the viewport.
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) }, session)
  const file = path.join(output, name + '.png')
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}
async function nativeCardShot(selector, name, session = sessionId, scale = 1) {
  const box = await evaluate(`(() => {
    const original = document.querySelector(${JSON.stringify(selector)});
    if (!original) throw new Error('no card');
    const node = original.cloneNode(true); node.id = 'xhs-acceptance-shot';
    Object.assign(node.style, {position:'fixed',left:'8px',top:'8px',margin:'0',transform:'none',zIndex:'2147483647'});
    document.body.append(node); const r = node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`, session)
  await evaluate('document.fonts.ready.then(() => true)', session)
  await sleep(100)
  try { return await shot(name, session, { ...box, scale }) }
  finally { await evaluate(`document.querySelector('#xhs-acceptance-shot')?.remove()`, session) }
}
const boundsExpression = `(() => {
  const bad = []; const cards = [...document.querySelectorAll('.xhs-card')];
  for (const [i, card] of cards.entries()) {
    const c = card.getBoundingClientRect(); const scale = c.width / 540;
    const body = card.querySelector('.xhs-body');
    if (body && body.getBoundingClientRect().bottom > c.top + (parseFloat(card.style.height) - 76) * scale + .7)
      bad.push({i,kind:'body-height',height:body.offsetHeight});
    for (const el of card.querySelectorAll('*')) {
      for (const r of el.getClientRects()) {
        if (!r.width || !r.height) continue;
        if (r.left < c.left - .7 || r.right > c.right + .7 || r.top < c.top - .7 || r.bottom > c.bottom + .7)
          bad.push({i,tag:el.tagName,text:el.textContent?.slice(0,40),r:{x:r.x,y:r.y,w:r.width,h:r.height},c:{x:c.x,y:c.y,w:c.width,h:c.height}});
      }
    }
  }
  return {count:cards.length,bad:bad.slice(0,8),warning:!!document.querySelector('[data-card-image-warning]'),scaled:document.querySelector('[data-xhs-view] [role="status"]')?.textContent};
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
async function pixelCompare(domFile, pngFile, label) {
  const dom = 'data:image/png;base64,' + fs.readFileSync(domFile).toString('base64')
  const exported = 'data:image/png;base64,' + fs.readFileSync(pngFile).toString('base64')
  const metrics = await evaluate(`(async () => {
    const load = async src => { const img = new Image(); img.src=src; await img.decode(); return img; };
    const [a,b]=await Promise.all([load(${JSON.stringify(dom)}),load(${JSON.stringify(exported)})]);
    const w=540,h=Math.round(b.height/2); const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(a,0,0,w,h); const p=ctx.getImageData(0,0,w,h).data;
    ctx.clearRect(0,0,w,h); ctx.drawImage(b,0,0,w,h); const q=ctx.getImageData(0,0,w,h).data;
    let sum=0,bad=0,imagePixels=0; const diff=ctx.createImageData(w,h);
    for(let i=0;i<p.length;i+=4){let max=0;for(let j=0;j<3;j++){const d=Math.abs(p[i+j]-q[i+j]);sum+=d;max=Math.max(max,d);diff.data[i+j]=Math.min(255,d*4)}diff.data[i+3]=255;if(max>16)bad++;if(Math.abs(q[i]-52)<2&&Math.abs(q[i+1]-118)<2&&Math.abs(q[i+2]-174)<2)imagePixels++;}
    ctx.putImageData(diff,0,0);
    return {meanAbsoluteError:sum/(w*h*3),differentPixelFraction:bad/(w*h),imagePixels,diff:canvas.toDataURL('image/png')};
  })()`)
  fs.writeFileSync(path.join(output, label + '-diff.png'), Buffer.from(metrics.diff.split(',')[1], 'base64'))
  delete metrics.diff
  evidence.pixels.push({ label, ...metrics })
  check(label + ': DOM/PNG pixel agreement', metrics.meanAbsoluteError < 2 && metrics.differentPixelFraction < .025, metrics)
  return metrics
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
  for (const domain of ['Page', 'Runtime', 'DOM', 'CSS']) await send(domain + '.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try {localStorage.setItem('mopai.onboarding.v1','done');localStorage.setItem('mopai.theme.v1','akari')}catch{}` }, sessionId)
  await send('Page.navigate', { url: origin }, sessionId)
  await waitFor('!!window.__mopaiCodemirror')
  await waitFor(`window.__mopaiCodemirror.state.doc.length > 1000 && document.querySelector('[data-onboarding="preview"]')?.innerText.length > 200`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(650)
  check('local page renders meaningful UI without an error overlay', await evaluate(`document.body.innerText.length>200 && !document.querySelector('vite-error-overlay')`))
  check('preview switch is available', await evaluate(`!!document.querySelector('[data-preview-mode="cards"]')`))
  check('long Chinese document has about 3000 characters', evidence.longDocumentCjk >= 3000 && evidence.longDocumentCjk <= 3400, evidence.longDocumentCjk)
  // The editor screenshot changed with the new preview switch. Other README
  // screenshots retain their existing layout and are left as they are.
  await shot('editor-akari')
  fs.copyFileSync(path.join(output, 'editor-akari.png'), 'docs/images/editor-akari.png')
  await evaluate(`localStorage.setItem('mopai.theme.v1','yoru'); document.documentElement.dataset.theme='yoru';document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'`)
  await sleep(450)
  await shot('editor-yoru')
  fs.copyFileSync(path.join(output, 'editor-yoru.png'), 'docs/images/editor-yoru.png')

  for (const [docName, text] of [['sample', SAMPLE_DOC], ['long', longDoc]]) {
    await setMarkdown(text)
    await click('[data-preview-mode="cards"]')
    await cardsReady()
    if (docName === 'long') {
      check('long list keeps every item and continuous numbers across pages', await evaluate(`JSON.stringify([...document.querySelectorAll('.xhs-card ol>li')].map(li=>li.value))===JSON.stringify(Array.from({length:35},(_,i)=>i+7))`))
      check('long table keeps every body row across pages', await evaluate(`document.querySelectorAll('.xhs-card tbody tr').length===24`))
    }
    for (const lang of ['zh', 'en']) for (const theme of ['akari', 'yoru']) {
      await click(`[data-lang="${lang}"]`)
      await evaluate(`localStorage.setItem('mopai.theme.v1',${JSON.stringify(theme)}); document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.classList.toggle('dark',${theme === 'yoru'});document.documentElement.style.colorScheme=${JSON.stringify(theme === 'yoru' ? 'dark' : 'light')}; window.dispatchEvent(new Event('mopai-theme-change'))`)
      await cardsReady()
      for (const ratio of ['3:4', '1:1', '9:16']) for (const bg of ['paper', 'white', 'grid', 'tint', 'night']) {
        await click(`[data-card-ratio="${ratio}"]`)
        await click(`[data-card-bg="${bg}"]`)
        await cardsReady()
        const bounds = await evaluate(boundsExpression)
        const label = `${docName}-${lang}-${theme}-${ratio.replace(':', 'x')}-${bg}`
        evidence.matrix.push({ label, ...bounds })
        check(label + ': every card fits', bounds.count > 0 && bounds.bad.length === 0 && !bounds.warning, bounds.bad.length ? bounds.bad : { pages: bounds.count })
        if (lang === 'zh' && theme === 'akari') await shot(label)
        if (ratio === '3:4' && bg === 'paper') await shot(`${docName}-${lang}-${theme}`)
      }
    }
    await click('[data-lang="zh"]')
    for (const ratio of ['3:4', '1:1', '9:16']) {
      await click(`[data-card-ratio="${ratio}"]`); await click('[data-card-bg="paper"]'); await cardsReady()
      const count = await evaluate('document.querySelectorAll(".xhs-card").length')
      const expectedHeight = { '3:4': 1440, '1:1': 1080, '9:16': 1920 }[ratio]
      const label = `${docName}-${ratio.replace(':', 'x')}`
      const file = await download('[data-card-export="0"]', label + '-single', '.png')
      const size = dimensions(fs.readFileSync(file))
      check(label + ': single PNG size', size.width === 1080 && size.height === expectedHeight, size)
      evidence.exports.push({ label, file, ...size })
      const archive = await download('[data-card-export-all]', label + '-zip', '.zip')
      const zip = await JSZip.loadAsync(fs.readFileSync(archive), { checkCRC32: true })
      const entries = Object.values(zip.files).filter((entry) => !entry.dir)
      const sizes = await Promise.all(entries.map(async (entry) => dimensions(await entry.async('nodebuffer'))))
      check(label + ': ZIP page count, CRC and PNG sizes', entries.length === count && sizes.every((s) => s.width === 1080 && s.height === expectedHeight), { expected: count, actual: entries.length })
      evidence.exports.push({ label, archive, pages: entries.length })
      if (docName === 'long' && ratio === '3:4') {
        const coverShot = await nativeCardShot('[data-card-index="0"]', 'cover-dom-1080', sessionId, 2)
        await pixelCompare(coverShot, file, 'cover')
        const index = await evaluate(`[...document.querySelectorAll('.xhs-card')].findIndex(c=>c.querySelector('img'))`)
        const bodyFile = await download(`[data-card-export="${index}"]`, 'long-body-single', '.png')
        const bodyShot = await nativeCardShot(`[data-card-index="${index}"]`, 'body-dom-1080', sessionId, 2)
        const pixels = await pixelCompare(bodyShot, bodyFile, 'body')
        check('same-origin uploaded image appears in exported PNG', pixels.imagePixels > 500, pixels.imagePixels)
      }
    }
    await click('[data-preview-mode="wechat"]')
    check(docName + ': returning to WeChat keeps the Markdown', await evaluate(`window.__mopaiCodemirror.state.doc.toString() === ${JSON.stringify(text)}`))
  }

  await setMarkdown(longDoc)
  await click('[data-preview-mode="cards"]'); await cardsReady()
  for (const [kind, tag, text] of [['chinese','strong','芦苇卡片'],['latin','em','Reed'],['numbers','code','2026'],['punctuation','mark','，。！？']]) {
    await evaluate(`(() => {const el=[...document.querySelectorAll('.xhs-body ${tag}')].find(el=>el.textContent===${JSON.stringify(text)});if(!el)throw new Error('font probe absent');el.dataset.fontProbe=${JSON.stringify(kind)}})()`)
    const { root } = await send('DOM.getDocument', { depth: 0 }, sessionId)
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-font-probe="${kind}"]` }, sessionId)
    const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId }, sessionId)
    evidence.fonts[kind] = fonts
    check(kind + ': actual card glyphs use self-hosted webfonts', fonts.length > 0 && fonts.every((font) => font.isCustomFont && /Noto Sans SC|Geist/i.test(font.familyName)), fonts)
  }
  check('no JavaScript exceptions in the card matrix and exports', exceptions.length === 0, exceptions.map((e) => e.text))
  check('no console errors in the card matrix and exports', consoleErrors.length === 0, consoleErrors)

  // Real image-read failure: display is allowed, but this origin omits CORS.
  await setMarkdown(`# 图片读取失败测试\n\n![跨域图片](http://127.0.0.1:${workerPort}/nocors.png)`)
  await cardsReady()
  check('cross-origin image failure is visible and prevents incomplete exports', await evaluate(`!!document.querySelector('[data-card-image-warning]') && document.querySelector('[data-card-export-all]').disabled`))
  await shot('cors-warning-zh')
  await click('[data-lang="en"]'); await cardsReady()
  check('image warning translates to English', await evaluate(`document.querySelector('[data-card-image-warning]')?.textContent.includes('Export is paused')`))
  await shot('cors-warning-en')
  await setMarkdown('## ' + '一个很长的标题'.repeat(180) + '\n\n| 列 |\n|:--|\n| ' + '无法拆成独立表格行的长单元格。'.repeat(200) + ' |')
  const oversized = await evaluate(boundsExpression)
  check('indivisible oversized content fits with an explicit notice', oversized.bad.length === 0 && !!oversized.scaled, oversized)
  await shot('oversized-content')
  await setMarkdown('# 只有标题')
  check('title-only document has one cover', await evaluate(`document.querySelectorAll('.xhs-card').length===1 && !!document.querySelector('[data-card-kind="cover"]')`))
  await setMarkdown('')
  check('empty document has no cards or enabled exports', await evaluate(`!document.querySelector('.xhs-card') && document.querySelector('[data-card-export-all]').disabled`))
  await shot('empty-document')

  await setMarkdown(longDoc)
  const optionsBeforeResize = await evaluate(`JSON.stringify({ratio:document.querySelector('[data-card-ratio][aria-pressed="true"]')?.dataset.cardRatio,bg:document.querySelector('[data-card-bg][aria-pressed="true"]')?.dataset.cardBg})`)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId)
  await waitFor(`!!document.querySelector('[data-pane-tab="preview"]')`)
  await evaluate(`document.querySelector('[data-pane-tab="preview"]').focus()`)
  await press('Enter', 'Enter', 13)
  await cardsReady()
  check('card ratio and background survive responsive layout changes', await evaluate(`JSON.stringify({ratio:document.querySelector('[data-card-ratio][aria-pressed="true"]')?.dataset.cardRatio,bg:document.querySelector('[data-card-bg][aria-pressed="true"]')?.dataset.cardBg})===${JSON.stringify(optionsBeforeResize)}`))
  for (const lang of ['zh','en']) {
    await evaluate(`document.querySelector('[data-topbar-more]').focus()`)
    await press('Enter', 'Enter', 13)
    await waitFor(`!!document.querySelector('[data-lang="${lang}"]')`)
    await click(`[data-lang="${lang}"]`); await cardsReady()
    await press('Escape', 'Escape', 27)
    const narrow = await evaluate(`(() => {const root=document.querySelector('[data-xhs-view]');const r=root.getBoundingClientRect();const bad=[...root.querySelectorAll('button')].filter(b=>{const x=b.getBoundingClientRect();return x.left<r.left-.5||x.right>r.right+.5});return {bad:bad.map(b=>b.textContent),width:document.documentElement.scrollWidth,viewport:innerWidth}})()`)
    check(lang + ': card controls fit a 390px viewport', !narrow.bad.length && narrow.width <= narrow.viewport, narrow)
    await shot('narrow-' + lang)
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId)
  await cardsReady()

  // Same, public-safe Markdown in both products. data: pictures make the
  // comparison independent of either site's storage or network image hosts.
  const comparison = '# 把日常写成值得收藏的卡片\n\n让文字、图片和留白一起讲述。\n\n## 观察与记录\n\n清晨沿着河岸走，把看到的细节写进笔记。**芦苇卡片** *Reed* `2026` ==，。！？==\n\n> 好的排版，让读者知道自己读到了哪里。\n\n1. 写下真实的细节。\n2. 用例子支撑观点。\n3. 留下适合停顿的空白。\n\n```js\nconst notes = ["文字", "图片", "留白"];\n```\n\n| 内容 | 用途 |\n|:--|:--|\n| 标题 | 建立层级 |\n| 图片 | 补充信息 |\n\n![河岸色彩](data:image/png;base64,' + wideImage.toString('base64') + ')\n\n---\n\n## 下一次出发\n\n把生活写下来，再带着新的眼光出发。'
  fs.writeFileSync(path.join(output, 'comparison.md'), comparison)
  await click('[data-lang="zh"]'); await setMarkdown(comparison); await cardsReady()
  await click('[data-card-ratio="3:4"]'); await click('[data-card-bg="paper"]'); await cardsReady()
  const primary = await evaluate(`getComputedStyle(document.querySelector('.xhs-card')).getPropertyValue('--xhs-accent').trim()`)
  const { targetId: refTarget } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId: referenceSession } = await send('Target.attachToTarget', { targetId: refTarget, flatten: true })
  await send('Page.enable', {}, referenceSession); await send('Runtime.enable', {}, referenceSession)
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, referenceSession)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try {localStorage.setItem('mopai:md',${JSON.stringify(comparison)});localStorage.setItem('mopai:settings',JSON.stringify({theme:'simple',primary:${JSON.stringify(primary)},cardFontSize:18,ratio:'3:4',cardBg:'paper',cover:true,serif:false,macCode:false,codeDark:false,author:'芦苇',pageNum:true}))}catch{}` }, referenceSession)
  await send('Page.navigate', { url: 'https://woodti.github.io/mopai/' }, referenceSession)
  await waitFor(`!!document.querySelector('textarea')`, 45000, referenceSession)
  await evaluate(`document.querySelectorAll('.mode-tabs button')[1].click()`, referenceSession)
  await waitFor(`document.querySelectorAll('.card').length > 1`, 30000, referenceSession)
  await shot('mopai-online', referenceSession)
  evidence.reference.url = await evaluate('location.href', referenceSession)
  evidence.reference.sameMarkdown = await evaluate(`document.querySelector('textarea').value===${JSON.stringify(comparison)}`, referenceSession)
  check('reference uses the same Markdown on the mopai online site', evidence.reference.sameMarkdown && evidence.reference.url === 'https://woodti.github.io/mopai/')
  for (const bg of ['paper', 'white', 'grid', 'tint', 'night']) {
    await click(`[data-card-bg="${bg}"]`); await cardsReady()
    // The reference has five native background buttons in a labelled group.
    await evaluate(`(() => {const groups=[...document.querySelectorAll('.group')];const group=groups.find(g=>g.querySelector('h4')?.textContent==='卡片背景');if(!group)throw new Error('reference background controls missing');const labels=${JSON.stringify({paper:'米白纸',white:'纯白',grid:'方格本',tint:'主色浅底',night:'夜读'})};const button=[...group.querySelectorAll('button')].find(b=>b.textContent.trim()===labels[${JSON.stringify(bg)}]);if(!button)throw new Error('reference background missing');button.click()})()`, referenceSession)
    await sleep(700)
    for (const [page, index] of [['cover',0],['body',1]]) {
      const reed = await nativeCardShot(`[data-card-index="${index}"]`, `reed-${bg}-${page}`)
      const reference = await nativeCardShot(`.card-slot:nth-child(${index + 1}) .card`, `mopai-${bg}-${page}`, referenceSession)
      if (page === 'cover') {
        const exported = await download('[data-card-export="0"]', 'background-' + bg, '.png')
        await pixelCompare(reed, exported, 'background-' + bg)
      }
      const left = 'data:image/png;base64,' + fs.readFileSync(reference).toString('base64')
      const right = 'data:image/png;base64,' + fs.readFileSync(reed).toString('base64')
      const joined = await evaluate(`(async()=>{const load=async src=>{const i=new Image();i.src=src;await i.decode();return i};const [a,b]=await Promise.all([load(${JSON.stringify(left)}),load(${JSON.stringify(right)})]);const c=document.createElement('canvas');c.width=1080;c.height=720;const ctx=c.getContext('2d');ctx.drawImage(a,0,0,540,720);ctx.drawImage(b,540,0,540,720);return c.toDataURL('image/png')})()`)
      fs.writeFileSync(path.join(output, `compare-${bg}-${page}.png`), Buffer.from(joined.split(',')[1], 'base64'))
    }
  }
  evidence.reference.geometry = await evaluate(`(() => {const card=document.querySelector('.card');const body=card.querySelector('.card-body');const cover=card.querySelector('.cover');return {width:card.offsetWidth,height:card.offsetHeight,coverPadding:getComputedStyle(cover).padding,coverTitleSize:getComputedStyle(cover.querySelector('h1')).fontSize,bodyFont:body?getComputedStyle(body).fontSize:null}})()`, referenceSession)
  check('reference screenshots captured for all five backgrounds', ['paper','white','grid','tint','night'].every((bg) => fs.existsSync(path.join(output, `compare-${bg}-body.png`))))
  await shot('final-cards')
} catch (error) {
  check('acceptance script completes', false, error.stack || String(error))
  if (send && sessionId) try { await shot('failure') } catch { /* browser may have exited */ }
} finally {
  evidence.checks = checks
  evidence.exceptions = exceptions
  evidence.consoleErrors = consoleErrors
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(rootOutput, 'latest.json'), JSON.stringify({ output, passed: checks.every((item) => item.passed), checks: checks.length }, null, 2))
  ws?.close()
  chrome?.kill()
  app.kill()
  await new Promise((resolve) => worker.close(resolve))
  console.log(`\nEvidence: ${output}`)
  const failed = checks.filter((item) => !item.passed)
  console.log(failed.length ? `${failed.length} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
  process.exitCode = failed.length ? 1 : 0
}
