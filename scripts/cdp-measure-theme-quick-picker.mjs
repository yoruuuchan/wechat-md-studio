// A08 theme quick-switcher measurement: same Chrome, same cache policy, same article.
//
// It measures, on the editor route, what the主题 quick switcher actually costs:
// - which theme implementation packs the browser fetched while only the
// current theme and the visible/near-viewport tiles were on screen,
// - how many thumbnails were rendered up front (and after scrolling),
// - DOM mutations inside the quick switcher while typing10 Chinese chars,
// - how long the main preview takes to show the last typed character,
// -390px: the hidden side pane must load/render nothing beyond the current
// theme, and after switching to it only visible tiles may load.
//
// Run the same build/script before and after the change, then compare the two
// JSON files only when both were produced by this script on the same machine.
// Results and screenshots go to <outDir>/<label>.json and <outDir>/*.png.
//
// Usage: node scripts/cdp-measure-theme-quick-picker.mjs [appPort=4128] [cdpPort=9728] [outDir=verify-out/theme-quick-picker] [label=run] [--assert]
// Requires `npm run build`; starts its own app, mock image service and Chrome.
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
const outDir = path.resolve(process.argv[4] || 'verify-out/theme-quick-picker')
const label = process.argv[5] && !process.argv[5].startsWith('--') ? process.argv[5] : 'run'
const assertOptimized = process.argv.includes('--assert')
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-quick-picker-'))
fs.mkdirSync(outDir, { recursive: true })

// An imported theme in the first category, so the quick picker has to fetch a
// pack for the current theme rather than using an always-loaded core theme.
const MEASURED_THEME = 'raphael-ocean'
// One favourite from another pack at the very top: favourites must keep working.
const MEASURED_FAVORITE = 'xedit-orange-heart'
const TYPED = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const LAST_CHAR = TYPED[TYPED.length - 1]
// Prefixes Vite gives the dynamic-import chunks; local lazy modules use theirs.
const PACK_RE =
  /(?:^|\/)(xiaohu|raphael|huasheng|md-wechat|wenyan|xedit|inkpress|themes-extra|themes-design)-[^/]+\.js$/
const ALL_PACKS = [
  'huasheng',
  'inkpress',
  'md-wechat',
  'raphael',
  'themes-design',
  'themes-extra',
  'wenyan',
  'xedit',
  'xiaohu',
]
const TILE_MARGIN = 240

const checks = []
const exceptions = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
}

// ------------------------------------------------------------------ catalog
// The generated catalog is the source of truth for id -> name/source; read it
// instead of importing TS from a plain node script.
const importedCatalog = fs.readFileSync('src/lib/themes-imported/catalog.ts', 'utf8')
const importedThemes = new Map()
for (const match of importedCatalog.matchAll(
  /id: "([^"]+)",\s*name: "([^"]+)",\s*desc: "[^"]*",\s*category: "([^"]+)",[\s\S]*?source: "([^"]+)"/g,
)) {
  importedThemes.set(match[1], { name: match[2], category: match[3], pack: match[4] })
}
const localCatalog = fs.readFileSync('src/lib/themes-local-catalog.ts', 'utf8')
const localThemes = new Map()
for (const match of localCatalog.matchAll(/"id": "([^"]+)",\s*"name": "([^"]+)",/g)) {
  localThemes.set(match[1], { name: match[2] })
}
const localModules = new Map()
for (const match of localCatalog.matchAll(/"([a-z0-9-]+)": "(core|extra|design)"/g)) {
  localModules.set(match[1], match[2])
}
const themeName = (id) => importedThemes.get(id)?.name ?? localThemes.get(id)?.name ?? id
const themePack = (id) => {
  const imported = importedThemes.get(id)
  if (imported) return imported.pack
  const local = localModules.get(id)
  if (local === 'extra') return 'themes-extra'
  if (local === 'design') return 'themes-design'
  return null
}

// ------------------------------------------------------------------- runner
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
      '--window-size=1600,1000',
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
  await call('Network.enable')
  // Seed the measured theme and favourite before the app reads its settings.
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
 try {
 localStorage.setItem('mopai.onboarding.v1', 'done')
 localStorage.setItem('mopai.lang.v1', 'zh')
 localStorage.setItem('mopai.theme-favorites.v1', JSON.stringify([${JSON.stringify(MEASURED_FAVORITE)}]))
 const s = JSON.parse(localStorage.getItem('mopai.settings.v1') || '{}')
 s.themeId = ${JSON.stringify(MEASURED_THEME)}
 localStorage.setItem('mopai.settings.v1', JSON.stringify(s))
 window.__a08IO = { calls:0, entered:0 }
 const OrigIO = window.IntersectionObserver
 if (OrigIO) {
 window.IntersectionObserver = function (callback, options) {
 return new OrigIO(function (entries, observer) {
 window.__a08IO.calls +=1
 window.__a08IO.entered += entries.filter((entry) => entry.isIntersecting).length
 return callback(entries, observer)
 }, options)
 }
 }
 window.__a08Timers = { scheduled:0, fired:0 }
 const origSetTimeout = window.setTimeout
 window.setTimeout = function (fn, delay, ...args) {
 if (delay ===220) window.__a08Timers.scheduled +=1
 return origSetTimeout.call(window, function () {
 if (delay ===220) window.__a08Timers.fired +=1
 return typeof fn === 'function' ? fn.apply(this, arguments) : fn
 }, delay, ...args)
 }
 } catch {}
 `,
  })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, timeout = 20_000) => {
    const until = Date.now() + timeout
    let result
    while (Date.now() < until) {
      result = await evaluate(expression)
      if (result) return result
      await sleep(100)
    }
    throw new Error(`${label} timed out; last=${JSON.stringify(result)}`)
  }
  const waitForTime = async (expression, timeout = 800) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return Date.now() - start
      await sleep(10)
    }
    return null
  }
  const clickReal = async (expression) => {
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
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, 'base64'))
  }
  // Packs actually downloaded so far (from this page's resource timing).
  const fetchedPacks = () =>
    evaluate(`(() => {
 const re = ${PACK_RE.toString()}
 const out = []
 for (const entry of performance.getEntriesByType('resource')) {
 const parsed = new URL(entry.name)
 if (parsed.origin !== location.origin) continue
 const match = parsed.pathname.match(re)
 if (match) out.push({ pack: match[1], path: parsed.pathname, decoded: entry.decodedBodySize, transfer: entry.transferSize })
 }
 return out
 })()`).then((entries) => {
      const byPack = new Map()
      for (const entry of entries) {
        const current = byPack.get(entry.pack) || { pack: entry.pack, resources: [], decoded: 0, transfer: 0 }
        current.resources.push(entry.path)
        current.decoded += entry.decoded
        current.transfer += entry.transfer
        byPack.set(entry.pack, current)
      }
      return [...byPack.values()].sort((a, b) => a.pack.localeCompare(b.pack))
    })
  // Where each tile sits relative to the scrolling theme panel, whether it has
  // rendered output, and the current theme id from the saved settings.
  const quickState = () =>
    evaluate(`(() => {
 const switcher = document.querySelector('[data-theme-switcher]')
 if (!switcher) return { present: false, tiles: [] }
 let scroll = switcher.closest('[data-theme-scroll]')
 if (!scroll) {
 let node = switcher.parentElement
 while (node && !(node.scrollHeight > node.clientHeight +1 && getComputedStyle(node).overflowY !== 'visible')) node = node.parentElement
 scroll = node || switcher
 }
 const bounds = scroll.getBoundingClientRect()
 const settings = JSON.parse(localStorage.getItem('mopai.settings.v1') || '{}')
 const tiles = [...switcher.querySelectorAll('[data-theme-quick]')].map((el) => {
 const rect = el.getBoundingClientRect()
 const section = el.querySelector('section')
 return {
 id: el.getAttribute('data-theme-quick'),
 rendered: Boolean(section),
 renderedTextLength: section ? (section.textContent || '').length :0,
 near: rect.width >0 && rect.height >0
 && rect.bottom > bounds.top - ${TILE_MARGIN} && rect.top < bounds.bottom + ${TILE_MARGIN},
 }
 })
 return {
 present: true,
 currentThemeId: settings.themeId || 'golden',
 scrollTop: Math.round(scroll.scrollTop),
 scrollHeight: Math.round(scroll.scrollHeight),
 clientHeight: Math.round(scroll.clientHeight),
 tiles,
 }
 })()`)
  const renderedIds = (state) => state.tiles.filter((tile) => tile.rendered).map((tile) => tile.id)
  const unique = (items) => [...new Set(items)].sort()
  const packsFor = (ids, currentThemeId) => unique([...ids, currentThemeId].map(themePack).filter(Boolean))
  const editorReady = () =>
    waitFor(
      `Boolean(window.__mopaiCodemirror && document.querySelector('[data-preview-article]') && document.querySelector('[data-onboarding="preview"] section'))`,
      'editor and preview',
    )
  const waitSettledPreviews = async (timeout = 6000) => {
    const start = Date.now()
    let last = ''
    let stableSince = Date.now()
    while (Date.now() - start < timeout) {
      const state = await quickState()
      const signature = state.present ? renderedIds(state).join(',') : 'absent'
      if (signature !== last) {
        last = signature
        stableSince = Date.now()
      } else if (Date.now() - stableSince > 900) return state
      await sleep(150)
    }
    return quickState()
  }
  const scrollThemePanelToBottom = () =>
    evaluate(`(() => {
 const switcher = document.querySelector('[data-theme-switcher]')
 if (!switcher) return false
 let scroll = switcher.closest('[data-theme-scroll]')
 if (!scroll) {
 let node = switcher.parentElement
 while (node && !(node.scrollHeight > node.clientHeight +1 && getComputedStyle(node).overflowY !== 'visible')) node = node.parentElement
 scroll = node
 }
 if (!scroll) return false
 scroll.scrollTop = scroll.scrollHeight
 return true
 })()`)
  const installMutationCounter = () =>
    evaluate(`(() => {
 const target = document.querySelector('[data-theme-switcher]')
 if (!target) return false
 window.__a08 = { mutations:0, kinds: { childList:0, characterData:0, attributes:0 }, times: [], samples: [], callbacks: [] }
 window.__a08.started = Date.now()
 window.__a08.observer = new MutationObserver((records) => {
 window.__a08.mutations += records.length
 window.__a08.times.push(Date.now() - window.__a08.started)
 if (window.__a08.callbacks.length <40) {
 window.__a08.callbacks.push({
 at: Date.now() - window.__a08.started,
 count: records.length,
 len: records[0]?.addedNodes?.[0]?.textContent?.length ?? null,
 renders: window.__a08Renders,
 ids: records.map((record) => record.target.closest('[data-theme-quick]')?.dataset.themeQuick ?? '?').slice(0,4),
 detail: window.__a08.callbacks.length <2 ? records.map((record) => ({
 t: String(record.target.className || '').slice(0,16),
 a: record.addedNodes[0]?.nodeName ?? null,
 l: record.addedNodes[0]?.textContent?.length ?? null,
 })) : undefined,
 })
 }
 for (const record of records) {
 window.__a08.kinds[record.type] = (window.__a08.kinds[record.type] ||0) +1
 if (window.__a08.samples.length <12) {
 window.__a08.samples.push({
 target: record.target.nodeName + '.' + String(record.target.className || '').slice(0,40),
 added: record.addedNodes.length,
 removed: record.removedNodes.length,
 at: Date.now() - window.__a08.started,
 })
 }
 }
 })
 window.__a08.observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true })
 return true
 })()`)
  const readMutationCounter = () =>
    evaluate(`(() => {
 if (!window.__a08) return null
 window.__a08.observer.disconnect()
 return { mutations: window.__a08.mutations, kinds: window.__a08.kinds, times: window.__a08.times, samples: window.__a08.samples, callbacks: window.__a08.callbacks }
 })()`)

  // ------------------------------------------------------------- desktop run
  const desktop = {}
  await call('Page.navigate', { url: origin })
  await editorReady()
  await waitFor(`!!document.querySelector('[data-theme-switcher]')`, 'quick switcher')
  desktop.initial = await waitSettledPreviews()
  desktop.initialPacks = await fetchedPacks()
  desktop.initialRendered = renderedIds(desktop.initial)
  desktop.initialNear = desktop.initial.tiles.filter((tile) => tile.near).map((tile) => tile.id)
  desktop.displayed = desktop.initial.tiles.map((tile) => tile.id)
  desktop.currentThemeName = themeName(MEASURED_THEME)
  desktop.expectedInitialPacks = packsFor(desktop.initialNear, desktop.initial.currentThemeId)
  desktop.expectedAllPacks = packsFor(desktop.displayed, desktop.initial.currentThemeId)
  desktop.fetchedPackNames = desktop.initialPacks.map((entry) => entry.pack)
  check(
    'quick switcher lists the favourites and category tiles',
    desktop.displayed.includes(MEASURED_FAVORITE) && desktop.displayed.includes(MEASURED_THEME),
    { tiles: desktop.displayed.length, favourite: desktop.displayed.includes(MEASURED_FAVORITE) },
  )
  check(
    'up front only visible/near tiles had thumbnails rendered',
    desktop.initialRendered.every((id) => desktop.initialNear.includes(id) || id === desktop.initial.currentThemeId),
    { rendered: desktop.initialRendered.length, near: desktop.initialNear.length, displayed: desktop.displayed.length },
  )
  check('off-screen tiles were not rendered up front', desktop.initialRendered.length < desktop.displayed.length, {
    rendered: desktop.initialRendered.length,
    displayed: desktop.displayed.length,
  })
  check(
    'the current theme thumbnail rendered',
    desktop.initialRendered.length > 0 &&
      (desktop.initialRendered.includes(MEASURED_THEME) || desktop.initialNear.includes(MEASURED_THEME)),
    { rendered: desktop.initialRendered.slice(0, 12) },
  )
  check(
    'no theme pack outside visible/current tiles was fetched',
    desktop.fetchedPackNames.every((pack) => desktop.expectedInitialPacks.includes(pack)),
    { fetched: desktop.fetchedPackNames, expected: desktop.expectedInitialPacks },
  )
  check('not every theme pack was fetched up front', desktop.fetchedPackNames.length < ALL_PACKS.length, {
    fetched: desktop.fetchedPackNames,
    all: ALL_PACKS,
  })

  // Typing:10 Chinese chars, then count switcher mutations and main-preview lag.
  const focusEnd = await evaluate(`(() => {
 const view = window.__mopaiCodemirror
 if (!view) return false
 view.focus()
 view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
 return true
 })()`)
  check('CodeMirror can be focused for the typing measurement', focusEnd)
  await installMutationCounter()
  await sleep(350)
  await evaluate(
    `(() => { if (window.__a08) { window.__a08.mutations =0; window.__a08.times = []; window.__a08.samples = []; window.__a08.callbacks = [] } window.__a08Renders =0; window.__a08RenderRuns =0; window.__a08Batches =0; return true })()`,
  )
  desktop.typingTimes = []
  for (const char of TYPED) {
    await call('Input.insertText', { text: char })
    desktop.typingTimes.push(Date.now())
  }
  desktop.typingSpanMs = desktop.typingTimes.length
    ? desktop.typingTimes[desktop.typingTimes.length - 1] - desktop.typingTimes[0]
    : null
  desktop.mainPreviewSettleMs = await waitForTime(
    `document.querySelector('[data-preview-article]')?.textContent?.includes(${JSON.stringify(LAST_CHAR)})`,
    1200,
  )
  await sleep(450)
  desktop.quickPreviewSettleMs = await waitForTime(
    `[...document.querySelectorAll('[data-theme-switcher] section')].some((section) => section.textContent.includes(${JSON.stringify(LAST_CHAR)}))`,
    1200,
  )
  await sleep(500)
  desktop.mutations = await readMutationCounter()
  desktop.debug = await evaluate(
    `({ renders: window.__a08Renders, effectRuns: window.__a08RenderRuns, batches: window.__a08Batches })`,
  )
  desktop.instrumentation = await evaluate(
    `({ io: window.__a08IO, timers: window.__a08Timers, previews: Object.keys(window.__a08IO || {}).length })`,
  )
  // Probe: a pure parent re-render (selection change, no document edit) must not
  // touch the thumbnail DOM.
  await evaluate(
    `(() => { if (window.__a08) { window.__a08.mutations =0; window.__a08.callbacks = [] } const v = window.__mopaiCodemirror; v.dispatch({ selection: { anchor:0 } }); return true })()`,
  )
  await sleep(500)
  desktop.rerenderProbe = await evaluate(
    `({ mutations: window.__a08?.mutations ?? null, renders: window.__a08Renders, callbacks: window.__a08?.callbacks ?? [] })`,
  )
  check(
    '10 typed chars mutate the quick switcher at most100 times',
    (desktop.mutations?.mutations ?? Infinity) <= 100,
    desktop.mutations,
  )
  check(
    'the main preview shows the last char within300ms',
    desktop.mainPreviewSettleMs != null && desktop.mainPreviewSettleMs <= 300,
    { ms: desktop.mainPreviewSettleMs },
  )
  check('the quick thumbnails catch up after the debounce', desktop.quickPreviewSettleMs != null, {
    ms: desktop.quickPreviewSettleMs,
  })
  desktop.renderedAfterTyping = renderedIds(await quickState())
  if (desktop.renderedAfterTyping.length === 0)
    check('typing did not empty the quick switcher', false, desktop.renderedAfterTyping)

  // Scrolling the theme panel must load and render the rest.
  desktop.scrolled = await scrollThemePanelToBottom()
  await sleep(1600)
  desktop.afterScroll = await waitSettledPreviews()
  desktop.afterScrollRendered = renderedIds(desktop.afterScroll)
  desktop.afterScrollPacks = (await fetchedPacks()).map((entry) => entry.pack)
  check(
    'scrolling the panel renders every displayed thumbnail',
    desktop.afterScrollRendered.length === desktop.afterScroll.tiles.length,
    { rendered: desktop.afterScrollRendered.length, displayed: desktop.afterScroll.tiles.length },
  )
  check(
    'every rendered thumbnail shows article output',
    desktop.afterScroll.tiles.every((tile) => (tile.rendered ? tile.renderedTextLength > 20 : true)),
    { rendered: desktop.afterScrollRendered.length },
  )
  check(
    'scrolling fetched every pack those tiles need',
    desktop.expectedAllPacks.every((pack) => desktop.afterScrollPacks.includes(pack)),
    { fetched: desktop.afterScrollPacks, expected: desktop.expectedAllPacks },
  )
  await screenshot(`desktop-${label}.png`)

  // Applying a loaded thumbnail must still switch the article theme.
  const switchTarget = desktop.afterScrollRendered.find((id) => id !== desktop.initial.currentThemeId)
  desktop.switchTarget = switchTarget ?? null
  desktop.switchTargetName = switchTarget ? themeName(switchTarget) : null
  if (switchTarget) {
    desktop.tileClick = false
    if (switchTarget) {
      await clickReal(
        `document.querySelector('[data-theme-quick=' + JSON.stringify(${JSON.stringify(switchTarget)}) + ']')`,
      )
      desktop.tileClick = true
    }
    const labelShown = await waitFor(
      `document.querySelector('[data-preview-theme]')?.textContent?.includes(${JSON.stringify(desktop.switchTargetName)})`,
      'switched theme label',
      8000,
    ).catch(() => false)
    check('clicking a thumbnail switches the article theme', Boolean(desktop.tileClick && labelShown), {
      target: switchTarget,
      name: desktop.switchTargetName,
    })
  } else {
    check('clicking a thumbnail switches the article theme', false, 'no alternate rendered tile')
  }
  desktop.fetchedPacksAfterSwitch = (await fetchedPacks()).map((entry) => entry.pack)
  await sleep(300)

  // -------------------------------------------------------------- mobile run
  const mobile = {}
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false })
  await call('Page.navigate', { url: origin })
  await editorReady()
  await sleep(1800)
  mobile.hiddenPanel = await evaluate(`(() => {
 const side = document.querySelector('[data-pane="side"]')
 const switcher = document.querySelector('[data-theme-switcher]')
 const settings = JSON.parse(localStorage.getItem('mopai.settings.v1') || '{}')
 return {
 sidePresent: Boolean(side),
 sideHidden: side ? side.className.includes('invisible') : null,
 switcherPresent: Boolean(switcher),
 rendered: switcher ? switcher.querySelectorAll('section').length :0,
 currentThemeId: settings.themeId || 'golden',
 }
 })()`)
  mobile.hiddenPacks = (await fetchedPacks()).map((entry) => entry.pack)
  mobile.hiddenExtras = mobile.hiddenPacks.filter((pack) => pack !== themePack(MEASURED_THEME))
  check(
    'mobile starts on the editor pane with the side pane hidden',
    mobile.hiddenPanel.sideHidden === true,
    mobile.hiddenPanel,
  )
  check('the hidden mobile side pane renders no thumbnails', mobile.hiddenPanel.rendered === 0, {
    rendered: mobile.hiddenPanel.rendered,
    switcherPresent: mobile.hiddenPanel.switcherPresent,
  })
  check('the hidden mobile side pane fetches no extra theme pack', mobile.hiddenExtras.length === 0, {
    fetched: mobile.hiddenPacks,
    currentPack: themePack(MEASURED_THEME),
  })
  await screenshot(`mobile-${label}-editor.png`)

  await clickReal(`document.querySelector('[data-pane-tab="side"]')`)
  desktop.mobilePaneSwitch = await waitFor(
    `getComputedStyle(document.querySelector('[data-pane="side"]')).visibility !== 'hidden'`,
    'phone side pane visible',
    8000,
  )
  await sleep(1800)
  mobile.afterSide = await waitSettledPreviews()
  mobile.sidePacks = (await fetchedPacks()).map((entry) => entry.pack)
  mobile.sideRendered = renderedIds(mobile.afterSide)
  const mobileCurrentId = mobile.afterSide.currentThemeId || MEASURED_THEME
  mobile.sideNear = mobile.afterSide.tiles.filter((tile) => tile.near).map((tile) => tile.id)
  mobile.expectedSidePacks = packsFor(mobile.sideNear, mobileCurrentId)
  check(
    'switching to the side pane renders visible thumbnails',
    mobile.sideRendered.length > 0 && mobile.sideRendered.length < mobile.afterSide.tiles.length,
    { rendered: mobile.sideRendered.length, displayed: mobile.afterSide.tiles.length },
  )
  check(
    'the mobile side pane fetches only visible/current theme packs',
    mobile.sidePacks.every((pack) => mobile.expectedSidePacks.includes(pack)),
    { fetched: mobile.sidePacks, expected: mobile.expectedSidePacks },
  )
  check('the mobile side pane still avoids every pack up front', mobile.sidePacks.length < ALL_PACKS.length, {
    fetched: mobile.sidePacks,
  })
  await screenshot(`mobile-${label}-theme.png`)
  // Scrolling the mobile panel must load the rest as well.
  mobile.scrolled = await scrollThemePanelToBottom()
  await sleep(1600)
  mobile.afterScroll = await waitSettledPreviews()
  mobile.afterScrollRendered = renderedIds(mobile.afterScroll)
  check(
    'scrolling the mobile panel renders every thumbnail',
    mobile.afterScrollRendered.length === mobile.afterScroll.tiles.length,
    { rendered: mobile.afterScrollRendered.length, displayed: mobile.afterScroll.tiles.length },
  )

  const result = {
    measuredAt: new Date().toISOString(),
    app: origin,
    label,
    theme: { id: MEASURED_THEME, name: themeName(MEASURED_THEME), pack: themePack(MEASURED_THEME) },
    favourite: MEASURED_FAVORITE,
    desktop,
    mobile,
    checks,
    exceptions,
    appLog: appLog.slice(-8000),
  }
  fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(result, null, 2))
  console.log(
    `\n${checks.filter((item) => item.passed).length}/${checks.length} checks passed; evidence: ${path.join(outDir, `${label}.json`)}`,
  )
} catch (error) {
  check('quick-picker runner completes', false, error.stack || error.message)
  fs.writeFileSync(
    path.join(outDir, `${label}.json`),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        label,
        app: origin,
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
  fs.writeFileSync(path.join(outDir, `${label}.app.log`), appLog)
}
const failed = checks.filter((item) => !item.passed)
if (failed.length) console.log(`\nfailed: ${failed.map((item) => item.name).join('; ')}`)
process.exitCode = failed.length && assertOptimized ? 1 : 0
