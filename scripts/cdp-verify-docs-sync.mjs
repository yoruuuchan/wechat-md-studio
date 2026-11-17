// Acceptance for the document sync model, in a real browser:
//
//   1. signing in against an account that already has articles keeps the
//      articles this browser wrote while signed out (the old code dropped
//      them), and pushes them up;
//   2. a stale browser save is refused with a conflict dialog while the newer
//      cloud text stays intact, and all three resolution paths behave;
//   3. bodies are fetched on demand — opening a cloud article loads its text,
//      and local-only work stays in IndexedDB throughout;
//   4. after that merge, importing a 205-article bundle pushes only the ids it
//      added, as insert-only batches of 100/100/5, and reports the local and
//      cloud results separately;
//   5. an id the account already uses for different content is never
//      overwritten: the local bundle body is kept, the sync base is not adopted,
//      and the ordinary conflict flow is raised;
//   6. a failed batch stops the run, keeps the unsent articles local with their
//      bodies, and the toast's retry sends only the unfinished ids.
//
// The second writer is a plain agent-API client (the same door a skill script
// uses), which is exactly what "another device" looks like to this app. The
// import checks read the bytes httpBatchLink actually sent (Network domain) and
// break one batch with Fetch interception, so the wiring is proved end to end.
//
// It brings its own in-memory image worker so nothing touches production R2.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 3216)
const WORKER_PORT = APP_PORT + 10
const CDP_PORT = Number(process.argv[3] || 9352)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const origin = appUrl.replace(/\/$/, '')
// Evidence for the bundle-import half of this run: the request bodies actually
// sent, the counts each side proved, and every toast the browser showed. Written
// next to other CDP artefacts instead of into the source tree.
const EVIDENCE_DIR = path.resolve('verify-out/docs-sync')
const evidence = { batches: null, secondReader: null, conflict: null, partial: null, retry: null, toasts: [] }
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

/** The same optimistic-lock token both doors use (api/lib/doc-hash.ts). */
const documentHash = (name, content) =>
  createHash('sha256')
    .update('mopai-document-v2\0', 'utf8')
    .update(name, 'utf8')
    .update('\0', 'utf8')
    .update(content, 'utf8')
    .digest('hex')
    .slice(0, 16)

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

  // ---------- what the browser actually put on the wire ----------
  // The import checks read the real tRPC bodies rather than trusting the UI: the
  // only honest proof of "batches of 100" is the bytes httpBatchLink sent.
  const capture = { imports: [], saves: [] }
  const wire = { phase: 'off', importSeen: 0 }
  const heldRetry = []
  const decodeImportBody = (text) => {
    try {
      const body = JSON.parse(text)
      const entry = body?.['0'] ?? body?.[0] ?? body
      const docs = entry?.json?.docs ?? entry?.docs
      return Array.isArray(docs) ? docs : null
    } catch {
      return null
    }
  }
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Network.requestWillBeSent') {
      const { request, requestId } = message.params
      const record = {
        at: Date.now(),
        requestId,
        url: request.url,
        raw: request.postData ?? '',
        docs: decodeImportBody(request.postData ?? ''),
      }
      if (request.url.includes('docs.importLocal')) {
        capture.imports.push(record)
        // Chrome may omit a large body from the event; ask for it directly so a
        // batch assertion never mistakes an empty payload for "0 docs".
        if (!record.docs && request.hasPostData) {
          send('Network.getRequestPostData', { requestId }, message.sessionId)
            .then((result) => {
              record.raw = result.postData ?? ''
              record.docs = decodeImportBody(record.raw)
            })
            .catch(() => { /* the request may already be gone */ })
        }
      } else if (request.url.includes('docs.save')) {
        capture.saves.push(record)
      }
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const sid = message.sessionId
      if (wire.phase !== 'off' && request.url.includes('docs.importLocal')) {
        wire.importSeen++
        if (wire.phase === 'fail-second' && wire.importSeen === 2) {
          send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }, sid).catch(() => {})
          return
        }
        if (wire.phase === 'hold') {
          // The retry is clicked straight after the failure toast appears; hold
          // its first request until the failure state has been asserted, so the
          // toast's short lifetime never races the checks.
          heldRetry.push({ requestId, sid })
          return
        }
      }
      send('Fetch.continueRequest', { requestId }, sid).catch(() => {})
    }
  })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  // A fresh profile would meet the first-run tour on the editor; this suite
  // drives the app as a returning visitor.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' }, sessionId)
  await send('Runtime.enable', {}, sessionId)
  // The import checks assert on the real request bodies, so the Network domain
  // has to be on before the first import is triggered.
  await send('Network.enable', {}, sessionId)
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
  const cachedBody = (name) => ev(`new Promise((resolve, reject) => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    const mine = index.docs.find(d => d.name === ${JSON.stringify(name)})
    if (!mine) { resolve(null); return }
    const open = indexedDB.open('mopai')
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('bodies', 'readonly').objectStore('bodies').get(mine.id)
      read.onsuccess = () => { resolve(read.result?.content || null); db.close() }
      read.onerror = () => reject(read.error)
    }
    open.onerror = () => reject(open.error)
  })`)
  const appendToEditor = (text) => ev(`(() => {
    const v = window.__mopaiCodemirror
    if (!v) return false
    v.focus()
    v.dispatch({ changes: { from: v.state.doc.length, insert: ${JSON.stringify('\n' + text)} } })
    return true
  })()`)
  const openSwitcher = async () => {
    await sleep(600)
    for (let attempt = 0; attempt < 3; attempt++) {
      await ev(`document.querySelector('[title="切换稿件"]')?.focus()`)
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' }, sessionId)
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, sessionId)
      try {
        await waitFor(`document.querySelector('[role="menu"]') !== null`, 1800, 'the switcher menu')
        return
      } catch {
        await sleep(300)
      }
    }
    throw new Error('the switcher menu never happened')
  }
  /**
   * Switch to a named article through the real switcher menu, by keyboard.
   *
   * A 200+ item import makes the menu scroll; clicking at coordinates measured
   * one render earlier can land on a neighbouring row. Focusing the menu item
   * and pressing Enter is the same path a keyboard user takes and does not
   * depend on where Radix happened to place the list.
   */
  const selectArticle = async (name) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await openSwitcher()
      const focused = await ev(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent.includes(${JSON.stringify(name)}))
        if (!item) return null
        item.focus()
        item.scrollIntoView({ block: 'center' })
        return item.textContent.trim().slice(0, 40)
      })()`)
      if (!focused) {
        await sleep(300)
        continue
      }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId)
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, sessionId)
      await sleep(800)
      const active = await ev(`document.querySelector('input[placeholder="未命名稿件"]')?.value ?? null`)
      if (active === name) return true
    }
    throw new Error(`could not switch to ${name} through the switcher`)
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

  const cached = await cachedBody('本地稿 A')
  check('the signed-out article is in IndexedDB', String(cached).includes(LOCAL_TEXT), String(cached).slice(0, 60))

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

  const stillCached = await cachedBody('本地稿 A')
  check('the local copy is still in IndexedDB after the merge', String(stillCached).includes(LOCAL_TEXT))

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

  // ================= a rename is an edit, even when the body is unchanged =================
  console.log('\n=== renaming an archived article is synced, not lost ===')
  await ev(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, '云端稿 B 改名')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  let renamed = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    renamed = await api('GET', `/api/agent/docs/${cloudDocId}`)
    if (renamed.json?.name === '云端稿 B 改名') break
  }
  check('a name-only edit reaches the account', renamed?.json?.name === '云端稿 B 改名', String(renamed?.json?.name))
  check('the body is unchanged by the rename', String(renamed?.json?.content ?? '').includes(CLOUD_TEXT))

  await send('Page.reload', {}, sessionId)
  await waitFor(`window.__mopaiCodemirror !== undefined`, 20000, 'the editor after the rename reload')
  const renamedAfterReload = await waitFor(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    return input?.value === '云端稿 B 改名' ? input.value : null
  })()`, 20000, 'the renamed title after reload')
  check('reloading does not roll the name back', renamedAfterReload === '云端稿 B 改名')
  await waitFor(`(() => {
    const text = window.__mopaiCodemirror?.state.doc.toString() || ''
    return text.includes(${JSON.stringify(CLOUD_TEXT)}) ? text : null
  })()`, 20000, 'the cloud body after the rename reload')
  await ev(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, '云端稿 B')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    renamed = await api('GET', `/api/agent/docs/${cloudDocId}`)
    if (renamed.json?.name === '云端稿 B') break
  }
  check('the restored title also syncs', renamed?.json?.name === '云端稿 B', String(renamed?.json?.name))

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

  // ======================================================================
  // bundle import after the login merge: only new ids, bounded batches
  // ======================================================================
  // Everything here drives the real 更多 → 导入整包备份 path. The batches are
  // read from the request bodies Network reported; the cloud side is read
  // through the agent door (an independent credential), the local side through
  // the same localStorage index + IndexedDB body store the app writes.
  const waitUntil = async (fn, label, ms = 90000, step = 200) => {
    const deadline = Date.now() + ms
    let last = null
    while (Date.now() < deadline) {
      try {
        last = await fn()
        if (last) return last
      } catch (e) { last = e.message }
      await sleep(step)
    }
    throw new Error(`${label} never happened (last: ${JSON.stringify(last)})`)
  }
  const bundleBase64 = (docs) => Buffer.from(JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    docs,
  })).toString('base64')
  /** The sonner toasts the browser actually showed, kept by a mutation observer. */
  const toastLog = () => ev(`window.__docsSyncToasts || []`)
  const localEntries = (ids) => ev(`(() => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    const byId = new Map(index.docs.map((doc) => [doc.id, doc]))
    return ${JSON.stringify(ids)}.map((id) => {
      const doc = byId.get(id)
      if (!doc) return null
      return {
        id,
        name: doc.name,
        savedAt: doc.savedAt ?? null,
        baseHash: doc.baseHash ?? null,
        contentLoaded: doc.contentLoaded !== false,
      }
    })
  })()`)
  const localBodies = (ids) => ev(`new Promise((resolve, reject) => {
    const request = indexedDB.open('mopai')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const ids = ${JSON.stringify(ids)}
      const store = db.transaction('bodies', 'readonly').objectStore('bodies')
      const out = {}
      let left = ids.length
      for (const id of ids) {
        const read = store.get(id)
        read.onerror = () => { db.close(); reject(read.error) }
        read.onsuccess = () => {
          out[id] = read.result?.content ?? null
          if (--left === 0) { db.close(); resolve(out) }
        }
      }
    }
  })`)
  /** Open 更多 and choose the bundle entry — the real menu, not a synthetic event. */
  const chooseBundleImport = async () => {
    await clickElement(`document.querySelector('[data-topbar-more]')`, '更多')
    await waitFor(`document.querySelector('[data-more-item="import-bundle"]') !== null`, 10000, 'the 更多 menu')
    await clickElement(`document.querySelector('[data-more-item="import-bundle"]')`, 'import-bundle')
    await sleep(250)
  }
  /**
   * Hand the file to the hidden input the menu item opened.
   *
   * Headless Chrome has no native picker, so the same DataTransfer technique as
   * cdp-verify-large-backup.mjs stands in for the OS dialog; the change event
   * then goes through the app's real import handler.
   */
  const handBundleToInput = (base64, fileName) => ev(`(() => {
    const input = document.querySelector('input[type=file]:not([multiple])')
    if (!input) throw new Error('the import file input is missing')
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0))
    const file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'application/json' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    Object.defineProperty(input, 'files', { value: transfer.files, configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return file.size
  })()`)
  const waitForToast = async (needle, label, ms = 90000) => {
    const deadline = Date.now() + ms
    let last = null
    while (Date.now() < deadline) {
      last = await ev(`(() => {
        const needle = ${JSON.stringify(needle)}
        for (const el of document.querySelectorAll('[data-sonner-toast]')) {
          const text = el.innerText
          if (!text.includes(needle)) continue
          const button = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('重试')) || null
          return { text, button: button ? button.textContent.trim() : null }
        }
        return null
      })()`)
      if (last) return last
      await sleep(150)
    }
    throw new Error(`${label} never appeared (last: ${JSON.stringify(last)})`)
  }
  /** Click the retry action inside the toast whose text contains `needle`. */
  const clickToastRetry = async (needle) => {
    const target = await ev(`(() => {
      const needle = ${JSON.stringify(needle)}
      for (const el of document.querySelectorAll('[data-sonner-toast]')) {
        if (!el.innerText.includes(needle)) continue
        const button = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('重试'))
        if (!button) continue
        const rect = button.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const hit = document.elementFromPoint(x, y)
        return { x, y, hit: Boolean(hit && (button === hit || button.contains(hit))) }
      }
      return null
    })()`)
    if (!target || !target.hit) {
      // A toast that animated between measuring and clicking is not a useful
      // target; activate the real button through its own event path instead.
      const fired = await ev(`(() => {
        const needle = ${JSON.stringify(needle)}
        for (const el of document.querySelectorAll('[data-sonner-toast]')) {
          if (!el.innerText.includes(needle)) continue
          const button = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('重试'))
          if (button) { button.click(); return true }
        }
        return false
      })()`)
      if (!fired) throw new Error('the retry action was no longer visible')
      return
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 }, sessionId)
  }

  // A fresh page session after the reload; wait for the merge and the cache to
  // settle before an import is allowed to push.
  await sleep(1500)
  await ev(`(() => {
    window.__docsSyncToasts = []
    const scan = () => {
      for (const el of document.querySelectorAll('[data-sonner-toast]')) {
        const text = el.innerText
        if (text && !window.__docsSyncToasts.some((entry) => entry.text === text)) {
          window.__docsSyncToasts.push({ at: Date.now(), text })
        }
      }
    }
    scan()
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true })
    return true
  })()`)

  // ---------- 1. a 205-article bundle, one reused local id ----------
  console.log('\n=== after the merge, a 205-article import pushes only its new ids ===')
  const bulkIds = Array.from({ length: 205 }, (_, i) => `bulk-bundle-${i}`)
  const bulkDocs = bulkIds.map((id, i) => ({
    id,
    name: `bulk-bundle-${i}`,
    content: `批量导入正文 ${i}\n\nBULK-BODY-${i}`,
    updatedAt: 1_700_000_000_000 + i,
    savedAt: null,
    deletedAt: null,
  }))
  // Inserted in the middle of the bundle: the local library already owns this id,
  // so it must be skipped locally and never offered to the insert-only route.
  const reusedLocalDoc = {
    id: localImported.id,
    name: '本地稿 A 覆盖尝试',
    content: 'BULK-DUPLICATE-BODY 不应该进入任何上传请求',
    updatedAt: 1_700_000_500_000,
    savedAt: null,
    deletedAt: null,
  }
  const bulkBundle = bundleBase64([
    ...bulkDocs.slice(0, 150),
    reusedLocalDoc,
    ...bulkDocs.slice(150),
  ])
  capture.imports.length = 0
  capture.saves.length = 0
  await chooseBundleImport()
  const bulkBytes = await handBundleToInput(bulkBundle, 'bulk-205.json')
  check('the generated 205-article bundle reached the real import input', bulkBytes > 10_000, `${bulkBytes} bytes`)
  const bulkWire = await waitUntil(
    () => {
      const parsed = capture.imports.filter((record) => record.docs)
      return parsed.length >= 3 && parsed.every((record) => record.docs) ? parsed : null
    },
    'the three docs.importLocal requests',
  )
  const bulkSizes = bulkWire.map((record) => record.docs.length)
  check('the import went up as exactly three insert-only batches', JSON.stringify(bulkSizes) === JSON.stringify([100, 100, 5]), JSON.stringify(bulkSizes))
  console.log(`[EVIDENCE] importLocal batches: ${bulkSizes.join(',')}`)
  const uploadedIds = new Set(bulkWire.flatMap((record) => record.docs.map((doc) => doc.id)))
  check('all 205 new ids were uploaded exactly once', uploadedIds.size === 205 && bulkIds.every((id) => uploadedIds.has(id)), `unique ids ${uploadedIds.size}`)
  check(
    'the bundle article reusing 本地稿 A\u2019s id was never uploaded',
    !uploadedIds.has(localImported.id) && !bulkWire.some((record) => record.docs.some((doc) => doc.name === '本地稿 A 覆盖尝试' || String(doc.content).includes('BULK-DUPLICATE-BODY'))),
    `reused id ${localImported.id}`,
  )
  await waitFor(`(() => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    return index.docs.filter((doc) => doc.name.startsWith('bulk-bundle-')).length === 205
  })()`, 60000, 'the 205 imported local index entries')

  // Local side first: the bodies and the working-copy state.
  const bulkEntries = await localEntries(bulkIds)
  check('all 205 imported ids are in the local index', bulkEntries.every(Boolean), `${bulkEntries.filter(Boolean).length}/205`)
  check('the local copies are working copies (savedAt null)', bulkEntries.every((entry) => entry && entry.savedAt === null), JSON.stringify(bulkEntries.find((entry) => entry && entry.savedAt !== null)))
  const bulkBodies = await localBodies(bulkIds)
  const bulkBodyCount = bulkIds.filter((id, i) => String(bulkBodies[id] ?? '').includes(`BULK-BODY-${i}`)).length
  check('all 205 imported bodies are in IndexedDB', bulkBodyCount === 205, `${bulkBodyCount}/205`)
  const bulkSynced = await waitUntil(async () => {
    const entries = await localEntries(bulkIds)
    return entries.every((entry) => entry && entry.baseHash) ? entries : null
  }, 'the server hash to be written back to every imported local row')
  check('every imported local row carries the server hash it was synced against', bulkSynced.every((entry) => typeof entry.baseHash === 'string' && entry.baseHash.length > 0), JSON.stringify(bulkSynced[0]))

  // The account side, read through the agent door (an independent credential).
  const bulkCloud = await waitUntil(async () => {
    const listed = await api('GET', '/api/agent/docs?limit=1&q=bulk-bundle')
    return listed.json?.total === 205 ? listed.json : null
  }, 'the account to hold all 205 imported docs')
  check('the account lists all 205 imported ids', bulkCloud.total === 205, `total ${bulkCloud.total}`)
  let bulkReadable = 0
  let bulkBodiesCloud = 0
  let bulkSavedNull = 0
  for (let i = 0; i < bulkIds.length; i++) {
    const id = bulkIds[i]
    const got = await api('GET', `/api/agent/docs/${id}`)
    if (got.status === 200 && got.json?.id === id) bulkReadable++
    if (String(got.json?.content ?? '').includes(`BULK-BODY-${i}`)) bulkBodiesCloud++
    if (got.json?.savedAt === null) bulkSavedNull++
  }
  check('every imported id reads back through the second reader', bulkReadable === 205, `${bulkReadable}/205`)
  check('every imported body is complete in the account', bulkBodiesCloud === 205, `${bulkBodiesCloud}/205`)
  check('every imported row is a working copy (savedAt null)', bulkSavedNull === 205, `${bulkSavedNull}/205`)
  console.log(`[EVIDENCE] second reader: ${bulkReadable} ids, ${bulkBodiesCloud} bodies, savedAt null ${bulkSavedNull}`)
  evidence.batches = { sizes: bulkSizes, uploaded: uploadedIds.size, reusedIdExcluded: !uploadedIds.has(localImported.id) }
  evidence.secondReader = { ids: bulkReadable, bodies: bulkBodiesCloud, savedAtNull: bulkSavedNull }

  // The pre-existing article keeps both sides exactly as they were.
  const localA = await cachedBody('本地稿 A')
  check(
    '本地稿 A keeps its own local body after the import',
    String(localA).includes(LOCAL_TEXT) && !String(localA).includes('BULK-DUPLICATE-BODY'),
    String(localA).slice(0, 60),
  )
  const localAEntry = (await localEntries([localImported.id]))[0]
  check('本地稿 A keeps its name in the local index', localAEntry?.name === '本地稿 A', String(localAEntry?.name))
  const localACloud = await api('GET', `/api/agent/docs/${localImported.id}`)
  check(
    '本地稿 A keeps its cloud row (name and body unchanged)',
    localACloud.status === 200 && localACloud.json?.name === '本地稿 A' && String(localACloud.json?.content ?? '').includes(LOCAL_TEXT),
    JSON.stringify({ status: localACloud.status, name: localACloud.json?.name }),
  )

  // The two sonner toasts report the two halves separately.
  await waitUntil(async () => {
    const log = await toastLog()
    return log.some((entry) => entry.text.includes('已导入 205 篇稿件')) && log.some((entry) => entry.text.includes('云端已收下 205 篇工作稿'))
      ? log
      : null
  }, 'the separate local and cloud import toasts')

  // ---------- 2. a same-id server row is never overwritten ----------
  console.log('\n=== a same-id server row with different content becomes a conflict ===')
  const conflictId = `conflict-doc-${Date.now().toString(36)}`
  const conflictName = `冲突稿 ${conflictId}`
  const SERVER_SEED_TEXT = `SERVER-SEED-BODY ${conflictId}`
  const LOCAL_BUNDLE_TEXT = `LOCAL-BUNDLE-BODY ${conflictId}`
  const seedBody = JSON.stringify({
    0: { json: { docs: [{ id: conflictId, name: conflictName, content: SERVER_SEED_TEXT, updatedAt: Date.now(), baseHash: null }] } },
  })
  const seedReply = await ev(`fetch('/api/trpc/docs.importLocal?batch=1', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: ${JSON.stringify(seedBody)},
  }).then((response) => response.text())`)
  let seedParsed = null
  try {
    const parsed = JSON.parse(seedReply)
    seedParsed = Array.isArray(parsed) ? parsed[0]?.result?.data?.json : parsed?.result?.data?.json
  } catch { /* reported below */ }
  check(
    'a server-only row for the chosen id was seeded through the real route',
    seedParsed?.imported === 1 && Boolean(seedParsed?.hashes?.[conflictId]),
    String(seedReply).slice(0, 160),
  )
  const serverSeed = await api('GET', `/api/agent/docs/${conflictId}`)
  const serverSeedHash = serverSeed.json?.hash
  check(
    'the server owns a different body for that id',
    serverSeed.status === 200 && serverSeed.json?.content === SERVER_SEED_TEXT,
    String(serverSeed.json?.content ?? '').slice(0, 60),
  )

  capture.imports.length = 0
  await chooseBundleImport()
  await handBundleToInput(bundleBase64([{
    id: conflictId,
    name: conflictName,
    content: LOCAL_BUNDLE_TEXT,
    updatedAt: Date.now(),
    savedAt: null,
    deletedAt: null,
  }]), 'conflict.json')
  const conflictWire = await waitUntil(() => {
    const record = capture.imports.find((entry) => entry.docs?.some((doc) => doc.id === conflictId))
    return record || null
  }, 'the conflict id upload request')
  check('the conflict id was offered to the insert-only route', conflictWire.docs.some((doc) => doc.id === conflictId))
  const conflictEntry = await waitUntil(async () => {
    const [entry] = await localEntries([conflictId])
    return entry && entry.name === conflictName ? entry : null
  }, 'the conflict article in the local index')
  check('the local copy exists as a working copy (savedAt null)', conflictEntry.savedAt === null, String(conflictEntry.savedAt))
  check('the local copy is not marked synced (no baseHash)', !conflictEntry.baseHash, String(conflictEntry.baseHash))
  const conflictBodies = await localBodies([conflictId])
  check('the bundle body for the conflict id was kept locally', String(conflictBodies[conflictId] ?? '').includes(LOCAL_BUNDLE_TEXT), String(conflictBodies[conflictId]).slice(0, 60))
  await waitUntil(async () => {
    const log = await toastLog()
    return log.some((entry) => entry.text.includes('同 id 的不同内容') && entry.text.includes('没有覆盖')) ? log : null
  }, 'the same-id conflict toast')

  // Opening the article must raise the app's existing conflict model.
  await selectArticle(conflictName)
  const conflictUi = await waitFor(`(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog && dialog.innerText.includes('在别处也被改过')) return { kind: 'dialog', text: dialog.innerText }
    const bar = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('在别处也被改过'))
    if (bar) return { kind: 'bar', text: bar.innerText }
    return null
  })()`, 20000, 'the conflict dialog or bar for the imported article')
  check('opening the article raises the existing conflict model', Boolean(conflictUi), conflictUi?.kind ?? 'none')
  if (conflictUi?.kind === 'dialog') {
    check('the conflict dialog previews the server body', conflictUi.text.includes(SERVER_SEED_TEXT.slice(0, 24)), conflictUi.text.slice(0, 160))
  }

  // Give autosave every chance to fire; the server row must not move.
  await sleep(3500)
  const serverAfterConflict = await api('GET', `/api/agent/docs/${conflictId}`)
  check(
    'the server row is untouched (no overwrite, not even by autosave)',
    serverAfterConflict.status === 200 && serverAfterConflict.json?.content === SERVER_SEED_TEXT,
    String(serverAfterConflict.json?.content ?? '').slice(0, 60),
  )
  const conflictSaveSent = capture.saves.some((record) => String(record.raw ?? '').includes(conflictId))
  check('no docs.save request carried the conflicting id', !conflictSaveSent)
  const conflictBodiesAfter = await localBodies([conflictId])
  check('the local body is still the bundle version after the wait', String(conflictBodiesAfter[conflictId] ?? '').includes(LOCAL_BUNDLE_TEXT))
  const localConflictHash = documentHash(conflictName, LOCAL_BUNDLE_TEXT)
  console.log(`[EVIDENCE] conflict id/server hash/local hash: ${conflictId}/${serverSeedHash}/${localConflictHash}`)
  check('the two hashes prove the versions differ', Boolean(serverSeedHash) && serverSeedHash !== localConflictHash, `${serverSeedHash} vs ${localConflictHash}`)
  evidence.conflict = { id: conflictId, serverHash: serverSeedHash, localHash: localConflictHash, ui: conflictUi?.kind ?? null, toast: true }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, sessionId)
  await sleep(300)

  // ---------- 3. a mid-run batch failure stays local, then retries ----------
  console.log('\n=== a failed batch keeps the unsent articles local and the retry sends only those ===')
  const retryIds = Array.from({ length: 205 }, (_, i) => `retry-bundle-${i}`)
  const retryDocs = retryIds.map((id, i) => ({
    id,
    name: `retry-bundle-${i}`,
    content: `补传正文 ${i}\n\nRETRY-BODY-${i}`,
    updatedAt: 1_700_100_000_000 + i,
    savedAt: null,
    deletedAt: null,
  }))
  capture.imports.length = 0
  capture.saves.length = 0
  wire.phase = 'fail-second'
  wire.importSeen = 0
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/trpc/*` }] }, sessionId)
  await chooseBundleImport()
  const retryBytes = await handBundleToInput(bundleBase64(retryDocs), 'retry-205.json')
  check('the second 205-article bundle reached the real import input', retryBytes > 10_000, `${retryBytes} bytes`)
  const partialToast = await waitForToast('没传上去', 'the honest partial-failure toast')
  check('the partial toast exposes a retry action', partialToast.button !== null, partialToast.button)
  check(
    'the visible result says how much did and did not reach the account',
    partialToast.text.includes('云端只完成') && partialToast.text.includes('100') && partialToast.text.includes('105'),
    partialToast.text.replace(/\s+/g, ' ').slice(0, 200),
  )
  const partialToastText = partialToast.text

  // Click the retry immediately (the toast lives only a few seconds); its first
  // request is held by Fetch so the failure state can be asserted first.
  wire.phase = 'hold'
  wire.importSeen = 0
  capture.imports.length = 0
  await clickToastRetry('没传上去')
  await waitUntil(() => {
    const held = capture.imports.filter((record) => record.docs)
    return held.length >= 1 ? held : null
  }, 'the first held retry request')

  const partialCloud = await waitUntil(async () => {
    const listed = await api('GET', '/api/agent/docs?limit=1&q=retry-bundle')
    return listed.json?.total === 100 ? listed.json : null
  }, 'the account to hold exactly the first batch', 30000, 100)
  check('exactly the first batch reached the account before the retry', partialCloud.total === 100, `total ${partialCloud.total}`)
  const failedProbe = await api('GET', '/api/agent/docs/retry-bundle-150')
  const unsentProbe = await api('GET', '/api/agent/docs/retry-bundle-202')
  check('the failed and the never-sent batches are not in the cloud', failedProbe.status === 404 && unsentProbe.status === 404, `${failedProbe.status}/${unsentProbe.status}`)
  const retryEntries = await waitUntil(async () => {
    const entries = await localEntries(retryIds)
    return entries.every((entry) => entry && entry.name) ? entries : null
  }, 'all 205 retry articles in the local index')
  const failedEntries = retryEntries.slice(100)
  check('the 100 acknowledged local copies carry the server base hash', retryEntries.slice(0, 100).every((entry) => Boolean(entry.baseHash)), JSON.stringify(retryEntries.slice(0, 100).find((entry) => !entry.baseHash)))
  check('the 105 unsent local copies are not marked synced (no baseHash)', failedEntries.every((entry) => !entry.baseHash), JSON.stringify(failedEntries[0]))
  check('all 205 retry copies are still working copies (savedAt null)', retryEntries.every((entry) => entry.savedAt === null), JSON.stringify(retryEntries.find((entry) => entry.savedAt !== null)))
  const retryLocalBodies = await localBodies(retryIds)
  const failedBodiesKept = retryIds.slice(100).filter((id, k) => String(retryLocalBodies[id] ?? '').includes(`RETRY-BODY-${100 + k}`)).length
  check('all 105 unsent articles keep complete bodies locally', failedBodiesKept === 105, `${failedBodiesKept}/105`)

  // Release the held retry batch; the second one follows and both are recorded.
  wire.phase = 'retry'
  for (const item of heldRetry.splice(0)) {
    await send('Fetch.continueRequest', { requestId: item.requestId }, item.sid).catch(() => {})
  }
  const retryWire = await waitUntil(() => {
    const parsed = capture.imports.filter((record) => record.docs)
    return parsed.length >= 2 ? parsed : null
  }, 'both retry import requests', 60000, 200)
  const retrySizes = retryWire.map((record) => record.docs.length)
  check('the retry sends only the unfinished 105, as 100 + 5', JSON.stringify(retrySizes) === JSON.stringify([100, 5]), JSON.stringify(retrySizes))
  console.log(`[EVIDENCE] retry batches: ${retrySizes.join(',')}`)
  const retriedIds = new Set(retryWire.flatMap((record) => record.docs.map((doc) => doc.id)))
  check(
    'the retry covers exactly the 105 unseen ids and nothing already synced',
    retriedIds.size === 105 && retryIds.slice(100).every((id) => retriedIds.has(id)) && retryIds.slice(0, 100).every((id) => !retriedIds.has(id)),
    `unique ids ${retriedIds.size}`,
  )
  const retryCloud = await waitUntil(async () => {
    const listed = await api('GET', '/api/agent/docs?limit=1&q=retry-bundle')
    return listed.json?.total === 205 ? listed.json : null
  }, 'the account to hold all 205 retried docs')
  check('all 205 retried docs are in the account', retryCloud.total === 205, `total ${retryCloud.total}`)
  await waitUntil(async () => {
    const log = await toastLog()
    return log.some((entry) => entry.text.includes('补传完成') && entry.text.includes('105')) ? log : null
  }, 'the retry-success toast')
  let retriedReadable = 0
  let retriedBodies = 0
  let retriedSavedNull = 0
  for (let i = 0; i < retryIds.length; i++) {
    const id = retryIds[i]
    const got = await api('GET', `/api/agent/docs/${id}`)
    if (got.status === 200 && got.json?.id === id) retriedReadable++
    if (String(got.json?.content ?? '').includes(`RETRY-BODY-${i}`)) retriedBodies++
    if (got.json?.savedAt === null) retriedSavedNull++
  }
  check('all 205 retried ids read back with complete bodies', retriedReadable === 205 && retriedBodies === 205, `${retriedReadable} ids / ${retriedBodies} bodies`)
  check('all 205 retried rows are working copies (savedAt null)', retriedSavedNull === 205, `${retriedSavedNull}/205`)
  evidence.partial = {
    cloudBeforeRetry: partialCloud.total,
    failedProbes: { failed: failedProbe.status, neverSent: unsentProbe.status },
    localBodiesKept: failedBodiesKept,
    toast: partialToastText,
  }
  evidence.retry = { sizes: retrySizes, cloud: retryCloud.total, readable: retriedReadable, bodies: retriedBodies }
  wire.phase = 'off'
  await send('Fetch.disable', {}, sessionId)
  evidence.toasts = await toastLog()

  void listed
} catch (e) {
  failures++
  console.error('\nACCEPTANCE ERROR:', e.message)
  if (appLog) console.error('--- app log tail ---\n' + appLog.slice(-1200))
} finally {
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'bundle-import.json'),
      JSON.stringify({ failures, ...evidence }, null, 2),
    )
  } catch { /* evidence is a bonus, not the test */ }
  try { chrome?.kill() } catch { /* already gone */ }
  try { app.kill() } catch { /* already gone */ }
  worker.close()
  try { fs.rmSync(DB_FILE, { force: true }) } catch { /* leave it */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
