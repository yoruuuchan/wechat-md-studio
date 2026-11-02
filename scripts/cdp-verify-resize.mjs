// Real-browser verification for the resizable editor columns:
//   1. on a wide window both separators drag and resize their neighbours
//   2. every pane still respects its own minimum, and there is no maximum: the
//      preview can pass 820px and the sidebar can pass 520px
//   3. the medium (640–1199) two-column layout uses the lower 240/360 minimums
//      and has no preview cap either
//   4. the layout survives a reload (localStorage persistence)
//   5. the sidebar still collapses and reopens cleanly on a wide window
//
// Usage: node scripts/cdp-verify-resize.mjs [appUrl] [cdpPort]

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// This host exports a global HTTP proxy that would swallow 127.0.0.1.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3261'
const PORT = Number(process.argv[3] || 9396)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-rz-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,900',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        if (pending.has(i)) {
          pending.delete(i)
          reject(new Error('timeout: ' + method))
        }
      }, 30000)
    })
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = makeClient(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
// A fresh profile would meet the first-run tour on the editor; this suite
// drives the app as a returning visitor.
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' }, sessionId)
await send('Runtime.enable', {}, sessionId)

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

const panelWidths = () =>
  evaluate(`[...document.querySelectorAll('[data-slot=resizable-panel]')].map(p => Math.round(p.getBoundingClientRect().width))`)

const panelIds = () =>
  evaluate(`[...document.querySelectorAll('[data-slot=resizable-panel]')].map(p => p.id)`)

const handleCenters = () =>
  evaluate(`[...document.querySelectorAll('[data-slot=resizable-handle]')].map(h => {
    const r = h.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })`)

async function drag(handleIndex, dx) {
  const hs = await handleCenters()
  const h = hs[handleIndex]
  if (!h) throw new Error('no handle #' + handleIndex)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId)
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x + Math.round((dx * i) / steps), y: h.y, button: 'left', buttons: 1 }, sessionId)
    await sleep(30)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x + dx, y: h.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId)
  await sleep(300)
}

// The sidebar collapse control now lives in 更多. Radix opens on pointerdown,
// so this must be a real pointer event rather than el.click().
async function clickSelector(selector) {
  const position = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  })()`)
  if (!position) throw new Error('no visible target: ' + selector)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position }, sessionId)
  await sleep(300)
}

async function toggleSidebar() {
  await clickSelector('[data-topbar-more]')
  for (let i = 0; i < 30 && !(await evaluate(`!!document.querySelector('[data-more-item="panel"]')`)); i++) await sleep(100)
  await clickSelector('[data-more-item="panel"]')
  await sleep(600)
}

async function setWidth(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.navigate', { url: APP }, sessionId)
  await sleep(4000)
}

// --- wide: 1536px, the width this suite must keep three columns at ----------
await setWidth(1536)

console.log('\n=== initial layout ===')
const w0 = await panelWidths()
const ids0 = await panelIds()
console.log('  panel widths:', JSON.stringify(w0), 'ids:', JSON.stringify(ids0))
check('three panels are mounted', Array.isArray(w0) && w0.length === 3, JSON.stringify(w0))
check('the columns are editor / preview / sidebar', JSON.stringify(ids0) === JSON.stringify(['editor', 'preview', 'sidebar']), JSON.stringify(ids0))
check('two drag handles exist', (await handleCenters()).length === 2)

console.log('\n=== drag the editor/preview handle 40px to the right ===')
// Small enough that the preview stays above its 380px minimum, so this checks
// the one-to-one drag rather than the clamp.
await drag(0, 40)
const w1 = await panelWidths()
console.log('  widths after:', JSON.stringify(w1))
check('editor grew by ~40px', Math.abs(w1[0] - (w0[0] + 40)) <= 12, `${w0[0]} -> ${w1[0]}`)
check('preview shrank by ~40px', Math.abs(w1[1] - (w0[1] - 40)) <= 12, `${w0[1]} -> ${w1[1]}`)

console.log('\n=== drag the preview/sidebar handle 60px to the left ===')
await drag(1, -60)
const w2 = await panelWidths()
console.log('  widths after:', JSON.stringify(w2))
check('sidebar grew by ~60px', Math.abs(w2[2] - (w1[2] + 60)) <= 12, `${w1[2]} -> ${w2[2]}`)

console.log('\n=== preview keeps growing past the old 820px cap ===')
// Handle 0 sits between editor and preview: left shrinks the editor (preview
// grows), right grows it (preview shrinks).
await drag(0, -2000)
const wMax = await panelWidths()
console.log('  after dragging far left:', JSON.stringify(wMax))
check('preview is no longer clamped at 820px', wMax[1] > 850, `preview=${wMax[1]}`)
check('editor still stops at its 320px minimum', wMax[0] >= 318 && wMax[0] <= 340, `editor=${wMax[0]}`)

console.log('\n=== sidebar keeps growing past the old 520px cap ===')
// Shrink the editor first, then pull preview to its 380px floor: the rest of
// the 1536px window goes to the sidebar.
await drag(0, 2000)
await drag(1, -2000)
const wSide = await panelWidths()
console.log('  after dragging sidebar far left:', JSON.stringify(wSide))
check('sidebar is no longer clamped at 520px', wSide[2] > 560, `sidebar=${wSide[2]}`)
check('preview still stops at its 380px minimum', wSide[1] >= 378 && wSide[1] <= 400, `preview=${wSide[1]}`)

console.log('\n=== drag the preview back to its minimum ===')
await drag(0, 2000)
const w3 = await panelWidths()
console.log('  widths after:', JSON.stringify(w3))
check('preview can be squeezed to its 380px minimum', w3[1] >= 378 && w3[1] <= 400, `preview=${w3[1]}`)

console.log('\n=== layout persists across a reload ===')
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)
const w4 = await panelWidths()
console.log('  widths after reload:', JSON.stringify(w4))
check('panel widths are restored from storage', JSON.stringify(w4) === JSON.stringify(w3), `${w3} vs ${w4}`)

console.log('\n=== sidebar collapses and reopens ===')
// The collapse toggle lives in 更多; the control keeps its title.
await toggleSidebar()
const wClosed = await panelWidths()
check('sidebar panel unmounts when closed', wClosed.length === 2, JSON.stringify(wClosed))
await toggleSidebar()
const wReopened = await panelWidths()
check('sidebar comes back at a usable width', wReopened.length === 3 && wReopened[2] >= 240, JSON.stringify(wReopened))

// --- medium: 900px, two columns with the lower minimums and no cap ----------
console.log('\n=== medium 900px: two columns, 240/360 minimums ===')
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)
const m0 = await panelWidths()
const mids = await panelIds()
console.log('  panel widths:', JSON.stringify(m0), 'ids:', JSON.stringify(mids))
check('medium layout has editor + preview only', JSON.stringify(mids) === JSON.stringify(['editor', 'preview']), JSON.stringify(mids))
check('one drag handle in the medium layout', (await handleCenters()).length === 1)
check('medium panes start above their 240/360 minimums', m0[0] >= 240 && m0[1] >= 360, JSON.stringify(m0))
check('the drawer button replaces the third column', await evaluate(`!!document.querySelector('[data-open-side-panel]')`))
await drag(0, -2000)
const mLeft = await panelWidths()
check('medium editor stops at its 240px minimum', mLeft[0] >= 238 && mLeft[0] <= 260, `editor=${mLeft[0]}`)
check('medium preview grows past 600px (no 820px cap needed at this width)', mLeft[1] > 600, `preview=${mLeft[1]}`)
await drag(0, 2000)
const mRight = await panelWidths()
check('medium preview stops at its 360px minimum', mRight[1] >= 358 && mRight[1] <= 380, `preview=${mRight[1]}`)

console.log('\n=== page errors ===')
check('no uncaught exceptions in the page', pageErrors.length === 0, pageErrors.join(' | '))

ws.close()
chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may still hold the profile */ }

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)