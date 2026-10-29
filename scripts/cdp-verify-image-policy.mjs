// Real production-browser acceptance for image CSP / CORS (R08).
// Usage: node scripts/cdp-verify-image-policy.mjs [appPort=4108] [cdpPort=9708] [outputDir]
// A private mock worker listens on appPort + 100; an additional worker uses a
// free port. All processes, browser profiles and databases belong to this run.
// The HTTPS external-image fixture is fulfilled at Chrome's network boundary;
// the app -> 302 -> worker reads and crop uploads use actual HTTP servers.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete process.env[key]
const appPort = Number(process.argv[2] || 4108)
const cdpPort = Number(process.argv[3] || 9708)
const workerPort = appPort + 100
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-image-policy-'))
const output = path.resolve(process.argv[4] || path.join(temporary, 'evidence'))
fs.mkdirSync(output, { recursive: true })
const appUrl = `http://127.0.0.1:${appPort}`
const workerUrl = `http://127.0.0.1:${workerPort}`
const externalUrl = 'https://r08-images.example.test/picture.png'
const adminKey = 'image-policy-acceptance-admin-key'
const checks = []
const requests = []
const consoleErrors = []
const exceptions = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail: structuredClone(detail) }) })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
}

function fixturePng() {
  const chunk = (type, data) => {
    const size = Buffer.alloc(4)
    size.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([size, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(160, 0)
  header.writeUInt32BE(120, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.alloc((160 * 3 + 1) * 120, 145)
  for (let row = 0; row < 120; row++) pixels[row * (160 * 3 + 1)] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ])
}
const png = fixturePng()
const objects = new Map([['fixture.png', { body: png, type: 'image/png' }]])
let secondUrl = ''
let offline = false
const workerHandler = (req, res) => {
  requests.push({ host: req.headers.host, url: req.url, method: req.method })
  const url = new URL(req.url, 'http://127.0.0.1')
  if (offline) { req.socket.destroy(); return }
  if (url.pathname === '/api/upload' && req.method === 'PUT') {
    if (req.headers['x-admin-key'] !== adminKey) { res.writeHead(403).end(); return }
    const parts = []
    req.on('data', (part) => parts.push(part))
    req.on('end', () => {
      const key = url.searchParams.get('key')
      const body = Buffer.concat(parts)
      objects.set(key, { body, type: req.headers['content-type'] })
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ key, size: body.length }))
    })
    return
  }
  if (url.pathname === '/img/redirect.png') {
    res.writeHead(302, { Location: `${secondUrl}/img/fixture.png`, 'Access-Control-Allow-Origin': '*' }).end()
    return
  }
  const key = decodeURIComponent(url.pathname.slice('/img/'.length))
  const object = objects.get(key === 'no-cors.png' ? 'fixture.png' : key)
  if (!url.pathname.startsWith('/img/') || !object) { res.writeHead(404).end('image not found'); return }
  res.writeHead(200, {
    'Content-Type': object.type,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...(key === 'no-cors.png' ? {} : { 'Access-Control-Allow-Origin': '*' }),
  }).end(object.body)
}
const worker = http.createServer(workerHandler)
const secondWorker = http.createServer(workerHandler)
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', resolve)
})
async function checkPort(port) {
  const probe = net.createServer()
  await listen(probe, port)
  await new Promise((resolve) => probe.close(resolve))
}
await checkPort(appPort)
await checkPort(cdpPort)
await listen(worker, workerPort)
await listen(secondWorker, 0)
secondUrl = `http://127.0.0.1:${secondWorker.address().port}`
let app
let chrome
let socket
let appLogs = ''
let beforeRestart = async () => {}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
}
async function startApp(baseUrl) {
  await beforeRestart()
  await stop(app)
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(appPort),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: 'image-policy-acceptance-access-key',
      SESSION_SECRET: 'image-policy-acceptance-session-secret-0123456789',
      IMG_BASE_URL: baseUrl, IMG_ADMIN_KEY: adminKey, ANON_GC_ENABLED: 'false', AGENT_TOKENS: '',
      PUBLIC_BASE_URL: appUrl, RESEND_API_KEY: '', RESEND_FROM: '', FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => { appLogs += data })
  app.stderr.on('data', (data) => { appLogs += data })
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(appUrl)).ok) return } catch { /* starting */ }
    if (app.exitCode !== null) throw new Error(`App exited: ${appLogs}`)
    await sleep(150)
  }
  throw new Error(`App did not start: ${appLogs}`)
}

try {
  await startApp(workerUrl)
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run', '--window-size=1600,1000',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(temporary, 'chrome')}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let debuggerUrl
  for (let attempt = 0; attempt < 100; attempt++) {
    try { debuggerUrl = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl } catch { /* starting */ }
    if (debuggerUrl) break
    await sleep(150)
  }
  if (!debuggerUrl) throw new Error('Chrome did not start')
  socket = new WebSocket(debuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
  let messageId = 0
  const pending = new Map()
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++messageId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (pending.has(message.id)) {
      const { resolve, reject, timeout } = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(timeout)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.method === 'Fetch.requestPaused') {
      // A deterministic HTTPS picture without trusting a test TLS certificate
      // or depending on a public host. Chrome still enforces the page's CSP.
      const script = message.params.request.url.endsWith('.js')
      void send('Fetch.fulfillRequest', {
        requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: script ? 'text/javascript' : 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: (script ? Buffer.from('window.__r08BadScript = true') : png).toString('base64'),
      }, message.sessionId).catch((error) => consoleErrors.push(error.message))
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Fetch.enable', { patterns: [{ urlPattern: 'https://r08-images.example.test/*' }] })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(appUrl)}) { localStorage.setItem('mopai.lang.v1','zh'); localStorage.setItem('mopai.onboarding.v1','done'); } window.__r08Violations=[]; document.addEventListener('securitypolicyviolation', e => window.__r08Violations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));` })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, ms = 7000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(150) }
    return false
  }
  const screenshot = async (name) => {
    await sleep(350) // Let Radix's opening animation settle before the capture.
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
  }
  let navigation = 0
  const navigate = async () => {
    const query = `?r08=${++navigation}`
    await call('Page.navigate', { url: appUrl + query })
    // The editor shell mounts before IndexedDB hydration finishes. Waiting
    // only for .cm-content can send keystrokes before the saved body is ready.
    if (!await waitFor(`location.search===${JSON.stringify(query)} && document.querySelector('.cm-content[contenteditable="true"]')?.innerText.trim().length>0`, 20000)) throw new Error('Editor did not become editable')
    await evaluate(`document.querySelector('.driver-popover-close-btn')?.click()`)
  }
  const setArticle = async (source) => {
    await evaluate(`document.querySelector('.cm-content').focus()`)
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await call('Input.insertText', { text: source })
    if (!await waitFor(`document.querySelector('.cm-content')?.innerText.includes(${JSON.stringify(source.split('\n')[0])})`)) throw new Error('Article input was not applied')
    await sleep(600)
  }
  const crop = () => evaluate(`(() => { const row=[...document.querySelectorAll('aside li')].find(el => el.textContent.includes('owned')); const button=row && [...row.querySelectorAll('button')].find(el => el.textContent.trim()==='重裁'); button?.click(); return !!button })()`)
  const fetchInPage = (url) => evaluate(`(async () => { try { const response=await fetch(${JSON.stringify(url)},{cache:'no-store'}); const blob=await response.blob(); return {ok:response.ok,status:response.status,url:response.url,type:blob.type,bytes:blob.size}; } catch(error) { return {ok:false,error:error.message}; } })()`)
  beforeRestart = async () => {
    // Unload the current app before stopping its server. Otherwise a late
    // background chunk preload can fail solely because this runner killed it.
    await call('Page.navigate', { url: 'about:blank' })
    if (!await waitFor(`location.href==='about:blank'`)) throw new Error('Old page did not unload')
  }

  await navigate()
  const identity = await evaluate(`({url:location.href,title:document.title,text:document.body.innerText.length,overlay:!!document.querySelector('vite-error-overlay,[data-nextjs-dialog]')})`)
  check('production page identity and meaningful editor', identity.url.startsWith(appUrl) && /芦苇|Reed/.test(identity.title) && identity.text > 50 && !identity.overlay, identity)
  check('no uncaught application errors at startup', exceptions.length === 0 && consoleErrors.length === 0, { exceptions, consoleErrors })
  const headers = (await fetch(appUrl)).headers
  check('production CSP keeps non-image restrictions', ["script-src 'self'", "default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"].every((entry) => headers.get('content-security-policy').includes(entry)))
  await setArticle(`# R08 image policy\n\n![owned](img:fixture.png)\n\n![external](${externalUrl})`)
  check('uploaded picture displays through the real 302', await waitFor(`([...document.querySelectorAll('img')].some(i=>i.src.includes('/api/img/fixture.png')&&i.naturalWidth===160))`))
  check('public HTTPS image displays in the article', await waitFor(`([...document.querySelectorAll('img')].some(i=>i.src===${JSON.stringify(externalUrl)}&&i.naturalWidth===160))`, 2500))
  await screenshot('article.png')
  const original = await fetchInPage(`${appUrl}/api/img/fixture.png`)
  check('same-origin fetch follows 302 and reads the worker image', original.ok && original.url === `${workerUrl}/img/fixture.png` && original.type === 'image/png' && original.bytes === png.length, original)
  check('the owned-image crop control exists', await crop())
  const opened = await waitFor(`!!document.querySelector('[role=dialog] img[src^="blob:"]')`, 2500)
  check('re-crop opens with an actual fetched blob', opened)
  if (opened) {
    await screenshot('crop.png')
    const ready = await waitFor(`[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent==='用这块区域上传'&&!b.disabled)`)
    check('the canvas crop is ready', ready)
    if (ready) {
      await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='用这块区域上传').click()`)
      check('crop is uploaded and replaces the old key', await waitFor(`!document.querySelector('[role=dialog]') && !document.querySelector('.cm-content').innerText.includes('img:fixture.png')`, 12000))
      check('crop reached the actual mock worker', requests.some((request) => request.method === 'PUT' && request.url.startsWith('/api/upload')))
    }
  }
  const corsFailure = await fetchInPage(`${appUrl}/api/img/no-cors.png`)
  check('a worker missing CORS is still rejected', !corsFailure.ok, corsFailure)
  const redirect = await fetchInPage(`${appUrl}/api/img/redirect.png`)
  check('a second redirect to an untrusted origin is rejected', !redirect.ok, redirect)
  const arbitrary = await fetchInPage(externalUrl)
  check('public image permission does not allow arbitrary HTTPS fetch', !arbitrary.ok, arbitrary)
  await evaluate(`(() => { const script=document.createElement('script'); script.src='https://r08-images.example.test/attack.js'; document.body.append(script); const inline=document.createElement('script'); inline.text='window.__r08BadScript=true'; document.body.append(inline); const frame=document.createElement('iframe'); frame.src='https://r08-images.example.test/frame'; frame.style.display='none'; document.body.append(frame); const image=new Image(); image.src='javascript:window.__r08BadScript=true'; document.body.append(image); })()`)
  await sleep(300)
  const restrictions = await evaluate(`({executed:!!window.__r08BadScript,violations:window.__r08Violations})`)
  check('image allowance leaves inline / third-party scripts blocked', !restrictions.executed && restrictions.violations.some((event) => event.directive === 'script-src-elem'), restrictions)
  check('third-party frames and dangerous image protocols remain blocked', restrictions.violations.some((event) => event.directive === 'frame-src') && restrictions.violations.some((event) => event.directive === 'img-src' && event.blocked === 'javascript'), restrictions)

  await startApp(secondUrl)
  await navigate()
  const changed = await fetchInPage(`${appUrl}/api/img/fixture.png`)
  check('changing IMG_BASE_URL moves crop reads to the new origin', changed.ok && changed.url === `${secondUrl}/img/fixture.png`, changed)
  const old = await fetchInPage(`${workerUrl}/img/fixture.png`)
  check('the previous HTTP worker origin is no longer trusted', !old.ok, old)
  // The real helper deliberately uses force-cache. A previously fetched image
  // may remain re-croppable offline, so exercise the error with a cold key.
  objects.set('offline-fixture.png', objects.get('fixture.png'))
  offline = true
  await setArticle('# R08 offline\n\n![owned](img:offline-fixture.png)')
  check('offline worker re-crop control exists', await crop())
  const offlineToast = await waitFor(`document.body.innerText.includes('取回原图失败')`, 5000)
  check('offline worker produces a visible original-image error', offlineToast && !await evaluate(`!!document.querySelector('[role=dialog]')`))
  offline = false
  await startApp('')
  await navigate()
  await setArticle('# R08 unconfigured\n\n![owned](img:fixture.png)')
  const missing = await fetchInPage(`${appUrl}/api/img/fixture.png`)
  check('unconfigured image service returns a diagnosed HTTP failure', !missing.ok && missing.status === 404, missing)
  check('unconfigured re-crop control exists', await crop())
  check('unconfigured image re-crop shows its HTTP failure', await waitFor(`document.body.innerText.includes('取回原图失败')&&document.body.innerText.includes('404')`, 5000))
  check('no uncaught JavaScript exceptions during the image flows', exceptions.length === 0, exceptions)
} catch (error) {
  check('acceptance runner completes', false, error.stack || error.message)
} finally {
  socket?.close()
  await stop(chrome)
  await stop(app)
  worker.closeAllConnections()
  secondWorker.closeAllConnections()
  await Promise.all([new Promise((resolve) => worker.close(resolve)), new Promise((resolve) => secondWorker.close(resolve))])
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ appUrl, workerUrl, secondUrl, checks, requests, consoleErrors, exceptions, appLogs, temporary }, null, 2))
}
const failures = checks.filter((result) => !result.passed).length
console.log(`${checks.length - failures}/${checks.length} passed; evidence: ${output}`)
process.exitCode = failures ? 1 : 0
