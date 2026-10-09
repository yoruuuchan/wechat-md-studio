// Headless-Chrome acceptance for copying part of the WeChat preview.
//
// Selecting a slice of the article and pressing a real Ctrl/Cmd+C must put a
// self-contained fragment on the clipboard: the article root <section>, every
// ancestor with its inline style, exactly the selected content and nothing
// outside it - while the full-document "复制到公众号" button keeps writing the
// whole article, and selections outside the article keep the browser's native
// copy untouched.
//
//   node scripts/cdp-verify-selection-copy.mjs [appUrl] [accessKey] [cdpPort]
//
// Run against a local production build on its own port and database - never
// against the deployed site.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appUrl = process.argv[2] || 'http://127.0.0.1:3205/'
const accessKey = process.argv[3] || process.env.ACCESS_KEY || ''
const PORT = Number(process.argv[4] || 9338)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-copy-shots-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
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
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('no CDP endpoint')
}

let id = 1
function client(ws) {
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
      const i = id++
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i)
          reject(new Error('timeout ' + method))
        }
      }, 30000)
    })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)
// Headless pages count as backgrounded unless focus is emulated, and the
// clipboard read API refuses to run in a document it believes is unfocused.
await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {})
await send(
  'Browser.grantPermissions',
  {
    origin: new URL(appUrl).origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  },
)

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(3500)
}

async function waitFor(expression, timeoutMs = 20000, label = expression) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if (await evaluate(expression)) return true
    } catch {
      /* page may still be settling */
    }
    await sleep(250)
  }
  throw new Error('waitFor timed out: ' + label)
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(shots, name + '.png')
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

// ---------------------------------------------------------------------------
await goto(appUrl)
if (accessKey) {
  await evaluate(
    `fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({json:{accessKey:${JSON.stringify(accessKey)}}})}).then(r=>r.text())`,
  )
  await goto(appUrl)
}

console.log('=== boot ===')
await waitFor(`!!window.__mopaiCodemirror && !!document.querySelector('div.px-1.py-6')`, 25000, 'editor + preview')
check('editor and preview are mounted', true)

// A document that exercises every shape a partial selection can take. Each
// needle below is unique in the article so a selection can be addressed by the
// text it contains. The image src is absolute on purpose: Chromium drops
// relative URLs from clipboard HTML it receives through setData, and the app's
// own image references are absolute too (window.location.origin + /api/img/...).
const IMG_SRC = new URL(appUrl).origin + '/favicon.svg'
const FIXTURE = `## 01 | 局部复制验收

第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。

行内样式段落：前面普通，**加粗文字出来**，==重点文字出场==，后面普通文字。

第二段接着展开，跨段落选择会从这一段的中间开始。

:::quote
引文框里的第一句需要保留边框样式。
引文框里的第二句同样要保留。
:::

> 金句卡片一句话收束观点。

- 列表第一项内容
- 列表第二项内容
- 列表第三项内容

| 表头甲 | 表头乙 |
| --- | --- |
| 单元格甲 | 单元格乙 |
| 单元格丙 | 单元格丁 |

![验收配图](${IMG_SRC})

图片下方的收尾段落。
`

const setDoc = await evaluate(`(() => {
  const view = window.__mopaiCodemirror
  if (!view) return false
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(FIXTURE)} } })
  return true
})()`)
check('fixture document is written into the editor', setDoc === true)
await waitFor(
  `document.querySelector('div.px-1.py-6').innerText.includes('图片下方的收尾段落')`,
  15000,
  'preview renders the fixture',
)

// The probe listens on the document, after (and above) the app's own handler:
// by the time it runs, a handled copy has already set its data and prevented
// the default.
await evaluate(`(() => {
  window.__copyProbe = { count: 0, events: [] }
  document.addEventListener('copy', (e) => {
    const rec = { prevented: e.defaultPrevented }
    try {
      rec.html = e.clipboardData.getData('text/html')
      rec.text = e.clipboardData.getData('text/plain')
    } catch { /* no clipboard data */ }
    window.__copyProbe.count++
    window.__copyProbe.events.push(rec)
  })
  return true
})()`)

const probeLast = async () => JSON.parse(await evaluate(`JSON.stringify({
  count: window.__copyProbe.count,
  last: window.__copyProbe.events[window.__copyProbe.events.length - 1] || null,
})`))

const readClipboard = () =>
  evaluate(`(async () => {
    const out = {}
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        if (item.types.includes('text/html')) out.html = await (await item.getType('text/html')).text()
        if (item.types.includes('text/plain')) out.text = await (await item.getType('text/plain')).text()
      }
    } catch (e) {
      out.error = String((e && e.message) || e)
    }
    return out
  })()`)

// A real Ctrl+C through the input pipeline: rawKeyDown + keyUp with the Ctrl
// modifier is what a keyboard copy looks like to the page.
async function ctrlCopy() {
  const before = (await probeLast()).count
  await send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 },
    sessionId,
  )
  await sleep(60)
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 },
    sessionId,
  )
  for (let i = 0; i < 24; i++) {
    await sleep(125)
    if ((await probeLast()).count > before) return true
  }
  return false
}

// Addressing: every selection is made between two text nodes found by unique
// content, with offsets relative to the needle's own start.
const selectByText = (a, ai, b, bi) =>
  evaluate(`(() => {
    const root = document.querySelector('div.px-1.py-6').firstElementChild
    const find = (needle) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue.includes(needle)) return n
      }
      throw new Error('needle not found: ' + needle)
    }
    const A = find(${JSON.stringify(a)})
    const B = find(${JSON.stringify(b)})
    const range = document.createRange()
    range.setStart(A, A.nodeValue.indexOf(${JSON.stringify(a)}) + ${ai})
    range.setEnd(B, B.nodeValue.indexOf(${JSON.stringify(b)}) + ${bi})
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return sel.toString()
  })()`)

// The image case needs element endpoints: start before the <img>, end after
// the caption text. Text-only addressing cannot express that.
const selectFigure = () =>
  evaluate(`(() => {
    const root = document.querySelector('div.px-1.py-6').firstElementChild
    const img = root.querySelector('img')
    if (!img) throw new Error('no image in the preview')
    const figure = img.parentElement
    const caption = figure.nextElementSibling
    const captionText = (caption.querySelector('span') || caption).firstChild
    const range = document.createRange()
    range.setStart(figure, 0)
    range.setEnd(captionText, captionText.nodeValue.length)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return sel.toString()
  })()`)

// One case performed with a real mouse drag instead of a scripted range: the
// press lands on the first character of "局部选择", the release on its last.
// Boundary jitter is tolerated - the point is that a dragged selection travels
// through the same copy path.
async function dragOverNeedle(needle, chars) {
  const rect = await evaluate(`(() => {
    const root = document.querySelector('div.px-1.py-6').firstElementChild
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.nodeValue.indexOf(${JSON.stringify(needle)})
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(n, at)
      range.setEnd(n, at + ${chars})
      const r = range.getBoundingClientRect()
      return JSON.stringify({ x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2 })
    }
    throw new Error('needle not found for drag')
  })()`)
  const { x1, x2, y } = JSON.parse(rect)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y, buttons: 0 }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId)
  await sleep(80)
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 6, y, button: 'left', buttons: 1 }, sessionId)
    await sleep(40)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId)
  await sleep(250)
  return evaluate('window.getSelection().toString()')
}

// Every fragment is checked for shape in the page's own parser.
const validateFragment = (html) =>
  evaluate(`(() => {
    const d = document.createElement('div')
    d.innerHTML = ${JSON.stringify(html)}
    const root = d.firstElementChild
    return JSON.stringify({
      topLevel: d.children.length,
      tag: root ? root.tagName : null,
      rootStyle: root ? (root.getAttribute('style') || '') : '',
      className: /\\sclass=/.test(${JSON.stringify(html)}),
      idName: /\\sid=/.test(${JSON.stringify(html)}),
    })
  })()`).then(JSON.parse)

const ROOT_MARK = 'max-width:677px'
const PARA_ATTR = 'text-align:justify'
const count = (haystack, needle) => haystack.split(needle).length - 1
// The renderer's markup carries whitespace text nodes between blocks, and the
// OS adds block separators of its own, so plain text is compared with all
// whitespace - newlines and nbsp spacers included - squeezed out.
const normalize = (s) => (s || '').replace(/[\s\u00a0]+/g, '')

/** Copy the current selection with a real Ctrl+C and collect both evidence channels. */
async function copySelection(label) {
  const fired = await ctrlCopy()
  const probe = await probeLast()
  const clip = await readClipboard()
  const source = clip.html ? { html: clip.html, text: clip.text } : probe.last
  const ok =
    fired &&
    probe.last &&
    probe.last.prevented === true &&
    typeof source.html === 'string' &&
    source.html.replace(/^\s+/, '').startsWith('<section style="' + ROOT_MARK)
  if (!ok) {
    console.log(`  [debug] ${label}: probe=${JSON.stringify(probe.last ? { prevented: probe.last.prevented, html: probe.last.html?.slice(0, 80) } : null)}`)
    console.log(`  [debug] ${label}: clipboard=${JSON.stringify({ error: clip.error, html: clip.html?.slice(0, 80) })}`)
  }
  return { fired, probe, clip, source, ok }
}

/** One partial-copy case: select, real Ctrl+C, then assert the fragment's shape. */
async function caseCopy({ name, select, marker, expectedText, requiredStyle, forbidden = [] }) {
  console.log(`\n=== ${name} ===`)
  const selected = await select()
  check(`${name}: selection made`, typeof selected === 'string' && selected.length > 0, JSON.stringify(selected))
  const { ok, probe, clip, source } = await copySelection(name)
  check(`${name}: copy event handled (prevented + root section)`, ok)
  const html = source.html || ''
  check(`${name}: clipboard carries text/html and text/plain`, typeof clip.html === 'string' && typeof clip.text === 'string', clip.error || '')
  check(`${name}: fragment contains the selected marker`, html.includes(marker), JSON.stringify(marker))
  check(`${name}: fragment carries the ancestor inline style`, !requiredStyle || html.includes(requiredStyle), requiredStyle || '(none)')
  if (clip.text !== undefined) {
    check(`${name}: text/plain is the selected text`, clip.text.includes(marker), JSON.stringify(clip.text?.slice(0, 60)))
  }
  for (const text of forbidden) {
    check(`${name}: excludes "${text}"`, !html.includes(text))
  }
  if (expectedText !== undefined && clip.text !== undefined) {
    check(`${name}: text/plain matches the selection exactly`, normalize(clip.text) === normalize(expectedText), JSON.stringify({ got: clip.text, want: expectedText }))
  }
  if (html) {
    const shape = await validateFragment(html)
    check(`${name}: exactly one root <section>, no class/id`, shape.topLevel === 1 && shape.tag === 'SECTION' && !shape.className && !shape.idName, JSON.stringify(shape))
  }
  return { html, clip, probe }
}

// ---------------------------------------------------------------------------
console.log('\n=== A. a few characters in a normal paragraph (mouse drag) ===')
await evaluate(`document.querySelector('div.px-1.py-6').closest('[class*="overflow-y-auto"]').scrollTop = 0`)
await sleep(200)
const dragged = await dragOverNeedle('局部选择', 4)
console.log(`  selection after mouse drag: ${JSON.stringify(dragged)}`)
const dragSelected = dragged.includes('局部选择')
if (!dragSelected) {
  console.log('  mouse drag did not land a usable selection in headless; falling back to a scripted range')
}
if (dragSelected) {
  await copySelection('A')
  const probeA = await probeLast()
  const clipA = await readClipboard()
  const htmlA = clipA.html || ''
  check('A: dragged selection is handled (prevented)', probeA.last?.prevented === true)
  check('A: clipboard html contains root + paragraph style', htmlA.startsWith('<section style="' + ROOT_MARK) && htmlA.includes(PARA_ATTR))
  check('A: clipboard html contains the dragged words', htmlA.includes('局部选择'))
  check('A: clipboard html excludes the rest of the paragraph', !htmlA.includes('第一段用来做') && !htmlA.includes('收尾部分'))
  check('A: clipboard plain text includes the dragged words', (clipA.text || '').includes('局部选择'))
  check('A: clipboard carries both formats', typeof clipA.html === 'string' && typeof clipA.text === 'string')
} else {
  await caseCopy({
    name: 'A. fallback scripted selection',
    select: () => selectByText('第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。', 6, '第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。', 10),
    marker: '局部选择',
    expectedText: '局部选择',
    requiredStyle: PARA_ATTR,
    forbidden: ['第一段用来做', '收尾部分'],
  })
}
const shotA = await screenshot('A-partial-paragraph')
console.log(`  screenshot: ${shotA}`)

console.log('\n=== toast ===')
await sleep(300)
const toastSeen = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('[data-sonner-toast]')].map((n) => n.textContent || '')
  return JSON.stringify({
    byAttr: nodes.some((t) => t.includes('已复制选中内容')),
    anywhere: document.body.innerText.includes('已复制选中内容，可直接粘贴到公众号'),
  })
})()`).then(JSON.parse)
check('toast tells the user the selection was copied', toastSeen.byAttr || toastSeen.any, JSON.stringify(toastSeen))

await caseCopy({
  name: 'B. the tail half of a paragraph',
  select: () => selectByText('第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。', 11, '第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。', 30),
  marker: '开头几个字',
  expectedText: '开头几个字，中间的一段，以及收尾部分。',
  requiredStyle: PARA_ATTR,
  forbidden: ['第一段用来做局部选择：'],
})

await caseCopy({
  name: 'C. across two normal paragraphs',
  // The range from mid-paragraph-1 to mid-paragraph-3 by definition crosses
  // paragraph 2 as well - all three must travel with their own <p> wrappers.
  select: () => selectByText('第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。', 6, '第二段接着展开，跨段落选择会从这一段的中间开始。', 8),
  marker: '局部选择',
  expectedText: '局部选择：开头几个字，中间的一段，以及收尾部分。行内样式段落：前面普通，加粗文字出来，重点文字出场，后面普通文字。第二段接着展开，',
  requiredStyle: PARA_ATTR,
  forbidden: ['第一段用来做'],
})

console.log('  [note] the multi-paragraph case above must carry every <p> wrapper it crossed:')
{
  const clip = await readClipboard()
  const html = clip.html || ''
  check('C: all crossed paragraphs kept their style', count(html, PARA_ATTR) === 3, `count=${count(html, PARA_ATTR)}`)
  check('C: the middle paragraph came along whole', html.includes('行内样式段落：前面普通，'))
  check('C: the last paragraph is included', html.includes('第二段接着展开，'))
  check('C: the last paragraph is cut at the selection end', !html.includes('跨段落选择会'))
}

await caseCopy({
  name: 'D. heading + body',
  select: () => selectByText('局部复制验收', 2, '第一段用来做局部选择：开头几个字，中间的一段，以及收尾部分。', 2),
  marker: '复制验收',
  expectedText: '复制验收第一',
  requiredStyle: '<h3 style="',
  forbidden: ['局部', '段用来'],
})

await caseCopy({
  name: 'E. bold and marked runs',
  select: () => selectByText('加粗文字出来', 0, '重点文字出场', 2),
  marker: '加粗文字出来',
  expectedText: '加粗文字出来，重点',
  requiredStyle: '<strong style="font-weight:700;">',
  forbidden: ['前面普通', '后面普通文字'],
})

await caseCopy({
  name: 'F. quote card',
  select: () => selectByText('金句卡片一句话收束观点。', 4, '金句卡片一句话收束观点。', 9),
  marker: '一句话收束',
  expectedText: '一句话收束',
  requiredStyle: 'background:#F6FAFF;border-left:3px solid #1677FF',
  forbidden: ['金句卡片', '观点。'],
})

await caseCopy({
  name: 'G. list',
  select: () => selectByText('列表第一项内容', 2, '列表第二项内容', 4),
  marker: '第一项内容',
  expectedText: '第一项内容列表第二',
  requiredStyle: '<ul style=',
  forbidden: ['列表第三项'],
})

await caseCopy({
  name: 'H. part of a table',
  select: () => selectByText('单元格甲', 2, '单元格乙', 4),
  marker: '格甲',
  expectedText: '格甲单元格乙',
  requiredStyle: '<table style=',
  forbidden: ['表头', '单元格丙'],
})

console.log('\n=== I. image and caption ===')
const selectedFigure = await selectFigure()
check('I: figure selection made', typeof selectedFigure === 'string' && selectedFigure.length > 0, JSON.stringify(selectedFigure))
{
  const { ok, clip, source } = await copySelection('I')
  const html = source.html || ''
  check('I: copy event handled', ok)
  check('I: clipboard carries both formats', typeof clip.html === 'string' && typeof clip.text === 'string', clip.error || '')
  check('I: img and caption kept together', html.includes('<img src="' + IMG_SRC + '"') && html.includes('图1 验收配图'), JSON.stringify({ hasImg: html.includes('<img'), hasCaption: html.includes('图1 验收配图') }))
  check('I: nothing after the caption is included', !html.includes('图片下方的收尾段落'))
  const shape = html ? await validateFragment(html) : null
  if (shape) check('I: exactly one root <section>, no class/id', shape.topLevel === 1 && shape.tag === 'SECTION' && !shape.className && !shape.idName, JSON.stringify(shape))
}

await caseCopy({
  name: 'J. from the middle of one module to the middle of the next',
  select: () => selectByText('金句卡片一句话收束观点。', 4, '列表第二项内容', 2),
  marker: '一句话收束',
  expectedText: '一句话收束观点。列表第一项内容列表',
  requiredStyle: 'background:#F6FAFF;border-left:3px solid #1677FF',
  forbidden: ['金句卡片', '第二项内容'],
})
{
  const clip = await readClipboard()
  const html = clip.html || ''
  check('J: the next module kept its list wrapper', html.includes('<ul style='))
  check('J: the full first list item survived', html.includes('列表第一项内容'))
}

console.log('\n=== K. a selection outside the article keeps the native copy ===')
await sleep(5500) // let the copy toasts expire so they cannot confuse the check
await evaluate(`(() => {
  const el = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === '预览 · 所见即所复制')
  if (!el) throw new Error('preview eyebrow not found')
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  return sel.toString()
})()`)
{
  const before = (await probeLast()).count
  await send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 },
    sessionId,
  )
  await sleep(60)
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 },
    sessionId,
  )
  await sleep(700)
  const probe = await probeLast()
  const clip = await readClipboard()
  check('K: the copy event still fired', probe.count > before)
  check('K: the app did not intercept it', probe.last?.prevented === false)
  check('K: the native copy still reached the clipboard', (clip.text || '').includes('所见即所复制'), JSON.stringify(clip.text))
  const toast = await evaluate(`document.body.innerText.includes('已复制选中内容')`)
  check('K: no selection-copy toast was raised', toast === false)
}

console.log('\n=== L. the full-document copy is unchanged ===')
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('复制到公众号'))
  if (!btn) throw new Error('copy button not found')
  btn.click()
  return true
})()`)
await sleep(900)
{
  const clip = await readClipboard()
  const html = clip.html || ''
  const text = clip.text || ''
  const buttonState = await evaluate(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '已复制')`,
  )
  check('L: full copy wrote text/html and text/plain', typeof clip.html === 'string' && typeof clip.text === 'string', clip.error || '')
  check('L: full copy starts at the article root', html.replace(/^\s+/, '').startsWith('<section style="' + ROOT_MARK))
  check('L: full copy contains the first paragraph', html.includes('第一段用来做局部选择') && text.includes('第一段用来做局部选择'))
  check('L: full copy contains the last paragraph', html.includes('图片下方的收尾段落') && text.includes('图片下方的收尾段落'))
  check('L: full copy is longer than any partial fragment', html.length > 2000, `len=${html.length}`)
  check('L: the copy button reports success', buttonState === true)
}

chrome.kill()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* Chrome may hold the profile */
}
console.log(`\nscreenshots kept in ${shots}`)
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
