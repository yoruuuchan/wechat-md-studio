// U06 acceptance: trial the current article and compare up to three candidates.
//
// Usage: node scripts/cdp-verify-theme-trial.mjs <appUrl> [cdpPort]
//
// Seeds a local legacy article (title, table, image, carousel, formula) before
// the app boots, then drives the real production build:
//   - the trial preview must be byte-identical to the editor preview;
//   - selecting 1–3 candidates must not change the body or the saved theme;
//   - apply must persist the theme, and returning to the library must restore
//     the filters and scroll position;
//   - an unreadable local body must fall back to the sample with a reason;
//   - English and 390px layouts must stay usable.
//
// It does not claim to cover a cloud-stub body read (needs a logged-in cloud
// article) or a full offline first navigation.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = (process.argv[2] || 'http://127.0.0.1:4131').replace(/\/$/, '')
const PORT = Number(process.argv[3] || 9733)
const SHOTS = 'node_modules/.tmp/u06-shots'
fs.mkdirSync(SHOTS, { recursive: true })

const DOC = `## TRIAL | 当前文章试排

这是一篇用来验证**同一渲染结果**的当前稿：标题、表格、单图、轮播和公式都要出现在试排里。

### 小标题：长标题与层级

| 项目 | 值 | 说明 |
|:---|:---:|---:|
| 标题 | 换主题后是否还合身 | 表格列宽 |
| 图片 | 单图与轮播 | 比例 |

![单图占位：当前文章里的图]()

:::carousel 4:3 轮播：同一比例
![轮播一]()
![轮播二]()
:::

$$
E = mc^2
$$

@signature
`

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-u06-cdp-'))
const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const json = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting.
    }
    await sleep(250)
  }
  throw new Error('no CDP endpoint')
}

let msgId = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = msgId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout ${method}`))
        }
      }, 60000)
    })
}

const ws = new WebSocket(await wsUrl())
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)

const consoleErrors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(message.params?.exceptionDetails?.text ?? 'exception'))
  }
})

const evaluate = async (expression) => {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description ?? ''))
  }
  return result.result.value
}

async function waitFor(expression, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(150)
  }
  return Boolean(await evaluate(expression))
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'))
}

const EDITOR_READY =
  `Boolean(document.querySelector('[data-onboarding="editor"] .cm-editor') && (document.querySelector('[data-onboarding="preview"] section')?.textContent?.length ?? 0) > 100)`
const editorHtml = () => evaluate(`document.querySelector('[data-onboarding="preview"] section')?.innerHTML ?? ''`)
const trialHtml = (id) =>
  evaluate(`document.querySelector('[data-theme-trial="${id}"] section')?.innerHTML ?? ''`)
const readBody = (id) =>
  evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('mopai', 2)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('bodies', 'readonly')
      const get = tx.objectStore('bodies').get(${JSON.stringify(id)})
      get.onsuccess = () => resolve(get.result ? get.result.content : null)
      get.onerror = () => reject(get.error)
    }
  })`)
const themeId = () => evaluate(`JSON.parse(localStorage.getItem('mopai.settings.v1') || '{}').themeId ?? ''`)
const closeDialog = () =>
  evaluate(`(() => {
    const dialog = document.querySelector('[data-slot="dialog-content"]')
    if (!dialog) return true
    const btn = [...dialog.querySelectorAll('button')].find(b => /取消|Cancel/.test(b.textContent || ''))
    btn?.click()
    return Boolean(btn)
  })()`)

// Seed local storage before the app module executes, so the migration creates the
// article without any editor typing. The script is removed after the first load.
const seed = await send(
  'Page.addScriptToEvaluateOnNewDocument',
  {
    source: `(() => {
      const docs = [{
        id: 'u06-trial',
        name: 'U06 当前文章',
        content: ${JSON.stringify(DOC)},
        updatedAt: Date.now(),
        savedAt: null,
        deletedAt: null,
        contentLoaded: true,
      }]
      localStorage.setItem('mopai.docs.v1', JSON.stringify(docs))
      localStorage.setItem('mopai.active.v1', 'u06-trial')
      localStorage.setItem('mopai.sample.v1', '1')
      localStorage.setItem('mopai.settings.v1', JSON.stringify({
        themeId: 'golden',
        sig: { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' },
        syncScroll: true,
        zoom: 100,
        uploadSize: 'auto',
      }))
    })()`,
  },
  sessionId,
)

await send('Page.navigate', { url: `${APP}/` }, sessionId)
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier }, sessionId)
const seeded = await waitFor(EDITOR_READY, 20000)
check('editor opens the seeded current article', seeded, await evaluate(`document.body.innerText.slice(0, 80)`))
const formulaReady = await waitFor(
  `document.querySelector('[data-onboarding="preview"] section')?.innerHTML.includes('<svg') ?? false`,
  30000,
)
check('editor formula is rendered before comparison', formulaReady)
const beforeHtml = await editorHtml()
const beforeBody = await readBody('u06-trial')
check('seeded body is readable', typeof beforeBody === 'string' && beforeBody.includes('E = mc^2'), String(beforeBody?.length))
await shot('01-editor.png')

// ------------------------------------------------------------ trial current
console.log('\n=== current-article trial ===')
await send('Page.navigate', { url: `${APP}/themes` }, sessionId)
await waitFor(`document.querySelectorAll('[data-theme-card]').length === 219`)
await evaluate(`document.querySelector('[data-trial-current]')?.click()`)
const dialogOpen = await waitFor(`document.querySelector('[data-slot="dialog-content"]') != null`)
check('“try current article” opens the comparison dialog', dialogOpen)
const trialRendered = await waitFor(`document.querySelector('[data-theme-trial="golden"]')?.getAttribute('data-theme-trial-state') === 'rendered'`, 20000)
check('current-theme trial preview renders', trialRendered)
const trialFormula = await waitFor(
  `document.querySelector('[data-theme-trial="golden"] section')?.innerHTML.includes('<svg') ?? false`,
  30000,
)
check('trial formula renders through the same MathJax snapshot', trialFormula)
const afterHtml = await trialHtml('golden')
check(
  'trial HTML is byte-identical to the editor preview',
  afterHtml === beforeHtml,
  `editor=${beforeHtml.length} trial=${afterHtml.length}`,
)
if (afterHtml !== beforeHtml) {
  let first = 0
  while (first < Math.min(beforeHtml.length, afterHtml.length) && beforeHtml[first] === afterHtml[first]) first += 1
  console.log('  first diff at', first, JSON.stringify(beforeHtml.slice(first, first + 120)), JSON.stringify(afterHtml.slice(first, first + 120)))
}
check('current article name is shown', await evaluate(`document.querySelector('[data-slot="dialog-content"]')?.innerText.includes('U06 当前文章')`))
check('trial did not change the saved theme', (await themeId()) === 'golden')
check('trial did not change the body', (await readBody('u06-trial')) === beforeBody)
await shot('02-trial-current.png')
await closeDialog()
check('cancel closes the dialog', await waitFor(`document.querySelector('[data-slot="dialog-content"]') == null`))
check('cancel did not change the body', (await readBody('u06-trial')) === beforeBody)

// ------------------------------------------------------------ compare 3
console.log('\n=== compare three candidates ===')
const pick = async (id) => {
  await evaluate(`document.querySelector('[data-theme-card="${id}"]')?.scrollIntoView({ block: 'center' })`)
  await sleep(300)
  return evaluate(`(() => {
    const btn = document.querySelector('[data-theme-compare="${id}"]')
    if (!btn || btn.disabled) return false
    btn.click()
    return true
  })()`)
}
check('first extra candidate joins the comparison', await pick('xiaohu-dark-ocean'))
check('second extra candidate joins the comparison', await pick('raphael-mint'))
check('comparison tray appears', await waitFor(`document.querySelector('[data-compare-tray]') != null`))
check('three candidates are selected', (await evaluate(`document.querySelectorAll('[data-compare-chip]').length`)) === 3)
const fourthDisabled = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('[data-theme-compare]')].find(b => !b.getAttribute('aria-pressed') || b.getAttribute('aria-pressed') === 'false')
  return Boolean(btn?.disabled)
})()`)
check('a fourth candidate is disabled at the limit', fourthDisabled)
check('selection did not change the saved theme', (await themeId()) === 'golden')
check('selection did not change the body', (await readBody('u06-trial')) === beforeBody)

await evaluate(`document.querySelector('[data-compare-open]')?.click()`)
const panels = await waitFor(`document.querySelectorAll('[data-compare-panel]').length === 3`)
check('dialog shows three candidate panels', panels)
check('each candidate preview renders', await waitFor(`document.querySelectorAll('[data-compare-panel] [data-theme-trial-state="rendered"]').length === 3`, 30000))
check(
  'only the three candidates render the current article',
  (await evaluate(`document.querySelectorAll('[data-theme-trial]').length`)) === 3,
)
check(
  'the grid keeps sample previews (no current long article for 219 cards)',
  (await evaluate(`document.querySelectorAll('[data-theme-preview]').length`)) === 219,
)
await shot('03-compare-three.png')
await closeDialog()
check('closing the comparison leaves the body untouched', (await readBody('u06-trial')) === beforeBody)

// ------------------------------------------------------------ filters / scroll / apply
console.log('\n=== apply, persist theme, restore filters/scroll ===')
await evaluate(`(() => {
  const input = document.querySelector('input[placeholder]')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '蓝')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
const filtered = await waitFor(`document.querySelectorAll('[data-theme-card]').length < 219`, 5000)
check('search narrows the library before apply', filtered, `${await evaluate(`document.querySelectorAll('[data-theme-card]').length`)} cards`)
await evaluate(`window.scrollTo(0, 900)`)
await sleep(400)
const savedScroll = await evaluate(`Math.round(window.scrollY)`)
check('library is scrolled before apply', savedScroll > 300, `${savedScroll}px`)

await evaluate(`document.querySelector('[data-compare-open]')?.click()`)
await waitFor(`document.querySelectorAll('[data-compare-panel]').length === 3`)
await evaluate(`document.querySelector('[data-compare-apply="raphael-mint"]')?.click()`)
const applied = await waitFor(`location.pathname === '/' && Boolean(document.querySelector('[data-onboarding="preview"] section'))`, 20000)
check('apply returns to the editor', applied)
check('apply persists the chosen theme', (await themeId()) === 'raphael-mint')
check('apply does not change the body', (await readBody('u06-trial')) === beforeBody)

// SPA back to the library (not a full reload), so the in-memory state survives.
await evaluate(`(() => {
  window.history.pushState({}, '', '/themes')
  window.dispatchEvent(new PopStateEvent('popstate'))
  return true
})()`)
const returned = await waitFor(`document.querySelectorAll('[data-theme-card]').length < 219 && document.querySelectorAll('[data-theme-card]').length > 0`, 20000)
check('returning restores the filtered result set', returned)
check(
  'returning restores the search text',
  (await evaluate(`document.querySelector('input[placeholder]')?.value ?? ''`)) === '蓝',
)
await sleep(800)
const restoredScroll = await evaluate(`Math.round(window.scrollY)`)
check('returning restores the scroll position', Math.abs(restoredScroll - savedScroll) < 30, `${savedScroll} → ${restoredScroll}`)
await shot('04-restored-library.png')

// A full reload is a new document: filters may start clean, but the body and the
// applied theme must survive it.
await send('Page.reload', {}, sessionId)
await waitFor(`document.querySelectorAll('[data-theme-card]').length === 219`, 20000)
check('a reload keeps the applied theme', (await themeId()) === 'raphael-mint')
check('a reload keeps the body intact', (await readBody('u06-trial')) === beforeBody)

// ------------------------------------------------------------ unreadable body
console.log('\n=== unreadable current article ===')
await evaluate(`(() => {
  localStorage.setItem('mopai.index.v2', JSON.stringify({
    docs: [{
      id: 'u06-missing', name: '缺失稿', updatedAt: Date.now(), savedAt: null,
      deletedAt: null, baseHash: null, contentLoaded: false, bodyState: 'missing',
    }],
    removed: [],
  }))
  localStorage.setItem('mopai.active.v1', 'u06-missing')
  localStorage.setItem('mopai.migrated.v2', '1')
  localStorage.removeItem('mopai.docs.v1')
  return true
})()`)
await send('Page.navigate', { url: `${APP}/themes` }, sessionId)
await waitFor(`document.querySelectorAll('[data-theme-card]').length === 219`)
await evaluate(`document.querySelector('[data-trial-current]')?.click()`)
const reasonShown = await waitFor(`document.querySelector('[data-trial-reason="missing"]') != null`, 15000)
check('a missing body shows the accurate reason', reasonShown)
check(
  'an unreadable body falls back to the standard sample',
  await waitFor(
    `document.querySelectorAll('[data-compare-panel] [data-theme-trial-state="rendered"]').length >= 1`,
    20000,
  ),
)
check(
  'the fallback offers the standard sample explicitly',
  await evaluate(`[...document.querySelectorAll('[data-slot="dialog-content"] button')].some(b => /改用标准样稿|Use standard sample/.test(b.textContent || ''))`),
)
await shot('05-missing-body.png')
await closeDialog()

// ------------------------------------------------------------ English + 390px
console.log('\n=== English and 390px ===')
await evaluate(`document.querySelector('[data-lang="en"]')?.click()`)
await waitFor(`document.documentElement.lang === 'en'`)
check('English language toggle worked', (await evaluate(`document.documentElement.lang`)) === 'en')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId)
await sleep(500)
check(
  'the library has no horizontal overflow at 390px',
  (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`)) === true,
  `${await evaluate(`document.documentElement.scrollWidth`)}/${await evaluate(`window.innerWidth`)}`,
)
await evaluate(`document.querySelector('[data-trial-current]')?.click()`)
await waitFor(`document.querySelector('[data-slot="dialog-content"]') != null`)
await sleep(400)
check(
  'the trial dialog is readable in English',
  (await evaluate(`document.querySelector('[data-slot="dialog-content"]')?.innerText ?? ''`)).includes('Compare themes') &&
    (await evaluate(`document.querySelector('[data-slot="dialog-content"]')?.innerText ?? ''`)).includes('Current article'),
)
check(
  'the dialog has no horizontal overflow at 390px',
  (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`)) === true,
  `${await evaluate(`document.documentElement.scrollWidth`)}/${await evaluate(`window.innerWidth`)}`,
)
const mobileControls = await evaluate(`(() => {
    const dialog = document.querySelector('[data-slot="dialog-content"]')
    if (!dialog) return []
    const controls = [...dialog.querySelectorAll('[data-trial-source], [aria-label="Close comparison"]')]
    return controls.map((el) => {
      const r = el.getBoundingClientRect()
      return { text: el.textContent || el.getAttribute('aria-label'), left: r.left, right: r.right, width: r.width }
    })
  })()`)
check(
  'the source switch and close control stay on screen',
  mobileControls.length >= 2 &&
    mobileControls.every((r) => r.left >= -1 && r.right <= 390 + 1 && r.width > 0),
  JSON.stringify(mobileControls),
)
await shot('06-mobile-english.png')

// Three candidates on a phone: horizontal panels, one visible at a time.
await closeDialog()
await pick('xiaohu-dark-ocean')
await pick('inkpress-crimson')
await evaluate(`document.querySelector('[data-compare-open]')?.click()`)
await waitFor(`document.querySelectorAll('[data-compare-panel]').length === 3`, 15000)
check(
  'three candidates are usable on a 390px screen',
  (await evaluate(`document.querySelectorAll('[data-compare-panel]').length`)) === 3 &&
    (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`)) === true,
  `${await evaluate(`document.querySelectorAll('[data-compare-panel]').length`)} panels, width ${await evaluate(`document.documentElement.scrollWidth`)}`,
)
const firstPanel = await evaluate(`(() => {
  const r = document.querySelector('[data-compare-panel]')?.getBoundingClientRect()
  return r ? { left: r.left, right: r.right, width: r.width, viewport: window.innerWidth } : null
})()`)
check(
  'the first candidate panel fits the phone width',
  Boolean(firstPanel) && firstPanel.left >= -1 && firstPanel.right <= firstPanel.viewport + 1,
  JSON.stringify(firstPanel),
)
await shot('07-mobile-compare.png')

const fatal = consoleErrors.filter((line) => /Uncaught|TypeError|ReferenceError/.test(line))
check('no uncaught exception replaced the page', fatal.length === 0, fatal.slice(0, 2).join(' | '))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
if (failures > 0) process.exitCode = 1

chrome.kill()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // Chrome may still hold the profile; the temp directory is disposable.
}