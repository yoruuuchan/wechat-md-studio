// 主题库 importer：把外部开源主题转成本项目的内部规格，生成 src/lib/themes-imported/*.ts。
//
// 跑法（在 app/ 下）：npm run import:themes
// 上游仓库要先浅克隆到 THEME_SOURCES 指向的目录（默认 <local tmp>/theme-sources），
// 目录名见下面每个来源的 dir 字段。产物提交进仓库，运行时不依赖上游。
//
// 每个来源只做三件事：抽出「主题 → 元素样式字典」、给出授权档案、必要时给色板提示。
// 归一化、色板反推、分类推导、微信红线消毒全部在 lib/ 里共用，换来源不用重写。

import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import yaml from 'js-yaml'
import type { ImportedThemeSpec } from '../../src/lib/theme-kit'
import type { ThemeLicense, ThemeOrigin } from '../../src/lib/theme-meta'
import { STYLE_TAGS, COMPLEXITY_LEVELS, COLOR_FAMILIES } from '../../src/lib/theme-meta'
import { derivePalette, mapStyles, type PaletteHints } from './lib/map'
import { categoryOf, complexityOf, keywordHits, measureStyles, styleTagsFrom } from './lib/classify'
import { collectColors, colorFamilyOf, saturatedHues } from './lib/color'
import { parseCssHeader, parseCssTheme } from './lib/css'
import { writeIndex, writePack, type GeneratedPack } from './lib/emit'

const SOURCES_ROOT = process.env.THEME_SOURCES || '<local tmp>/theme-sources'

interface RawTheme {
  id: string
  name: string
  desc: string
  /** 用于推导风格标签的全部文本证据（名称 + 描述 + 上游自带的 tag/分类） */
  keywords: string
  styles: Record<string, string>
  hints?: PaletteHints
  /** 覆盖来源级授权档案：二次移植的主题要单独标 license 与 upstream */
  origin?: Partial<ThemeOrigin>
}

interface SourceInfo {
  id: string
  dir: string
  project: string
  author: string
  repo: string
  license: ThemeLicense
  licenseFile: string
  attribution: string
  adapted: string
  extract(dir: string): Promise<RawTheme[]>
}

/** 用 esbuild 把上游模块打成 data: URL 再 import，避免正则硬解析 JS/TS 源码。 */
async function loadModule(code: string, resolveDir: string, loader: 'ts' | 'js' = 'ts'): Promise<Record<string, any>> {
  const res = await esbuild.build({
    stdin: { contents: code, resolveDir, loader, sourcefile: `entry.${loader}` },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const url = 'data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64')
  return await import(url)
}

/** xiaohu 系主题的样式是 snake_case 的扁平字典，转成 CSS 声明串。 */
function dictToCss(dict: Record<string, string | number>): string {
  return Object.entries(dict)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, '-')}:${v}`)
    .join(';')
}

function clip(text: string, max = 72): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

// ============================================================
// 来源 1：xiaohuailabs/xiaohu-wechat-format —— 85 套纯 JSON
// ============================================================

const XIAOHU_ADAPTED =
  '把上游 themes/*.json 的 snake_case 样式字典转成本项目的语义节点规格；补 <span leaf=""> 包裹、' +
  '按公众号红线过滤 position:absolute / float / grid / var()，缺失的金句卡、居中强调、轮播、署名由主题自身配色推导。'

const xiaohu: SourceInfo = {
  id: 'xiaohu',
  dir: 'xiaohuailabs--xiaohu-wechat-format',
  project: 'xiaohu-wechat-format',
  author: 'xiaohuailabs',
  repo: 'https://github.com/xiaohuailabs/xiaohu-wechat-format',
  license: 'MIT',
  licenseFile: 'LICENSES/xiaohu-wechat-format/LICENSE-NOTE.md',
  attribution:
    'Themes from xiaohuailabs/xiaohu-wechat-format. The upstream README declares "## License — MIT"; ' +
    'the repository ships no LICENSE file. Copyright belongs to the xiaohu-wechat-format authors.',
  adapted: XIAOHU_ADAPTED,
  async extract(dir) {
    const themeDir = path.join(dir, 'themes')
    const out: RawTheme[] = []
    for (const file of fs.readdirSync(themeDir).filter((f) => f.endsWith('.json')).sort()) {
      const json = JSON.parse(fs.readFileSync(path.join(themeDir, file), 'utf8'))
      const styles: Record<string, string> = {}
      for (const [key, value] of Object.entries<Record<string, string | number>>(json.styles ?? {})) {
        if (value && typeof value === 'object') styles[key] = dictToCss(value)
        else if (typeof value === 'string') styles[key] = value
      }
      const c = json.colors ?? {}
      const id = file.replace(/\.json$/, '')
      out.push({
        id,
        name: String(json.name ?? id),
        desc: clip(String(json.description ?? json.name ?? id)),
        keywords: `${json.name ?? ''} ${json.description ?? ''} ${id}`,
        styles,
        hints: {
          background: c.background,
          accent: c.accent || c.primary,
          heading: c.primary,
          quoteBg: c.blockquote_bg,
          codeBg: c.code_bg,
          border: c.hr_color,
        },
        origin: { upstream: `themes/${file}` },
      })
    }
    return out
  },
}

// ============================================================
// 来源 2：liuxiaopai-ai/raphael-publish —— 30 套 TS 主题
// ============================================================

const raphael: SourceInfo = {
  id: 'raphael',
  dir: 'liuxiaopai-ai-raphael-publish',
  project: 'raphael-publish',
  author: 'Raphael Editor Contributors',
  repo: 'https://github.com/liuxiaopai-ai/raphael-publish',
  license: 'MIT',
  licenseFile: 'LICENSES/raphael-publish/LICENSE',
  attribution: 'Copyright (c) 2024 Raphael Editor Contributors. Licensed under the MIT License.',
  adapted:
    '直接读取上游 src/lib/themes/*.ts 的 tag→内联 CSS 字典；补 <span leaf=""> 包裹，' +
    '按公众号红线过滤禁用声明，本项目自研的金句卡 / 居中强调 / 轮播 / 署名由主题配色推导。',
  async extract(dir) {
    const mod = await loadModule(`export * from './src/lib/themes/index'`, dir)
    return (mod.THEMES as any[]).map((t) => ({
      id: t.id,
      name: t.name,
      desc: clip(t.description ?? t.name),
      keywords: `${t.name} ${t.description ?? ''} ${t.id}`,
      styles: t.styles as Record<string, string>,
      origin: { upstream: `src/lib/themes/*.ts → id "${t.id}"` },
    }))
  },
}

// ============================================================
// 来源 3：alchaincyf/huasheng_editor —— 20 套，是 rico-md 那一批的上游
// ============================================================

const huasheng: SourceInfo = {
  id: 'huasheng',
  dir: 'alchaincyf-huasheng_editor',
  project: 'huasheng_editor',
  author: '花生 (alchaincyf)',
  repo: 'https://github.com/alchaincyf/huasheng_editor',
  license: 'MIT',
  licenseFile: 'LICENSES/huasheng-editor/LICENSE',
  attribution: 'Copyright (c) 2024 花生 (alchaincyf). Licensed under the MIT License.',
  adapted:
    '从上游 styles.js 的 STYLES 表取 tag→内联 CSS 字典（该文件是浏览器全局脚本，导入时补 export）；' +
    '补 <span leaf=""> 包裹，按公众号红线过滤 backdrop-filter 等禁用声明。',
  async extract(dir) {
    const file = path.join(dir, 'styles.js')
    const mod = await loadModule(`${fs.readFileSync(file, 'utf8')}\nexport default STYLES\n`, dir, 'js')
    const STYLES = mod.default as Record<string, { name: string; description?: string; styles: Record<string, string> }>
    return Object.entries(STYLES).map(([id, t]) => ({
      id,
      name: t.name ?? id,
      // 上游只给主题名，没有描述字段；用名称充当描述，UI 侧对二者相同的情况只显示一次
      desc: clip(t.description ?? t.name ?? id),
      keywords: `${t.name ?? ''} ${t.description ?? ''} ${id}`,
      styles: t.styles,
      origin: { upstream: `styles.js → STYLES["${id}"]` },
    }))
  },
}

// ============================================================
// 来源 4：laogou717/md-wechat —— 28 套，其中 2 套上游自述移植自 mdnice（GPL-3.0）
// ============================================================

/** 上游 description 原文写明"移植自 mdnice 经典"，而 mdnice 是 GPL-3.0-only。 */
const MDNICE_DERIVED = new Set(['tech-blue', 'fullstack-blue'])

const mdwechat: SourceInfo = {
  id: 'md-wechat',
  dir: 'laogou717-md-wechat',
  project: 'md-wechat',
  author: '字间排版',
  repo: 'https://github.com/laogou717/md-wechat',
  license: 'MIT',
  licenseFile: 'LICENSES/md-wechat/LICENSE',
  attribution: 'Copyright (c) 2026 字间排版. Licensed under the MIT License.',
  adapted:
    '调用上游自己的 buildStyles(theme) 取到 baseStyles 与主题覆盖合并后的完整样式字典；' +
    '补 <span leaf=""> 包裹，按公众号红线过滤禁用声明，上游的 hrHtml / h2WrapOpen 等 HTML 片段不进样式槽。',
  async extract(dir) {
    const mod = await loadModule(`export * from './src/lib/themes.js'`, dir, 'js')
    const themes = mod.themes as any[]
    const categories = (mod.themeCategories ?? {}) as Record<string, string>
    return themes.map((t) => {
      const derived = MDNICE_DERIVED.has(t.id)
      return {
        id: t.id,
        name: t.name,
        desc: clip(t.description ?? t.name),
        keywords: `${t.name} ${t.tag ?? ''} ${t.description ?? ''} ${categories[t.id] ?? ''} ${t.id}`,
        styles: mod.buildStyles(t, {}) as Record<string, string>,
        hints: { accent: t.primary, background: t.surface },
        origin: {
          upstream: derived
            ? 'mdnice/markdown-nice — 上游 description 自述「移植自 mdnice 经典」，mdnice 为 GPL-3.0-only'
            : `src/lib/themes.js → id "${t.id}"`,
          ...(derived
            ? {
                license: 'GPL-3.0-only' as ThemeLicense,
                attribution:
                  'Derived from a mdnice/markdown-nice theme (GPL-3.0-only) per the upstream description; ' +
                  'redistributed under GPL-3.0. Original md-wechat packaging Copyright (c) 2026 字间排版 (MIT).',
              }
            : {}),
        },
      }
    })
  },
}

// ============================================================
// 来源 5：caol64/wenyan-core —— Apache-2.0 的 CSS 主题，7 套可追溯到 MIT 的 Typora 上游
// ============================================================

/** 只取注册表里标为公众号用途的 8 套；掘金/Medium/头条/知乎四套是对其它平台视觉的仿制，授权属推断，不收。 */
const WENYAN_GZH = ['default', 'orangeheart', 'rainbow', 'lapis', 'pie', 'maize', 'purple', 'phycat']

const wenyan: SourceInfo = {
  id: 'wenyan',
  dir: 'caol64--wenyan-core',
  project: 'wenyan-core',
  author: 'Lei (caol64)',
  repo: 'https://github.com/caol64/wenyan-core',
  license: 'Apache-2.0',
  licenseFile: 'LICENSES/wenyan-core/LICENSE',
  attribution: 'Copyright caol64/wenyan-core contributors. Licensed under the Apache License, Version 2.0.',
  adapted:
    '解析上游 src/assets/themes/*.css：展开 :root 变量与 calc()，丢弃伪元素与 position:absolute 规则，' +
    '把 #wenyan 根选择器摊成本项目的语义节点；标题装饰从 h2 span 移到内层 span 以适配微信。',
  async extract(dir) {
    const themeDir = path.join(dir, 'src/assets/themes')
    const registry = fs.readFileSync(path.join(dir, 'src/core/theme/themeRegistry.ts'), 'utf8')
    const descOf = (id: string): string => {
      const m = registry.match(new RegExp(`id:\\s*"${id}"[\\s\\S]{0,400}?description:\\s*"([^"]+)"`))
      return m?.[1] ?? ''
    }
    const out: RawTheme[] = []
    for (const id of WENYAN_GZH) {
      const file = `${id}.css`
      const css = fs.readFileSync(path.join(themeDir, file), 'utf8')
      const header = parseCssHeader(css)
      const { styles } = parseCssTheme(css, '#wenyan')
      const upstreamRepo = header?.repo ?? ''
      const upstreamSlug = upstreamRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '')
      out.push({
        id,
        name: header?.title || (id === 'default' ? 'Wenyan 默认' : id),
        desc: clip(descOf(id) || header?.title || id),
        keywords: `${header?.title ?? ''} ${descOf(id)} ${id} typora`,
        styles,
        origin: upstreamSlug
          ? {
              kind: 'ported',
              author: header?.author || upstreamSlug.split('/')[0],
              repo: upstreamRepo,
              license: 'MIT' as ThemeLicense,
              licenseFile: `LICENSES/typora-upstream/${upstreamSlug.replace(/\//g, '-')}-LICENSE`,
              attribution: `Typora theme "${header?.title}" by ${header?.author} (${upstreamRepo}), MIT; ` +
                'adapted for WeChat by caol64/wenyan-core (Apache-2.0) and ported into this project.',
              upstream: `Typora theme ${upstreamSlug}, via caol64/wenyan-core src/assets/themes/${file}`,
            }
          : { upstream: `src/assets/themes/${file}` },
      })
    }
    return out
  },
}

// ============================================================
// 来源 6：rotbit/xedit —— MIT，13 套 #nice 选择器 CSS，自带中文场景 tag
// ============================================================

const xedit: SourceInfo = {
  id: 'xedit',
  dir: 'rotbit-xedit',
  project: 'xedit',
  author: 'rotbit',
  repo: 'https://github.com/rotbit/xedit',
  license: 'MIT',
  licenseFile: 'LICENSES/xedit/LICENSE',
  attribution: 'Copyright (c) 2026 rotbit. Licensed under the MIT License.',
  adapted:
    '读取上游 src/lib/themes/presets.ts 的 ThemePreset 表，把每套 #nice 选择器 CSS 解析成语义节点规格；' +
    'mdnice 式 h2 .content / .prefix 装饰映射到标题内层 span，伪元素规则丢弃。',
  async extract(dir) {
    const mod = await loadModule(`export * from './src/lib/themes/presets'`, dir)
    const presets = (mod.THEME_PRESETS ?? mod.presets ?? mod.default) as any[]
    if (!Array.isArray(presets)) throw new Error('xedit: preset list not found')
    return presets.map((p) => {
      const { styles } = parseCssTheme(String(p.css ?? ''), '#nice')
      return {
        id: p.id,
        name: p.name ?? p.id,
        desc: clip(p.tag ?? p.name ?? p.id),
        keywords: `${p.name ?? ''} ${p.tag ?? ''} ${p.id}`,
        styles,
        origin: { upstream: `src/lib/themes/presets.ts → id "${p.id}"` },
      }
    })
  },
}

// ============================================================
// 来源 7：michellewkx/inkpress —— MIT，26 套 YAML 主题，自带 series / tags 元数据
// ============================================================

const inkpress: SourceInfo = {
  id: 'inkpress',
  dir: 'michellewkx-inkpress',
  project: 'inkpress',
  author: 'inkpress',
  repo: 'https://github.com/michellewkx/inkpress',
  license: 'MIT',
  licenseFile: 'LICENSES/inkpress/LICENSE',
  attribution: 'Copyright (c) 2026 inkpress. Licensed under the MIT License.',
  adapted:
    '读取上游 themes/*.yaml：每个节点是 style 多行 CSS 串（container 是属性字典，转成 CSS 串），' +
    '上游自带的 tags / series 直接喂给风格标签推导。',
  async extract(dir) {
    const themeDir = path.join(dir, 'themes')
    const out: RawTheme[] = []
    for (const file of fs.readdirSync(themeDir).filter((f) => f.endsWith('.yaml') && !f.startsWith('_')).sort()) {
      const doc = yaml.load(fs.readFileSync(path.join(themeDir, file), 'utf8')) as Record<string, any>
      if (!doc || typeof doc !== 'object') continue
      const styles: Record<string, string> = {}
      for (const [key, value] of Object.entries(doc)) {
        if (!value || typeof value !== 'object') continue
        if (typeof value.style === 'string') styles[key] = value.style
        else styles[key] = dictToCss(value)
      }
      const tags = Array.isArray(doc.tags) ? doc.tags.join(' ') : ''
      out.push({
        id: file.replace(/\.yaml$/, ''),
        name: String(doc.name ?? file),
        desc: clip(String(doc.description ?? doc.name ?? file)),
        keywords: `${doc.name ?? ''} ${doc.description ?? ''} ${tags} ${doc.series ?? ''} ${file}`,
        styles,
        origin: { upstream: `themes/${file}` },
      })
    }
    return out
  },
}

const SOURCES: SourceInfo[] = [xiaohu, raphael, huasheng, mdwechat, wenyan, xedit, inkpress]

// ============================================================
// 归一 → 分类 → 规格
// ============================================================

let noKeywordEvidence = 0

function toSpec(raw: RawTheme, source: SourceInfo): ImportedThemeSpec {
  const styles = mapStyles(raw.styles)
  const palette = derivePalette(styles, raw.hints)
  const allCss = Object.values(styles).filter(Boolean).join(';')
  const hues = saturatedHues(collectColors(allCss))
  if (keywordHits(raw.keywords).length === 0) noKeywordEvidence++
  const metaStyles = styleTagsFrom(raw.keywords, {
    background: palette.background,
    accent: palette.accent,
    hues,
  })
  const complexity = complexityOf(measureStyles(styles as Record<string, string>))
  const color = colorFamilyOf(palette.accent, palette.background, hues)
  const origin: ThemeOrigin = {
    kind: 'ported',
    project: source.project,
    author: source.author,
    repo: source.repo,
    license: source.license,
    licenseFile: source.licenseFile,
    attribution: source.attribution,
    adapted: source.adapted,
    ...raw.origin,
  }
  return {
    id: `${source.id}-${raw.id}`,
    name: raw.name || raw.id,
    desc: raw.desc || raw.name || raw.id,
    category: categoryOf(metaStyles, complexity, color),
    meta: { styles: metaStyles, complexity, color, origin },
    palette,
    styles,
  }
}

// ============================================================
// main
// ============================================================

const packs: GeneratedPack[] = []
const missing: string[] = []

for (const source of SOURCES) {
  const dir = path.join(SOURCES_ROOT, source.dir)
  if (!fs.existsSync(dir)) {
    missing.push(`${source.id} → ${dir}`)
    continue
  }
  const raws = await source.extract(dir)
  const seen = new Set<string>()
  const themes: ImportedThemeSpec[] = []
  for (const raw of raws) {
    const spec = toSpec(raw, source)
    if (seen.has(spec.id)) {
      console.warn(`  ! duplicate id skipped: ${spec.id}`)
      continue
    }
    seen.add(spec.id)
    themes.push(spec)
  }
  packs.push({ id: source.id, repo: source.repo, license: source.license, themes })
  console.log(`${source.id.padEnd(12)} ${String(themes.length).padStart(3)} themes  ← ${source.repo}`)
}

if (missing.length) {
  console.warn(`\nSkipped (source not cloned under ${SOURCES_ROOT}):`)
  for (const m of missing) console.warn(`  - ${m}`)
}

for (const pack of packs) {
  const file = writePack(pack)
  console.log(`wrote ${path.relative(process.cwd(), file)}`)
}
const indexFile = writeIndex(packs)
console.log(`wrote ${path.relative(process.cwd(), indexFile)}`)

// ---------- 统计：直接喂给授权与分类审计报告 ----------
const all = packs.flatMap((p) => p.themes)
const byTag = new Map<string, number>()
const byComplexity = new Map<number, number>()
const byColor = new Map<string, number>()
const byLicense = new Map<string, number>()
const bySource = new Map<string, number>()
for (const t of all) {
  for (const tag of t.meta.styles) byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
  byComplexity.set(t.meta.complexity, (byComplexity.get(t.meta.complexity) ?? 0) + 1)
  byColor.set(t.meta.color, (byColor.get(t.meta.color) ?? 0) + 1)
  byLicense.set(t.meta.origin.license, (byLicense.get(t.meta.origin.license) ?? 0) + 1)
  bySource.set(t.meta.origin.project, (bySource.get(t.meta.origin.project) ?? 0) + 1)
}
const sorted = (m: Map<string | number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

console.log(`\n=== imported: ${all.length} themes ===`)
console.log('by source   :', sorted(bySource).map(([k, v]) => `${k} ${v}`).join(' | '))
console.log('by license  :', sorted(byLicense).map(([k, v]) => `${k} ${v}`).join(' | '))
console.log('by style tag:', STYLE_TAGS.map((t) => `${t} ${byTag.get(t) ?? 0}`).join(' | '))
console.log(
  'by complexity:',
  COMPLEXITY_LEVELS.map((c) => `${c.label} ${byComplexity.get(c.level) ?? 0}`).join(' | '),
)
console.log('by color    :', COLOR_FAMILIES.map((c) => `${c} ${byColor.get(c) ?? 0}`).join(' | '))
console.log(`themes whose upstream text gave no keyword evidence (tag from palette or default): ${noKeywordEvidence}`)
