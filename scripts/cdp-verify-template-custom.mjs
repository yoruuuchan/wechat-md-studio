// Real Chrome acceptance for template colour / font picks. Run after npm run build:
// node scripts/cdp-verify-template-custom.mjs [appPort=3295] [cdpPort=9405]
// Owns only this worktree's test-custom-cdp.db, a local file server and a fresh
// Chrome profile. The uploaded test font is KaTeX_Main-Regular.ttf from
// node_modules (a dependency already installed for formulas); nothing private
// and no external page is visited.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const port = Number(process.argv[2] || 3295)
const cdpPort = Number(process.argv[3] || 9405)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const workerOrigin = `http://127.0.0.1:${workerPort}`
const output = path.resolve('verify-out/template-custom', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-custom-'))
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

const TEST_FONT = path.resolve('node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf')
const testFontBytes = fs.readFileSync(TEST_FONT)
const worker = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  if (pathname === '/test-font.ttf') {
    res.writeHead(200, { 'content-type': 'font/ttf', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' })
    res.end(testFontBytes); return
  }
  res.writeHead(404).end('missing')
})
await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))

fs.mkdirSync(path.resolve('data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve('data/test-custom-cdp.db' + suffix), { force: true })
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: 'file:./data/test-custom-cdp.db', ANON_GC_ENABLED: 'false',
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

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
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
  // Record every SVG html-to-image paints, so the embedded @font-face rules
  // of an export can be read back.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('mopai.onboarding.v1','done');localStorage.setItem('mopai.lang.v1','zh')}catch{}
    window.__svgShots=[];(()=>{const d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,get(){return d.get.call(this)},set(v){if(typeof v==='string'&&v.startsWith('data:image/svg+xml'))window.__svgShots.push(v);d.set.call(this,v)}})})()` })
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
    await sleep(150)
  }
  const shot = async (name) => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(data, 'base64'))
  }
  const platformFonts = async (selector) => {
    const { root } = await call('DOM.getDocument', { depth: 0 })
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error('font probe missing: ' + selector)
    const { fonts } = await call('CSS.getPlatformFontsForNode', { nodeId })
    return fonts.map((font) => `${font.familyName}${font.isCustomFont ? '' : ' (system)'}`)
  }
  const cardsReady = async () => {
    await sleep(400)
    // A reload brings the editor back in article mode.
    if (!await evaluate(`!!document.querySelector('[data-xhs-view]')`)) await click('[data-preview-mode="cards"]')
    await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true'`, 'cards ready', 60000)
    await sleep(300)
  }
  const longReady = () => waitFor(`document.querySelector('[data-long-view]')?.dataset.longLayout === 'ready'`, 'long ready', 60000)
  const setMarkdown = async (text) => {
    await evaluate(`(()=>{const view=window.__mopaiCodemirror;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:${JSON.stringify(text)}}});return true})()`)
    await sleep(600)
  }
  const cardVar = (name) => evaluate(`getComputedStyle(document.querySelector('.xhs-card')).getPropertyValue(${JSON.stringify(name)}).trim()`)
  const setColor = async (name, hex) => {
    await evaluate(`(()=>{const input=document.querySelector('[data-customize-color="${name}"] input[type=color]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,${JSON.stringify(hex)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    await sleep(500)
  }
  const setFont = async (name, value) => {
    await evaluate(`(()=>{const select=document.querySelector('[data-customize-font="${name}"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(select,${JSON.stringify(value)});select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
    await sleep(500)
  }
  const exportFirstCard = async () => {
    await evaluate(`window.__svgShots=[]`)
    const directory = path.join(output, 'downloads-' + Date.now())
    fs.mkdirSync(directory, { recursive: true })
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true })
    await click('[data-card-export="0"]')
    const end = Date.now() + 60000
    while (Date.now() < end) {
      const files = fs.readdirSync(directory)
      if (files.some((file) => file.endsWith('.png')) && !files.some((file) => file.endsWith('.crdownload'))) break
      await sleep(200)
    }
    const file = fs.readdirSync(directory).find((name) => name.endsWith('.png'))
    const svg = await evaluate(`decodeURIComponent((window.__svgShots.at(-1)||'').replace(/^data:image\\/svg\\+xml;charset=utf-8,/,''))`)
    const faces = [...svg.matchAll(/@font-face\s*\{[^}]*\}/g)].map(([rule]) => ({
      family: rule.match(/font-family:\s*["']?([^;"']+)/)?.[1] ?? '',
      bytes: rule.length,
      format: rule.match(/format\(["']?([^"')]+)/)?.[1] ?? '',
    }))
    return { file: file ? path.join(directory, file) : null, faces }
  }

  await call('Page.navigate', { url: origin + '/' })
  await waitFor(`!!window.__mopaiCodemirror`, 'editor', 60000)
  await sleep(1200)
  // The uploaded test font only has Latin glyphs, so the title carries a Latin word.
  await setMarkdown(['# Reed 换一种字和颜色', '', 'Reed 芦苇的卡片', '', '## 第一节', '', '正文段落，Reed 写在这里。', '', '- 要点一', '- 要点二', ''].join('\n'))

  // ---- public card template --------------------------------------------------
  await click('[data-preview-mode="cards"]')
  await waitFor(`!!document.querySelector('[data-card-template="custom.public-editorial-white"]:not([disabled])')`, 'public templates', 60000)
  await click('[data-card-template="custom.public-editorial-white"]')
  await cardsReady()
  // The closing page has no content slot: it must follow the article, not
  // replace its last page (this once dropped the last page's text).
  const pageKinds = await evaluate(`[...document.querySelectorAll('.xhs-card')].map(card=>card.dataset.cardKind)`)
  check('a closing page without a content slot is added after the text', pageKinds.join() === 'cover,body,end' &&
    await evaluate(`[...document.querySelectorAll('.xhs-card')].some(card=>card.textContent.includes('正文段落'))`), pageKinds)
  const panel = await evaluate(`(()=>{const el=document.querySelector('[data-template-customizer="card"]');return el?{colors:[...el.querySelectorAll('[data-customize-color]')].map(e=>e.dataset.customizeColor),fonts:[...el.querySelectorAll('[data-customize-font]')].map(e=>e.dataset.customizeFont)}:null})()`)
  check('a public card template shows its declared colour and font slots', panel && panel.colors.join() === '--accent,--title-ink,--body-ink,--muted,--paper' && panel.fonts.join() === '--display,--body-font', panel)
  const defaultAccent = await cardVar('--accent')
  const swatch = await evaluate(`document.querySelector('[data-customize-color="--accent"] input').value`)
  check('the accent swatch starts at the template’s own colour', swatch.toLowerCase() === defaultAccent.toLowerCase() || defaultAccent.toLowerCase().includes(swatch.slice(1).toLowerCase()), { swatch, defaultAccent })
  await shot('01-default')

  await setColor('--accent', '#d81b60')
  await setColor('--paper', '#fff4e0')
  await cardsReady()
  check('a picked colour reaches every card page', await evaluate(`[...document.querySelectorAll('.xhs-card')].every(card=>getComputedStyle(card).getPropertyValue('--accent').trim()==='#d81b60')`), await cardVar('--accent'))
  check('the paper colour paints the card ground', await evaluate(`getComputedStyle(document.querySelector('.xhs-card')).backgroundColor`) === 'rgb(255, 244, 224)', await evaluate(`getComputedStyle(document.querySelector('.xhs-card')).backgroundColor`))
  check('the reset button appears once something is changed', await evaluate(`!!document.querySelector('[data-customize-reset]')`))
  const before = await exportFirstCard()

  await setFont('--display', 'builtin:LXGW WenKai')
  await cardsReady()
  check('choosing an included font links its stylesheet on demand', await evaluate(`!!document.querySelector('link[data-font-sheet="LXGW WenKai"]')`))
  const titleFonts = await platformFonts('.xhs-card h1')
  check('the cover title is drawn with the picked included font', titleFonts.some((name) => name === 'LXGW WenKai'), titleFonts)
  const bodyFonts = await platformFonts('.xhs-card[data-card-kind="body"] .xhs-card-content p')
  check('the body slot keeps the template font', !bodyFonts.some((name) => name.startsWith('LXGW')), bodyFonts)
  const withKai = await exportFirstCard()
  check('the export embeds the picked included font', withKai.faces.some((face) => face.family === 'LXGW WenKai'), withKai.faces.map((face) => face.family))
  check('the export picture changes with the font', before.file && withKai.file && !fs.readFileSync(before.file).equals(fs.readFileSync(withKai.file)))
  await shot('02-colour-and-kai')

  // Picks survive a reload.
  await call('Page.reload')
  await waitFor(`!!window.__mopaiCodemirror`, 'editor after reload', 60000)
  await sleep(1200)
  await cardsReady()
  check('colour and font picks survive a reload', await cardVar('--accent') === '#d81b60' &&
    (await platformFonts('.xhs-card h1')).includes('LXGW WenKai'))

  // ---- a font from this computer ---------------------------------------------
  await evaluate(`(async()=>{const r=await fetch('${workerOrigin}/test-font.ttf');const b=await r.blob();const f=new File([b],'测试字体.ttf',{type:'font/ttf'});const dt=new DataTransfer();dt.items.add(f);const input=document.querySelector('[data-customize-font-file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await waitFor(`document.querySelectorAll('[data-customize-my-fonts] li').length === 1`, 'user font listed', 20000)
  const userValue = await evaluate(`[...document.querySelectorAll('[data-customize-font="--display"] option')].find(o=>o.value.startsWith('user:'))?.value || ''`)
  check('an added font appears in the font menu', userValue.startsWith('user:'), userValue)
  await setFont('--display', userValue)
  await cardsReady()
  const userTitle = await platformFonts('.xhs-card h1')
  // Chrome names a web font by its own name table (KaTeX_Main), not the registered family.
  const usesUserFont = async () => (await platformFonts('.xhs-card h1')).includes('KaTeX_Main') &&
    (await evaluate(`getComputedStyle(document.querySelector('.xhs-card h1')).fontFamily`)).includes('Reed User Font')
  check('the title uses the added font for the glyphs it has', await usesUserFont(), userTitle)
  const withUser = await exportFirstCard()
  const userFace = withUser.faces.find((face) => face.family.startsWith('Reed User Font'))
  check('the export embeds the added font as a subset, not the whole file', userFace && userFace.format === 'truetype' && userFace.bytes < testFontBytes.length, { userFace, original: testFontBytes.length })
  await call('Page.reload')
  await waitFor(`!!window.__mopaiCodemirror`, 'editor after reload', 60000)
  await sleep(1500)
  await cardsReady()
  check('an added font is still there after a reload', await usesUserFont())
  await click('[data-customize-my-fonts] li button')
  await waitFor(`!document.querySelector('[data-customize-my-fonts]')`, 'user font deleted', 20000)
  await cardsReady()
  check('deleting the font returns its slot to the template default', await evaluate(`document.querySelector('[data-customize-font="--display"]').value`) === '' &&
    !(await platformFonts('.xhs-card h1')).includes('KaTeX_Main'))

  await click('[data-customize-reset]')
  await cardsReady()
  check('reset returns colours to the template’s own', await cardVar('--accent') === defaultAccent && !await evaluate(`!!document.querySelector('[data-customize-reset]')`), await cardVar('--accent'))

  // ---- Reed's built-in card ----------------------------------------------------
  await click('[data-card-template="reed"]')
  await cardsReady()
  const reedPanel = await evaluate(`(()=>{const el=document.querySelector('[data-template-customizer="card"]');return el?{colors:[...el.querySelectorAll('[data-customize-color]')].map(e=>e.textContent.trim()),fonts:el.querySelectorAll('[data-customize-font]').length}:null})()`)
  check('Reed’s own card offers its accent and font', reedPanel && reedPanel.colors.join() === '主色' && reedPanel.fonts === 1, reedPanel)
  await setFont('--font-ui', 'builtin:Smiley Sans')
  await cardsReady()
  const reedFonts = await platformFonts('.xhs-card[data-card-kind="body"] .xhs-card-content p')
  check('Reed’s card body switches to the picked font', reedFonts.some((name) => name.startsWith('Smiley Sans')), reedFonts)
  check('the picked font does not leak into the editor UI', !(await platformFonts('[data-preview-mode="cards"]')).includes('Smiley Sans'))
  await setFont('--font-ui', '')
  await cardsReady()

  // ---- long image ------------------------------------------------------------
  await setMarkdown(['# 长图', '', '一句副标题', '', '## 第一节', '', '这一节的导语。', '', '正文。', ''].join('\n'))
  await click('[data-preview-mode="long"]')
  await longReady()
  const labelFonts = await platformFonts('.reed-long-section-label')
  check('the blue template’s labels load Zhuque Fangsong in the preview', labelFonts.some((name) => name.startsWith('Zhuque Fangsong')) && await evaluate(`!!document.querySelector('link[data-font-sheet="Zhuque Fangsong"]')`), labelFonts)
  check('a long template without slots shows no customizer', !await evaluate(`!!document.querySelector('[data-template-customizer]')`))
  await shot('03-long')

  const cspErrors = errors.filter((text) => /Content Security Policy|wasm/i.test(text))
  check('no CSP or WebAssembly errors', cspErrors.length === 0, cspErrors.slice(0, 3))
  check('no page errors', errors.length === 0, errors.slice(0, 5))
} catch (error) {
  check('run completed', false, error instanceof Error ? error.stack : String(error))
} finally {
  try { ws?.close() } catch { }
  chrome?.kill()
  const exited = new Promise((resolve) => app.once('exit', resolve))
  app.kill()
  await Promise.race([exited, sleep(5000)])
  worker.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve('data/test-custom-cdp.db' + suffix), { force: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2))
  const failed = checks.filter((item) => !item.passed).length
  console.log(`\n${checks.length - failed}/${checks.length} passed; report ${output}`)
  process.exitCode = failed ? 1 : 0
}
