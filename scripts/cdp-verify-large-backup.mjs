// Verify a 1,000-article backup imports through the real editor, survives a
// reload, and does not overwrite an existing article when the same ids return.
// Usage: node scripts/cdp-verify-large-backup.mjs <url> [cdpPort=9710]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:4110'
const CDP = Number(process.argv[3] || 9710)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-large-backup-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1500,1000', 'about:blank',
], { stdio: 'ignore', windowsHide: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const makeBundle = (suffix = '') => Buffer.from(JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  docs: Array.from({ length: 1000 }, (_, i) => ({
    id: `r10-backup-${i}`,
    name: `${suffix}R10 稿件 ${i}`,
    content: `${suffix}正文 ${i}\n\n==备份==`,
    updatedAt: 1_700_000_000_000 + i,
    savedAt: null,
    deletedAt: null,
  })),
})).toString('base64')

let wsUrl = ''
for (let i = 0; i < 80; i++) {
  try {
    const info = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()
    if (info.webSocketDebuggerUrl) { wsUrl = info.webSocketDebuggerUrl; break }
  } catch { /* starting */ }
  await sleep(200)
}
if (!wsUrl) throw new Error('Chrome CDP did not start')

const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
let nextId = 1
const pending = new Map()
const exceptions = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params?.exceptionDetails)
  if (!message.id || !pending.has(message.id)) return
  const request = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  setTimeout(() => {
    if (!pending.has(id)) return
    pending.delete(id)
    reject(new Error(`CDP timeout: ${method}`))
  }, 30000)
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('mopai.onboarding.v1', 'done'); localStorage.setItem('mopai.lang.v1', 'zh') } catch {}`,
}, sessionId)

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
}
const waitFor = async (expression, label, timeout = 60000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(200)
  }
  throw new Error(`timeout: ${label}`)
}

const chooseBundle = async () => {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '导入')
    if (!button) throw new Error('Import button missing')
    button.focus()
    return true
  })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, sessionId)
  await waitFor(`document.querySelector('[role="menu"]') !== null`, 'import menu')
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find((node) => node.textContent.includes('整包备份'))
    if (!item) throw new Error('Bundle item missing')
    item.click()
    return true
  })()`)
}

const importBundle = async (base64) => evaluate(`(() => {
  const input = document.querySelector('input[type=file]:not([multiple])')
  if (!input) throw new Error('Import input missing')
  const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0))
  const file = new File([bytes], 'r10-large-backup.json', { type: 'application/json' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  Object.defineProperty(input, 'files', { value: transfer.files, configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return file.size
})()`)

const importedCount = () => evaluate(`(() => {
  const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
  return index.docs.filter((doc) => doc.name.includes('R10 稿件 ')).length
})()`)

const readFirstBody = () => evaluate(`new Promise((resolve, reject) => {
  const request = indexedDB.open('mopai', 2)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const db = request.result
    const tx = db.transaction('bodies', 'readonly')
    const get = tx.objectStore('bodies').get('r10-backup-0')
    get.onerror = () => reject(get.error)
    get.onsuccess = () => { db.close(); resolve(get.result?.content ?? '') }
  }
})`)

try {
  await send('Page.navigate', { url: APP }, sessionId)
  await waitFor(`window.__mopaiCodemirror !== undefined`, 'editor')

  await chooseBundle()
  const bytes = await importBundle(makeBundle())
  check('the generated backup is large enough to contain 1,000 articles', bytes > 100_000, `${bytes} bytes`)
  await waitFor(`(() => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    return index.docs.filter((doc) => doc.name.includes('R10 稿件 ')).length === 1000
  })()`, '1,000 imported article indexes')
  check('all 1,000 names are present in the local index', (await importedCount()) === 1000)
  const firstBody = await readFirstBody()
  check('article bodies moved to IndexedDB without loss', firstBody === '正文 0\n\n==备份==', JSON.stringify(firstBody))

  await send('Page.navigate', { url: APP }, sessionId)
  await sleep(2500)
  await waitFor(`(() => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    return index.docs.filter((doc) => doc.name.includes('R10 稿件 ')).length === 1000
  })()`, 'imported index after reload')
  check('the 1,000-article library survives reload', (await importedCount()) === 1000)

  await chooseBundle()
  await importBundle(makeBundle('覆盖尝试 '))
  await sleep(1500)
  const first = await evaluate(`(() => {
    const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
    const doc = index.docs.find((entry) => entry.id === 'r10-backup-0')
    return doc?.name ?? ''
  })()`)
  check('re-importing the same ids keeps the existing names', first === 'R10 稿件 0', first)
  check('re-importing the same ids keeps the existing body', (await readFirstBody()) === '正文 0\n\n==备份==')
  check('no uncaught browser exceptions', exceptions.length === 0, JSON.stringify(exceptions).slice(0, 300))
} finally {
  try { await send('Browser.close') } catch { /* already closed */ }
  ws.close()
  chrome.kill()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome can release late */ }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
