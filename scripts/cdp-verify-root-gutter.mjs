// Run with: node --import tsx scripts/cdp-verify-root-gutter.mjs
// Generates every theme root at 1/2/3 nesting levels, then measures real widths
// in Chrome. Representative 8/16/22px themes also get screenshots.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { THEMES } from '../src/lib/themes.ts'

const CDP = Number(process.argv[2] || 9351)
const out = path.resolve('verify-out/root-gutter')
fs.mkdirSync(out, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-gutter-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const probe = (theme, depth, index) => {
  let html = '<section data-probe style="width:100%;box-sizing:border-box;min-height:24px;"><span leaf="">probe</span></section>'
  for (let i = 0; i < depth; i++) html = theme.root(html)
  return `<div class="cell" data-depth="${depth}" data-index="${index}">${html}</div>`
}
const representative = new Set(['olive', 'xiaohu-apple-gradient', 'xiaohu-academic-paper', 'golden'])
const cases = THEMES.map((theme, index) => `
  <section class="case" data-theme="${theme.id}" data-index="${index}">
    <p class="label">${index + 1}. ${theme.id}</p>
    <div class="row">${[1, 2, 3].map((depth) => probe(theme, depth, index)).join('')}</div>
  </section>`).join('')
const page = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:20px;background:#e9edf3;font:12px sans-serif}
  .case{margin:0 0 18px}.label{margin:0 0 5px;color:#333}.row{display:flex;gap:10px}
  .cell{width:375px;max-width:375px;background:#fff;overflow:hidden}
  section[data-probe] span{font-size:14px}
</style>${cases}`
const htmlFile = path.join(out, 'all-themes.html')
fs.writeFileSync(htmlFile, page)

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1250,1000', 'about:blank',
], { stdio: 'ignore', windowsHide: true })

let wsUrl = ''
for (let i = 0; i < 80; i++) {
  try {
    const info = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()
    if (info.webSocketDebuggerUrl) { wsUrl = info.webSocketDebuggerUrl; break }
  } catch { /* starting */ }
  await sleep(200)
}
if (!wsUrl) throw new Error('Chrome CDP did not start')
const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const request = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  setTimeout(() => {
    if (!pending.has(id)) return
    pending.delete(id)
    reject(new Error(`CDP timeout: ${method}`))
  }, 30000)
})
const evaluate = async (expression, sessionId) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Page.navigate', { url: `file:///${htmlFile.replace(/\\/g, '/')}` }, sessionId)
  await sleep(1000)
  const result = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.case')].map((box) => {
      const widths = [...box.querySelectorAll('[data-probe]')].map((node) => node.getBoundingClientRect().width)
      return {
        id: box.dataset.theme,
        widths,
        stable: Math.max(...widths) - Math.min(...widths) < 0.6,
        overflow: box.scrollWidth > box.clientWidth + 1,
      }
    })
    return { rows, badWidths: rows.filter((row) => !row.stable), overflow: rows.filter((row) => row.overflow) }
  })()`, sessionId)
  check('all 219 themes keep the same content width at 1/2/3 root nesting', result.badWidths.length === 0, JSON.stringify(result.badWidths.slice(0, 6)))
  check('no theme horizontally overflows a 375px article column', result.overflow.length === 0, JSON.stringify(result.overflow.slice(0, 6)))

  for (const id of representative) {
    const index = THEMES.findIndex((theme) => theme.id === id)
    const box = await evaluate(`(() => {
      const r = document.querySelector('.case[data-index="${index}"]').getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }
    })()`, sessionId)
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
    }, sessionId)
    fs.writeFileSync(path.join(out, `${id}.png`), Buffer.from(shot.data, 'base64'))
  }
  check('representative 8/16/22px themes captured', true, Array.from(representative).join(', '))
} finally {
  try { await send('Browser.close') } catch { /* already closed */ }
  ws.close()
  chrome.kill()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
