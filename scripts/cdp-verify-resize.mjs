// Real-browser verification for the resizable three-column layout:
//   1. both separators drag and resize their neighbours
//   2. panel min sizes hold (preview cannot be crushed below 380px)
//   3. the layout survives a reload (localStorage persistence)
//   4. the sidebar still collapses and reopens cleanly
//
// Usage: node scripts/cdp-verify-resize.mjs [appUrl]

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// This host exports a global HTTP proxy that would swallow 127.0.0.1.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3200'
const PORT = 9333
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

await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)

console.log('\n=== initial layout ===')
const w0 = await panelWidths()
console.log('  panel widths:', JSON.stringify(w0))
check('three panels are mounted', Array.isArray(w0) && w0.length === 3, JSON.stringify(w0))
check('two drag handles exist', (await handleCenters()).length === 2)

console.log('\n=== drag the editor/preview handle 100px to the right ===')
await drag(0, 100)
const w1 = await panelWidths()
console.log('  widths after:', JSON.stringify(w1))
check('editor grew by ~100px', Math.abs(w1[0] - (w0[0] + 100)) <= 12, `${w0[0]} -> ${w1[0]}`)
check('preview shrank by ~100px', Math.abs(w1[1] - (w0[1] - 100)) <= 12, `${w0[1]} -> ${w1[1]}`)

console.log('\n=== drag the preview/sidebar handle 60px to the left ===')
await drag(1, -60)
const w2 = await panelWidths()
console.log('  widths after:', JSON.stringify(w2))
check('sidebar grew by ~60px', Math.abs(w2[2] - (w1[2] + 60)) <= 12, `${w1[2]} -> ${w2[2]}`)

console.log('\n=== drag the preview far past its maximum, then past its minimum ===')
// Handle 0 sits between editor and preview: left shrinks the editor (preview
// grows), right grows it (preview shrinks).
await drag(0, -2000)
const wMax = await panelWidths()
console.log('  after dragging far left:', JSON.stringify(wMax))
check('preview is clamped at its 820px maximum', wMax[1] >= 810 && wMax[1] <= 822, `preview=${wMax[1]}`)
check('editor is clamped at its 320px minimum', wMax[0] >= 318 && wMax[0] <= 340, `editor=${wMax[0]}`)
await drag(0, 2000)
const w3 = await panelWidths()
console.log('  after dragging far right:', JSON.stringify(w3))
check('preview is clamped at its 380px minimum', w3[1] >= 378 && w3[1] <= 400, `preview=${w3[1]}`)

console.log('\n=== layout persists across a reload ===')
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)
const w4 = await panelWidths()
console.log('  widths after reload:', JSON.stringify(w4))
check('panel widths are restored from storage', JSON.stringify(w4) === JSON.stringify(w3), `${w3} vs ${w4}`)

console.log('\n=== sidebar collapses and reopens ===')
// The collapse toggle lives in the TopBar; find it by its title.
const toggled = await evaluate(`(() => {
  const b = [...document.querySelectorAll('header button')].find(x => /侧栏|面板|panel/i.test(x.title || ''))
  if (!b) return 'not-found:' + [...document.querySelectorAll('header button')].map(x => x.title).join(',')
  b.click()
  return 'clicked'
})()`)
console.log('  toggle:', toggled)
await sleep(500)
const wClosed = await panelWidths()
check('sidebar panel unmounts when closed', wClosed.length === 2, JSON.stringify(wClosed))
await evaluate(`(() => {
  const b = [...document.querySelectorAll('header button')].find(x => /侧栏|面板|panel/i.test(x.title || ''))
  if (b) b.click()
})()`)
await sleep(500)
const wReopened = await panelWidths()
check('sidebar comes back at a usable width', wReopened.length === 3 && wReopened[2] >= 240, JSON.stringify(wReopened))

console.log('\n=== page errors ===')
check('no uncaught exceptions in the page', pageErrors.length === 0, pageErrors.join(' | '))

ws.close()
chrome.kill()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
