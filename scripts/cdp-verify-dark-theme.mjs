// Headless-Chrome check for the dark (yoru) theme wiring: Tailwind's dark:
// variants hang off a `.dark` class that applyTheme() must toggle together with
// data-theme. The regression this guards: in yoru mode the side-panel tabs kept
// light-theme semantics, so the inactive tab labels were near-black on the dark
// track - invisible. Checks both themes' tab contrast and screenshots both.
//
//   node scripts/cdp-verify-dark-theme.mjs [appUrl] [accessKey] [cdpPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appUrl = process.argv[2] || 'http://127.0.0.1:3205/'
const accessKey = process.argv[3] || process.env.ACCESS_KEY || ''
const PORT = Number(process.argv[4] || 9339)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-theme-shots-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('no CDP endpoint')
}

let id = 1
function client(ws) {
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
      const i = id++
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i)
          reject(new Error('timeout ' + method))
        }
      }, 30000)
    })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(3500)
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(shots, name + '.png')
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

await goto(appUrl)
if (accessKey) {
  await evaluate(
    `fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({json:{accessKey:${JSON.stringify(accessKey)}}})}).then(r=>r.text())`,
  )
}

// Contrast of a node's text colour against its effective background, using the
// WCAG relative-luminance ratio. The broken state (near-black text on the dark
// track) lands around 1:1; a readable label clears 3:1 comfortably.
const measure = `(() => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number)
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const ratio = (a, b) => {
    const la = luminance(a), lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor
      if (bg && !bg.includes('0, 0, 0, 0') && !bg.endsWith(', 0)')) return bg
    }
    return 'rgb(255, 255, 255)'
  }
  const triggers = [...document.querySelectorAll('[role=tab]')]
  const track = document.querySelector('[role=tablist]')
  if (!triggers.length || !track) return JSON.stringify({ error: 'tabs not found' })
  const active = triggers.find((t) => t.dataset.state === 'active')
  const inactive = triggers.filter((t) => t !== active)
  const trackBg = bgOf(track)
  return JSON.stringify({
    triggers: triggers.map((t) => t.textContent.trim()),
    active: {
      label: active.textContent.trim(),
      color: getComputedStyle(active).color,
      bg: getComputedStyle(active).backgroundColor,
      contrastVsTrack: Math.round(ratio(getComputedStyle(active).color, trackBg) * 100) / 100,
    },
    inactive: inactive.map((t) => ({
      label: t.textContent.trim(),
      color: getComputedStyle(t).color,
      contrastVsTrack: Math.round(ratio(getComputedStyle(t).color, trackBg) * 100) / 100,
    })),
    htmlClass: document.documentElement.className,
    dataTheme: document.documentElement.dataset.theme,
  })
})()`

const readTabs = async () => JSON.parse(await evaluate(measure))

// ---------------------------------------------------------------------------
console.log('=== yoru (dark) ===')
await evaluate(`localStorage.setItem('mopai.theme.v1', 'yoru'); true`)
await goto(appUrl)
await evaluate(`localStorage.setItem('mopai.theme.v1', 'yoru'); true`)
await goto(appUrl)
const dark = await readTabs()
console.log(' ', JSON.stringify(dark, null, 1))
check('yoru: <html> carries data-theme=yoru', dark.dataTheme === 'yoru')
check('yoru: <html> carries the .dark class', dark.htmlClass.includes('dark'))
check('yoru: three panel tabs present', dark.triggers.length === 3, JSON.stringify(dark.triggers))
for (const t of dark.inactive) {
  check(`yoru: inactive "${t.label}" readable on the track`, t.contrastVsTrack >= 3, `contrast=${t.contrastVsTrack} color=${t.color}`)
}
check('yoru: active tab is not a white pill', !dark.active.bg.startsWith('rgb(255') && !dark.active.bg.startsWith('rgb(248'), dark.active.bg)
const shotDark = await screenshot('yoru-side-panel')
console.log(`  screenshot: ${shotDark}`)

console.log('\n=== akari (light) ===')
await evaluate(`localStorage.setItem('mopai.theme.v1', 'akari'); true`)
await goto(appUrl)
const light = await readTabs()
console.log(' ', JSON.stringify(light, null, 1))
check('akari: <html> has no .dark class', !light.htmlClass.includes('dark') && light.dataTheme === 'akari')
for (const t of light.inactive) {
  check(`akari: inactive "${t.label}" readable on the track`, t.contrastVsTrack >= 3, `contrast=${t.contrastVsTrack} color=${t.color}`)
}
check('akari: active tab keeps a readable style', light.active.contrastVsTrack >= 3, `contrast=${light.active.contrastVsTrack}`)
const shotLight = await screenshot('akari-side-panel')
console.log(`  screenshot: ${shotLight}`)

chrome.kill()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* Chrome may hold the profile */
}
console.log(`\nscreenshots kept in ${shots}`)
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
