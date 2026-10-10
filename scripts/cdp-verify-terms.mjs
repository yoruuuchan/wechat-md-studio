// Browser acceptance for the /terms page and the two sidebar entry points.
//
// Usage: node scripts/cdp-verify-terms.mjs [appUrl] [cdpPort]
//   appUrl defaults to http://127.0.0.1:3201 — any running app, dev or production mode.
//   No login required: /terms and the sidebar notices are anonymous surfaces.
//
// It asserts the page renders in both UI themes, keeps its numbers coming from
// the same sources the app uses (THEMES registry), and that both links to /terms
// exist — one per sidebar tab, since Radix only mounts the active panel.
// The contact address is scrape-protected: it must stay out of the DOM until a
// visitor asks for it, so the checks walk the 显示邮箱 reveal on /terms and the
// contact block in the settings tab.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:3201'
const PORT = Number(process.argv[3] || 9349)
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-terms-'))
// Assembled, not written whole — the same rule the app follows.
const ADDRESS = ['yoruandakari', 'duck.com'].join('@')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-t-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'],
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId)

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
  await sleep(4500)
  await evaluate(`document.fonts.ready.then(()=>true)`)
  await sleep(700)
}
async function setTheme(name) {
  await evaluate(`localStorage.setItem('mopai.theme.v1', ${JSON.stringify(name)}); 'ok'`)
}
// Radix tabs move selection on a real pointer event; element.click() does not.
async function clickAt(label) {
  const box = await evaluate(`(() => {
    const el = [...document.querySelectorAll('[role=tab], button')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
    if (!el) return ''
    const r = el.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`)
  if (!box) throw new Error(`no element labelled ${label}`)
  const { x, y } = JSON.parse(box)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 }, sessionId)
  }
  await sleep(900)
}
const termsLinks = async () =>
  JSON.parse(
    await evaluate(`JSON.stringify([...document.querySelectorAll('a[href="/terms"]')].map(a => a.textContent.trim()))`),
  )

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- the page itself ----------
await goto(APP + '/')
await setTheme('akari')
await goto(APP + '/terms')
const page = JSON.parse(
  await evaluate(`(() => {
    const t = document.body.innerText
    return JSON.stringify({
      path: location.pathname,
      headings: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()),
      theme: document.documentElement.dataset.theme,
      pageBg: getComputedStyle(document.querySelector('.ya-page')).backgroundColor,
      email: [...document.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute('href')),
      plainEmail: t.includes(${JSON.stringify(ADDRESS)}),
      themeCount: (t.match(/(\\d+)\\s*套主题/) || [])[1],
      mentionsIndexedDB: t.includes('IndexedDB'),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      textLen: t.length,
    })
  })()`,
  ),
)
check('/terms renders as a page, not a blank route', page.path === '/terms' && page.textLen > 1200, `textLen=${page.textLen}`)
check('every section is present', page.headings.length >= 6, page.headings.join(' / '))
check('the contact address stays hidden until asked', page.email.length === 0 && page.plainEmail === false, `mailtos=${page.email.join(',')} plain=${page.plainEmail}`)
check('theme count comes from the THEMES registry', Number(page.themeCount) > 200, `count=${page.themeCount}`)
check('the page states where drafts actually live', page.mentionsIndexedDB === true)
check('no horizontal overflow', page.overflowX <= 0, `overflowX=${page.overflowX}`)
const akariShot = await shot('terms-akari')

// Revealing is the only path by which the address enters the DOM; a scraper
// that merely renders the page never sees it.
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '显示邮箱')
  if (b) b.scrollIntoView({ block: 'center' })
  return !!b
})()`)
await sleep(600)
await clickAt('显示邮箱')
const revealed = JSON.parse(
  await evaluate(`JSON.stringify({
    mailto: [...document.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute('href')),
    plainEmail: document.body.innerText.includes(${JSON.stringify(ADDRESS)}),
  })`),
)
check(
  'clicking 显示邮箱 reveals the duck.com relay',
  revealed.mailto.length === 1 && revealed.mailto[0] === 'mailto:' + ADDRESS && revealed.plainEmail === true,
  revealed.mailto.join(','),
)

await setTheme('yoru')
await goto(APP + '/terms')
const dark = JSON.parse(
  await evaluate(`JSON.stringify({
    theme: document.documentElement.dataset.theme,
    pageBg: getComputedStyle(document.querySelector('.ya-page')).backgroundColor,
  })`),
)
check(
  'yoru theme repaints through the Console tokens',
  dark.theme === 'yoru' && dark.pageBg !== page.pageBg,
  `${page.pageBg} → ${dark.pageBg}`,
)
const yoruShot = await shot('terms-yoru')

// ---------- entry points ----------
await setTheme('akari')
await goto(APP + '/')
const inMaterials = await termsLinks()
check(
  'the 图片 tab warns about public reads and links to /terms',
  inMaterials.length === 1 && inMaterials[0].includes('使用规范'),
  JSON.stringify(inMaterials),
)

await clickAt('设置')
const inSettings = await termsLinks()
check(
  'the 设置 tab carries the takedown entry',
  (await evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()`)) === '设置' &&
    inSettings.some((t) => t.includes('投诉删除')),
  JSON.stringify(inSettings),
)

const settingsContact = JSON.parse(
  await evaluate(`JSON.stringify({
    plainEmail: document.body.innerText.includes(${JSON.stringify(ADDRESS)}),
    hasCopy: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '复制邮箱'),
    hasReveal: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '显示邮箱'),
    ghLinks: [...document.querySelectorAll('[role=tabpanel] a[href^="https://github.com/"]')].map(a => a.getAttribute('href')),
  })`),
)
check(
  '设置 tab adds the contact block with the address still hidden',
  settingsContact.plainEmail === false && settingsContact.hasCopy && settingsContact.hasReveal,
  JSON.stringify(settingsContact),
)
check(
  '设置 tab links the repo for a star',
  settingsContact.ghLinks.includes('https://github.com/yoruuuchan/wechat-md-studio'),
  JSON.stringify(settingsContact.ghLinks),
)
check(
  '设置 tab links the GitHub issues page',
  settingsContact.ghLinks.some((href) => href.endsWith('/issues')),
  JSON.stringify(settingsContact.ghLinks),
)

await evaluate(`(() => { const a = [...document.querySelectorAll('a[href="/terms"]')].pop(); if (a) a.click(); return !!a })()`)
await sleep(2500)
check('an entry point navigates to /terms', (await evaluate('location.pathname')) === '/terms', await evaluate('location.pathname'))

await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('回到编辑器')); if (b) b.click(); return !!b })()`)
await sleep(2000)
check('「回到编辑器」returns to the editor', (await evaluate('location.pathname')) === '/', await evaluate('location.pathname'))

check('no page errors along the way', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

console.log(`\n  ${pass} passed, ${fail} failed`)
console.log(`  screenshots: ${akariShot}\n               ${yoruShot}`)
chrome.kill()
process.exit(fail ? 1 : 0)
