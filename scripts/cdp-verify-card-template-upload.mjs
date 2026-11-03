// Browser acceptance for uploaded card templates. Run after `npm run build`:
//   node scripts/cdp-verify-card-template-upload.mjs [appPort=3201] [cdpPort=9334] [outputDir]
//
// Only the public example template is used. The script packs it from
// examples/card-templates/example, uploads it through the real file input,
// checks the picker / preview / PNG / ZIP / reload / delete path, rejects a
// malicious package, and compares the preview DOM with an exported PNG.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

const port = Number(process.argv[2] || 3201)
const cdpPort = Number(process.argv[3] || 9334)
const output = path.resolve(process.argv[4] || 'verify-out/card-template-upload')
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-card-template-'))
const checks = []
const evidence = { output, checks, screenshots: [], exports: [], pixels: [] }
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

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMAAAAwBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const worker = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' })
  res.end(pixel)
})
await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))

const exampleZip = path.join(output, 'example.reedcard')
const packed = spawn(process.execPath, [
  'scripts/cards/pack-template.mjs', path.resolve('examples/card-templates/example'), exampleZip,
], { stdio: ['ignore', 'pipe', 'pipe'] })
let packLog = ''
packed.stdout.on('data', (data) => { packLog += data })
packed.stderr.on('data', (data) => { packLog += data })
await new Promise((resolve) => packed.on('exit', resolve))
if (!fs.existsSync(exampleZip)) throw new Error('example template was not packed: ' + packLog)

const malicious = new JSZip()
malicious.file('manifest.json', JSON.stringify({
  format: 'reed-card-template', formatVersion: 1, id: 'evil', name: 'Evil', version: '1.0.0',
  author: 'test', description: '', ratios: ['3:4'], defaultRatio: '3:4',
  variants: [{ id: 'default', name: 'Default', dark: false, tokens: {} }],
  metrics: {
    padX: 40, padTop: 52, padBottom: 76, contentWidth: 460, headerTop: 22, footerBottom: 26,
    coverInsetX: 48, coverInsetY: 56, coverFootBottom: 40, coverReserve: 156,
    coverTitleSize: [56, 48, 42, 36, 30], coverSmallScale: 0.86,
  },
  fonts: [{ source: 'builtin', family: 'Noto Sans SC', weights: [400] }],
  pages: { cover: 'pages/cover.html', body: 'pages/body.html' },
  styles: ['styles/template.css'],
}))
malicious.file('pages/cover.html', '<div data-slot="title"></div><script>alert(1)</script>')
malicious.file('pages/body.html', '<div data-slot="content"></div>')
malicious.file('styles/template.css', 'p { margin: 0; }')
const maliciousZip = path.join(output, 'malicious.reedcard')
fs.writeFileSync(maliciousZip, await malicious.generateAsync({ type: 'nodebuffer' }))

fs.mkdirSync(path.resolve('data'), { recursive: true })
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: 'file:./data/test-card-template.db', ANON_GC_ENABLED: 'false',
    IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
    ACCESS_KEY: randomBytes(24).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'), AGENT_TOKENS: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (data) => { appLog += data })
app.stderr.on('data', (data) => { appLog += data })

const DRAFT = `# 示例模板验收：从上传到导出

用固定的短稿检查封面、正文、结尾与导出。

## 第一页正文

模板文件和内置模板共用同一条分页、标题适配和导出管线。**这是粗体**，还有 \`行内代码\`。

> 引用也需要保留自己的节奏。

- 列表第一项
- 列表第二项
- 列表第三项

---

## 结尾

到这里，应该看到独立结尾页。`

let chrome
let ws
let send
let sessionId
const exceptions = []
const consoleErrors = []

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, timeout = 45000) {
  const end = Date.now() + timeout
  do {
    if (await evaluate(expression)) return
    await sleep(120)
  } while (Date.now() < end)
  throw new Error('waitFor: ' + expression.slice(0, 220))
}
async function click(selector) {
  if (!await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true })()`)) {
    throw new Error('missing or disabled control: ' + selector)
  }
  await sleep(80)
}
async function cardsReady() {
  await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true'`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(100)
}
async function shot(name) {
  await send('Page.bringToFront', {}, sessionId)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
  const file = path.join(output, name + '.png')
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  evidence.screenshots.push(file)
  return file
}
async function upload(file) {
  const { root } = await send('DOM.getDocument', { depth: -1 }, sessionId)
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-card-template-file]' }, sessionId)
  if (!nodeId) throw new Error('template file input missing')
  const before = await evaluate(`document.querySelectorAll('[data-card-template-item]').length`)
  await send('DOM.setFileInputFiles', { nodeId, files: [file] }, sessionId)
  return before
}
const dimensions = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
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
    const name = files.find((entry) => entry.endsWith(extension))
    if (name && !files.some((entry) => entry.endsWith('.crdownload'))) return path.join(directory, name)
    const error = await evaluate(`document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent`)
    if (error) throw new Error('export: ' + error)
    await sleep(200)
  }
  throw new Error('download timeout: ' + label)
}
async function nativeCardShot(index, name) {
  const box = await evaluate(`(() => {
    const original = document.querySelector('[data-card-index="${index}"]');
    if (!original) throw new Error('no card');
    const node = original.cloneNode(true); node.id = 'template-acceptance-shot';
    Object.assign(node.style, {position:'fixed',left:'8px',top:'8px',margin:'0',transform:'none',zIndex:'2147483647'});
    document.body.append(node); const r = node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`)
  await evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 80));
    return true;
  })()`)
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, clip: { ...box, scale: 2 },
  }, sessionId)
  const file = path.join(output, name + '.png')
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  await evaluate(`document.querySelector('#template-acceptance-shot')?.remove()`)
  return file
}
async function pixelCompare(domFile, pngFile, label) {
  const dom = 'data:image/png;base64,' + fs.readFileSync(domFile).toString('base64')
  const exported = 'data:image/png;base64,' + fs.readFileSync(pngFile).toString('base64')
  const metrics = await evaluate(`(async () => {
    const load = async (src) => { const img = new Image(); img.src = src; await img.decode(); return img };
    const [a, b] = await Promise.all([load(${JSON.stringify(dom)}), load(${JSON.stringify(exported)})]);
    const w = 540, h = Math.round(b.height / 2); const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(a, 0, 0, w, h); const p = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h); ctx.drawImage(b, 0, 0, w, h); const q = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, bad = 0;
    for (let i = 0; i < p.length; i += 4) {
      let max = 0;
      for (let j = 0; j < 3; j++) { const d = Math.abs(p[i+j] - q[i+j]); sum += d; if (d > max) max = d }
      if (max > 16) bad++;
    }
    return { mean: sum / (w * h * 3), bad: bad / (w * h) };
  })()`)
  evidence.pixels.push({ label, ...metrics })
  check(label + ': preview DOM and PNG agree', metrics.mean < 2 && metrics.bad < 0.025, metrics)
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
  await evaluate(`(() => { const view = window.__mopaiCodemirror; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(DRAFT)} } }); return true })()`)
  await click('[data-preview-mode="cards"]')
  await cardsReady()

  check('empty state explains the .reedcard format', await evaluate(`!!document.querySelector('[data-card-templates]') && document.querySelector('[data-card-template-item]') === null`))
  await shot('my-templates-empty')
  const pickerBefore = await evaluate(`document.querySelectorAll('[data-card-template]').length`)

  const before = await upload(exampleZip)
  await waitFor(`document.querySelectorAll('[data-card-template-item]').length > ${before}`)
  const customId = await evaluate(`document.querySelector('[data-card-template-item]')?.dataset.cardTemplateItem || null`)
  check('upload adds the template to "My templates"', Boolean(customId))
  check('upload adds a marked template button to the picker', await evaluate(`!!document.querySelector('[data-card-template-custom]')`))
  check('picker grew by one', await evaluate(`document.querySelectorAll('[data-card-template]').length`) === pickerBefore + 1)
  check('uploaded template is selected automatically', await evaluate(`document.querySelector('[data-card-template-custom]')?.getAttribute('aria-pressed') === 'true'`))
  await cardsReady()
  check('uploaded template renders a cover and at least two body pages', await evaluate(`document.querySelectorAll('.xhs-card').length >= 3`))
  check('example template uses its own end page', await evaluate(`!!document.querySelector('[data-card-index]:last-child .example-end')`))
  await shot('my-templates-populated')
  await shot('example-preview')

  const count = await evaluate(`document.querySelectorAll('.xhs-card').length`)
  const png = await download('[data-card-export="0"]', 'example-single', '.png')
  const size = dimensions(fs.readFileSync(png))
  check('single PNG is 1080px wide and the expected height', size.width === 1080 && size.height === 1440, size)
  evidence.exports.push({ label: 'single', file: png, ...size })

  const domCover = await nativeCardShot(0, 'example-cover-dom')
  await pixelCompare(domCover, png, 'example cover')
  const last = count - 1
  const endPng = await download(`[data-card-export="${last}"]`, 'example-end', '.png')
  const domEnd = await nativeCardShot(last, 'example-end-dom')
  await pixelCompare(domEnd, endPng, 'example end')

  const archive = await download('[data-card-export-all]', 'example-zip', '.zip')
  const zip = await JSZip.loadAsync(fs.readFileSync(archive), { checkCRC32: true })
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  const sizes = await Promise.all(entries.map(async (entry) => dimensions(await entry.async('nodebuffer'))))
  check('ZIP contains every card and every PNG has the export size', entries.length === count &&
    sizes.every((item) => item.width === 1080 && item.height === 1440), { count, entries: entries.length })
  evidence.exports.push({ label: 'zip', file: archive, pages: entries.length })

  check('bad bounds are absent from the uploaded preview', await evaluate(`(() => {
    const bad = [];
    for (const card of document.querySelectorAll('.xhs-card')) {
      const c = card.getBoundingClientRect(); const scale = c.width / 540;
      for (const el of card.querySelectorAll('*')) for (const r of el.getClientRects()) {
        if (!r.width || !r.height) continue;
        if (r.left < c.left - .7 || r.right > c.right + .7 || r.top < c.top - .7 || r.bottom > c.bottom + .7) bad.push(el.tagName);
      }
    }
    return bad.length;
  })() === 0`))

  await send('Page.reload', {}, sessionId)
  await waitFor('!!window.__mopaiCodemirror')
  await evaluate(`(() => { const view = window.__mopaiCodemirror; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(DRAFT)} } }); return true })()`)
  await click('[data-preview-mode="cards"]')
  await cardsReady()
  await waitFor(`document.querySelectorAll('[data-card-template-item]').length === 1`)
  check('uploaded template survives a reload', await evaluate(`document.querySelector('[data-card-template-item]')?.dataset.cardTemplateItem === ${JSON.stringify(customId)}`))
  await shot('my-templates-after-reload')

  await click('[data-card-template-custom]')
  await cardsReady()
  const errorBefore = await upload(maliciousZip)
  await waitFor(`!!document.querySelector('[data-card-template-error]')`)
  check('malicious package is rejected with a readable message', await evaluate(`document.querySelector('[data-card-template-error]')?.textContent?.includes('模板上传失败')`))
  check('malicious package is not added to the list', await evaluate(`document.querySelectorAll('[data-card-template-item]').length`) === errorBefore)
  await shot('my-templates-error')

  await evaluate(`window.confirm = () => true`)
  await click('[data-card-template-delete]')
  await waitFor(`document.querySelectorAll('[data-card-template-item]').length === 0`)
  check('delete removes the template from the list', await evaluate(`document.querySelector('[data-card-template-item]') === null`))
  await shot('my-templates-deleted')
  await send('Page.reload', {}, sessionId)
  await waitFor('!!window.__mopaiCodemirror')
  await click('[data-preview-mode="cards"]')
  await cardsReady()
  await waitFor(`!!document.querySelector('[data-card-templates]')`)
  check('delete survives a reload', await evaluate(`document.querySelectorAll('[data-card-template-item]').length === 0`))
  check('no uncaught page exceptions', exceptions.length === 0, exceptions.length)
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5))
  evidence.passed = checks.every((item) => item.passed)
} catch (error) {
  check('card template upload acceptance completes', false, error.stack || String(error))
  if (send && sessionId) try { await shot('failure') } catch { /* browser may have exited */ }
  evidence.passed = false
} finally {
  evidence.exceptions = exceptions
  evidence.consoleErrors = consoleErrors
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2))
  ws?.close()
  chrome?.kill()
  app.kill()
  await new Promise((resolve) => worker.close(resolve))
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* profile may still be locked */ }
  const failed = checks.filter((item) => !item.passed)
  console.log(failed.length ? `${failed.length} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
  process.exitCode = failed.length ? 1 : 0
}