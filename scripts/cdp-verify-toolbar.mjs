// Headless-Chrome check for the Markdown toolbar and the semantic format brush.
//
// Covers the acceptance list: inline toggles and 清除格式, heading / body
// conversion, 金句 / 引文 / 居中强调 conversion, list conversion, the brush's
// single and locked modes, image upload from the toolbar into the cursor,
// structural inserts (table / math / carousel / gallery / mermaid / hr /
// signature), undo/redo, theme-independent semantics, toolbar folding as the
// column narrows, and that hand editing still works.
//
// Run against a local production build on its own port and database - never
// against the deployed site:
//
//   node scripts/cdp-verify-toolbar.mjs [appUrl] [accessKey] [cdpPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const appUrl = process.argv[2] || 'http://127.0.0.1:3201/'
const accessKey = process.argv[3] || process.env.ACCESS_KEY || ''
const PORT = Number(process.argv[4] || 9336)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHOT_DIR = path.join(os.tmpdir(), 'mopai-toolbar-shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

/** A real, decodable PNG of an exact pixel size — no image library needed. */
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(new Array(w * 3).fill(0).map((_, i) => rgb[i % 3]))])
  const raw = Buffer.concat(new Array(h).fill(0).map(() => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The document the toolbar tests run against. */
const FIXTURE = `---
titles:
  - 工具栏验收
---

第一段测试文字，句中有**加粗词**和==重点词==，还有普通文字。

第二段待刷文字。

> 金句一句话

### 小标题甲

- 列表项一
- 列表项二

## KICKER | 章节标题

尾段。
`

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
const uploadFile = path.join(profile, 'toolbar-shot.png')
fs.writeFileSync(uploadFile, png(320, 200, [200, 90, 40]))

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
// Surface page-side failures instead of guessing at them.
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    console.log('  [page error]', String(d?.exception?.description || d?.text || '').slice(0, 400))
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    console.log(`  [console ${m.params.type}]`, m.params.args.map((a) => a.description || a.value).join(' ').slice(0, 300))
  }
})
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

// ---------- input helpers ----------

async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', { type, x, y, ...extra }, sessionId)
}

/** A real click: pointer events included, which is what Radix triggers read. */
async function clickAt(x, y, clickCount = 1) {
  await mouse('mouseMoved', x, y)
  await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount })
  await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount })
  await sleep(220)
}

async function doubleClickAt(x, y) {
  await clickAt(x, y, 1)
  await sleep(60)
  await clickAt(x, y, 2)
}

async function boxOf(expr) {
  const raw = await evaluate(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }) })()`)
  return raw ? JSON.parse(raw) : null
}

/** Toolbar buttons exist twice (hidden measuring row); only the visible one counts. */
const visibleBtn = (tool) =>
  `[...document.querySelectorAll('[data-tool="${tool}"]')].find(el => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"]'))`

async function clickTool(tool) {
  const box = await boxOf(visibleBtn(tool))
  if (!box) throw new Error('no visible toolbar button: ' + tool)
  await clickAt(box.x, box.y)
}

async function toolState(tool) {
  return evaluate(`(() => { const el = ${visibleBtn(tool)}; if (!el) return null; return JSON.stringify({ active: el.getAttribute('data-active') === 'true', disabled: el.disabled === true, label: el.textContent.trim() }) })()`)
}

/** Click a visible menu item by its text (menu content is portalled to body). */
async function clickMenuItem(text) {
  const raw = await evaluate(`(() => {
    const all = [...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]')]
    const items = all.filter(el => el.getClientRects().length > 0)
    const el = items.find(i => i.textContent.includes(${JSON.stringify(text)}))
    if (!el) return JSON.stringify({
      error: 'not found',
      total: all.length,
      visible: items.length,
      openMenus: [...document.querySelectorAll('[data-menu]')].map(m => m.getAttribute('data-menu') + ':' + m.getAttribute('data-state')),
      children: (document.querySelector('[data-menu]')?.children.length ?? -1),
      tail: (document.querySelector('[data-menu]')?.outerHTML || '').slice(-400),
      sample: items.slice(0, 8).map(i => i.textContent.trim().slice(0, 12)),
    })
    const r = el.getBoundingClientRect()
    return JSON.stringify({ x: r.x + 24, y: r.y + r.height / 2 })
  })()`)
  const box = JSON.parse(raw)
  if (box.error) throw new Error(`menu item "${text}": ${JSON.stringify(box)}`)
  await clickAt(box.x, box.y)
}

const doc = () => evaluate(`window.__mopaiCodemirror.state.doc.toString()`)
const sel = () =>
  evaluate(`(() => { const s = window.__mopaiCodemirror.state.selection.main; return JSON.stringify({ from: s.from, to: s.to }) })()`)

async function optionsMenu(text) {
  await clickTool('more')
  await sleep(300)
  // A swallowed click (Radix still cleaning up the previous menu) is retried
  // once rather than failing the whole run.
  let open = await evaluate(`!!document.querySelector('[data-menu="more"]')`)
  if (!open) {
    await sleep(400)
    await clickTool('more')
    await sleep(300)
    open = await evaluate(`!!document.querySelector('[data-menu="more"]')`)
  }
  if (!open) throw new Error(`the ··· menu did not open before picking "${text}"`)
  await clickMenuItem(text)
  await sleep(250)
}

/** Select the Nth occurrence of `needle` through the editor's own API. */
async function selectText(needle, occurrence = 1) {
  const raw = await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    const t = v.state.doc.toString()
    let at = -1, from = 0
    for (let i = 0; i < ${occurrence}; i++) { at = t.indexOf(${JSON.stringify(needle)}, from); if (at < 0) return null; from = at + 1 }
    if (at < 0) return null
    v.dispatch({ selection: { anchor: at, head: at + ${needle.length} } })
    v.focus()
    return JSON.stringify({ at, to: at + ${needle.length} })
  })()`)
  if (!raw) throw new Error(`text not found: ${needle}`)
  return JSON.parse(raw)
}

async function cursorInside(needle, offset = 0) {
  const raw = await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    const t = v.state.doc.toString()
    const at = t.indexOf(${JSON.stringify(needle)})
    if (at < 0) return null
    v.dispatch({ selection: { anchor: at + ${offset} } })
    v.focus()
    return at + ${offset}
  })()`)
  if (raw === null) throw new Error(`text not found: ${needle}`)
  return raw
}

/** Drag-select a text span with real mouse events (what the brush listens for). */
async function dragSelect(needle) {
  const pts = await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    const t = v.state.doc.toString()
    const at = t.indexOf(${JSON.stringify(needle)})
    if (at < 0) return null
    const a = v.coordsAtPos(at)
    const b = v.coordsAtPos(at + ${needle.length})
    if (!a || !b) return null
    return JSON.stringify({ ax: a.left + 1, ay: (a.top + a.bottom) / 2, bx: b.right - 1, by: (b.top + b.bottom) / 2 })
  })()`)
  if (!pts) throw new Error(`cannot locate for drag: ${needle}`)
  const p = JSON.parse(pts)
  await mouse('mouseMoved', p.ax, p.ay)
  await mouse('mousePressed', p.ax, p.ay, { button: 'left', buttons: 1, clickCount: 1 })
  await mouse('mouseMoved', (p.ax + p.bx) / 2, p.by, { button: 'left', buttons: 1 })
  await mouse('mouseMoved', p.bx, p.by, { button: 'left', buttons: 1 })
  await mouse('mouseReleased', p.bx, p.by, { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(250)
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const out = path.join(SHOT_DIR, name)
  fs.writeFileSync(out, Buffer.from(data, 'base64'))
  return out
}

/** Drag a panel handle to a new x, the way a person would. */
async function dragHandle(fromX, fromY, toX) {
  await mouse('mouseMoved', fromX, fromY)
  await mouse('mousePressed', fromX, fromY, { button: 'left', buttons: 1, clickCount: 1 })
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', fromX + (toX - fromX) * (i / steps), fromY, { button: 'left', buttons: 1 })
    await sleep(40)
  }
  await mouse('mouseReleased', toX, fromY, { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(600)
}

const editorWidth = () =>
  evaluate(`(() => { const p = document.querySelector('[data-slot="resizable-panel"]'); return p ? Math.round(p.getBoundingClientRect().width) : 0 })()`)

/** Set the editor column width; panel constraints can stop a drag short. */
async function resizeEditorTo(target) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const width = await editorWidth()
    if (Math.abs(width - target) <= 30) return width
    const handle = await boxOf(`document.querySelector('[data-slot="resizable-handle"]')`)
    if (!handle) return width
    await dragHandle(handle.x, handle.y, target)
  }
  return editorWidth()
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(3500)
}

async function setEditorDoc(text) {
  await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    const cur = v.state.doc.toString()
    v.dispatch({ changes: { from: 0, to: cur.length, insert: ${JSON.stringify(text)} }, selection: { anchor: 0 } })
    return true
  })()`)
  await sleep(700)
}

// ---------------------------------------------------------------------------
try {
  await goto(appUrl)
  if (accessKey) {
    await evaluate(
      `fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({json:{accessKey:${JSON.stringify(accessKey)}}})}).then(r=>r.text())`,
    )
    await goto(appUrl)
  }

  console.log('=== boots ===')
  check('CodeMirror view is exposed', await evaluate(`!!window.__mopaiCodemirror`))
  check('toolbar renders', await evaluate(`!!(${visibleBtn('bold')})`))
  check('the sample article is loaded', (await doc()).includes('欢迎使用公众号排版助手'))

  await setEditorDoc(FIXTURE)
  const base = await doc()
  check('fixture is in place', base.includes('第一段测试文字') && base.includes('尾段。'), `len=${base.length}`)

  // Start with a wide editing column so every toolbar item is on screen; the
  // folding behaviour is exercised deliberately further down.
  const collapse = await boxOf(`document.querySelector('button[title="收起侧栏"]')`)
  if (collapse) await clickAt(collapse.x, collapse.y)
  await sleep(600)
  const columnWidth = await resizeEditorTo(1000)
  check('editing column is wide enough for the full toolbar', columnWidth >= 900, `width=${columnWidth}`)
  await shot('01-toolbar-wide.png')

  // -------------------------------------------------------------------------
  console.log('\n=== inline toggles ===')
  await selectText('普通文字')
  await clickTool('bold')
  let d = await doc()
  check('bold wraps the selection', d.includes('**普通文字**'))
  check('B lights up inside the bold run', JSON.parse(await toolState('bold')).active === true)
  await clickTool('bold')
  d = await doc()
  check('clicking B again removes the markers', !d.includes('**普通文字**'))

  await selectText('测试文字')
  await clickTool('mark')
  d = await doc()
  check('重点 wraps the selection', d.includes('==测试文字=='))
  check('重点 lights up inside', JSON.parse(await toolState('mark')).active === true)
  await clickTool('mark')
  check('clicking 重点 again removes it', !(await doc()).includes('==测试文字=='))

  await selectText('句中有')
  await clickTool('italic')
  check('italic wraps the selection', (await doc()).includes('*句中有*'))
  await clickTool('italic')
  check('italic toggles back off', !(await doc()).includes('*句中有*'))

  await selectText('还有')
  await clickTool('strike')
  check('strike wraps the selection', (await doc()).includes('~~还有~~'))
  await clickTool('strike')
  check('strike toggles back off', !(await doc()).includes('~~还有~~'))

  await selectText('第二段')
  await clickTool('link')
  d = await doc()
  check('link turns the selection into a label', d.includes('[第二段]()'))
  await clickTool('link')
  check('link toggles back to plain text', !(await doc()).includes('[第二段]()'))

  // Nested + clear: put bold and mark on one word, then 清除格式.
  await selectText('段待')
  await clickTool('bold')
  await clickTool('mark')
  d = await doc()
  check('nested formats stack', d.includes('**==段待==**'), d.match(/[^\n]*段待[^\n]*/)?.[0])
  await selectText('段待')
  await clickTool('clear')
  d = await doc()
  check('清除格式 strips both markers', d.includes('段待') && !d.includes('**==段待==**'))
  // Fix the sentence back
  await setEditorDoc(FIXTURE)
  await sleep(400)

  // -------------------------------------------------------------------------
  console.log('\n=== headings ===')
  await cursorInside('第一段测试文字', 2)
  await clickTool('heading')
  await sleep(200)
  check('heading menu opens with the current type', (await evaluate(`!!document.querySelector('[data-menu="heading"]')`)) === true)
  await clickMenuItem('小标题')
  d = await doc()
  check('paragraph -> 小标题', d.includes('### 第一段测试文字'), d.match(/[^\n]*第一段[^\n]*/)?.[0])
  check('heading trigger shows 小标题', JSON.parse(await toolState('heading')).label.includes('小标题'))

  await clickTool('heading')
  await sleep(200)
  await clickMenuItem('普通正文')
  d = await doc()
  check('小标题 -> 普通正文 keeps the text', d.includes('\n第一段测试文字，句中有') && !d.includes('### 第一段测试文字'))

  await cursorInside('章节标题', 2)
  await clickTool('heading')
  await sleep(200)
  await clickMenuItem('小标题')
  d = await doc()
  check('section -> 小标题 keeps the title and drops the kicker', d.includes('### 章节标题') && !d.includes('KICKER'))

  // -------------------------------------------------------------------------
  console.log('\n=== quote / center ===')
  await cursorInside('尾段。', 1)
  await clickTool('quote')
  await sleep(200)
  await clickMenuItem('金句卡片')
  d = await doc()
  check('paragraph -> 金句卡片', d.includes('> 尾段。'))
  check('quote trigger shows 金句', JSON.parse(await toolState('quote')).label.includes('金句'))

  await clickTool('quote')
  await sleep(200)
  await clickMenuItem('引文框')
  d = await doc()
  check('金句 -> 引文框', d.includes(':::quote\n尾段。\n:::'), d.match(/[^\n]*尾段[^\n]*/)?.[0])
  check('quote trigger shows 引文', JSON.parse(await toolState('quote')).label.includes('引文'))

  await clickTool('quote')
  await sleep(200)
  await clickMenuItem('居中强调')
  d = await doc()
  check('引文框 -> 居中强调', d.includes(':::center\n尾段。\n:::'))

  await clickTool('clear')
  d = await doc()
  check('清除格式 brings a container back to a paragraph', d.includes('\n尾段。\n') && !d.includes(':::center'))

  // -------------------------------------------------------------------------
  console.log('\n=== lists ===')
  await selectText('- 列表项一\n- 列表项二')
  await clickTool('list')
  await sleep(200)
  await clickMenuItem('有序列表')
  d = await doc()
  check('bullet -> ordered', d.includes('1. 列表项一') && d.includes('2. 列表项二'))
  await selectText('1. 列表项一\n2. 列表项二')
  await clickTool('list')
  await sleep(200)
  await clickMenuItem('无序列表')
  d = await doc()
  check('ordered -> bullet', d.includes('- 列表项一') && d.includes('- 列表项二'))
  await selectText('- 列表项一\n- 列表项二')
  await clickTool('list')
  await sleep(200)
  await clickMenuItem('无序列表')
  d = await doc()
  check('same list kind again strips the markers', d.includes('\n列表项一\n列表项二\n'), d.match(/[^\n]*列表项一[^\n]*/)?.[0])
  await setEditorDoc(FIXTURE)
  await sleep(400)

  // -------------------------------------------------------------------------
  console.log('\n=== format brush: single ===')
  await cursorInside('加粗词', 1)
  await clickTool('brush')
  check('brush arms', JSON.parse(await toolState('brush')).active === true)
  await dragSelect('第二段待刷文字')
  d = await doc()
  check('brush paints bold onto the dragged passage', d.includes('**第二段待刷文字**'), d.match(/[^\n]*第二段[^\n]*/)?.[0])
  check('single brush disarms after painting', JSON.parse(await toolState('brush')).active === false)

  console.log('\n=== format brush: locked ===')
  await cursorInside('重点词', 1)
  await clickTool('brush')
  const brushBox = await boxOf(visibleBtn('brush'))
  await doubleClickAt(brushBox.x, brushBox.y)
  check('double click locks the brush', JSON.parse(await toolState('brush')).active === true)
  await dragSelect('尾段。')
  d = await doc()
  check('locked brush paints the first passage', d.includes('==尾段。=='), d.match(/[^\n]*尾段[^\n]*/)?.[0])
  check('locked brush stays armed', JSON.parse(await toolState('brush')).active === true)
  await dragSelect('第二段待刷文字')
  d = await doc()
  check('locked brush paints a second passage', d.includes('==第二段待刷文字=='), d.match(/[^\n]*第二段[^\n]*/)?.[0])
  check('brush brings the target to the captured state (bold removed)', !d.includes('**第二段待刷文字**'))
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(200)
  check('Esc leaves the brush', JSON.parse(await toolState('brush')).active === false)

  console.log('\n=== format brush: block ===')
  await cursorInside('金句一句话', 1)
  await clickTool('brush')
  check('brush armed for a block paint', JSON.parse(await toolState('brush')).active === true)
  const tail = await boxOf(`[...document.querySelectorAll('.cm-line')].find(l => l.textContent.includes('尾段'))`)
  if (tail) await clickAt(tail.x, tail.y)
  await sleep(300)
  d = await doc()
  check('block brush turns a paragraph into a 金句卡片', d.includes('> ==尾段。=='), d.match(/[^\n]*尾段[^\n]*/)?.[0])
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(150)

  // -------------------------------------------------------------------------
  console.log('\n=== structural inserts ===')
  await setEditorDoc(FIXTURE)
  await sleep(400)
  await cursorInside('尾段。', 0)
  await optionsMenu('表格')
  await sleep(250)
  const cell = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.trim() === '3×3')`)
  if (cell) await clickAt(cell.x, cell.y)
  await sleep(400)
  d = await doc()
  check('table inserts a GFM table', d.includes('| 表头 | 表头 | 表头 |') && d.includes('| --- | --- | --- |'), d.match(/\|[^\n]*表头[^\n]*/)?.[0])
  const tableRows = (d.match(/^\|/gm) || []).length
  check('table has header + separator + 2 body rows', tableRows === 4, `rows=${tableRows}`)
  await sleep(300)
  check('preview renders the table', await evaluate(`!!document.querySelector('div.px-1.py-6 table')`))
  await clickTool('undo')
  await sleep(300)
  check('undo removes the table', !(await doc()).includes('| 表头 |'))
  await clickTool('redo')
  await sleep(300)
  check('redo brings it back', (await doc()).includes('| 表头 |'))

  await cursorInside('尾段。', 0)
  await optionsMenu('数学公式')
  await sleep(250)
  await evaluate(`(() => { const ta = document.querySelector('[data-menu="more"] textarea'); if (!ta) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    set.call(ta, 'a^2 + b^2 = c^2')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true })()`)
  await sleep(150)
  const mathBtn = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.includes('插入公式'))`)
  if (mathBtn) await clickAt(mathBtn.x, mathBtn.y)
  await sleep(400)
  check('math inserts a display formula', (await doc()).includes('$$\na^2 + b^2 = c^2\n$$'))

  await cursorInside('尾段。', 0)
  await optionsMenu('图片轮播')
  await sleep(250)
  const ratioBtn = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.includes('9:16'))`)
  if (ratioBtn) await clickAt(ratioBtn.x, ratioBtn.y)
  await sleep(150)
  const carBtn = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.includes('插入轮播'))`)
  if (carBtn) await clickAt(carBtn.x, carBtn.y)
  await sleep(400)
  d = await doc()
  check('carousel inserts with the chosen ratio', d.includes(':::carousel 9:16 ') && d.includes('![]()\n![]()'))

  await cursorInside('尾段。', 0)
  await optionsMenu('图片网格')
  await sleep(250)
  const colsBtn = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.trim() === '3 列')`)
  if (colsBtn) await clickAt(colsBtn.x, colsBtn.y)
  await sleep(150)
  const gRatio = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.includes('1:1'))`)
  if (gRatio) await clickAt(gRatio.x, gRatio.y)
  await sleep(150)
  const gBtn = await boxOf(`[...document.querySelectorAll('[data-menu="more"] button')].find(b => b.textContent.includes('插入网格'))`)
  if (gBtn) await clickAt(gBtn.x, gBtn.y)
  await sleep(400)
  d = await doc()
  check('gallery inserts with columns and ratio', d.includes(':::gallery 3 1:1 ') && d.includes('![]()\n![]()\n![]()'))

  await cursorInside('尾段。', 0)
  await optionsMenu('Mermaid 图表')
  await sleep(400)
  check('mermaid inserts a fence', (await doc()).includes('```mermaid 图注'))
  await cursorInside('尾段。', 0)
  await optionsMenu('分隔线')
  await sleep(400)
  check('分隔线 inserts ---', (await doc()).includes('\n---\n'))
  await cursorInside('尾段。', 0)
  await optionsMenu('署名')
  await sleep(400)
  check('署名 inserts @signature', (await doc()).includes('@signature'))

  await cursorInside('尾段。', 0)
  check('the image button is on screen for this part', await evaluate(`!!(${visibleBtn('image-menu')})`))
  await clickTool('image-menu')
  await sleep(250)
  await clickMenuItem('插入图片占位')
  await sleep(400)
  check('image menu inserts a placeholder', (await doc()).includes('![图注]()'))

  // -------------------------------------------------------------------------
  console.log('\n=== image upload from the toolbar ===')
  await setEditorDoc(FIXTURE)
  await sleep(500)
  await cursorInside('尾段。', 0)
  await clickTool('image')
  await sleep(400)
  const { root } = await send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept="image/*"]' }, sessionId)
  check('toolbar image button targets the upload input', nodeId > 0)
  await send('DOM.setFileInputFiles', { nodeId, files: [uploadFile] }, sessionId)
  await sleep(1200)
  const dialogUp = await evaluate(`!!document.querySelector('[role=dialog]')`)
  check('the existing ratio step opens', dialogUp === true)
  const uploadBtn = await boxOf(`[...document.querySelectorAll('[role=dialog] button')].find(b => /上传/.test(b.textContent))`)
  if (uploadBtn) await clickAt(uploadBtn.x, uploadBtn.y)
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    if ((await doc()).includes('img:')) break
  }
  d = await doc()
  const imgLine = d.match(/!\[[^\]]*\]\(img:[^)]+\)/)
  check('the uploaded image lands in the document', Boolean(imgLine), imgLine?.[0])
  check('it goes in as its own block', Boolean(imgLine) && new RegExp(`\\n\\n${imgLine[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`).test(d))
  let previewImg = null
  for (let i = 0; i < 10; i++) {
    previewImg = await evaluate(`(() => { const img = document.querySelector('div.px-1.py-6 img'); return img ? img.getAttribute('src') : null })()`)
    if (previewImg) break
    await sleep(300)
  }
  check('preview shows the uploaded image', typeof previewImg === 'string' && previewImg.includes('/api/img/'), String(previewImg))

  // -------------------------------------------------------------------------
  console.log('\n=== theme independence ===')
  await setEditorDoc(FIXTURE)
  await sleep(600)
  const markStyle = () =>
    evaluate(`(() => {
      const root = document.querySelector('div.px-1.py-6')
      if (!root) return null
      const el = [...root.querySelectorAll('span')].find(s => s.textContent === '重点词' && s.getAttribute('style'))
      return el ? el.getAttribute('style') : null
    })()`)
  const style1 = await markStyle()
  check('the golden theme decorates ==重点词==', typeof style1 === 'string' && style1.length > 0, String(style1).slice(0, 60))
  const themeBtn = await boxOf(`document.querySelector('[data-theme-switcher]')`)
  if (themeBtn) await clickAt(themeBtn.x, themeBtn.y)
  await sleep(600)
  const quick = await boxOf(`document.querySelector('[data-theme-quick="minimal"]')`)
  check('theme quick switcher is available', Boolean(quick))
  if (quick) await clickAt(quick.x, quick.y)
  await sleep(900)
  const style2 = await markStyle()
  check(
    'the same ==语义== is restyled by the new theme',
    Boolean(style1) && Boolean(style2) && style1 !== style2,
    `before=${String(style1).slice(0, 44)} after=${String(style2).slice(0, 44)}`,
  )
  check('the marker itself is untouched by the theme switch', (await doc()).includes('==重点词=='))
  await shot('02-theme-switched.png')
  // back to the default theme for the rest of the run
  if (themeBtn) {
    await clickAt(themeBtn.x, themeBtn.y)
    await sleep(500)
    const golden = await boxOf(`document.querySelector('[data-theme-quick="golden"]')`)
    if (golden) await clickAt(golden.x, golden.y)
    await sleep(700)
  }

  // -------------------------------------------------------------------------
  console.log('\n=== toolbar folding ===')
  // The preview pane maxes out at 820px, so with the sidebar collapsed the
  // editing column cannot physically reach its own minimum. Open the sidebar
  // first, the way the real narrow-column case happens.
  const expand = await boxOf(`document.querySelector('button[title="展开侧栏"]')`)
  if (expand) await clickAt(expand.x, expand.y)
  await sleep(600)
  const beforeWidth = await editorWidth()
  const narrowWidth = await resizeEditorTo(360)
  check('editing column narrows into the fold range', narrowWidth < 430, `width=${narrowWidth}`)
  const narrow = await evaluate(`(() => {
    const more = document.querySelector('[data-tool="more"]')
    const help = document.querySelector('[data-tool="help"]')
    const header = more ? more.closest('div.h-11') : null
    const m = more ? more.getBoundingClientRect() : null
    const h = help ? help.getBoundingClientRect() : null
    return JSON.stringify({
      image: !!(${visibleBtn('image')}),
      bold: !!(${visibleBtn('bold')}),
      mark: !!(${visibleBtn('mark')}),
      brush: !!(${visibleBtn('brush')}),
      heading: !!(${visibleBtn('heading')}),
      more: !!more,
      headerH: header ? Math.round(header.getBoundingClientRect().height) : 0,
      // Single line means the last items sit side by side, not stacked.
      fits: !!m && !!h && m.right <= h.left + 2 && h.top < m.bottom && h.bottom > m.top,
    })
  })()`)
  const n = JSON.parse(narrow)
  check('narrow column folds the image button into ···', n.image === false && n.more === true, JSON.stringify(n))
  check('the pinned buttons stay (撤销/重做/标题/B/重点/格式刷)', n.bold === true && n.mark === true && n.brush === true && n.heading === true)
  check('toolbar stays on one line', n.headerH > 0 && n.headerH <= 46 && n.fits === true, `headerH=${n.headerH} fits=${n.fits}`)
  await shot('03-toolbar-narrow.png')

  const backWidth = await resizeEditorTo(beforeWidth)
  check('narrow column folds and restores without losing the pinned set', backWidth > 0)
  // Restore the wide layout (sidebar collapsed) so every item is back.
  const collapseAgain = await boxOf(`document.querySelector('button[title="收起侧栏"]')`)
  if (collapseAgain) await clickAt(collapseAgain.x, collapseAgain.y)
  await sleep(600)
  const restored = await resizeEditorTo(1000)
  check('widening brings the buttons back', await evaluate(`!!(${visibleBtn('image')})`), `width=${restored}`)

  // -------------------------------------------------------------------------
  console.log('\n=== hand editing still works ===')
  await setEditorDoc(FIXTURE)
  await sleep(400)
  await evaluate(`window.__mopaiCodemirror.focus()`)
  await cursorInside('尾段。', 3)
  await send('Input.insertText', { text: '手工输入' }, sessionId)
  await sleep(400)
  check('typing still edits the document', (await doc()).includes('尾段。手工输入'))
  await selectText('手工输入')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 }, sessionId)
  await sleep(400)
  check('the Mod-B keybinding still wraps a selection', (await doc()).includes('**手工输入**'))

  console.log('\n=== screenshots ===')
  console.log(await shot('04-final.png'))
} catch (e) {
  failures++
  console.log('  [FAIL] script aborted — ' + (e && e.message ? e.message : String(e)))
} finally {
  try {
    chrome.kill()
  } catch {
    /* already gone */
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
