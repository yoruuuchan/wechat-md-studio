// Acceptance for the agent door, end to end: a script pushes a draft over REST,
// a human opens the link in a real browser and edits it, and the agent reads its
// own article back with the human's changes in it.
//
// Two things this has to prove that unit tests cannot:
//   - the `?doc=<id>` link really lands the browser on that article, including
//     through the sign-in detour when the session is cold;
//   - the article an agent creates is *saved*, so the editor's debounced
//     auto-sync writes the owner's edits back instead of silently dropping them.
//
// It brings its own image worker (in-memory mock) so `img:<key>` is exercised for
// real without writing a single object to production R2.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 3215)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9351)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const ACCESS_KEY = 'agent-acceptance-key'
const ADMIN_KEY = 'agent-acceptance-admin'
const WRITE_TOKEN = 'mopai_acceptance_write_token'
const READ_TOKEN = 'mopai_acceptance_read_token'
const DB_FILE = path.resolve('data/test-agent.db')

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
    DATABASE_URL: 'file:./data/test-agent.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET: 'agent-acceptance-session-secret-2d4f',
    AGENT_TOKENS: `claude-code:${WRITE_TOKEN},reviewer:${READ_TOKEN}:read`,
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

/** The agent's own client: plain fetch, the way a skill script would do it. */
async function api(method, urlPath, { token = WRITE_TOKEN, body, form } = {}) {
  const res = await fetch(`${appUrl.replace(/\/$/, '')}${urlPath}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'))
let chrome = null
try {
  await waitUp()

  // ================= REST, no browser =================
  console.log('=== the door is closed without a token ===')
  const anon = await api('GET', '/api/agent/whoami', { token: null })
  check('anonymous callers get 401', anon.status === 401, `status ${anon.status}`)
  check('the 401 says how to fix it', Boolean(anon.json?.hint), anon.text.slice(0, 120))
  const bogus = await api('GET', '/api/agent/whoami', { token: 'mopai_not_a_real_token' })
  check('an unknown token gets 401 too', bogus.status === 401, `status ${bogus.status}`)

  const who = await api('GET', '/api/agent/whoami')
  check('whoami names the token', who.json?.agent === 'claude-code', JSON.stringify(who.json))
  check('whoami reports its scopes', JSON.stringify(who.json?.scopes) === '["read","write"]', JSON.stringify(who.json?.scopes))
  check('whoami knows the public origin', who.json?.publicBaseUrl === `http://127.0.0.1:${APP_PORT}`, who.json?.publicBaseUrl)

  const denied = await api('POST', '/api/agent/docs', { token: READ_TOKEN, body: { content: '# x' } })
  check('a read-only token cannot write', denied.status === 403, `status ${denied.status}`)
  check('…but it can still read', (await api('GET', '/api/agent/docs', { token: READ_TOKEN })).status === 200)

  console.log('\n=== an image becomes an img: reference ===')
  const form = new FormData()
  // A real 1x1 PNG, so the browser can actually decode what comes back.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+p7RLAAAAAElFTkSuQmCC',
    'base64',
  )
  form.append('file', new Blob([png], { type: 'image/png' }), 'cover.png')
  const shot = await api('POST', '/api/agent/images', { form })
  check('the upload reaches the worker', shot.status === 201, `status ${shot.status} ${shot.text.slice(0, 160)}`)
  check('it hands back an img: reference', String(shot.json?.ref ?? '').startsWith('img:'), shot.json?.ref)
  check('the object really landed in storage', objects.size === 1, `${objects.size} object(s)`)

  console.log('\n=== a draft is pushed ===')
  const markdown = [
    '---',
    'titles:',
    '  - Agent 推来的初稿',
    '---',
    '',
    '## 缘起 | 一段机器写的开头',
    '',
    '这段是 Agent 推进来的，等着人在浏览器里精修。',
    '',
    `![封面](${shot.json.ref})`,
    '',
  ].join('\n')
  const created = await api('POST', '/api/agent/docs', { body: { content: markdown } })
  check('push returns 201', created.status === 201, `status ${created.status} ${created.text.slice(0, 200)}`)
  const docId = created.json?.id
  check('the title came out of the front matter', created.json?.name === 'Agent 推来的初稿', created.json?.name)
  check('it records which token pushed it', created.json?.source === 'agent:claude-code', created.json?.source)
  // The invariant the whole round trip depends on: an unsaved article would be
  // editable in the browser and silently revert on every reload.
  check('the article is saved from birth', Number(created.json?.savedAt) > 0, String(created.json?.savedAt))
  const editorUrl = String(created.json?.editorUrl ?? '')
  check('the editor link is absolute and carries the id', editorUrl === `http://127.0.0.1:${APP_PORT}/?doc=${docId}`, editorUrl)

  const listed = await api('GET', '/api/agent/docs?q=初稿', { token: READ_TOKEN })
  const row = listed.json?.items?.find((i) => i.id === docId)
  check('the list finds it without shipping its content', Boolean(row) && row.content === undefined, JSON.stringify(row))
  check('the list still says how long it is', Number(row?.chars) === markdown.length, `${row?.chars} vs ${markdown.length}`)

  const read = await api('GET', `/api/agent/docs/${docId}`, { token: READ_TOKEN })
  check('a read-only token can read the article back', read.status === 200 && read.json?.content === markdown, `status ${read.status}`)

  console.log('\n=== the lock refuses to clobber a newer version ===')
  const stale = await api('PUT', `/api/agent/docs/${docId}`, { body: { content: '过期的改动', baseHash: 'deadbeefdeadbeef' } })
  check('a stale hash is a 409', stale.status === 409, `status ${stale.status}`)
  check('the 409 carries the current text', stale.json?.current?.content === markdown, String(stale.json?.current?.content).slice(0, 40))
  const locked = await api('PUT', `/api/agent/docs/${docId}`, { body: { content: `${markdown}\n补一句。`, baseHash: read.json.hash } })
  check('the hash from the last read is accepted', locked.status === 200 && locked.json?.ok === true, `status ${locked.status}`)
  check('a successful write returns a new hash', locked.json?.hash !== read.json.hash, String(locked.json?.hash))
  // Put the article back to what the browser is about to see.
  await api('PUT', `/api/agent/docs/${docId}`, { body: { content: markdown, baseHash: locked.json.hash } })

  const themes = await api('GET', '/api/agent/themes', { token: READ_TOKEN })
  check('themes come from the live list, not a hardcoded table', Array.isArray(themes.json) && themes.json.length >= 9 && themes.json.some((t) => t.id === 'golden'), `${themes.json?.length} themes`)

  // ================= the browser half =================
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

  // A cold browser: no session cookie. This is what clicking the link in a fresh
  // profile looks like, and it is the path that used to dead-end on /login.
  console.log('\n=== the link survives the sign-in detour ===')
  await send('Page.navigate', { url: editorUrl }, sessionId)
  await sleep(2500)
  const bounced = await ev('JSON.stringify({ path: location.pathname, search: location.search })')
  check('a signed-out click is sent to sign in', JSON.parse(bounced).path === '/login', bounced)

  const signed = await ev(`(async () => {
    const input = document.querySelector('input[type=password]')
    if (!input) return 'no password field'
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(ACCESS_KEY)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    document.querySelector('button[type=submit]').click()
    await new Promise(r => setTimeout(r, 2500))
    return JSON.stringify({ path: location.pathname, search: location.search })
  })()`)
  const back = JSON.parse(signed)
  // The parameter may already be gone by now — the editor applies the deep link
  // and then drops it. What matters here is that signing in left /login; the
  // check below is the one that proves it landed on the right article.
  check('signing in returns to the editor, not the login page', back.path === '/', signed)
  check('it came back through the article link', back.search === '' || back.search === `?doc=${docId}`, signed)

  const opened = await waitFor(`(() => {
    const v = window.__mopaiCodemirror
    if (!v) return null
    const text = v.state.doc.toString()
    if (!text.includes('机器写的开头')) return null
    const name = document.querySelector('input[placeholder="未命名稿件"]')
    return JSON.stringify({ name: name ? name.value : null, chars: text.length })
  })()`, 30000, 'the editor opening the pushed article')
  const openedInfo = JSON.parse(opened)
  check('the editor is showing that article, not another one', openedInfo.name === 'Agent 推来的初稿', opened)

  const cleared = await ev('location.search')
  check('the ?doc= parameter is dropped once applied', cleared === '', `search is "${cleared}"`)

  const figure = await waitFor(`(() => {
    const img = [...document.querySelectorAll('img')].find(i => i.src.includes('/api/img/'))
    if (!img) return null
    return JSON.stringify({ loaded: img.complete && img.naturalWidth > 0, w: img.naturalWidth })
  })()`, 30000, 'the uploaded figure in the preview')
  check('the img: reference the agent uploaded renders for the human', JSON.parse(figure).loaded === true, figure)

  // ================= the point of the whole feature =================
  console.log('\n=== the human edits, the agent reads it back ===')
  await ev(`(() => {
    const v = window.__mopaiCodemirror
    const at = v.state.doc.length
    v.dispatch({ changes: { from: at, insert: '\\n\\n## 人工精修 | 人加的一段\\n\\n这句是人在浏览器里补的。\\n' } })
  })()`)
  // Auto-sync is debounced at 900ms; give it room, then ask the server the way
  // an agent would.
  let readBack = null
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    readBack = await api('GET', `/api/agent/docs/${docId}`, { token: READ_TOKEN })
    if (String(readBack.json?.content ?? '').includes('人在浏览器里补的')) break
  }
  check('the owner’s edit reached the server', String(readBack?.json?.content ?? '').includes('人在浏览器里补的'), String(readBack?.json?.content ?? '').slice(-80))
  check('the agent’s own text is still there', String(readBack?.json?.content ?? '').includes('机器写的开头'))
  check('the read-back hash moved with the content', readBack?.json?.hash !== read.json.hash, `${read.json?.hash} → ${readBack?.json?.hash}`)

  console.log('\n=== a link to an article that is not there ===')
  await send('Page.navigate', { url: `${appUrl}?doc=not-a-real-id` }, sessionId)
  await sleep(3000)
  const missing = await waitFor(`(() => {
    const t = document.querySelector('[data-sonner-toast]')
    return t ? t.innerText : null
  })()`, 20000, 'the notice about a dead link')
  check('a dead link explains itself instead of failing quietly', String(missing).includes('不在这个账号里'), String(missing).slice(0, 80))
  const alive = await ev('typeof window.__mopaiCodemirror')
  check('the editor is still up afterwards', alive === 'object', alive)

  console.log('\n=== what got persisted ===')
  const saved = await api('GET', '/api/agent/docs?saved=1&q=精修', { token: READ_TOKEN })
  check('the polished article is in 草稿箱', Boolean(saved.json?.items?.find((i) => i.id === docId)), JSON.stringify(saved.json?.items?.map((i) => i.name)))
} catch (e) {
  failures++
  console.error('\nACCEPTANCE ERROR:', e.message)
  if (appLog) console.error('--- app log tail ---\n' + appLog.slice(-1200))
} finally {
  try { chrome?.kill() } catch { /* already gone */ }
  try { app.kill() } catch { /* already gone */ }
  worker.close()
  try { fs.rmSync(DB_FILE, { force: true }) } catch { /* leave it */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
