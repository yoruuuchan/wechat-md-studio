// 文档区块的生成器：从单一数据源算出 README / THEME-SOURCES.md / LICENSES/NOTICE.md
// 里那些必须与数据一致的段落。
//
//   数据源                     产出
//   src/lib/credits.ts          Full acknowledgements and license tally in NOTICE
//   src/lib/theme-sources.ts    README 主题统计、THEME-SOURCES.md 来源表与统计
//   src/lib/themes.ts（THEMES）  每一处主题数量与 License 分布
//
// 写文件的是 scripts/sources/sync.ts（npm run sync:docs）；
// 重算并逐块比对的是 scripts/verify-sources.ts（npm run verify:sources）。
// 区块用 HTML 注释标记，标记之内的内容由脚本生成，不要手改。

import { THEMES } from '../../src/lib/themes'
import { EXTRA_THEMES } from '../../src/lib/themes-extra'
import {
  CREDITS,
  USAGE_HINT,
  USAGE_LABEL,
  USAGE_ORDER,
  type Credit,
} from '../../src/lib/credits'
import {
  THEME_SOURCES,
  licenseLabel,
  tallyByColor,
  tallyByComplexity,
  tallyByLicense,
  tallyByTag,
  tallyThemeSources,
  type SourceTally,
} from '../../src/lib/theme-sources'
import {
  COLOR_FAMILIES,
  ORIGINAL_LICENSE,
  STYLE_TAGS,
  complexityLabel,
  type ThemeLicense,
} from '../../src/lib/theme-meta'
import pkg from '../../package.json'

export const PROJECT_LICENSE: string = pkg.license

// ---------------------------------------------------------------- markers

export interface DocBlock {
  file: string
  name: string
  /** true = 行内标记（同一行里替换一段文字）；false = 整段区块。 */
  inline?: boolean
  build(): string
}

const blockStart = (name: string) => `<!-- BEGIN GENERATED: ${name} — npm run sync:docs -->`
const blockEnd = (name: string) => `<!-- END GENERATED: ${name} -->`
const inlineStart = (name: string) => `<!-- gen:${name} -->`
const inlineEnd = (name: string) => `<!-- /gen:${name} -->`

/**
 * 生成与校验统一在 LF 语义下工作。Windows 上编辑器（autocrlf=true）会把文件
 * 写成 CRLF，逐字比较会因 \r 误报「区块不一致」——规范化一次，两边就都对得上。
 * sync 写回的文件是 LF；git 的 clean 过滤器会把它归一，仓库里看不出差别。
 */
const normalize = (text: string) => text.replace(/\r\n/g, '\n')

function replaceBetween(text: string, start: string, end: string, body: string): string {
  const i = text.indexOf(start)
  const j = text.indexOf(end)
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`generated marker not found: ${start} … ${end}`)
  }
  return text.slice(0, i + start.length) + '\n' + body.trim() + '\n' + text.slice(j)
}

export function applyGeneratedBlock(text: string, name: string, body: string): string {
  return replaceBetween(text, blockStart(name), blockEnd(name), body)
}

/** 行内标记不引入换行：替换发生在同一行中间。 */
export function applyGeneratedInline(text: string, name: string, value: string): string {
  const start = inlineStart(name)
  const end = inlineEnd(name)
  const i = text.indexOf(start)
  const j = text.indexOf(end)
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`generated inline marker not found: ${start} … ${end}`)
  }
  return text.slice(0, i + start.length) + value.trim() + text.slice(j)
}

/** 读出区块当前内容（verify 用来点名哪个块不一致）；标记缺失返回 null。 */
export function extractGeneratedBlock(text: string, name: string): string | null {
  const start = blockStart(name)
  const end = blockEnd(name)
  const t = normalize(text)
  const i = t.indexOf(start)
  const j = t.indexOf(end)
  if (i === -1 || j === -1 || j < i) return null
  return t.slice(i + start.length, j).trim()
}

export function extractGeneratedInline(text: string, name: string): string | null {
  const start = inlineStart(name)
  const end = inlineEnd(name)
  const t = normalize(text)
  const i = t.indexOf(start)
  const j = t.indexOf(end)
  if (i === -1 || j === -1 || j < i) return null
  return t.slice(i + start.length, j).trim()
}

/** 按 DOC_BLOCKS 重算一个文件应然的样子（不落盘，输出 LF）。 */
export function renderDocFile(file: string, current: string): string {
  let out = normalize(current)
  for (const block of DOC_BLOCKS.filter((b) => b.file === file)) {
    out = block.inline
      ? applyGeneratedInline(out, block.name, block.build())
      : applyGeneratedBlock(out, block.name, block.build())
  }
  return out
}

// ---------------------------------------------------------------- 主题统计

/** 上游许可证展示口径：WTFPL 照实写全名 v2（README/NOTICE 都按这个口径）。 */
function upstreamLicenseLabel(license: string): string {
  return license === 'WTFPL' ? 'WTFPL v2' : license
}

/** 按套数降序；本项目自研永远排在最后，不和上游许可证混在中间。 */
function orderedLicenses() {
  const rows = tallyByLicense(THEMES)
  const original = rows.filter((r) => r.license === ORIGINAL_LICENSE)
  const upstream = rows.filter((r) => r.license !== ORIGINAL_LICENSE)
  return [...upstream, ...original]
}

function sourceLabel(s: Pick<SourceTally, 'kind' | 'project'>): string {
  return s.kind === 'original' ? '本项目自研' : s.project
}

export function themeCount(): number {
  return THEMES.length
}

/** 来源分组：导入（import.ts 生成）、gzh-design-skill 移植（themes-extra）、自研。 */
function sourceGroups() {
  const extraIds = new Set(EXTRA_THEMES.map((t) => t.id))
  const imported = THEMES.filter((t) => !extraIds.has(t.id) && t.meta.origin.kind === 'ported')
  const importedProjects = new Set(imported.map((t) => t.meta.origin.project))
  const extraProject = EXTRA_THEMES[0]?.meta.origin.project ?? ''
  return {
    imported,
    importedProjects,
    extras: EXTRA_THEMES.length,
    extraProject,
    originals: THEMES.filter((t) => t.meta.origin.kind === 'original').length,
  }
}

function creditsByLicense(): { license: string; count: number }[] {
  const m = new Map<string, number>()
  for (const c of CREDITS) m.set(c.license, (m.get(c.license) ?? 0) + 1)
  return [...m.entries()].map(([license, count]) => ({ license, count })).sort((a, b) => b.count - a.count)
}

const COPYLEFTISH = ['GPL', 'AGPL', 'LGPL', 'MPL', 'SSPL', 'BUSL']

// ---------------------------------------------------------------- README

export function buildReadmeThemeCount(): string {
  return `${THEMES.length} 套`
}

/** A short README source summary; detailed statistics stay in the audit docs. */
export function buildReadmeThemeSources(): string {
  const groups = sourceGroups()
  const upstreamThemes = THEMES.length - groups.originals
  return [
    `主题库共 **${THEMES.length} 套**：${groups.originals} 套自研 + ${groups.importedProjects.size + 1} 个上游项目的 ${upstreamThemes} 套主题，来源与许可维护在统一 metadata 中。`,
    '',
    '主题审计见 [THEME-SOURCES](THEME-SOURCES.md)；工程借鉴、取舍与完整致谢由 [credits.ts](src/lib/credits.ts) 驱动 [References](https://wechat.yoru-and-akari.dev/references) 与 [LICENSES/NOTICE](LICENSES/NOTICE.md)。',
  ].join('\n')
}

function creditBullets(items: string[], indent = ''): string[] {
  return items.map((t) => `${indent}- ${t}`)
}

function creditSection(credit: Credit): string[] {
  const out: string[] = []
  out.push(`**[${credit.name}](${credit.repo})**（${credit.license}，${credit.author}）`, '')
  out.push(...creditBullets(credit.borrowed))
  if (credit.declined && credit.declined.length) {
    out.push('', '**没采用**：', '', ...creditBullets(credit.declined))
  }
  return out
}

/** Full NOTICE acknowledgements, including tables and grouped credit details. */
export function buildNoticeAcknowledgements(): string {
  const out: string[] = []

  out.push('### 许可证核实', '')
  out.push(
    '2026-10-07 逐个打开上游 LICENSE 文件核对，核对的 commit 与副本 md5 记在 [本文件](NOTICE.md) 第一节；来源与使用性质以 `src/lib/credits.ts` 为准。',
    '',
  )
  out.push('| 上游 | LICENSE | LICENSE 里的版权行 | 副本 |')
  out.push('|---|---|---|---|')
  for (const c of CREDITS) {
    out.push(
      `| [${c.name}](${c.repo}) | ${upstreamLicenseLabel(c.license)} | \`${c.licenseCopyright}\` | \`LICENSES/${c.licenseFile}\` |`,
    )
  }
  out.push('')

  const tally = creditsByLicense().map((r) => `${upstreamLicenseLabel(r.license)} × ${r.count}`).join('、')
  const copyleftCredits = CREDITS.filter((c) => COPYLEFTISH.some((t) => c.license.includes(t)))
  const missingLicense = CREDITS.filter((c) => !c.license)
  out.push(
    `${CREDITS.length} 个上游全部是宽松许可：${tally}。` +
      (copyleftCredits.length === 0
        ? '**没有 GPL / AGPL / SSPL 一类 copyleft' +
          (missingLicense.length === 0 ? '，也没有任何项目缺失 LICENSE 文件' : '') +
          '**——所以这些上游对本项目自己选开源许可证不构成传染性约束。'
        : `**注意：存在 copyleft 上游（${copyleftCredits.map((c) => c.name).join('、')}），整体许可证选择要以它们为准。**`),
    '',
  )

  const noted = CREDITS.filter((c) => c.licenseNote)
  if (noted.length) {
    out.push(`${noted.length} 点需要留意：`, '')
    noted.forEach((c, i) => {
      out.push(`${i + 1}. **[${c.name}](${c.repo})**：${c.licenseNote}`)
    })
    out.push('')
  }

  for (const usage of USAGE_ORDER) {
    const group = CREDITS.filter((c) => c.usage === usage)
    if (!group.length) continue
    out.push(`### ${USAGE_LABEL[usage]}（${usage}）`, '')
    out.push(USAGE_HINT[usage], '')
    group.forEach((c, i) => {
      if (i > 0) out.push('')
      out.push(...creditSection(c))
    })
    out.push('')
  }

  return out.join('\n')
}

// ---------------------------------------------------------------- THEME-SOURCES.md

export function buildThemesDocIntro(): string {
  const groups = sourceGroups()
  const importedCount = groups.imported.length
  const originalCount = groups.originals
  return [
    `主题库当前共 **${THEMES.length} 套**：${importedCount} 套由 \`scripts/themes/import.ts\` 从 ${groups.importedProjects.size} 个上游仓库导入、${groups.extras} 套 ${groups.extraProject} 移植、${originalCount} 套自研。`,
    `导入产物在 \`src/lib/themes-imported/*.ts\`，提交进仓库，运行时不依赖任何上游仓库。重跑：\`npm run import:themes\`（上游克隆位置见文末）。`,
  ].join('\n')
}

/** 「已接入来源」表 + 审计备注（套数、许可证分布、留存文件都从数据算）。 */
export function buildThemesDocSourceTable(): string {
  const sources = tallyThemeSources(THEMES)
  const ordered = [...sources.filter((s) => s.kind === 'ported'), ...sources.filter((s) => s.kind === 'original')]

  const licenseCell = (s: SourceTally): string => {
    // 自研行照实写标记本身（Project-Original），避免和来源列的「本项目自研」重复。
    if (s.kind === 'original') return ORIGINAL_LICENSE
    if (s.licenses.length === 1) return licenseLabel(s.licenses[0].license)
    return s.licenses.map((l) => `${l.license} ${l.count} 套`).join(' · ')
  }

  const fileCell = (s: SourceTally): string => {
    if (!s.licenseFiles.length) return '—'
    const byDir = new Map<string, string[]>()
    for (const f of s.licenseFiles) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.'
      byDir.set(dir, [...(byDir.get(dir) ?? []), f])
    }
    return [...byDir.entries()]
      .map(([dir, files]) => (files.length === 1 ? `\`${files[0]}\`` : `\`${dir}/\` ${files.length} 份`))
      .join(' + ')
  }

  const out: string[] = []
  out.push('| 来源 | License | 套数 | 上游格式 | 许可证留存 |')
  out.push('|---|---|---|---|---|')
  for (const s of ordered) {
    const label =
      s.kind === 'original' ? '本项目自研' : `[${s.repo.replace(/^https?:\/\/github\.com\//, '')}](${s.repo})`
    out.push(`| ${label} | ${licenseCell(s)} | ${s.count} | ${s.format} | ${fileCell(s)} |`)
  }

  const noted = ordered.filter((s) => s.notes)
  if (noted.length) {
    out.push('', '审计备注：', '')
    for (const s of noted) {
      out.push(`- **${sourceLabel(s)}**：${s.notes}`)
    }
  }
  return out.join('\n')
}

export function buildThemesDocStats(): string {
  const bySource = [...tallyThemeSources(THEMES)].sort((a, b) => b.count - a.count)
  const byLicense = orderedLicenses()
  const tagCounts = new Map(tallyByTag(THEMES).map((t) => [t.tag, t.count]))
  const tags = [...STYLE_TAGS].sort((a, b) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0))
  const complexities = tallyByComplexity(THEMES)
  const colors = tallyByColor(THEMES)

  return [
    `- 按来源：${bySource.map((s) => `${sourceLabel(s)} ${s.count}`).join(' · ')}`,
    `- 按许可证：${byLicense.map((r) => `${licenseLabel(r.license)} ${r.count}`).join(' · ')}`,
    `- 按风格标签（多标签）：${tags.map((t) => `${t} ${tagCounts.get(t) ?? 0}`).join(' · ')}`,
    `- 按复杂度：${complexities.map((c) => `${complexityLabel(c.complexity)} ${c.count}`).join(' · ')}`,
    `- 按色系：${COLOR_FAMILIES.map((f) => `${f} ${colors.find((c) => c.color === f)?.count ?? 0}`).join(' · ')}`,
  ].join('\n')
}

const RELATIONS: Record<string, string> = {
  MIT: '单向并入，保留版权声明与许可文本即可（已做）',
  'BSD-2-Clause': '单向并入，保留版权声明与许可文本即可（已做）',
  'BSD-3-Clause': '单向并入，保留版权声明与许可文本即可（已做）',
  ISC: '单向并入，保留版权声明与许可文本即可（已做）',
  Unlicense: '单向并入，保留版权声明与许可文本即可（已做）',
  'CC0-1.0': '单向并入，无需额外义务（已做）',
  'CC-BY-4.0': '保留署名（已做）',
  'Apache-2.0': '兼容；保留 LICENSE、标注修改、传递 NOTICE（上游无 NOTICE，此条免）',
  'AGPL-3.0-only': '同许可证族，保留联名署名（已做）',
  'AGPL-3.0-or-later': '同许可证族，保留联名署名（已做）',
  'GPL-3.0-only': 'AGPL 第 13 条第二段明文允许与 GPL-3.0 作品组合为单一 AGPL 作品',
  'GPL-3.0-or-later': 'AGPL 第 13 条第二段明文允许与 GPL-3.0 作品组合为单一 AGPL 作品',
  'MPL-2.0': '保留文件级声明与许可证文本（已做）',
  'CC-BY-SA-4.0': '同类 copyleft，保留署名并以同许可发布衍生（已做）',
  [ORIGINAL_LICENSE]: '—',
}

export function buildThemesDocCompatibility(): string {
  const rows = orderedLicenses()
  const out: string[] = []
  out.push(
    `[package.json](package.json) 的 \`license\` 字段与 [README](README.md#license-与来源) 同步声明。${THEMES.length} 套主题全部保留，兼容性逐族核对：`,
    '',
    `| 上游许可证 | 套数 | 与 ${PROJECT_LICENSE} 应用的关系 |`,
    '|---|---|---|',
  )
  for (const r of rows) {
    out.push(`| ${licenseLabel(r.license)} | ${r.count} | ${RELATIONS[r.license] ?? '需人工核对'} |`)
  }
  return out.join('\n')
}

// ---------------------------------------------------------------- NOTICE.md

export function buildNoticeLicenseTally(): string {
  const tally = creditsByLicense().map((r) => `${upstreamLicenseLabel(r.license)} × ${r.count}`).join('、')
  const copyleftCredits = CREDITS.filter((c) => COPYLEFTISH.some((t) => c.license.includes(t)))
  const label = (n: number) => {
    const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
    return n < 10 ? cn[n] : String(n)
  }
  const conclusion =
    copyleftCredits.length === 0
      ? `${label(CREDITS.length)}个上游项目全部是宽松许可：${tally}。\n没有任何 GPL / LGPL / AGPL / MPL / SSPL / BUSL 等 copyleft 或 source-available 许可，\n也没有任何项目缺失 LICENSE 文件。`
      : `${label(CREDITS.length)}个上游项目里存在 copyleft：${copyleftCredits.map((c) => c.name).join('、')}，\n整体许可证选择以它们为准，逐族关系见 THEME-SOURCES.md 第四节。`
  return `**${conclusion}**`
}

// ---------------------------------------------------------------- 区块清单

export const DOC_BLOCKS: DocBlock[] = [
  { file: 'README.md', name: 'theme-count', inline: true, build: buildReadmeThemeCount },
  { file: 'README.md', name: 'readme-theme-sources', build: buildReadmeThemeSources },
  { file: 'LICENSES/NOTICE.md', name: 'notice-credits', build: buildNoticeAcknowledgements },
  { file: 'THEME-SOURCES.md', name: 'themes-doc-intro', build: buildThemesDocIntro },
  { file: 'THEME-SOURCES.md', name: 'themes-doc-sources', build: buildThemesDocSourceTable },
  { file: 'THEME-SOURCES.md', name: 'themes-doc-stats', build: buildThemesDocStats },
  { file: 'THEME-SOURCES.md', name: 'themes-doc-compat', build: buildThemesDocCompatibility },
  { file: 'LICENSES/NOTICE.md', name: 'notice-license-tally', build: buildNoticeLicenseTally },
]

export const DOC_FILES: string[] = [...new Set(DOC_BLOCKS.map((b) => b.file))]
