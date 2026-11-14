// Acceptance for B03: overlapping exports must not fight over the global
// exact-font patch, and the prototype must end exactly where it started.
//
// Drives the shipped card module in a real Chrome on a dense Chinese cover:
// - two card exports are started together (first started, first finished), while
// a third and fourth run one after another;
// - each export's pixels are compared with its sequential twin: the concurrent
// one must match it (mean <2, bad <0.025), which fails when the earlier
// export restores the native setProperty under the later one;
// - CSSStyleDeclaration.prototype.setProperty is compared with the method
// captured before any export: after the overlap and after the sequential runs
// it must be the exact same function, not a wrapper left behind.
//
// Build first (`npm run build`), then:
// node scripts/cdp-verify-export-concurrency.mjs [appPort] [cdpPort]
// Evidence (compared PNGs, page screenshots, metrics JSON) lands in
// verify-out/export-concurrency/<timestamp>/.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP_PORT = Number(process.argv[2] || 4113)
const CDP_PORT = Number(process.argv[3] || 9713)
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const DB_FILE = path.resolve('data/audit-b03.db')
const ACCESS_KEY = 'export-concurrency-acceptance-key'
const SESSION_SECRET = 'export-concurrency-acceptance-session-secret'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const output = path.resolve('verify-out/export-concurrency', new Date().toISOString().replace(/[:.]/g, '-'))

const DENSE_ZH = `# 把日常写成值得收藏的卡片：一份关于观察、记忆与缓慢记录的练习

用一篇固定的测试稿 Reed 2026，检验长标题、副标题、列表与多页排版。中文断行对字号的微小变化很敏感，这一段密集的文字会跟着每一页排下去，用来确认导出与预览一致。

## 阅读从这里开始

清晨的城市还没有完全醒来，街边的早餐店已经亮起了灯。我们沿着河岸慢慢走，把看到的细节写进笔记：桥下的水声、骑车人衣角的风、远处高楼玻璃上跳动的光。记录不是把一天压缩成摘要，而是把那些容易被忽略的瞬间一一留住。

写作最大的困难往往不是没有素材，而是不知道该留下什么。试着每天只写三件小事，每件不超过三句话：一件让你停下来的事，一件让你改变主意的事，一件让你想起某个人的事。一个月后再读，你会看见一条只有自己走得出来的路线。

把笔记变成文章，需要一点结构。先写一个能站住的标题，再用第一段把读者带进来，然后让每一节只解决一个问题。不要害怕删掉漂亮的句子，如果它不推进文章，它就是在占用读者的注意力。

## 留白的价值

留白不是空，它是呼吸的位置。段落之间、图片周围、标题和正文之间，都需要一段距离。电子阅读的屏幕小，留白太少会让人烦躁；留白太多又会让内容显得散。好的版式让眼睛知道下一步该去哪里。

## 慢一点

承认自己写得慢，也承认改得慢。慢不是效率低，而是给判断留出时间。把一篇文章放一晚再读，最先跳出来的问题通常就是真正的问题。改到第三遍，你会开始怀疑自己，这时候要停下来，去走一走，再回来。`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(` [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`)
}

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(DB_FILE + suffix, { force: true })
  } catch {
    /* nothing to clear */
  }
}
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/audit-b03.db',
    IMG_BASE_URL: `http://127.0.0.1:${APP_PORT + 100}`,
    IMG_ADMIN_KEY: 'export-concurrency-acceptance-admin',
    ACCESS_KEY,
    SESSION_SECRET,
    ANON_GC_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => (appLog += d))
app.stderr.on('data', (d) => (appLog += d))
async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(appUrl, { redirect: 'manual' })
      if (r.status < 500) return
    } catch {
      /* not listening yet */
    }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP_PORT}\n${appLog.slice(-800)}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'export-concurrency-'))
let chrome = null
let send = null
let ev = null
let sessionId = null

try {
  await waitUp()
  fs.mkdirSync(output, { recursive: true })
  console.log(`evidence: ${output}`)

  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--no-proxy-server',
      '--window-size=1600,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  async function wsUrl() {
    for (let i = 0; i < 80; i++) {
      try {
        const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
        if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
      } catch {
        /* not up yet */
      }
      await sleep(250)
    }
    throw new Error('no CDP')
  }

  let id = 1
  const pending = new Map()
  const client = (socket) => {
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(event.data)
      if (m.id && pending.has(m.id)) {
        const entry = pending.get(m.id)
        pending.delete(m.id)
        m.error ? entry.reject(new Error(JSON.stringify(m.error))) : entry.resolve(m.result)
      }
    })
    return (method, params = {}, sid) =>
      new Promise((resolve, reject) => {
        const i = id++
        pending.set(i, { resolve, reject })
        socket.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }))
        setTimeout(() => {
          if (pending.has(i)) {
            pending.delete(i)
            reject(new Error('timeout ' + method))
          }
        }, 120000)
      })
  }

  const ws = new WebSocket(await wsUrl())
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  send = client(ws)

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source:
        'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' +
        ';window.__nativeSetProperty=CSSStyleDeclaration.prototype.setProperty',
    },
    sessionId,
  )

  ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    }
    return r.result.value
  }
  const screenshot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
  }
  const waitFor = async (expr, ms = 30000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (await ev(expr)) return true
      await sleep(200)
    }
    return false
  }
  const switchMode = async (mode) => {
    await ev(
      `(() => { const b = document.querySelector('[data-preview-mode="${mode}"]'); if (b) b.click(); return true })()`,
    )
    await sleep(900)
  }
  const setContent = (md) =>
    ev(`(() => {
 const view = window.__mopaiCodemirror
 if (!view) return 'no editor'
 view.dispatch({ changes: { from:0, to: view.state.doc.length, insert: ${JSON.stringify(md)} } })
 return 'ok'
 })()`)

  await send('Page.navigate', { url: appUrl }, sessionId)
  await sleep(2500)
  check('the editor mounts', await waitFor('Boolean(window.__mopaiCodemirror)'))
  await setContent(DENSE_ZH)
  await switchMode('cards')
  const cardsReady = await waitFor(
    `Boolean(document.querySelector('[data-xhs-view][data-ready="true"]')) && document.querySelectorAll('.xhs-card').length >0`,
    40000,
  )
  check('the dense Chinese card is paginated and ready', cardsReady)
  await screenshot('cards-before-export.png')

  // The card view imports cards-export lazily; its chunk is a build artifact
  // named after the module, so it can be found without hardcoding a hash.
  const chunkUrl = await ev(`(() => {
 const entry = performance.getEntriesByType('resource')
 .map((e) => e.name)
 .find((name) => /\\/assets\\/cards-export-[^/]+\\.js$/.test(name))
 return entry || ''
 })()`)
  check('the card export module is loaded', Boolean(chunkUrl), chunkUrl)

  const result = await ev(`(async () => {
 const mod = await import(${JSON.stringify(chunkUrl)})
 const node = document.querySelector('.xhs-card[data-card-index="0"]')
 if (!node) return { error: 'no card node' }
 const spec = { faces: [], packageCss: '', userFonts: [] }
 const nativeAtStart = CSSStyleDeclaration.prototype.setProperty
 const sameAsBoot = nativeAtStart === window.__nativeSetProperty
 const shootOne = async () => {
 const exporter = await mod.createCardExporter([node], spec)
 try {
 return await exporter.shoot(0)
 } finally {
 exporter.dispose()
 }
 }
 const started = performance.now()
 // Concurrent pair: both exporters are created, then both shoots start in the
 // same tick. The first one to finish restores the prototype in the old code,
 // which starves the second one mid-clone.
 const a1 = await mod.createCardExporter([node], spec)
 const a2 = await mod.createCardExporter([node], spec)
 const concurrentPromise = Promise.all([a1.shoot(0), a2.shoot(0)])
 const midFlightPatched = CSSStyleDeclaration.prototype.setProperty !== nativeAtStart
 const concurrent = await concurrentPromise
 a1.dispose()
 a2.dispose()
 const concurrentMs = performance.now() - started
 const afterConcurrent = CSSStyleDeclaration.prototype.setProperty === nativeAtStart
 // Sequential twins: the same export, one after another, with no overlap.
 const sequential = []
 for (let i =0; i <2; i++) sequential.push(await shootOne())
 const afterSequential = CSSStyleDeclaration.prototype.setProperty === nativeAtStart
 const metrics = async (one, two) => {
 const [a, b] = await Promise.all([createImageBitmap(one), createImageBitmap(two)])
 if (a.width !== b.width || a.height !== b.height) {
 return { mean:255, bad:1, width: a.width, height: a.height }
 }
 const canvas = document.createElement('canvas')
 canvas.width = a.width
 canvas.height = a.height
 const context = canvas.getContext('2d', { willReadFrequently: true })
 context.drawImage(a,0,0)
 const first = context.getImageData(0,0, a.width, a.height).data
 context.clearRect(0,0, a.width, a.height)
 context.drawImage(b,0,0)
 const second = context.getImageData(0,0, a.width, a.height).data
 let sum =0
 let bad =0
 for (let i =0; i < first.length; i +=4) {
 const diff = (Math.abs(first[i] - second[i]) + Math.abs(first[i +1] - second[i +1]) + Math.abs(first[i +2] - second[i +2])) /3
 sum += diff
 if (diff >25) bad++
 }
 const pixels = first.length /4
 return { mean: sum / pixels, bad: bad / pixels, width: a.width, height: a.height }
 }
 const blobB64 = async (blob) => {
 const bytes = new Uint8Array(await blob.arrayBuffer())
 let text = ''
 for (let i =0; i < bytes.length; i +=0x8000) text += String.fromCharCode(...bytes.subarray(i, i +0x8000))
 return btoa(text)
 }
 const comparison = {
 concurrentA: await metrics(concurrent[0], sequential[0]),
 concurrentB: await metrics(concurrent[1], sequential[1]),
 crossConcurrent: await metrics(concurrent[0], concurrent[1]),
 }
 return {
 sameAsBoot,
 midFlightPatched,
 afterConcurrent,
 afterSequential,
 comparison,
 concurrentMs,
 sizes: concurrent.map((blob) => blob.size),
 sequentialSizes: sequential.map((blob) => blob.size),
 exportA: await blobB64(concurrent[1]),
 exportB: await blobB64(sequential[1]),
 }
 })()`)

  check('the module started from the native setProperty', result?.sameAsBoot === true)
  check(
    'the patch is installed while both exports are in flight',
    result?.midFlightPatched === true,
    JSON.stringify(result && { midFlightPatched: result.midFlightPatched }),
  )
  check('the prototype is restored after the overlap', result?.afterConcurrent === true)
  check('the prototype is restored after the sequential twins', result?.afterSequential === true)
  check(
    'the concurrent first export matches its sequential twin',
    (result?.comparison.concurrentA.mean ?? 255) < 2 && (result?.comparison.concurrentA.bad ?? 1) < 0.025,
    JSON.stringify(result?.comparison.concurrentA),
  )
  check(
    'the concurrent second export matches its sequential twin',
    (result?.comparison.concurrentB.mean ?? 255) < 2 && (result?.comparison.concurrentB.bad ?? 1) < 0.025,
    JSON.stringify(result?.comparison.concurrentB),
  )
  check(
    'the two concurrent exports match each other',
    (result?.comparison.crossConcurrent.mean ?? 255) < 2 && (result?.comparison.crossConcurrent.bad ?? 1) < 0.025,
    JSON.stringify(result?.comparison.crossConcurrent),
  )
  check(
    'the exports keep the preview size',
    (result?.comparison.concurrentA.width ?? 0) === 1080 && (result?.comparison.concurrentA.height ?? 0) === 1440,
    JSON.stringify(result?.comparison.concurrentA),
  )

  if (result?.exportA && result?.exportB) {
    fs.writeFileSync(path.join(output, 'concurrent-second.png'), Buffer.from(result.exportA, 'base64'))
    fs.writeFileSync(path.join(output, 'sequential-second.png'), Buffer.from(result.exportB, 'base64'))
  }
  fs.writeFileSync(
    path.join(output, 'metrics.json'),
    JSON.stringify(
      {
        chunkUrl,
        sameAsBoot: result?.sameAsBoot,
        midFlightPatched: result?.midFlightPatched,
        afterConcurrent: result?.afterConcurrent,
        afterSequential: result?.afterSequential,
        comparison: result?.comparison,
        concurrentMs: result?.concurrentMs,
        sizes: result?.sizes,
        sequentialSizes: result?.sequentialSizes,
      },
      null,
      2,
    ),
  )
  await screenshot('cards-after-export.png')
} catch (e) {
  failures++
  console.log(`\n[FATAL] ${e instanceof Error ? e.message : String(e)}`)
  if (appLog) console.log(appLog.slice(-1200))
} finally {
  try {
    chrome?.kill()
  } catch {
    /* already gone */
  }
  try {
    app.kill()
  } catch {
    /* already gone */
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Chrome may hold it */
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
