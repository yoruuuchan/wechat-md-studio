// Browser acceptance for the 2026 UI re-layout.
//
// It connects to an already-running local production build (default
// http://127.0.0.1:3271/, CDP 9397), drives a fresh Chrome profile, and checks:
//   * the top bar at 1536 / 1280 / 960 / 768 / 640 / 390 — no horizontal
//     overflow, no clipped or overlapping controls;
//   * the article name still fits eight CJK characters at >= 960px;
//   * the four mode entries, the two placeholders and the side-panel tab that
//     follows the mode;
//   * every item in 更多, including import/export/account and the appearance
//     controls;
//   * card template/ratio/background in the side panel and the live preview;
//   * the theme quick-switcher in the side panel and the live preview;
//   * 复制到公众号 and 导出全部 ZIP (the ZIP is generated and discarded);
//   * the signed-in one-click save next to the save status.
//
// It also writes the review screenshots and verify-out/ui/index.html.
//
// Usage: node scripts/cdp-verify-ui-modes.mjs [appUrl] [cdpPort] [outputDir]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]

const APP = (process.argv[2] || 'http://127.0.0.1:3271/').replace(/\/$/, '') + '/'
const ORIGIN = new URL(APP).origin
const CDP_PORT = Number(process.argv[3] || 9397)
const OUTPUT = path.resolve(process.argv[4] || 'verify-out/ui')
fs.mkdirSync(OUTPUT, { recursive: true })
const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-ui-downloads-'))
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-ui-chrome-'))
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const checks = []
const exceptions = []
const consoleErrors = []
const chooserQueue = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
}

function envValue(name) {
  try {
    const text = fs.readFileSync(path.resolve('.env'), 'utf8')
    const line = text.split(/\r?\n/).find((row) => row.startsWith(name + '='))
    return line ? line.slice(name.length + 1).trim() : ''
  } catch {
    return ''
  }
}

let chrome
let ws
try {
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--window-size=1600,1000', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })

  let endpoint
  for (let i = 0; i < 120; i++) {
    try {
      endpoint = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl
    } catch { /* starting */ }
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60_000)
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
    if (message.method === 'Page.fileChooserOpened') {
      chooserQueue.push({ backendNodeId: message.params.backendNodeId })
    }
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('DOM.enable')
  await call('Page.setInterceptFileChooserDialog', { enabled: true })
  await send('Browser.grantPermissions', {
    origin: ORIGIN,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      if (location.origin === ${JSON.stringify(ORIGIN)} && !localStorage.getItem('ui-modes-fixture')) {
        localStorage.setItem('mopai.onboarding.v1', 'done');
        localStorage.setItem('mopai.lang.v1', 'zh');
        localStorage.setItem('mopai.theme.v1', 'akari');
        localStorage.setItem('ui-modes-fixture', '1');
      }
    } catch {}`,
  })

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
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
  const click = async (expression) => {
    const position = await evaluate(`(() => {
      const el = ${expression};
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    })()`)
    if (!position) throw new Error(`No visible click target: ${expression}`)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
  }
  const press = async (key, code, vk) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  }
  const escape = () => press('Escape', 'Escape', 27)
  const shot = async (name) => {
    await sleep(250)
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(OUTPUT, name), Buffer.from(result.data, 'base64'))
    console.log(`  screenshot: ${name}`)
  }
  const goto = async () => {
    await call('Page.navigate', { url: APP })
    await waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-topbar]')`, 'editor ready', 30_000)
    await sleep(300)
  }
  const setWidth = async (width, height) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await goto()
  }
  const setPrefs = async ({ lang, theme }) => {
    await evaluate(`(() => {
      ${lang ? `localStorage.setItem('mopai.lang.v1', ${JSON.stringify(lang)});` : ''}
      ${theme ? `localStorage.setItem('mopai.theme.v1', ${JSON.stringify(theme)});` : ''}
      return true
    })()`)
  }
  const setEditorText = async (text) => {
    await evaluate(`(() => {
      const v = window.__mopaiCodemirror;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} } });
      return true;
    })()`)
    await sleep(500)
  }
  const setDocName = async (name) => {
    await evaluate(`(() => {
      const input = document.querySelector('[data-doc-name]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await sleep(250)
  }
  const setMode = async (mode) => {
    await click(`document.querySelector('[data-preview-mode="${mode}"]')`)
    await waitFor(`document.querySelector('[data-preview-mode="${mode}"]')?.getAttribute('aria-pressed') === 'true'`, `${mode} mode selected`)
    if (mode === 'cards') await cardsReady()
  }
  const cardsReady = async () => {
    try {
      return await waitFor(
        `document.querySelector('[data-xhs-view]')?.dataset.ready === 'true' && !!document.querySelector('.xhs-card')`,
        'card layout ready',
        45_000,
      )
    } catch (error) {
      const state = await evaluate(`(() => ({
        mode: document.querySelector('[data-preview-mode="cards"]')?.getAttribute('aria-pressed'),
        view: !!document.querySelector('[data-xhs-view]'),
        ready: document.querySelector('[data-xhs-view]')?.dataset.ready,
        cards: document.querySelectorAll('.xhs-card').length,
        text: document.querySelector('[data-xhs-view]')?.innerText.slice(0, 160) || '',
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((el) => el.textContent).join(' | '),
      }))()`)
      throw new Error(`${error.message}; state=${JSON.stringify(state)}`)
    }
  }
  const activeSideTab = () => evaluate(`document.querySelector('[data-onboarding="sidebar"] [role=tab][aria-selected=true]')?.textContent.trim() || ''`)
  const openDrawer = async () => {
    if (await evaluate(`!!document.querySelector('[data-side-drawer]')`)) return
    await click(`document.querySelector('[data-open-side-panel]')`)
    await waitFor(`document.querySelector('[data-side-drawer]')?.dataset.state === 'open'`, 'drawer open')
    await sleep(300)
  }
  const closeDrawer = async () => {
    if (!(await evaluate(`!!document.querySelector('[data-side-drawer]')`))) return
    await escape()
    await waitFor(`!document.querySelector('[data-side-drawer]')`, 'drawer closed')
  }
  const openMore = async () => {
    // A previous menu may still be animating out; clicking the trigger during
    // that window is swallowed and the wait below would time out.
    await waitFor(`!document.querySelector('[role=menu]')`, 'previous More menu cleared', 5000).catch(() => {})
    await click(`document.querySelector('[data-topbar-more]')`)
    await waitFor(`!!document.querySelector('[role=menu]')`, 'More menu open')
    await sleep(200)
  }
  const moreItem = async (id) => {
    await openMore()
    const found = await evaluate(`!!document.querySelector('[data-more-item="${id}"]')`)
    if (found) await click(`document.querySelector('[data-more-item="${id}"]')`)
    return found
  }
  const waitFileChooser = async (label) => {
    const until = Date.now() + 5000
    while (Date.now() < until) {
      if (chooserQueue.length) return chooserQueue.shift()
      await sleep(100)
    }
    throw new Error(`no file chooser for ${label}`)
  }
  const expectDownload = async (label, extension, timeout = 90_000) => {
    const dir = path.join(DOWNLOADS, label)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    await send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: dir,
      eventsEnabled: true,
    })
    const until = Date.now() + timeout
    while (Date.now() < until) {
      const files = fs.readdirSync(dir)
      const file = files.find((name) => name.endsWith(extension))
      if (file && !files.some((name) => name.endsWith('.crdownload'))) {
        const full = path.join(dir, file)
        return { file, size: fs.statSync(full).size }
      }
      const error = await evaluate(`document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent || ''`)
      if (error) throw new Error(`${label}: ${error}`)
      await sleep(250)
    }
    throw new Error(`${label}: download timeout`)
  }

  // -------------------------------------------------------------------------
  await setWidth(1536, 900)
  check('editor loads with the sample article', await evaluate(`window.__mopaiCodemirror.state.doc.length > 100`))

  console.log('\n=== mode navigation and side-panel tabs ===')
  const modes = await evaluate(`(() => [...document.querySelectorAll('[data-preview-mode]')].map((el) => ({
    id: el.dataset.previewMode,
    text: el.textContent.trim(),
    disabled: el.getAttribute('aria-disabled') === 'true',
    pressed: el.getAttribute('aria-pressed'),
    title: el.getAttribute('title') || '',
    label: el.getAttribute('aria-label') || '',
    height: Math.round(el.getBoundingClientRect().height),
  })))()`)
  console.log(' ', JSON.stringify(modes))
  check('all four mode entries are present', JSON.stringify(modes.map((m) => m.id)) === JSON.stringify(['wechat', 'cards', 'long', 'motion']), modes.map((m) => m.id))
  check('mode entries are at least as large as the old preview toggle (>= 28px)', modes.every((m) => m.height >= 28), modes.map((m) => m.height))
  check('long-image and motion are visibly disabled placeholders', modes.filter((m) => m.id === 'long' || m.id === 'motion').every((m) => m.disabled && m.label.includes('即将推出')), modes.filter((m) => m.id === 'long' || m.id === 'motion'))
  const placeholderBox = await evaluate(`(() => {
    const r = document.querySelector('[data-preview-mode="long"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...placeholderBox })
  const placeholderTip = await waitFor(
    `(() => { const el = document.querySelector('[data-slot="tooltip-content"]'); return el ? el.textContent.trim() : '' })()`,
    'placeholder coming-soon tooltip',
    5000,
  ).catch(() => '')
  // Radix puts the visible text and a visually hidden copy inside the same
  // content node, so textContent contains the hint twice.
  check('hovering a placeholder shows the coming-soon hint', placeholderTip.includes('即将推出'), placeholderTip)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await click(`document.querySelector('[data-preview-mode="long"]')`)
  await sleep(250)
  check('clicking a placeholder does not change mode', await evaluate(`document.querySelector('[data-preview-mode="wechat"]').getAttribute('aria-pressed') === 'true'`))

  await setMode('wechat')
  check('WeChat mode starts on the 主题 tab', (await activeSideTab()) === '主题', await activeSideTab())
  await shot('1536-theme-tab.png')
  await setMode('cards')
  check('switching to cards lands on the 模板 tab', (await activeSideTab()) === '模板', await activeSideTab())
  await shot('1536-template-tab.png')

  console.log('\n=== theme quick-switcher in the side panel ===')
  await setMode('wechat')
  await waitFor(`!!document.querySelector('[data-theme-quick="minimal"]')`, 'quick theme tile', 30_000)
  const themeBefore = await evaluate(`document.querySelector('[data-preview-theme]')?.textContent || ''`)
  const minimalLabel = await evaluate(`document.querySelector('[data-theme-quick="minimal"] .truncate')?.textContent || ''`)
  await click(`document.querySelector('[data-theme-quick="minimal"]')`)
  await waitFor(`document.querySelector('[data-theme-quick="minimal"]')?.className.includes('ya-selected')`, 'theme selected')
  await sleep(400)
  const themeAfter = await evaluate(`document.querySelector('[data-preview-theme]')?.textContent || ''`)
  check('changing theme in the side panel updates the preview caption', themeAfter !== themeBefore && themeAfter.includes(minimalLabel), { themeBefore, themeAfter, minimalLabel })
  check('changing theme keeps the preview rendered', await evaluate(`!!document.querySelector('[data-onboarding="preview"] section') || !!document.querySelector('[data-onboarding="preview"] h1')`))
  await click(`document.querySelector('[data-theme-quick="golden"]')`)
  await sleep(400)

  console.log('\n=== card template / ratio / background in the side panel ===')
  await setMode('cards')
  await click(`document.querySelector('[data-card-template="console"]')`)
  await cardsReady()
  await click(`document.querySelector('[data-card-ratio="1:1"]')`)
  await cardsReady()
  await click(`document.querySelector('[data-card-bg="akari"]')`)
  await cardsReady()
  const cardOptions = await evaluate(`(() => {
    const card = document.querySelector('.xhs-card');
    return {
      template: card?.dataset.template,
      variant: card?.dataset.variant,
      ratio: document.querySelector('[data-card-ratio][aria-pressed="true"]')?.dataset.cardRatio,
      width: card ? Math.round(card.getBoundingClientRect().width / (260 / 540)) : 0,
      height: card ? Math.round(card.getBoundingClientRect().height / (260 / 540)) : 0,
      templateButton: document.querySelector('[data-card-template="console"]')?.getAttribute('aria-pressed'),
    };
  })()`)
  console.log(' ', JSON.stringify(cardOptions))
  check('card template switch reaches the preview', cardOptions.template === 'console' && cardOptions.templateButton === 'true', cardOptions)
  check('card ratio switch reaches the preview (1:1 exports 540x540)', cardOptions.ratio === '1:1' && Math.abs(cardOptions.width - cardOptions.height) <= 2, cardOptions)
  check('card background switch reaches the preview', cardOptions.variant === 'akari', cardOptions)
  await click(`document.querySelector('[data-card-template="reed"]')`)
  await cardsReady()
  await click(`document.querySelector('[data-card-ratio="3:4"]')`)
  await cardsReady()
  await click(`document.querySelector('[data-card-bg="paper"]')`)
  await cardsReady()

  console.log('\n=== 更多 contains every moved action ===')
  await setMode('wechat')
  await openMore()
  const moreIds = await evaluate(`(() => [...document.querySelectorAll('[data-more-item]')].map((el) => el.dataset.moreItem))()`)
  console.log(' ', JSON.stringify(moreIds))
  const expectedMore = ['save-draft', 'drafts', 'materials', 'panel', 'import-markdown', 'import-docx', 'import-bundle', 'export-markdown', 'export-clean', 'export-page', 'export-bundle', 'language', 'appearance', 'references', 'github', 'login']
  check('更多 exposes all required entries', expectedMore.every((id) => moreIds.includes(id)) && moreIds.length === expectedMore.length, moreIds)
  await escape()

  const moreEffects = []
  const record = (id, ok, detail) => {
    moreEffects.push({ id, ok, detail })
    check(`更多 → ${id} works`, ok, detail)
  }
  // save-draft (signed out) explains that cloud drafts need the owner login.
  await moreItem('save-draft')
  let saveToast = await waitFor(`!!document.querySelector('[data-sonner-toast]')`, 'save toast', 10_000).then(() => true).catch(() => false)
  if (!saveToast) {
    // The first pointer event can land while Radix is still positioning the
    // menu; retry once before calling the entry broken.
    await sleep(300)
    await moreItem('save-draft')
    saveToast = await waitFor(`!!document.querySelector('[data-sonner-toast]')`, 'save toast retry', 10_000).then(() => true).catch(() => false)
  }
  record('save-draft', saveToast, await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((el) => el.textContent).join(' | ')`))

  for (const [id, route] of [['drafts', '/drafts'], ['materials', '/materials'], ['references', '/references'], ['login', '/login']]) {
    await goto()
    await moreItem(id)
    const reached = await waitFor(`location.pathname === ${JSON.stringify(route)}`, `${id} route`, 10_000).then(() => true).catch(() => false)
    record(id, reached, { expected: route, actual: await evaluate('location.pathname') })
  }

  for (const id of ['import-markdown', 'import-docx', 'import-bundle']) {
    await goto()
    chooserQueue.length = 0
    await moreItem(id)
    const chooser = await waitFileChooser(id).then(() => true).catch(() => false)
    record(id, chooser)
    await escape()
  }

  for (const [id, ext] of [['export-markdown', '.md'], ['export-bundle', '.json']]) {
    await goto()
    await openMore()
    // expectDownload sets the download directory and then waits; click only
    // after its setup has run so the browser saves into the watched folder.
    const pendingDownload = expectDownload(id, ext)
    await sleep(100)
    await click(`document.querySelector('[data-more-item="${id}"]')`)
    const got = await pendingDownload.then((r) => r.size > 100).catch(() => false)
    record(id, got)
  }

  for (const id of ['export-clean', 'export-page']) {
    await goto()
    await moreItem(id)
    const opened = await waitFor(`!!document.querySelector('[data-preflight]')`, `${id} preflight`, 10_000).then(() => true).catch(() => false)
    record(id, opened)
    await escape()
    await waitFor(`!document.querySelector('[data-preflight]')`, `${id} preflight closed`, 10_000).catch(() => {})
  }

  await goto()
  const panelBefore = await evaluate(`document.querySelectorAll('[data-slot="resizable-panel"]').length`)
  await moreItem('panel')
  const panelClosed = await waitFor(`document.querySelectorAll('[data-slot="resizable-panel"]').length === 2`, 'panel closed', 5000).then(() => true).catch(() => false)
  await moreItem('panel')
  let panelBack = await waitFor(`document.querySelectorAll('[data-slot="resizable-panel"]').length === ${panelBefore}`, 'panel reopened', 5000).then(() => true).catch(() => false)
  if (!panelBack) {
    // A menu item clicked while the panel was remounting can be lost between
    // the pointer event and React's commit; one explicit retry is enough.
    await sleep(400)
    await moreItem('panel')
    panelBack = await waitFor(`document.querySelectorAll('[data-slot="resizable-panel"]').length === ${panelBefore}`, 'panel reopened on retry', 5000).then(() => true).catch(() => false)
  }
  const panelCountAfter = await evaluate(`document.querySelectorAll('[data-slot="resizable-panel"]').length`)
  record('panel', panelClosed && panelBack, { panelBefore, panelClosed, panelBack, panelCountAfter })

  await goto()
  await moreItem('language')
  await click(`document.querySelector('[data-more-item="language"] [data-lang="en"]')`)
  const toEnglish = await waitFor(`document.documentElement.lang === 'en'`, 'language switch', 5000).then(() => true).catch(() => false)
  await click(`document.querySelector('[data-more-item="language"] [data-lang="zh"]')`)
  await waitFor(`document.documentElement.lang === 'zh'`, 'language restored', 5000).catch(() => {})
  record('language', toEnglish)
  await escape()
  await goto()

  await moreItem('appearance')
  await click(`document.querySelectorAll('[data-more-item="appearance"] [role=radio]')[2]`)
  const toDark = await waitFor(`document.documentElement.classList.contains('dark')`, 'dark theme', 5000).then(() => true).catch(() => false)
  await click(`document.querySelectorAll('[data-more-item="appearance"] [role=radio]')[0]`)
  await waitFor(`!document.documentElement.classList.contains('dark')`, 'light theme restored', 5000).catch(() => {})
  record('appearance', toDark)
  await escape()

  await goto()
  await openMore()
  const github = await evaluate(`(() => {
    const a = document.querySelector('[data-more-item="github"]');
    return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null;
  })()`)
  record('github', Boolean(github?.href?.includes('github.com') && github.target === '_blank'), github)

  console.log('\n=== top bar at every required width ===')
  const measureTopbar = () => evaluate(`(() => {
    const header = document.querySelector('[data-topbar]');
    const h = header.getBoundingClientRect();
    const vw = window.innerWidth;
    const controls = [...header.querySelectorAll('button, a, input')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.innerText || el.title || el.value || '').trim().slice(0, 24), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
    const clipped = controls.filter((c) => c.left < -0.5 || c.right > vw + 0.5 || c.top < h.top - 0.5 || c.bottom > h.bottom + 0.5);
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(a.text + ' x ' + b.text);
    }
    return {
      vw,
      headerOverflow: header.scrollWidth - header.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - vw,
      height: Math.round(h.height),
      controls: controls.length,
      clipped: clipped.map((c) => c.text),
      overlaps,
    };
  })()`)
  const measureDocName = () => evaluate(`(() => {
    const input = document.querySelector('[data-doc-name]');
    const cs = getComputedStyle(input);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = cs.fontSize + ' ' + cs.fontFamily;
    const text = '八个汉字测试稿件';
    return {
      clientWidth: input.clientWidth,
      textWidth: ctx.measureText(text).width,
      padding: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
      value: input.value,
    };
  })()`)

  const widths = [1536, 1280, 960, 768, 640, 390]
  for (const width of widths) {
    const height = width === 390 ? 844 : 900
    await setWidth(width, height)
    const bar = await measureTopbar()
    check(`${width}px: the top bar has no horizontal overflow`, bar.headerOverflow <= 0 && bar.pageOverflow <= 0, bar)
    check(`${width}px: every visible top-bar control is fully visible`, bar.clipped.length === 0, bar.clipped)
    check(`${width}px: no two top-bar controls overlap`, bar.overlaps.length === 0, bar.overlaps)

    if (width >= 960) {
      const original = await evaluate(`document.querySelector('[data-doc-name]').value`)
      await setDocName('八个汉字测试稿件')
      const fit = await measureDocName()
      const room = fit.clientWidth - fit.padding
      check(`${width}px: the article name shows at least eight CJK characters`, room + 0.5 >= fit.textWidth, { room, ...fit })
      await setDocName(original)
    }

    if (width < 640) {
      await click(`document.querySelector('[data-pane-tab="preview"]')`)
      await waitFor(`getComputedStyle(document.querySelector('[data-pane="preview"]')).visibility !== 'hidden'`, 'phone preview pane')
    }
    await setMode('wechat')
    await evaluate('document.fonts.ready.then(() => true)')
    await shot(`${width}-wechat.png`)
    await setMode('cards')
    await evaluate('document.fonts.ready.then(() => true)')
    await shot(`${width}-cards.png`)

    if (width >= 960) {
      if (width < 1200) {
        await openDrawer()
        const tab = await activeSideTab()
        check(`${width}px: the medium drawer opens on the card 模板 tab`, tab === '模板', tab)
        await closeDrawer()
      } else {
        const tab = await activeSideTab()
        check(`${width}px: the right column stays on the card 模板 tab`, tab === '模板', tab)
      }
    }
  }

  console.log('\n=== screenshots for review ===')
  await setWidth(1280, 900)
  await setMode('wechat')
  await openMore()
  await shot('1280-more.png')
  await escape()

  await setWidth(768, 900)
  await setMode('cards')
  await openDrawer()
  await shot('768-drawer-cards.png')
  await closeDrawer()

  await setWidth(1536, 900)
  await setPrefs({ theme: 'yoru' })
  await goto()
  await setMode('wechat')
  await shot('1536-dark-wechat.png')
  await setMode('cards')
  await shot('1536-dark-cards.png')

  await setPrefs({ theme: 'akari' })
  await setWidth(1280, 900)
  await setPrefs({ lang: 'en' })
  await goto()
  await setMode('wechat')
  await evaluate('document.fonts.ready.then(() => true)')
  await shot('1280-en-wechat.png')
  await setMode('cards')
  await evaluate('document.fonts.ready.then(() => true)')
  await shot('1280-en-cards.png')
  const enBar = await measureTopbar()
  check('1280px English: the top bar does not overflow', enBar.headerOverflow <= 0 && enBar.pageOverflow <= 0 && enBar.clipped.length === 0, enBar)
  const enSideTabs = await evaluate(`(() => {
    const list = document.querySelector('[data-onboarding="sidebar"] [role=tablist]');
    if (!list) return null;
    return {
      overflow: list.scrollWidth - list.clientWidth,
      labels: [...list.querySelectorAll('[role=tab]')].map((el) => el.textContent.trim()),
    };
  })()`)
  check('1280px English: the right-panel tabs do not overflow', Boolean(enSideTabs && enSideTabs.overflow <= 0), enSideTabs)

  await setWidth(390, 844)
  const enPhoneBar = await measureTopbar()
  check('390px English: the top bar does not overflow', enPhoneBar.headerOverflow <= 0 && enPhoneBar.pageOverflow <= 0 && enPhoneBar.clipped.length === 0 && enPhoneBar.overlaps.length === 0, enPhoneBar)

  await setPrefs({ lang: 'zh', theme: 'akari' })
  await goto()

  console.log('\n=== copy and export actions ===')
  await setWidth(1536, 900)
  await setEditorText('# 界面验收\n\n这是一段干净的正文，用来核对复制和导出。')
  await setMode('wechat')
  await click(`document.querySelector('[data-topbar-primary]')`)
  const copied = await waitFor(`navigator.clipboard.readText().then((text) => text.includes('干净的正文'))`, 'clipboard copy', 15_000).then(() => true).catch(() => false)
  const preflightOpen = await evaluate(`!!document.querySelector('[data-preflight]')`)
  check('公众号模式: 复制到公众号 reaches the clipboard', copied && !preflightOpen, { copied, preflightOpen })

  await setEditorText('# 卡片验收\n\n## 一节\n\n正文已经写完。')
  await setMode('cards')
  await cardsReady()
  const zipDownload = expectDownload('zip', '.zip', 120_000)
  await sleep(100)
  await click(`document.querySelector('[data-card-export-all]')`)
  const zip = await zipDownload.catch((error) => ({ error: error.message }))
  check('卡片模式: 导出全部 ZIP is generated', zip.size > 1000, zip)

  console.log('\n=== signed-in one-click save ===')
  const accessKey = envValue('ACCESS_KEY')
  if (!accessKey) {
    check('signed-in one-click save: local ACCESS_KEY available for the test', false, 'missing ACCESS_KEY in ignored .env')
  } else {
    await evaluate(`fetch('/api/trpc/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { accessKey: ${JSON.stringify(accessKey)} } }),
    }).then((r) => r.text())`)
    await goto()
    const quick = await waitFor(`!!document.querySelector('[data-save-draft-quick]')`, 'one-click save', 10_000).then(() => true).catch(() => false)
    check('signed in: the save status exposes a one-click draft save', quick)
    if (quick) {
      await click(`document.querySelector('[data-save-draft-quick]')`)
      const saved = await waitFor(`[...document.querySelectorAll('[data-sonner-toast]')].some((el) => /已保存到草稿箱|Saved to drafts/.test(el.textContent))`, 'save toast', 15_000).then(() => true).catch(() => false)
      check('signed in: one click saves the article to the drafts box', saved, await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map((el) => el.textContent).join(' | ')`))
    }
    await setWidth(960, 900)
    const signedBar = await measureTopbar()
    check('960px signed in: the quick save and every control are not clipped', signedBar.headerOverflow <= 0 && signedBar.pageOverflow <= 0 && signedBar.clipped.length === 0 && signedBar.overlaps.length === 0, signedBar)
    await setWidth(390, 844)
    const signedPhoneBar = await measureTopbar()
    check('390px signed in: the quick save and every control are not clipped', signedPhoneBar.headerOverflow <= 0 && signedPhoneBar.pageOverflow <= 0 && signedPhoneBar.clipped.length === 0 && signedPhoneBar.overlaps.length === 0, signedPhoneBar)

    // 更多 owns the account entry: while signed in it must offer logout, and
    // using it must actually sign out (the app returns to /login; the signed-out
    // menu's login entry was already exercised above).
    await openMore()
    const hasLogout = await evaluate(`!!document.querySelector('[data-more-item="logout"]')`)
    if (hasLogout) await click(`document.querySelector('[data-more-item="logout"]')`)
    const signedOut = hasLogout
      ? await waitFor(`location.pathname === '/login'`, 'signed out to /login', 10_000).then(() => true).catch(() => false)
      : false
    check('signed in: 更多 offers logout and it signs out', signedOut, { hasLogout, signedOut, actual: await evaluate('location.pathname') })
  }

  check('no uncaught page exceptions', exceptions.length === 0, exceptions.length)
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3))
} catch (error) {
  check('script completed without throwing', false, error.stack || error.message)
} finally {
  if (ws) { try { ws.close() } catch { /* already closed */ } }
  if (chrome) chrome.kill()
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* Chrome holds it */ }
  try { fs.rmSync(DOWNLOADS, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
function writeReviewIndex() {
  const widths = [1536, 1280, 960, 768, 640, 390]
  const figure = (src, label) => {
    if (!fs.existsSync(path.join(OUTPUT, src))) return ''
    return `<figure><img src="${src}" alt="${label}"><figcaption>${label}</figcaption></figure>`
  }
  const sections = widths.map((width) => `<section id="w${width}"><h2>${width}px</h2><div class="pair">
    ${figure(`${width}-wechat.png`, `${width}px · 公众号模式`)}
    ${figure(`${width}-cards.png`, `${width}px · 卡片模式`)}
  </div></section>`).join('\n')
  const extras = `<section id="states"><h2>状态与菜单</h2><div class="pair">
    ${figure('1280-more.png', '1280px · 更多菜单展开')}
    ${figure('1536-theme-tab.png', '1536px · 右栏「主题」')}
    ${figure('1536-template-tab.png', '1536px · 右栏「模板」')}
    ${figure('768-drawer-cards.png', '768px · 卡片模式抽屉')}
    ${figure('1536-dark-wechat.png', '1536px · 深色 · 公众号')}
    ${figure('1536-dark-cards.png', '1536px · 深色 · 卡片')}
    ${figure('1280-en-wechat.png', '1280px · English · 公众号')}
    ${figure('1280-en-cards.png', '1280px · English · 卡片')}
  </div></section>`
  const html = `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<title>芦苇 · 编辑器界面重排验收</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #f4f1ea; color: #2b2a26; font: 14px/1.5 "Noto Sans SC", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p.lead { margin: 0 0 28px; color: #6b675d; }
  section { margin: 0 0 36px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; align-items: start; }
  figure { margin: 0; background: #fff; border: 1px solid #ddd6c8; border-radius: 10px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { padding: 8px 12px; font-size: 12px; color: #6b675d; border-top: 1px solid #eee7da; }
</style>
<h1>芦苇 · 编辑器界面重排</h1>
<p class="lead">每个宽度各一张公众号模式与卡片模式；另附「更多」、右栏模式标签、抽屉、深色与英文界面。截图目录同此页，verify-out 不进 git。</p>
${sections}
${extras}
</html>`
  fs.writeFileSync(path.join(OUTPUT, 'index.html'), html)
}
writeReviewIndex()

const failed = checks.filter((c) => !c.passed)
const summary = {
  task: 'Editor UI modes: top bar, mode navigation, side-panel theme/template tabs, preview-only panes',
  checks,
  exceptions: exceptions.length,
  consoleErrors,
  output: OUTPUT,
  result: failed.length === 0 ? 'PASS' : 'FAIL',
  failed: failed.map((c) => c.name),
}
fs.writeFileSync(path.join(OUTPUT, 'ui-modes.json'), JSON.stringify(summary, null, 2))
console.log(`\n${summary.result} · ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) {
  console.log(`Failed: ${failed.map((c) => c.name).join('; ')}`)
  process.exitCode = 1
}