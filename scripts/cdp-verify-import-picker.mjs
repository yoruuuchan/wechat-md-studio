// Verify the import chooser sees the right accept filter at click time, then
// drive real Markdown, JSON bundle and DOCX files through the same hidden input.
// Usage: node scripts/cdp-verify-import-picker.mjs <url> [cdpPort=9347]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:3109'
const CDP = Number(process.argv[3] || 9347)
const docxFixture = path.resolve('node_modules/mammoth/test/test-data/single-paragraph.docx')
const hasDocx = fs.existsSync(docxFixture)
const docxBase64 = hasDocx ? fs.readFileSync(docxFixture).toString('base64') : ''
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-import-'))
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
const waitFor = async (expression, label, timeout = 30000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(150)
  }
  throw new Error(`timeout: ${label}`)
}

const openImport = async () => {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '导入')
    if (!button) throw new Error('Import button missing')
    button.focus()
    return true
  })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, sessionId)
  await waitFor(`document.querySelector('[role="menu"]') !== null`, 'import menu')
}

const choose = async (label) => {
  await openImport()
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find((node) => node.textContent.includes(${JSON.stringify(label)}))
    if (!item) throw new Error('missing import item: ${label}')
    item.click()
    return true
  })()`)
  await sleep(200)
}

const importFile = async (name, type, base64) => {
  await evaluate(`(() => {
    const input = document.querySelector('input[type=file]:not([multiple])')
    if (!input) throw new Error('Import input missing')
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0))
    const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    Object.defineProperty(input, 'files', { value: transfer.files, configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

const names = () => evaluate(`(() => {
  const index = JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}')
  return index.docs.map((doc) => doc.name)
})()`)

try {
  await send('Page.navigate', { url: APP }, sessionId)
  await waitFor(`window.__mopaiCodemirror !== undefined`, 'editor')
  await waitFor(`document.querySelector('[data-onboarding="preview"] section') !== null`, 'preview')
  await evaluate(`(() => {
    window.__importPicks = []
    const native = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && !this.multiple) {
        window.__importPicks.push({ accept: this.accept })
        return
      }
      return native.call(this)
    }
    return true
  })()`)

  for (const label of ['Markdown 文件', 'Word 文档', '整包备份', 'Word 文档', 'Markdown 文件', '整包备份']) {
    await choose(label)
  }
  const accepts = (await evaluate(`window.__importPicks.map((pick) => pick.accept)`)).map((value) =>
    value === '.md,.markdown,.txt' ? 'markdown' : value === '.docx' ? 'docx' : value === '.json' ? 'bundle' : value,
  )
  check('each picker click has its own file filter', JSON.stringify(accepts) === JSON.stringify([
    'markdown', 'docx', 'bundle', 'docx', 'markdown', 'bundle',
  ]), JSON.stringify(accepts))

  const md = Buffer.from('# Markdown 导入\n\nR09_MARKDOWN_BODY\n').toString('base64')
  const bundle = Buffer.from(JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    docs: [{
      id: 'r09-bundle',
      name: 'R09 备份稿',
      content: '# 备份导入\n\nR09_BUNDLE_BODY\n',
      updatedAt: Date.now(),
      savedAt: null,
      deletedAt: null,
    }],
  })).toString('base64')

  await choose('Markdown 文件')
  await importFile('r09-import.md', 'text/markdown', md)
  await waitFor(`JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}').docs.some((d) => d.name === 'Markdown 导入')`, 'Markdown import')
  await choose('整包备份')
  await importFile('r09-backup.json', 'application/json', bundle)
  await waitFor(`JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}').docs.some((d) => d.name === 'R09 备份稿')`, 'bundle import')
  check('Markdown and bundle both import through the same input', (await names()).includes('Markdown 导入') && (await names()).includes('R09 备份稿'))

  if (hasDocx) {
    await choose('Word 文档')
    await importFile('r09.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBase64)
    await waitFor(`[...document.querySelectorAll('[data-sonner-toast]')].some((node) => node.innerText.includes('已导入'))`, 'DOCX import toast', 30000)
    check('DOCX imports after selecting the DOCX filter', true)
  } else {
    console.log('[SKIP] DOCX fixture unavailable')
  }

  await waitFor(`[...document.querySelectorAll('button')].some((node) => node.textContent.trim() === '导入' && !node.disabled)`, 'import controls to settle')
  const beforeRepeat = (await names()).length
  await choose('Markdown 文件')
  await importFile('r09-import.md', 'text/markdown', md)
  await waitFor(`JSON.parse(localStorage.getItem('mopai.index.v2') || '{"docs":[]}').docs.length > ${beforeRepeat}`, 'repeated Markdown import')
  check('the same file can be selected again without a stale parser/type', (await names()).length > beforeRepeat)
  check('no uncaught browser exceptions', exceptions.length === 0, JSON.stringify(exceptions).slice(0, 300))
} finally {
  try { await send('Browser.close') } catch { /* already closed */ }
  ws.close()
  chrome.kill()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
