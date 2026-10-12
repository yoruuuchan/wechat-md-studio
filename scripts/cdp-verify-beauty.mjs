// Visual verification of the yoru-and-akari restyle: screenshots of every
// surface plus hard checks that the design tokens and fonts are actually in
// effect (not merely referenced in CSS).
//
// Usage: node scripts/cdp-verify-beauty.mjs [appUrl] [outDir]

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3200'
const OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-beauty-'))
fs.mkdirSync(OUT, { recursive: true })
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const ACCESS_KEY = envText.match(/^ACCESS_KEY=(.+)$/m)?.[1].trim()

const PORT = 9333
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-b-'))
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

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`  screenshot: ${file}`)
}

// Login so every page is reachable.
await send('Page.navigate', { url: APP }, sessionId)
await sleep(3500)
await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`)
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)

console.log('\n=== editor surface ===')
await shot('01-editor')

console.log('\n=== tokens are in effect, not just referenced ===')
const tokenChecks = await evaluate(`(() => {
  const out = {}
  const header = document.querySelector('header')
  out.headerGlass = header && getComputedStyle(header).backdropFilter.includes('blur')
  const root = getComputedStyle(document.documentElement)
  out.primaryToken = root.getPropertyValue('--primary-500').trim()
  out.pageWash = getComputedStyle(document.querySelector('.ya-page') || document.body).backgroundImage.includes('radial-gradient')
  const primaryBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('复制到公众号'))
  out.primaryBtnBg = primaryBtn ? getComputedStyle(primaryBtn).backgroundColor : null
  out.primaryBtnShadow = primaryBtn ? getComputedStyle(primaryBtn).boxShadow.slice(0, 60) : null
  const cm = document.querySelector('.cm-content')
  out.editorBg = cm ? getComputedStyle(cm.closest('.cm-editor')).backgroundColor : null
  return out
})()`)
console.log(' ', JSON.stringify(tokenChecks, null, 1))
check('top bar is glass (backdrop blur)', tokenChecks.headerGlass === true)
check('primary token is the console blue', tokenChecks.primaryToken === '#4F6CE8', tokenChecks.primaryToken)
check('page wash radial gradients render', tokenChecks.pageWash === true)
check('primary button uses console blue', tokenChecks.primaryBtnBg === 'rgb(79, 108, 232)', tokenChecks.primaryBtnBg)
check('editor well is yoru midnight', tokenChecks.editorBg === 'rgb(11, 16, 32)', tokenChecks.editorBg)

console.log('\n=== fonts really load and apply ===')
const fontChecks = await evaluate(`(async () => {
  await document.fonts.ready
  const geistFaces = [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Geist')
  const geistMonoFaces = [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Geist Mono')
  const eyebrow = document.querySelector('header .ya-eyebrow')
  const latinProbe = eyebrow ? getComputedStyle(eyebrow).fontFamily : ''
  const sync = [...document.querySelectorAll('header span')].find(s => /读取中|已保存|保存中|仅本机|未保存/.test(s.textContent) && s.title)
  const syncFont = sync ? getComputedStyle(sync).fontFamily : ''
  // measure a latin glyph against a forced fallback: if Geist is really used,
  // the advance width differs from the same text in a generic sans.
  function widthOf(fontFamily, text) {
    const c = document.createElement('canvas').getContext('2d')
    c.font = '15px ' + fontFamily
    return c.measureText(text).width
  }
  const text = 'wechat md studio'
  const geistLoaded = geistFaces.some(f => f.status === 'loaded') || (await document.fonts.load('15px Geist', text).then(r => r.length > 0).catch(() => false))
  const wGeist = widthOf('Geist', text)
  const wFallback = widthOf('Arial', text)
  return { geistFaces: geistFaces.length, geistMonoFaces: geistMonoFaces.length, latinProbe, syncFont, geistLoaded, wGeist, wFallback }
})()`)
console.log(' ', JSON.stringify(fontChecks, null, 1))
check('Geist @font-face registered and loaded', fontChecks.geistFaces > 0 && fontChecks.geistLoaded === true, `faces=${fontChecks.geistFaces}`)
check('Geist Mono registered', fontChecks.geistMonoFaces > 0, `faces=${fontChecks.geistMonoFaces}`)
check('latin UI text resolves to Geist stack', fontChecks.latinProbe.includes('Geist'), fontChecks.latinProbe.slice(0, 60))
check('sync indicator uses the mono stack', fontChecks.syncFont.includes('Geist Mono'), fontChecks.syncFont.slice(0, 60))
check('Geist actually shapes latin text (width differs from Arial)', Math.abs(fontChecks.wGeist - fontChecks.wFallback) > 0.3, `geist=${fontChecks.wGeist.toFixed(1)} arial=${fontChecks.wFallback.toFixed(1)}`)

console.log('\n=== selected states use the 1.5px primary stroke ===')
const sel = await evaluate(`(() => {
  const seg = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '375')
  if (!seg) return 'no-375'
  const cs = getComputedStyle(seg)
  return { shadow: cs.boxShadow, }
})()`)
check('375/677 selected segment carries primary stroke', typeof sel === 'object' && sel.shadow.includes('79, 108, 232'), JSON.stringify(sel).slice(0, 90))

console.log('\n=== other pages ===')
await send('Page.navigate', { url: APP + '/login' }, sessionId)
await sleep(2500)
await shot('02-login')
const loginCheck = await evaluate(`(() => {
  const input = document.querySelector('input')
  return input ? getComputedStyle(input).boxShadow.includes('inset') : false
})()`)
check('login input is sunken (inset shadow)', loginCheck === true)

await send('Page.navigate', { url: APP + '/drafts' }, sessionId)
await sleep(3000)
await shot('03-drafts')

await send('Page.navigate', { url: APP + '/materials' }, sessionId)
await sleep(3000)
await shot('04-materials')

console.log('\n=== editor again: theme popover + ratio dialog ===')
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)
await evaluate(`(() => {
  const b = [...document.querySelectorAll('header button')].find(x => x.textContent.includes('霜降') || x.textContent.includes('极简') || x.textContent.includes('沉稳') || /主题/.test(x.textContent))
  if (b) b.click()
})()`)
await sleep(800)
await shot('05-theme-popover')
await evaluate(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)

console.log('\n=== page errors ===')
check('no uncaught exceptions in the page', pageErrors.length === 0, pageErrors.join(' | '))

ws.close()
chrome.kill()

const failed = results.filter((r) => !r.ok)
console.log(`\nscreenshots in: ${OUT}`)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
