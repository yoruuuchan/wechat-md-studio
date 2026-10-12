// Browser acceptance for the first-run onboarding tour (driver.js).
//
// Usage: node scripts/cdp-verify-onboarding.mjs [appUrl] [cdpPort]
//   appUrl defaults to http://127.0.0.1:3100 — any running app, dev or production mode.
//   No login required: the tour and the editor are anonymous surfaces.
//
// A fresh Chrome profile is a first-time visitor, so the tour auto-starts.
// Covers: the five anchored steps and their progress text, finishing and
// skipping both persist to localStorage, the settings entry replays the tour,
// English copy, dark-theme readability (measured contrast), the narrow-screen
// opt-out, and an editor->preview smoke check with the tour out of the way.
// Screenshots (akari, yoru, English, narrow) are kept for visual review.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/$/, '')
const PORT = Number(process.argv[3] || 9356)
const ONBOARDING_KEY = 'mopai.onboarding.v1'
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-onboarding-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-o-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--no-proxy-server', '--proxy-bypass-list=<-loopback>', 'about:blank'],
  { stdio: 'ignore' },
)

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP never came up')
}

let msgId = 1
function makeClient(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = msgId++
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(i)) { pending.delete(i); reject(new Error('timeout: ' + method)) }
      }, 45000)
    })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = makeClient(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
const setViewport = (width, height, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile }, sessionId)

const pageErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || 'unknown')
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(2200)
  await evaluate(`document.fonts.ready.then(()=>true)`)
}

/** Poll an evaluating expression until it returns truthy or time runs out. */
async function waitFor(expression, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await evaluate(expression)) return true
    await sleep(200)
  }
  return false
}

// Radix and driver buttons both want a real pointer; element.click() would
// skip pointerdown/up sequences some handlers rely on.
async function clickAt(selector) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return ''
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return ''
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`)
  if (!box) throw new Error(`no clickable element for ${selector}`)
  const { x, y } = JSON.parse(box)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 }, sessionId)
  }
  await sleep(850)
}

// Radix triggers (the sidebar tabs) move selection on real pointer events, so
// find the element by its text and click it like a person would.
async function clickLabel(label, selector) {
  const box = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(label)})
    if (!el) return ''
    const r = el.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`)
  if (!box) throw new Error(`no element labelled ${label}`)
  const { x, y } = JSON.parse(box)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 }, sessionId)
  }
  await sleep(850)
}

const setFlag = (value) =>
  evaluate(`(() => { ${value === null ? `localStorage.removeItem(${JSON.stringify(ONBOARDING_KEY)})` : `localStorage.setItem(${JSON.stringify(ONBOARDING_KEY)}, ${JSON.stringify(value)})`}; return true })()`)

const tour = () =>
  evaluate(`(() => {
    const p = document.querySelector('.driver-popover')
    if (!p) return JSON.stringify({ open: false })
    const active = document.querySelector('.driver-active-element')
    return JSON.stringify({
      open: true,
      reedClass: p.classList.contains('reed-tour'),
      title: p.querySelector('.driver-popover-title')?.textContent.trim() || '',
      description: p.querySelector('.driver-popover-description')?.textContent.trim() || '',
      progress: p.querySelector('.driver-popover-progress-text')?.textContent.trim() || '',
      next: p.querySelector('.driver-popover-next-btn')?.textContent.trim() || '',
      nextIsDone: p.querySelector('.driver-popover-next-btn')?.classList.contains('driver-popover-done-btn') || false,
      prevDisabled: p.querySelector('.driver-popover-prev-btn')?.classList.contains('driver-popover-btn-disabled') || false,
      skip: p.querySelector('.reed-tour-skip')?.textContent.trim() || '',
      closeLabel: p.querySelector('.driver-popover-close-btn')?.getAttribute('aria-label') || '',
      activeAnchor: active?.getAttribute('data-onboarding') || (active?.hasAttribute('data-theme-switcher') ? 'theme' : ''),
      overlay: !!document.querySelector('.driver-overlay'),
      bodyActive: document.body.classList.contains('driver-active'),
    })
  })()`)

const readTour = async () => JSON.parse(await tour())

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// WCAG relative-luminance contrast, as in cdp-verify-dark-theme.mjs.
const contrast = (textExpr, bgSelector) =>
  evaluate(`(() => {
    const luminance = (rgb) => {
      const [r, g, b] = rgb.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number)
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    const ratio = (a, b) => {
      const la = luminance(a), lb = luminance(b)
      return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100
    }
    const el = ${textExpr}
    const bgEl = document.querySelector(${JSON.stringify(bgSelector)})
    return ratio(getComputedStyle(el).color, getComputedStyle(bgEl).backgroundColor)
  })()`)

const contrastSet = () =>
  evaluate(`(() => {
    const luminance = (rgb) => {
      const [r, g, b] = rgb.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number)
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    const ratio = (a, b) => {
      const la = luminance(a), lb = luminance(b)
      return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100
    }
    // Buttons paint their own background; text nodes inherit the popover's.
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor
        if (bg && !bg.includes('0, 0, 0, 0') && !bg.endsWith(', 0)')) return bg
      }
      return 'rgb(255, 255, 255)'
    }
    const pop = document.querySelector('.driver-popover')
    const read = (sel) => {
      const el = pop.querySelector(sel)
      if (!el) return null
      const bg = bgOf(el)
      return { color: getComputedStyle(el).color, bg, contrast: ratio(getComputedStyle(el).color, bg) }
    }
    return JSON.stringify({
      bg: getComputedStyle(pop).backgroundColor,
      title: read('.driver-popover-title'),
      description: read('.driver-popover-description'),
      progress: read('.driver-popover-progress-text'),
      next: read('.driver-popover-next-btn'),
      skip: read('.reed-tour-skip'),
      theme: document.documentElement.dataset.theme,
    })
  })()`)

// ---------------------------------------------------------------------------
console.log('=== a first-time visitor gets the tour automatically (akari) ===')
await setViewport(1440, 900)
await goto(APP + '/')
await evaluate(`localStorage.setItem('mopai.theme.v1', 'akari'); true`)
await setFlag(null)
await goto(APP + '/')
await waitFor(`!!document.querySelector('.driver-popover')`, 9000)
let t1 = await readTour()
check('the tour opens by itself on a fresh browser', t1.open === true)
check('the popover wears the Reed styling hook', t1.reedClass === true)
check('step 1 is the Markdown editor', t1.activeAnchor === 'editor' && t1.title === 'Markdown 编辑区', `${t1.activeAnchor} / ${t1.title}`)
check('progress reads 1 of 5', t1.progress === '第 1 步 · 共 5 步', t1.progress)
check('buttons: prev (disabled), next, skip, close', t1.prevDisabled === true && t1.next === '下一步' && t1.skip === '跳过' && t1.closeLabel === '关闭引导', JSON.stringify(t1))
check('the overlay is up and the body is marked active', t1.overlay === true && t1.bodyActive === true)
const akariContrast = JSON.parse(await contrastSet())
for (const [part, v] of Object.entries({ title: akariContrast.title, description: akariContrast.description, progress: akariContrast.progress, next: akariContrast.next, skip: akariContrast.skip })) {
  check(`akari: ${part} text is readable`, v && v.contrast >= 3, v ? `contrast=${v.contrast} ${v.color} on ${v.bg}` : 'missing')
}
const shot1 = await shot('onboarding-step1-akari')

console.log('\n=== next / previous walk the five anchors ===')
const expected = [
  { anchor: 'preview', title: '实时预览', progress: '第 2 步 · 共 5 步' },
  { anchor: 'theme', title: '主题切换', progress: '第 3 步 · 共 5 步' },
  { anchor: 'sidebar', title: '右侧侧栏', progress: '第 4 步 · 共 5 步' },
  { anchor: 'copy', title: '复制到公众号', progress: '第 5 步 · 共 5 步' },
]
let sidebarStepShot = ''
for (const e of expected) {
  await clickAt('.driver-popover-next-btn')
  const step = await readTour()
  check(`${e.anchor}: highlighted, titled, progress counted`, step.activeAnchor === e.anchor && step.title === e.title && step.progress === e.progress, `${step.activeAnchor} / ${step.title} / ${step.progress}`)
  if (e.anchor === 'sidebar') sidebarStepShot = await shot('onboarding-step4-sidebar')
}
const last = await readTour()
check('the last step turns Next into Done', last.next === '完成' && last.nextIsDone === true, `${last.next} doneClass=${last.nextIsDone}`)
check('the copy button was highlighted, never clicked', (await evaluate(`document.querySelector('[data-onboarding="copy"]').textContent.trim()`)) === '复制到公众号')
await clickAt('.driver-popover-prev-btn')
const back = await readTour()
check('Previous goes back one step', back.activeAnchor === 'sidebar' && back.progress === '第 4 步 · 共 5 步', `${back.activeAnchor} / ${back.progress}`)
await clickAt('.driver-popover-next-btn')

console.log('\n=== finishing sticks ===')
await clickAt('.driver-popover-next-btn') // the Done button on the last step
check('Done closes the tour', (await readTour()).open === false)
check('the seen flag is written', (await evaluate(`localStorage.getItem(${JSON.stringify(ONBOARDING_KEY)})`)) === 'done')
check('overlay and scroll lock are gone', (await evaluate(`!!document.querySelector('.driver-overlay') || document.body.classList.contains('driver-active')`)) === false)
await goto(APP + '/')
await sleep(1800)
check('a reload no longer auto-starts the tour', (await readTour()).open === false)

console.log('\n=== the settings entry replays it ===')
await clickLabel('设置', '[role=tab]')
const settingsOpen = await waitFor(`!!document.querySelector('[data-tour-restart]')`, 3000)
check('the settings tab carries the restart entry', settingsOpen === true)
await clickAt('[data-tour-restart]')
await waitFor(`!!document.querySelector('.driver-popover')`, 5000)
const replay = await readTour()
check('restart opens the tour again at step 1', replay.open === true && replay.activeAnchor === 'editor', replay.progress)
check('the restart entry sits in the panel the tour points at', (await evaluate(`!!document.querySelector('[data-onboarding="sidebar"] [data-tour-restart]')`)) === true)

console.log('\n=== skipping sticks ===')
await clickAt('.reed-tour-skip')
check('Skip closes the tour', (await readTour()).open === false)
await setFlag(null)
await goto(APP + '/')
await waitFor(`!!document.querySelector('.driver-popover')`, 9000)
check('a cleared flag brings the tour back on reload', (await readTour()).open === true)
await clickAt('.reed-tour-skip')
check('skipping writes the seen flag too', (await evaluate(`localStorage.getItem(${JSON.stringify(ONBOARDING_KEY)})`)) === 'done')
await goto(APP + '/')
await sleep(1800)
check('after a skip the tour stays away on reload', (await readTour()).open === false)
// Escape is the keyboard dismissal; it must count as a skip as well.
await setFlag(null)
await goto(APP + '/')
await waitFor(`!!document.querySelector('.driver-popover')`, 9000)
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await sleep(700)
check('Escape dismisses the tour', (await readTour()).open === false)
check('Escape writes the seen flag too', (await evaluate(`localStorage.getItem(${JSON.stringify(ONBOARDING_KEY)})`)) === 'done')

console.log('\n=== English copy ===')
await evaluate(`localStorage.setItem('mopai.lang.v1', 'en'); true`)
await setFlag(null)
await goto(APP + '/')
await waitFor(`!!document.querySelector('.driver-popover')`, 9000)
const en = await readTour()
check('English title and progress', en.title === 'Markdown editor' && en.progress === 'Step 1 of 5', `${en.title} / ${en.progress}`)
check('English buttons', en.next === 'Next' && en.skip === 'Skip' && en.prevDisabled === true, JSON.stringify(en))
check('English description carries no Chinese', !/[\u3400-\u9fff]/.test(en.description), en.description)
const shotEn = await shot('onboarding-en')
// The X is the third way out; it must count as a dismissal too.
await clickAt('.driver-popover-close-btn')
check('closing with X also writes the seen flag', (await evaluate(`localStorage.getItem(${JSON.stringify(ONBOARDING_KEY)})`)) === 'done')
await evaluate(`localStorage.setItem('mopai.lang.v1', 'zh'); true`)

console.log('\n=== yoru (dark) readability ===')
await evaluate(`localStorage.setItem('mopai.theme.v1', 'yoru'); true`)
await setFlag(null)
await goto(APP + '/')
await waitFor(`!!document.querySelector('.driver-popover')`, 9000)
const dark = JSON.parse(await contrastSet())
check('the tour paints over the yoru theme', dark.theme === 'yoru')
for (const [part, v] of Object.entries({ title: dark.title, description: dark.description, progress: dark.progress, next: dark.next, skip: dark.skip })) {
  check(`yoru: ${part} text is readable`, v && v.contrast >= 3, v ? `contrast=${v.contrast} ${v.color} on ${v.bg}` : 'missing')
}
check('the dark popover surface is not the light one', dark.bg !== akariContrast.bg, `${akariContrast.bg} → ${dark.bg}`)
const shotYoru = await shot('onboarding-yoru')
await clickAt('.reed-tour-skip')
await evaluate(`localStorage.setItem('mopai.theme.v1', 'akari'); true`)

console.log('\n=== narrow screens never auto-start ===')
await setViewport(480, 800)
await setFlag(null)
await goto(APP + '/')
await sleep(2600)
check('no tour below 768px even on a fresh browser', (await readTour()).open === false)
const shotNarrow = await shot('onboarding-narrow')

console.log('\n=== the editor still works with the tour out of the way ===')
await setViewport(1440, 900)
await goto(APP + '/')
await sleep(1800)
const typed = await evaluate(`(async () => {
  const view = window.__mopaiCodemirror
  if (!view) return JSON.stringify({ ok: false, reason: 'no editor view' })
  view.focus()
  const before = view.state.doc.toString()
  view.dispatch({ changes: { from: 0, to: 0, insert: '# 引导冒烟检查\\n\\n' }, selection: { anchor: 2 } })
  await new Promise((r) => setTimeout(r, 900))
  return JSON.stringify({ ok: true, changed: view.state.doc.toString() !== before })
})()`)
const smoke = JSON.parse(typed)
check('typing into CodeMirror still updates the document', smoke.ok === true && smoke.changed === true, typed)
await sleep(600)
const previewHas = await evaluate(`(() => {
  const paper = document.querySelector('[data-onboarding="preview"]')
  return paper ? paper.innerText.includes('引导冒烟检查') : false
})()`)
check('the preview still renders the edit in real time', previewHas === true)

check('no page errors along the way', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

console.log(`\n  ${pass} passed, ${fail} failed`)
console.log(`  screenshots: ${shot1}\n               ${sidebarStepShot}\n               ${shotEn}\n               ${shotYoru}\n               ${shotNarrow}`)
chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
