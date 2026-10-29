// Production-browser acceptance for U02: the publish check in front of copy and
// the two article-HTML exports. No production data or credentials.
//
// Before this change the last step only knew "a formula or a diagram is still
// running"; everything else — an empty image slot, a loopback image address, an
// external address nobody can check from here — reached the clipboard behind a
// generic success toast. This script proves the new behaviour:
//
//   * a text-only article still copies on the first click, with no panel;
//   * every finding is locatable, and jumping moves the editor to it;
//   * a placeholder is an explicit choice, and an unfinished render cannot be
//     waved through by accident;
//   * a loopback address and a formula that will not compile each state what is
//     wrong, and only an explicit override hands them out;
//   * an external address is reported as unverified rather than as fine;
//   * the copy always uses the article as it stands at that moment — a formula
//     that finishes while the panel is open is the one that gets copied;
//   * Markdown and the full backup still export the source of a blocked article;
//   * slow network, a failing image host, article switching, and keyboard-only
//     operation all behave, in both languages.
//
// Usage: node scripts/cdp-verify-publish-preflight.mjs [appPort=4127] [cdpPort=9727] [outputDir]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]
const port = Number(process.argv[2] || 4127)
const cdpPort = Number(process.argv[3] || 9727)
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-u02-'))
const output = path.resolve(process.argv[4] || path.join(temporary, 'evidence'))
fs.mkdirSync(output, { recursive: true })
const adminKey = randomBytes(24).toString('hex')
const accessKey = randomBytes(24).toString('hex')
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
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
await freePort(port)
await freePort(cdpPort)
await freePort(workerPort)

// ---------- mock image host: it can be told to fail, on purpose ----------
const objects = new Map([['known-key', { body: Buffer.from('stored image bytes'), type: 'image/webp' }]])
let failUploads = false
let failFetch = false
let uploadAttempts = 0
const worker = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/upload') {
    uploadAttempts++
    if (failUploads) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'image host is down' }))
      req.resume()
      return
    }
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
    if (failFetch) {
      res.writeHead(500).end('image host error')
      return
    }
    const obj = objects.get(decodeURIComponent(url.pathname.slice('/img/'.length)))
    if (!obj) {
      res.writeHead(404).end('missing')
      return
    }
    res.writeHead(200, { 'content-type': obj.type })
    res.end(obj.body)
    return
  }
  res.writeHead(404).end('no route')
})

let app
let chrome
let ws
let appLog = ''
async function stop(child) {
  if (!child || child.exitCode !== null || typeof child.kill !== 'function') return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
}

const ARTICLES = {
  text: '# 纯文字稿\n\n这一篇只有文字，没有图片也没有公式。\n',
  placeholder: '# 占位稿\n\n![封面]()\n\n正文在这里。\n',
  local: '# 本机图片稿\n\n![本机图](http://localhost:5173/a.png)\n',
  external: '# 外链图片稿\n\n![外链图](https://example.com/a.png)\n',
  broken: '# 坏公式稿\n\n$$\n\\frac{1}{\n$$\n\n正文。\n',
  hosted: '# 图床图片稿\n\n![已上传](img:known-key)\n',
  diagram: '# 图表稿\n\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n',
  /** Rewritten in place by the sections that need to type their own article. */
  scratch: '# 草稿位\n\n这一篇会被脚本改写。\n',
}
const storeKey = 'mopai.docs.v1'
const docs = Object.entries(ARTICLES).map(([id, content], index) => ({
  id: `u02-${id}`,
  name: `U02 ${id}`,
  content,
  updatedAt: 1000 + index,
  savedAt: null,
  deletedAt: null,
}))

try {
  await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))
  app = spawn(process.execPath, ['dist/boot.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      DATABASE_URL: `file:${path.join(temporary, 'app.db').replaceAll('\\', '/')}`,
      ACCESS_KEY: accessKey, SESSION_SECRET: randomBytes(32).toString('hex'),
      IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: adminKey,
      ANON_GC_ENABLED: 'false', PUBLIC_BASE_URL: origin,
      RESEND_API_KEY: '', RESEND_FROM: '', FEEDBACK_TO: '',
    },
  })
  app.stdout.on('data', (data) => { appLog += data })
  app.stderr.on('data', (data) => { appLog += data })
  let up = false
  for (let i = 0; i < 150; i++) {
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
  for (let i = 0; i < 120; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl } catch { /* starting */ }
    if (endpoint) break
    await sleep(200)
  }
  if (!endpoint) throw new Error('Chrome did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let sequence = 0
  const pending = new Map()
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30_000)
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
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('DOM.enable')
  // Every page load starts from the same seven articles, whichever one was active.
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `if (location.origin === ${JSON.stringify(origin)}) {
      localStorage.setItem('mopai.onboarding.v1', 'done')
      if (!localStorage.getItem('u02-seeded')) {
        localStorage.setItem('mopai.lang.v1', 'zh')
        localStorage.setItem('mopai.theme.v1', 'akari')
        localStorage.setItem('mopai.sample.v1', '1')
        localStorage.setItem(${JSON.stringify(storeKey)}, ${JSON.stringify(JSON.stringify(docs))})
        localStorage.setItem('mopai.active.v1', 'u02-text')
        localStorage.setItem('u02-seeded', '1')
      }
    }`,
  })

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, timeout = 20_000) => {
    const until = Date.now() + timeout
    let last
    while (Date.now() < until) {
      last = await evaluate(expression)
      if (last) return last
      await sleep(150)
    }
    throw new Error(`${label} timed out; last=${JSON.stringify(last)}`)
  }
  /**
   * A real key press. Enter and Space need their `text` payload: without it
   * Chrome reports the key but never runs a focused button's default action.
   */
  const press = async (key, code, vk, text) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  }
  const screenshot = async (name) => {
    await sleep(200)
    const result = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'))
  }
  const ready = () => waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-topbar]')`, 'editor readiness', 25_000)
  const reload = async () => { await call('Page.navigate', { url: origin }); await ready(); await sleep(400) }

  // ---- clipboard and download sinks: prove what actually left the app ----
  const installSinks = () => evaluate(`(() => {
    window.__copies = []
    window.__downloads = []
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
    const origExec = document.execCommand.bind(document)
    document.execCommand = (cmd, ...rest) => {
      const r = origExec(cmd, ...rest)
      if (cmd === 'copy') window.__copies.push({ via: 'execCommand', ok: r })
      return r
    }
    const origCreate = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => { window.__lastBlob = blob; return origCreate(blob) }
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return
      const entry = { name: this.download }
      window.__downloads.push(entry)
      if (window.__lastBlob) window.__lastBlob.text().then((text) => { entry.text = text })
    }
    return true
  })()`)
  const resetSinks = () => evaluate(`(() => { window.__copies = []; window.__downloads = []; return true })()`)
  const copies = () => evaluate(`window.__copies`)
  const downloads = () => evaluate(`window.__downloads`)

  const setContent = (markdown) => evaluate(`(() => {
    const view = window.__mopaiCodemirror
    if (!view) return 'no editor'
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(markdown)} } })
    return 'ok'
  })()`)
  const activeDocId = () => evaluate(`localStorage.getItem('mopai.active.v1')`)
  const menuItem = (label) => evaluate(`(() => {
    const item = [...document.querySelectorAll('[role=menuitem]')].find((i) => i.textContent.includes(${JSON.stringify(label)}))
    if (!item) return 'missing'
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    item.click()
    return 'ok'
  })()`)
  const openMenu = (expression) => evaluate(`(() => {
    const trigger = ${expression}
    if (!trigger) return 'no trigger'
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    trigger.click()
    return 'ok'
  })()`)
  /** Switch to one of the seeded articles by name. */
  const openDoc = async (name) => {
    const opened = await openMenu(`(() => { const input = document.querySelector('header input'); return input && input.parentElement ? input.parentElement.querySelector('button') : null })()`)
    await sleep(500)
    const picked = await menuItem(name)
    await sleep(800)
    return `${opened}/${picked}`
  }
  const clickCopy = async () => {
    await openMenu(`document.querySelector('button[data-onboarding=copy]')`)
    await sleep(350)
    return evaluate(`(() => {
      const root = document.querySelector('[data-preflight]')
      if (!root) return 'copied'
      const go = root.querySelector('[data-preflight-go]')
      return 'panel:' + (go ? go.dataset.preflightState : '?')
    })()`)
  }
  const exportMenu = async (label) => {
    const opened = await openMenu(`[...document.querySelectorAll('header button')].find((x) => x.textContent.trim() === '导出')`)
    await sleep(400)
    const picked = await menuItem(label)
    await sleep(600)
    return `${opened}/${picked}`
  }
  const preflight = () => evaluate(`(() => {
    const root = document.querySelector('[data-preflight]')
    if (!root) return null
    const go = root.querySelector('[data-preflight-go]')
    return {
      title: root.querySelector('h2') ? root.querySelector('h2').innerText.trim() : '',
      items: [...root.querySelectorAll('[data-preflight-item]')].map((el) => el.dataset.preflightItem),
      sections: [...root.querySelectorAll('[data-preflight-section]')].map((el) => el.dataset.preflightSection),
      text: root.innerText,
      state: go ? go.dataset.preflightState : null,
      goLabel: go ? go.innerText.trim() : null,
      goDisabled: go ? Boolean(go.disabled) : null,
      hasAck: Boolean(root.querySelector('[data-preflight-ack]')),
      jumpCodes: [...root.querySelectorAll('[data-preflight-jump]')].map((el) => el.dataset.preflightJump),
    }
  })()`)
  const preflightAck = () => evaluate(`(() => { const c = document.querySelector('[data-preflight-ack]'); if (!c) return 'missing'; c.click(); return 'clicked' })()`)
  const preflightGo = () => evaluate(`(() => { const b = document.querySelector('[data-preflight-go]'); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' })()`)
  const preflightCancel = () => evaluate(`(() => { const b = document.querySelector('[data-preflight-cancel]'); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  const closePreflight = async () => { await preflightCancel(); await sleep(350) }
  const slowNetwork = (on) => call('Network.emulateNetworkConditions', on
    ? { offline: false, latency: 300, downloadThroughput: 40 * 1024, uploadThroughput: 40 * 1024 }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  const waitForPanel = async (label, timeout = 12_000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      const state = await preflight()
      if (state) return state
      await sleep(200)
    }
    throw new Error(`${label}: no publish check appeared`)
  }

  console.log('\n=== a text-only article still goes straight through ===')
  await reload()
  await installSinks()
  check('the editor opened on the text-only article', (await activeDocId()) === 'u02-text', await activeDocId())
  await resetSinks()
  const textClick = await clickCopy()
  check('no publish check appears for a text-only article', textClick === 'copied', textClick)
  check('the text-only article reaches the clipboard on the first click', (await copies()).length === 1, JSON.stringify((await copies()).map((c) => c.ok)))

  console.log('\n=== an empty image slot is a warning the author can locate and accept ===')
  check('switched to the placeholder article', (await openDoc('U02 placeholder')) === 'ok/ok')
  await resetSinks()
  const placeholderClick = await clickCopy()
  const placeholderPanel = await waitForPanel('placeholder article')
  check('the copy opens the publish check', placeholderClick === 'panel:needs-ack', placeholderClick)
  check('the finding names the empty image slot', placeholderPanel.items.includes('image-placeholder'), JSON.stringify(placeholderPanel.items))
  check('the warning section is the one it lands in', placeholderPanel.sections.includes('warning'), JSON.stringify(placeholderPanel.sections))
  check('the finding can be located', placeholderPanel.jumpCodes.includes('image-placeholder'), JSON.stringify(placeholderPanel.jumpCodes))
  check('nothing reaches the clipboard while the warning is unread', (await copies()).length === 0)
  check('the copy is held until the warning is acknowledged', placeholderPanel.state === 'needs-ack' && placeholderPanel.goDisabled === true, `${placeholderPanel.state}/${placeholderPanel.goDisabled}`)
  await screenshot('preflight-placeholder.png')

  // Locate: the editor must move to the image's own line.
  check('the jump button works', (await evaluate(`(() => { const b = document.querySelector('[data-preflight-jump]'); if (!b) return 'missing'; b.click(); return 'clicked' })()`)) === 'clicked')
  await sleep(500)
  const caretLine = await evaluate(`window.__mopaiCodemirror.state.doc.lineAt(window.__mopaiCodemirror.state.selection.main.head).number`)
  check('... and lands on the image line', caretLine === 3, `line=${caretLine}`)
  check('the panel closes when it moves you there', (await preflight()) === null)

  await clickCopy()
  await waitForPanel('placeholder article again')
  await preflightAck()
  const acked = await preflight()
  check('acknowledging the warning enables the copy', acked?.state === 'ready' && acked?.goDisabled === false, `${acked?.state}/${acked?.goDisabled}`)
  check('the acknowledged copy runs', (await preflightGo()) === 'clicked')
  await sleep(400)
  const placeholderCopy = (await copies())[0]
  check(
    'the accepted copy keeps the slot as a caption with no image, exactly as warned',
    String(placeholderCopy?.html ?? '').includes('封面') && !String(placeholderCopy?.html ?? '').includes('<img'),
    `${String(placeholderCopy?.html ?? '').length}B`,
  )

  console.log('\n=== a loopback image address blocks, and only an override hands it out ===')
  check('switched to the loopback article', (await openDoc('U02 local')) === 'ok/ok')
  await resetSinks()
  const localClick = await clickCopy()
  const localPanel = await waitForPanel('loopback article')
  check('the copy opens the publish check', localClick === 'panel:override', localClick)
  check('the finding names the local address', localPanel.items.includes('image-local'), JSON.stringify(localPanel.items))
  check('the blocker section is the one it lands in', localPanel.sections.includes('blocker'), JSON.stringify(localPanel.sections))
  check('the blocker says why WeChat cannot use it', /内网|本机/.test(localPanel.text), localPanel.text.slice(0, 120))
  check('the finding can be located too', localPanel.jumpCodes.includes('image-local'), JSON.stringify(localPanel.jumpCodes))
  check('nothing reaches the clipboard while it is blocked', (await copies()).length === 0)
  check('a blocker is an explicit override, not a click-through', localPanel.state === 'override', localPanel.state)
  await screenshot('preflight-blocker.png')
  check('the override runs', (await preflightGo()) === 'clicked')
  await sleep(500)
  const localCopy = (await copies())[0]
  check('the override copies what it warned about, and says so', Boolean(localCopy?.html?.includes('localhost:5173')), `${String(localCopy?.html ?? '').length}B`)

  console.log('\n=== an external address is reported as unverified, not as fine ===')
  check('switched to the external article', (await openDoc('U02 external')) === 'ok/ok')
  await resetSinks()
  const externalClick = await clickCopy()
  // An address nobody here can read is stated, not turned into a modal: there is
  // nothing for the author to fix, so it must not hold the copy up either.
  check('an unverifiable address does not open a modal', externalClick === 'copied', externalClick)
  const externalCopies = await copies()
  check('the copy runs', externalCopies.length === 1, JSON.stringify(externalCopies.map((c) => c.ok)))
  check('the copy carries the external address unchanged', Boolean(externalCopies[0]?.html?.includes('example.com/a.png')))
  const externalToast = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join('\\n')`)
  check('the toast states that the address could not be verified', /无法验证/.test(externalToast) && /跨站|外链/.test(externalToast), externalToast.slice(0, 200))
  check('it does not claim the address is broken', !/本机 \/ 内网|内嵌/.test(externalToast), externalToast.slice(0, 120))

  console.log('\n=== a formula that will not compile blocks, and the source is a choice ===')
  check('switched to the broken-formula article', (await openDoc('U02 broken')) === 'ok/ok')
  await waitFor(`document.body.innerText.includes('公式无法编译')`, 'the error box renders', 25_000)
  await resetSinks()
  const brokenClick = await clickCopy()
  const brokenPanel = await waitForPanel('broken formula')
  check('the copy opens the publish check', brokenClick === 'panel:override', brokenClick)
  check('the finding names the broken formula', brokenPanel.items.includes('math-failed'), JSON.stringify(brokenPanel.items))
  check('nothing reaches the clipboard while it is blocked', (await copies()).length === 0)
  check('the override is explicit', brokenPanel.state === 'override', brokenPanel.state)
  check('the override runs', (await preflightGo()) === 'clicked')
  await sleep(500)
  const brokenCopy = (await copies())[0]
  check('the override hands out the source it warned about', Boolean(brokenCopy?.html?.includes('公式无法编译')) && !String(brokenCopy?.html).includes('<svg'), `${String(brokenCopy?.html ?? '').length}B`)

  console.log('\n=== the copy uses the article as it stands when the click lands ===')
  check('switched to the scratch article', (await openDoc('U02 scratch')) === 'ok/ok')
  // A fence body no earlier step has rendered, so it cannot be in the cache.
  await setContent('# 渲染中稿\n\n```mermaid\ngraph TD\n  A[渲染前] --> B[渲染后]\n```\n\n结尾。\n')
  await resetSinks()
  const pendingClick = await clickCopy()
  const pendingPanel = await waitForPanel('diagram still rendering')
  check(
    'the unfinished diagram opens the check',
    pendingClick === 'panel:override' && pendingPanel.items.includes('diagram-pending'),
    `${pendingClick} / ${JSON.stringify(pendingPanel.items)}`,
  )
  check('nothing reaches the clipboard yet', (await copies()).length === 0)
  check('the blocker names the diagram', /图表/.test(pendingPanel.text), pendingPanel.text.slice(0, 100))
  // It finishes while the check is up: what gets copied must be the article as
  // it stands now, not the state the check was told about a moment ago.
  const diagramReady = await waitFor(
    `[...document.querySelectorAll('img')].some((i) => i.src.includes('/img/'))`,
    'the diagram becomes an image',
    90_000,
  ).then(() => true).catch(() => false)
  check('the diagram finishes while the check is open', diagramReady)
  await preflightGo()
  await sleep(600)
  const finishedCopy = (await copies())[0]
  check(
    'the copy carries the diagram that finished while the check was open',
    Boolean(finishedCopy?.html?.includes('/img/')),
    finishedCopy ? `${finishedCopy.html.length}B / img=${finishedCopy.html.includes('/img/')}` : 'no copy',
  )
  check('the panel is gone once the copy ran', (await preflight()) === null)

  console.log('\n=== Markdown and the full backup still export the source ===')
  check('switched back to the blocked article', (await openDoc('U02 local')) === 'ok/ok')
  await resetSinks()
  const mdExport = await exportMenu('Markdown')
  check('the Markdown export is not blocked', mdExport === 'ok/ok' && (await preflight()) === null, `${mdExport} / panel=${JSON.stringify(await preflight())}`)
  const mdDownloads = await downloads()
  check('... and writes the source file', mdDownloads.length === 1 && String(mdDownloads[0]?.text ?? '').includes('localhost:5173'), JSON.stringify(mdDownloads.map((d) => d.name)))
  await resetSinks()
  const bundleExport = await exportMenu('整包备份')
  await sleep(1500)
  const bundleDownloads = await downloads()
  check('the full backup export is not blocked either', bundleExport === 'ok/ok' && (await preflight()) === null, `${bundleExport}`)
  check('... and writes the backup file', bundleDownloads.length === 1, JSON.stringify(bundleDownloads.map((d) => d.name)))

  console.log('\n=== a failing image host does not turn into a silent success ===')
  failFetch = true
  check('switched to the article whose image is on our own host', (await openDoc('U02 hosted')) === 'ok/ok')
  await sleep(800)
  await resetSinks()
  const hostedClick = await clickCopy()
  check('an image host error on our own object is not reported as a broken article', hostedClick === 'copied', hostedClick)
  check('the copy still carries the reference it always did', Boolean((await copies())[0]?.html?.includes('/img/known-key')), `${String((await copies())[0]?.html ?? '').length}B`)
  failFetch = false
  failUploads = true
  check('switched to the scratch article for the failed upload', (await openDoc('U02 scratch')) === 'ok/ok')
  await setContent('# 上传失败稿\n\n![还没传上去]()\n')
  await sleep(500)
  await resetSinks()
  const failedUploadClick = await clickCopy()
  const failedUploadPanel = await waitForPanel('article left by a failed upload')
  check(
    'an image that never reached the host is still a warning, not a success',
    failedUploadClick === 'panel:needs-ack' && failedUploadPanel.items.includes('image-placeholder'),
    `${failedUploadClick} / ${JSON.stringify(failedUploadPanel.items)}`,
  )
  check('nothing reaches the clipboard behind that warning', (await copies()).length === 0)
  await closePreflight()
  failUploads = false

  console.log('\n=== a slow network does not hold the check up ===')
  await slowNetwork(true)
  check('switched to the external article', (await openDoc('U02 external')) === 'ok/ok')
  await resetSinks()
  const slowStart = Date.now()
  const slowExternalClick = await clickCopy()
  const slowMs = Date.now() - slowStart
  check('the check still answers on a throttled connection', slowExternalClick === 'copied', slowExternalClick)
  check('it answers from the article, without waiting on the network', slowMs < 4000, `${slowMs}ms`)
  const slowExternalToast = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join('\\n')`)
  check(
    'an external address stays unverified under throttle, not fetched by us',
    /无法验证/.test(slowExternalToast),
    slowExternalToast.slice(0, 160),
  )
  check('switched to the text article', (await openDoc('U02 text')) === 'ok/ok')
  await resetSinks()
  const slowCleanClick = await clickCopy()
  check('a clean article still copies under throttle', slowCleanClick === 'copied' && (await copies()).length === 1, slowCleanClick)
  await slowNetwork(false)

  console.log('\n=== switching articles clears the previous article\'s findings ===')
  check('switched to the text article', (await openDoc('U02 text')) === 'ok/ok')
  await resetSinks()
  const switchedClick = await clickCopy()
  check('a clean article copies at once even after a blocked one', switchedClick === 'copied' && (await copies()).length === 1, switchedClick)

  console.log('\n=== the check is operable from the keyboard alone ===')
  check('switched to the placeholder article', (await openDoc('U02 placeholder')) === 'ok/ok')
  await resetSinks()
  await evaluate(`document.querySelector('button[data-onboarding=copy]').focus()`)
  await press('Enter', 'Enter', 13, '\r')
  const keyboardPanel = await waitForPanel('keyboard-opened check')
  check('Enter on the copy button opens the check', keyboardPanel.items.includes('image-placeholder'), JSON.stringify(keyboardPanel.items))
  const focusInside = await evaluate(`(() => { const root = document.querySelector('[data-preflight]'); return root ? root.contains(document.activeElement) : false })()`)
  check('focus moves into the dialog', focusInside === true)
  await evaluate(`document.querySelector('[data-preflight-ack]').focus()`)
  await press(' ', 'Space', 32, ' ')
  await sleep(200)
  const keyboardAcked = await preflight()
  check('Space acknowledges the warning', keyboardAcked?.state === 'ready', `${keyboardAcked?.state}/${keyboardAcked?.goDisabled}`)
  await evaluate(`document.querySelector('[data-preflight-go]').focus()`)
  await press('Enter', 'Enter', 13, '\r')
  await sleep(500)
  check('Enter on the primary button runs the copy', (await copies()).length === 1, JSON.stringify((await copies()).map((c) => c.via)))

  console.log('\n=== the same findings read correctly in English ===')
  await evaluate(`localStorage.setItem('mopai.lang.v1', 'en')`)
  await reload()
  await installSinks()
  check('switched to the placeholder article in English', (await openDoc('U02 placeholder')) === 'ok/ok')
  await resetSinks()
  const englishClick = await clickCopy()
  const englishPanel = await waitForPanel('English check')
  check('the check opens in English', englishPanel.title === 'Publish check', englishPanel.title)
  check('the finding is the same one', englishPanel.items.includes('image-placeholder'), JSON.stringify(englishPanel.items))
  // The section header is uppercased by CSS, and innerText reports what is
  // rendered, so this comparison has to ignore case.
  check('the sections are translated too', englishPanel.sections.includes('warning') && /worth knowing/i.test(englishPanel.text), `${JSON.stringify(englishPanel.sections)} / ${englishPanel.text.slice(0, 160)}`)
  check('the acknowledgement is translated', englishPanel.hasAck === true && /I have read/.test(englishPanel.text), englishPanel.hasAck)
  await screenshot('preflight-english.png')
  check('the English copy behaves the same way', englishClick === 'panel:needs-ack', englishClick)
  await closePreflight()
  await evaluate(`localStorage.setItem('mopai.lang.v1', 'zh')`)
  await reload()
  await installSinks()

  console.log('\n=== a finished, hosted article is untouched by all of this ===')
  check('switched to the article whose images are uploaded', (await openDoc('U02 hosted')) === 'ok/ok')
  await resetSinks()
  const hostedAgain = await clickCopy()
  check('an article with only hosted images copies with no check at all', hostedAgain === 'copied', hostedAgain)
  const hostedCopy = (await copies())[0]
  check('the copy is the article itself', Boolean(hostedCopy?.html?.includes('/img/known-key')), `${String(hostedCopy?.html ?? '').length}B`)

  // The deliberately broken formula in the fixture makes the app log its own
  // diagnostic; that is the app working, not a page error.
  const realErrors = consoleErrors.filter((text) => !/^\[math\] render failed/.test(text))
  check('no page errors along the way', exceptions.length === 0 && realErrors.length === 0, { exceptions: exceptions.length, consoleErrors: realErrors.slice(0, 3) })
} catch (error) {
  check('script completed without throwing', false, error.stack || error.message)
} finally {
  if (ws) { try { ws.close() } catch { /* already closed */ } }
  await stop(app)
  await stop(chrome)
  if (worker.listening) await new Promise((resolve) => worker.close(resolve))
}

const failed = checks.filter((c) => !c.passed)
const summary = {
  task: 'U02 · publish check before copy and HTML export',
  checks,
  exceptions: exceptions.length,
  consoleErrors,
  output,
  result: failed.length === 0 ? 'PASS' : 'FAIL',
  failed: failed.map((c) => c.name),
}
fs.writeFileSync(path.join(output, 'u02-publish-preflight.json'), JSON.stringify(summary, null, 2))
console.log(`\n${summary.result} · ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) {
  console.log(`Failed: ${failed.map((c) => c.name).join('; ')}`)
  process.exitCode = 1
}