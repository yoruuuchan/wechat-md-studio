// U05 font acceptance: removing the unused Zen Kaku slices must not drop a
// font the UI or a theme actually uses.
//
// Usage: node scripts/cdp-verify-u05-fonts.mjs <appUrl> [cdpPort]
//
// Checks the UI stack (Geist + Noto Sans SC) and the serif stack used by 73
// imported themes (Noto Serif SC), both by loading state and by computed style.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = (process.argv[2] || 'http://127.0.0.1:4130').replace(/\/$/, '')
const PORT = Number(process.argv[3] || 9741)

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-u05-fonts-'))
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
function check(name, ok, detail = '') {
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

const evaluate = async (expression) => {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(150)
  }
  return Boolean(await evaluate(expression))
}

async function navigate(url) {
  await send('Page.navigate', { url }, sessionId)
}

console.log('\n=== editor UI fonts ===')
await navigate(`${APP}/`)
await waitFor(`Boolean(document.querySelector('[data-onboarding="editor"] .cm-editor'))`)
await evaluate(`document.fonts.ready.then(() => true)`)
const uiFont = await evaluate(`getComputedStyle(document.body).fontFamily`)
check('UI text uses the Geist stack', /Geist/.test(uiFont), uiFont)
check('Geist is actually available to the browser', await evaluate(`document.fonts.check('16px "Geist"', '芦苇')`))
check('Noto Sans SC is actually available', await evaluate(`document.fonts.check('16px "Noto Sans SC"', '芦苇')`))
check(
  'computed UI font resolves to Geist/Noto Sans in the document',
  /Geist|Noto Sans SC/.test(await evaluate(`getComputedStyle(document.body).fontFamily`)),
)

console.log('\n=== theme serif font ===')
await navigate(`${APP}/themes`)
await waitFor(`document.querySelectorAll('[data-theme-card]').length === 219`)
// 用 inkpress-crimson：它的 h1/h2/h3 明确写 'Noto Serif SC'。
const serifCard = 'inkpress-crimson'
await evaluate(`document.querySelector('[data-theme-card="${serifCard}"]')?.scrollIntoView({ block: 'center' })`)
const rendered = await waitFor(`(() => {
  const card = document.querySelector('[data-theme-card="${serifCard}"]')
  return card?.querySelector('[data-theme-preview="rendered"] section') != null
})()`, 20000)
check('an imported serif theme preview renders', rendered, serifCard)
const serifFont = await evaluate(`(() => {
  const card = document.querySelector('[data-theme-card="${serifCard}"]')
  const root = card?.querySelector('[data-theme-preview="rendered"] section')
  const heading = root?.querySelector('h1, h2, h3')
  return heading ? getComputedStyle(heading).fontFamily : ''
})()`)
check('the preview carries the Noto Serif SC stack', /Noto Serif SC/i.test(serifFont), serifFont)
check('Noto Serif SC is actually available', await evaluate(`document.fonts.check('700 16px "Noto Serif SC"', '文字')`))
check(
  'the removed Zen Kaku family has no @font-face rule left',
  (await evaluate(`(() => {
    let count = 0
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE && /Zen Kaku/i.test(rule.style.fontFamily)) count += 1
      }
    }
    return count
  })()`)) === 0,
)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
if (failures > 0) process.exitCode = 1

chrome.kill()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // Chrome may still hold the profile; the temp directory is disposable.
}