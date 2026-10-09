// Favorites + references acceptance: drive the real app in headless Chrome and
// measure what actually happens, instead of reasoning about the React code.
//
// Usage: node scripts/cdp-verify-favorites.mjs <appUrl> [cdpPort]
// No login needed: the theme library, the favorites and /references are public.
// Start the app first (built prod or `npm run dev`), e.g.
//   DATABASE_URL=file:./data/test-fav.db PORT=3203 NODE_ENV=production node dist/boot.js

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || 'http://127.0.0.1:3203'
const PORT = Number(process.argv[3] || 9340)
const SHOTS = 'node_modules/.tmp/cdp-shots'
fs.mkdirSync(SHOTS, { recursive: true })

const FAV_KEY = 'mopai.theme-favorites.v1'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-fav-cdp-'))
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

const favIds = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(FAV_KEY)}) || '[]')`)

// ---------------------------------------------------------------- 模板库
console.log('=== /themes · star a card ===')
await setViewport(1440, 900)
await goto(`${APP}/themes`, 2500)
await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (document.querySelectorAll('[data-theme-card]').length > 0) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
})()`)

const cards = await evaluate(`document.querySelectorAll('[data-theme-card]').length`)
const favButtons = await evaluate(`document.querySelectorAll('[data-theme-fav]').length`)
check('every theme card has a favorite button', favButtons === cards && cards > 100, `${favButtons}/${cards}`)
check('nothing is favorited on a fresh browser', JSON.stringify(await favIds()) === '[]')

// 收藏两张：golden（自研）+ 一套导入主题
const picks = await evaluate(`(() => {
  const ids = ['golden', [...document.querySelectorAll('[data-theme-fav]')]
    .map(b => b.getAttribute('data-theme-fav'))
    .find(id => id.startsWith('xiaohu-'))].filter(Boolean)
  for (const id of ids) document.querySelector('[data-theme-fav="' + id + '"]').click()
  return ids
})()`)
await sleep(600)
check('stars mark the cards as pressed', (await evaluate(
  `[...document.querySelectorAll('[data-theme-fav][aria-pressed="true"]')].map(b => b.getAttribute('data-theme-fav')).sort().join(',')`,
)) === [...picks].sort().join(','), picks.join(','))
check('favorites land in localStorage under the mopai key', (await favIds()).length === 2, JSON.stringify(await favIds()))
check('the filter chip counts them', (await evaluate(
  `document.querySelector('[data-fav-filter]')?.innerText ?? ''`,
)) .includes('2'), await evaluate(`document.querySelector('[data-fav-filter]')?.innerText ?? ''`))
await shot('fav-01-library-stars.png')

// ---------------------------------------------------------------- 只看收藏
console.log('\n=== /themes · 只看收藏 filter ===')
await evaluate(`document.querySelector('[data-fav-filter]').click()`)
await sleep(900)
const filtered = await evaluate(`document.querySelectorAll('[data-theme-card]').length`)
const headerCount = await evaluate(`document.body.innerText.match(/(\\d+)\\/(\\d+)/)?.[0] ?? ''`)
check('the filter narrows the library to the favorites', filtered === 2, `cards=${filtered}`)
check('header count follows the favorites filter', headerCount.startsWith('2/'), headerCount)
await shot('fav-02-filtered.png')

// 清空筛选回到全量
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '清空筛选')
  b?.click()
})()`)
await sleep(800)
check('clearing filters restores the full library', (await evaluate(`document.querySelectorAll('[data-theme-card]').length`)) === cards)

// ---------------------------------------------------------------- 刷新后恢复
console.log('\n=== /themes · survives a reload ===')
await goto(`${APP}/themes`, 2500)
await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (document.querySelectorAll('[data-theme-card]').length > 0) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
})()`)
const persisted = await evaluate(
  `[...document.querySelectorAll('[data-theme-fav][aria-pressed="true"]')].map(b => b.getAttribute('data-theme-fav')).sort().join(',')`,
)
check('favorites are restored after a reload', persisted === [...picks].sort().join(','), persisted)

// 取消收藏一张，列表和不变量都跟着走
await evaluate(`document.querySelector('[data-theme-fav="${picks[1]}"]').click()`)
await sleep(500)
check('un-starring removes the id from storage', (await favIds()).join(',') === picks[0], JSON.stringify(await favIds()))
await evaluate(`document.querySelector('[data-theme-fav="${picks[1]}"]').click()`)
await sleep(500)
check('re-starring restores both', (await favIds()).length === 2)

// ---------------------------------------------------------------- 快速切换器
console.log('\n=== editor · quick switcher puts favorites first ===')
await goto(`${APP}/`, 3000)
await evaluate(`document.querySelector('[data-theme-switcher]')?.click()`)
await sleep(1500)
const section = await evaluate(`(() => {
  const labels = [...document.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean)
  const favIndex = labels.findIndex(t => t === '收藏')
  const catIndex = labels.findIndex(t => ['简约', '商务', '杂志', '活力'].includes(t))
  return JSON.stringify({ favIndex, catIndex, firstTile: document.querySelector('[data-theme-quick]')?.getAttribute('data-theme-quick') })
})()`)
const s = JSON.parse(section)
check('favorites section exists and sits above the categories', s.favIndex >= 0 && s.catIndex > s.favIndex, section)
check('the first quick tile is a favorited theme', picks.includes(s.firstTile), s.firstTile)
const quickIds = await evaluate(`[...document.querySelectorAll('[data-theme-quick]')].map(b => b.getAttribute('data-theme-quick'))`)
check('favorited themes are not duplicated in their category rows', new Set(quickIds).size === quickIds.length)
check('tile count stays bounded', quickIds.length <= 32, `tiles=${quickIds.length}`)
await shot('fav-03-quick-switcher.png')

// 从收藏里直接切换主题
await evaluate(`document.querySelector('[data-theme-quick="${picks[0]}"]').click()`)
await sleep(1200)
check(
  'picking from favorites persists the theme',
  (await evaluate(`JSON.parse(localStorage.getItem('mopai.settings.v1')||'{}').themeId`)) === picks[0],
  picks[0],
)
check('the switcher button shows the new theme name', (await evaluate(
  `document.querySelector('[data-theme-switcher]')?.innerText ?? ''`,
)).trim().length > 0)

// 顶栏和模板库的一致性：在模板库里取消收藏后，切换器应同步消失
console.log('\n=== cross-surface consistency ===')
await evaluate(`document.querySelector('[data-theme-switcher]')?.click()`) // close popover if still open
await sleep(400)
await goto(`${APP}/themes`, 2000)
await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (document.querySelector('[data-theme-fav]')) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
})()`)
await evaluate(`document.querySelector('[data-theme-fav="${picks[0]}"]').click()`)
await sleep(400)
await goto(`${APP}/`, 3000)
await evaluate(`document.querySelector('[data-theme-switcher]')?.click()`)
await sleep(1200)
const afterUnfav = await evaluate(`(() => {
  const label = [...document.querySelectorAll('p')].find(p => p.textContent.trim() === '收藏')
  const box = label?.parentElement
  const favTiles = box ? [...box.querySelectorAll('[data-theme-quick]')].map(b => b.getAttribute('data-theme-quick')) : []
  const allTiles = [...document.querySelectorAll('[data-theme-quick]')].map(b => b.getAttribute('data-theme-quick'))
  return JSON.stringify({ favTiles, allTiles })
})()`)
const au = JSON.parse(afterUnfav)
// 取消收藏的那张如果正是当前主题，会作为「使用中」留在它自己的分类区里——
// 这是刻意的；收藏区里必须只剩另一张。
check('unstarred theme leaves the favorites section', !au.favTiles.includes(picks[0]) && au.favTiles[0] === picks[1], au.favTiles.join(','))
check('the active theme still appears somewhere (its category row)', au.allTiles.includes(picks[0]))

// ---------------------------------------------------------------- 390px
console.log('\n=== 390px ===')
await setViewport(390, 844)
await goto(`${APP}/themes`, 2500)
const narrow = await evaluate(`(() => {
  const chip = document.querySelector('[data-fav-filter]')?.getBoundingClientRect()
  const card = document.querySelector('[data-theme-card]')?.getBoundingClientRect()
  const star = document.querySelector('[data-theme-fav]')?.getBoundingClientRect()
  return JSON.stringify({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    chipVisible: (chip?.width ?? 0) > 60,
    starVisible: (star?.width ?? 0) > 12,
    starInsideCard: star && card ? star.right <= card.right + 1 : false,
  })
})()`)
const n = JSON.parse(narrow)
check('no horizontal overflow at 390px', n.overflowX === false, narrow)
check('favorites chip usable at 390px', n.chipVisible === true)
check('star button visible and inside the card at 390px', n.starVisible === true && n.starInsideCard === true)
await shot('fav-04-390.png')

// ---------------------------------------------------------------- /references
console.log('\n=== /references · sources section renders from data ===')
await setViewport(1440, 900)
await goto(`${APP}/references`, 2500)
const refText = await evaluate(`document.body.innerText`)
check('references page lists the code credits', refText.includes('许可证核实') && refText.includes('移植'), '')
check('theme-sources section is present', refText.includes('主题库来源'))
check('theme-sources section carries the catalog total', /模板库\s*\d+\s*套/.test(refText.replace(/\s+/g, ' ')), '')
check('theme-sources section lists every registered source', await evaluate(
  `(() => {
    const rows = [...document.querySelectorAll('section')].find(s => s.innerText.includes('主题库来源'))
    return rows ? rows.querySelectorAll('li').length : 0
  })()`,
) >= 9)
check('license notes render from the data (not hand-written rows)', await evaluate(
  `document.querySelectorAll('li').length`,
) >= 3)
const refLinks = await evaluate(`[...document.querySelectorAll('a[href^="https://github.com/"]')].length`)
check('upstream repos are linked', refLinks >= 10, `links=${refLinks}`)
await shot('ref-01-references.png')

console.log('\n=== console ===')
check('no console errors on the visited pages', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
chrome.kill()
process.exit(failures === 0 ? 0 : 1)
