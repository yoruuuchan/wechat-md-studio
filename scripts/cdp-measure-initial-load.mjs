// U05 initial-load measurement: same Chrome, same cache policy, same article.
//
// Usage: node scripts/cdp-measure-initial-load.mjs <appUrl> [cdpPort] [outFile]
//
// It records, for the editor route and the theme library route:
//   - entry JS/CSS and every resource the browser actually fetches before the
//     editor is interactive (CodeMirror + preview mounted),
//   - FCP / DOMContentLoaded / load and the long-task total on the way there,
//   - how many theme previews are computed/mounted before scrolling.
//
// The numbers are raw, transfer and decoded sizes, so a CDN's gzip/Brotli can
// be applied separately. Run it against a clean cache every time.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = (process.argv[2] || 'http://127.0.0.1:4130').replace(/\/$/, '')
const PORT = Number(process.argv[3] || 9730)
const OUT = process.argv[4] || 'verify-out/u05/initial-load.json'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-u05-cdp-'))
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const json = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting.
    }
    await sleep(250)
  }
  throw new Error('no CDP endpoint')
}

let msgId = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = msgId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout ${method}`))
        }
      }, 60000)
    })
}

const ws = new WebSocket(await wsUrl())
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)
await send('Performance.enable', {}, sessionId)

// Timers/observers must exist before the app's module executes.
await send(
  'Page.addScriptToEvaluateOnNewDocument',
  {
    source: `
      window.__u05 = { start: performance.now(), longTasks: [] };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__u05.longTasks.push(entry.duration);
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    `,
  },
  sessionId,
)

const network = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Network.responseReceived') {
    const { requestId, response, type } = message.params
    network.set(requestId, { url: response.url, status: response.status, type })
  }
  if (message.method === 'Network.loadingFinished') {
    const entry = network.get(message.params.requestId)
    if (entry) entry.bytes = message.params.encodedDataLength ?? 0
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(String(message.params?.exceptionDetails?.text ?? 'exception'))
  }
})

const evaluate = async (expression) => {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description ?? ''))
  }
  return result.result.value
}

async function waitFor(expression, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(100)
  }
  return false
}

/** 从调用时刻到条件成立（含最后一次轮询）的毫秒数；超时返回 null。 */
async function waitForTime(expression, timeout = 20000) {
  const start = Date.now()
  const deadline = start + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return Date.now() - start
    await sleep(100)
  }
  return null
}

async function snapshot(label) {
  await sleep(250)
  const metrics = await evaluate(`(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
    const resources = performance.getEntriesByType('resource').map((r) => ({
      name: r.name,
      initiator: r.initiatorType,
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
      decodedBodySize: r.decodedBodySize,
      duration: r.duration,
    }));
    const u = window.__u05 || { start: 0, longTasks: [] };
    return {
      readyMs: performance.now() - u.start,
      fcpMs: paints['first-contentful-paint'] ?? null,
      domContentLoadedMs: nav.domContentLoadedEventEnd ?? null,
      loadMs: nav.loadEventEnd ?? null,
      longTasks: u.longTasks,
      previewTextLength: document.querySelector('[data-onboarding="preview"] section')?.textContent?.length ?? -1,
      resources,
    };
  })()`)

  const requests = [...network.values()].filter((entry) => entry.url.startsWith(APP))
  const byUrl = new Map()
  for (const request of requests) {
    const current = byUrl.get(request.url) || { url: request.url, type: request.type, status: request.status, bytes: 0 }
    current.bytes += request.bytes ?? 0
    byUrl.set(request.url, current)
  }
  const resources = [...byUrl.values()].sort((a, b) => b.bytes - a.bytes)
  const totalBytes = resources.reduce((sum, item) => sum + item.bytes, 0)
  const jsBytes = resources.filter((item) => item.url.endsWith('.js') || item.url.includes('.js?')).reduce((sum, item) => sum + item.bytes, 0)
  const cssBytes = resources.filter((item) => item.url.endsWith('.css')).reduce((sum, item) => sum + item.bytes, 0)
  const fontBytes = resources.filter((item) => item.url.endsWith('.woff2')).reduce((sum, item) => sum + item.bytes, 0)
  const longTaskTotal = metrics.longTasks.reduce((sum, duration) => sum + duration, 0)

  return {
    label,
    readyMs: Math.round(metrics.readyMs),
    previewTextLength: metrics.previewTextLength,
    fcpMs: metrics.fcpMs == null ? null : Math.round(metrics.fcpMs),
    domContentLoadedMs: metrics.domContentLoadedMs == null ? null : Math.round(metrics.domContentLoadedMs),
    loadMs: metrics.loadMs == null ? null : Math.round(metrics.loadMs),
    longTasks: { count: metrics.longTasks.length, totalMs: Math.round(longTaskTotal), maxMs: Math.round(Math.max(0, ...metrics.longTasks)) },
    bytes: { total: totalBytes, js: jsBytes, css: cssBytes, font: fontBytes },
    resources,
    resourceEntries: metrics.resources,
    consoleErrors,
  }
}

async function open(url, readyExpression, timeout = 20000) {
  network.clear()
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId)
  await send('Page.navigate', { url }, sessionId)
  const ready = await waitFor(readyExpression, timeout)
  const snap = await snapshot(url.replace(APP, '') || '/')
  return { ...snap, ready }
}

// ---------------------------------------------------------------- editor
const editor = await open(
  `${APP}/`,
  `Boolean(document.querySelector('[data-onboarding="editor"] .cm-editor') && (document.querySelector('[data-onboarding="preview"] section')?.textContent?.length ?? 0) > 100)`,
)
editor.readyLabel = 'editor ready (CodeMirror + preview mounted)'
fs.mkdirSync(path.dirname(OUT), { recursive: true })

// ---------------------------------------------------------------- themes
// 单独计时：第一张卡片出现、第一张预览渲染、219 张卡片齐。
// 旧实现进入页面就先算完 219 套预览，第一张卡片会等全部计算；新实现
// 卡片来自 metadata 目录，预览才按可见区域加载。
network.clear()
await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId)
const themesT0 = Date.now()
await send('Page.navigate', { url: `${APP}/themes` }, sessionId)
let firstCardMs = null
let firstPreviewMs = null
let allCardsMs = null
for (let i = 0; i < 300; i += 1) {
  const state = await evaluate(`JSON.stringify({
    cards: document.querySelectorAll('[data-theme-card]').length,
    rendered: document.querySelectorAll('[data-theme-preview="rendered"]').length,
  })`)
  const { cards, rendered } = JSON.parse(state)
  const at = Date.now() - themesT0
  if (firstCardMs == null && cards > 0) firstCardMs = at
  if (firstPreviewMs == null && rendered > 0) firstPreviewMs = at
  if (cards >= 219) {
    allCardsMs = at
    break
  }
  await sleep(50)
}
if (firstPreviewMs == null) {
  for (let i = 0; i < 200; i += 1) {
    if ((await evaluate(`document.querySelectorAll('[data-theme-preview="rendered"]').length`)) > 0) {
      firstPreviewMs = Date.now() - themesT0
      break
    }
    await sleep(50)
  }
}
const themeSnap = await snapshot('/themes')
const themes = {
  ...themeSnap,
  ready: allCardsMs != null,
  firstCardMs,
  firstPreviewMs,
  allCardsMs,
}
themes.readyLabel = '219 theme cards mounted'
themes.renderedUpfront = await evaluate(`document.querySelectorAll('[data-theme-preview="rendered"]').length`)
themes.cards = await evaluate(`document.querySelectorAll('[data-theme-card]').length`)
themes.themeChunks = [...new Set([...network.values()].filter((entry) => /\/(xiaohu|raphael|huasheng|md-wechat|wenyan|xedit|inkpress)-/.test(entry.url)).map((entry) => entry.url.split('/').pop()))]

await evaluate(`window.scrollTo(0, document.body.scrollHeight)`)
await sleep(2000)
themes.renderedAfterScroll = await evaluate(`document.querySelectorAll('[data-theme-preview="rendered"]').length`)
themes.themeChunksAfterScroll = [...new Set([...network.values()].filter((entry) => /\/(xiaohu|raphael|huasheng|md-wechat|wenyan|xedit|inkpress)-/.test(entry.url)).map((entry) => entry.url.split('/').pop()))]

const result = {
  measuredAt: new Date().toISOString(),
  app: APP,
  editor,
  themes,
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
console.log(`\nwrote ${OUT}`)

if (!editor.ready || !themes.ready) process.exitCode = 1

chrome.kill()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // Chrome may still hold the profile; the temp directory is disposable.
}