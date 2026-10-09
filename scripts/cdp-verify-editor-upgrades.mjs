// Headless-Chrome check for the editor upgrades: block-mapped scroll sync, the
// front-matter line offset, undo isolation across articles, the drop hazard, and
// clipboard image paste. Run against a local production build on its own port and
// database - never against the deployed site.
//
//   node scripts/cdp-verify-editor-upgrades.mjs [appUrl] [accessKey] [cdpPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appUrl = process.argv[2] || 'http://127.0.0.1:3202/'
const accessKey = process.argv[3] || process.env.ACCESS_KEY || ''
const PORT = Number(process.argv[4] || 9335)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
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

async function evaluate(expression) {
  const r = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''),
    )
  }
  return r.result.value
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(3500)
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

console.log('=== editor boots ===')
check('CodeMirror view is exposed', await evaluate(`!!window.__mopaiCodemirror`))
const docText = await evaluate(`window.__mopaiCodemirror.state.doc.toString()`)
check('the sample article is loaded', docText.includes('欢迎使用公众号排版助手'), `len=${docText.length}`)
check(
  'the sample article has front matter',
  docText.startsWith('---'),
  'needed to exercise the line-offset fix',
)

// A long document is what makes scroll sync meaningful: both panes must actually
// be scrollable.
console.log('\n=== both panes can scroll ===')
const scrollable = await evaluate(`(() => {
  const ed = document.querySelector('.cm-scroller')
  const content = document.querySelector('div.px-1.py-6')
  const pv = content && content.closest('[class*="overflow-y-auto"]')
  return JSON.stringify({
    editor: ed ? { client: ed.clientHeight, scroll: ed.scrollHeight } : null,
    preview: pv ? { client: pv.clientHeight, scroll: pv.scrollHeight } : null,
  })
})()`)
const s = JSON.parse(scrollable)
check('editor scroller found and overflowing', !!s.editor && s.editor.scroll > s.editor.client, scrollable)
check('preview scroller found and overflowing', !!s.preview && s.preview.scroll > s.preview.client)

// ---------------------------------------------------------------------------
console.log('\n=== front matter line offset ===')
// The sidebar's "jump to line" used to land on the front matter's closing ---
// because block line numbers were counted from the body, not the file.
const offsetOk = await evaluate(`(() => {
  const text = window.__mopaiCodemirror.state.doc.toString()
  const lines = text.split('\\n')
  const firstImage = lines.findIndex(l => l.includes('!['))
  // Ask the app where it thinks the first image is: the sidebar row carries the
  // line it will jump to, and clicking it must select that exact source line.
  const rows = [...document.querySelectorAll('aside button[title="点击定位到编辑器对应行"]')]
  if (!rows.length) return JSON.stringify({ error: 'no material rows' })
  rows[0].click()
  const view = window.__mopaiCodemirror
  const head = view.state.selection.main.head
  const landed = view.state.doc.lineAt(head).number - 1
  return JSON.stringify({ firstImage, landed, line: lines[landed] })
})()`)
const off = JSON.parse(offsetOk)
check(
  'clicking a material row lands on that image line',
  off.firstImage === off.landed && String(off.line || '').includes('!['),
  offsetOk,
)

// ---------------------------------------------------------------------------
console.log('\n=== scroll sync: editor drives preview ===')
async function editorTopLine() {
  return evaluate(`(() => {
    const v = window.__mopaiCodemirror
    const b = v.lineBlockAtHeight(Math.max(0, v.scrollDOM.scrollTop))
    return v.state.doc.lineAt(b.from).number - 1
  })()`)
}
async function previewTop() {
  return evaluate(`(() => {
    const pv = document.querySelector('div.px-1.py-6').closest('[class*="overflow-y-auto"]')
    return Math.round(pv.scrollTop)
  })()`)
}
async function setEditorScroll(top) {
  await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    v.scrollDOM.scrollTop = ${top}
    v.scrollDOM.dispatchEvent(new Event('scroll'))
  })()`)
  await sleep(350)
}
async function setPreviewScroll(top) {
  await evaluate(`(() => {
    const pv = document.querySelector('div.px-1.py-6').closest('[class*="overflow-y-auto"]')
    pv.scrollTop = ${top}
    pv.dispatchEvent(new Event('scroll'))
  })()`)
  await sleep(350)
}

const edMax = await evaluate(`(() => {
  const v = window.__mopaiCodemirror
  return v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight
})()`)
const pvMax = await evaluate(`(() => {
  const pv = document.querySelector('div.px-1.py-6').closest('[class*="overflow-y-auto"]')
  return pv.scrollHeight - pv.clientHeight
})()`)

await setEditorScroll(0)
const pvAtTop = await previewTop()
check('editor at top keeps the preview at top', pvAtTop <= 2, `previewTop=${pvAtTop}`)

const edMid = Math.round(edMax * 0.5)
await setEditorScroll(edMid)
const pvAtMid = await previewTop()
check(
  'editor halfway moves the preview roughly halfway',
  pvAtMid > pvMax * 0.2 && pvAtMid < pvMax * 0.85,
  `editor=${edMid}/${edMax} preview=${pvAtMid}/${pvMax}`,
)

await setEditorScroll(edMax)
const pvAtEnd = await previewTop()
check('editor at the bottom takes the preview with it', pvAtEnd > pvMax * 0.8, `preview=${pvAtEnd}/${pvMax}`)

// The mapping must be monotonic: scrolling down must never move the other pane up.
console.log('\n=== scroll sync is monotonic ===')
let monotonic = true
let prevPv = -1
for (const frac of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
  await setEditorScroll(Math.round(edMax * frac))
  const pv = await previewTop()
  if (pv < prevPv - 2) monotonic = false
  prevPv = pv
}
check('preview never moves backwards as the editor scrolls down', monotonic)

console.log('\n=== scroll sync: preview drives editor ===')
await setPreviewScroll(0)
await sleep(200)
const edAfterPvTop = await editorTopLine()
check('preview at top puts the editor near the top', edAfterPvTop <= 3, `editorTopLine=${edAfterPvTop}`)

await setPreviewScroll(pvMax)
await sleep(250)
const edAfterPvEnd = await editorTopLine()
const totalLines = await evaluate(`window.__mopaiCodemirror.state.doc.lines`)
check(
  'preview at the bottom takes the editor with it',
  edAfterPvEnd > totalLines * 0.5,
  `editorTopLine=${edAfterPvEnd}/${totalLines}`,
)

let monoBack = true
let prevLine = -1
for (const frac of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
  await setPreviewScroll(Math.round(pvMax * frac))
  await sleep(120)
  const ln = await editorTopLine()
  if (ln < prevLine - 1) monoBack = false
  prevLine = ln
}
check('editor never moves backwards as the preview scrolls down', monoBack)

// Settling: after the sync stops, neither pane may keep drifting.
console.log('\n=== no oscillation ===')
await setEditorScroll(Math.round(edMax * 0.4))
const settleA = await previewTop()
await sleep(700)
const settleB = await previewTop()
check('the preview settles instead of jittering', Math.abs(settleA - settleB) <= 2, `${settleA} -> ${settleB}`)

// ---------------------------------------------------------------------------
console.log('\n=== sync toggle ===')
// The toggle sits on the side panel's 设置 tab, and Radix only mounts a tab's
// content once its trigger has been pressed - by a real pointer event, which a
// synthetic click() is not. The button itself carries an 开/关 label and the
// title of the behaviour, so that is what it is found by.
async function clickPoint(x, y) {
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 },
    sessionId,
  )
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 1 },
    sessionId,
  )
}
const toggleLookup = `[...document.querySelectorAll('button')].find(b => /一起滚动|独立滚动/.test(b.getAttribute('title') || ''))`
const tabPoint = JSON.parse(
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === '设置')
    if (!tab) return 'null'
    const r = tab.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  })()`),
)
if (tabPoint) await clickPoint(tabPoint.x, tabPoint.y)
await sleep(400)
const toggled = await evaluate(`(() => {
  const btn = ${toggleLookup}
  if (!btn) return 'no toggle'
  const was = btn.getAttribute('aria-pressed') === 'true'
  btn.click()
  return was ? 'turned off' : 'turned on'
})()`)
check('the sync toggle exists and was on', toggled === 'turned off', String(toggled))
await sleep(300)
await setEditorScroll(0)
await sleep(200)
const pvOff = await previewTop()
await setEditorScroll(Math.round(edMax * 0.7))
await sleep(300)
const pvOffAfter = await previewTop()
check(
  'with sync off the preview stays put',
  Math.abs(pvOff - pvOffAfter) <= 2,
  `${pvOff} -> ${pvOffAfter}`,
)
await evaluate(`(() => {
  const btn = ${toggleLookup}
  btn && btn.click()
})()`)
await sleep(200)

// ---------------------------------------------------------------------------
console.log('\n=== drop hazard: a dropped file must not be read as text ===')
// CodeMirror's built-in drop handler reads dropped files with readAsText, so
// dragging a .md file in used to dump its whole source into the article.
const dropResult = await evaluate(`(() => {
  const before = window.__mopaiCodemirror.state.doc.toString()
  const dt = new DataTransfer()
  dt.items.add(new File(['CANARY-TEXT-THAT-MUST-NOT-APPEAR'], 'dropped.md', { type: 'text/markdown' }))
  const target = document.querySelector('.cm-content')
  const rect = target.getBoundingClientRect()
  const ev = new DragEvent('drop', {
    dataTransfer: dt, bubbles: true, cancelable: true,
    clientX: rect.left + 40, clientY: rect.top + 40,
  })
  target.dispatchEvent(ev)
  return JSON.stringify({
    types: Array.from(dt.types),
    defaultPrevented: ev.defaultPrevented,
    leaked: window.__mopaiCodemirror.state.doc.toString().includes('CANARY-TEXT-THAT-MUST-NOT-APPEAR'),
    unchanged: window.__mopaiCodemirror.state.doc.toString() === before,
  })
})()`)
const dropped = JSON.parse(dropResult)
check('the drop carried files', dropped.types.includes('Files'), dropResult)
check('our handler claimed the drop', dropped.defaultPrevented === true, dropResult)
check('the file text did not leak into the article', dropped.leaked === false, dropResult)

// ---------------------------------------------------------------------------
console.log('\n=== clipboard image paste is recognised ===')
const pasteResult = await evaluate(`(() => {
  const png = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  ), c => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([png], 'screenshot.png', { type: 'image/png' }))
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  document.querySelector('.cm-content').dispatchEvent(ev)
  return JSON.stringify({
    files: dt.files.length,
    defaultPrevented: ev.defaultPrevented,
    dialog: !!document.querySelector('[role=dialog]'),
  })
})()`)
const pasted = JSON.parse(pasteResult)
check('a pasted image is claimed, not inserted as text', pasted.defaultPrevented === true, pasteResult)
check(
  'pasting an image is accepted or explained',
  pasted.dialog === true || pasted.defaultPrevented === true,
  pasted.dialog ? 'framing dialog shown' : 'claimed; upload needs a login on a fresh database',
)
await evaluate(`(() => {
  const b = [...document.querySelectorAll('[role=dialog] button')].find(x => /取消/.test(x.textContent))
  b && b.click()
})()`)
await sleep(300)

// ---------------------------------------------------------------------------
console.log('\n=== undo does not cross articles ===')
const undoResult = await evaluate(`(async () => {
  const view = window.__mopaiCodemirror
  const firstId = view
  const original = view.state.doc.toString()
  // Type into the open article so there is something to undo.
  view.dispatch({ changes: { from: 0, insert: 'TYPED-' } })
  await new Promise(r => setTimeout(r, 400))
  // Open the article switcher and pick a different article.
  const trigger = document.querySelector('button[title="切换稿件"]')
  if (!trigger) return JSON.stringify({ error: 'no doc switcher' })
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  trigger.click()
  await new Promise(r => setTimeout(r, 600))
  const items = [...document.querySelectorAll('[role=menuitem]')]
  const names = items.map(i => i.textContent.trim())
  if (items.length < 1) return JSON.stringify({ error: 'empty menu', names })
  // Pick the blank-article entry by label, not by position: the menu has grown a
  // second creation entry (新建示例稿) after it, so "the last item" silently
  // became "another copy of the sample".
  const blank = items.find(i => i.textContent.trim() === '新建稿件')
  if (!blank) return JSON.stringify({ error: 'no 新建稿件 entry in the menu', names })
  blank.click()
  await new Promise(r => setTimeout(r, 1200))
  const after = window.__mopaiCodemirror
  const switched = after.state.doc.toString()
  // Undo on the new article must not bring the old article's text back.
  after.dispatch({ effects: [], changes: [] })
  return JSON.stringify({
    viewRebuilt: after !== firstId,
    originalHead: original.slice(0, 20),
    switchedHead: switched.slice(0, 20),
    switchedDiffers: switched !== original,
    carriesTyped: switched.includes('TYPED-'),
  })
})()`)
const undo = JSON.parse(undoResult)
check('switching articles rebuilds the editor view', undo.viewRebuilt === true, undoResult)
check('the new article is a different document', undo.switchedDiffers === true, undoResult)
check(
  'the new article does not carry the old one text',
  undo.carriesTyped === false,
  undoResult,
)

console.log('\n=== undo after a switch does not resurrect the other article ===')
const undo2 = await evaluate(`(async () => {
  const view = window.__mopaiCodemirror
  const before = view.state.doc.toString()
  // Fire the real undo keybinding.
  const cm = document.querySelector('.cm-content')
  cm.focus()
  cm.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 500))
  const after = window.__mopaiCodemirror.state.doc.toString()
  return JSON.stringify({ unchanged: after === before, afterHead: after.slice(0, 24), beforeHead: before.slice(0, 24) })
})()`)
const u2 = JSON.parse(undo2)
check('Ctrl+Z on a freshly opened article changes nothing', u2.unchanged === true, undo2)

// ---------------------------------------------------------------------------
console.log('\n=== inline markers beside Chinese punctuation reach the preview ===')
// CommonMark's flanking rule counts full-width punctuation as punctuation, so a
// marker glued to a Chinese sentence - which is how Chinese is written - could
// neither open nor close: the `**` and `==` came out as literal text.
const inlineCjk = await evaluate(`(async () => {
  const view = window.__mopaiCodemirror
  const doc = [
    '赛事采用==“专家评审70% + 大众投票30%”==的综合评审法。',
    '',
    '构建**“需求发布—智能拆解—模型调用—智能体开发—接单协作—合同履约—成果交付—数字资产沉淀与变现”**的全链路服务体系。',
    '',
    '这是==标记中包含**加粗**==的测试。',
    '',
  ].join('\\n')
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } })
  await new Promise(r => setTimeout(r, 1500))
  const paper = document.querySelector('div.px-1.py-6')
  const text = paper.innerText
  const html = paper.innerHTML
  return JSON.stringify({
    noDelimiters: !text.includes('==') && !text.includes('**'),
    keepsMark: text.includes('“专家评审70% + 大众投票30%”'),
    keepsLong: text.includes('数字资产沉淀与变现'),
    nested: text.includes('标记中包含加粗') && text.includes('的测试'),
    highlighted: (html.match(/border-bottom/g) || []).length >= 2,
    bolded: html.includes('font-weight:700'),
  })
})()`)
const cjk = JSON.parse(inlineCjk)
check('no `**` or `==` survives into the article', cjk.noDelimiters === true, inlineCjk)
check('the marked phrase is rendered', cjk.keepsMark === true, inlineCjk)
check('the long bold phrase is rendered', cjk.keepsLong === true, inlineCjk)
check('a mark around bold renders both', cjk.nested === true, inlineCjk)
check('the highlight and bold styles are applied', cjk.highlighted && cjk.bolded, inlineCjk)

// ---------------------------------------------------------------------------
console.log('\n=== references page ===')
await goto(appUrl.replace(/\/$/, '') + '/references')
const refs = await evaluate(`(() => {
  const text = document.body.innerText
  return JSON.stringify({
    hasTitle: /开源|致谢|References/.test(text),
    mit: (text.match(/MIT/g) || []).length,
    projects: ['doocs/md','MDInline','md-wechat','huasheng','wenyan','foolgry'].filter(n => text.includes(n)),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  })
})()`)
const r = JSON.parse(refs)
check('the references page renders', r.hasTitle === true, refs)
check('it lists the upstream projects', r.projects.length >= 5, JSON.stringify(r.projects))
check('licences are shown', r.mit >= 5, `MIT x${r.mit}`)
check('no horizontal overflow at 1440px', r.scrollWidth <= r.innerWidth + 1, refs)

await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
}, sessionId)
await sleep(800)
const narrow = await evaluate(`JSON.stringify({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
})`)
const n = JSON.parse(narrow)
check('no horizontal overflow at 390px', n.scrollWidth <= n.innerWidth + 1, narrow)
await send('Emulation.clearDeviceMetricsOverride', {}, sessionId)

chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may still hold the profile */ }
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
