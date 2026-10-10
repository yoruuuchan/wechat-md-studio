// 主题库的分类维度与来源档案。
// 每套主题必须带 meta：风格标签、复杂度、色系，以及可追溯到原仓库、原作者、
// 许可证与署名要求的来源信息。这是主题库能被合法再分发的前提，不是可选装饰。
// The stored values below are stable data (they key filters and metadata); the
// display wording for each lives in the i18n dictionaries and follows the UI
// language.

import { t } from './i18n'

/** 风格标签：多标签体系，一套主题可以同时属于多个风格。 */
export const STYLE_TAGS = [
  '商务',
  '政务',
  '科技',
  '杂志',
  '文艺复古',
  '中国风',
  '学术',
  '运动',
  '卡通',
  '治愈',
  '暗色',
  '节日',
] as const

export type StyleTag = (typeof STYLE_TAGS)[number]

/**
 * 复杂度是一条有序层级：装饰越少越靠前。
 * 用数字而不是字符串，方便排序和"至少多复杂"这类筛选。
 */
export const COMPLEXITY_LEVELS = [
  { level: 1, label: '简洁', hint: '几乎无装饰，靠字号、字重与留白分层' },
  { level: 2, label: '标准', hint: '有主色点睛、标题装饰与轻量卡片' },
  { level: 3, label: '复杂', hint: '强视觉隐喻，多层卡片、色块与丰富装饰' },
] as const

export type Complexity = (typeof COMPLEXITY_LEVELS)[number]['level']

export function complexityLabel(level: Complexity): string {
  return t(`meta.complexity.${level}`)
}

export function complexityHint(level: Complexity): string {
  return t(`meta.complexityHint.${level}`)
}

/** 色系：按主色调归组，供"按颜色浏览"用。 */
export const COLOR_FAMILIES = ['冷色', '暖色', '中性', '多彩'] as const

export type ColorFamily = (typeof COLOR_FAMILIES)[number]

/**
 * 允许出现在 catalog 里的许可证。SPDX 标识。
 * 新增来源时先确认它在这里；不在就先走授权审计，别直接接入。
 */
export const KNOWN_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'Unlicense',
] as const

export type LicenseId = (typeof KNOWN_LICENSES)[number]

/** 本项目自研主题用的标记，不进 KNOWN_LICENSES（它不是上游许可证）。 */
export const ORIGINAL_LICENSE = 'Project-Original' as const

export type ThemeLicense = LicenseId | typeof ORIGINAL_LICENSE

const COPYLEFT: readonly ThemeLicense[] = [
  'MPL-2.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'CC-BY-SA-4.0',
]

/** 传染性许可证：接入后整个项目的许可证选择都要跟着它走。 */
export function isCopyleft(license: ThemeLicense): boolean {
  return COPYLEFT.includes(license)
}

/**
 * AGPL 第 13 条：只要把它部署成网络服务，就必须向使用者提供完整源码。
 * 本项目已计划开源，所以可满足，但这条要在审计报告里点名。
 */
export function isNetworkCopyleft(license: ThemeLicense): boolean {
  return license === 'AGPL-3.0-only' || license === 'AGPL-3.0-or-later'
}

export interface ThemeOrigin {
  /** original = 为本项目自研；ported = 从外部项目移植。 */
  kind: 'original' | 'ported'
  /** 来源项目名（自研时为本项目名）。 */
  project: string
  /** 原作者或团队；自研时为本项目署名。 */
  author: string
  /** 原仓库地址；自研时为本项目仓库地址。 */
  repo: string
  license: ThemeLicense
  /** 必须随主题保留的署名文本，会展示在主题详情里。 */
  attribution: string
  /** 仓库内留存的许可证文本，相对项目根目录。 */
  licenseFile?: string
  /** lineage：这套主题在上游本身是对谁的二次适配。 */
  upstream?: string
  /** 移植时做了什么改动，便于对照上游复核。 */
  adapted?: string
}

export interface ThemeMeta {
  styles: StyleTag[]
  complexity: Complexity
  color: ColorFamily
  origin: ThemeOrigin
}
