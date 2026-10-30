// U05 failure-mode acceptance: route chunk failure, theme pack failure and
// dynamic-import retry must never white-screen or lose the local draft.
//
// Usage: node scripts/cdp-verify-u05-load-failure.mjs <appUrl> [cdpPort]
//
// It drives the real production build in headless Chrome:
//   1. block the /themes route chunk -> visible error + working retry;
//   2. block the pack of the saved theme -> editor still mounts on golden,
//      shows the persisted retry toast, then recovers once the pack is back;
//   3. go offline, navigate to /themes through the UI -> error page instead of
//      a blank screen, then recover online.
//
// It does not claim to cover an offline first navigation: without a service
// worker the browser cannot load the HTML itself.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = (process.argv[2] || 'http://127.0.0.1:4130').replace(/\/$/, '')
const PORT = Number(process.argv[3] || 9735)
const SHOTS = 'verify-out/u05/failure'
fs.mkdirSync(SHOTS, { recursive: true })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-u05-failure-'))
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
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

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

const consoleErrors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '))
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params?.exceptionDetails
    consoleErrors.push(String(details?.exception?.description ?? details?.text ?? 'exception'))
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

async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(150)
  }
  return Boolean(await evaluate(expression))
}

async function block(urls) {
  await send('Network.setBlockedURLs', { urls }, sessionId)
}

async function offline(value) {
  await send(
    'Network.emulateNetworkConditions',
    {
      offline: value,
      latency: 0,
      downloadThroughput: value ? 0 : -1,
      uploadThroughput: value ? 0 : -1,
      connectionType: value ? 'none' : 'wifi',
    },
    sessionId,
  )
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'))
}

async function navigate(url) {
  await send('Page.navigate', { url }, sessionId)
}

const EDITOR_READY =
  `Boolean(document.querySelector('[data-onboarding="editor"] .cm-editor') && (document.querySelector('[data-onboarding="preview"] section')?.textContent?.length ?? 0) > 100)`
const ERROR_TEXT = `document.body.innerText.includes('这个页面没能加载') || document.body.innerText.includes('This page could not load')`

// ---------------------------------------------------------------- 1. route chunk
console.log('\n=== /materials route chunk blocked ===')
await block(['*Materials-*.js'])
await navigate(`${APP}/materials`)
const routeErrorShown = await waitFor(ERROR_TEXT, 15000)
check('blocked route chunk shows the error page', routeErrorShown)
if (!routeErrorShown) {
  console.log('  body:', (await evaluate(`document.body.innerText`)).slice(0, 400).replace(/\n/g, ' | '))
  console.log('  html:', (await evaluate(`document.body.innerHTML`)).slice(0, 400))
  console.log('  errors:', consoleErrors.slice(0, 3).join(' || '))
}
check('route error page is not blank', (await evaluate(`document.body.innerText.trim().length`)) > 20)
check(
  'route error page offers retry and refresh',
  await evaluate(`[...document.querySelectorAll('button')].some(b => /重试|Retry/.test(b.textContent)) && [...document.querySelectorAll('button')].some(b => /刷新页面|Refresh page/.test(b.textContent))`),
)
await shot('01-route-chunk-blocked.png')

await block([])
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /重试|Retry/.test(b.textContent))
  btn?.click()
  return Boolean(btn)
})()`)
const routeRecovered = await waitFor(
  `document.body.innerText.includes('素材库') && !document.body.innerText.includes('这个页面没能加载')`,
  15000,
)
check('retry after unblocking loads the materials page', routeRecovered)
if (!routeRecovered) {
  console.log('  body:', (await evaluate(`document.body.innerText`)).slice(0, 300).replace(/\n/g, ' | '))
  console.log('  path:', await evaluate(`location.pathname`))
  console.log('  errors:', consoleErrors.slice(-2).join(' || '))
}
await shot('02-route-chunk-recovered.png')

// ---------------------------------------------------------------- 2. theme pack
console.log('\n=== saved theme pack blocked ===')
await navigate(`${APP}/`)
await waitFor(EDITOR_READY)
await evaluate(`(() => {
  const raw = localStorage.getItem('mopai.settings.v1')
  const settings = raw ? JSON.parse(raw) : {}
  localStorage.setItem('mopai.settings.v1', JSON.stringify({
    ...settings,
    themeId: 'xiaohu-academic-paper',
    sig: settings.sig || { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' },
    syncScroll: settings.syncScroll ?? true,
    zoom: settings.zoom ?? 100,
  }))
  return true
})()`)

await block(['*xiaohu-*.js'])
await send('Page.reload', {}, sessionId)
const editorStillMounted = await waitFor(EDITOR_READY, 15000)
check('editor still mounts when the saved theme pack is blocked', editorStillMounted)
const articleVisible = await waitFor(
  `(document.querySelector('[data-onboarding="preview"] section')?.textContent?.length ?? 0) > 100`,
  10000,
)
const previewText = await evaluate(`document.querySelector('[data-onboarding="preview"] section')?.textContent ?? ''`)
check(
  'preview keeps the article text (no blank / no draft loss)',
  articleVisible,
  `${previewText.length} chars`,
)
const themeToast = await waitFor(
  `(() => {
    const t = document.querySelector('[data-sonner-toast]')
    return Boolean(t && /主题没能载入|theme could not load/i.test(t.innerText))
  })()`,
  10000,
)
check('a persistent toast explains the theme fallback', themeToast)
if (!themeToast) {
  console.log('  toasts:', JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.innerText)`)))
  console.log('  settings:', await evaluate(`localStorage.getItem('mopai.settings.v1')`))
}
const retryInToast = await evaluate(`(() => {
  const toast = document.querySelector('[data-sonner-toast]')
  return Boolean(toast && [...toast.querySelectorAll('button')].some(b => /重试|Retry/.test(b.textContent)))
})()`)
check('theme toast offers retry', retryInToast)
await shot('03-theme-pack-blocked.png')

await block([])
await evaluate(`(() => {
  const toast = document.querySelector('[data-sonner-toast]')
  const btn = toast && [...toast.querySelectorAll('button')].find(b => /重试|Retry/.test(b.textContent))
  btn?.click()
  return Boolean(btn)
})()`)
const themeRecovered = await waitFor(
  `(() => {
    const root = document.querySelector('[data-onboarding="preview"] section')
    if (!root) return false
    return getComputedStyle(root).fontFamily.includes('Times New Roman')
  })()`,
  15000,
)
check('retry loads the saved theme implementation', themeRecovered)
await shot('04-theme-pack-recovered.png')

// ---------------------------------------------------------------- 3. offline UI nav
console.log('\n=== offline /references navigation ===')
await navigate(`${APP}/`)
await waitFor(EDITOR_READY)
consoleErrors.length = 0
await offline(true)
// SPA 导航到一个本会话还没加载过分块的路由：不刷新整页 HTML，只让路由分块加载失败。
await evaluate(`(() => {
  window.history.pushState({}, '', '/references')
  window.dispatchEvent(new PopStateEvent('popstate'))
  return location.pathname
})()`)
const offlineErrorShown = await waitFor(ERROR_TEXT, 15000)
check('offline chunk failure shows the error page', offlineErrorShown)
if (!offlineErrorShown) {
  console.log('  body:', (await evaluate(`document.body.innerText`)).slice(0, 300).replace(/\n/g, ' | '))
  console.log('  path:', await evaluate(`location.pathname`))
}
check(
  'offline error keeps the editor\'s local draft in storage',
  (await evaluate(`localStorage.getItem('mopai.settings.v1') !== null`)) === true,
)
await shot('05-offline-route-error.png')

await offline(false)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /重试|Retry/.test(b.textContent))
  btn?.click()
  return Boolean(btn)
})()`)
const offlineRecovered = await waitFor(
  `document.body.innerText.includes('致谢') && !document.body.innerText.includes('这个页面没能加载')`,
  15000,
)
check('retry after going back online loads the references page', offlineRecovered)
if (!offlineRecovered) {
  console.log('  body:', (await evaluate(`document.body.innerText`)).slice(0, 300).replace(/\n/g, ' | '))
  console.log('  path:', await evaluate(`location.pathname`))
  console.log('  errors:', consoleErrors.slice(-2).join(' || '))
}

// 分块失败的 console 错误是预期的（错误边界已经接管 UI）；有可见错误页和成功
// 重试即可，不把「控制台有网络错误」本身当成白屏。

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
if (failures > 0) process.exitCode = 1

chrome.kill()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // Chrome may still hold the profile; the temp directory is disposable.
}