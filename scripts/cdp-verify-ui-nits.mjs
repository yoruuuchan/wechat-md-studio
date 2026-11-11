// Browser acceptance for the four 2026-11 editor UI nits:
//   1. phone mode switching is a pill in the top bar, not a second row;
//   2. 外观与语言 moved from 更多 into the side panel's 设置 tab;
//   3. 中文 quick save reads 存草稿 at every width;
//   4. uploading / deleting / sync / errors live inside the 我的 template group;
//   5. a clipped article name ends in an ellipsis instead of a half character.
//
// It connects to an already-running production build (default
// http://127.0.0.1:3271/, CDP 9397), uses the ignored .env ACCESS_KEY to sign
// in, and writes after screenshots plus verify-out/nits/index.html (before and
// after side by side). Run with:
//
//   node scripts/cdp-verify-ui-nits.mjs [appUrl] [cdpPort] [outputDir]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key]

const APP = (process.argv[2] || 'http://127.0.0.1:3271/').replace(/\/$/, '') + '/'
const ORIGIN = new URL(APP).origin
const CDP_PORT = Number(process.argv[3] || 9397)
const OUTPUT = path.resolve(process.argv[4] || 'verify-out/nits/after')
const PAIR_ROOT = path.dirname(OUTPUT)
const TEMPLATE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-nits-templates-'))
fs.mkdirSync(OUTPUT, { recursive: true })
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-nits-after-'))
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const checks = []
const exceptions = []
const consoleErrors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, passed, detail) => {
  checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`)
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
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('DOM.enable')
  await call('Page.setInterceptFileChooserDialog', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      localStorage.setItem('mopai.onboarding.v1', 'done');
      if (!localStorage.getItem('ui-nits-fixture')) {
        localStorage.setItem('mopai.lang.v1', 'zh');
        localStorage.setItem('mopai.theme.v1', 'akari');
        localStorage.setItem('ui-nits-fixture', '1');
      }
    } catch {}`,
  })

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
    await sleep(250)
  }
  const escape = async () => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(250)
  }
  /** Plain React buttons: a direct click avoids pointer races during re-render. */
  const tap = async (expression) => {
    const clicked = await evaluate(`(() => { const el = ${expression}; if (!el) return false; el.click(); return true })()`)
    if (!clicked) throw new Error(`No click target: ${expression}`)
    await sleep(250)
  }
  const shot = async (name) => {
    await sleep(300)
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(OUTPUT, name), Buffer.from(result.data, 'base64'))
    console.log(`  screenshot: ${name}`)
  }
  const goto = async () => {
    await call('Page.navigate', { url: APP })
    await waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('[data-topbar]')`, 'editor ready', 40_000)
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
  const cardsReady = async () => {
    await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true' && !!document.querySelector('.xhs-card')`, 'card layout ready', 45_000)
    await sleep(250)
  }
  const setMode = async (mode) => {
    const pill = await evaluate(`!!document.querySelector('[data-topbar-mode-pill]')`)
    if (pill) {
      if ((await evaluate(`document.querySelector('[data-topbar-mode-pill]')?.dataset.mode`)) !== mode) {
        await click(`document.querySelector('[data-topbar-mode-pill]')`)
        await waitFor(`!!document.querySelector('[role=menu] [data-preview-mode="${mode}"]')`, `${mode} pill menu open`)
        await click(`document.querySelector('[role=menu] [data-preview-mode="${mode}"]')`)
      }
      await waitFor(`document.querySelector('[data-topbar-mode-pill]')?.dataset.mode === ${JSON.stringify(mode)}`, `${mode} selected`)
    } else {
      await click(`document.querySelector('[data-preview-mode="${mode}"]')`)
      await waitFor(`document.querySelector('[data-preview-mode="${mode}"]')?.getAttribute('aria-pressed') === 'true'`, `${mode} selected`)
    }
    if (mode === 'cards') await cardsReady()
  }
  const openMore = async () => {
    await waitFor(`!document.querySelector('[role=menu]')`, 'previous menu cleared', 5000).catch(() => {})
    await click(`document.querySelector('[data-topbar-more]')`)
    await waitFor(`!!document.querySelector('[role=menu]')`, 'More menu open')
    await sleep(200)
  }
  const activeSideTab = () => evaluate(`document.querySelector('[data-onboarding="sidebar"] [role=tab][aria-selected=true]')?.textContent.trim() || ''`)
  const settingsState = () => evaluate(`(() => {
    const drawer = document.querySelector('[data-side-drawer]');
    const sidePane = document.querySelector('[data-pane="side"]');
    const sidebar = document.querySelector('[data-onboarding="sidebar"]');
    return {
      drawer: drawer ? drawer.dataset.state : null,
      sidePaneVisible: sidePane ? getComputedStyle(sidePane).visibility !== 'hidden' : null,
      sidebarVisible: sidebar ? sidebar.getBoundingClientRect().width > 0 : false,
      tab: document.querySelector('[data-onboarding="sidebar"] [role=tab][aria-selected=true]')?.textContent.trim() || '',
      hasLanguage: !!document.querySelector('[data-settings-item="language"] [data-lang]'),
      hasTheme: !!document.querySelector('[data-settings-item="appearance"] [role=radio]'),
    };
  })()`)

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
      lang: document.documentElement.lang,
      headerOverflow: header.scrollWidth - header.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - vw,
      height: Math.round(h.height),
      controls: controls.length,
      clipped: clipped.map((c) => c.text),
      overlaps,
      pill: !!document.querySelector('[data-topbar-mode-pill]'),
      modesNav: !!document.querySelector('[data-topbar-modes]'),
      modeRow: !!document.querySelector('[data-topbar-modes-row]'),
    };
  })()`)

  const measureDocName = () => evaluate(`(() => {
    const input = document.querySelector('[data-doc-name]');
    const cs = getComputedStyle(input);
    const header = document.querySelector('[data-topbar]');
    return {
      value: input.value,
      textOverflow: cs.textOverflow,
      overflowX: cs.overflowX,
      scrollWidth: input.scrollWidth,
      clientWidth: input.clientWidth,
      headerOverflow: header.scrollWidth - header.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`)

  const measurePhoneBody = () => evaluate(`(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, height: Math.round(r.height * 10) / 10 };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: box('[data-topbar]'),
      headerMain: box('[data-topbar-main]'),
      modeRow: box('[data-topbar-modes-row]'),
      note: box('[data-narrow-note]'),
      switcher: box('[data-pane-switcher]'),
      editorPane: box('[data-pane="editor"]'),
      editorContent: box('.cm-content'),
      totalToEditorPane: box('[data-pane="editor"]')?.top ?? null,
      totalToBodyText: box('.cm-content')?.top ?? null,
      pill: box('[data-topbar-mode-pill]'),
    };
  })()`)

  // Pre-change phone measurements, taken from the same build before the mode
  // row was removed (verify-out/nits/before/measurements.json).
  const PHONE_BASELINE = {
    390: { editorPaneTop: 201.8, bodyTextTop: 286.8, headerHeight: 105 },
    360: { editorPaneTop: 201.8, bodyTextTop: 286.8, headerHeight: 105 },
  }

  const accessKey = envValue('ACCESS_KEY')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await goto()
  if (accessKey) {
    await evaluate(`fetch('/api/trpc/auth.login', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { accessKey: ${JSON.stringify(accessKey)} } }),
    }).then((r) => r.text())`)
  }
  await goto()
  const signedIn = await evaluate(`!!document.querySelector('[data-save-draft-quick]')`)
  check('signed-in fixture: the quick save button exists', signedIn)
  await evaluate(`(() => {
    const v = window.__mopaiCodemirror;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '# 界面小毛病验收\\n\\n这是一段用来核对顶栏、模式入口、设置标签和卡片模板分组的正文。\\n\\n## 第一节\\n\\n正文内容。' } });
    return true;
  })()`)
  await sleep(500)

  // -------------------------------------------------------------------------
  console.log('\n=== top bar at every width, both languages and modes ===')
  const widths = [1536, 1280, 960, 768, 640, 390, 360]
  const widthHeight = (width) => (width === 390 ? 844 : width === 360 ? 740 : 900)
  for (const width of widths) {
    for (const lang of ['zh', 'en']) {
      await setPrefs({ lang })
      await setWidth(width, widthHeight(width))
      for (const mode of ['wechat', 'cards']) {
        if (width < 640) {
          const pane = mode === 'cards' ? 'preview' : 'editor'
          await click(`document.querySelector('[data-pane-tab="${pane}"]')`)
          await waitFor(`getComputedStyle(document.querySelector('[data-pane="${pane}"]')).visibility !== 'hidden'`, `${width}px ${pane} pane`)
        }
        await setMode(mode)
        const bar = await measureTopbar()
        check(`${width}px ${lang} ${mode}: the top bar has no horizontal overflow`, bar.headerOverflow <= 0 && bar.pageOverflow <= 0, bar)
        check(`${width}px ${lang} ${mode}: every visible top-bar control is fully visible`, bar.clipped.length === 0 && bar.overlaps.length === 0, { clipped: bar.clipped, overlaps: bar.overlaps })
        check(`${width}px ${lang} ${mode}: the mode entry matches this layout`, width < 640 ? bar.pill && !bar.modesNav && !bar.modeRow : bar.modesNav, { pill: bar.pill, modesNav: bar.modesNav, modeRow: bar.modeRow })
        if (lang === 'zh') {
          const label = await evaluate(`document.querySelector('[data-save-draft-quick]')?.textContent?.trim() || ''`)
          check(`${width}px ${mode}: the Chinese quick save reads 存草稿`, label === '存草稿', label)
        } else if (width === 390 && mode === 'wechat') {
          const label = await evaluate(`document.querySelector('[data-save-draft-quick]')?.textContent?.trim() || ''`)
          check('390px English: the quick save keeps its short English label', label === 'Save', label)
        }
      }
      if (width < 640 && lang === 'zh') {
        const body = await measurePhoneBody()
        const baseline = PHONE_BASELINE[width]
        check(`${width}px: the old separate mode row is gone`, body.modeRow === null, body.modeRow)
        check(`${width}px: the mode pill sits inside the single top bar`, body.pill !== null && body.header.height < baseline.headerHeight, body)
        check(`${width}px: the article starts at least 40px higher than before`,
          body.totalToEditorPane <= baseline.editorPaneTop - 40 && body.totalToBodyText <= baseline.bodyTextTop - 40,
          { before: baseline, after: { totalToEditorPane: body.totalToEditorPane, totalToBodyText: body.totalToBodyText } })
      }
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n=== article name ellipsis ===')
  await setPrefs({ lang: 'zh' })
  await setWidth(1280, 900)
  await setMode('wechat')
  const wideName = await measureDocName()
  check('the doc-name input computes text-overflow: ellipsis', wideName.textOverflow === 'ellipsis', wideName)

  const narrowNames = []
  for (const width of [390, 360]) {
    await setWidth(width, widthHeight(width))
    await setMode('wechat')
    narrowNames.push({ width, ...(await measureDocName()) })
  }
  check('390px and 360px: an overflowing article name is ellipsized and the top bar does not overflow horizontally',
    narrowNames.every((item) => item.scrollWidth > item.clientWidth && item.textOverflow === 'ellipsis' && item.headerOverflow <= 0 && item.pageOverflow <= 0),
    narrowNames)

  // -------------------------------------------------------------------------
  console.log('\n=== phone screenshots and pill mode switching ===')
  await setPrefs({ lang: 'zh' })
  await setWidth(390, 844)
  await click(`document.querySelector('[data-pane-tab="editor"]')`)
  await setMode('wechat')
  await shot('390-wechat.png')

  await click(`document.querySelector('[data-topbar-mode-pill]')`)
  await waitFor(`!!document.querySelector('[role=menu]')`, 'phone mode menu open')
  const entries = await evaluate(`(() => [...document.querySelectorAll('[role=menu] [data-preview-mode]')].map((el) => ({
    id: el.dataset.previewMode,
    text: el.textContent.trim(),
    disabled: el.hasAttribute('data-disabled') || el.getAttribute('aria-disabled') === 'true',
    placeholder: el.dataset.modePlaceholder === 'true',
    selected: el.dataset.modeSelected === 'true',
  })))()`)
  check('390px: the pill menu lists all four modes', JSON.stringify(entries.map((entry) => entry.id)) === JSON.stringify(['wechat', 'cards', 'long', 'motion']), entries)
  // 动效 is a mode of its own when the build carries the composer, a placeholder otherwise
  // (cdp-verify-ui-modes.mjs checks the mode itself).
  const isPlaceholder = (entry) => entry.disabled && entry.placeholder && entry.text.includes('即将推出')
  check('390px: 长图 is selectable', entries.filter((entry) => entry.id === 'long').every((entry) => !entry.disabled && !entry.placeholder), entries)
  check('390px: 动效 is selectable, or a placeholder when the build has no composer',
    entries.filter((entry) => entry.id === 'motion').every((entry) => (!entry.disabled && !entry.placeholder) || isPlaceholder(entry)), entries)
  await evaluate(`document.querySelector('[role=menu] [data-preview-mode="long"]')?.click()`)
  await sleep(300)
  check('390px: choosing 长图 switches the mode',
    (await evaluate(`document.querySelector('[data-topbar-mode-pill]')?.dataset.mode`)) === 'long')
  if (!(await evaluate(`!!document.querySelector('[role=menu]')`))) {
    await click(`document.querySelector('[data-topbar-mode-pill]')`)
    await waitFor(`!!document.querySelector('[role=menu]')`, 'phone mode menu reopened')
  }
  await shot('390-mode-picker.png')
  await escape()
  await setMode('cards')
  await click(`document.querySelector('[data-pane-tab="preview"]')`)
  await cardsReady()
  await shot('390-cards.png')
  await click(`document.querySelector('[data-pane-tab="editor"]')`)
  await setMode('wechat')
  await setWidth(360, 740)
  await click(`document.querySelector('[data-pane-tab="editor"]')`)
  await setMode('wechat')
  await shot('360-wechat.png')
  await setMode('cards')
  await click(`document.querySelector('[data-pane-tab="preview"]')`)
  await cardsReady()
  await shot('360-cards.png')
  await click(`document.querySelector('[data-pane-tab="editor"]')`)

  fs.writeFileSync(path.join(OUTPUT, 'measurements.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    app: APP,
    viewport: 'device metrics, mobile:false',
    measurements: {
      390: await (async () => { await setWidth(390, 844); await setMode('wechat'); await sleep(400); return measurePhoneBody() })(),
      360: await (async () => { await setWidth(360, 740); await setMode('wechat'); await sleep(400); return measurePhoneBody() })(),
    },
  }, null, 2))

  // -------------------------------------------------------------------------
  console.log('\n=== 更多 → 外观与语言 opens 设置 ===')
  await setPrefs({ lang: 'zh' })
  await setWidth(1280, 900)
  await setMode('wechat')
  await openMore()
  const moreIds = await evaluate(`(() => [...document.querySelectorAll('[data-more-item]')].map((el) => el.dataset.moreItem))()`)
  check('更多 exposes one 外观与语言 entry instead of inline controls',
    moreIds.includes('appearance-language') && !moreIds.includes('language') && !moreIds.includes('appearance'), moreIds)
  await shot('1280-more.png')
  await click(`document.querySelector('[data-more-item="appearance-language"]')`)
  await waitFor(`!!document.querySelector('[data-settings-item="language"] [data-lang]')`, 'settings tab after 更多', 10_000)
  check('1280px: 更多 → 外观与语言 lands on the 设置 tab', (await activeSideTab()) === '设置', await activeSideTab())
  const settingsLight = await settingsState()
  check('1280px: the 设置 tab holds both moved controls', settingsLight.hasLanguage && settingsLight.hasTheme, settingsLight)
  await shot('1280-settings-light.png')
  await evaluate(`document.querySelectorAll('[data-settings-item="appearance"] [role=radio]')[2].click()`)
  await waitFor(`document.documentElement.classList.contains('dark')`, 'dark theme from settings')
  await sleep(400)
  await shot('1280-settings-dark.png')
  await evaluate(`document.querySelectorAll('[data-settings-item="appearance"] [role=radio]')[0].click()`)
  await waitFor(`!document.documentElement.classList.contains('dark')`, 'light theme from settings')
  await sleep(400)
  await evaluate(`document.querySelector('[data-settings-item="language"] [data-lang="en"]').click()`)
  const settingsEnglish = await waitFor(`document.documentElement.lang === 'en'`, 'English from settings').then(() => true).catch(() => false)
  await sleep(700)
  await evaluate(`document.querySelector('[data-settings-item="language"] [data-lang="zh"]').click()`)
  await waitFor(`document.documentElement.lang === 'zh-CN'`, 'Chinese from settings')
  await sleep(700)
  check('1280px: language and appearance controls in 设置 take effect', settingsEnglish)

  for (const width of [768, 390]) {
    await setPrefs({ lang: 'zh' })
    await setWidth(width, widthHeight(width))
    await setMode('wechat')
    await openMore()
    await click(`document.querySelector('[data-more-item="appearance-language"]')`)
    await waitFor(`!!document.querySelector('[data-settings-item="language"] [data-lang]')`, `${width}px settings after 更多`, 10_000)
    const state = await settingsState()
    const visible = width >= 640 ? state.drawer === 'open' : state.sidePaneVisible === true
    check(`${width}px: 更多 → 外观与语言 opens the panel on 设置`, visible && state.tab === '设置' && state.hasLanguage && state.hasTheme, state)
    await tap(`document.querySelectorAll('[data-settings-item="appearance"] [role=radio]')[2]`)
    const dark = await waitFor(`document.documentElement.classList.contains('dark')`, `${width}px dark from settings`).then(() => true).catch(() => false)
    await sleep(300)
    await tap(`document.querySelectorAll('[data-settings-item="appearance"] [role=radio]')[0]`)
    await waitFor(`!document.documentElement.classList.contains('dark')`, `${width}px light from settings`)
    check(`${width}px: the moved appearance control works in the opened panel`, dark)
    if (width >= 640) {
      await escape()
      await waitFor(`!document.querySelector('[data-side-drawer]')`, `${width}px drawer closed`).catch(() => {})
    } else {
      await click(`document.querySelector('[data-pane-tab="editor"]')`)
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n=== signed-in 768 / 640 top bar ===')
  await setPrefs({ lang: 'zh' })
  for (const width of [768, 640]) {
    await setWidth(width, 900)
    await setMode('wechat')
    const label = await evaluate(`document.querySelector('[data-save-draft-quick]')?.textContent?.trim() || ''`)
    check(`${width}px signed in: the quick save is visible and says 存草稿`, label === '存草稿', label)
    await shot(`${width}-topbar-signed-in.png`)
  }

  // -------------------------------------------------------------------------
  console.log('\n=== card templates live in the 我的 group ===')
  await setWidth(1280, 900)
  await setMode('cards')

  const exampleZip = path.join(TEMPLATE_TMP, 'example.reedcard')
  const secondZip = path.join(TEMPLATE_TMP, 'example-second.reedcard')
  await new Promise((resolve, reject) => {
    const packed = spawn(process.execPath, ['scripts/cards/pack-template.mjs', path.resolve('examples/card-templates/example'), exampleZip], { stdio: 'ignore' })
    packed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('pack failed: ' + code))))
  })
  const original = await JSZip.loadAsync(fs.readFileSync(exampleZip))
  const manifest = JSON.parse(await original.file('manifest.json').async('string'))
  manifest.id = 'example-second'
  manifest.renderId = 'example-second'
  manifest.name = '示例 · 第二份'
  original.file('manifest.json', JSON.stringify(manifest, null, 2))
  fs.writeFileSync(secondZip, await original.generateAsync({ type: 'nodebuffer' }))

  const uploadFiles = async (files) => {
    const { root } = await call('DOM.getDocument', { depth: -1 })
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-card-template-file]' })
    if (!nodeId) throw new Error('template file input missing')
    await call('DOM.setFileInputFiles', { nodeId, files })
  }
  const selectTemplate = async (name) => {
    await evaluate(`[...document.querySelectorAll('[data-card-template-custom]')]
      .find((el) => (el.textContent || '').includes(${JSON.stringify(name)}))?.click()`)
    await cardsReady()
  }

  await uploadFiles([exampleZip, secondZip])
  await waitFor(`document.querySelectorAll('[data-card-template-item]').length === 2`, 'two templates uploaded', 45_000)
  await waitFor(`document.querySelector('[data-card-template-sync]')?.dataset.cardTemplateSync === 'synced'`, 'templates synced', 45_000).catch(() => {})
  await selectTemplate('示例 · 日光')
  check('1280px: the selected uploaded template renders', await evaluate(`[...document.querySelectorAll('[data-card-template-custom][aria-pressed="true"]')].some((el) => (el.textContent || '').includes('示例 · 日光'))`))
  check('only the 我的 group lists the uploaded templates',
    (await evaluate(`document.querySelectorAll('[data-card-templates]').length`)) === 1 &&
    (await evaluate(`[...document.querySelectorAll('[data-card-template-item]')].every((el) => !!el.closest('[data-card-template-group="mine"]'))`)))
  check('there is no second My templates heading below the picker',
    await evaluate(`[...document.querySelectorAll('[data-card-settings] *')].filter((el) => el.children.length === 0 && el.textContent.trim() === '我的模板').length === 0`))
  check('the 我的 group header offers 上传 and 管理',
    await evaluate(`!!document.querySelector('[data-card-template-group="mine"] [data-card-template-upload]') && !!document.querySelector('[data-card-template-group="mine"] [data-card-template-manage]')`))
  await shot('1280-cards-normal.png')

  await click(`document.querySelector('[data-card-template-manage]')`)
  await waitFor(`document.querySelector('[data-card-template-manage]')?.getAttribute('aria-pressed') === 'true'`, 'manage state')
  check('manage state shows 完成 and one 删除 per own template',
    (await evaluate(`document.querySelector('[data-card-template-manage]')?.textContent?.trim()`)) === '完成' &&
    (await evaluate(`document.querySelectorAll('[data-card-template-delete]').length`)) === 2)
  const selectedBeforeManageClick = await evaluate(`document.querySelector('[data-card-template-custom][aria-pressed="true"]')?.textContent || ''`)
  await evaluate(`[...document.querySelectorAll('[data-card-template-custom]')]
    .find((el) => (el.textContent || '').includes('示例 · 第二份'))?.click()`)
  await sleep(400)
  const selectedAfterManageClick = await evaluate(`document.querySelector('[data-card-template-custom][aria-pressed="true"]')?.textContent || ''`)
  check('manage state: clicking a template does not switch the selection',
    selectedBeforeManageClick === selectedAfterManageClick && selectedBeforeManageClick.includes('示例 · 日光'),
    { selectedBeforeManageClick, selectedAfterManageClick })
  await shot('1280-cards-manage.png')

  await evaluate(`window.confirm = () => true`)
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-card-template-item]')]
      .find((el) => (el.textContent || '').includes('示例 · 日光'));
    row?.querySelector('[data-card-template-delete]')?.click();
    return true;
  })()`)
  await waitFor(`document.querySelectorAll('[data-card-template-item]').length === 1`, 'one template removed', 45_000)
  const fallback = await evaluate(`({
    defaultSelected: document.querySelector('[data-card-template="reed"]')?.getAttribute('aria-pressed') === 'true',
    customSelected: [...document.querySelectorAll('[data-card-template-custom][aria-pressed="true"]')].length,
  })`)
  check('deleting the selected template falls back to the default template', fallback.defaultSelected && fallback.customSelected === 0, fallback)

  await click(`document.querySelector('[data-card-template-delete]')`)
  await waitFor(`document.querySelectorAll('[data-card-template-item]').length === 0`, 'last template removed', 45_000)
  check('empty 我的 group keeps its heading, empty hint and 上传 button',
    (await evaluate(`!!document.querySelector('[data-card-template-group="mine"] [data-card-template-upload]')`)) &&
    (await evaluate(`(document.querySelector('[data-card-template-group="mine"]')?.textContent || '').includes('还没有上传的模板')`)) &&
    (await evaluate(`document.querySelector('[data-card-template-manage]')?.disabled === true`)))
  await shot('1280-cards-empty.png')

  const badFile = path.join(TEMPLATE_TMP, 'bad.reedcard')
  fs.writeFileSync(badFile, 'this is not a card template archive')
  await uploadFiles([badFile])
  await waitFor(`!!document.querySelector('[data-card-template-error]')`, 'bad template error', 30_000)
  check('a bad upload reports its error inside the 我的 group',
    await evaluate(`!!document.querySelector('[data-card-template-group="mine"] [data-card-template-error]')`))
  await shot('1280-cards-error.png')

  // -------------------------------------------------------------------------
  console.log('\n=== 1280 English screenshots ===')
  await setPrefs({ lang: 'en' })
  await setWidth(1280, 900)
  await setMode('wechat')
  await evaluate('document.fonts.ready.then(() => true)')
  await shot('1280-en-wechat.png')
  await setMode('cards')
  await evaluate('document.fonts.ready.then(() => true)')
  await shot('1280-en-cards.png')
  const enBar = await measureTopbar()
  check('1280px English: the top bar and sidebar labels still fit',
    enBar.headerOverflow <= 0 && enBar.clipped.length === 0 &&
    (await evaluate(`(() => { const l = document.querySelector('[data-onboarding="sidebar"] [role=tablist]'); return !!l && l.scrollWidth <= l.clientWidth })()`)), enBar)

  await setWidth(390, 844)
  await click(`document.querySelector('[data-pane-tab="editor"]')`)
  await setMode('wechat')
  await evaluate('document.fonts.ready.then(() => true)')
  await shot('390-en-wechat.png')
  await setPrefs({ lang: 'zh', theme: 'akari' })

  check('no uncaught page exceptions', exceptions.length === 0, exceptions.length)
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3))
} catch (error) {
  check('script completed without throwing', false, error.stack || error.message)
} finally {
  if (ws) { try { ws.close() } catch { /* already closed */ } }
  if (chrome) chrome.kill()
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* Chrome holds it */ }
  try { fs.rmSync(TEMPLATE_TMP, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
function writePairIndex() {
  const pairs = [
    ['390-wechat.png', '390×844 · 公众号模式'],
    ['390-cards.png', '390×844 · 卡片模式'],
    ['390-mode-picker.png', '390×844 · 模式下拉展开（改前是模式行）'],
    ['360-wechat.png', '360×740 · 公众号模式'],
    ['360-cards.png', '360×740 · 卡片模式'],
    ['1280-more.png', '1280 · 「更多」菜单'],
    ['1280-settings-light.png', '1280 · 右栏「设置」浅色'],
    ['1280-settings-dark.png', '1280 · 右栏「设置」深色'],
    ['768-topbar-signed-in.png', '768 · 已登录顶栏'],
    ['640-topbar-signed-in.png', '640 · 已登录顶栏'],
    ['1280-cards-normal.png', '1280 卡片 · 普通状态（改前含下方独立「我的模板」）'],
    ['1280-cards-manage.png', '1280 卡片 · 管理状态（改前无此状态，图为同列对照）'],
    ['1280-cards-empty.png', '1280 卡片 · 没有「我的」模板'],
    ['1280-cards-error.png', '1280 卡片 · 上传坏文件的报错'],
    ['1280-en-wechat.png', '1280 · English · 公众号'],
    ['1280-en-cards.png', '1280 · English · 卡片'],
  ]
  const figure = (dir, name, label) => {
    const file = path.join(PAIR_ROOT, dir, name)
    if (!fs.existsSync(file)) return `<figure class="missing"><div>（缺图）</div><figcaption>${label}</figcaption></figure>`
    return `<figure><img src="${dir}/${name}" alt="${label}"><figcaption>${label}</figcaption></figure>`
  }
  const sections = pairs.map(([name, label]) => `<section>
    <h2>${label}</h2>
    <div class="pair">
      ${figure('before', name, '改前')}
      ${figure('after', name, '改后')}
    </div>
  </section>`).join('\n')
  const html = `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<title>芦苇 · 界面小毛病 改前 / 改后</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #f4f1ea; color: #2b2a26; font: 14px/1.5 "Noto Sans SC", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p.lead { margin: 0 0 28px; color: #6b675d; }
  section { margin: 0 0 36px; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; align-items: start; }
  figure { margin: 0; background: #fff; border: 1px solid #ddd6c8; border-radius: 10px; overflow: hidden; }
  figure.missing div { display: flex; align-items: center; justify-content: center; min-height: 180px; color: #9a9487; }
  img { display: block; width: 100%; height: auto; }
  figcaption { padding: 8px 12px; font-size: 12px; color: #6b675d; border-top: 1px solid #eee7da; }
</style>
<h1>芦苇 · 编辑器界面的四处小毛病</h1>
<p class="lead">左：改前；右：改后。文件名一一对应。手机稿件名允许截断；顶栏按钮不允许被裁切。截图目录 before/ 与 after/，本页与截图都在 verify-out 下，不进 git。</p>
${sections}
</html>`
  fs.writeFileSync(path.join(PAIR_ROOT, 'index.html'), html)
}
writePairIndex()

const failed = checks.filter((item) => !item.passed)
const summary = {
  task: 'Editor UI nits: phone mode pill, appearance in settings, quick-save label, merged template group',
  checks,
  exceptions: exceptions.length,
  consoleErrors,
  output: OUTPUT,
  result: failed.length === 0 ? 'PASS' : 'FAIL',
  failed: failed.map((item) => item.name),
}
fs.writeFileSync(path.join(OUTPUT, 'ui-nits.json'), JSON.stringify(summary, null, 2))
console.log(`\n${summary.result} · ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) {
  console.log(`Failed: ${failed.map((item) => item.name).join('; ')}`)
  process.exitCode = 1
}