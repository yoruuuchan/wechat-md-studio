// Browser acceptance for R20: a failed materials API must never look like a
// real empty library or a zero-usage account.
//
// Usage: node scripts/cdp-verify-materials-states.mjs [appPort] [cdpPort]
//   appPort defaults to 4120; the mock image worker listens on appPort + 100
//   (4220) and CDP defaults to 9720. The SQLite file is private to this suite
//   (data/audit-r20.db) and is deleted before the run.
//
// Covered through a real Chrome and a production build:
//   1. a healthy load: usage, orphans and image rows all agree;
//   2. stats alone fails -> a usage error, never 0 B; retry recovers;
//   3. orphans alone fails -> a reference error, never "clean"; image badges
//      say unknown, batch cleanup is disabled, retry recovers;
//   4. the file list alone fails -> a list error, never "no images yet";
//   5. everything offline -> all three errors, no clean/empty/zero promise;
//   6. a background refetch failure keeps the loaded rows but marks them stale;
//   7. a local draft-body read failure makes references unknown (no batch
//      delete); recovering the read restores the verdicts;
//   8. a failed single delete keeps the object and its ledger row, while a
//      successful delete updates the usage and both lists;
//   9. a truly empty library still shows the normal empty/clean states;
//  10. the failure copy exists in English as well as Chinese.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const APP_PORT = Number(process.argv[2] || 4120)
const WORKER_PORT = APP_PORT + 100
const CDP_PORT = Number(process.argv[3] || 9720)
const APP = `http://127.0.0.1:${APP_PORT}`
const DB_FILE = path.resolve('data/audit-r20.db')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ACCESS_KEY = 'audit-r20-owner-key-20261029'

const IN_USE = 'in-use-key'
const ORPHAN_A = 'orphan-a-key'
const ORPHAN_B = 'fail-delete-key'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

// ---------- mock image host: a 1x1 PNG on read, one refused delete ----------
const worker = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${WORKER_PORT}`)
  if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
    const bin = Buffer.from(PNG, 'base64')
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bin.length }).end(bin)
    return
  }
  if (req.method === 'DELETE') {
    const key = url.searchParams.get('key') ?? ''
    if (key.includes('fail-delete')) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"simulated worker refusal"}')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"deleted":true}')
    return
  }
  if (req.method === 'PUT') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ key: url.searchParams.get('key'), size: 68 }))
    return
  }
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
    DATABASE_URL: 'file:./data/audit-r20.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: 'audit-r20-image-admin-key-7f3c',
    ACCESS_KEY,
    SESSION_SECRET: 'audit-r20-session-secret-4b8e6c1d2a5f7e9b',
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

function seedDatabase() {
  const db = new DatabaseSync(DB_FILE)
  const now = Math.floor(Date.now() / 1000)
  db.exec(`
    DELETE FROM files;
    DELETE FROM docs;
  `)
  const file = db.prepare('INSERT INTO files (key,ownerId,name,size,createdAt,visitor) VALUES (?,1,?,?,?,NULL)')
  file.run(IN_USE, 'in-use.png', 1000, now - 3600)
  file.run(ORPHAN_A, 'orphan-a.png', 2000, now - 7200)
  file.run(ORPHAN_B, 'orphan-b.png', 3000, now - 10800)
  db.prepare(
    'INSERT INTO docs (id,ownerId,name,content,createdAt,updatedAt,savedAt,deletedAt,source,hash) VALUES (?,1,?,?,?,?,?,NULL,NULL,NULL)',
  ).run('doc-in-use', '引用这张图的稿件', `![配图](img:${IN_USE})`, now - 86400, now - 86400, now - 86400)
  db.close()
}

// ---------- Chrome + CDP ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'r20-materials-'))
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

/**
 * Test-only fetch shim. It waits for the page's own localStorage flag, then
 * splits a tRPC batch so one procedure can fail while its neighbours answer for
 * real. 'offline' fails every tRPC request; mutations always pass through.
 */
const FETCH_SHIM = `(() => {
  const nativeFetch = window.fetch.bind(window);
  const readFault = () => {
    try { return JSON.parse(localStorage.getItem('r20.fault') || '{}') } catch { return {} }
  };
  window.fetch = async function (input, init) {
    const raw = typeof input === 'string' ? input : input.url;
    if (!/\\/api\\/trpc\\//.test(raw)) return nativeFetch(input, init);
    const fault = readFault();
    if (fault.mode === 'offline') throw new TypeError('Failed to fetch');
    const fail = Array.isArray(fault.fail) ? fault.fail : [];
    if (!fail.length) return nativeFetch(input, init);
    let url;
    try { url = new URL(raw, location.origin) } catch { return nativeFetch(input, init) }
    const procedures = decodeURIComponent(url.pathname.split('/api/trpc/')[1] || '').split(',').filter(Boolean);
    if (!fail.some((p) => procedures.includes(p))) return nativeFetch(input, init);
    const inputParam = url.searchParams.get('input');
    let inputs = {};
    try { inputs = inputParam ? JSON.parse(inputParam) : {} } catch { inputs = {} }
    const out = [];
    for (let i = 0; i < procedures.length; i++) {
      const procedure = procedures[i];
      if (fail.includes(procedure)) {
        out.push({ error: { json: {
          message: 'Simulated ' + procedure + ' failure',
          code: -32603,
          data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: procedure },
        } } });
        continue;
      }
      const one = await nativeFetch(
        '/api/trpc/' + encodeURIComponent(procedure) + '?batch=1&input=' + encodeURIComponent(JSON.stringify({ 0: inputs[String(i)] })),
        { credentials: 'include' },
      );
      const body = await one.json();
      out.push(Array.isArray(body) ? body[0] : body);
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})()`

/** Makes the local body store fail so loadDocs reports bodyReadFailed. */
const DRAFT_FAULT_SHIM = `(() => {
  if (!/[?&]draftfault=1/.test(location.search)) return;
  IDBObjectStore.prototype.getAll = function () {
    throw new Error('Simulated draft body read failure');
  };
})()`

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

async function setFault(fault) {
  await evaluate(`localStorage.setItem('r20.fault', ${JSON.stringify(JSON.stringify(fault))})`)
}

async function gotoMaterials(query = '') {
  const mark = `nav-${Date.now()}-${Math.random()}`
  try {
    await evaluate(`window.__r20Mark = ${JSON.stringify(mark)}`)
  } catch {
    /* first navigation, no document yet */
  }
  await send('Page.navigate', { url: `${APP}/materials${query}` }, sessionId)
  await waitFor(`window.__r20Mark !== ${JSON.stringify(mark)} && document.readyState === 'complete'`)
  return waitFor(`!!document.querySelector('[data-materials-clean]')`)
}

async function reloadMaterials() {
  const mark = `nav-${Date.now()}-${Math.random()}`
  await evaluate(`window.__r20Mark = ${JSON.stringify(mark)}`)
  await send('Page.reload', {}, sessionId)
  await waitFor(`window.__r20Mark !== ${JSON.stringify(mark)} && document.readyState === 'complete'`)
  return waitFor(`!!document.querySelector('[data-materials-clean]')`)
}

const textOf = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`)
const countOf = (selector) =>
  evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
const bodyText = () => evaluate(`document.body.innerText`)
const hasText = async (needle) => (await bodyText()).includes(needle)

async function click(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`)
}

try {
  await waitUp()
  seedDatabase()

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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_SHIM }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: DRAFT_FAULT_SHIM }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.confirm = () => true' }, sessionId)

  // Log in as the owner so the usage card (not the anonymous allowance card) is
  // the one under test.
  await gotoMaterials()
  await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`)
  await setFault({})
  await gotoMaterials()
  await waitFor(`document.querySelectorAll('[data-materials-file-item]').length === 3`)
  await waitFor(`!!document.querySelector('[data-materials-select-all]')`)

  // ================= 1. healthy load =================
  section('healthy load')
  check('usage counts all three images', await hasText('共 3 张'), (await bodyText()).match(/共 \d+ 张/)?.[0] ?? '')
  check('the referenced image is marked in use', (await evaluate(`document.querySelector('[data-materials-reference="${IN_USE}"]')?.innerText`)) === '在用')
  check('the two unreferenced images are marked unused', (await evaluate(`document.querySelectorAll('[data-materials-reference="${ORPHAN_A}"], [data-materials-reference="${ORPHAN_B}"]').length`)) === 2 && (await evaluate(`[...document.querySelectorAll('[data-materials-reference]')].filter((el) => el.innerText === '没在用').length`)) === 2)
  check('both orphan rows are listed', (await countOf('[data-materials-orphan-item]')) === 2)
  check('a real "nothing unused" claim is not shown', (await countOf('[data-materials-clean-empty]')) === 0)
  check('batch cleanup starts disabled without a selection', await evaluate(`document.querySelector('[data-materials-clean]').disabled`))

  // ================= 2. stats alone fails =================
  section('usage request fails')
  await setFault({ fail: ['storage.stats'] })
  await reloadMaterials()
  await waitFor(`!!document.querySelector('[data-materials-error="stats"]')`)
  const statsError = await textOf('[data-materials-error="stats"]')
  check('the usage block reports its own failure', statsError.includes('存储用量读取失败'), statsError.replace(/\s+/g, ' ').slice(0, 120))
  check('it says the number is not zero', statsError.includes('不代表用量是 0'))
  check('a retry is offered', (await countOf('[data-materials-retry="stats"]')) === 1)
  check('the page does not claim zero usage', !(await hasText('共 0 张')))
  check('the image list still loaded', (await countOf('[data-materials-file-item]')) === 3)
  check('the orphan list still loaded', (await countOf('[data-materials-orphan-item]')) === 2)
  await click('[data-materials-retry="stats"]')
  await sleep(400)
  check('retry keeps the error while the fault is still active', (await countOf('[data-materials-error="stats"]')) === 1)
  await setFault({})
  await click('[data-materials-retry="stats"]')
  check('retry clears the usage error after recovery', await waitFor(`!document.querySelector('[data-materials-error="stats"]')`))
  check('recovered usage shows the real count', await waitFor(`document.body.innerText.includes('共 3 张')`))

  // ================= 3. orphans alone fails =================
  section('orphan check fails')
  await setFault({ fail: ['storage.orphans'] })
  await reloadMaterials()
  await waitFor(`!!document.querySelector('[data-materials-error="orphans"]')`)
  const orphanError = await textOf('[data-materials-error="orphans"]')
  check('the orphan block reports its own failure', orphanError.includes('无法判断哪些图片没在用'), orphanError.replace(/\s+/g, ' ').slice(0, 120))
  check('it explains batch cleanup is unavailable', orphanError.includes('批量清理暂不可用'))
  check('no "clean" promise is shown', (await countOf('[data-materials-clean-empty]')) === 0)
  check('batch cleanup is disabled while references are unknown', await evaluate(`document.querySelector('[data-materials-clean]').disabled`))
  check('image badges say reference unknown', (await evaluate(`[...document.querySelectorAll('[data-materials-reference]')].every((el) => el.innerText === '引用未知')`)))
  check('no image claims to be in use', (await evaluate(`[...document.querySelectorAll('[data-materials-reference]')].every((el) => el.innerText !== '在用')`)))
  check('usage still loaded independently', await hasText('共 3 张'))
  await setFault({})
  await click('[data-materials-retry="orphans"]')
  check('retry clears the orphan error', await waitFor(`!document.querySelector('[data-materials-error="orphans"]')`))
  check('recovered verdicts mark one in use and two unused', await waitFor(`(() => {
    const badges = [...document.querySelectorAll('[data-materials-reference]')].map((el) => el.innerText);
    return badges.filter((t) => t === '在用').length === 1 && badges.filter((t) => t === '没在用').length === 2;
  })()`))
  check('select-all is back after recovery', await waitFor(`!!document.querySelector('[data-materials-select-all]')`))

  // ================= 4. file list alone fails =================
  section('image list fails')
  await setFault({ fail: ['storage.list'] })
  await reloadMaterials()
  await waitFor(`!!document.querySelector('[data-materials-error="files"]')`)
  const filesError = await textOf('[data-materials-error="files"]')
  check('the list block reports its own failure', filesError.includes('图片列表读取失败'), filesError.replace(/\s+/g, ' ').slice(0, 120))
  check('it says this is not an empty library', filesError.includes('不代表没有图片'))
  check('no "no images uploaded" claim is shown', (await countOf('[data-materials-files-empty]')) === 0)
  check('usage still loaded', await hasText('共 3 张'))
  check('orphan list still loaded', (await countOf('[data-materials-orphan-item]')) === 2)
  await setFault({})
  await click('[data-materials-retry="files"]')
  check('retry clears the list error', await waitFor(`!document.querySelector('[data-materials-error="files"]')`))
  check('recovered list shows all rows', await waitFor(`document.querySelectorAll('[data-materials-file-item]').length === 3`))

  // ================= 5. everything offline =================
  section('all three requests offline')
  await setFault({ mode: 'offline' })
  await reloadMaterials()
  await waitFor(`document.querySelectorAll('[data-materials-error]').length === 3`)
  const offlineText = await bodyText()
  check('all three blocks report failure', (await countOf('[data-materials-error]')) === 3)
  check('all three offer a retry', (await countOf('[data-materials-retry]')) === 3)
  check('no zero usage is claimed', !offlineText.includes('共 0 张') && !offlineText.includes('0 B'))
  check('no empty library is claimed', !offlineText.includes('还没有上传过图片'))
  check('no clean-orphans claim is made', !offlineText.includes('干净，没有多余的图'))
  check('batch cleanup is disabled offline', await evaluate(`document.querySelector('[data-materials-clean]').disabled`))
  await setFault({})
  await click('[data-materials-retry="stats"]')
  await click('[data-materials-retry="files"]')
  await click('[data-materials-retry="orphans"]')
  check('recovery clears every error', await waitFor(`document.querySelectorAll('[data-materials-error]').length === 0`))
  check('recovery restores usage', await waitFor(`document.body.innerText.includes('共 3 张')`))
  check('recovery restores the list', await waitFor(`document.querySelectorAll('[data-materials-file-item]').length === 3`))
  check('recovery restores the orphan rows', await waitFor(`document.querySelectorAll('[data-materials-orphan-item]').length === 2`))

  // ================= 6. stale data on a failed background refetch =================
  section('a background refetch fails with data already loaded')
  await setFault({ fail: ['storage.orphans'] })
  await evaluate(`window.dispatchEvent(new Event('visibilitychange'))`)
  check('the failed refresh keeps the orphan rows', await waitFor(`document.querySelectorAll('[data-materials-orphan-item]').length === 2`))
  check('the stale state is labelled', await waitFor(`!!document.querySelector('[data-materials-stale="orphans"]')`))
  check('the stale note is shown', (await textOf('[data-materials-stale="orphans"]')).includes('上次成功加载'))
  check('the refresh error is also shown', (await countOf('[data-materials-error="orphans"]')) === 1)
  check('stale rows are marked unknown, not in use or unused', (await evaluate(`[...document.querySelectorAll('[data-materials-reference]')].every((el) => el.innerText === '引用未知')`)))
  check('batch cleanup is disabled on stale references', await evaluate(`document.querySelector('[data-materials-clean]').disabled`))
  await setFault({})
  await click('[data-materials-retry="orphans"]')
  check('retry clears the stale orphan state', await waitFor(`!document.querySelector('[data-materials-stale="orphans"]')`))
  check('verdicts recover after the stale refresh', await waitFor(`[...document.querySelectorAll('[data-materials-reference]')].filter((el) => el.innerText === '没在用').length === 2`))
  await setFault({ fail: ['storage.stats'] })
  await evaluate(`window.dispatchEvent(new Event('visibilitychange'))`)
  check('a stale usage failure keeps the numbers', await waitFor(`!!document.querySelector('[data-materials-stale="stats"]')`))
  check('stale usage still shows the last count', await hasText('共 3 张'))
  await setFault({})
  await click('[data-materials-retry="stats"]')
  check('usage stale note clears after retry', await waitFor(`!document.querySelector('[data-materials-stale="stats"]')`))
  await setFault({ fail: ['storage.list'] })
  await evaluate(`window.dispatchEvent(new Event('visibilitychange'))`)
  check('a stale list failure keeps the rows', await waitFor(`document.querySelectorAll('[data-materials-file-item]').length === 3`))
  check('the stale list state is labelled', await waitFor(`!!document.querySelector('[data-materials-stale="files"]')`))
  check('the list refresh error is also shown', (await countOf('[data-materials-error="files"]')) === 1)
  await setFault({})
  await click('[data-materials-retry="files"]')
  check('the stale list note clears after retry', await waitFor(`!document.querySelector('[data-materials-stale="files"]')`))

  // ================= 7. local draft scan fails =================
  section('local draft references cannot be read')
  await gotoMaterials('?draftfault=1')
  await waitFor(`!!document.querySelector('[data-materials-error="drafts"]')`)
  const draftError = await textOf('[data-materials-error="drafts"]')
  check('the local scan failure is reported', draftError.includes('无法读取本机草稿'), draftError.replace(/\s+/g, ' ').slice(0, 120))
  check('it says batch cleanup is unavailable', draftError.includes('批量清理暂不可用'))
  check('cloud-known orphan rows are still shown read-only', (await countOf('[data-materials-orphan-item]')) === 2 && (await countOf('[data-materials-readonly]')) === 1)
  check('badges are unknown, not a delete verdict', (await evaluate(`[...document.querySelectorAll('[data-materials-reference]')].every((el) => el.innerText === '引用未知')`)))
  check('batch cleanup is disabled', await evaluate(`document.querySelector('[data-materials-clean]').disabled`))
  check('no clean promise is shown', (await countOf('[data-materials-clean-empty]')) === 0)
  await gotoMaterials()
  check('a healthy local scan clears the draft error', await waitFor(`!document.querySelector('[data-materials-error="drafts"]')`))
  check('verdicts return after the healthy scan', await waitFor(`[...document.querySelectorAll('[data-materials-reference]')].filter((el) => el.innerText === '没在用').length === 2`))

  // ================= 8. single delete =================
  section('single-image deletion')
  const rowsBefore = await countOf('[data-materials-file-item]')
  await click(`[data-materials-file-item="${ORPHAN_B}"] button`)
  check('a refused delete shows an error toast', await waitFor(`document.body.innerText.includes('删除失败')`))
  check('the refused image keeps its row', await waitFor(`!!document.querySelector('[data-materials-file-item="${ORPHAN_B}"]')`))
  check('the list length is unchanged after the refusal', (await countOf('[data-materials-file-item]')) === rowsBefore)
  const dbAfterRefusal = new DatabaseSync(DB_FILE)
  const kept = dbAfterRefusal.prepare('SELECT key FROM files WHERE key = ?').get(ORPHAN_B)
  dbAfterRefusal.close()
  check('the ledger row is kept after the refusal', !!kept)
  check('usage is unchanged after the refusal', await hasText('共 3 张'))
  check('it is still listed as an orphan', (await countOf(`[data-materials-orphan-item="${ORPHAN_B}"]`)) === 1)

  await click(`[data-materials-file-item="${ORPHAN_A}"] button`)
  check('a successful delete removes the row', await waitFor(`!document.querySelector('[data-materials-file-item="${ORPHAN_A}"]')`))
  check('usage drops to two images', await waitFor(`document.body.innerText.includes('共 2 张')`))
  check('the orphan list drops to one row', await waitFor(`document.querySelectorAll('[data-materials-orphan-item]').length === 1`))
  const dbAfterDelete = new DatabaseSync(DB_FILE)
  const gone = dbAfterDelete.prepare('SELECT key FROM files WHERE key = ?').get(ORPHAN_A)
  dbAfterDelete.close()
  check('the ledger row is gone only after a confirmed delete', !gone)

  // ================= 9. a truly empty library =================
  section('a truly empty library')
  const dbEmpty = new DatabaseSync(DB_FILE)
  dbEmpty.exec('DELETE FROM files')
  dbEmpty.close()
  await setFault({})
  await gotoMaterials()
  await waitFor(`!!document.querySelector('[data-materials-clean-empty]')`)
  check('a real zero count is shown as zero', await hasText('共 0 张'))
  check('the empty list uses the normal empty state', (await countOf('[data-materials-files-empty]')) === 1)
  check('the empty orphan list uses the normal clean state', (await countOf('[data-materials-clean-empty]')) === 1)
  check('no error is shown for a real empty library', (await countOf('[data-materials-error]')) === 0)

  // ================= 10. English copy =================
  section('English failure copy')
  await evaluate(`localStorage.setItem('mopai.lang.v1', 'en')`)
  await setFault({ fail: ['storage.stats', 'storage.list'] })
  await reloadMaterials()
  await waitFor(`document.querySelectorAll('[data-materials-error]').length === 2`)
  const enText = await bodyText()
  check('the usage error is English', enText.includes('Could not load storage usage'), enText.replace(/\s+/g, ' ').slice(0, 260))
  check('the list error is English', enText.includes('Could not load the image list'), enText.replace(/\s+/g, ' ').slice(0, 260))
  check('the retry label is English', enText.includes('Retry') && !enText.includes('重试'))
  check('the English error copy carries no Chinese', !/[一-鿿]/.test(await textOf('[data-materials-error="stats"]')))
  await evaluate(`localStorage.setItem('mopai.lang.v1', 'zh')`)
  await setFault({})

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
