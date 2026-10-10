// Browser acceptance for the bilingual interface and the in-site feedback form.
//
// Covers two features end to end:
//   * 中文 is the default; switching to English re-renders the shell, updates
//     <html lang> and the document title, survives a reload, and the English
//     layouts do not overflow horizontally on the pages a visitor can reach;
//   * the /feedback form validates client-side, reports server failures and
//     success accurately, and a valid submission reaches the mail service with
//     the expected payload — while the honeypot path sends nothing.
//
// Usage: node scripts/cdp-verify-i18n.mjs [appUrl] [cdpPort] [mailPort]
//   appUrl defaults to http://127.0.0.1:3202/; the app must be running with the
//   feedback relay pointed at this script's mock mail service, e.g.:
//
//   RESEND_API_KEY=re_test RESEND_FROM=reed@example.com FEEDBACK_TO=owner@example.com \
//   RESEND_API_URL=http://127.0.0.1:9580/emails NODE_ENV=production node dist/boot.js
//
//   Never run this against the deployed site: it posts feedback submissions.
//   No login required.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:3202/'
const PORT = Number(process.argv[3] || 9360)
const MAIL_PORT = Number(process.argv[4] || 9580)
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-i18n-'))

// ---------- the mock mail service the app relays to ----------
const received = []
const mail = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    try {
      received.push({ url: req.url, auth: req.headers.authorization || '', body: JSON.parse(body) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"id":"mock"}')
    } catch {
      res.writeHead(400)
      res.end('{"error":"bad json"}')
    }
  })
})
await new Promise((resolve) => mail.listen(MAIL_PORT, '127.0.0.1', resolve))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-i18n-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'],
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)

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
  await sleep(4000)
  await evaluate(`document.fonts.ready.then(()=>true)`)
  await sleep(600)
}
async function clickEl(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  })()`)
  if (!ok) throw new Error(`no element ${selector}`)
  await sleep(600)
}
// React-controlled fields need the native setter plus a bubbling input event.
const FILL = `(selector, value) => {
  const el = document.querySelector(selector)
  if (!el) return false
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}`

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- 中文 is the default ----------
await goto(APP)
const zh = JSON.parse(
  await evaluate(`JSON.stringify({
    lang: document.documentElement.lang,
    title: document.title,
    brand: document.querySelector('header span.text-ink-1')?.textContent?.trim(),
    copyBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('复制到公众号')),
    hasToggle: !!document.querySelector('[data-lang="zh"]') && !!document.querySelector('[data-lang="en"]'),
    stored: localStorage.getItem('mopai.lang.v1'),
  })`),
)
check('中文 is the default on a fresh profile', zh.lang === 'zh-CN' && zh.brand === '芦苇', JSON.stringify(zh))
check('the title is the Chinese one', zh.title.includes('芦苇'), zh.title)
check('the editor renders Chinese copy', zh.copyBtn === true)
check('the language toggle is present', zh.hasToggle === true)
check('nothing is stored before the first explicit choice', zh.stored === null, String(zh.stored))

// ---------- switch to English ----------
await clickEl('[data-lang="en"]')
await sleep(800)
const en = JSON.parse(
  await evaluate(`JSON.stringify({
    lang: document.documentElement.lang,
    title: document.title,
    brand: document.querySelector('header span.text-ink-1')?.textContent?.trim(),
    copyBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('Copy to WeChat')),
    stored: localStorage.getItem('mopai.lang.v1'),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    headerOverflow: (() => { const h = document.querySelector('header'); return h ? h.scrollWidth - h.clientWidth : -1 })(),
  })`),
)
check('English re-renders the shell', en.brand === 'Reed' && en.copyBtn === true, JSON.stringify(en))
check('<html lang> and the title follow', en.lang === 'en' && en.title.includes('Reed'), en.title)
check('the choice is persisted', en.stored === 'en', String(en.stored))
check('the editor does not overflow in English', en.overflowX <= 0 && en.headerOverflow <= 0, `doc=${en.overflowX} header=${en.headerOverflow}`)
await shot('editor-en')

// ---------- reload keeps English ----------
await goto(APP)
const reloaded = await evaluate(`document.documentElement.lang + '|' + (document.querySelector('header span.text-ink-1')?.textContent || '')`)
check('a reload keeps English', reloaded === 'en|Reed', reloaded)

// ---------- English layouts on public pages ----------
for (const route of ['/themes', '/terms', '/references', '/feedback']) {
  await goto(APP.replace(/\/$/, '') + route)
  const layout = JSON.parse(
    await evaluate(`JSON.stringify({
      lang: document.documentElement.lang,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      textLen: document.body.innerText.length,
    })`),
  )
  check(`${route} renders in English without overflow`, layout.lang === 'en' && layout.overflowX <= 0 && layout.textLen > 200, JSON.stringify(layout))
}
await goto(APP.replace(/\/$/, '') + '/themes')
await shot('themes-en')

// ---------- narrow screens in English ----------
// The 390px pass: nothing a visitor can reach may scroll sideways, in either
// language. (中文 was the state before the switch; English labels are the
// longer ones, so this is the worst case.)
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId)
for (const route of ['/', '/themes', '/drafts', '/materials', '/terms', '/references', '/feedback']) {
  await goto(APP.replace(/\/$/, '') + route)
  const narrow = JSON.parse(
    await evaluate(`JSON.stringify({
      lang: document.documentElement.lang,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    })`),
  )
  check(`${route} fits 390px in English`, narrow.lang === 'en' && narrow.overflowX <= 0, `overflowX=${narrow.overflowX}`)
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)

// ---------- feedback form ----------
await goto(APP.replace(/\/$/, '') + '/feedback')
// Preflight: a short message must be refused with invalid_message (a 400),
// which proves the route is wired; a 503 here means the app is running without
// the relay environment this script documents at the top.
const preflight = await evaluate(`fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x' }) }).then(r => r.status)`)
check('the feedback endpoint is reachable', preflight === 400, `status=${preflight}${preflight === 503 ? ' (relay not configured on the app)' : ''}`)
const form0 = JSON.parse(
  await evaluate(`JSON.stringify({
    hasForm: !!document.querySelector('[data-feedback-form]'),
    mailtos: document.querySelectorAll('a[href^="mailto:"]').length,
    label: document.querySelector('label[for="feedback-message"]')?.textContent?.trim(),
  })`),
)
check('the feedback form renders in English', form0.hasForm === true && form0.mailtos === 0, JSON.stringify(form0))
check('the form labels are English', String(form0.label || '').includes('feedback'), String(form0.label))

// A too-short message is refused client-side and never reaches the server.
await evaluate(`(${FILL})('#feedback-message', 'hi')`)
await clickEl('[data-feedback-submit]')
await sleep(500)
const shortState = JSON.parse(
  await evaluate(`JSON.stringify({
    error: document.querySelector('[data-feedback-error]')?.textContent?.trim() || '',
    success: !!document.querySelector('[data-feedback-state="success"]'),
    mails: ${JSON.stringify(received.length)},
  })`),
)
check('a too-short message shows an inline error', shortState.error.length > 0 && shortState.success === false, JSON.stringify(shortState))
check('nothing was sent for the invalid submission', received.length === 0, `mails=${received.length}`)

// Honeypot: a filled trap answers okay but sends nothing.
await evaluate(`(${FILL})('#feedback-message', 'This should never reach the mail service.')`)
await evaluate(`(${FILL})('input[name="_trap"]', 'bot')`)
await clickEl('[data-feedback-submit]')
await sleep(1200)
const trapState = JSON.parse(
  await evaluate(`JSON.stringify({
    success: !!document.querySelector('[data-feedback-state="success"]'),
    mails: ${JSON.stringify(received.length)},
  })`),
)
check('the honeypot path claims success but sends nothing', trapState.success === true && received.length === 0, JSON.stringify(trapState))

// A valid submission relays end to end and only then shows success.
await goto(APP.replace(/\/$/, '') + '/feedback')
await evaluate(`(${FILL})('#feedback-message', 'The English interface is a great addition. Keep it up!')`)
await evaluate(`(${FILL})('#feedback-contact', 'reader@example.com')`)
await clickEl('[data-feedback-submit]')
let successSeen = false
for (let i = 0; i < 20; i++) {
  successSeen = await evaluate(`!!document.querySelector('[data-feedback-state="success"]')`)
  if (successSeen && received.length) break
  await sleep(400)
}
check('a valid submission shows success', successSeen === true)
check('the mail service received exactly one message', received.length === 1, `mails=${received.length}`)
if (received.length === 1) {
  const mail1 = received[0]
  const text = String(mail1.body.text || '')
  check('the relay presented a Bearer credential', /^Bearer \S+/.test(mail1.auth), `${mail1.auth.slice(0, 10)}…`)
  check('the mail carries from / to / subject', Boolean(mail1.body.from) && Boolean(mail1.body.to) && String(mail1.body.subject).includes('反馈'), JSON.stringify({ from: mail1.body.from, to: mail1.body.to }))
  check('the message and language are in the body', text.includes('English interface') && text.includes('Language: English'), text.slice(0, 80))
  check('reply_to is the optional contact', mail1.body.reply_to === 'reader@example.com', String(mail1.body.reply_to))
}
await shot('feedback-success')

// ---------- switching back to 中文 ----------
await goto(APP)
await clickEl('[data-lang="zh"]')
await sleep(600)
const backZh = await evaluate(`document.documentElement.lang + '|' + localStorage.getItem('mopai.lang.v1')`)
check('switching back restores 中文 and persists it', backZh === 'zh-CN|zh', backZh)

check('no page errors along the way', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

console.log(`\n  ${pass} passed, ${fail} failed`)
console.log(`  screenshots: ${OUT}`)
chrome.kill()
mail.close()
process.exit(fail ? 1 : 0)
