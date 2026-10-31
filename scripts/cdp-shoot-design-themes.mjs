// 小样截图：用 renderDoc 把一篇连续段落短文、主题预览稿与一篇约 3000 字的
// 中文长文，按 yoru-type / paper-editorial / console-akari 三套主题渲染，放进
// 375px 宽、2 倍像素密度的手机视口整页截图，再生成并排索引。
//
// Run after npm run build (or directly; this bundles src with esbuild):
//   node scripts/cdp-shoot-design-themes.mjs
//
// Chrome 用独立临时 profile，CDP 固定 9373；不要和别的验收脚本共用端口。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { build } from 'esbuild'

const CDP_PORT = 9373
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.resolve('verify-out/design-themes')
const VIEWPORT_W = 375
const VIEWPORT_H = 812
// 2 倍像素密度：截图宽 750px，在手机和高分屏上看细节（着重号、发丝线）不发糊。
const SCALE = 2
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

fs.mkdirSync(OUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-design-themes-'))

// ---------------------------------------------------------------- 打包 src
const bundled = await build({
  stdin: {
    contents:
      "export { DESIGN_THEMES } from './src/lib/themes-design'\n" +
      "export { renderDoc } from './src/lib/render'\n" +
      "export { parseMarkdown } from './src/lib/parse'\n" +
      "export { THEME_PREVIEW_DOC } from './src/lib/sample'\n",
    resolveDir: process.cwd(),
    sourcefile: 'design-theme-shot.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'warning',
})
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
)
const { DESIGN_THEMES, renderDoc, parseMarkdown, THEME_PREVIEW_DOC } = mod

// ---------------------------------------------------------------- 长文
// 与 scripts/cdp-verify-xhs-cards.mjs 的 longDoc 同构：同一组段落、章节、
// 35 条步骤、24 行表格、42 行代码与两张图，保证字数与结构一致。
const prose = [
  '清晨的城市还没有完全醒来，街边的早餐店已经亮起了灯。我们沿着河岸慢慢走，把看到的细节写进笔记。',
  '写作并不总要从一个宏大的观点开始，先说清眼前发生了什么，再去追问它为什么值得记住。',
  '同一段文字出现在长文章和图文卡片里，阅读节奏会变，内容的意思却应当完整保留。',
  '好的留白让读者有时间停顿，清楚的层级让他们在滑动时知道自己读到了哪里。',
  '记录真实的颜色、声音和人物，比堆砌抽象形容词更能留下画面。每次修改，都试着把一句话说得更具体。',
].join('')
let longDoc =
  '# 把日常写成值得收藏的卡片\n\n用一篇长文，检验文字、图片与留白。\n\n## 阅读从这里开始\n\n**芦苇卡片** *Reed* `2026` ==，。！？==\n\n![河岸色彩示意](img:xhs-wide.png)\n\n'
for (let i = 0; i < 8; i++) {
  longDoc += `## 第${i + 1}节：观察与记录\n\n${prose}\n\n> 用自己的眼睛看，用自己的语言写。慢一点，也能抵达。\n\n`
}
longDoc +=
  '## 可以照着做的步骤\n\n' +
  Array.from({ length: 35 }, (_, i) => `${7 + i}. 记录第${i + 1}个细节，保留观察、时间与当时的感受。`).join('\n')
longDoc +=
  '\n\n- 把观点写清楚，再用例子支持。\n- 图片应当帮助理解，而不是占住版面。\n- 发布前通读一次，删掉重复的话。\n\n## 数据与例子\n\n| 项目 | 观察 | 次数 |\n|:--|:--|--:|\n'
longDoc += Array.from(
  { length: 24 },
  (_, i) => `| 第${i + 1}次记录 | 沿河散步与街边小店 | ${i + 1} |`,
).join('\n')
longDoc +=
  '\n\n```js\n' +
  Array.from({ length: 42 }, (_, i) => `  const note${i} = "记录 ${i} / Reed";`).join('\n') +
  '\n```\n\n![竖向色彩示意](img:xhs-tall.png)\n\n---\n\n## 留给下一次出发\n\n每一次记录都是重新认识日常的机会。\n'
while ((longDoc.match(/[\u3400-\u9fff]/g)?.length ?? 0) < 3000) longDoc += '\n' + prose + '\n'

// 长文里的两张图用 data URL 填上，截图时能看到真实图片而不是裂图。
function png(w, h) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0)
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const palette = [
    [52, 118, 174],
    [225, 205, 172],
    [108, 154, 127],
    [233, 237, 241],
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = y * (w * 3 + 1) + 1 + x * 3
      const color = palette[(Math.floor(x / (w / 3)) + Math.floor(y / (h / 3))) % palette.length]
      for (let c = 0; c < 3; c++) raw[at + c] = color[c]
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const wideData = 'data:image/png;base64,' + png(720, 480).toString('base64')
const tallData = 'data:image/png;base64,' + png(180, 600).toString('base64')
const resolveImg = (src) =>
  src === 'img:xhs-wide.png' ? wideData : src === 'img:xhs-tall.png' ? tallData : src

// 两份验收稿都没有相邻的正文段，纸本「首段之后首行缩进、段间不空行」看不出来；
// 这篇短文按真实推送的节奏连排正文，再夹引用、加粗、高亮和列表。
const essay = [
  '## 一、先把眼前的事写清楚',
  '周六早上，楼下的面馆照例七点开门。老板先把炉子点上，再把昨晚泡好的黄豆倒进锅里，蒸汽一下子就漫到了门口。',
  '很多时候，我们急着给一件事下结论，却忘了先把它看清楚。**写下第一句之前，先描述你看到了什么**，比急着表达观点更难，也更重要。',
  '所以这一节只做一件事：把场景、人物和动作按发生的顺序写下来，不加形容词，也不评价。',
  '> 观察是写作的地基。地基打得够深，房子才盖得高。',
  '写完再回头看，你会发现很多原本想用的形容词，已经被具体的细节替代了。==细节自己会说话==，读者也更愿意相信你。',
  '## 二、再回答它为什么值得记住',
  '有了清楚的场景，才轮到观点出场。观点不必宏大，只要和前面的细节连得上。',
  '面馆老板每天提前一小时起床泡豆子，不是因为有人监督，而是因为他知道，少泡一会儿，豆浆的味道就差一点。',
  '- 先写事实，再写感受\n- 一段只讲一件事\n- 写完通读一遍，删掉重复的话',
].join('\n\n')

const docs = [
  { key: 'essay', label: '连续段落短文', markdown: essay },
  { key: 'theme-preview', label: '主题预览稿', markdown: THEME_PREVIEW_DOC },
  { key: 'long-article', label: '约 3000 字中文长文', markdown: longDoc },
]
const sig = { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' }
const cjk = (longDoc.match(/[\u3400-\u9fff]/g) ?? []).length
console.log(`bundled ${DESIGN_THEMES.length} design themes; long article CJK=${cjk}`)

// ---------------------------------------------------------------- Chrome
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    '--hide-scrollbars',
    `--window-size=${VIEWPORT_W},${VIEWPORT_H}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

let wsUrl = ''
for (let i = 0; i < 100; i++) {
  try {
    const info = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
    if (info.webSocketDebuggerUrl) {
      wsUrl = info.webSocketDebuggerUrl
      break
    }
  } catch {
    /* Chrome 还在启动 */
  }
  await sleep(200)
}
if (!wsUrl) {
  chrome.kill()
  throw new Error('Chrome CDP did not start on 9373')
}

const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const request = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
  })
const evaluate = async (expression, sessionId) => {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
}

const shots = []
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: VIEWPORT_W,
      height: VIEWPORT_H,
      deviceScaleFactor: SCALE,
      mobile: true,
    },
    sessionId,
  )

  for (const theme of DESIGN_THEMES) {
    for (const doc of docs) {
      const parsed = parseMarkdown(doc.markdown)
      const { html } = renderDoc(parsed, theme, sig, resolveImg)
      const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:0;background:#e9edf3}body{width:${VIEWPORT_W}px}.phone{width:${VIEWPORT_W}px;margin:0 auto;background:#fff;overflow:hidden}img{max-width:100%;height:auto}</style></head><body><div class="phone">${html}</div></body></html>`
      const tmp = path.join(OUT, `.${theme.id}-${doc.key}.html`)
      fs.writeFileSync(tmp, page, 'utf8')
      const url = `file:///${tmp.replace(/\\/g, '/')}`
      await send('Page.navigate', { url }, sessionId)
      await sleep(250)
      await evaluate('document.fonts.ready.then(() => true)', sessionId)
      await sleep(120)
      const height = await evaluate(
        'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)',
        sessionId,
      )
      const shot = await send(
        'Page.captureScreenshot',
        {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: VIEWPORT_W, height: Math.ceil(height), scale: 1 },
        },
        sessionId,
      )
      const file = path.join(OUT, `${theme.id}-${doc.key}.png`)
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
      fs.rmSync(tmp, { force: true })
      shots.push({ themeId: theme.id, themeName: theme.name, doc: doc.key, label: doc.label, file, height })
      console.log(`wrote ${path.relative(process.cwd(), file)} (${VIEWPORT_W * SCALE}x${Math.ceil(height) * SCALE})`)
    }
  }
} finally {
  try {
    ws.close()
  } catch {
    /* already closed */
  }
  chrome.kill()
}

// ---------------------------------------------------------------- 索引
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sections = docs
  .map((doc) => {
    const figures = DESIGN_THEMES.map((theme) => {
      const name = `${theme.id}-${doc.key}.png`
      return `<figure><figcaption><b>${esc(theme.name)}</b> <code>${esc(theme.id)}</code></figcaption><a href="${name}"><img src="${name}" alt="${esc(theme.name)} · ${esc(doc.label)}"></a></figure>`
    }).join('')
    return `<section><h2>${esc(doc.label)}</h2><div class="row">${figures}</div></section>`
  })
  .join('\n')
const index = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>设计系统主题小样</title><style>body{margin:0;padding:32px;background:#eef1f5;color:#1c2433;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 28px;color:#5a6577;font-size:13px}section{margin:0 0 36px}h2{font-size:16px;margin:0 0 12px}.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}figure{margin:0;background:#fff;padding:10px;border:1px solid #dbe1ea;border-radius:6px}figcaption{font-size:12px;line-height:1.6;margin:0 0 8px;color:#5a6577}figcaption b{color:#1c2433}code{font-family:Menlo,Consolas,monospace;font-size:11px;color:#6b7793}img{display:block;width:100%;height:auto;border:1px solid #e5e9f0}</style></head><body><h1>设计系统主题小样 · 375px</h1><p>yoru-type / paper-editorial / console-akari × 连续段落短文 / 主题预览稿 / 约 3000 字中文长文；2 倍像素密度截图由 <code>scripts/cdp-shoot-design-themes.mjs</code> 生成。</p>${sections}</body></html>`
fs.writeFileSync(path.join(OUT, 'index.html'), index, 'utf8')
console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, 'index.html'))} (${shots.length} screenshots)`)