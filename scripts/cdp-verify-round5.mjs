// Real-browser verification for round 5:
//   A. batch-uploading into a carousel whose slides have DIFFERENT captions
//      fills every slide (the old code refused every file after the first)
//   B. deleting a doc shows an undo toast and 撤销 restores the doc
//   C. Mod-B / Mod-K / Mod-Shift-I editor shortcuts
//   D. docs.save on an unknown id answers missing=true and creates no row
//   E. an auto-save that finds its row gone (deleted "on another device")
//      downgrades the article to a local draft instead of reviving it
//
// Usage: node scripts/cdp-verify-round5.mjs [appUrl]
// The ACCESS_KEY is read from .env so nothing secret lives in this file.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Everything here talks to 127.0.0.1, but this host exports a global HTTP
// proxy that would swallow those requests. Drop it for this process.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3200'
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const ACCESS_KEY = envText.match(/^ACCESS_KEY=(.+)$/m)?.[1].trim()
if (!ACCESS_KEY) throw new Error('ACCESS_KEY not found in .env')

const PORT = 9333
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-r5-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// Three tiny PNGs with distinct names so we can clean them out of R2 later.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const tmpFiles = ['round5-a.png', 'round5-b.png', 'round5-c.png'].map((n) => {
  const p = path.join(profile, n)
  fs.writeFileSync(p, Buffer.from(PNG_B64, 'base64'))
  return p
})

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,900',
    // The host sets http_proxy globally; without this the browser sends
    // localhost requests to the proxy and gets a connection refused page.
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
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
      }, 30000)
    })
}

const results = []
function check(group, name, ok, detail = '') {
  results.push({ group, name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${group} :: ${name}${detail ? ` — ${detail}` : ''}`)
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = makeClient(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
// A fresh profile would meet the first-run tour on the editor; this suite
// drives the app as a returning visitor.
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' }, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)

const pageErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params?.exceptionDetails?.text || 'unknown')
  }
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

const trpc = (proc, body) =>
  evaluate(
    `fetch('/api/trpc/${proc}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:${JSON.stringify(body ?? {})}})}).then(r=>r.json()).then(d=>d.error?{__error:d.error}:(d.result?.data?.json??null))`,
  )

// Queries ride GET; a POST with an empty json body gets rejected.
const trpcQuery = (proc) =>
  evaluate(`fetch('/api/trpc/${proc}').then(r=>r.json()).then(d=>d.error?{__error:d.error}:(d.result?.data?.json??null))`)

// Radix dropdown triggers open on pointerdown, not click.
const openDocMenu = () =>
  evaluate(`(() => {
    const t = [...document.querySelectorAll('header button')].find(b => b.title === '切换稿件')
    if (!t) return 'no-trigger'
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    return 'ok'
  })()`)

const menuItems = () =>
  evaluate(`[...document.querySelectorAll('[role=menuitem]')].map(m => m.textContent.trim())`)

const toastTexts = () =>
  evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent.slice(0, 90))`)

const setDoc = async (markdown) => {
  const ok = await evaluate(`(() => {
    const view = window.__mopaiCodemirror
    if (!view) return false
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(markdown)} } })
    return true
  })()`)
  await sleep(600)
  return ok
}

const readDoc = () => evaluate(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : null`)

const clickRowButton = (no, label) =>
  evaluate(`(() => {
    const rows = [...document.querySelectorAll('aside li')]
    for (const row of rows) {
      const badge = row.querySelector('span')
      if (!badge || badge.textContent.trim() !== ${JSON.stringify(no)}) continue
      const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked'
    }
    return 'no-row'
  })()`)

const sidebarRows = () =>
  evaluate(`[...document.querySelectorAll('aside li')].map(r => ({
    no: r.querySelector('span')?.textContent.trim(),
    state: [...r.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => t === '已传图' || t === '待插图'),
  }))`)

const bodyText = () => evaluate(`document.body.innerText`)

async function feedFiles(files) {
  const { root } = await send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId)
  await send('DOM.setFileInputFiles', { nodeId, files }, sessionId)
}

const keyEvent = async (key, code, keyCode, modifiers) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers }, sessionId)
}

// ---------------------------------------------------------------------------

await send('Page.navigate', { url: APP }, sessionId)
await sleep(3500)
await trpc('auth.login', { accessKey: ACCESS_KEY })
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4000)

const ready = await evaluate(`!!document.querySelector('aside') && !!window.__mopaiCodemirror`).catch(() => false)
check('boot', 'editor and sidebar are mounted', ready === true)
if (!ready) {
  console.log(JSON.stringify(await evaluate(`document.body.innerText.slice(0,400)`)))
  chrome.kill()
  process.exit(1)
}

// ==== A. carousel batch upload, distinct captions ==========================
console.log('\n=== A: batch upload into a carousel with three DIFFERENT captions ===')
const DISTINCT_CAROUSEL = `## 01 | 批量测试

:::carousel 4:3 不同图注轮播
![外观]()
![细节]()
![上身]()
:::

结束
`
await setDoc(DISTINCT_CAROUSEL)
await sleep(800)
const rows0 = await sidebarRows()
console.log('  sidebar before:', JSON.stringify(rows0))
check('A', 'three placeholder slides are listed', Array.isArray(rows0) && rows0.length === 3 && rows0.every((r) => r.state === '待插图'))

// Click 上传 on the FIRST slide, then hand the file input all three files.
const up = await clickRowButton('图1-1', '上传')
check('A', 'slide 1 has an upload button', up === 'clicked', up)
await sleep(300)
await feedFiles(tmpFiles)
await sleep(1500)
const dlgState = await evaluate(`(() => {
  const dlg = document.querySelector('[role=dialog]')
  if (!dlg) return 'no-dialog'
  return [...dlg.querySelectorAll('button')].map(b => b.textContent.trim()).join(' | ')
})()`)
console.log('  dialog buttons:', dlgState)
// Ratio picker: pick 4:3 explicitly, then confirm.
const picked = await evaluate(`(() => {
  const dlg = document.querySelector('[role=dialog]')
  if (!dlg) return 'no-dialog'
  const opt = [...dlg.querySelectorAll('button')].find(b => b.textContent.includes('4:3'))
  if (opt) opt.click()
  return 'ok'
})()`)
check('A', 'ratio picker opened', picked === 'ok', picked)
await sleep(300)
const confirmed = await evaluate(`(() => {
  const dlg = document.querySelector('[role=dialog]')
  if (!dlg) return 'no-dialog'
  const btn = [...dlg.querySelectorAll('button')].find(b => b.textContent.includes('上传') && !b.disabled)
  if (!btn) return 'no-confirm'
  btn.click()
  return 'clicked: ' + btn.textContent.trim()
})()`)
console.log('  confirm:', confirmed)
await sleep(4000)
console.log('  toasts after confirm:', JSON.stringify(await toastTexts()))

// Wait for the three uploads to land in the markdown.
let filled = null
for (let i = 0; i < 60; i++) {
  await sleep(1000)
  filled = await readDoc()
  if ((filled.match(/img:[A-Za-z0-9_-]+/g) || []).length >= 3) break
}
console.log('  markdown after batch upload:\n' + String(filled).split('\n').map((l) => '    ' + l).join('\n'))
const slideLines = String(filled).split('\n').filter((l) => l.startsWith('!['))
check('A', 'all three slides were filled', slideLines.length === 3 && slideLines.every((l) => /img:/.test(l)))
check('A', 'slide captions stayed in place', /!\[外观\]\(img:/.test(filled) && /!\[细节\]\(img:/.test(filled) && /!\[上身\]\(img:/.test(filled))
check('A', 'no "没有对应的空位" refusal was shown', !(await bodyText()).includes('没有对应的空位'))
const rows1 = await sidebarRows()
check('A', 'sidebar reports all three 已传图', Array.isArray(rows1) && rows1.every((r) => r.state === '已传图'), JSON.stringify(rows1))

// ==== B. undo delete =======================================================
console.log('\n=== B: delete a doc, then undo it ===')
// Create a second doc so the delete button renders (it hides for the last doc).
console.log('  open menu:', await openDocMenu())
await sleep(600)
const created = await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.trim().startsWith('新建'))
  if (!item) return 'no-item'
  item.click()
  return 'clicked'
})()`)
console.log('  create second doc:', created)
await sleep(800)
await openDocMenu()
await sleep(600)
const menuNames = await menuItems()
console.log('  docs in menu:', JSON.stringify(menuNames))
check('B', 'a second doc exists so delete is offered', Array.isArray(menuNames) && menuNames.length >= 2)

const del = await evaluate(`(() => {
  const items = [...document.querySelectorAll('[role=menuitem]')]
  for (const it of items) {
    if (!it.textContent.includes('示例稿')) continue
    const btn = [...it.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')
    if (btn) { btn.click(); return 'clicked: ' + it.textContent.slice(0, 20) }
  }
  return 'no-delete-button'
})()`)
check('B', 'delete button clicked on the carousel doc', String(del).startsWith('clicked'), String(del))
await sleep(800)
const toastText = (await toastTexts()).join('|')
check('B', 'undo toast appeared', toastText.includes('已删除') && toastText.includes('撤销'), toastText.slice(0, 80))
// Menu should no longer list the doc.
await openDocMenu()
await sleep(500)
const menuAfterDelete = (await menuItems()).join('|')
check('B', 'doc is gone from the menu', !menuAfterDelete.includes('示例稿'), menuAfterDelete.slice(0, 80))
// Press Escape to close the menu, then hit 撤销.
await keyEvent('Escape', 'Escape', 27, 0)
await sleep(300)
const undo = await evaluate(`(() => {
  for (const t of [...document.querySelectorAll('[data-sonner-toast]')]) {
    const btn = [...t.querySelectorAll('button')].find(b => b.textContent.trim() === '撤销')
    if (btn) { btn.click(); return 'clicked' }
  }
  return 'no-undo-button'
})()`)
check('B', 'undo button clicked', undo === 'clicked', undo)
await sleep(1000)
const restored = await readDoc()
check('B', 'doc content is back after undo', typeof restored === 'string' && restored.includes(':::carousel 4:3 不同图注轮播'))

// ==== C. editor shortcuts ==================================================
console.log('\n=== C: Mod-B / Mod-K / Mod-Shift-I ===')
await setDoc('加粗测试\n\n链接文字\n\n末尾\n')
await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  view.focus()
  view.dispatch({ selection: { anchor: 0, head: 4 } })
})()`)
await sleep(200)
await keyEvent('b', 'KeyB', 66, 2) // Ctrl+B
await sleep(300)
let doc = await readDoc()
check('C', 'Ctrl+B wraps the selection in **', doc.startsWith('**加粗测试**'), doc.split('\n')[0])

const linkFrom = doc.indexOf('链接文字')
await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  view.focus()
  view.dispatch({ selection: { anchor: ${linkFrom}, head: ${linkFrom + 4} } })
})()`)
await sleep(200)
await keyEvent('k', 'KeyK', 75, 2) // Ctrl+K
await sleep(300)
doc = await readDoc()
check('C', 'Ctrl+K turns the selection into a link', doc.includes('[链接文字]()'), doc.split('\n')[2])

await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  view.focus()
  view.dispatch({ selection: { anchor: view.state.doc.length } })
})()`)
await sleep(200)
await keyEvent('I', 'KeyI', 73, 10) // Ctrl+Shift+I
await sleep(300)
doc = await readDoc()
check('C', 'Ctrl+Shift+I inserts an image placeholder', doc.includes('![图注]()'))
const selText = await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  const s = view.state.selection.main
  return view.state.sliceDoc(s.from, s.to)
})()`)
check('C', 'placeholder 图注 is left selected', selText === '图注', JSON.stringify(selText))

// ==== D. save on an unknown id must not create a row =======================
console.log('\n=== D: zombie-guard on docs.save ===')
const ghost = await trpc('docs.save', { id: 'ghost-r5', name: '复活稿', content: '# 诈尸\n', updatedAt: Date.now() })
check('D', 'server answers missing=true', ghost && ghost.missing === true, JSON.stringify(ghost))
const listAfterGhost = await trpcQuery('docs.list')
check('D', 'no ghost row was created', Array.isArray(listAfterGhost) && !listAfterGhost.some((d) => d.id === 'ghost-r5'), JSON.stringify(listAfterGhost).slice(0, 120))

// ==== E. auto-save hitting a deleted row downgrades to a local draft =======
console.log('\n=== E: another-device delete during editing ===')
await trpc('docs.saveToDrafts', { id: 'zombie-r5', name: '复活测试', content: '# 复活测试\n', updatedAt: Date.now() })
await send('Page.navigate', { url: APP }, sessionId)
await sleep(4500)
// The previously active doc wins on reload, so switch to 复活测试 explicitly.
await openDocMenu()
await sleep(600)
const switched = await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('复活测试'))
  if (!item) return 'no-item'
  item.click()
  return 'clicked'
})()`)
await sleep(800)
console.log('  switch to zombie doc:', switched, '| active now:', await evaluate(`document.querySelector('header input')?.value`))
// Simulate another device deleting the article: same mutation, direct fetch,
// so this browser's React state still believes the doc is archived.
await trpc('docs.remove', { id: 'zombie-r5' })
// Type into the still-archived local copy and wait out the 900ms debounce.
await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  view.focus()
  view.dispatch({ changes: { from: view.state.doc.length, insert: '补一句\\n' } })
})()`)
await sleep(3500)
console.log('  toasts after auto-save:', JSON.stringify(await toastTexts()))
const noticeShown = (await bodyText()).includes('已转为本地稿')
check('E', 'downgrade notice appeared after the failed auto-save', noticeShown)
const listAfterZombie = await trpcQuery('docs.list')
check('E', 'the article was NOT revived server-side', Array.isArray(listAfterZombie) && !listAfterZombie.some((d) => d.id === 'zombie-r5'))

// ==== cleanup: remove the three uploaded test images from R2 ===============
console.log('\n=== cleanup ===')
const stored = await trpcQuery('storage.list')
const ourKeys = Array.isArray(stored) ? stored.filter((f) => /^round5-[abc]\.png$/.test(f.name || '')).map((f) => f.key) : []
if (ourKeys.length) {
  const rm = await trpc('storage.removeOrphans', { keys: ourKeys })
  console.log('  removed test uploads:', JSON.stringify(rm))
  check('cleanup', 'test images removed from R2', rm && rm.deleted === ourKeys.length, JSON.stringify(rm))
} else {
  console.log('  (no test uploads found — nothing to clean)')
}

console.log('\n=== page errors ===')
check('runtime', 'no uncaught exceptions in the page', pageErrors.length === 0, pageErrors.join(' | '))

ws.close()
chrome.kill()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
