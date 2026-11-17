// B05 editor-font acceptance: read the fonts Chrome actually painted, not the
// CSS declaration. Probes four separate source lines (Chinese, Latin, digits,
// CJK+Latin punctuation) plus the Chinese completion detail labels, at1440px,
// in the light and dark UI themes, and saves screenshots + evidence JSON.
//
// Self-contained: starts its own production app (dist/boot.js), mock image
// worker and headless Chrome; seeds one short local article.
//
// Usage: node scripts/cdp-verify-editor-fonts.mjs [appPort=4128] [cdpPort=9728] [outputDir] [label=after]
// Requires `npm run build`.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])
  delete process.env[key]
const port = Number(process.argv[2] || 4128)
const cdpPort = Number(process.argv[3] || 9728)
const output = path.resolve(process.argv[4] || 'verify-out/editor-fonts')
const label = process.argv[5] || 'after'
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-editor-fonts-'))
fs.mkdirSync(output, { recursive: true })

const CHINESE = '中文字体回退'
const LATIN = 'Latin AbC xyz'
const DIGITS = 'Digits0123456789'
const PUNCT = '标点，。！？；：、（）「」——…'
const seedDoc = '#字体验收\n\n第一段。\n'
const checks = []
const exceptions = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
}

async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(value, '127.0.0.1', resolve)
  })
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

try {
  if (!fs.existsSync('dist/boot.js')) throw new Error('dist/boot.js is missing; run `npm run build` first')
  await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: randomBytes(24).toString('hex'),
      SESSION_SECRET: randomBytes(32).toString('hex'),
      IMG_BASE_URL: `http://127.0.0.1:${workerPort}`,
      IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
      AGENT_TOKENS: '',
      ANON_GC_ENABLED: 'false',
      PUBLIC_BASE_URL: origin,
      RESEND_API_KEY: '',
      RESEND_FROM: '',
      FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => {
    appLog += data
  })
  app.stderr.on('data', (data) => {
    appLog += data
  })
  let up = false
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(origin)).ok) {
        up = true
        break
      }
    } catch {
      /* starting */
    }
    if (app.exitCode !== null) throw new Error(`Application exited: ${appLog}`)
    await sleep(200)
  }
  if (!up) throw new Error(`Application did not start: ${appLog}`)
  chrome = spawn(
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-proxy-server',
      '--window-size=1440,900',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${path.join(temporary, 'chrome')}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  let endpoint
  for (let i = 0; i < 100; i += 1) {
    try {
      endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl
    } catch {
      /* starting */
    }
    if (endpoint) break
    await sleep(200)
  }
  if (!endpoint) throw new Error('Chrome did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  let sequence = 0
  const pending = new Map()
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 25_000)
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
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('DOM.enable')
  await call('CSS.enable')
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
 try {
 localStorage.setItem('mopai.onboarding.v1', 'done')
 localStorage.setItem('mopai.lang.v1', 'zh')
 localStorage.setItem('mopai.theme.v1', 'akari')
 localStorage.setItem('mopai.docs.v1', ${JSON.stringify(JSON.stringify([{ id: 'b05-fonts', name: 'B05字体', content: seedDoc, updatedAt: 1000, savedAt: null, deletedAt: null }]))})
 localStorage.setItem('mopai.active.v1', 'b05-fonts')
 } catch {}
 `,
  })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, labelText, timeout = 15_000) => {
    const until = Date.now() + timeout
    let result
    while (Date.now() < until) {
      result = await evaluate(expression)
      if (result) return result
      await sleep(100)
    }
    throw new Error(`${labelText} timed out; last=${JSON.stringify(result)}`)
  }
  const screenshot = async (name) => {
    await sleep(250)
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, `${name}-${label}.png`), Buffer.from(shot.data, 'base64'))
  }
  /** Node ids for every element matching a selector, in document order. */
  const nodeIdsFor = async (selector) => {
    const { root } = await call('DOM.getDocument', { depth: -1 })
    const { nodeIds } = await call('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
    return nodeIds
  }
  /** Chrome's own answer: which fonts painted this node. */
  const platformFonts = async (nodeId) => {
    const { fonts } = await call('CSS.getPlatformFontsForNode', { nodeId })
    return fonts ?? []
  }
  const samples = async () => {
    const lines = await evaluate(`[...document.querySelectorAll('.cm-line')].map((el) => el.textContent)`)
    return lines
  }
  const findLineNodeIds = async (markers) => {
    const lines = await samples()
    const ids = await nodeIdsFor('.cm-line')
    const out = {}
    for (const [key, marker] of Object.entries(markers)) {
      const index = lines.findIndex((text) => text.includes(marker))
      if (index < 0) throw new Error(`line not found: ${marker}`)
      out[key] = { nodeId: ids[index], text: lines[index] }
    }
    return out
  }
  const allCustom = (fonts) => fonts.length > 0 && fonts.every((font) => font.isCustomFont)
  const customFamily = (fonts, prefix) => fonts.find((font) => font.isCustomFont && font.familyName.startsWith(prefix))

  await call('Page.navigate', { url: origin })
  await waitFor(`Boolean(window.__mopaiCodemirror && document.querySelector('.cm-content'))`, 'editor ready')
  await sleep(400)
  // Append four probe lines, one per glyph class, and keep the whole article
  // short enough that CodeMirror renders all of them.
  await evaluate(`(() => {
 const view = window.__mopaiCodemirror
 const insert = ${JSON.stringify(`\n${CHINESE}\n${LATIN}\n${DIGITS}\n${PUNCT}\n`)}
 view.dispatch({ changes: { from: view.state.doc.length, insert }, selection: { anchor: view.state.doc.length } })
 view.focus()
 return view.state.doc.toString()
 })()`)
  await sleep(600)
  const lineInfo = await findLineNodeIds({ chinese: CHINESE, latin: LATIN, digits: DIGITS, punct: PUNCT })
  const fonts = {}
  for (const [key, info] of Object.entries(lineInfo)) fonts[key] = await platformFonts(info.nodeId)
  const css = await evaluate(`(() => {
 const line = document.querySelector('.cm-line')
 const content = document.querySelector('.cm-content')
 return {
 line: getComputedStyle(line).fontFamily,
 content: getComputedStyle(content).fontFamily,
 }
 })()`)
  const evidence = { css, lines: lineInfo, fonts }

  check(
    'Chinese source text paints with the bundled Noto Sans SC',
    Boolean(customFamily(fonts.chinese, 'Noto Sans SC')),
    fonts.chinese,
  )
  check('Chinese source text has no system-font fallback', allCustom(fonts.chinese), fonts.chinese)
  check('Latin source text keeps Geist Mono', Boolean(customFamily(fonts.latin, 'Geist Mono')), fonts.latin)
  check('Latin source text has no system-font fallback', allCustom(fonts.latin), fonts.latin)
  check('Digits keep Geist Mono', Boolean(customFamily(fonts.digits, 'Geist Mono')), fonts.digits)
  check('Digits have no system-font fallback', allCustom(fonts.digits), fonts.digits)
  check('CJK and Latin punctuation stay on bundled fonts', allCustom(fonts.punct), fonts.punct)

  // The Chinese completion detail labels must use the same stack.
  await evaluate(`(() => {
 const view = window.__mopaiCodemirror
 view.dispatch({ selection: { anchor: view.state.doc.length } })
 view.focus()
 return true
 })()`)
  await call('Input.insertText', { text: '\n::' })
  await waitFor(`!!document.querySelector('.cm-tooltip-autocomplete')`, 'completion popup', 15_000)
  await sleep(300)

  await screenshot('editor-fonts-light')
  await evaluate(`document.documentElement.dataset.theme = 'yoru'`)
  await sleep(400)
  await screenshot('editor-fonts-dark')
  await evaluate(`document.documentElement.dataset.theme = 'akari'`)
  await sleep(200)

  evidence.checks = checks
  evidence.exceptions = exceptions
  fs.writeFileSync(
    path.join(output, `editor-fonts-${label}.json`),
    JSON.stringify(
      { measuredAt: new Date().toISOString(), app: origin, label, ...evidence, appLog: appLog.slice(-4000) },
      null,
      2,
    ),
  )
  console.log(
    `\n${checks.filter((item) => item.passed).length}/${checks.length} checks passed; evidence: ${path.join(output, `editor-fonts-${label}.json`)}`,
  )
} catch (error) {
  check('editor-font runner completes', false, error.stack || error.message)
  fs.writeFileSync(
    path.join(output, `editor-fonts-${label}.json`),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        label,
        checks,
        exceptions,
        appLog,
        runnerError: String(error.stack || error.message),
      },
      null,
      2,
    ),
  )
} finally {
  ws?.close()
  await stop(chrome)
  await stop(app)
  worker.closeAllConnections()
  await new Promise((resolve) => worker.close(resolve))
  fs.writeFileSync(path.join(output, `editor-fonts-${label}.app.log`), appLog)
}
const failed = checks.filter((item) => !item.passed)
if (failed.length) console.log(`\nfailed: ${failed.map((item) => item.name).join('; ')}`)
process.exitCode = failed.length ? 1 : 0
