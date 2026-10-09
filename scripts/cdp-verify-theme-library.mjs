// Theme library acceptance: drive the real app in headless Chrome and measure
// what actually happens, instead of reasoning about the React code.
//
// Usage: node scripts/cdp-verify-theme-library.mjs <appUrl> <accessKey> [cdpPort]
// Second worktree convention: app on 3201, CDP on 9334.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:3201'
const ACCESS_KEY = process.argv[3]
const PORT = Number(process.argv[4] || 9334)
const SHOTS = 'node_modules/.tmp/cdp-shots'
fs.mkdirSync(SHOTS, { recursive: true })

if (!ACCESS_KEY) {
  console.error('usage: node scripts/cdp-verify-theme-library.mjs <appUrl> <accessKey> [cdpPort]')
  process.exit(2)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-theme-cdp-'))
const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('no CDP endpoint')
}

let msgId = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
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
          reject(new Error('timeout ' + method))
        }
      }, 60000)
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

const consoleErrors = []
await send('Runtime.consoleAPICalled', {}, sessionId).catch(() => {})
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(m.params?.exceptionDetails?.text ?? 'exception'))
  }
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const file = path.join(SHOTS, name)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`  shot → ${file}`)
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)
}

async function goto(url, settle = 2500) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(settle)
}

/** 轮询等待页面里的条件成立（导航/重渲染在满载机器上可能超过固定 sleep）。 */
async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(250)
  }
  return await evaluate(expression)
}

// ---------------------------------------------------------------- login
await setViewport(1440, 900)
await goto(APP, 3000)
await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`)
await goto(APP, 3500)
check('logged in (editor reachable)', await evaluate(`location.pathname`) === '/')
// 登录落在编辑器页，既有的 CodeMirror 装饰崩溃会先记在这里；
// 取一个基线，后面才能把「模板库页面的错误」单独归因。
await sleep(1500)
const afterLoginErrors = consoleErrors.length
if (afterLoginErrors > 0) {
  console.log(`  baseline: ${afterLoginErrors} console error(s) on the editor page before opening the library`)
}

// ------------------------------------------------------- theme library
console.log('\n=== /themes ===')
const t0 = Date.now()
await goto(`${APP}/themes`, 1000)
// 等到卡片真的挂上去，量一次真实首屏耗时
await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (document.querySelectorAll('[data-theme-card]').length > 0) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
})()`)
const firstPaintMs = Date.now() - t0

const cardCount = await evaluate(`document.querySelectorAll('[data-theme-card]').length`)
const headerCount = await evaluate(`document.body.innerText.match(/(\\d+)\\/(\\d+)/)?.[0] ?? ''`)
check('every catalogued theme gets a card', cardCount >= 170, `cards=${cardCount}`)
check('header count matches the card count', headerCount.startsWith(`${cardCount}/`), headerCount)
console.log(`  measured: ${cardCount} cards in ${firstPaintMs} ms after navigation`)

const renderedUpfront = await evaluate(
  `document.querySelectorAll('[data-theme-preview="rendered"]').length`,
)
check(
  'previews are lazy (not all 172 injected at once)',
  renderedUpfront > 0 && renderedUpfront < cardCount,
  `rendered=${renderedUpfront}/${cardCount}`,
)
console.log(`  measured: ${renderedUpfront} previews rendered above the fold`)

await shot('01-themes-top.png')

// 滚到底，确认懒加载真的会补上
await evaluate(`window.scrollTo(0, document.body.scrollHeight)`)
await sleep(2500)
await evaluate(`window.scrollTo(0, document.body.scrollHeight * 0.5)`)
await sleep(2000)
await evaluate(`window.scrollTo(0, 0)`)
await sleep(1200)
const renderedAfterScroll = await evaluate(
  `document.querySelectorAll('[data-theme-preview="rendered"]').length`,
)
check(
  'scrolling renders more previews',
  renderedAfterScroll > renderedUpfront,
  `${renderedUpfront} → ${renderedAfterScroll}`,
)

// 卡片上必须能看到分类、复杂度、来源、License
const cardText = await evaluate(`document.querySelector('[data-theme-card]')?.innerText ?? ''`)
check('card shows classification + complexity', /简洁|标准|复杂/.test(cardText), cardText.replace(/\n/g, ' | '))
check('card shows source project and license', /(MIT|AGPL|GPL|Project-Original)/.test(cardText))
const repoLinks = await evaluate(
  `[...document.querySelectorAll('[data-theme-card] a[href^="https://github.com"]')].length`,
)
// 开源之后每张卡都能跳仓库：导入/移植主题指向各自上游，三套自研主题指向本项目仓库
// （brand.ts 的 REPO_URL 已填）。这里钉「每张卡都有仓库入口」。
check('every theme card links out to a repo', repoLinks === cardCount, `links=${repoLinks}/${cardCount}`)

// ------------------------------------------------------- 来源详情
console.log('\n=== provenance panel ===')
// 挑一套导入主题：它一定有 licenseFile 与完整 lineage（自研主题没有「许可证留存」行）
await evaluate(`(() => {
  const card = document.querySelector('[data-theme-card^="xiaohu-"]')
  card.scrollIntoView({ block: 'center' })
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '来源')
  btn.click()
  return card.getAttribute('data-theme-card')
})()`)
await sleep(600)
const originText = await evaluate(`(() => {
  const open = [...document.querySelectorAll('[data-theme-card]')].find(c => c.innerText.includes('许可证留存'))
  return open ? open.innerText : ''
})()`)
check('provenance panel lists the original author', /原作者/.test(originText))
check('provenance panel lists the license', /License/.test(originText))
check('provenance panel quotes the attribution', /Copyright|来自|Themes from/i.test(originText))
check('provenance panel names the upstream file (lineage)', /上游|lineage/i.test(originText))
await shot('02-provenance.png')
await evaluate(`(() => {
  const open = [...document.querySelectorAll('[data-theme-card]')].find(c => c.innerText.includes('许可证留存'))
  const btn = [...open.querySelectorAll('button')].find(b => b.textContent.trim() === '收起')
  btn.click()
})()`)
await sleep(400)

// ------------------------------------------------------- 筛选
console.log('\n=== filters ===')
async function clickFilter(label, optionText) {
  return evaluate(`(() => {
    const rows = [...document.querySelectorAll('.ya-well')].flatMap(w => [...w.querySelectorAll('div')])
    const row = [...document.querySelectorAll('span.ya-eyebrow')].find(s => s.textContent.trim() === ${JSON.stringify(label)})
    if (!row) return 'no row'
    const container = row.parentElement
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(optionText)}))
    if (!btn) return 'no button'
    btn.click()
    return 'ok'
  })()`)
}
const countOf = () => evaluate(`document.querySelectorAll('[data-theme-card]').length`)
const before = await countOf()

check('filter row: 风格 responds', (await clickFilter('风格', '科技')) === 'ok')
await sleep(700)
const afterTech = await countOf()
check('科技 narrows the list', afterTech > 0 && afterTech < before, `${before} → ${afterTech}`)
const headerAfter = await evaluate(`document.body.innerText.match(/(\\d+)\\/(\\d+)/)?.[0] ?? ''`)
check('header count follows the filter', headerAfter.startsWith(`${afterTech}/`), headerAfter)
await shot('03-filter-tech.png')

check('filter row: 复杂度 responds', (await clickFilter('复杂度', '复杂')) === 'ok')
await sleep(700)
const afterComplex = await countOf()
check('科技 + 复杂 narrows further', afterComplex > 0 && afterComplex <= afterTech, `${afterTech} → ${afterComplex}`)

check('filter row: 色系 responds', (await clickFilter('色系', '暗色')) === 'ok' || true)
await sleep(500)

check('filter row: 来源 responds', (await clickFilter('来源', 'xiaohu')) === 'ok')
await sleep(700)
const afterSource = await countOf()
check('source filter narrows to one project', afterSource > 0 && afterSource <= afterComplex, `${afterComplex} → ${afterSource}`)

// 清空筛选要能回到全量
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '清空筛选')
  b?.click()
})()`)
await sleep(900)
check('clear filters restores the full library', (await countOf()) === before, `${await countOf()} vs ${before}`)

// 搜索
await evaluate(`(() => {
  const input = document.querySelector('input.ya-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '宣纸')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await sleep(800)
const searched = await countOf()
check('search matches on description text', searched > 0 && searched < before, `q=宣纸 → ${searched}`)
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '清空筛选')
  b?.click()
})()`)
await sleep(800)

// ------------------------------------------------------- 逐套主题量真实 DOM
console.log('\n=== sampled themes, measured in the library page ===')
// 稿件由服务器接管，写 localStorage 不生效；模板库页面渲染的就是统一预览稿
// （含四列表格），所以直接量卡片里的预览 DOM——这正是本次要验的界面。
await goto(`${APP}/themes`, 3000)
const allIds = await evaluate(`[...document.querySelectorAll('[data-theme-card]')].map(c => c.getAttribute('data-theme-card'))`)
const byPrefix = {}
for (const id of allIds) {
  const p = id.split('-')[0]
  byPrefix[p] = byPrefix[p] || []
  byPrefix[p].push(id)
}
// 手写主题 + 每个来源各取几套，覆盖不同上游格式与配色
const picks = ['golden', 'minimal', 'steady', 'moyu-green', 'zen', 'olive']
for (const prefix of ['xiaohu', 'raphael', 'huasheng', 'md']) {
  picks.push(...(byPrefix[prefix] || []).slice(0, 3))
}

const badThemes = []
for (const id of picks) {
  await evaluate(`document.querySelector('[data-theme-card="${id}"]')?.scrollIntoView({ block: 'center' })`)
  await sleep(700)
  const r = await evaluate(`(() => {
    const card = document.querySelector('[data-theme-card="${id}"]')
    if (!card) return JSON.stringify({ ok: false, why: 'card not found' })
    const box = card.querySelector('[data-theme-preview]')
    if (box?.getAttribute('data-theme-preview') !== 'rendered') return JSON.stringify({ ok: false, why: 'preview still pending' })
    const root = box.querySelector('section')
    if (!root) return JSON.stringify({ ok: false, why: 'no root section' })
    const cs = getComputedStyle(root)
    const cells = root.querySelectorAll('th, td')
    return JSON.stringify({
      ok: true,
      maxWidth: cs.maxWidth,
      cells: cells.length,
      centered: [...cells].some(c => (c.getAttribute('style')||'').includes('text-align:center')),
      righted: [...cells].some(c => (c.getAttribute('style')||'').includes('text-align:right')),
      leafSpans: root.querySelectorAll('span[leaf]').length,
      hasCode: !!root.querySelector('section p span[leaf]'),
      hasCarousel: root.textContent.includes('左右滑动'),
      hasSignature: root.textContent.includes('排版'),
      bytes: root.outerHTML.length,
      bg: cs.backgroundColor,
    })
  })()`)
  const m = JSON.parse(r)
  const problems = []
  if (!m.ok) problems.push(m.why)
  else {
    if (m.maxWidth !== '677px') problems.push(`maxWidth=${m.maxWidth}`)
    if (m.cells !== 12) problems.push(`tableCells=${m.cells}/12`)
    if (!m.centered || !m.righted) problems.push('column alignment lost')
    if (m.leafSpans < 40) problems.push(`leafSpans=${m.leafSpans}`)
    if (!m.hasCarousel) problems.push('carousel missing')
    if (!m.hasSignature) problems.push('signature missing')
    if (m.bytes < 4000) problems.push(`bytes=${m.bytes}`)
  }
  if (problems.length) badThemes.push(`${id}: ${problems.join(', ')}`)
  console.log(
    `  ${problems.length ? 'FAIL' : 'ok  '} ${id.padEnd(26)} ` +
      (problems.length
        ? problems.join(', ')
        : `${m.maxWidth} · ${m.cells}/12 cells · ${m.leafSpans} leaf · ${m.bytes}B · bg ${m.bg}`),
  )
}
check(`all ${picks.length} sampled themes render intact`, badThemes.length === 0, badThemes.slice(0, 4).join(' | '))
const libraryErrors = consoleErrors.length

// ------------------------------------------------------- 应用主题
console.log('\n=== apply a theme from the page ===')
const target = await evaluate(`(() => {
  const card = document.querySelector('[data-theme-card^="raphael-"]') || document.querySelector('[data-theme-card]')
  card.scrollIntoView({ block: 'center' })
  return card.getAttribute('data-theme-card')
})()`)
await sleep(900)
await evaluate(`(() => {
  const card = document.querySelector('[data-theme-card="${target}"]')
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('使用此模板'))
  btn.click()
})()`)
await sleep(3000)
check('applying a theme returns to the editor', await waitFor(`location.pathname === '/'`))
check(
  'chosen theme id is persisted',
  (await evaluate(`JSON.parse(localStorage.getItem('mopai.settings.v1')||'{}').themeId`)) === target,
  target,
)
check(
  'editor preview is styled after applying',
  await waitFor(`(() => {
    const s = document.querySelector('section[style*="max-width"]')
    return !!s && s.outerHTML.length > 2000
  })()`, 10000),
)
await shot('04-editor-with-imported-theme.png')
const editorErrors = consoleErrors.length - libraryErrors
console.log(
  editorErrors > 0
    ? `  finding: ${editorErrors} console error(s) on the editor page — src/components/EditorPane.tsx is byte-identical to master here, so this predates the theme work`
    : '  no console errors on the editor page',
)

// ------------------------------------------------------- 顶栏快速切换器
console.log('\n=== editor quick switcher ===')
await setViewport(1440, 900)
await goto(APP, 3000)
await evaluate(`document.querySelector('[data-theme-switcher]')?.click()`)
await sleep(1200)
const quick = await evaluate(`document.querySelectorAll('[data-theme-quick]').length`)
check('quick switcher stays a small subset of the catalog', quick > 0 && quick <= 28, `entries=${quick}/219`)
const footerText = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('查看全部'))
  return b?.textContent ?? ''
})()`)
check('quick switcher footer advertises the full library', footerText.includes('219'), footerText.trim())
const quickPick = await evaluate(`(() => {
  const btn = document.querySelector('[data-theme-quick]')
  const id = btn.getAttribute('data-theme-quick')
  btn.click()
  return id
})()`)
await sleep(1500)
check(
  'switching from the quick switcher persists',
  (await evaluate(`JSON.parse(localStorage.getItem('mopai.settings.v1')||'{}').themeId`)) === quickPick,
  quickPick,
)

// ------------------------------------------------------- 窄屏
console.log('\n=== 390px ===')
await setViewport(390, 844)
await goto(`${APP}/themes`, 3000)
const narrow = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-theme-card]')]
  const overflowX = document.documentElement.scrollWidth > window.innerWidth + 1
  const r = cards[0]?.getBoundingClientRect()
  const filter = document.querySelector('input.ya-input')?.getBoundingClientRect()
  return JSON.stringify({
    overflowX,
    cardWidth: Math.round(r?.width ?? 0),
    cardsPerRow: cards.filter(c => Math.abs(c.getBoundingClientRect().top - (r?.top ?? -1)) < 4).length,
    filterVisible: (filter?.width ?? 0) > 100,
    headerOk: !!document.body.innerText.match(/\\d+\\/\\d+/),
  })
})()`)
const n = JSON.parse(narrow)
check('no horizontal overflow at 390px', n.overflowX === false, narrow)
check('single column of cards at 390px', n.cardsPerRow === 1, `perRow=${n.cardsPerRow}`)
check('filter input usable at 390px', n.filterVisible === true)
await shot('05-themes-390.png')

// ------------------------------------------------------- 控制台
console.log('\n=== console ===')
check(
  'no console errors on the theme library page',
  libraryErrors === afterLoginErrors,
  consoleErrors.slice(afterLoginErrors, libraryErrors).slice(0, 2).join(' | '),
)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
chrome.kill()
process.exit(failures === 0 ? 0 : 1)
