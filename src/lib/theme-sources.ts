/**
 * 主题库的来源档案（单一事实来源）。
 *
 * 职责边界：
 * - 每套主题的 `meta.origin`（theme-meta.ts）记录「这一套」的来源与 lineage，
 *   由 `scripts/themes/import.ts` 生成或手写主题维护；
 * - 本文件记录「每个上游项目」的项目级事实：仓库、作者、默认许可证、留存的
 *   许可证文件、上游格式与审计备注。两边通过 `origin.project` 连接，
 *   `scripts/verify-sources.ts` 校验主题引用的 project 必然命中这里。
 * - `credits.ts` 是另一条线：代码层面的借鉴与落点（borrowed / declined）。
 *   两条线互不重复——这里只管主题素材，credits 只管代码。
 *
 * README 的许可证统计与致谢章节、THEME-SOURCES.md 的来源表与统计、
 * /references 页面的来源区块都从这里（以及 credits.ts / THEMES）生成。
 */

import type { Theme } from './theme-kit'
import { ORIGINAL_LICENSE, type Complexity, type ColorFamily, type StyleTag, type ThemeLicense } from './theme-meta'
import { APP_BYLINE, APP_NAME, REPO_URL } from './brand'

export interface ThemeSource {
  /** 连接键：theme.meta.origin.project 必须逐字等于它。 */
  project: string
  kind: 'original' | 'ported'
  /** 上游仓库；本项目自研条目指向本项目仓库。 */
  repo: string
  author: string
  /** 这个来源的默认许可证；单套主题可以不同（lineage），以那套主题的 meta 为准。 */
  license: ThemeLicense
  /** 仓库内留存的许可证文本，app 相对路径（LICENSES/…）；每个都必须真实存在。 */
  licenseFiles: string[]
  /** 上游主题的格式与读取方式，一行。 */
  format: string
  /** 审计备注：许可证文件状况、来源级 lineage 等。 */
  notes?: string
}

export const THEME_SOURCES: ThemeSource[] = [
  {
    project: APP_NAME,
    kind: 'original',
    repo: REPO_URL,
    author: APP_BYLINE.replace(/^by\s*/, ''),
    license: ORIGINAL_LICENSE,
    licenseFiles: [],
    format: '手写主题（theme-kit 语义节点）',
  },
  {
    project: 'xiaohu-wechat-format',
    kind: 'ported',
    repo: 'https://github.com/xiaohuailabs/xiaohu-wechat-format',
    author: 'xiaohuailabs',
    license: 'MIT',
    licenseFiles: ['LICENSES/xiaohu-wechat-format/LICENSE-NOTE.md'],
    format: '纯 JSON，snake_case 样式字典',
    notes: '上游 README 声明 MIT，但仓库内没有 LICENSE 文件；LICENSES/ 下的副本是这份授权状态记录。',
  },
  {
    project: 'raphael-publish',
    kind: 'ported',
    repo: 'https://github.com/liuxiaopai-ai/raphael-publish',
    author: 'Raphael Editor Contributors',
    license: 'MIT',
    licenseFiles: ['LICENSES/raphael-publish/LICENSE'],
    format: 'TS，tag→内联 CSS 串',
  },
  {
    project: 'md-wechat',
    kind: 'ported',
    repo: 'https://github.com/laogou717/md-wechat',
    author: '字间排版（laogou717）',
    license: 'MIT',
    licenseFiles: ['LICENSES/md-wechat/LICENSE'],
    format: 'JS，styles:(p)=>({元素:CSS})',
    notes:
      '28 套里 2 套（科技蓝 / 全栈蓝）的上游自述移植自 mdnice 经典主题，按 GPL-3.0-only 单独标注；其余 26 套按上游 MIT。',
  },
  {
    project: 'inkpress',
    kind: 'ported',
    repo: 'https://github.com/michellewkx/inkpress',
    author: 'michellewkx',
    license: 'MIT',
    licenseFiles: ['LICENSES/inkpress/LICENSE'],
    format: 'YAML，每节点 style: 多行 CSS，自带 series/tags',
  },
  {
    project: 'huasheng_editor',
    kind: 'ported',
    repo: 'https://github.com/alchaincyf/huasheng_editor',
    author: '花生（alchaincyf）',
    license: 'MIT',
    licenseFiles: ['LICENSES/huasheng-editor/LICENSE'],
    format: 'JS 全局脚本，tag→内联 CSS 串',
    notes: '上游是 ricocc/rico-md 那 21 套主题的直接来源；我们取上游仓库本身，不取二手拷贝。',
  },
  {
    project: 'xedit',
    kind: 'ported',
    repo: 'https://github.com/rotbit/xedit',
    author: 'rotbit',
    license: 'MIT',
    licenseFiles: ['LICENSES/xedit/LICENSE'],
    format: 'TS，#nice 选择器 CSS 串',
  },
  {
    project: 'wenyan-core',
    kind: 'ported',
    repo: 'https://github.com/caol64/wenyan-core',
    author: 'Lei（caol64）',
    license: 'Apache-2.0',
    licenseFiles: [
      'LICENSES/wenyan-core/LICENSE',
      'LICENSES/typora-upstream/BEATREE-typora-maize-theme-LICENSE',
      'LICENSES/typora-upstream/YiNNx-typora-theme-lapis-LICENSE',
      'LICENSES/typora-upstream/evgo2017-typora-theme-orange-heart-LICENSE',
      'LICENSES/typora-upstream/hliu202-typora-purple-theme-LICENSE',
      'LICENSES/typora-upstream/kevinzhao2233-typora-theme-pie-LICENSE',
      'LICENSES/typora-upstream/sumruler-typora-theme-phycat-LICENSE',
      'LICENSES/typora-upstream/thezbm-typora-theme-rainbow-LICENSE',
    ],
    format: 'CSS 文件 + TS 注册表',
    notes:
      '8 套里 7 套的 CSS 头注释标明各自的 Typora 上游主题与作者（7 个上游仓库实测均为 MIT），第 8 套 wenyan-default 按 wenyan-core 的 Apache-2.0 记录；许可证文本存在 typora-upstream/ 下。',
  },
  {
    project: 'gzh-design-skill',
    kind: 'ported',
    repo: 'https://github.com/isjiamu/gzh-design-skill',
    author: '甲木 (Jiamu) × 摸鱼小李 (Moyu Xiaoli)',
    license: 'AGPL-3.0-or-later',
    licenseFiles: ['LICENSES/gzh-design-skill/LICENSE'],
    format: 'Markdown 组件库',
    notes:
      'AGPL-3.0-or-later 有传染性且第 13 条覆盖网络服务：本项目整体因此以 AGPL 提供源码；线上部署与公开仓库对应是履行该义务的方式。',
  },
]

export interface SourceTally extends ThemeSource {
  /** 这个来源在当前 catalog 里的主题套数。 */
  count: number
  /** 逐许可证的套数（lineage 会让一个来源出现多种许可证），按套数降序。 */
  licenses: { license: ThemeLicense; count: number }[]
}

/** License 显示名：Project-Original 是本项目自研的标记，不是上游许可证。 */
export function licenseLabel(license: ThemeLicense): string {
  return license === ORIGINAL_LICENSE ? '本项目自研' : license
}

function byCountDesc<T extends { count: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.count - a.count)
}

/** 把 catalog 按来源归组；顺序跟 THEME_SOURCES 一致，来源至少有一套主题时才有输出。 */
export function tallyThemeSources(themes: readonly Theme[]): SourceTally[] {
  return THEME_SOURCES.map((source) => {
    const own = themes.filter((t) => t.meta.origin.project === source.project)
    const perLicense = new Map<ThemeLicense, number>()
    for (const t of own) perLicense.set(t.meta.origin.license, (perLicense.get(t.meta.origin.license) ?? 0) + 1)
    return {
      ...source,
      count: own.length,
      licenses: byCountDesc([...perLicense.entries()].map(([license, count]) => ({ license, count }))),
    }
  })
}

/** 按 meta.origin.license 统计套数，降序。 */
export function tallyByLicense(themes: readonly Theme[]): { license: ThemeLicense; count: number }[] {
  const m = new Map<ThemeLicense, number>()
  for (const t of themes) m.set(t.meta.origin.license, (m.get(t.meta.origin.license) ?? 0) + 1)
  return byCountDesc([...m.entries()].map(([license, count]) => ({ license, count })))
}

/** 按风格标签统计（多标签，一套主题计多次），降序。标签顺序沿用 STYLE_TAGS。 */
export function tallyByTag(themes: readonly Theme[]): { tag: StyleTag; count: number }[] {
  const m = new Map<StyleTag, number>()
  for (const t of themes) for (const tag of t.meta.styles) m.set(tag, (m.get(tag) ?? 0) + 1)
  return byCountDesc([...m.entries()].map(([tag, count]) => ({ tag, count })))
}

export function tallyByComplexity(themes: readonly Theme[]): { complexity: Complexity; count: number }[] {
  const m = new Map<Complexity, number>()
  for (const t of themes) m.set(t.meta.complexity, (m.get(t.meta.complexity) ?? 0) + 1)
  return [...m.entries()].map(([complexity, count]) => ({ complexity, count })).sort((a, b) => a.complexity - b.complexity)
}

export function tallyByColor(themes: readonly Theme[]): { color: ColorFamily; count: number }[] {
  const m = new Map<ColorFamily, number>()
  for (const t of themes) m.set(t.meta.color, (m.get(t.meta.color) ?? 0) + 1)
  return byCountDesc([...m.entries()].map(([color, count]) => ({ color, count })))
}
