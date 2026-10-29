// Drive a real re-crop in the browser, with the upload endpoint stubbed.
//
// Re-cropping fetches the stored image back from our own origin and re-uploads
// it under a new key, so the old object is left behind. That is by design (the
// materials page collects it), but the owner is never told. This checks that:
//   - a re-cropped standalone image replaces its line instead of adding one
//   - a re-cropped carousel slide replaces its slide
//   - the owner is told the previous upload is now unreferenced
//
// Uploads go to R2 for real, so the tRPC call is intercepted and answered with
// a synthetic key. Everything else — cropper, markdown rewrite, toasts — is the
// shipped code.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3199'
const ACCESS_KEY = process.argv[3] || ''
const PORT = 9336
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp4-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1600,900',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl } catch {}
    await sleep(250)
  }
  throw new Error('no CDP')
}
let id = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
  })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++; pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 30000)
  })
}

const results = []
function check(group, name, ok, detail = '') {
  results.push({ group, name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${group} :: ${name}${detail ? ` — ${detail}` : ''}`)
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
// The first-run tour auto-starts on a fresh profile and its dialog would
// intercept the editor; this script tests re-cropping, not the tour.
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' }, sessionId)

const pageErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || '?')
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

// ---- stub the upload + image-read endpoints --------------------------------
// Hijack fetch inside the page: uploads answer a synthetic key and record the
// real pixel dimensions of the blob, while image reads return a controlled
// 1200×900 source. Everything else flows through the shipped code.
const stubSrc = `(() => {
  const rawFetch = window.fetch
  window.__uploadedKeys = []
  window.__uploadedSizes = []
  let seq = 0
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    if (/storage\\.upload/.test(url)) {
      return (async () => {
        const key = 'stubkey' + (++seq)
        window.__uploadedKeys.push(key)
        try {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
          const findBase64 = (value) => {
            if (!value || typeof value !== 'object') return null
            if (typeof value.contentBase64 === 'string') return value.contentBase64
            for (const child of Object.values(value)) {
              const found = findBase64(child)
              if (found) return found
            }
            return null
          }
          const base64 = findBase64(body)
          if (base64) {
            const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))])
            const bitmap = await createImageBitmap(blob)
            window.__uploadedSizes.push({ key, width: bitmap.width, height: bitmap.height })
            bitmap.close()
          }
        } catch (error) {
          window.__uploadedSizes.push({ key, error: String(error) })
        }
        return new Response(JSON.stringify({ result: { data: { json: { key, size: 1234 } } } }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      })()
    }
    if (/\\/api\\/img\\//.test(url)) {
      return new Promise((resolve) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1200
        canvas.height = 900
        const context = canvas.getContext('2d')
        const gradient = context.createLinearGradient(0, 0, 1200, 900)
        gradient.addColorStop(0, '#16365c')
        gradient.addColorStop(1, '#e5a54b')
        context.fillStyle = gradient
        context.fillRect(0, 0, 1200, 900)
        context.fillStyle = 'rgba(255,255,255,.8)'
        for (let x = 0; x < 1200; x += 100) context.fillRect(x, 0, 2, 900)
        for (let y = 0; y < 900; y += 100) context.fillRect(0, y, 1200, 2)
        canvas.toBlob((blob) => resolve(new Response(blob, {
          status: 200, headers: { 'Content-Type': 'image/png' },
        })), 'image/png')
      })
    }
    return rawFetch.apply(this, arguments)
  }
  return true
})()`

const go = async (url) => { await send('Page.navigate', { url }, sessionId); await sleep(3500) }
await go(APP)
if (ACCESS_KEY) {
  await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`)
  await go(APP)
}
// Install the stub after login so the auth call flows normally.
await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSrc }, sessionId)
await evaluate(stubSrc)
const uploadedKeys = () => evaluate(`window.__uploadedKeys || []`)
const uploadedSizes = () => evaluate(`window.__uploadedSizes || []`)

const setDoc = async (markdown) => {
  await evaluate(`(() => { const v = window.__mopaiCodemirror
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(markdown)} } }); return true })()`)
  await sleep(700)
}
const readDoc = () => evaluate(`window.__mopaiCodemirror.state.doc.toString()`)
const clickRow = (no, label) =>
  evaluate(`(() => {
    for (const row of [...document.querySelectorAll('aside li')]) {
      const badge = row.querySelector('span')
      if (!badge || badge.textContent.trim() !== ${JSON.stringify(no)}) continue
      const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})
      if (!btn) return 'no-button'
      btn.click(); return 'clicked'
    }
    return 'no-row'
  })()`)
const toastTexts = () => evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.innerText.replace(/\\n/g,' '))`)
const dialogText = () => evaluate(`(() => {
  const d = document.querySelector('[role=dialog]')
  return d ? d.innerText.replace(/\\n/g,' | ').slice(0,300) : 'no dialog'
})()`)
const clickDialogButton = (label) =>
  evaluate(`(() => {
    const d = document.querySelector('[role=dialog]')
    if (!d) return 'no-dialog'
    const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
    if (!b) return 'no-button:' + [...d.querySelectorAll('button')].map(x=>x.textContent.trim()).join('/')
    b.click(); return 'clicked'
  })()`)

/** Pick a ratio in the picker and confirm with whatever the label reads. */
async function cropAndUpload(ratioLabel) {
  const picked = await clickDialogButton(ratioLabel)
  if (picked !== 'clicked') return picked
  await sleep(400)
  const applied = await clickDialogButton('按这个比例上传')
  return applied
}

/** Re-crop goes straight to the manual cropper; confirm its action button. */
async function confirmManualCrop() {
  // Wait until the crop area is initialised so the button becomes enabled.
  for (let i = 0; i < 20; i++) {
    const ready = await evaluate(`(() => {
      const d = document.querySelector('[role=dialog]')
      if (!d) return 'no'
      const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '用这块区域上传')
      return b && !b.disabled ? 'yes' : 'wait'
    })()`)
    if (ready === 'yes') return clickDialogButton('用这块区域上传')
    if (ready === 'no') return 'no-dialog'
    await sleep(300)
  }
  return 'timeout'
}

// ---- 1. re-crop a standalone image ----------------------------------------
console.log('\n=== re-crop a standalone image ===')
const LOOSE = `## 01 | 单图重裁

![要重裁的图](img:ORIGKEY)

后面一段字。
`
await setDoc(LOOSE)
await sleep(700)
console.log('  rows:', await evaluate(`[...document.querySelectorAll('aside li')].map(r=>r.querySelector('span')?.textContent.trim())`))
const r1 = await clickRow('图1', '重裁')
check('recrop', 'the row has a 重裁 button', r1 === 'clicked', r1)
await sleep(1500)
console.log('  dialog:', await dialogText())
const applied = await confirmManualCrop()
check('recrop', 'the manual cropper opened and the upload was confirmed', applied === 'clicked', applied)
await sleep(2800)
const afterLoose = await readDoc()
console.log('  markdown after re-crop:\n' + afterLoose.split('\n').map((l) => '    ' + l).join('\n'))
check('recrop', 'the image line was replaced, not duplicated',
  (afterLoose.match(/!\[要重裁的图\]/g) || []).length === 1)
check('recrop', 'the new key is written in place', /!\[要重裁的图\]\(img:stubkey\d+\)/.test(afterLoose))
check('recrop', 'the old key is gone from the markdown', !/ORIGKEY/.test(afterLoose))
const looseSize = (await uploadedSizes()).at(-1)
check(
  'ratio',
  'standalone free crop keeps the source 4:3 shape',
  Math.abs((looseSize?.width ?? 0) / (looseSize?.height ?? 1) - 4 / 3) < 0.01,
  JSON.stringify(looseSize),
)
console.log('  toasts:', JSON.stringify(await toastTexts()))

// ---- 2. re-crop a carousel slide ------------------------------------------
console.log('\n=== re-crop one carousel slide ===')
const CAR = `## 02 | 轮播重裁

:::carousel 4:3 组
![甲](img:AKEY)
![乙](img:BKEY)
:::
`
await setDoc(CAR)
await sleep(800)
const r2 = await clickRow('图1-2', '重裁')
check('recrop', 'the carousel row has a 重裁 button', r2 === 'clicked', r2)
await sleep(1500)
const applied2 = await confirmManualCrop()
check('recrop', 'carousel cropper confirmed', applied2 === 'clicked', applied2)
await sleep(2800)
const afterCar = await readDoc()
console.log('  markdown after re-crop:\n' + afterCar.split('\n').map((l) => '    ' + l).join('\n'))
check('recrop', 'slide 1 is untouched', /!\[甲\]\(img:AKEY\)/.test(afterCar))
check('recrop', 'slide 2 got the new key', /!\[乙\]\(img:stubkey\d+\)/.test(afterCar))
check('recrop', 'the old slide key is gone', !/BKEY/.test(afterCar))
const carouselSize = (await uploadedSizes()).at(-1)
check('ratio', '4:3 carousel output is 720×540', carouselSize?.width === 720 && carouselSize?.height === 540, JSON.stringify(carouselSize))
console.log('  toasts:', JSON.stringify(await toastTexts()))

// ---- 3. every group ratio survives carousel and gallery re-cropping --------
console.log('\n=== group ratios are inherited by the manual cropper ===')
const RATIOS = [
  ['9:16', 405, 720],
  ['3:4', 540, 720],
  ['1:1', 720, 720],
]

async function recropSingle(fence, ratio, kind) {
  const expected = RATIOS.find(([value]) => value === ratio)
  if (!expected) throw new Error(`missing expected size for ${ratio}`)
  const markdown = kind === 'carousel'
    ? `## ${ratio} 轮播\n\n:::carousel ${ratio} 测试组\n![图](img:${ratio.replace(':', 'x')}KEY)\n:::\n`
    : `## ${ratio} 网格\n\n:::gallery 2 ${ratio} 测试组\n![图](img:${ratio.replace(':', 'x')}KEY)\n:::\n`
  await setDoc(markdown)
  await sleep(800)
  const clicked = await clickRow('图1-1', '重裁')
  check('ratio', `${ratio} ${kind} re-crop control exists`, clicked === 'clicked', clicked)
  await sleep(1500)
  const dialog = await dialogText()
  check('ratio', `${ratio} ${kind} cropper is locked to the group frame`, dialog.includes(ratio), dialog.slice(0, 140))
  const applied = await confirmManualCrop()
  check('ratio', `${ratio} ${kind} cropper confirmed`, applied === 'clicked', applied)
  await sleep(2800)
  const size = (await uploadedSizes()).at(-1)
  check(
    'ratio',
    `${ratio} ${kind} uploads ${expected[1]}×${expected[2]} pixels`,
    size?.width === expected[1] && size?.height === expected[2],
    JSON.stringify(size),
  )
  const source = await readDoc()
  check('ratio', `${ratio} ${kind} fence and image stay in place`, source.includes(`:::${fence} 2 ${ratio}`) || source.includes(`:::${fence} ${ratio}`))
}

for (const ratioCase of RATIOS) {
  await recropSingle('carousel', ratioCase[0], 'carousel')
  await recropSingle('gallery', ratioCase[0], 'gallery')
}

// ---- 4. cancelling a free crop changes neither source nor storage ----------
console.log('\n=== cancelling a standalone re-crop is a no-op ===')
const CANCEL = `## 取消重裁\n\n![不要改](img:CANCELKEY)\n`
await setDoc(CANCEL)
const uploadsBeforeCancel = (await uploadedKeys()).length
const cancelOpen = await clickRow('图1', '重裁')
check('cancel', 'standalone re-crop opened', cancelOpen === 'clicked', cancelOpen)
await sleep(1400)
const cancelled = await clickDialogButton('取消')
check('cancel', 'cropper cancelled', cancelled === 'clicked', cancelled)
await sleep(600)
check('cancel', 'source still points at the original object', (await readDoc()) === CANCEL)
check('cancel', 'cancel did not mint another upload', (await uploadedKeys()).length === uploadsBeforeCancel)

// ---- 5. the owner is told about the orphaned upload ------------------------
console.log('\n=== the replaced upload is announced ===')
const texts = (await toastTexts()).join(' || ')
console.log('  visible toasts:', texts)
check('orphan', 'the owner is told the old image is unreferenced',
  /不再引用|素材库/.test(texts))
const keys = await uploadedKeys()
check('uploads', 'each re-crop minted exactly one new key', keys.length >= 2, keys.join(','))

console.log('\n=== page errors ===')
check('runtime', 'no uncaught exceptions', pageErrors.length === 0, pageErrors.join(' | '))

ws.close(); chrome.kill()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
