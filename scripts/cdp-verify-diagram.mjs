// Acceptance for the mermaid path, end to end in a real browser: sign in, type a
// fence, and watch it come back as an uploaded figure.
//
// It brings its own image worker (an in-memory mock on the port below) so the
// chain is exercised for real - PUT with the admin key, /api/img redirect, pixels
// arriving in an <img> - without writing a single test object to production R2.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 3203)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9347)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const ACCESS_KEY = 'diagram-acceptance-key'
const ADMIN_KEY = 'diagram-acceptance-admin'
const DB_FILE = path.resolve('data/test-diagram.db')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// ---------- mock image worker ----------
const objects = new Map()
const worker = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/upload') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
      res.writeHead(403).end('bad admin key')
      return
    }
    const key = url.searchParams.get('key') ?? ''
    if (req.method === 'DELETE') {
      objects.delete(key)
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ key, size: body.length }))
    })
    return
  }
  if (url.pathname.startsWith('/img/')) {
    const obj = objects.get(decodeURIComponent(url.pathname.slice('/img/'.length)))
    if (!obj) {
      res.writeHead(404).end('missing')
      return
    }
    res.writeHead(200, { 'content-type': obj.type })
    res.end(obj.body)
    return
  }
  res.writeHead(404).end('no route')
})
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// ---------- app server ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
try { fs.rmSync(DB_FILE, { force: true }) } catch { /* nothing to clear */ }
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/test-diagram.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET: 'diagram-acceptance-session-secret-9c1a',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => (appLog += d))
app.stderr.on('data', (d) => (appLog += d))

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(appUrl, { redirect: 'manual' })
      if (r.status < 500) return
    } catch { /* not listening yet */ }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP_PORT}\n${appLog.slice(-800)}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-'))
let chrome = null
try {
  await waitUp()

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })

  let wsBase = ''
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) { wsBase = j.webSocketDebuggerUrl; break }
    } catch { /* not up yet */ }
    await sleep(250)
  }
  if (!wsBase) throw new Error('no CDP')

  let id = 1
  const pending = new Map()
  const ws = new WebSocket(wsBase)
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 60000)
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    }
    return r.result.value
  }
  /** Poll until an expression is truthy, or report what it last said. */
  const waitFor = async (expression, ms, label) => {
    const deadline = Date.now() + ms
    let last = null
    while (Date.now() < deadline) {
      last = await ev(expression)
      if (last) return last
      await sleep(400)
    }
    throw new Error(`${label} never happened (last: ${JSON.stringify(last)})`)
  }
  /** Same, for something only this process can see. */
  const waitForNode = async (fn, ms, label) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await sleep(400)
    }
    throw new Error(`${label} never happened`)
  }

  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(3500)

  console.log('=== signing in ===')
  await send('Page.navigate', { url: `${appUrl}login` }, sessionId)
  await sleep(1800)
  const signed = await ev(`(async () => {
    const input = document.querySelector('input[type=password]')
    if (!input) return 'no password field'
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(ACCESS_KEY)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    document.querySelector('button[type=submit]').click()
    await new Promise(r => setTimeout(r, 2000))
    return location.pathname
  })()`)
  check('the access key signs the session in', signed !== '/login' && !String(signed).startsWith('no '), String(signed))

  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(3000)
  const authed = await ev(`JSON.stringify({ cm: typeof window.__mopaiCodemirror })`)
  check('the editor is up after signing in', JSON.parse(authed).cm === 'object', authed)

  console.log('\n=== mermaid is not in the first-load bundle ===')
  // Strip the content hash first: "d3" otherwise matches inside rich-paste-D33INrxr.js.
  const bareName = `n => n.split('/').pop().replace(/-[A-Za-z0-9_-]{8,}\\.js$/, '.js')`
  const before = await ev(`JSON.stringify(performance.getEntriesByType('resource').map(r => ${bareName}(r.name)).filter(n => /^(mermaid|elk|dagre|d3|khroma|cytoscape|cynefin|roughjs|katex)/.test(n)))`)
  check('no diagram chunk is fetched before a fence exists', JSON.parse(before).length === 0, before)

  console.log('\n=== a fence becomes an uploaded figure ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, insert: '\`\`\`mermaid 渲染链路\\ngraph TD\\n  A[Markdown] --> B[语义块]\\n  B --> C[公众号 HTML]\\n\`\`\`\\n\\n' } })
  })()`)

  const imgInfo = await waitFor(`(() => {
    const img = document.querySelector('div.px-1.py-6 img')
    if (!img || !img.src.includes('/api/img/')) return null
    return JSON.stringify({
      src: img.src.split('/').pop(),
      loaded: img.complete && img.naturalWidth > 0,
      natural: [img.naturalWidth, img.naturalHeight],
      caption: (img.closest('p').nextElementSibling || {}).innerText || '',
    })
  })()`, 60000, 'the diagram image')
  const img = JSON.parse(imgInfo)
  check('the figure arrived through /api/img', img.src.length > 0, imgInfo)
  check('the browser really loaded pixels for it', img.loaded === true, imgInfo)
  check('the raster is retina-sized but capped', img.natural[0] > 0 && img.natural[0] <= 1354, imgInfo)
  check('the caption carries the fence title', img.caption.includes('图1') && img.caption.includes('渲染链路'), imgInfo)

  console.log('\n=== what loading one flowchart actually costs ===')
  const cost = await ev(`(() => {
    const bare = n => n.split('/').pop().replace(/-[A-Za-z0-9_-]{8,}\\.js$/, '.js')
    const rs = performance.getEntriesByType('resource').filter(r => /\\.js(\\?|$)/.test(r.name))
    const diagram = rs.filter(r => /^(mermaid|elk|dagre|d3|khroma|cytoscape|cynefin|roughjs|katex)/.test(bare(r.name)))
    // Measured: even a plain flowchart pulls mermaid's elk layout chunk (v12
    // resolves flowchart layout through it). It is lazy and paid once per
    // session, so it is not evidence of cross-type drag. What must NOT come
    // along are the engines of diagram types this article does not use.
    const unused = diagram.filter(r => /^(cytoscape|cynefin|roughjs|katex)/.test(bare(r.name)))
    return JSON.stringify({
      chunks: diagram.length,
      kb: Math.round(diagram.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
      names: diagram.map(r => bare(r.name)).sort(),
      unused: unused.map(r => bare(r.name)),
    })
  })()`)
  const cst = JSON.parse(cost)
  console.log(`  ${cst.chunks} chunks, ${cst.kb} KB: ${cst.names.join(', ')}`)
  check('a flowchart does not drag in other diagram types’ engines', cst.unused.length === 0, JSON.stringify(cst.unused))

  console.log('\n=== the worker got one real PNG ===')
  const stored = [...objects.values()]
  const first = stored[0]
  check('exactly one object was uploaded', stored.length === 1, `count=${stored.length}`)
  check('it is a PNG', first?.type === 'image/png' && first?.body.subarray(1, 4).toString() === 'PNG', `type=${first?.type}`)
  check('it is a sane size for a diagram', first && first.body.length > 2000 && first.body.length < 900000, `bytes=${first?.body.length}`)

  console.log('\n=== the cache remembers it ===')
  const cache = await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem('mopai.diagrams.v1') || '[]')
    return JSON.stringify({ entries: raw.length, isRef: (raw[0] || [])[1]?.startsWith('img:') === true })
  })()`)
  const cached = JSON.parse(cache)
  check('one entry, pointing at an img: reference', cached.entries === 1 && cached.isRef, cache)

  console.log('\n=== the copied string carries the figure ===')
  const copied = await ev(`(() => {
    const root = document.querySelector('div.px-1.py-6 > section')
    const html = root.outerHTML
    return JSON.stringify({
      imgs: (html.match(/<img /g) || []).length,
      hasDiagram: html.includes('/api/img/'),
      hasSource: html.includes('graph TD'),
      forbidden: (html.match(/\\s(class|id)=|<script|<style|<div/gi) || []).length,
    })
  })()`)
  const cp = JSON.parse(copied)
  check('the payload holds the figure and not the source', cp.hasDiagram && !cp.hasSource, copied)
  check('the payload stays inside the red lines', cp.forbidden === 0, copied)

  console.log('\n=== editing the diagram uploads a fresh one ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    const text = v.state.doc.toString()
    const at = text.indexOf('  B --> C[公众号 HTML]')
    v.dispatch({ changes: { from: at, insert: '  B --> D[主题]\\n' } })
  })()`)
  await waitForNode(() => objects.size === 2, 60000, 'a second upload')
  const second = await waitFor(`(() => {
    const i = document.querySelector('div.px-1.py-6 img')
    if (!i || !i.src.includes('/api/img/')) return null
    return JSON.stringify({
      n: [...document.querySelectorAll('div.px-1.py-6 img')].filter(x => x.src.includes('/api/img/')).length,
      src: i.src.split('/').pop(),
    })
  })()`, 30000, 'the swapped figure')
  const sec = JSON.parse(second)
  check('a changed source is a new figure', objects.size === 2, `objects=${objects.size}`)
  check('the preview swapped to the new key', sec.src !== img.src, `${img.src} -> ${sec.src}`)
  check('the old source is gone from the article', sec.n === 1, second)

  console.log('\n=== a diagram that cannot be built keeps its source ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    const text = v.state.doc.toString()
    const from = text.indexOf('graph TD')
    const to = text.indexOf('\\n\`\`\`', from)
    v.dispatch({ changes: { from, to, insert: 'this is not a diagram at all' } })
  })()`)
  await sleep(9000)
  const broken = await ev(`(() => {
    const host = document.querySelector('div.px-1.py-6')
    return JSON.stringify({
      imgs: [...host.querySelectorAll('img')].filter(i => i.src.includes('/api/img/')).length,
      showsSource: host.innerText.includes('this is not a diagram at all'),
    })
  })()`)
  const br = JSON.parse(broken)
  check('no figure is rendered for broken syntax', br.imgs === 0, broken)
  check('the author still sees the source', br.showsSource === true, broken)
  check('nothing further was uploaded', objects.size === 2, `objects=${objects.size}`)
} catch (e) {
  failures++
  console.log(`\n  [ERROR] ${e.message}`)
  console.log(appLog.slice(-600))
} finally {
  if (chrome) chrome.kill()
  app.kill()
  worker.close()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may hold it */ }
  await sleep(400)
  try { fs.rmSync(DB_FILE, { force: true }) } catch { /* already gone */ }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
