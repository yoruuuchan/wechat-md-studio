// Production-browser acceptance for on-demand font sheets. The editor's first
// paint imports only the interface sheets; fonts-templates.css and
// fonts-design.css are linked when rendered theme HTML names one of their
// families. This check reads the entry stylesheet (no face from those sheets,
// no inlined font file), switches through themes that use those families and
// asks Chrome which font actually painted each probed Latin text.
// No production data or credentials.
// Usage: node scripts/cdp-verify-theme-fonts.mjs [appPort=4133] [cdpPort=9733] [outputDir]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]
const port = Number(process.argv[2] || 4133)
const cdpPort = Number(process.argv[3] || 9733)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-theme-fonts-'))
const output = path.resolve(process.argv[4] || path.join(temporary, 'evidence'))
fs.mkdirSync(output, { recursive: true })
const ON_DEMAND = ['/fonts/fonts-templates.css', '/fonts/fonts-design.css']
// Families declared only by the two on-demand sheets (the UI sheets cover Geist,
// Geist Mono, Noto Sans SC and Noto Serif SC 700).
const SHEET_FAMILIES = [
  'Caveat', 'EB Garamond', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter', 'JetBrains Mono', 'Noto Serif SC',
  'Anton', 'B612 Mono', 'Bebas Neue', 'Chakra Petch', 'DM Serif Display', 'DotGothic16', 'Instrument Sans',
  'Instrument Serif', 'Major Mono Display', 'Orbitron', 'Pixelify Sans', 'Press Start 2P', 'Rajdhani',
  'Share Tech Mono', 'Space Grotesk', 'Tinos', 'VT323',
]
// Reed's design themes plus a serif hand-ported one; several lead a font stack
// with one of those families in the default sample article.
// Display names come from the generated local catalog, as the preview label shows them.
const THEME_NAMES = Object.fromEntries([...fs.readFileSync('src/lib/themes-local-catalog.ts', 'utf8').matchAll(/"id": "([^"]+)",\s+"name": "([^"]+)"/g)].map((m) => [m[1], m[2]]))
const CASES = ['console-akari', 'kunlun-snowline', 'rift-daybreak', 'aozora-daylight', 'core-frost', 'paper-editorial', 'yoru-type', 'kihon-gin', 'graphite']
const checks = []
const exceptions = []
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
let app
let chrome
let ws
let appLog = ''
const worker = http.createServer((_req, res) => res.writeHead(404).end('inert test image service'))
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
}
const squash = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

try {
  await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: randomBytes(24).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'),
      IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
      AGENT_TOKENS: '', ANON_GC_ENABLED: 'false', PUBLIC_BASE_URL: origin,
      RESEND_API_KEY: '', RESEND_FROM: '', FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => { appLog += data })
  app.stderr.on('data', (data) => { appLog += data })
  let up = false
  for (let i = 0; i < 120; i++) {
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
  for (let i = 0; i < 100; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl } catch { /* starting */ }
    if (endpoint) break
    await sleep(200)
  }
  if (!endpoint) throw new Error('Chrome did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let sequence = 0
  const pending = new Map()
  const requested = []
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
    if (message.method === 'Network.requestWillBeSent') requested.push(new URL(message.params.request.url).pathname)
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('DOM.enable')
  await call('CSS.enable')
  // The theme for the next load is written before the app reads its settings,
  // so an unload-time save of the previous settings cannot undo it.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('mopai.onboarding.v1','done');localStorage.setItem('mopai.lang.v1','zh');const t=sessionStorage.getItem('font-check-theme');if(t){const s=JSON.parse(localStorage.getItem('mopai.settings.v1')||'{}');s.themeId=t;localStorage.setItem('mopai.settings.v1',JSON.stringify(s))}}` })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, timeout = 20_000) => {
    const until = Date.now() + timeout
    let result
    while (Date.now() < until) {
      result = await evaluate(expression)
      if (result) return result
      await sleep(150)
    }
    throw new Error(`${label} timed out; last=${JSON.stringify(result)}`)
  }
  const article = `document.querySelector('[data-preview-article]')`
  const ready = () => waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-preview-theme]') && !!(${article})`, 'editor and preview')
  const platformFonts = async (selector) => {
    const { root } = await call('DOM.getDocument', { depth: 0 })
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) return null
    const { fonts } = await call('CSS.getPlatformFontsForNode', { nodeId })
    return fonts
  }

  await call('Page.navigate', { url: origin })
  await ready()
  await sleep(1500)
  // The render-blocking entry stylesheet must not declare the shared sheets'
  // families any more; they arrive later through a linked sheet.
  const entryFaces = await evaluate(`(()=>{const out={};for(const sheet of document.styleSheets){if(!sheet.href||!sheet.href.includes('/assets/index-'))continue;for(const rule of sheet.cssRules){if(rule.type!==CSSRule.FONT_FACE_RULE)continue;const f=rule.style.getPropertyValue('font-family').replace(/["']/g,'').trim();out[f]=(out[f]||0)+1}}return out})()`)
  const leaked = SHEET_FAMILIES.filter((family) => family !== 'Noto Serif SC' && entryFaces[family])
  check('the entry stylesheet declares no family from the on-demand sheets', leaked.length === 0 && Object.keys(entryFaces).length > 0, { leaked, entryFamilies: Object.keys(entryFaces) })
  check('the entry stylesheet still declares the interface fonts', ['Geist', 'Geist Mono', 'Noto Sans SC'].every((family) => entryFaces[family] > 0), entryFaces)
  check('the entry stylesheet has no inlined font files', await evaluate(`[...document.styleSheets].filter(s=>s.href&&s.href.includes('/assets/index-')).every(s=>![...s.cssRules].some(r=>r.type===CSSRule.FONT_FACE_RULE&&r.style.getPropertyValue('src').includes('data:')))`))
  const uiFonts = await platformFonts('[data-preview-theme]')
  check('the interface label still paints in a web font', uiFonts?.some((font) => font.isCustomFont), uiFonts)

  const probed = new Set()
  for (const id of CASES) {
    await evaluate(`sessionStorage.setItem('font-check-theme',${JSON.stringify(id)});true`)
    await call('Page.reload')
    await sleep(300)
    await ready()
    // Wait until the theme's own output (not the golden fallback) is shown.
    await waitFor(`document.querySelector('[data-preview-theme]')?.textContent.includes(${JSON.stringify(THEME_NAMES[id])})`, `${id} label`)
    await sleep(600)
    await evaluate('document.fonts.ready.then(()=>true)')
    await sleep(1200)
    await evaluate('document.fonts.ready.then(()=>true)')
    const marked = await evaluate(`(()=>{
      const a=${article}; const out={};
      // Probe only an element's own Latin text: getPlatformFontsForNode counts
      // the node's direct text, and a Latin face rightly hands CJK glyphs on
      // to the next family in the stack.
      for (const el of a.querySelectorAll('*')) {
        const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('')
        if (!/[A-Za-z0-9]/.test(own)) continue
        const first=getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g,'')
        if (${JSON.stringify(SHEET_FAMILIES)}.includes(first) && !(first in out)) { const k='p'+Object.keys(out).length; el.setAttribute('data-font-probe',k); out[first]=k }
      }
      return out })()`)
    console.log(`  ${id}: probing ${Object.keys(marked).join(', ') || '(no on-demand family leads a stack here)'}`)
    for (const [family, probe] of Object.entries(marked)) {
      probed.add(family)
      const fonts = await platformFonts(`[data-font-probe="${probe}"]`)
      const painted = fonts?.find((font) => font.isCustomFont && squash(font.familyName).startsWith(squash(family)))
      check(`${id}: ${family} paints with the web font`, painted, fonts?.map((font) => `${font.familyName}${font.isCustomFont ? '' : ' (system)'}`))
    }
    await evaluate(`document.querySelectorAll('[data-font-probe]').forEach(el=>el.removeAttribute('data-font-probe'))`)
  }
  const fetched = ON_DEMAND.filter((sheet) => requested.includes(sheet))
  check('both shared sheets were fetched as separate stylesheets on demand', fetched.length === ON_DEMAND.length, fetched)
  // The default sample reaches seven families across these themes (2026-11-13).
  check('the themes exercise at least six on-demand families', probed.size >= 6, [...probed])
  const shot = await call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(output, 'last-theme.png'), Buffer.from(shot.data, 'base64'))
  check('no uncaught JavaScript exceptions', exceptions.length === 0, exceptions)
} catch (error) {
  check('theme font runner completes', false, error.stack || error.message)
} finally {
  ws?.close()
  await stop(chrome)
  await stop(app)
  worker.closeAllConnections()
  await new Promise((resolve) => worker.close(resolve))
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ origin, checks, exceptions, appLog, temporary }, null, 2))
}
const failed = checks.filter((item) => !item.passed).length
console.log(`${checks.length - failed}/${checks.length} passed; evidence: ${output}`)
process.exitCode = failed ? 1 : 0
