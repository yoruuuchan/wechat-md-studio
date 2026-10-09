// Acceptance for the document sync model, in a real browser:
//
//   1. signing in against an account that already has articles keeps the
//      articles this browser wrote while signed out (the old code dropped
//      them), and pushes them up;
//   2. a stale browser save is refused with a conflict dialog while the newer
//      cloud text stays intact, and all three resolution paths behave;
//   3. bodies are fetched on demand — opening a cloud article loads its text,
//      and local-only work stays in localStorage throughout.
//
// The second writer is a plain agent-API client (the same door a skill script
// uses), which is exactly what "another device" looks like to this app.
//
// It brings its own in-memory image worker so nothing touches production R2.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 3216)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9352)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const ACCESS_KEY = 'docs-sync-acceptance-key'
// Production env validation (api/lib/env.ts) enforces minimum lengths on these
// two; this script always boots with NODE_ENV=production.
const ADMIN_KEY = 'docs-sync-admin-key-9c2e'
const WRITE_TOKEN = 'mopai_docs_sync_write_token'
const SESSION_SECRET = 'docs-sync-acceptance-session-secret-7b31'
const DB_FILE = path.resolve('data/test-docs-sync.db')

const LOCAL_TEXT = '本地稿 A 的正文，登录前写的。'
const CLOUD_TEXT = '云端已有稿 B 的正文。'
const DEVICE_B_TEXT = '设备二后来写的版本。'
const THIRD_PARTY_TEXT = '第三方的版本，不能被浏览器悄悄盖掉。'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// ---------- inert worker (boot in production wants the two image envs) ----------
const worker = http.createServer((req, res) => {
  res.writeHead(404).end('no route')
})
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// ---------- app server on a private database ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
try { fs.rmSync(DB_FILE, { force: true }) } catch { /* nothing to clear */ }
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/test-docs-sync.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET,
    AGENT_TOKENS: `device-two:${WRITE_TOKEN}`,
    // Never sweep anything while a test run is up.
    ANON_GC_ENABLED: 'false',
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

async function api(method, urlPath, { token = WRITE_TOKEN, body } = {}) {
  const res = await fetch(`${appUrl.replace(/\/$/, '')}${urlPath}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-sync-'))
let chrome = null
try {
  await waitUp()

  // ================= the cloud already has data =================
  console.log('=== the account already has an article (pushed by another door) ===')
  const seeded = await api('POST', '/api/agent/docs', {
    body: { content: `---\ntitles:\n  - 云端稿 B\n---\n\n${CLOUD_TEXT}` },
  })
  check('the pre-existing cloud article was created', seeded.status === 201, `status ${seeded.status}`)
  const cloudDocId = seeded.json.id

  // ================= the browser writes while signed out =================
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
  /** Real mouse click at the centre of an element — Radix menus need pointer events. */
  const clickElement = async (elementExpression, label) => {
    const coord = await ev(`(() => {
      const el = ${elementExpression}
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return null
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    })()`)
    if (!coord) throw new Error(`nothing to click for ${label}`)
    const { x, y } = JSON.parse(coord)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId)
  }
  const editorText = () => ev(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : ''`)
  const appendToEditor = (text) => ev(`(() => {
    const v = window.__mopaiCodemirror
    if (!v) return false
    v.focus()
    v.dispatch({ changes: { from: v.state.doc.length, insert: ${JSON.stringify('\n' + text)} } })
    return true
  })()`)
  const openSwitcher = async () => {
    await clickElement(`document.querySelector('[title="切换稿件"]')`, 'the article switcher')
    await waitFor(`document.querySelector('[role="menu"]') !== null`, 5000, 'the switcher menu')
  }

  console.log('\n=== signed out: a fresh article is written locally ===')
  await send('Page.navigate', { url: appUrl }, sessionId)
  await waitFor(`document.querySelector('.cm-content') !== null`, 20000, 'the editor')
  await waitFor(`window.__mopaiCodemirror !== undefined`, 10000, 'the CodeMirror handle')

  await openSwitcher()
  await clickElement(
    `[...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes('新建稿件'))`,
    '新建稿件',
  )
  await sleep(600)
  // Name it so the merge is checkable from the API side.
  await ev(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    if (!input) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, '本地稿 A')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(300)
  await appendToEditor(LOCAL_TEXT)
  await sleep(1200)

  const cached = await ev(`(() => {
    const docs = JSON.parse(localStorage.getItem('mopai.docs.v1') || '[]')
    const mine = docs.find(d => d.name === '本地稿 A')
    return mine ? mine.content : null
  })()`)
  check('the signed-out article is in localStorage', String(cached).includes(LOCAL_TEXT), String(cached).slice(0, 60))

  // ================= sign in with existing cloud data =================
  console.log('\n=== signing in must not drop the local article ===')
  await send('Page.navigate', { url: `${appUrl}login` }, sessionId)
  await waitFor(`document.querySelector('input[type=password]') !== null`, 15000, 'the login form')
  await ev(`(async () => {
    const input = document.querySelector('input[type=password]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(ACCESS_KEY)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    document.querySelector('button[type=submit]').click()
    return true
  })()`)
  await sleep(3000)

  const listed = await waitFor(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    const docs = window.__mopaiCodemirror ? null : null
    return input ? 'ready' : null
  })()`, 20000, 'the editor after login')

  await openSwitcher()
  const menuNames = await ev(`JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim()))`)
  // Close the menu again with Escape.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, sessionId)
  check('the local article is still listed after login', menuNames.includes('本地稿 A'), menuNames.slice(0, 200))
  check('the pre-existing cloud article is listed too', menuNames.includes('云端稿 B'), menuNames.slice(0, 200))

  let localImported = null
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const all = await api('GET', '/api/agent/docs')
    localImported = all.json?.items?.find((d) => d.name === '本地稿 A')
    if (localImported) break
  }
  check('the local article was pushed into the account', Boolean(localImported), JSON.stringify(localImported))
  check(
    'it arrived as a working copy (not archived)',
    localImported && localImported.savedAt === null,
    String(localImported?.savedAt),
  )
  const localOnCloud = localImported ? await api('GET', `/api/agent/docs/${localImported.id}`) : null
  check(
    'its text arrived intact',
    String(localOnCloud?.json?.content ?? '').includes(LOCAL_TEXT),
    String(localOnCloud?.json?.content ?? '').slice(0, 60),
  )

  const stillCached = await ev(`(() => {
    const docs = JSON.parse(localStorage.getItem('mopai.docs.v1') || '[]')
    const mine = docs.find(d => d.name === '本地稿 A')
    return mine ? mine.content : null
  })()`)
  check('the local copy is still in localStorage after the merge', String(stillCached).includes(LOCAL_TEXT))

  // ================= bodies on demand =================
  console.log('\n=== opening a cloud article fetches its body on demand ===')
  await openSwitcher()
  await clickElement(
    `[...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes('云端稿 B'))`,
    '云端稿 B in the switcher',
  )
  const cloudShown = await waitFor(`(() => {
    const t = window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : ''
    return t.includes(${JSON.stringify(CLOUD_TEXT)}) ? t : null
  })()`, 20000, 'the cloud article body')
  check('the body was fetched and rendered', cloudShown.includes(CLOUD_TEXT))
  const nameNow = await ev(`document.querySelector('input[placeholder="未命名稿件"]').value`)
  check('the right article is open', nameNow === '云端稿 B', String(nameNow))

  // ================= conflict #1: the agent moves first, resolve by keeping mine =================
  console.log('\n=== a stale save is refused, the newer cloud text stays intact ===')
  await appendToEditor('浏览器这边加的第一段。')
  let bCurrent = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    bCurrent = await api('GET', `/api/agent/docs/${cloudDocId}`)
    if (String(bCurrent.json?.content ?? '').includes('浏览器这边加的第一段')) break
  }
  check('the browser edit synced up first', String(bCurrent?.json?.content ?? '').includes('浏览器这边加的第一段'))

  // Another device writes through the agent door, using the hash it just read.
  const deviceB = await api('PUT', `/api/agent/docs/${cloudDocId}`, {
    body: { content: `---\ntitles:\n  - 云端稿 B\n---\n\n${DEVICE_B_TEXT}`, baseHash: bCurrent.json.hash },
  })
  check('the other device wrote successfully', deviceB.status === 200, `status ${deviceB.status} ${deviceB.text.slice(0, 120)}`)

  // The browser, still holding the pre-write base, edits again → conflict.
  await appendToEditor('浏览器这边加的第二段。')
  const dialogUp = await waitFor(`(() => {
    const d = document.querySelector('[role="dialog"]')
    if (!d || !d.innerText.includes('在别处也被改过')) return null
    return d.innerText
  })()`, 25000, 'the conflict dialog')
  check('a stale save raised the conflict dialog', dialogUp.includes('在别处也被改过'), dialogUp.slice(0, 80))
  const afterConflict = await api('GET', `/api/agent/docs/${cloudDocId}`)
  check(
    'the newer cloud text was NOT overwritten',
    afterConflict.json?.content === `---\ntitles:\n  - 云端稿 B\n---\n\n${DEVICE_B_TEXT}`,
    String(afterConflict.json?.content).slice(0, 80),
  )
  check('the dialog previews the cloud version', dialogUp.includes(DEVICE_B_TEXT), dialogUp.slice(0, 200))

  await clickElement(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes('保留我这一版'))`,
    '保留我这一版',
  )
  let keptMine = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    keptMine = await api('GET', `/api/agent/docs/${cloudDocId}`)
    if (String(keptMine.json?.content ?? '').includes('浏览器这边加的第二段')) break
  }
  check('保留我这一版 wrote the browser text over the cloud copy', String(keptMine?.json?.content ?? '').includes('浏览器这边加的第二段'))
  const dialogGone = await waitFor(`document.querySelector('[role="dialog"]') === null ? 'gone' : null`, 10000, 'the dialog closing')
  check('the dialog closed after resolving', dialogGone === 'gone')
  const editorAfter = await editorText()
  check('the editor still holds the browser version', editorAfter.includes('浏览器这边加的第二段'))

  // ================= conflict #2: resolve by keeping both =================
  console.log('\n=== the third path keeps both versions ===')
  const beforeThird = await api('GET', `/api/agent/docs/${cloudDocId}`)
  const third = await api('PUT', `/api/agent/docs/${cloudDocId}`, {
    body: { content: `---\ntitles:\n  - 云端稿 B\n---\n\n${THIRD_PARTY_TEXT}`, baseHash: beforeThird.json.hash },
  })
  check('the other device wrote again', third.status === 200, `status ${third.status}`)

  await appendToEditor('浏览器这边加的第三段。')
  await waitFor(`(() => {
    const d = document.querySelector('[role="dialog"]')
    return d && d.innerText.includes('在别处也被改过') ? 'up' : null
  })()`, 25000, 'the second conflict dialog')
  await clickElement(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes('两边都留'))`,
    '两边都留',
  )

  let copyDoc = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const all = await api('GET', '/api/agent/docs')
    copyDoc = all.json?.items?.find((d) => d.name.includes('（本机版本）'))
    if (copyDoc) break
  }
  check('the local version was archived under a new article', Boolean(copyDoc), JSON.stringify(copyDoc))
  const copyRead = copyDoc ? await api('GET', `/api/agent/docs/${copyDoc.id}`) : null
  check(
    'the archived copy holds the browser text',
    String(copyRead?.json?.content ?? '').includes('浏览器这边加的第三段'),
    String(copyRead?.json?.content ?? '').slice(0, 80),
  )
  check('the copy is an archived draft', Number(copyRead?.json?.savedAt ?? 0) > 0, String(copyRead?.json?.savedAt))
  const canonical = await api('GET', `/api/agent/docs/${cloudDocId}`)
  check('the canonical article kept the third-party text', String(canonical.json?.content ?? '').includes(THIRD_PARTY_TEXT))
  const editorNow = await waitFor(`(() => {
    const t = window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : ''
    return t.includes(${JSON.stringify(THIRD_PARTY_TEXT)}) ? t : null
  })()`, 15000, 'the editor adopting the cloud version')
  check('the editor shows the cloud version after 两边都留', editorNow.includes(THIRD_PARTY_TEXT))

  // ================= the drafts box works off server-side cards =================
  console.log('\n=== 草稿箱 renders server-derived cards, without bodies ===')
  await send('Page.navigate', { url: `${appUrl}drafts` }, sessionId)
  const boxShown = await waitFor(`(() => {
    const items = [...document.querySelectorAll('li')]
    const t = items.map(el => el.innerText).join('\\n')
    return t.includes('云端稿 B') ? t : null
  })()`, 20000, 'the drafts box')
  check('the archived article is listed', boxShown.includes('云端稿 B（本机版本）'), boxShown.slice(0, 200))
  check('its stats came from the server', /\d+ 字/.test(boxShown), boxShown.slice(0, 200))

  // Server-side body search: the term exists in no title.
  await ev(`(() => {
    const input = document.querySelector('input[placeholder="搜标题或正文…"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, '第三方的')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const searchPicked = await waitFor(`(() => {
    const t = [...document.querySelectorAll('li')].map(el => el.innerText).join('\\n')
    if (t.includes('云端稿 B') && !t.includes('（本机版本）')) return t
    return null
  })()`, 15000, 'the content search narrowing the box')
  check('searching the body found the right card', searchPicked.includes('云端稿 B'), searchPicked.slice(0, 160))

  // "打开" hands the id to the editor, which then fetches the body.
  await ev(`(() => {
    const input = document.querySelector('input[placeholder="搜标题或正文…"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(1200)
  await clickElement(
    `[...document.querySelectorAll('li')].find(el => el.innerText.includes('云端稿 B（本机版本）'))?.querySelector('button')`,
    '打开 the archived copy',
  )
  const reopened = await waitFor(`(() => {
    const t = window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : ''
    return t.includes('浏览器这边加的第三段') ? t : null
  })()`, 20000, 'the copy opening in the editor')
  check('打开 a draft lands in the editor with its body', reopened.includes('浏览器这边加的第三段'))

  // ================= a reload changes nothing =================
  console.log('\n=== reload: nothing lost, nothing re-uploaded ===')
  const beforeReload = await api('GET', '/api/agent/docs')
  await send('Page.navigate', { url: appUrl }, sessionId)
  await waitFor(`window.__mopaiCodemirror !== undefined`, 20000, 'the editor after reload')
  await openSwitcher()
  const afterReloadNames = await ev(`JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim()))`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, sessionId)
  check('the working copy is still listed after reload', afterReloadNames.includes('本地稿 A'), afterReloadNames.slice(0, 200))
  check('the archived copy is listed after reload', afterReloadNames.includes('云端稿 B（本机版本）'), afterReloadNames.slice(0, 200))
  const afterReloadDocs = await api('GET', '/api/agent/docs')
  const namesBefore = (beforeReload.json?.items ?? []).map((d) => d.name).sort().join('|')
  const namesAfter = (afterReloadDocs.json?.items ?? []).map((d) => d.name).sort().join('|')
  check('the account has exactly the same articles as before the reload', namesBefore === namesAfter, `${namesBefore} vs ${namesAfter}`)

  void listed
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
