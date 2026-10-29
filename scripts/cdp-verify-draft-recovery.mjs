// Browser acceptance for deleting and restoring an article that is not in the
// account yet (R01).
//
// Usage: node scripts/cdp-verify-draft-recovery.mjs [appPort] [cdpPort]
//   appPort defaults to 4101; the inert image worker listens on appPort + 100
//   (4201) and the CDP port defaults to 9701. The SQLite file is private to this
//   suite (data/audit-r01.db) and is deleted before the run.
//
// The bug: with a session, `removeDoc` only called the cloud `remove`, so a new
// article that had never been pushed (created after the login merge, or never
// saved to the drafts box) was dropped from the local index and its body from
// IndexedDB. The undo toast then called the cloud `restore`, got `doc:
// undefined` back and still reported 「已恢复」.
//
// Covered here, through a real Chrome and a production build:
//   A. signed out: new article -> delete -> undo; delete -> wait out the undo
//      window -> restore from the bin; delete -> reload -> restore; purge.
//   B. signed in: the same new-article flow, plus the check that the article
//      really never reached the account;
//   C. an article that lives in the account: delete -> undo, bin restore,
//      and two fault injections (remove / restore) that must not lose the only
//      local copy nor claim a restore that did not happen.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 4101)
const WORKER_PORT = APP_PORT + 100
const CDP_PORT = Number(process.argv[3] || 9701)
const APP = `http://127.0.0.1:${APP_PORT}`
const DB_FILE = path.resolve('data/audit-r01.db')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const ACCESS_KEY = 'audit-r01-owner-key-20261028'
const ADMIN_KEY = 'audit-r01-image-admin-key-7f3c'
const SESSION_SECRET = 'audit-r01-session-secret-4b8e6c1d2a5f7e9b'
const AGENT_TOKEN = 'mopai_r01_acceptance_token'

const SIGNED_OUT_NAME = 'R01 登录前新稿'
const SIGNED_OUT_TEXT = 'SIGNED_OUT_ONLY_BODY_R01 must survive delete and undo.'
const SIGNED_IN_NAME = 'R01 登录后新稿'
const SIGNED_IN_TEXT = 'SIGNED_IN_ONLY_BODY_R01 must survive delete and undo.'
const SIGNED_IN_RELOAD_NAME = 'R01 登录后新稿 · 刷新'
const SIGNED_IN_RELOAD_TEXT = 'SIGNED_IN_RELOAD_BODY_R01 must survive a reload.'
const SIGNED_IN_PURGE_NAME = 'R01 登录后新稿 · 彻底删除'
const SIGNED_IN_PURGE_TEXT = 'SIGNED_IN_PURGE_BODY_R01 must be purged for good.'
const SIGNED_IN_FAIL_NAME = 'R01 登录后新稿 · 删除失败'
const SIGNED_IN_FAIL_TEXT = 'SIGNED_IN_FAILED_REMOVE_BODY_R01 is the only copy.'
const CLOUD_NAME = 'R01 云端稿'
const CLOUD_TEXT = 'CLOUD_ARTICLE_BODY_R01 must come back from the account bin.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}
const section = (title) => console.log(`\n=== ${title} ===`)

if (!fs.existsSync('dist/boot.js')) {
  console.error('dist/boot.js is missing; run `npm run build` first.')
  process.exit(1)
}
if (!fs.existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}`)
  process.exit(1)
}

// ---------- inert image worker (production boot requires the image envs) ----------
const worker = http.createServer((_req, res) => {
  res.writeHead(404).end('no route')
})
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// ---------- app on a database that belongs to this suite ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${suffix}`, { force: true })
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/audit-r01.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET,
    // Read-only view of the account for the assertions; the browser never sees it.
    AGENT_TOKENS: `r01-probe:${AGENT_TOKEN}`,
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
      const r = await fetch(APP, { redirect: 'manual' })
      if (r.status < 500) return
    } catch {
      /* not listening yet */
    }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP}\n${appLog.slice(-800)}`)
}

async function agent(method, urlPath) {
  const res = await fetch(`${APP}${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${AGENT_TOKEN}` },
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text }
}

// ---------- Chrome + CDP ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'r01-draft-recovery-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    '--window-size=1600,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
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
      }, 60000)
    })
}

let send
let sessionId
let ws
const pageErrors = []

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

async function waitFor(expression, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if (await evaluate(expression)) return true
    } catch {
      /* navigation in flight */
    }
    await sleep(150)
  }
  return false
}

/** Real mouse click at the centre of an element — Radix menus need pointer events. */
async function clickElement(elementExpression, label) {
  const coord = await evaluate(`(() => {
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

const editorText = () =>
  evaluate(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : null`)

/** Replace the whole editor document through the real CodeMirror state. */
async function setEditorText(text) {
  const ok = await evaluate(`(() => {
    const view = window.__mopaiCodemirror
    if (!view) return false
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } })
    return true
  })()`)
  if (!ok) throw new Error('the editor is not mounted')
  await sleep(400)
}

async function rename(name) {
  const ok = await evaluate(`(() => {
    const input = document.querySelector('input[placeholder="未命名稿件"]')
    if (!input) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(name)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  if (!ok) throw new Error('the name input is not there')
  await sleep(250)
}

const docName = () => evaluate(`document.querySelector('input[placeholder="未命名稿件"]')?.value ?? null`)

async function openSwitcher() {
  // A previous step may have left the menu open (the delete button stops the
  // click from selecting the row); close it before opening again.
  if (await evaluate(`document.querySelector('[role="menu"]') !== null`)) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, sessionId)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, sessionId)
    await sleep(250)
    await waitFor(`document.querySelector('[role="menu"]') === null`, 3000)
  }
  await clickElement(`document.querySelector('[title="切换稿件"]')`, 'the article switcher')
  if (!(await waitFor(`document.querySelector('[role="menu"]') !== null`, 5000))) {
    throw new Error('the switcher menu never opened')
  }
}

async function clickMenuItem(text, label) {
  await clickElement(
    `[...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes(${JSON.stringify(text)})) ?? null`,
    label,
  )
}

/** Create a fresh article through the switcher and return its id. */
async function createArticle(name, text) {
  await openSwitcher()
  await clickMenuItem('新建稿件', '新建稿件')
  await sleep(500)
  await rename(name)
  await setEditorText(text)
  await sleep(900)
  const id = await evaluate(`(() => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    return index.docs.find(d => d.name === ${JSON.stringify(name)})?.id ?? null
  })()`)
  if (!id) throw new Error(`the new article ${name} was not written to the local index`)
  return id
}

/** Delete one named article from the switcher menu (no confirm by design). */
async function deleteArticle(name) {
  await openSwitcher()
  await clickElement(
    `(() => {
      const rows = [...document.querySelectorAll('[role="menuitem"]')]
      const row = rows.find(e => e.textContent.includes(${JSON.stringify(name)}))
      return row ? row.querySelector('button[title="删除这篇稿件"]') : null
    })()`,
    `the delete button of ${name}`,
  )
  await sleep(600)
}

const toastTexts = () =>
  evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(e => e.innerText)`)

async function clickUndo() {
  const ok = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-sonner-toast] button')]
    const undo = buttons.find(b => b.innerText.trim() === '撤销')
    if (!undo) return false
    undo.click()
    return true
  })()`)
  await sleep(800)
  return ok
}

async function openArticle(name) {
  await openSwitcher()
  await clickMenuItem(name, `${name} in the switcher`)
  await sleep(900)
}

/**
 * Cloud-state expression for "the session/merge has settled".
 *
 * U01 replaced the old sync chip (span[title]) with SaveStatus, which exposes
 * data-cloud-state on the active article. Signed out settles on "signed-out";
 * signed in settles on any state except "loading"/"signed-out".
 */
const cloudSettledExpr = (signedIn) =>
  signedIn
    ? `(() => { const el = document.querySelector('[data-save-status]'); return !!el && el.dataset.cloudState !== 'loading' && el.dataset.cloudState !== 'signed-out' })()`
    : `(document.querySelector('[data-save-status]')?.dataset.cloudState === 'signed-out')`

/**
 * Open the editor and wait until it is usable. `signedIn` matters: on a signed-in
 * reload the session resolves a moment after first paint, and the save status
 * shows the signed-out state in between — waiting for that would race the login
 * merge and look at an incomplete article list.
 */
async function goEditor({ signedIn = false } = {}) {
  await send('Page.navigate', { url: `${APP}/` }, sessionId)
  if (!(await waitFor(`!!document.querySelector('.cm-content')`, 20000))) throw new Error('the editor never mounted')
  await waitFor(`window.__mopaiCodemirror !== undefined`, 10000)
  await waitFor(`(document.querySelector('input[placeholder="未命名稿件"]')?.value ?? '') !== ''`, 20000)
  await waitFor(cloudSettledExpr(signedIn), 20000)
  await sleep(300)
}

async function goDrafts() {
  await send('Page.navigate', { url: `${APP}/drafts` }, sessionId)
  if (!(await waitFor(`document.body.innerText.includes('草稿箱')`, 20000))) {
    throw new Error('the drafts page never mounted')
  }
  await sleep(900)
}

/** Click 恢复 in the bin row for `name`. */
async function restoreFromBin(name) {
  const clicked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('li')].filter(li => li.innerText.includes(${JSON.stringify(name)}))
    for (const row of rows) {
      const btn = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '恢复')
      if (btn) { btn.click(); return true }
    }
    return false
  })()`)
  await sleep(900)
  return clicked
}

/** Click 彻底删除 in the bin row for `name`, with window.confirm stubbed. */
async function purgeFromBin(name) {
  await evaluate(`window.__r01Confirmed = null; window.confirm = (m) => { window.__r01Confirmed = m; return true }; 'ok'`)
  const clicked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('li')].filter(li => li.innerText.includes(${JSON.stringify(name)}))
    for (const row of rows) {
      const btn = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '彻底删除')
      if (btn) { btn.click(); return true }
    }
    return false
  })()`)
  await sleep(900)
  return clicked
}

const indexEntryByName = (name) =>
  evaluate(`(() => {
    try {
      const raw = localStorage.getItem('mopai.index.v2')
      if (!raw) return null
      return JSON.parse(raw).docs.find(d => d.name === ${JSON.stringify(name)}) ?? null
    } catch { return null }
  })()`)

const indexEntryById = (id) =>
  evaluate(`(() => {
    try {
      const raw = localStorage.getItem('mopai.index.v2')
      if (!raw) return null
      return JSON.parse(raw).docs.find(d => d.id === ${JSON.stringify(id)}) ?? null
    } catch { return null }
  })()`)

const bodyInDb = (id) =>
  evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      // Open the current version: body-store raises it to 2 as a write barrier,
      // and asking for 1 on an already-migrated profile throws VersionError.
      // A fresh profile still gets upgraded here, which keeps the seed readable.
      const request = indexedDB.open('mopai')
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('bodies')) request.result.createObjectStore('bodies', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const row = await new Promise((resolve, reject) => {
      const request = db.transaction('bodies', 'readonly').objectStore('bodies').get(${JSON.stringify(id)})
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return row ? row.content : null
  })()`)

/** Purge/removal is written by the queued local save, so give it a moment. */
async function bodyGone(id) {
  for (let i = 0; i < 24; i++) {
    if ((await bodyInDb(id)) === null) return true
    await sleep(250)
  }
  return false
}

/** Look for the article in the account by exact name (agent/draft door). */
async function accountDoc(name) {
  for (let i = 0; i < 12; i++) {
    const res = await agent('GET', '/api/agent/docs?limit=200')
    const hit = res.json?.items?.find((d) => d.name === name)
    if (hit) return hit
    await sleep(250)
  }
  return null
}

async function accountDocGone(name) {
  for (let i = 0; i < 12; i++) {
    const res = await agent('GET', '/api/agent/docs?limit=200')
    if (!res.json?.items?.some((d) => d.name === name)) return true
    await sleep(250)
  }
  return false
}

/** Make one tRPC procedure fail at the browser's fetch layer. */
async function blockProcedure(procedure) {
  return evaluate(`(() => {
    if (!window.__r01NativeFetch) window.__r01NativeFetch = window.fetch
    window.__r01Blocked = window.__r01Blocked || []
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const method = ((init && init.method) || 'GET').toUpperCase()
      if (method === 'POST' && url.includes('/api/trpc/${procedure}')) {
        window.__r01Blocked.push(${JSON.stringify(procedure)})
        return Promise.reject(new TypeError('R01 simulated network failure: ${procedure}'))
      }
      return window.__r01NativeFetch(input, init)
    }
    return true
  })()`)
}

async function unblockProcedures() {
  await evaluate(`(() => {
    if (window.__r01NativeFetch) { window.fetch = window.__r01NativeFetch; window.__r01NativeFetch = null }
    return true
  })()`)
}

const blockedProcedures = () => evaluate(`JSON.stringify(window.__r01Blocked || [])`)

const hasToast = (text) => evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].some(e => e.innerText.includes(${JSON.stringify(text)}))`)

/** True once the login merge has settled: the save status has left loading/signed-out. */
const mergeSettled = () => evaluate(cloudSettledExpr(true))

const isLive = (name) =>
  evaluate(`(() => {
    try {
      const raw = localStorage.getItem('mopai.index.v2')
      if (!raw) return false
      return JSON.parse(raw).docs.some(d => d.name === ${JSON.stringify(name)} && !d.deletedAt)
    } catch { return false }
  })()`)

/** True once the named article is open with exactly this body. */
const editorShows = (name, text) =>
  waitFor(
    `(() => {
      const input = document.querySelector('input[placeholder="未命名稿件"]')
      const view = window.__mopaiCodemirror
      return input?.value === ${JSON.stringify(name)} && view && view.state.doc.toString() === ${JSON.stringify(text)}
    })()`,
    10000,
  )

try {
  await waitUp()
  ws = new WebSocket(await wsUrl())
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  send = makeClient(ws)
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || 'unknown')
  })
  const target = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }))
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  // A fresh profile would meet the first-run tour; this suite drives a returning visitor.
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' },
    sessionId,
  )

  // ================= A. signed out =================
  section('signed out: a new article, delete, immediate undo')
  await goEditor()
  const signedOutId = await createArticle(SIGNED_OUT_NAME, SIGNED_OUT_TEXT)
  const outEntry = await indexEntryById(signedOutId)
  check('the new article is local-only (no savedAt, no cloud hash)', outEntry && outEntry.savedAt === null && !outEntry.baseHash, JSON.stringify(outEntry))
  check('its body is in IndexedDB', (await bodyInDb(signedOutId)) === SIGNED_OUT_TEXT, String(await bodyInDb(signedOutId)).slice(0, 60))

  await deleteArticle(SIGNED_OUT_NAME)
  check('the delete toast is shown', await hasToast('已移入回收站'))
  check('undo is offered', (await toastTexts()).some((text) => text.includes('撤销')))
  const outUndoClicked = await clickUndo()
  check('undo was clicked', outUndoClicked)
  check('the article and its body are back in the editor', await editorShows(SIGNED_OUT_NAME, SIGNED_OUT_TEXT))
  const outBack = await indexEntryById(signedOutId)
  check('the index records it live again', outBack && outBack.deletedAt === null, JSON.stringify(outBack))

  section('signed out: after the undo window the bin still has it')
  await deleteArticle(SIGNED_OUT_NAME)
  await sleep(11000)
  check('the undo toast is gone', !(await hasToast('撤销')))
  await goDrafts()
  const outBinHasIt = await evaluate(`document.body.innerText.includes(${JSON.stringify(SIGNED_OUT_NAME)})`)
  check('the bin lists the deleted article', outBinHasIt)
  check('restore from the bin works', await restoreFromBin(SIGNED_OUT_NAME))
  const outRestored = await indexEntryById(signedOutId)
  check('the restored record is live', outRestored && outRestored.deletedAt === null, JSON.stringify(outRestored))
  check('the restored body is intact', (await bodyInDb(signedOutId)) === SIGNED_OUT_TEXT)
  await goEditor()
  await openArticle(SIGNED_OUT_NAME)
  check('the restored article opens with its name', (await docName()) === SIGNED_OUT_NAME, String(await docName()))
  check('the restored article opens with its body', (await editorText()) === SIGNED_OUT_TEXT, String(await editorText()).slice(0, 60))

  section('signed out: a reload keeps the trashed article recoverable')
  await deleteArticle(SIGNED_OUT_NAME)
  await sleep(600)
  await goEditor() // a full reload of the editor
  const outAfterReload = await indexEntryById(signedOutId)
  check('the reload kept the article in the local bin', outAfterReload && outAfterReload.deletedAt !== null, JSON.stringify(outAfterReload))
  await goDrafts()
  check('the bin still lists it after the reload', await evaluate(`document.body.innerText.includes(${JSON.stringify(SIGNED_OUT_NAME)})`))
  check('it restores after the reload', await restoreFromBin(SIGNED_OUT_NAME))
  check('the body survived the reload', (await bodyInDb(signedOutId)) === SIGNED_OUT_TEXT)

  section('signed out: permanent delete still removes it for good')
  await goEditor()
  await deleteArticle(SIGNED_OUT_NAME)
  await sleep(600)
  await goDrafts()
  check('the bin row is there to purge', await evaluate(`document.body.innerText.includes(${JSON.stringify(SIGNED_OUT_NAME)})`))
  check('purge was clicked', await purgeFromBin(SIGNED_OUT_NAME))
  check('purge asks first', String(await evaluate(`window.__r01Confirmed`)).includes('彻底删除'))
  const outPurgedEntry = await indexEntryById(signedOutId)
  check('the purged article is gone from the local index', outPurgedEntry === null, JSON.stringify(outPurgedEntry))
  check('the purged article has no body left', await bodyGone(signedOutId))
  await goDrafts()
  check('a reload does not bring the purged article back to the bin', !(await evaluate(`document.body.innerText.includes(${JSON.stringify(SIGNED_OUT_NAME)})`)))

  // ================= B. signed in =================
  section('signed in: a new article that is not in the account')
  // Still anonymous here; the login page comes next.
  await goEditor()
  await send('Page.navigate', { url: `${APP}/login` }, sessionId)
  if (!(await waitFor(`!!document.querySelector('input[type=password]')`, 15000))) throw new Error('the login form never mounted')
  await evaluate(`(async () => {
    const input = document.querySelector('input[type=password]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(ACCESS_KEY)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    document.querySelector('button[type=submit]').click()
    return true
  })()`)
  if (!(await waitFor(`!!document.querySelector('input[placeholder="未命名稿件"]')`, 20000))) {
    throw new Error('the editor never mounted after login')
  }
  // Wait for the login merge, not just the first paint: the article created
  // next has to be written *after* the merge to stay local-only.
  if (!(await waitFor(cloudSettledExpr(true), 25000))) {
    throw new Error('the login merge never settled')
  }
  await sleep(500)
  check(
    'the session is active',
    await evaluate(`![...document.querySelectorAll('button')].some(b => b.innerText.trim() === '登录')`),
    '',
  )

  const signedInId = await createArticle(SIGNED_IN_NAME, SIGNED_IN_TEXT)
  const inEntry = await indexEntryById(signedInId)
  check('the signed-in article is local-only', inEntry && inEntry.savedAt === null && !inEntry.baseHash, JSON.stringify(inEntry))
  check('it did not reach the account', (await accountDoc(SIGNED_IN_NAME)) === null)

  await deleteArticle(SIGNED_IN_NAME)
  check('the delete toast is shown', await hasToast('已移入回收站'))
  const inUndoClicked = await clickUndo()
  check('undo was clicked', inUndoClicked)
  check('the article and its only body are back in the editor', await editorShows(SIGNED_IN_NAME, SIGNED_IN_TEXT))
  const inBack = await indexEntryById(signedInId)
  check('the index records it live again', inBack && inBack.deletedAt === null, JSON.stringify(inBack))

  section('signed in: after the undo window the bin still has it')
  await deleteArticle(SIGNED_IN_NAME)
  await sleep(11000)
  check('the undo toast is gone', !(await hasToast('撤销')))
  await goDrafts()
  check('the bin lists the local-only article while signed in', await evaluate(`document.body.innerText.includes(${JSON.stringify(SIGNED_IN_NAME)})`))
  check('restore from the bin works', await restoreFromBin(SIGNED_IN_NAME))
  const inRestored = await indexEntryById(signedInId)
  check('the restored record is live', inRestored && inRestored.deletedAt === null, JSON.stringify(inRestored))
  check('the restored body is intact', (await bodyInDb(signedInId)) === SIGNED_IN_TEXT)
  await goEditor({ signedIn: true })
  await openArticle(SIGNED_IN_NAME)
  check('the restored article opens with its name', (await docName()) === SIGNED_IN_NAME, String(await docName()))
  check('the restored article opens with its body', (await editorText()) === SIGNED_IN_TEXT, String(await editorText()).slice(0, 60))

  section('signed in: a failed remove keeps the only local copy')
  const failId = await createArticle(SIGNED_IN_FAIL_NAME, SIGNED_IN_FAIL_TEXT)
  await blockProcedure('docs.remove')
  await deleteArticle(SIGNED_IN_FAIL_NAME)
  check('the failed remove is reported', await hasToast('没同步到云端'), (await toastTexts()).join(' | '))
  check('the browser tried to delete it in the account', JSON.parse(await blockedProcedures()).includes('docs.remove'))
  const failEntry = await indexEntryById(failId)
  check('the only copy stayed in the local bin', failEntry && failEntry.deletedAt !== null, JSON.stringify(failEntry))
  await unblockProcedures()
  check('undo is still offered', await clickUndo())
  check('undo brings the only copy back without the network', await editorShows(SIGNED_IN_FAIL_NAME, SIGNED_IN_FAIL_TEXT))
  check('the local bin no longer holds a copy', await isLive(SIGNED_IN_FAIL_NAME))

  section('signed in: a reload keeps a local-only article recoverable')
  // A fresh article: the one restored above was picked up by the login merge
  // when the editor reloaded, so it is no longer local-only.
  const reloadId = await createArticle(SIGNED_IN_RELOAD_NAME, SIGNED_IN_RELOAD_TEXT)
  await deleteArticle(SIGNED_IN_RELOAD_NAME)
  await sleep(600)
  await goEditor({ signedIn: true })
  const inAfterReload = await indexEntryById(reloadId)
  check('the reload kept it in the local bin', inAfterReload && inAfterReload.deletedAt !== null, JSON.stringify(inAfterReload))
  await goDrafts()
  check('the bin still lists it after the reload', await evaluate(`document.body.innerText.includes(${JSON.stringify(SIGNED_IN_RELOAD_NAME)})`))
  check('it restores after the reload', await restoreFromBin(SIGNED_IN_RELOAD_NAME))
  check('the body survived the reload', (await bodyInDb(reloadId)) === SIGNED_IN_RELOAD_TEXT)
  await goEditor({ signedIn: true })
  await openArticle(SIGNED_IN_RELOAD_NAME)
  check('the restored local-only article has its body', await editorShows(SIGNED_IN_RELOAD_NAME, SIGNED_IN_RELOAD_TEXT))

  section('signed in: permanent delete still removes a local-only article')
  const purgeId = await createArticle(SIGNED_IN_PURGE_NAME, SIGNED_IN_PURGE_TEXT)
  await deleteArticle(SIGNED_IN_PURGE_NAME)
  await sleep(600)
  await goDrafts()
  check('purge was clicked', await purgeFromBin(SIGNED_IN_PURGE_NAME))
  check('the purged local-only article left the index', (await indexEntryById(purgeId)) === null)
  check('the purged local-only article left the body store', await bodyGone(purgeId))

  // ================= C. an article that lives in the account =================
  section('cloud article: delete, undo, and the bin')
  await goEditor({ signedIn: true })
  const cloudId = await createArticle(CLOUD_NAME, CLOUD_TEXT)
  const saveClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '保存到草稿箱')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  check('the save-to-drafts button is there', saveClicked)
  if (!(await waitFor(`[...document.querySelectorAll('[data-sonner-toast]')].some(e => e.innerText.includes('已保存到草稿箱'))`, 15000))) {
    check('saving to the drafts box reports success', false, (await toastTexts()))
  } else {
    check('saving to the drafts box reports success', true)
  }
  const cloudRow = await accountDoc(CLOUD_NAME)
  check('the article is archived in the account', Boolean(cloudRow) && cloudRow.savedAt !== null, JSON.stringify(cloudRow))
  check('the account stored its body', (await agent('GET', `/api/agent/docs/${cloudId}`)).json?.content === CLOUD_TEXT)

  await deleteArticle(CLOUD_NAME)
  check('the delete toast is shown', await hasToast('已移入回收站'))
  check('undo was clicked', await clickUndo())
  check('the cloud article is back in the editor', await editorShows(CLOUD_NAME, CLOUD_TEXT))
  const cloudBack = await accountDoc(CLOUD_NAME)
  check('the account row is live again after undo', Boolean(cloudBack), JSON.stringify(cloudBack))

  await deleteArticle(CLOUD_NAME)
  await sleep(11000)
  await goDrafts()
  check('the account bin lists the cloud article', await evaluate(`document.body.innerText.includes(${JSON.stringify(CLOUD_NAME)})`))
  check('restore from the account bin works', await restoreFromBin(CLOUD_NAME))
  check('the account row is live again', Boolean(await accountDoc(CLOUD_NAME)))
  await goEditor({ signedIn: true })
  await openArticle(CLOUD_NAME)
  check('the restored cloud article has its body', await editorShows(CLOUD_NAME, CLOUD_TEXT))

  section('cloud article: a failed remove keeps a recoverable copy')
  await blockProcedure('docs.remove')
  await deleteArticle(CLOUD_NAME)
  check('the failed remove is reported', await hasToast('没同步到云端'), (await toastTexts()).join(' | '))
  check('the browser tried to delete it in the account', JSON.parse(await blockedProcedures()).includes('docs.remove'))
  await unblockProcedures()
  await goDrafts()
  check('the bin still has the article after the failed remove', await evaluate(`document.body.innerText.includes(${JSON.stringify(CLOUD_NAME)})`))
  check('the local recovery copy restores', await restoreFromBin(CLOUD_NAME))
  await goEditor({ signedIn: true })
  await openArticle(CLOUD_NAME)
  check('the body survived the failed remove', await editorShows(CLOUD_NAME, CLOUD_TEXT))

  section('cloud article: a failed restore is not reported as success')
  // Make sure the article is in the account bin first.
  await deleteArticle(CLOUD_NAME)
  await sleep(600)
  await blockProcedure('docs.restore')
  const beforeRestore = await toastTexts()
  const restoreUndo = await clickUndo()
  check('undo was clicked against the failing restore', restoreUndo)
  await sleep(1800)
  check('no success toast claims the article is restored', !(await hasToast('已恢复')), (await toastTexts()).join(' | '))
  check('the failure is reported', await hasToast('恢复失败'), (await toastTexts()).join(' | '))
  check('the browser tried to restore it in the account', JSON.parse(await blockedProcedures()).includes('docs.restore'), beforeRestore)
  await unblockProcedures()
  await goDrafts()
  check('the article is still in the bin after the failed restore', await evaluate(`document.body.innerText.includes(${JSON.stringify(CLOUD_NAME)})`))
  check('a later restore still works', await restoreFromBin(CLOUD_NAME))
  await goEditor({ signedIn: true })
  await openArticle(CLOUD_NAME)
  check('the body came back after the failed restore and retry', (await editorText()) === CLOUD_TEXT, String(await editorText()).slice(0, 60))

  check('no uncaught page exception during the run', pageErrors.length === 0, pageErrors.join(' | '))
} catch (e) {
  failures++
  console.error('\n[FAIL] suite crashed:', e)
  console.error(appLog.slice(-1500))
} finally {
  try {
    ws?.close()
  } catch {
    /* already closed */
  }
  chrome.kill()
  app.kill()
  worker.close()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
