// Public-access acceptance: drive the real app in headless Chrome *without*
// logging in, and measure what an anonymous visitor actually gets.
//
// Usage: node scripts/cdp-verify-public-access.mjs <appUrl> [cdpPort]
// Second worktree convention: app on 3201, CDP on 9335.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Everything here talks to 127.0.0.1, but this host exports a global HTTP proxy
// that would swallow those requests.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = (process.argv[2] || 'http://127.0.0.1:3201').replace(/\/$/, '')
const PORT = Number(process.argv[3] || 9335)
const TMP = 'node_modules/.tmp'
fs.mkdirSync(TMP, { recursive: true })

// A real 8x8 PNG on disk, because DOM.setFileInputFiles needs a path.
const PNG_FILE = path.resolve(TMP, 'cdp-upload-sample.png')
fs.writeFileSync(
  PNG_FILE,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR4nGP8//8/AzbAxIAHjEIQRQoAHbcCpV0v4G8AAAAASUVORK5CYII=',
    'base64',
  ),
)

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-public-cdp-'))
const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error('CDP never came up')
}

let msgId = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
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
          reject(new Error('timeout ' + method))
        }
      }, 60000)
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

const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(m.params?.exceptionDetails?.text ?? 'exception'))
  }
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

const goto = async (url, settle = 2500) => {
  await send('Page.navigate', { url }, sessionId)
  await sleep(settle)
}

const bodyText = () => evaluate(`document.body.innerText`)

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(TMP, name)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`  shot → ${file}`)
}

/** Wait until a page-context predicate holds, or report what it last saw. */
async function waitFor(expression, ms = 20000) {
  return evaluate(`(async () => {
    const deadline = Date.now() + ${ms}
    while (Date.now() < deadline) {
      if (${expression}) return true
      await new Promise(r => setTimeout(r, 150))
    }
    return false
  })()`)
}

// ------------------------------------------------------- anonymous editor
console.log('=== / (never logged in) ===')
await goto(APP, 3000)
const ready = await waitFor(`!!document.querySelector('aside') && !!window.__mopaiCodemirror`, 20000)
check('the editor opens with no session at all', ready === true)
if (!ready) {
  console.log('  body:', JSON.stringify((await bodyText()).slice(0, 300)))
  chrome.kill()
  process.exit(1)
}

const docName = await evaluate(`document.body.innerText.match(/示例稿[^\\n]*/)?.[0] ?? ''`)
check('the seeded draft is the neutral sample', docName.includes('示例稿'), JSON.stringify(docName))

const source = await evaluate(`window.__mopaiCodemirror.state.doc.toString()`)
// Assert on the neutral sample's own marker rather than blacklisting strings
// that must not appear: a blacklist has to name them, which is exactly what
// this check exists to keep out of the public repository.
check('the default draft is the neutral welcome sample', source.includes('欢迎使用芦苇'), source.slice(0, 60))
for (const needle of ['==', ':::center', ':::quote', ':::carousel', '@signature', '|:---', '```', '<!--']) {
  check(`sample demonstrates ${needle}`, source.includes(needle))
}

// The preview is a deferred render of the same doc; over a slow link it can lag
// the fixed settle time, and measuring too early reads an empty body.
const previewReady = await waitFor(`document.querySelectorAll('span[leaf]').length > 50`, 20000)
check('the preview rendered the sample', previewReady === true)

const previewShape = await evaluate(`(() => {
  const p = document.querySelector('[data-preview], main section') ?? document.body
  const table = p.querySelector('table')
  return {
    tables: p.querySelectorAll('table').length,
    cells: table ? table.querySelectorAll('th, td').length : 0,
    leafSpans: p.querySelectorAll('span[leaf]').length,
    placeholder: /图\\s*1/.test(p.innerText),
  }
})()`)
check('the sample renders a real table', previewShape.tables >= 1 && previewShape.cells === 12, JSON.stringify(previewShape))
check('text is wrapped in leaf spans', previewShape.leafSpans > 50, `leaf=${previewShape.leafSpans}`)
check('an empty image src becomes a 图1 placeholder', previewShape.placeholder === true)

const loginButton = await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '登录')`)
check('the top bar still offers the owner a way in', loginButton === true)
await shot('public-editor.png')

// ------------------------------------------------- anonymous image upload
console.log('\n=== anonymous upload through the UI ===')
await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '![测试图]()\\n\\n' } })
  // An image only becomes an <img> block when it sits alone on its line, so
  // park the cursor on the empty trailing line rather than after the
  // placeholder. Read the length *after* the change, or the selection points
  // outside the new document.
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  return true
})()`)
await sleep(900)

const clicked = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('aside li')]
  for (const row of rows) {
    const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '上传')
    if (btn) { btn.click(); return 'clicked' }
  }
  return 'no-upload-button'
})()`)
check('the sidebar offers 上传 to an anonymous visitor', clicked === 'clicked', String(clicked))
await sleep(600)

const { root } = await send('DOM.getDocument', {}, sessionId)
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId)
check('a file input is mounted', !!nodeId, `nodeId=${nodeId}`)
await send('DOM.setFileInputFiles', { nodeId, files: [PNG_FILE] }, sessionId)
await sleep(900)

const confirmed = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('[role=dialog] button')]
    .find(b => /原样上传|按这个比例上传/.test(b.textContent))
  if (!btn) return 'no-dialog-button'
  btn.click()
  return 'clicked:' + btn.textContent.trim()
})()`)
check('the ratio dialog confirms without asking for a login', String(confirmed).startsWith('clicked'), String(confirmed))

const uploaded = await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('img:')`, 25000)
const toasts = await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent.slice(0, 90))`)
check('the upload lands as an img: reference with no session', uploaded === true, JSON.stringify(toasts))
check('nothing told the visitor to log in', !toasts.some((t) => t.includes('需要先登录')), JSON.stringify(toasts))

await waitFor(`[...document.querySelectorAll('img')].some(i => (i.getAttribute('src') || '').includes('/api/img/'))`, 10000)
const imgSrc = await evaluate(`[...document.querySelectorAll('img')].map(i => i.getAttribute('src')).filter(s => s && s.includes('/api/img/'))[0] ?? ''`)
if (!imgSrc) {
  console.log('  doc:', JSON.stringify(await evaluate(`window.__mopaiCodemirror.state.doc.toString()`)))
  console.log('  imgs:', JSON.stringify(await evaluate(`[...document.querySelectorAll('img')].map(i => i.outerHTML.slice(0, 120))`)))
}
check('the preview shows the uploaded picture', imgSrc.includes('/api/img/'), imgSrc)
if (imgSrc) {
  // /api/img answers with a cross-origin 302, so fetch() trips CORS even when
  // the picture is public; an <img> has no such restriction. Decoded pixels are
  // the honest proof that an anonymous read works.
  const loaded = await waitFor(
    `[...document.querySelectorAll('img')].some(i => (i.getAttribute('src') || '').includes('/api/img/') && i.complete && i.naturalWidth > 0)`,
    15000,
  )
  const dims = await evaluate(`(() => {
    const i = [...document.querySelectorAll('img')].find(el => (el.getAttribute('src') || '').includes('/api/img/'))
    return i ? \`\${i.naturalWidth}x\${i.naturalHeight} complete=\${i.complete}\` : 'no-img'
  })()`)
  check('the picture is publicly readable and really decodes', loaded === true, String(dims))
}
await shot('public-upload.png')

// ------------------------------------------------ anonymous materials page
console.log('\n=== /materials (anonymous) ===')
await goto(`${APP}/materials`, 2500)
const materialsText = await bodyText()
check('no login wall on the materials page', !materialsText.includes('素材库需要登录'))
check('it explains the per-browser allowance', materialsText.includes('这台浏览器上传的图') && /24 小时/.test(materialsText))
check('the uploaded image is listed', materialsText.includes('共 1 张'), materialsText.match(/共 \d+ 张[^\n]*/)?.[0] ?? '')
await shot('public-materials.png')

// ----------------------------------------------------- other public pages
console.log('\n=== /themes and /drafts (anonymous) ===')
await goto(`${APP}/themes`, 1500)
const cardsReady = await waitFor(`document.querySelectorAll('[data-theme-card]').length > 0`, 20000)
const cardCount = await evaluate(`document.querySelectorAll('[data-theme-card]').length`)
check('the theme library is public too', cardsReady === true && cardCount >= 200, `cards=${cardCount}`)

await goto(`${APP}/drafts`, 2000)
const draftsText = await bodyText()
check('cloud drafts stay owner-only', draftsText.includes('草稿箱需要登录'), draftsText.slice(0, 80))

// ------------------------------------------------------- console hygiene
const knownNoise = /Line decoration ranges must be zero-length/
const realErrors = consoleErrors.filter((e) => !knownNoise.test(e))
console.log(`\n  console: ${consoleErrors.length} error(s), ${consoleErrors.length - realErrors.length} known CodeMirror decoration noise`)
check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | ').slice(0, 300))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
ws.close()
chrome.kill()
await sleep(500)
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // Windows keeps the profile locked for a moment after the kill; a leftover
  // temp directory is not a failed check.
}
process.exit(failures === 0 ? 0 : 1)
