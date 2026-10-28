// Browser acceptance for local body-read failures (R02).
//
// Usage: node scripts/cdp-verify-storage-read-failure.mjs [appPort] [cdpPort]
//   appPort defaults to 4102; the inert image worker listens on appPort + 100
//   (4202) and the CDP port defaults to 9702. The SQLite file is private to this
//   suite (data/audit-r02.db) and is deleted before the run.
//
// The point of the suite is the failure path that cannot be reached from a
// normal UI: the browser's first IndexedDB `getAll` throws, exactly like the
// audit probe that found the bug. Before the fix, the next autosave wrote an
// empty body over ORIGINAL_BODY_MUST_SURVIVE.
//
// Covered here, all through a real Chrome and a real production build:
//   1. one transient read failure -> autosave leaves the body alone, retry
//      reads it back, editing resumes, a refresh keeps the edited text;
//   2. a persistent read failure keeps the original and shows a retry;
//   3. an IndexedDB open failure is a diagnosed read failure, not an empty
//      fallback store;
//   4. an index entry whose body is really missing is not recreated as '';
//   5. a cloud stub (contentLoaded:false) never has '' written for it;
//   6. a body the author deliberately emptied is stored as '' and reloads as an
//      empty article, not as a failure;
//   7. a legacy migration that fails keeps the old localStorage key and the
//      existing body, then succeeds on the next load.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 4102)
const WORKER_PORT = APP_PORT + 100
const CDP_PORT = Number(process.argv[3] || 9702)
const APP = `http://127.0.0.1:${APP_PORT}`
const DB_FILE = path.resolve('data/audit-r02.db')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const ORIGINAL = 'ORIGINAL_BODY_MUST_SURVIVE'
const EDITED = `${ORIGINAL}\n\nEDITED_AFTER_RETRY`
const LEGACY = 'LEGACY_BODY_MUST_SURVIVE'
const MISSING_NAME = 'Missing Body Probe'
const STUB_NAME = 'Cloud Stub Probe'

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
    DATABASE_URL: 'file:./data/audit-r02.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: 'audit-r02-image-admin-key-7f3c',
    ACCESS_KEY: 'audit-r02-owner-key-20261028',
    SESSION_SECRET: 'audit-r02-session-secret-4b8e6c1d2a5f7e9b',
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

// ---------- Chrome + CDP ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'r02-storage-'))
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
    '--window-size=1440,900',
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

/** Init script pieces; each returns the identifier needed to remove it. */
const initScripts = {
  transientRead: `(() => {
    const native = IDBObjectStore.prototype.getAll;
    let fired = false;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (!fired) {
        fired = true;
        window.__r02FaultFired = 'transient-read';
        throw new Error('Simulated transient read failure');
      }
      return native.apply(this, args);
    };
  })()`,
  persistentRead: `(() => {
    IDBObjectStore.prototype.getAll = function () {
      window.__r02FaultFired = 'persistent-read';
      throw new Error('Simulated persistent read failure');
    };
  })()`,
  openFailure: `(() => {
    IDBFactory.prototype.open = function () {
      window.__r02FaultFired = 'open-failure';
      throw new Error('Simulated IndexedDB open failure');
    };
  })()`,
  migrationWrite: `(() => {
    IDBObjectStore.prototype.put = function () {
      window.__r02FaultFired = 'migration-write';
      throw new Error('Simulated migration write failure');
    };
  })()`,
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

async function waitFor(expression, timeoutMs = 12000) {
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

async function goto() {
  await send('Page.navigate', { url: `${APP}/` }, sessionId)
  await waitFor(`!!document.querySelector('[data-onboarding="editor"]')`)
  await evaluate(`document.fonts.ready.then(() => true)`)
}

async function reload() {
  await send('Page.reload', {}, sessionId)
  await waitFor(`!!document.querySelector('[data-onboarding="editor"]')`)
  // Let the first render and the editor's value effect settle before reading it.
  await sleep(350)
}

async function addInit(source) {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId)
  return identifier
}

async function removeInit(identifier) {
  if (identifier) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId)
}

async function click(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`)
  return ok
}

async function editorText() {
  return evaluate(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : null`)
}

/** Replace the whole editor document through the real CodeMirror state. */
async function setEditorText(text) {
  return evaluate(`(() => {
    const view = window.__mopaiCodemirror;
    if (!view) return false;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } });
    return true;
  })()`)
}

async function bodyInDb(id) {
  return evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mopai', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('bodies')) request.result.createObjectStore('bodies', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = await new Promise((resolve, reject) => {
      const request = db.transaction('bodies', 'readonly').objectStore('bodies').get(${JSON.stringify(id)});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return row ? row.content : null;
  })()`)
}

async function indexEntry(id) {
  return evaluate(`(() => {
    try {
      const raw = localStorage.getItem('mopai.index.v2');
      if (!raw) return null;
      return JSON.parse(raw).docs.find((d) => d.id === ${JSON.stringify(id)}) ?? null;
    } catch { return null; }
  })()`)
}

/** Seed a healthy local record (body in IndexedDB, metadata in localStorage). */
async function seedLocalDoc({ id = 'read-fault', name = 'Read Fault Probe', content = ORIGINAL } = {}) {
  return evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mopai', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('bodies')) request.result.createObjectStore('bodies', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('bodies', 'readwrite');
      tx.objectStore('bodies').put({ id: ${JSON.stringify(id)}, content: ${JSON.stringify(content)} });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem('mopai.index.v2', JSON.stringify({
      docs: [{
        id: ${JSON.stringify(id)},
        name: ${JSON.stringify(name)},
        updatedAt: 1,
        savedAt: null,
        deletedAt: null,
        source: null,
        baseHash: null,
        remoteMcp: null,
        contentLoaded: true,
      }],
      removed: [],
    }));
    localStorage.setItem('mopai.active.v1', ${JSON.stringify(id)});
    localStorage.setItem('mopai.migrated.v2', '1');
    localStorage.setItem('mopai.sample.v1', '1');
    localStorage.setItem('mopai.onboarding.v1', 'done');
    return true;
  })()`)
}

/** Rewrite the index from this side while leaving the body store alone. */
async function seedIndex(entries, activeId) {
  return evaluate(`(() => {
    localStorage.setItem('mopai.index.v2', JSON.stringify({ docs: ${JSON.stringify(entries)}, removed: [] }));
    localStorage.setItem('mopai.active.v1', ${JSON.stringify(activeId)});
    localStorage.setItem('mopai.migrated.v2', '1');
    localStorage.setItem('mopai.sample.v1', '1');
    localStorage.setItem('mopai.onboarding.v1', 'done');
    return true;
  })()`)
}

const localEntry = (id, name, extra = {}) => ({
  id,
  name,
  updatedAt: 1,
  savedAt: null,
  deletedAt: null,
  source: null,
  baseHash: null,
  remoteMcp: null,
  contentLoaded: true,
  ...extra,
})

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

  await goto()
  await sleep(800)
  await seedLocalDoc()
  await reload()
  check('seeded article loads from IndexedDB', (await editorText()) === ORIGINAL, JSON.stringify(await editorText()))
  check('seeded body is the original', (await bodyInDb('read-fault')) === ORIGINAL)

  // ================= 1. one transient read failure =================
  section('one transient body-read failure')
  let init = await addInit(initScripts.transientRead)
  await reload()
  check('the failed read is visible in the editor', await waitFor(`!!document.querySelector('[data-local-body-error]')`))
  const errorText = await evaluate(`document.querySelector('[data-local-body-error]')?.innerText ?? ''`)
  check('the diagnostic says the original is kept and autosave paused', /原件|original/i.test(errorText) && /重试|retry/i.test(errorText), errorText.replace(/\s+/g, ' '))
  check('the persistent local-storage banner is shown', await waitFor(`!!document.querySelector('[data-local-storage-banner]')`))
  check('the editor does not show an empty CodeMirror document as the article', (await editorText()) === null)
  // The autosave effect runs on mount; give it more than its own interval.
  await sleep(1500)
  check('autosave did not overwrite the original body', (await bodyInDb('read-fault')) === ORIGINAL, JSON.stringify(await bodyInDb('read-fault')))
  const afterFailureIndex = await indexEntry('read-fault')
  check('the index remembers the body as unloaded, not as empty', afterFailureIndex?.contentLoaded === false && afterFailureIndex?.bodyState === 'read-failed', JSON.stringify(afterFailureIndex))

  check('the editor offers a retry', await click('[data-local-body-error] [data-local-retry]'))
  check('retry restores the original text', await waitFor(`window.__mopaiCodemirror && window.__mopaiCodemirror.state.doc.toString() === ${JSON.stringify(ORIGINAL)}`))
  check('the diagnostic clears after the retry', await waitFor(`!document.querySelector('[data-local-body-error]')`))
  check('the body store still holds the original', (await bodyInDb('read-fault')) === ORIGINAL)
  await removeInit(init)
  init = null

  check('editing resumes after the retry', await setEditorText(EDITED))
  await sleep(1200)
  check('the edit is autosaved', (await bodyInDb('read-fault')) === EDITED, JSON.stringify(await bodyInDb('read-fault')))
  await reload()
  const refreshed = await editorText()
  check('a refresh keeps the edited original', refreshed === EDITED, JSON.stringify(refreshed))
  check('a refresh writes no read-failure diagnostic', !(await evaluate(`!!document.querySelector('[data-local-body-error]')`)))

  // ================= 2. a persistent read failure =================
  section('a persistent body-read failure')
  init = await addInit(initScripts.persistentRead)
  await reload()
  check('the failure is diagnosed', await waitFor(`!!document.querySelector('[data-local-body-error]')`))
  await sleep(1500)
  check('the persistent failure leaves the original body intact', (await bodyInDb('read-fault')) === EDITED, JSON.stringify(await bodyInDb('read-fault')))
  check('the top bar reports the local failure', (await evaluate(`document.body.innerText.includes('本地未存')`)))
  await removeInit(init)
  init = null
  await reload()
  const recovered = await editorText()
  check('the next healthy load recovers the original', recovered === EDITED, JSON.stringify(recovered))

  // ================= 3. IndexedDB cannot open =================
  section('the IndexedDB open fails')
  init = await addInit(initScripts.openFailure)
  await reload()
  check('the open failure is diagnosed, not treated as an empty store', await waitFor(`!!document.querySelector('[data-local-storage-banner]')`))
  const openErrorText = await evaluate(`document.querySelector('[data-local-storage-banner]')?.innerText ?? ''`)
  check('the diagnostic names the store/read failure', /存储|storage|IndexedDB|读取|read/i.test(openErrorText), openErrorText.replace(/\s+/g, ' '))
  await sleep(1200)
  await removeInit(init)
  init = null
  await reload()
  check('the original body survived the open failure', (await editorText()) === EDITED, JSON.stringify(await editorText()))
  check('the body store still has the original after recovery', (await bodyInDb('read-fault')) === EDITED)

  // ================= 4. a really missing body =================
  section('an index entry whose body is missing')
  await seedIndex([localEntry('missing-body', MISSING_NAME)], 'missing-body')
  await reload()
  check('a missing body is diagnosed', await waitFor(`!!document.querySelector('[data-local-body-error]')`))
  const missingText = await evaluate(`document.querySelector('[data-local-body-error]')?.innerText ?? ''`)
  check('the missing-body diagnostic is distinct from an empty article', /找不到|missing|没有找到/i.test(missingText), missingText.replace(/\s+/g, ' '))
  await sleep(1200)
  check('no empty body was created for the missing article', (await bodyInDb('missing-body')) === null)
  await reload()
  check('the missing body is still missing after a refresh', (await bodyInDb('missing-body')) === null)
  check('the index still marks it as missing', (await indexEntry('missing-body'))?.bodyState === 'missing', JSON.stringify(await indexEntry('missing-body')))

  // ================= 5. a cloud stub must not become '' =================
  section('a contentLoaded:false cloud stub')
  await seedIndex(
    [localEntry('stub-doc', STUB_NAME, { contentLoaded: false, bodyState: 'stub', savedAt: 2, baseHash: 'abc123' })],
    'stub-doc',
  )
  await reload()
  await sleep(1200)
  check('no empty body was written for the cloud stub', (await bodyInDb('stub-doc')) === null, JSON.stringify(await bodyInDb('stub-doc')))
  const stubIndex = await indexEntry('stub-doc')
  check('the cloud stub stays a stub in the index', stubIndex?.contentLoaded === false && stubIndex?.bodyState === 'stub', JSON.stringify(stubIndex))

  // ================= 6. the author really empties an article =================
  section('the author empties the article')
  await seedLocalDoc({ id: 'empty-doc', name: 'Empty Probe', content: 'SOMETHING_TO_DELETE' })
  await reload()
  await waitFor(`window.__mopaiCodemirror && window.__mopaiCodemirror.state.doc.toString() === 'SOMETHING_TO_DELETE'`)
  check('the article to empty is open', (await editorText()) === 'SOMETHING_TO_DELETE')
  await setEditorText('')
  await sleep(1200)
  check('an intentionally emptied article is stored as the empty string', (await bodyInDb('empty-doc')) === '', JSON.stringify(await bodyInDb('empty-doc')))
  await reload()
  check('an intentionally emptied article reloads without a failure diagnostic', !(await evaluate(`!!document.querySelector('[data-local-body-error]')`)))
  check('the emptied article stays empty, not missing', (await bodyInDb('empty-doc')) === '')
  check('the index keeps the emptied article loaded', (await indexEntry('empty-doc'))?.contentLoaded === true, JSON.stringify(await indexEntry('empty-doc')))

  // ================= 7. a failing legacy migration =================
  section('a legacy migration that fails')
  await seedLocalDoc({ id: 'read-fault', name: 'Read Fault Probe', content: EDITED })
  await evaluate(`(() => {
    const legacy = [{
      id: 'legacy-doc',
      name: 'Legacy Probe',
      content: ${JSON.stringify(LEGACY)},
      updatedAt: 1,
      savedAt: null,
      deletedAt: null,
    }];
    localStorage.setItem('mopai.docs.v1', JSON.stringify(legacy));
    localStorage.removeItem('mopai.migrated.v2');
  })()`)
  init = await addInit(initScripts.migrationWrite)
  await reload()
  check('the migration failure is diagnosed', await waitFor(`!!document.querySelector('[data-local-storage-banner]')`))
  const migrationText = await evaluate(`document.querySelector('[data-local-storage-banner]')?.innerText ?? ''`)
  check('the diagnostic says the original data was kept', /保留|kept|迁移|migrat/i.test(migrationText), migrationText.replace(/\s+/g, ' '))
  check('the legacy key is still present', (await evaluate(`localStorage.getItem('mopai.docs.v1')`)) !== null)
  check('the pre-existing body was not overwritten by the failed migration', (await bodyInDb('read-fault')) === EDITED, JSON.stringify(await bodyInDb('read-fault')))
  await removeInit(init)
  init = null
  await reload()
  check('the next load completes the migration', (await waitFor(`localStorage.getItem('mopai.migrated.v2') === '1'`)))
  check('the legacy key is dropped only after the verified migration', (await evaluate(`localStorage.getItem('mopai.docs.v1')`)) === null)
  check('the legacy body landed in the body store', (await bodyInDb('legacy-doc')) === LEGACY, JSON.stringify(await bodyInDb('legacy-doc')))
  check('the pre-existing body is still the edited original', (await bodyInDb('read-fault')) === EDITED)

  check('no uncaught page exception during the run', pageErrors.length === 0, pageErrors.join(' | '))
} catch (e) {
  failures++
  console.error('\n[FAIL] suite crashed:', e)
  console.error(appLog.slice(-1200))
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
