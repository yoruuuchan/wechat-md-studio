// Build the static contact sheet for the public card-template preview.
//   node scripts/cards/build-public-preview-index.mjs --catalog <catalog.json> --shots <dir> --out <index.html>
//
// Inputs are produced by pack-template.mjs and capture-card-matrix.mjs
// --profile preview. The page is deliberately self-contained: relative image
// paths, no scripts, no network fonts.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : fallback
}
const catalogPath = path.resolve(arg('catalog', 'catalog.json'))
const shotsDir = path.resolve(arg('shots', 'shots'))
const outPath = path.resolve(arg('out', 'index.html'))
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

const SOURCES = {
  'swiss-grid': { file: 'swiss-studio.json', repo: 'geekfoxcharlie/XHS-TextCard', license: 'MIT' },
  'editorial-white': { file: 'minimalist-magazine.json', repo: 'geekfoxcharlie/XHS-TextCard', license: 'MIT' },
  'book-notes': { file: 'elegant-book.json', repo: 'geekfoxcharlie/XHS-TextCard', license: 'MIT' },
  aurora: { file: 'aura-gradient.json', repo: 'geekfoxcharlie/XHS-TextCard', license: 'MIT' },
  'deep-night': { file: 'deep-night.json', repo: 'geekfoxcharlie/XHS-TextCard', license: 'MIT' },
  'doc-frame': { file: 'pro-doc.json', repo: 'geekfoxcharlie/XHS-TextCard', license: 'MIT' },
  'tech-pulse': { file: 'src/lib/themes/tech-pulse.ts', repo: 'uhhc/md2card', license: 'MIT' },
  'fresh-notes': { file: 'src/lib/themes/fresh-notes.ts', repo: 'uhhc/md2card', license: 'MIT' },
  'pine-notebook': { file: 'src/styles/cards/themes/notebook.css', repo: 'haodongcui/md2card', license: 'MIT' },
}

const ROLES = [
  ['3x4', 'cover', '封面 · 3:4'],
  ['3x4', 'body', '正文 · 3:4'],
  ['3x4', 'end', '结尾 · 3:4'],
  ['1x1', 'cover', '封面 · 1:1'],
  ['9x16', 'cover', '封面 · 9:16'],
]

const html = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))

function manifestDirFor(item) {
  return path.resolve('card-templates/public', item.id, 'manifest.json')
}

const manifestDirs = catalog.map(manifestDirFor)

const rows = catalog.map((item, index) => {
  const manifest = manifestDirs[index] ? JSON.parse(fs.readFileSync(manifestDirs[index], 'utf8')) : { variants: [] }
  const source = SOURCES[item.id] ?? { file: '上游文件', repo: '未知', license: 'MIT' }
  const variants = (manifest.variants ?? []).map((variant) => {
    const pictures = ROLES.map(([ratio, role, label]) => {
      const relative = path.join(item.id, variant.id, ratio, `${role}.png`).replace(/\\/g, '/')
      if (!fs.existsSync(path.join(shotsDir, relative))) return ''
      return `<figure class="shot"><a href="${html(relative)}" target="_blank" rel="noopener"><img src="${html(relative)}" alt="${html(item.name + ' ' + variant.name + ' ' + label)}" loading="lazy" /></a><figcaption>${html(label)}</figcaption></figure>`
    }).join('')
    return `<section class="variant"><div class="variant-head"><h3>${html(variant.name)} <span>${variant.dark ? '深色' : '浅色'}</span></h3></div><div class="shots">${pictures}</div></section>`
  }).join('')
  return `<article class="row" id="${html(item.id)}">
    <header>
      <p class="ordinal">${String(index + 1).padStart(2, '0')}</p>
      <h2>${html(item.name)}</h2>
      <p class="source">参考源：<strong>${html(source.repo)}</strong> · ${html(source.file)}<br />许可：${html(source.license)}，保留上游版权与许可；仅借用配色、字体思路、间距与版式，成品重新实现。</p>
    </header>
    <div class="variants">${variants}</div>
  </article>`
}).join('\n')

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reed 公用卡片模板 · 效果图</title>
<style>
  :root { color-scheme: light; --paper: #f4f1ea; --ink: #1d1d1b; --muted: #64615b; --line: #d8d2c6; --accent: #b33c24; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.65 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 1480px; margin: 0 auto; padding: 54px 30px 80px; }
  .intro { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; padding-bottom: 30px; border-bottom: 2px solid var(--ink); }
  h1 { margin: 0; font: 700 44px/1.08 "Noto Serif SC", "Songti SC", serif; letter-spacing: -0.03em; }
  .lede { max-width: 720px; margin: 14px 0 0; color: var(--muted); font-size: 14px; }
  .count { color: var(--accent); font: 700 56px/1 "Geist Mono", monospace; letter-spacing: -0.05em; }
  .count small { display: block; color: var(--muted); font: 400 12px/1.4 "Noto Sans SC", sans-serif; letter-spacing: 0; text-align: right; }
  .row { display: grid; grid-template-columns: 310px minmax(0, 1fr); gap: 36px; padding: 34px 0 38px; border-bottom: 1px solid var(--line); }
  .row header { position: sticky; top: 20px; align-self: start; }
  .ordinal { margin: 0; color: var(--accent); font: 400 12px/1 "Geist Mono", monospace; letter-spacing: 0.16em; }
  h2 { margin: 10px 0 12px; font: 700 28px/1.18 "Noto Serif SC", "Songti SC", serif; letter-spacing: -0.02em; }
  .source { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; }
  .source strong { color: var(--ink); font-weight: 500; }
  .variants { display: flex; flex-direction: column; gap: 26px; }
  .variant { min-width: 0; }
  .variant-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; padding-bottom: 7px; border-bottom: 1px solid var(--line); }
  h3 { margin: 0; font-size: 14px; font-weight: 700; }
  h3 span { margin-left: 6px; color: var(--muted); font-size: 10px; font-weight: 400; }
  .shots { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; }
  .shot { margin: 0; }
  .shot a { display: block; line-height: 0; }
  .shot img { display: block; width: auto; height: 178px; max-width: 240px; object-fit: contain; border: 1px solid var(--line); background: #fff; box-shadow: 0 4px 12px rgba(50, 42, 30, 0.07); transition: transform .16s ease, box-shadow .16s ease; }
  .shot img:hover { transform: translateY(-3px); box-shadow: 0 10px 22px rgba(50, 42, 30, 0.14); }
  .shot figcaption { margin-top: 7px; color: var(--muted); font-size: 10px; line-height: 1.3; }
  footer { padding-top: 26px; color: var(--muted); font-size: 11px; }
  @media (max-width: 900px) { .row { grid-template-columns: 1fr; gap: 18px; } .row header { position: static; } .intro { grid-template-columns: 1fr; } .count { text-align: left; } }
</style>
</head>
<body>
<div class="wrap">
  <section class="intro">
    <div>
      <h1>公用卡片模板 · 九套效果图</h1>
      <p class="lede">同一份固定测试稿、三种比例的真实 PNG 导出。每套覆盖封面 / 正文 / 结尾，点图片看原图。这些成品只借用上游的配色、字体搭配、间距与版式思路，封面照片、贴纸和图标都没有带过来。</p>
    </div>
    <div class="count">${catalog.length}<small>套 · 每套 1–2 个变体</small></div>
  </section>
  ${rows}
  <footer>生成自 card-templates/public/ 源文件与上传链路实际导出的 PNG；图片路径相对本页，不需要联网。</footer>
</div>
</body>
</html>
`

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, page)
console.log(`[preview-index] ${catalog.length} templates -> ${outPath}`)