// A09 phone jump acceptance: a material row and a publish-check finding must
// both land on the right source line, and on a phone they must reveal the
// editor pane instead of leaving the side pane up.
//
// Self-contained: starts its own production app (dist/boot.js), mock image
// worker and headless Chrome, seeds one local article, runs at390px,320px and
//1536px, and writes screenshots + evidence JSON to the output directory.
//
// Usage: node scripts/cdp-verify-mobile-jump.mjs [appPort=4128] [cdpPort=9728] [outputDir] [label=after]
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
const output = path.resolve(process.argv[4] || 'verify-out/mobile-jump')
const label = process.argv[5] || 'after'
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-mobile-jump-'))
fs.mkdirSync(output, { recursive: true })

// The image line is the material the test taps; the empty image line is the
// publish blocker the preflight panel must jump to.
const IMAGE_LINE_ONE = '![已上传图注](img:a09-test.png)'
const PLACEHOLDER_LINE = '![待上传图注]()'
const fixture = ['#素材跳转', '', '第一段。', '', IMAGE_LINE_ONE, '', PLACEHOLDER_LINE, '', '第二段。', ''].join('\n')
const fixtureLines = fixture.split('\n')
const imageOneIndex = fixtureLines.indexOf(IMAGE_LINE_ONE)
const placeholderIndex = fixtureLines.indexOf(PLACEHOLDER_LINE)

const checks = []
const exceptions = []
const consoleErrors = []
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
      '--window-size=1536,1000',
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
 try {
 localStorage.setItem('mopai.onboarding.v1', 'done')
 localStorage.setItem('mopai.lang.v1', 'zh')
 localStorage.setItem('mopai.docs.v1', ${JSON.stringify(JSON.stringify([{ id: 'a09-jump', name: 'A09跳转', content: fixture, updatedAt: 1000, savedAt: null, deletedAt: null }]))})
 localStorage.setItem('mopai.active.v1', 'a09-jump')
 } catch {}
 `,
  })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, labelText, timeout = 12_000) => {
    const until = Date.now() + timeout
    let result
    while (Date.now() < until) {
      result = await evaluate(expression)
      if (result) return result
      await sleep(100)
    }
    throw new Error(`${labelText} timed out; last=${JSON.stringify(result)}`)
  }
  const click = async (expression) => {
    const position = await evaluate(
      `(() => { const el = ${expression}; if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width /2, y: r.y + r.height /2 } : null })()`,
    )
    if (!position) throw new Error(`no visible click target: ${expression}`)
    await sleep(120)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  const screenshot = async (name) => {
    await sleep(250)
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, `${name}-${label}.png`), Buffer.from(shot.data, 'base64'))
  }
  const ready = () =>
    waitFor(
      `Boolean(window.__mopaiCodemirror && document.querySelector('[data-topbar]') && document.querySelector('[data-preview-article]'))`,
      'editor readiness',
      20_000,
    )
  const setWidth = async (width, height = 844) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url: origin })
    await ready()
    await sleep(500)
  }
  const cursor = () =>
    evaluate(`(() => {
 const view = window.__mopaiCodemirror
 const line = view.state.doc.lineAt(view.state.selection.main.head).number
 return { line, text: view.state.doc.line(line).text }
 })()`)
  const editorVisible = () =>
    evaluate(`(() => {
 const pane = document.querySelector('[data-pane="editor"]')
 return pane ? getComputedStyle(pane).visibility !== 'hidden' : null
 })()`)
  const paneMode = () => evaluate(`document.querySelector('[data-pane-switcher]') ? 'phone' : 'wide'`)

  // A material row knows the zero-based parser line; jumpToLine shows line +1.
  const materialLine = fixtureLines.indexOf(IMAGE_LINE_ONE)
  const jumpToMaterial = async (width) => {
    await setWidth(width)
    await click(`document.querySelector('[data-pane-tab="side"]')`)
    await waitFor(
      `getComputedStyle(document.querySelector('[data-pane="side"]')).visibility !== 'hidden'`,
      `${width}px side pane visible`,
    )
    await click(`document.querySelector('[data-pane="side"] [data-side-tab="materials"]')`)
    const row = await waitFor(
      `(() => {
 const el = document.querySelector('[data-pane="side"] [data-material-jump]')
 return el ? { no: el.dataset.materialJump, line: Number(el.dataset.materialLine) } : null
 })()`,
      `${width}px material row`,
    )
    check(`${width}px: the material panel lists the image line`, Number.isFinite(row.line), row)
    await screenshot(`side-before-material-jump-${width}`)
    await click(`document.querySelector('[data-pane="side"] [data-material-jump]')`)
    const visible = await waitFor(
      `getComputedStyle(document.querySelector('[data-pane="editor"]')).visibility !== 'hidden'`,
      `${width}px editor pane after material jump`,
      8000,
    )
      .then(() => true)
      .catch(() => false)
    const landed = await cursor()
    check(`${width}px: tapping a material line reveals the editor pane`, visible === true, { visible, landed })
    check(`${width}px: the material jump lands on the image source line`, landed.line === row.line + 1, {
      target: row.line,
      landed,
    })
    check(
      `${width}px: the material jump leaves the caret on an image line`,
      landed.text.trim().startsWith('!['),
      landed,
    )
    await screenshot(`editor-after-material-jump-${width}`)
  }

  const jumpFromPreflight = async (width, phone) => {
    if (phone) {
      await click(`document.querySelector('[data-pane-tab="editor"]')`)
      await waitFor(
        `getComputedStyle(document.querySelector('[data-pane="editor"]')).visibility !== 'hidden'`,
        'editor pane before preflight',
      )
    }
    await click(`document.querySelector('[data-onboarding="copy"]')`)
    await waitFor(`!!document.querySelector('[data-preflight]')`, `${width}px preflight panel`, 15_000)
    await waitFor(`!!document.querySelector('[data-preflight-jump]')`, `${width}px preflight jump button`)
    const jump = await evaluate(
      `(() => { const el = document.querySelector('[data-preflight-jump]'); return { code: el.dataset.preflightJump } })()`,
    )
    await evaluate(`document.querySelector('[data-preflight-jump]').click()`)
    if (phone) {
      await waitFor(
        `getComputedStyle(document.querySelector('[data-pane="editor"]')).visibility !== 'hidden'`,
        `${width}px editor pane after preflight jump`,
        8000,
      )
    }
    const landed = await cursor()
    const dialogGone = await waitFor(`!document.querySelector('[data-preflight]')`, `${width}px preflight closed`, 8000)
      .then(() => true)
      .catch(() => false)
    check(`${width}px: jumping from the publish check returns to the editor pane`, dialogGone, {
      dialogGone,
      code: jump.code,
    })
    check(`${width}px: the publish-check jump lands on the flagged image line`, landed.line === (jump.code === 'image-placeholder' ? placeholderIndex + 1 : imageOneIndex + 1), {
      code: jump.code,
      target: placeholderIndex + 1,
      landed,
    })
    check(
      `${width}px: the publish-check jump leaves the caret on an image line`,
      landed.text.trim().startsWith('!['),
      landed,
    )
    await screenshot(`editor-after-preflight-jump-${width}`)
  }

  // ---- phone390 /320: material row then publish check ----
  await setWidth(390)
  check('390px: the phone layout starts on the editor pane', (await editorVisible()) === true)
  await jumpToMaterial(390)
  await jumpFromPreflight(390, true)
  await jumpToMaterial(320)
  await jumpFromPreflight(320, true)

  // ---- wide1536: the same landing helper, no layout change ----
  await setWidth(1536, 1000)
  check('1536px: the wide layout has no phone pane switcher', (await paneMode()) === 'wide')
  const materialVisible = await waitFor(
    `getComputedStyle(document.querySelector('aside')).visibility !== 'hidden'`,
    'wide sidebar visible',
  )
    .then(() => true)
    .catch(() => false)
  check('1536px: the wide sidebar is visible', materialVisible)
  await click(`document.querySelector('aside [data-side-tab="materials"]')`)
  const wideRow = await waitFor(
    `(() => {
 const el = document.querySelector('aside [data-material-jump]')
 return el ? { line: Number(el.dataset.materialLine) } : null
 })()`,
    'wide material row',
  )
  await click(`document.querySelector('aside [data-material-jump]')`)
  const wideLanded = await cursor()
  check('1536px: a material line still jumps in the wide layout', wideLanded.line === wideRow.line + 1, {
    target: wideRow.line,
    landed: wideLanded,
  })
  check(
    '1536px: the wide layout still has three columns',
    (await evaluate(`document.querySelectorAll('[data-slot="resizable-panel"]').length`)) === 3,
  )
  await screenshot(`editor-after-material-jump-1536`)

  const result = {
    measuredAt: new Date().toISOString(),
    app: origin,
    label,
    fixture: { imageOneIndex, placeholderIndex, imageOneLine: materialLine },
    checks,
    exceptions,
    consoleErrors,
  }
  fs.writeFileSync(path.join(output, `mobile-jump-${label}.json`), JSON.stringify(result, null, 2))
  console.log(
    `\n${checks.filter((item) => item.passed).length}/${checks.length} checks passed; evidence: ${path.join(output, `mobile-jump-${label}.json`)}`,
  )
} catch (error) {
  check('mobile jump runner completes', false, error.stack || error.message)
  fs.writeFileSync(
    path.join(output, `mobile-jump-${label}.json`),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        label,
        checks,
        exceptions,
        consoleErrors,
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
  fs.writeFileSync(path.join(output, `mobile-jump-${label}.app.log`), appLog)
}
const failed = checks.filter((item) => !item.passed)
if (failed.length) console.log(`\nfailed: ${failed.map((item) => item.name).join('; ')}`)
process.exitCode = failed.length ? 1 : 0
