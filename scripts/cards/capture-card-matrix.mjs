// Captures one fixed Markdown draft as card PNGs for every template variant and
// supported ratio. Run only against a built `dist/`:
//   node scripts/cards/capture-card-matrix.mjs --out <dir> [--templates a,b] [--mode builtin] [--append]
//
// Batching: run one template per invocation so Chrome and the app are torn down
// between templates. `--append` merges the new entries into an existing
// manifest in `--out`, which is how a batched `--mode uploaded` capture is
// assembled without redoing earlier templates.
//
// It owns a fresh Chrome profile, a local mock image worker and the app's test
// database. Baseline and converted-template directories are compared by
// scripts/cards/compare-card-matrix.mjs; neither output path is part of the
// repository.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : fallback
}
const out = path.resolve(arg('out', 'verify-out/card-matrix'))
const port = Number(arg('port', 3281))
const cdpPort = Number(arg('cdp', 9398))
const workerPort = port + 100
const origin = `http://127.0.0.1:${port}`
const mode = arg('mode', 'builtin')
const onlyTemplates = (arg('templates', '') || '').split(',').filter(Boolean)
const onlyRatios = (arg('ratios', '') || '').split(',').filter(Boolean)
const catalogPath = arg('catalog', '')
const catalog = catalogPath ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : []
const append = args.includes('--append')

const TEMPLATES = ['reed']
const VARIANTS = {
  reed: ['paper', 'white', 'grid', 'tint', 'night'],
}
const RATIOS = { '3:4': 720, '1:1': 540, '9:16': 960 }

const DRAFT = `# 把日常写成值得收藏的卡片：一份关于观察、记忆与缓慢记录的练习

用一篇固定的测试稿，检验长标题、副标题、列表、引用与多页排版。

## 阅读从这里开始

清晨的城市还没有完全醒来，街边的早餐店已经亮起了灯。我们沿着河岸慢慢走，把看到的细节写进笔记：桥下的水声、便利店门口的灯、骑车人外套上的反光。写作并不总要从一个宏大的观点开始，先说清眼前发生了什么，再去追问它为什么值得记住。

同一段文字出现在长文章和图文卡片里，阅读节奏会变，内容的意思却应当完整保留。好的留白让读者有时间停顿，清楚的层级让他们在滑动时知道自己读到了哪里。记录真实的颜色、声音和人物，比堆砌抽象形容词更能留下画面。

> 写作不是把一切都说尽，而是让读者愿意停下来，多看一眼。

## 可以照着做的步骤

1. 先写下今天真正看见的三件事，不加判断。
2. 为每件事补上一个具体的细节：时间、地点、气味或声音。
3. 删掉重复的形容词，把抽象的词换成看得见的动作。
4. 读一遍，找出最想留给读者的那一句。
5. 把它放到段落的开头或结尾，让文章有呼吸。

- 一张卡片只讲一个意思，别让读者替你找重点。
- 引用要短，但要有分量。
- 列表适合步骤，不适合堆砌观点。
- 留白也是内容的一部分。

## 第二章：慢一点记录

午后光线从窗帘的缝隙里进来，桌上的纸杯留下一个圆形的影子。我们常常以为记录需要完整的句子，其实一个准确的动词、一个没有被修饰的名词，就足以把一天固定下来。把相机放下，先用眼睛看三十秒，再决定要写什么。

每次修改，都试着把一句话说得更具体。不是「天气很好」，而是「风把晾在阳台上的衬衫吹得鼓起来」。不是「他很累」，而是「他把钥匙放在桌上，坐了半分钟才想起要开灯」。具体的句子会自己长出节奏。

## 数据与例子

| 观察 | 记录方式 | 用途 |
|:--|:--|:--|
| 河岸的光 | 照片与一句笔记 | 建立场景 |
| 早餐店的声音 | 三行对话 | 保留人物 |
| 回家的路线 | 时间与地标 | 组织叙事 |

---

## 留给下一次出发

每一次记录都是重新认识日常的机会。把今天写下来，明天再带着新的眼光出发。`
const DRAFT_TITLE = DRAFT.split('\n')[0].slice(2)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function freePort(value) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve) })
  await new Promise((resolve) => server.close(resolve))
}
await Promise.all([port, cdpPort, workerPort].map(freePort))

// A tiny 2x2 PNG keeps the app's image preloader exercised without making the
// matrix depend on a network host.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMAAAAwBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const worker = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' })
  res.end(pixel)
})
await new Promise((resolve) => worker.listen(workerPort, '127.0.0.1', resolve))

fs.mkdirSync(out, { recursive: true })
fs.mkdirSync(path.resolve('data'), { recursive: true })
fs.writeFileSync(path.join(out, 'draft.md'), DRAFT)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-matrix-'))
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: 'file:./data/test-tpl.db', ANON_GC_ENABLED: 'false',
    IMG_BASE_URL: `http://127.0.0.1:${workerPort}`, IMG_ADMIN_KEY: randomBytes(24).toString('hex'),
    ACCESS_KEY: randomBytes(24).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'), AGENT_TOKENS: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (data) => { appLog += data })
app.stderr.on('data', (data) => { appLog += data })

let chrome
let ws
let send
let sessionId
const consoleErrors = []
const consoleLogs = []
const exceptions = []

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, timeout = 45000) {
  const end = Date.now() + timeout
  do {
    if (await evaluate(expression)) return
    await sleep(120)
  } while (Date.now() < end)
  throw new Error('waitFor: ' + expression.slice(0, 200))
}
async function click(selector) {
  const clicked = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true })()`)
  if (!clicked) throw new Error('missing or disabled control: ' + selector)
  await sleep(80)
}
async function cardsReady() {
  await waitFor(`document.querySelector('[data-xhs-view]')?.dataset.ready === 'true'`)
  await evaluate('document.fonts.ready.then(() => true)')
  await sleep(100)
}
async function setMarkdown(text) {
  await evaluate(`(() => { const view = window.__mopaiCodemirror; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(text)} } }); return true })()`)
  await sleep(300)
  if (await evaluate(`!!document.querySelector('[data-xhs-view]')`)) await cardsReady()
}
async function download(selector, directory, extension) {
  await send('Page.bringToFront', {}, sessionId)
  await cardsReady()
  fs.mkdirSync(directory, { recursive: true })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true })
  await click(selector)
  const end = Date.now() + 120000
  while (Date.now() < end) {
    const files = fs.readdirSync(directory)
    const name = files.find((file) => file.endsWith(extension))
    if (name && !files.some((file) => file.endsWith('.crdownload'))) return path.join(directory, name)
    const error = await evaluate(`document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent`)
    if (error) throw new Error('export: ' + error)
    await sleep(250)
  }
  throw new Error('download timeout: ' + selector)
}
const dimensions = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })

function templateMatrix() {
  if (mode === 'uploaded') {
    return catalog
      .filter((item) => !onlyTemplates.length || onlyTemplates.includes(item.id))
      .map((item) => ({
        id: item.id,
        runtime: item.runtime,
        variants: item.variants,
        ratios: (onlyRatios.length ? onlyRatios : item.ratios),
      }))
  }
  return (onlyTemplates.length ? onlyTemplates : TEMPLATES).map((template) => ({
    id: template,
    runtime: template,
    variants: VARIANTS[template],
    ratios: (onlyRatios.length ? onlyRatios : Object.keys(RATIOS)),
  }))
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break } catch { /* booting */ }
    if (i === 99) throw new Error('local application did not start: ' + appLog.slice(-800))
    await sleep(150)
  }
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1600,1100', 'about:blank',
  ], { stdio: 'ignore' })
  let endpoint
  for (let i = 0; i < 100; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl; if (endpoint) break } catch { /* booting */ }
    await sleep(150)
  }
  if (!endpoint) throw new Error('Chrome CDP did not start')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timeout } = pending.get(message.id)
      clearTimeout(timeout); pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
    if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.sessionId === sessionId && message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description).join(' '))
    if (message.sessionId === sessionId && message.method === 'Runtime.consoleAPICalled') {
      const line = message.params.args.map((arg) => arg.value || arg.description).join(' ')
      if (line.includes('[paginate') || line.includes('[measure]')) consoleLogs.push(line)
    }
  })
  send = (method, params = {}, session) => new Promise((resolve, reject) => {
    const messageId = ++id
    const timeout = setTimeout(() => { pending.delete(messageId); reject(new Error('CDP timeout: ' + method)) }, 60000)
    pending.set(messageId, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id: messageId, method, params, ...(session ? { sessionId: session } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))
  for (const domain of ['Page', 'Runtime', 'DOM', 'CSS']) await send(domain + '.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {localStorage.setItem('mopai.onboarding.v1','done');localStorage.setItem('mopai.theme.v1','akari');localStorage.setItem('mopai.lang.v1','zh')}catch{}`,
  }, sessionId)
  await send('Page.navigate', { url: origin }, sessionId)
  await waitFor('!!window.__mopaiCodemirror')
  await waitFor(`window.__mopaiCodemirror.state.doc.length > 1000`)
  await setMarkdown(DRAFT)
  await click('[data-preview-mode="cards"]')
  await cardsReady()
  await evaluate('document.fonts.ready.then(() => true)')

  const batchMatrix = templateMatrix()

  if (mode === 'uploaded') {
    const wanted = new Set(batchMatrix.map((row) => row.id))
    const uploads = catalog.filter((item) => wanted.has(item.id))
    for (const item of uploads) {
      const zip = path.resolve(item.zip)
      if (!fs.existsSync(zip)) throw new Error('missing upload: ' + zip)
      const { root } = await send('DOM.getDocument', { depth: -1 }, sessionId)
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-card-template-file]' }, sessionId)
      if (!nodeId) throw new Error('template file input is missing')
      const before = await evaluate(`document.querySelectorAll('[data-card-template-item]').length`)
      await send('DOM.setFileInputFiles', { nodeId, files: [zip] }, sessionId)
      const end = Date.now() + 30000
      while (Date.now() < end) {
        const now = await evaluate(`document.querySelectorAll('[data-card-template-item]').length`)
        if (now > before) break
        const error = await evaluate(`document.querySelector('[data-card-template-error]')?.textContent`)
        if (error) throw new Error(item.id + ' upload: ' + error)
        await sleep(150)
      }
      if (await evaluate(`document.querySelectorAll('[data-card-template-item]').length`) <= before) {
        throw new Error(item.id + ' upload did not appear')
      }
      const runtime = await evaluate(`(() => {
        const name = ${JSON.stringify(item.name)}
        const button = [...document.querySelectorAll('[data-card-template-custom]')]
          .find((el) => (el.textContent || '').includes(name))
        return button?.dataset.cardTemplate || null
      })()`)
      if (!runtime) throw new Error(item.id + ' did not appear in the template picker')
      item.runtime = runtime
      console.log('[upload] ' + item.id + ' -> ' + runtime)
    }
    // The upload auto-selects each template once, warming fonts and pagination.
    // Reload so the capture measures a cold selection like the built-in
    // baseline, and so the IndexedDB round trip is exercised too.
    await send('Page.reload', {}, sessionId)
    await waitFor('!!window.__mopaiCodemirror')
    await setMarkdown(DRAFT)
    await click('[data-preview-mode="cards"]')
    await cardsReady()
    await waitFor(`document.querySelectorAll('[data-card-template-item]').length === ${uploads.length}`)
    for (const item of uploads) {
      const runtime = await evaluate(`(() => {
        const name = ${JSON.stringify(item.name)}
        const button = [...document.querySelectorAll('[data-card-template-custom]')]
          .find((el) => (el.textContent || '').includes(name))
        return button?.dataset.cardTemplate || null
      })()`)
      if (!runtime) throw new Error(item.id + ' did not survive the reload')
      item.runtime = runtime
    }
  }


  const entries = []
  // Recomputed after upload: a row's runtime id only exists once the package
  // has been activated in this browser.
  const matrix = templateMatrix()
  for (const row of matrix) {
    for (const variant of row.variants) {
      for (const ratio of row.ratios) {
        const variantId = variant.id ?? variant
        const label = `${row.id}/${variantId}/${ratio.replace(':', 'x')}`
        console.log('[capture] ' + label)
        await click(`[data-card-template="${row.runtime}"]`)
        await cardsReady()
        await click(`[data-card-ratio="${ratio}"]`)
        await cardsReady()
        await click(`[data-card-bg="${variant.id ?? variant}"]`)
        await cardsReady()
        // Toggling one variant and back forces the second real layout. Uploaded
        // templates settle their scoped stylesheet on that first pass; the
        // built-in baseline is already stable, so this only warms uploaded ones.
        if (mode === 'uploaded') {
          await click(`[data-card-template="${row.runtime}"]`)
          await cardsReady()
          await click(`[data-card-ratio="${ratio}"]`)
          await cardsReady()
          await click(`[data-card-bg="${variant.id ?? variant}"]`)
          await cardsReady()
          const other = row.variants.find((entry) => (entry.id ?? entry) !== variantId)
          if (other) {
            await click(`[data-card-bg="${other.id ?? other}"]`)
            await cardsReady()
            await click(`[data-card-bg="${variant.id ?? variant}"]`)
            await cardsReady()
          }
        }
        const state = await evaluate(`(() => {
          const cards=[...document.querySelectorAll('.xhs-card')];
          return { count: cards.length, kinds: cards.map(c=>c.dataset.cardKind),
            height: cards[0] ? parseFloat(cards[0].style.height) : null,
            titleSize: cards[0]?.querySelector('[data-cover-title-size]')?.dataset.coverTitleSize || null,
            prefix: cards[0]?.dataset.template || null }
        })()`)
        if (state.count < 3) throw new Error(label + ': expected at least cover, body and end pages, got ' + state.count)
        if (state.kinds[0] !== 'cover') throw new Error(label + ': page 0 is not a cover')
        if (state.kinds[state.count - 1] !== 'body') throw new Error(label + ': last page is not body/end')
        const roles = [
          ['cover', 0],
          ['body', 1],
          ['end', state.count - 1],
        ]
        for (const [role, index] of roles) {
          const dir = path.join(out, row.id, variantId, ratio.replace(':', 'x'), role + '-download')
          const file = await download(`[data-card-export="${index}"]`, dir, '.png')
          const targetDir = path.join(out, row.id, variantId, ratio.replace(':', 'x'))
          const target = path.join(targetDir, `${role}.png`)
          fs.copyFileSync(file, target)
          for (let attempt = 0; attempt < 5; attempt++) {
            try { fs.rmSync(dir, { recursive: true, force: true }); break } catch { await sleep(200) }
          }
          const size = dimensions(fs.readFileSync(target))
          entries.push({
            template: row.id, runtime: row.runtime, variant: variantId, ratio, role, pageIndex: index, pageCount: state.count,
            width: size.width, height: size.height, file: path.relative(out, target).replace(/\\/g, '/'),
            sha256: sha256(target), titleSize: role === 'cover' ? state.titleSize : null,
            renderTemplate: state.prefix,
          })
        }
      }
    }
  }
  const manifestPath = path.join(out, 'manifest.json')
  let capturedTemplates = matrix
  let allEntries = entries
  if (append && fs.existsSync(manifestPath)) {
    const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (previous.mode !== mode || previous.draftTitle !== DRAFT_TITLE) {
      throw new Error('cannot append: existing manifest uses a different mode or draft')
    }
    const replaced = new Map(matrix.map((row) => [row.id, row]))
    capturedTemplates = previous.templates.map((row) => replaced.get(row.id) ?? row)
    for (const row of matrix) if (!previous.templates.some((item) => item.id === row.id)) capturedTemplates.push(row)
    const incoming = new Set(entries.map((entry) => `${entry.template}/${entry.variant}/${entry.ratio}/${entry.role}`))
    allEntries = [
      ...previous.entries.filter((entry) => !incoming.has(`${entry.template}/${entry.variant}/${entry.ratio}/${entry.role}`)),
      ...entries,
    ]
  }
  const manifest = {
    format: 'reed-card-baseline-v1',
    mode,
    createdAt: new Date().toISOString(),
    draft: 'draft.md',
    draftTitle: DRAFT_TITLE,
    templates: capturedTemplates,
    entries: allEntries,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ exceptions, consoleErrors }, null, 2))
  console.log(`[capture] ${entries.length} PNGs -> ${out}`)
  if (exceptions.length) throw new Error('page exceptions: ' + exceptions.length)
} catch (error) {
  console.error('[capture] FAILED', error.stack || error)
  fs.writeFileSync(path.join(out, 'failure.log'), String(error.stack || error) + '\n\n' + appLog.slice(-4000))
  process.exitCode = 1
} finally {
  ws?.close()
  chrome?.kill()
  app.kill()
  await new Promise((resolve) => worker.close(resolve))
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* profile may still be locked */ }
}
