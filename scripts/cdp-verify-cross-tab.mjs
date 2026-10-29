// Two real Chrome tabs, one origin and one IndexedDB; isolated production app.
// Usage: node scripts/cdp-verify-cross-tab.mjs [appPort=4104] [cdpPort=9704] [outputDirectory]
// Build first. Test data, cookies and Chrome profiles belong only to this run.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4104)
const CDP = Number(process.argv[3] || 9704)
const APP = `http://127.0.0.1:${PORT}`
const OUT = process.argv[4] || fs.mkdtempSync(path.join(os.tmpdir(), 'reed-cross-tab-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-cross-tab-chrome-'))
const dbName = `audit-r04-${Date.now()}.db`
const database = path.resolve('data', dbName)
fs.mkdirSync(path.dirname(database), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
const results = []
const errors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`)
  assert.ok(ok, name)
}
async function free(port) {
  const probe = net.createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise((resolve) => probe.close(resolve))
}
await free(PORT)
await free(CDP)
await free(PORT + 100)
const worker = http.createServer((_request, response) => response.writeHead(404).end())
await new Promise((resolve) => worker.listen(PORT + 100, '127.0.0.1', resolve))
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(PORT),
    DATABASE_URL: `file:./data/${dbName}`, IMG_BASE_URL: `http://127.0.0.1:${PORT + 100}`,
    IMG_ADMIN_KEY: 'r04-local-image-admin-key-only', ACCESS_KEY: 'r04-local-owner-key-only-2026',
    SESSION_SECRET: 'r04-local-session-secret-only-2026-at-least-32', ANON_GC_ENABLED: 'false',
    AGENT_TOKENS: '', RESEND_API_KEY: '', RESEND_FROM: '', FEEDBACK_TO: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let appLog = ''
app.stdout.on('data', (chunk) => { appLog += chunk })
app.stderr.on('data', (chunk) => { appLog += chunk })
let chrome, ws, send

async function waitUp(url) {
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(url); if (response.ok) return response } catch { /* starting */ }
    if (app.exitCode !== null) throw new Error(`App exited: ${appLog}`)
    await sleep(200)
  }
  throw new Error(`Did not start: ${url}`)
}
function client(socket) {
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if (!pending.has(message.id)) return
    const request = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    pending.set(requestId, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

const noNotifications = `
  window.BroadcastChannel = undefined;
  for (const type of ['storage', 'focus', 'visibilitychange']) {
    window.addEventListener(type, event => event.stopImmediatePropagation(), true);
    document.addEventListener(type, event => event.stopImmediatePropagation(), true);
  }
`

async function page(context, silence = false) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: context })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('mopai.onboarding.v1', 'done'); localStorage.setItem('mopai.lang.v1', 'zh'); } catch {}
    ${silence ? noNotifications : ''}
  ` })
  const ev = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async (expression, label, timeout = 20000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { const value = await ev(expression); if (value) return value; await sleep(100) }
    throw new Error(`Timeout: ${label}`)
  }
  const click = async (expression) => {
    const bounds = await ev(`(() => { const node = ${expression}; if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; })()`)
    assert.ok(bounds, `click target: ${expression}`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await call('Input.dispatchMouseEvent', { ...bounds, type, button: 'left', clickCount: 1 })
    }
  }
  const editor = () => ev('window.__mopaiCodemirror?.state.doc.toString() ?? null')
  const edit = (text) => ev(`(() => {
    const view = window.__mopaiCodemirror;
    if (!view) throw new Error('Editor missing');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } });
    return true;
  })()`)
  const open = async () => {
    await call('Page.navigate', { url: APP })
    await until('!!window.__mopaiCodemirror', 'editor')
  }
  const menu = async () => {
    await click(`document.querySelector('[title="切换稿件"]')`)
    await until('!!document.querySelector(\'[role="menu"]\')', 'article menu')
  }
  const select = async (name) => {
    await menu()
    await click(`[...document.querySelectorAll('[role="menuitem"]')].find(node => node.querySelector('span')?.textContent.trim() === ${JSON.stringify(name)})`)
    await until('!!window.__mopaiCodemirror', 'selected article')
  }
  const create = async (name, text) => {
    await menu()
    await click(`[...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent.trim() === '新建稿件')`)
    await sleep(100)
    await ev(`(() => {
      const input = document.querySelector('input[placeholder="未命名稿件"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await edit(text)
  }
  const rows = () => ev(`new Promise((resolve, reject) => {
    const request = indexedDB.open('mopai');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('bodies', 'readonly');
      const read = tx.objectStore('bodies').getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  })`)
  return { call, ev, until, click, editor, edit, open, menu, select, create, rows }
}

async function scenario(run) {
  const { browserContextId } = await send('Target.createBrowserContext')
  try {
    const seed = await page(browserContextId)
    await seed.call('Page.navigate', { url: `${APP}/skill.md` })
    await seed.until(`location.origin === ${JSON.stringify(APP)}`, 'seed origin')
    await seed.ev(`(async () => {
      const docs = ['shared', 'other'].map(id => ({ id, name: 'R04 '+id, content: 'BASE_'+id, updatedAt: 1, savedAt: null, deletedAt: null, contentLoaded: true }));
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('mopai', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('bodies', { keyPath: 'id' });
        open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('bodies', 'readwrite');
        for (const doc of docs) tx.objectStore('bodies').put({ id: doc.id, content: doc.content });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem('mopai.index.v2', JSON.stringify({ docs: docs.map(({ content, ...meta }) => meta), removed: [] }));
      localStorage.setItem('mopai.active.v1', 'shared');
      localStorage.setItem('mopai.sample.v1', '1');
      localStorage.setItem('mopai.migrated.v2', '1');
      return true;
    })()`)
    const a = await page(browserContextId)
    const b = await page(browserContextId, true)
    await a.open()
    await b.open()
    await Promise.all([
      a.until(`window.__mopaiCodemirror?.state.doc.toString() === 'BASE_shared'`, 'tab A local body'),
      b.until(`window.__mopaiCodemirror?.state.doc.toString() === 'BASE_shared'`, 'tab B local body'),
    ])
    await run(a, b)
  } finally { await send('Target.disposeBrowserContext', { browserContextId }) }
}

try {
  await waitUp(APP)
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--proxy-bypass-list=<-loopback>', 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
  const browser = await (await waitUp(`http://127.0.0.1:${CDP}/json/version`)).json()
  ws = new WebSocket(browser.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  send = client(ws)

  await scenario(async (a, b) => {
    await a.edit('UNIQUE_A_NEW')
    await a.until(`new Promise(resolve => { const o=indexedDB.open('mopai'); o.onsuccess=()=>{ const db=o.result; const r=db.transaction('bodies').objectStore('bodies').get('shared'); r.onsuccess=()=>{resolve(r.result?.content==='UNIQUE_A_NEW');db.close()}; }; })`, 'first save')
    await b.edit('UNIQUE_B_NEW')
    await sleep(600)
    await a.until(`/另一个标签页/.test(document.body.innerText)`, 'cross-tab notification')
    const saved = await b.rows()
    check('lost notifications: both same-article edits remain persisted', saved.some((row) => row.content === 'UNIQUE_A_NEW') && saved.some((row) => row.content === 'UNIQUE_B_NEW'))
    check('the conflict is visible', await b.ev(`/标签页|冲突|conflict/i.test(document.body.innerText)`))
    const count = saved.length
    await b.edit('UNIQUE_B_NEW_AND_MORE_TYPING')
    await sleep(600)
    const continued = await b.rows()
    check('continued typing edits the recovered copy without multiplying copies', continued.length === count && continued.some((row) => row.content === 'UNIQUE_B_NEW_AND_MORE_TYPING'))
    const { data } = await b.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, 'conflict-preserved.png'), Buffer.from(data, 'base64'))
    await a.open()
    await b.open()
    const refreshed = await a.rows()
    check('refresh retains both versions', refreshed.some((row) => row.content === 'UNIQUE_A_NEW') && refreshed.some((row) => row.content === 'UNIQUE_B_NEW_AND_MORE_TYPING'))
  })

  await scenario(async (a, b) => {
    await b.select('R04 other')
    await Promise.all([a.edit('ARTICLE_A_ONLY'), b.edit('ARTICLE_B_ONLY')])
    await sleep(600)
    const saved = await a.rows()
    check('different articles keep both edits', saved.find((row) => row.id === 'shared')?.content === 'ARTICLE_A_ONLY' && saved.find((row) => row.id === 'other')?.content === 'ARTICLE_B_ONLY')
    check('another tab switching articles does not switch this tab', await a.editor() === 'ARTICLE_A_ONLY' && await b.editor() === 'ARTICLE_B_ONLY')
    await a.open()
    await a.until(`window.__mopaiCodemirror?.state.doc.toString() === 'ARTICLE_A_ONLY'`, 'tab A selected article after reload')
    check('refresh keeps the locally selected article', await a.editor() === 'ARTICLE_A_ONLY')
  })

  await scenario(async (a, b) => {
    await Promise.all([a.create('R04 new A', 'NEW_ARTICLE_A'), b.create('R04 new B', 'NEW_ARTICLE_B')])
    await sleep(600)
    await b.edit('NEW_ARTICLE_B_MORE')
    await sleep(400)
    const saved = await a.rows()
    check('simultaneous creation and stale autosave keep both new articles', saved.some((row) => row.content === 'NEW_ARTICLE_A') && saved.some((row) => row.content === 'NEW_ARTICLE_B_MORE'))
  })

  await scenario(async (a, b) => {
    await a.menu()
    await a.click(`[...document.querySelectorAll('[role="menuitem"]')].find(node => node.querySelector('span')?.textContent.trim() === 'R04 shared')?.querySelector('button')`)
    await sleep(350)
    await b.edit('EDIT_AFTER_OTHER_TAB_DELETED')
    await sleep(600)
    const saved = await a.rows()
    check('stale editing does not silently restore a deleted original id', Boolean(saved.find((row) => row.id === 'shared')?.metadata?.deletedAt))
    check('the stale edit survives in a separate live copy', saved.some((row) => row.id !== 'shared' && row.content === 'EDIT_AFTER_OTHER_TAB_DELETED' && !row.metadata?.deletedAt))
    await a.ev(`(() => {
      const button = [...document.querySelectorAll('[data-sonner-toast] button')]
        .find(node => node.textContent.trim() === '撤销');
      if (!button) throw new Error('Undo toast button missing');
      button.click();
      return true;
    })()`)
    await sleep(1000)
    const afterUndo = await a.rows()
    check(
      'undo restores the original without dropping the other tab copy',
      afterUndo.some((row) => row.id === 'shared' && row.metadata?.deletedAt === null),
      JSON.stringify(afterUndo),
    )
  })

  await scenario(async (a) => {
    await a.ev(`(() => {
      const native = IDBObjectStore.prototype.put;
      let once = true;
      IDBObjectStore.prototype.put = function(value, ...rest) {
        const request = native.call(this, value, ...rest);
        if (once && this.name === 'bodies' && value.content === 'INTERRUPTED_EDIT') { once = false; this.transaction.abort(); }
        return request;
      };
    })()`)
    await a.edit('INTERRUPTED_EDIT')
    await sleep(500)
    check('aborted persistence leaves the original committed version intact', (await a.rows()).find((row) => row.id === 'shared')?.content === 'BASE_shared')
    // U01 replaced the old sync chip ("本地未存") with SaveStatus, whose local
    // failure label is "本机保存异常"; accept either wording.
    check('aborted persistence keeps the unsaved text and a visible failure', await a.editor() === 'INTERRUPTED_EDIT' && await a.ev(`/本地未存|本地.*失败|本机保存异常|local.*fail/i.test(document.body.innerText)`), JSON.stringify({ editor: await a.editor(), page: (await a.ev('document.body.innerText')).slice(0, 160) }))
    await a.open()
    await a.until(`window.__mopaiCodemirror?.state.doc.toString() === 'BASE_shared'`, 'committed body after reload')
    check('refresh after interruption recovers the last committed body', await a.editor() === 'BASE_shared')
  })
  check('no uncaught browser exceptions', errors.length === 0, JSON.stringify(errors).slice(0, 500))
} catch (error) {
  results.push({ name: 'suite', ok: false, detail: error.stack })
  console.error(error.stack)
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  fs.writeFileSync(path.join(OUT, 'app.log'), appLog)
  if (send) { try { await send('Browser.close') } catch { /* already stopped */ } }
  ws?.close()
  chrome?.kill()
  app.kill()
  worker.close()
  console.log(`Evidence: ${OUT}`)
}
