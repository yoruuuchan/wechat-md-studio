// Rebrand + template gallery + sunken-restyle verification.
// Drives the real built app in headless Chrome via CDP. Usage:
//   node scripts/cdp-verify-rebrand.mjs http://127.0.0.1:3200 <shots-dir>

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete process.env[k]

const APP = process.argv[2] || 'http://127.0.0.1:3200'
const SHOTS = process.argv[3] || ''
const PORT = 9333
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-rb-'))
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const KEY = envText.match(/^ACCESS_KEY=(.+)$/m)[1].trim()

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1600,900',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl } catch {}
    await sleep(250)
  }
  throw new Error('CDP not reachable')
}

let id = 1
const pend = new Map()
const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const i = id++
  pend.set(i, { resolve, reject })
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)) } }, 30000)
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
const shot = async (name) => {
  if (!SHOTS) return
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'))
  console.log('  [shot]', name)
}
const goto = async (url, wait = 3000) => { await send('Page.navigate', { url }, sessionId); await sleep(wait) }

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  ${detail}`) }
}

try {
  // Login so every page is reachable
  await goto(APP, 3500)
  await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(KEY)}}})}).then(r=>r.text())`)

  // ==== 1. brand on the editor top bar =====================================
  console.log('\n=== brand: editor top bar ===')
  await goto(APP, 4000)
  const brand = await evaluate(`(() => {
    const header = document.querySelector('header')
    const mark = header.querySelector('[role=img][aria-label=Yoru]')
    const cs = mark ? getComputedStyle(mark) : null
    return {
      title: document.title,
      text: header.textContent,
      hasMark: !!mark,
      markBg: cs ? cs.backgroundColor : '',
      markText: mark ? mark.textContent : '',
      favicon: document.querySelector('link[rel=icon]')?.href || '',
    }
  })()`)
  check('document title is the new name', brand.title.includes('芦苇'), brand.title)
  check('top bar shows 芦苇', brand.text.includes('芦苇'))
  check('top bar shows by Yoru', brand.text.includes('by Yoru'))
  check('Yoru seal mark renders with brand indigo', brand.hasMark && brand.markBg === 'rgb(46, 74, 104)', brand.markBg)
  check('seal shows 夜', brand.markText === '夜')
  check('favicon.svg is linked', brand.favicon.endsWith('/favicon.svg'), brand.favicon)

  // ==== 2. template gallery ================================================
  console.log('\n=== template gallery /themes ===')
  // entry point exists inside the theme popover (radix Popover opens on plain click)
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('header button')].find(x => x.querySelector('span.rounded-full'))
    b.click()
  })()`)
  await sleep(700)
  const entry = await evaluate(`(() => {
    const b = [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].find(x => x.textContent.includes('查看全部模板'))
    if (!b) return null
    b.click()
    return 'clicked'
  })()`)
  check('「查看全部模板」entry exists in theme popover', entry === 'clicked')
  await sleep(1500)
  const onThemes = await evaluate(`location.pathname`)
  check('navigated to /themes', onThemes === '/themes', onThemes)
  await sleep(1500)
  const gallery = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('main .ya-well')]
    return {
      count: cards.length,
      names: cards.map(c => c.textContent.slice(0, 24)),
      // each card must contain real rendered article html (heading from the sample)
      rendered: cards.filter(c => c.querySelector('section') && c.innerHTML.includes('章节标题示例')).length,
      activeCount: cards.filter(c => c.textContent.includes('使用中')).length,
    }
  })()`)
  check('three template cards render', gallery.count === 3, `got ${gallery.count}`)
  check('every card shows a REAL rendered preview', gallery.rendered === 3, `rendered=${gallery.rendered}`)
  check('exactly one card marked 使用中 (default golden)', gallery.activeCount === 1, `active=${gallery.activeCount}`)
  await shot('06-themes.png')

  // pick a different template (the second card that is not active)
  const picked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('main button')].filter(b => b.textContent.trim() === '使用此模板')
    if (!btns.length) return null
    btns[0].click()
    return btns.length
  })()`)
  check('clicked 使用此模板 on an inactive card', picked >= 2, String(picked))
  await sleep(2500)
  const backHome = await evaluate(`location.pathname`)
  check('returned to the editor after picking', backHome === '/', backHome)
  const stored = await evaluate(`JSON.parse(localStorage.getItem('mopai.settings.v1')).themeId`)
  check('chosen theme persisted to settings', typeof stored === 'string' && stored !== 'golden', stored)
  // switch back to golden so later runs start from the default
  await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('mopai.settings.v1')); s.themeId = 'golden'; localStorage.setItem('mopai.settings.v1', JSON.stringify(s)) })()`)

  // ==== 3. sunken restyle ====================================================
  console.log('\n=== sunken neumorphism ===')
  await goto(APP, 3500)
  const previewWell = await evaluate(`(() => {
    // the preview pane scroll area is the sunken well
    const wells = [...document.querySelectorAll('div')].filter(d => {
      const cs = getComputedStyle(d)
      return cs.overflowY === 'auto' && cs.boxShadow.includes('inset') && cs.backgroundColor === 'rgb(222, 227, 236)'
    })
    return wells.length
  })()`)
  check('preview area is a sunken well (bg-sunken + inset shadow)', previewWell >= 1, `wells=${previewWell}`)
  await goto(APP + '/drafts', 3000)
  const draftCard = await evaluate(`(() => {
    const el = document.querySelector('main .ya-well')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, shadow: cs.boxShadow }
  })()`)
  check('drafts cards are sunken wells', !!draftCard && draftCard.bg === 'rgb(222, 227, 236)' && draftCard.shadow.includes('inset'), JSON.stringify(draftCard).slice(0, 120))
  await shot('07-drafts-sunken.png')

  // ==== 4. login page brand =================================================
  console.log('\n=== login page ===')
  await goto(APP + '/login', 3000)
  const login = await evaluate(`(() => {
    const mark = document.querySelector('[role=img][aria-label=Yoru]')
    return { text: document.body.textContent, hasMark: !!mark, markSize: mark ? mark.getBoundingClientRect().width : 0 }
  })()`)
  check('login shows 芦苇', login.text.includes('芦苇'))
  check('login shows by Yoru', login.text.includes('by Yoru'))
  check('login seal is the large variant', login.hasMark && login.markSize >= 50, `size=${login.markSize}`)
  await shot('08-login.png')

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`)
  process.exitCode = fail ? 1 : 0
} finally {
  chrome.kill()
}
