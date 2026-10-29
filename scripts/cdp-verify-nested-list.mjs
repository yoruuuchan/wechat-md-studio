// Real Chrome acceptance for nested Markdown lists.
// Usage: node scripts/cdp-verify-nested-list.mjs <url> [cdpPort=9348]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:3117'
const CDP = Number(process.argv[3] || 9348)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-list-'))
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
const waitFor = async (expression, label, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value) return value
    await sleep(150)
  }
  throw new Error(`timeout: ${label}`)
}

try {
  await send('Page.navigate', { url: APP }, sessionId)
  await waitFor(`window.__mopaiCodemirror !== undefined`, 'editor')
  await waitFor(`(() => {
    const root = document.querySelector('[data-onboarding="preview"] section')
    return root && root.innerText.trim().length > 0
  })()`, 'initial preview')
  const markdown = [
    '# 列表验收',
    '',
    '- outer',
    '  - inner',
    '    - deep',
    '  - inner sibling',
    '- after',
    '',
    '3. three',
    '4. four',
    '   1. ordered child',
    '   2. child two',
    '5. five',
    '',
    '- first paragraph',
    '',
    '  second paragraph',
    '- final',
  ].join('\n')
  await evaluate(`(() => {
    const view = window.__mopaiCodemirror
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(markdown)} } })
    return true
  })()`)
  await waitFor(`(() => {
    const root = document.querySelector('[data-onboarding="preview"] section')
    return root?.innerText.includes('ordered child') ? root : null
  })()`, 'rendered nested list')

  const result = await evaluate(`(() => {
    const preview = document.querySelector('[data-onboarding="preview"]')
    const root = preview.querySelector('section')
    const leaf = (text) => [...root.querySelectorAll('span[leaf]')].find((n) => n.textContent === text)
    const listDepth = (text) => {
      let node = leaf(text)?.closest('li')
      let depth = 0
      while (node) {
        if (node.tagName === 'LI') depth++
        node = node.parentElement?.closest('li')
      }
      return depth
    }
    const order = [...root.querySelectorAll('span[leaf]')].map((node) => node.textContent.trim()).filter(Boolean)
    const expectedOrder = ['outer', 'inner', 'deep', 'inner sibling', 'after', 'three', 'four', 'ordered child', 'child two', 'five', 'first paragraph', 'second paragraph', 'final']
    const orderAt = expectedOrder.map((text) => order.indexOf(text))
    const ordered = leaf('three')?.closest('li')?.parentElement
    const childOrdered = leaf('ordered child')?.closest('li')?.parentElement
    const html = root.outerHTML
    return {
      depth: {
        outer: listDepth('outer'),
        inner: listDepth('inner'),
        deep: listDepth('deep'),
        innerSibling: listDepth('inner sibling'),
        after: listDepth('after'),
      },
      ordered: {
        tag: ordered?.tagName,
        start: ordered?.getAttribute('start'),
        childTag: childOrdered?.tagName,
      },
      orderAt,
      order,
      forbidden: {
        div: /<div[\\s>]/i.test(html),
        script: /<script[\\s>]/i.test(html),
        style: /<style[\\s>]/i.test(html),
        class: /\\sclass=/i.test(html),
        id: /\\sid=/i.test(html),
      },
      liCount: root.querySelectorAll('li').length,
    }
  })()`)

  check('three levels keep their list nesting', JSON.stringify(result.depth) === JSON.stringify({
    outer: 1, inner: 2, deep: 3, innerSibling: 2, after: 1,
  }), JSON.stringify(result.depth))
  check('ordered list starts at 3', result.ordered.tag === 'OL' && result.ordered.start === '3', JSON.stringify(result.ordered))
  check('nested ordered list keeps its own level', result.ordered.childTag === 'OL', String(result.ordered.childTag))
  check('all item text keeps source order', result.orderAt.every((at, i) => at >= 0 && (i === 0 || at > result.orderAt[i - 1])), JSON.stringify(result.orderAt))
  check('all twelve list items are present', result.liCount === 12, String(result.liCount))
  check('preview output has no div/script/style/class/id', !Object.values(result.forbidden).some(Boolean), JSON.stringify(result.forbidden))
  check('no uncaught browser exceptions', exceptions.length === 0, JSON.stringify(exceptions).slice(0, 300))
} finally {
  try { await send('Browser.close') } catch { /* already closed */ }
  ws.close()
  chrome.kill()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
