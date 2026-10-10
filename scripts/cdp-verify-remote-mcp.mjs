// Real Chrome + MCP SDK + optional real OpenCode client, private production DB.
// node scripts/cdp-verify-remote-mcp.mjs [appPort=3227] [cdpPort=9355]
// MOPAI_OPENCODE_BIN=<native executable> adds the client acceptance test.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { verifyOpenCodeMcp } from './lib/verify-opencode-mcp.mjs'

const APP_PORT = Number(process.argv[2] || 3227)
const CDP_PORT = Number(process.argv[3] || 9355)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-mcp-browser-'))
const dbFile = path.join(dir, 'test.db')
const profile = path.join(dir, 'chrome')
const shots = path.resolve('verify-out/remote-mcp')
fs.mkdirSync(shots, { recursive: true })
const skill = fs.readFileSync('skills/wechat-typesetter/SKILL.md', 'utf8').replace(/\r\n/g, '\n')
const initial = '---\ntitles:\n  - MCP 协作验收\n---\n\n## 写作起点\n\n浏览器初稿。\n\n@signature\n'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const worker = http.createServer((req, res) => res.writeHead(404).end())
await new Promise((resolve) => worker.listen(0, '127.0.0.1', resolve))
const app = spawn(process.execPath, ['dist/boot.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), DATABASE_URL: `file:${dbFile}`,
    PUBLIC_BASE_URL: appUrl, ACCESS_KEY: 'mcp-test-access-key-4e17', SESSION_SECRET: 'mcp-test-session-secret-32-characters-4e17',
    IMG_BASE_URL: `http://127.0.0.1:${worker.address().port}`, IMG_ADMIN_KEY: 'mcp-test-image-key-4e17', AGENT_TOKENS: '', ANON_GC_ENABLED: 'false',
    REMOTE_MCP_TTL_HOURS: '24', REMOTE_MCP_TOTAL_BYTES: '52428800' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => { appLog += d })
app.stderr.on('data', (d) => { appLog += d })
let chrome, ws, sql
const clients = []

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(appUrl)).ok) break } catch { /* starting */ }
    if (i === 79) throw new Error(`app did not start: ${appLog.slice(-800)}`)
    await sleep(250)
  }
  check('/skill.md is the tracked Skill', await (await fetch(`${appUrl}skill.md`)).text() === skill)
  chrome = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-proxy-server', '--disable-gpu', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })
  let wsUrl
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; if (wsUrl) break } catch { /* starting */ }
    await sleep(250)
  }
  if (!wsUrl) throw new Error('Chrome CDP did not start')
  ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30_000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Browser.grantPermissions', { origin: appUrl.slice(0, -1), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  const ev = async (expression, session = sessionId) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, ms = 15000) => {
    const until = Date.now() + ms
    while (Date.now() < until) { if (await ev(`Boolean(${expression})`)) return; await sleep(250) }
    const detail = await ev(`JSON.stringify({alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),buttons:[...document.querySelectorAll('[role="dialog"] button')].map(e=>({text:e.textContent,disabled:e.disabled})),tabs:[...document.querySelectorAll('[role="tab"]')].map(e=>({text:e.textContent,state:e.dataset.state}))})`)
    throw new Error(`Browser timeout: ${label}\n${detail}\n${appLog.slice(-500)}`)
  }
  const click = async (expression) => {
    const point = await ev(`(() => { const e = ${expression}; if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
    if (!point) throw new Error(`Missing button: ${expression}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, sessionId)
  }
  const select = (selector) => `document.querySelector(${JSON.stringify(selector)})`
  const closeDialog = async () => {
    await click(`document.querySelector('[role="dialog"] button span.sr-only')?.parentElement`)
    await waitFor(`!document.querySelector('[role="dialog"]')`, 'dialog closed')
    await sleep(200)
  }
  const editor = () => ev('window.__mopaiCodemirror.state.doc.toString()')
  const edit = (content) => ev(`(() => { const v=window.__mopaiCodemirror; v.dispatch({changes:{from:0,to:v.state.doc.length,insert:${JSON.stringify(content)}}}); return true })()`)
  const activeId = () => ev(`localStorage.getItem('mopai.active.v1')`)
  const localBodies = () => ev(`new Promise((resolve,reject) => { const o=indexedDB.open('mopai'); o.onsuccess=()=>{const db=o.result; const r=db.transaction('bodies','readonly').objectStore('bodies').getAll(); r.onsuccess=()=>{resolve(r.result);db.close()};r.onerror=()=>reject(r.error)};o.onerror=()=>reject(o.error) })`)
  const openMcp = async () => {
    await click(`[...document.querySelectorAll('[role="tab"]')].find(e => e.textContent.includes('设置'))`)
    await waitFor(`Boolean(document.querySelector('details summary'))`, 'advanced settings')
    if (!await ev(`document.querySelector('details')?.open`)) await click(`document.querySelector('details summary')`)
    await click(select('[data-open-remote-mcp]'))
    await waitFor(`document.querySelector('[role="dialog"]')`, 'MCP dialog')
    await sleep(250)
  }
  const connect = async (token) => {
    const client = new Client({ name: 'mopai-browser-acceptance', version: '1.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${appUrl}api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    clients.push(client)
    return client
  }
  const read = async (client) => (await client.callTool({ name: 'read_current_document', arguments: {} })).structuredContent
  const write = (client, content, baseHash) => client.callTool({ name: 'update_current_document', arguments: { content, baseHash } })

  await send('Page.navigate', { url: appUrl }, sessionId)
  await waitFor(`window.__mopaiCodemirror?.state.doc.length > 100 && localStorage.getItem('mopai.active.v1')`, 'hydrated editor')
  await ev(`localStorage.setItem('mopai.theme.v1','akari'); true`)
  await send('Page.reload', {}, sessionId)
  await waitFor(`window.__mopaiCodemirror?.state.doc.length > 100`, 'light editor')
  const demoContent = await editor()
  await edit(initial)
  await waitFor(`window.__mopaiCodemirror.state.doc.toString() === ${JSON.stringify(initial)}`, 'initial browser input')
  await sleep(400)
  await click(select('[data-open-ai-writing]'))
  await waitFor(`!document.querySelector('[data-ai-copy="skill"]')?.disabled`, 'full Skill fetched')
  check('writing prompt is readable without a collapsed input', await ev(`document.querySelector('textarea[aria-label="写作提示词"]').getBoundingClientRect().height >= 180`))
  for (const [type, expected] of [['prompt', 'https://wechat.yoru-and-akari.dev/skill.md'], ['url', 'https://wechat.yoru-and-akari.dev/skill.md'], ['skill', skill]]) {
    await click(select(`[data-ai-copy="${type}"]`))
    await sleep(150)
    const copied = (await ev('navigator.clipboard.readText()')).replace(/\r\n/g, '\n')
    check(`anonymous copy ${type}`, type === 'prompt' ? copied.includes(expected) && copied.includes('主题') : copied === expected)
  }
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
  }
  await shot(path.join(shots, 'ai-writing-akari.png'))
  await closeDialog()
  await openMcp()
  await click(select('[data-mcp-create]'))
  await waitFor(`Boolean(document.querySelector('input[aria-label="MCP Authorization"]'))`, 'anonymous grant')
  let token = (await ev(`document.querySelector('input[aria-label="MCP Authorization"]').value`)).replace(/^Bearer /, '')
  const id = await activeId()
  await click(select('[data-mcp-copy="config"]'))
  await sleep(150)
  const copiedConfig = JSON.parse(await ev('navigator.clipboard.readText()'))
  check('copied standard URL and Bearer', copiedConfig.mcpServers['mopai-current'].url === `${appUrl}api/mcp` && copiedConfig.mcpServers['mopai-current'].headers.Authorization === `Bearer ${token}`)
  await shot(path.join(shots, 'remote-mcp-akari.png'))
  await closeDialog()

  const client = await connect(token)
  check('SDK initialize and tools/list', (await client.listTools()).tools.map((t) => t.name).join(',') === 'read_writing_skill,read_current_document,update_current_document')
  check('AI reads writing Skill', (await client.callTool({ name: 'read_writing_skill', arguments: {} })).content[0].text === skill)
  const first = await read(client)
  check('AI reads the browser draft', first.doc.content === initial, `chars=${first.doc.content.length}/${initial.length}`)
  check('MCP resource reads', (await client.readResource({ uri: 'mopai://document/current' })).contents[0].text.includes('浏览器初稿'))
  const aiText = initial + '\nAI 第一次修改。\n'
  check('AI CAS write succeeds', !(await write(client, aiText, first.doc.hash)).isError)
  await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('AI 第一次修改')`, 'AI → browser')
  check('AI → browser auto sync', await editor() === aiText)
  const browserText = aiText + '\n浏览器精修。\n'
  await edit(browserText)
  for (let i = 0; i < 30 && (await read(client)).doc.content !== browserText; i++) await sleep(250)
  check('browser → AI auto sync', (await read(client)).doc.content === browserText)
  check('stale AI base is rejected', (await write(client, '不可覆盖', first.doc.hash)).isError === true)

  // Pause only this browser's network; the independent MCP client stays online.
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
  const localConflict = browserText + '\n离线本机分支。\n'
  await edit(localConflict)
  const base = await read(client)
  const remoteConflict = browserText + '\n并发 AI 分支。\n'
  await write(client, remoteConflict, base.doc.hash)
  await sleep(900)
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
  await waitFor(`Boolean(document.querySelector('[data-mcp-conflict]'))`, 'explicit conflict')
  check('conflict versions have readable preview areas', await ev(`document.querySelector('textarea[aria-label="MCP 本机冲突版本"]').getBoundingClientRect().height >= 150`))
  check('concurrent versions both visible', (await ev(`document.querySelector('textarea[aria-label="MCP 本机冲突版本"]').value`)) === localConflict && (await ev(`document.querySelector('textarea[aria-label="MCP 远端冲突版本"]').value`)) === remoteConflict)
  await click(select('[data-mcp-resolve="both"]'))
  await waitFor(`!document.querySelector('[data-mcp-conflict]')`, 'keep both')
  check('keep both preserves complete local body', (await localBodies()).some((d) => d.content === localConflict))
  check('keep both uses AI version in current article', await editor() === remoteConflict)
  await closeDialog()

  for (const choice of ['local', 'remote']) {
    const before = (await read(client)).doc
    const local = `${before.content}\n${choice}：本机继续修改。\n`
    const remote = `${before.content}\n${choice}：AI 继续修改。\n`
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
    await edit(local)
    await write(client, remote, before.hash)
    await sleep(800)
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
    await waitFor(`Boolean(document.querySelector('[data-mcp-conflict]'))`, `${choice} conflict`)
    await sleep(250)
    await click(select(`[data-mcp-resolve="${choice}"]`))
    await waitFor(`!document.querySelector('[data-mcp-conflict]')`, `${choice} resolution`)
    const expected = choice === 'local' ? local : remote
    await waitFor(`window.__mopaiCodemirror.state.doc.toString() === ${JSON.stringify(expected)}`, `${choice} body`)
    check(`${choice}: explicit choice matches browser and MCP`, await editor() === expected && (await read(client)).doc.content === expected)
    await closeDialog()
  }

  const domestic = await verifyOpenCodeMcp({ endpoint: `${appUrl}api/mcp`, token, content: (await read(client)).doc.content + '\nOpenCode 客户端实写。\n' })
  if (domestic.skipped) console.log('[SKIP] OpenCode: set MOPAI_OPENCODE_BIN to test an installed native client')
  else {
    check(`OpenCode ${domestic.version}: real MCP Skill/read/update`, domestic.calls.includes('read_writing_skill') && domestic.calls.includes('read_current_document') && domestic.calls.includes('update_current_document'))
    await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('OpenCode 客户端实写')`, 'OpenCode → browser')
    check('OpenCode → browser auto sync', (await editor()).includes('OpenCode 客户端实写'))
  }

  await click(select('[title="切换稿件"]'))
  await waitFor(`document.querySelector('[role="menu"]')`, 'document switcher')
  await click(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('新建稿件'))`)
  await sleep(400)
  const secondText = '第二篇本机稿，尚未授权给 AI。'
  await edit(secondText)
  const original = (await read(client)).doc
  await write(client, original.content + '\nAI 继续编辑授权的第一篇。\n', original.hash)
  await sleep(800)
  check('switching documents does not broaden the token scope', await editor() === secondText && !(await ev(`Boolean(document.querySelector('[data-mcp-editor-status]'))`)))
  await click(select('[title="切换稿件"]'))
  await waitFor(`document.querySelector('[role="menu"]')`, 'switch back')
  await click(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.startsWith(${JSON.stringify(first.doc.name)}) && !e.textContent.includes('（本机版本）'))`)
  await waitFor(`window.__mopaiCodemirror.state.doc.toString().includes('AI 继续编辑授权的第一篇')`, 'original scoped article catches up')
  check('switching back catches up the authorized article', await activeId() === id)

  // A separate browser context has another visitor even for the same local id.
  const context = await send('Target.createBrowserContext')
  const targetB = await send('Target.createTarget', { url: appUrl, browserContextId: context.browserContextId })
  const sessionB = await send('Target.attachToTarget', { targetId: targetB.targetId, flatten: true })
  await sleep(2500)
  const other = await ev(`fetch('/api/remote-mcp/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({localDocId:${JSON.stringify(id)},name:'另一位游客',content:'游客 B 的独立稿件'})}).then(r=>r.json())`, sessionB.sessionId)
  const otherClient = await connect(other.token)
  check('another visitor gets an isolated document', (await read(otherClient)).doc.content === '游客 B 的独立稿件')
  const forbidden = await ev(`fetch('/api/remote-mcp/connections/'+${JSON.stringify(id)},{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({connectionId:${JSON.stringify(first.connection.id)},name:'cross',content:'不可跨游客覆盖',baseHash:${JSON.stringify(first.doc.hash)}})}).then(r=>r.status)`, sessionB.sessionId)
  check('cross-visitor write fails', forbidden === 410)
  check('original visitor remains unchanged', !(await read(client)).doc.content.includes('不可跨游客'))
  await send('Target.disposeBrowserContext', { browserContextId: context.browserContextId })

  // Reload proves both body persistence and a token-free local binding.
  const beforeReload = await editor()
  await send('Page.reload', {}, sessionId)
  await waitFor('Boolean(window.__mopaiCodemirror)', 'reload')
  check('body survives reload with active grant', await editor() === beforeReload)
  check('local storage does not contain bearer', !(await ev('JSON.stringify(localStorage)')).includes(token))
  await openMcp()
  check('raw token is not recovered after reload', !(await ev(`Boolean(document.querySelector('input[aria-label="MCP Authorization"]'))`)))
  await click(select('[data-mcp-rotate]'))
  await waitFor(`Boolean(document.querySelector('input[aria-label="MCP Authorization"]'))`, 'rotated credentials')
  const rotated = (await ev(`document.querySelector('input[aria-label="MCP Authorization"]').value`)).replace(/^Bearer /, '')
  const probe = (value) => fetch(`${appUrl}api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${value}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  check('rotation invalidates the previous token', (await probe(token)).status === 401)
  token = rotated
  await click(select('[data-mcp-revoke]'))
  await waitFor(`Boolean(document.querySelector('[data-mcp-create]'))`, 'revoke')
  check('revocation invalidates access immediately', (await probe(token)).status === 401)
  await closeDialog()
  const afterRevoke = beforeReload + '\n撤销后继续本机编辑。\n'
  await edit(afterRevoke)
  await sleep(800)
  await send('Page.reload', {}, sessionId)
  await waitFor('Boolean(window.__mopaiCodemirror)', 'revoked draft reload')
  check('revoked local draft remains complete and editable', await editor() === afterRevoke)

  await openMcp()
  await click(select('[data-mcp-create]'))
  await waitFor(`Boolean(document.querySelector('input[aria-label="MCP Authorization"]'))`, 'new grant')
  token = (await ev(`document.querySelector('input[aria-label="MCP Authorization"]').value`)).replace(/^Bearer /, '')
  await closeDialog()
  sql = new DatabaseSync(dbFile)
  sql.prepare('UPDATE remote_mcp_connections SET expiresAt = ? WHERE localDocId = ?').run(Date.now() - 1, id)
  check('expired token fails before cleanup', (await probe(token)).status === 401)
  await waitFor(`!document.querySelector('[data-mcp-editor-status]')`, 'expired binding detached')
  check('expiry preserves browser body', await editor() === afterRevoke)
  await sleep(700)
  await send('Page.reload', {}, sessionId)
  await waitFor('Boolean(window.__mopaiCodemirror)', 'expired draft reload')
  check('expired local draft survives reopen', await editor() === afterRevoke)

  // Current editor screenshots, with no token-bearing dialog visible.
  await edit(demoContent)
  await sleep(800)
  await click(`[...document.querySelectorAll('[role="tab"]')].find(e => e.textContent.includes('图片'))`)
  await ev(`localStorage.setItem('mopai.theme.v1','akari'); true`)
  await send('Page.reload', {}, sessionId)
  await waitFor('Boolean(window.__mopaiCodemirror)', 'light screenshot')
  await ev('document.fonts.ready.then(()=>true)')
  await shot(path.resolve('docs/images/editor-akari.png'))
  await ev(`localStorage.setItem('mopai.theme.v1','yoru'); true`)
  await send('Page.reload', {}, sessionId)
  await waitFor('Boolean(window.__mopaiCodemirror)', 'dark screenshot')
  await ev('document.fonts.ready.then(()=>true)')
  await shot(path.resolve('docs/images/editor-yoru.png'))
  check('dark theme wires the new entry', await ev(`document.documentElement.dataset.theme==='yoru' && document.documentElement.classList.contains('dark') && Boolean(document.querySelector('[data-open-ai-writing]'))`))
  console.log(`Screenshots: ${shots}`)
} finally {
  for (const client of clients) await client.close().catch(() => {})
  sql?.close()
  ws?.close()
  chrome?.kill()
  app.kill()
  await new Promise((resolve) => worker.close(resolve))
  await sleep(500)
  // Exact mkdtemp directory, never user data; Chrome may briefly retain a lock.
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* disposable profile still closing */ }
}
console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
process.exitCode = failures ? 1 : 0
