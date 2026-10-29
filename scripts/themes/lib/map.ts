// 上游样式 → 本项目内部规格。
//
// 各来源的字段命名不同（xiaohu 是 snake_case 的 JSON 字典，raphael / huasheng 是
// tag→CSS 串，md-wechat 有自己的 bqP / preBody 之类命名，wenyan / xedit / doocs 是
// 完整 CSS 文件），但都能归一到「语义元素 → 一段内联 CSS」。这里负责归一，
// 以及从归一结果里把配色挖出来——多数来源不单独给色板，只能从样式反推。

import type { ThemePalette, ThemeStyles } from '../../../src/lib/theme-kit'
import { collectColors, hsl, mix, parseColor, saturatedHues, tint, toHex } from './color'

/** 上游字段名 → 内部 ThemeStyles 字段名。同一个内部字段可以有多个别名，先到先得。 */
const ALIAS: [keyof ThemeStyles, string[]][] = [
  ['wrapper', ['container', 'wrapper', 'root', 'section', 'body']],
  ['p', ['p', 'paragraph']],
  ['h1', ['h1']],
  ['h2', ['h2']],
  ['h3', ['h3']],
  ['h4', ['h4']],
  ['h1Span', ['h1Span']],
  ['h2Span', ['h2Span']],
  ['h3Span', ['h3Span']],
  ['blockquote', ['blockquote', 'quote']],
  ['blockquoteP', ['blockquote_p', 'blockquoteP', 'bqP', 'blockquote p']],
  ['callout', ['callout']],
  ['calloutTitle', ['callout_title', 'calloutTitle']],
  ['calloutContent', ['callout_content', 'calloutContent']],
  ['strong', ['strong', 'b']],
  ['em', ['em', 'i']],
  ['del', ['del', 's', 'strike']],
  ['mark', ['mark', 'highlight']],
  ['a', ['a', 'link']],
  ['code', ['code', 'code_inline', 'codeInline', 'inline_code', 'inlineCode']],
  ['codeBlock', ['code_block', 'codeBlock', 'pre_wrapper', 'preWrapper', 'code_wrap']],
  ['codeHeader', ['code_header', 'codeHeader', 'preHeader', 'pre_header', 'preLabel', 'codeLabel']],
  ['pre', ['pre', 'pre_code', 'preCode', 'preBody', 'pre_body', 'code_block_text']],
  ['table', ['table', 'tableWrap', 'table_wrap']],
  ['th', ['th', 'table th']],
  ['td', ['td', 'table td']],
  ['img', ['img', 'image']],
  ['imgWrapper', ['img_wrapper', 'imgWrapper', 'figure']],
  ['figcaption', ['figcaption', 'caption', 'img_caption', 'imgCaption']],
  ['hr', ['hr']],
  ['listWrapper', ['list_wrapper', 'listWrapper']],
  ['listItemRow', ['list_item_row', 'listItemRow']],
  ['listBullet', ['list_item_bullet', 'listItemBullet', 'ul_bullet']],
  ['olBullet', ['ol_item_bullet', 'olItemBullet']],
  ['listItemText', ['list_item_text', 'listItemText', 'liP', 'li_p']],
  ['ul', ['ul']],
  ['ol', ['ol']],
  ['li', ['li']],
]

/** snake_case / kebab-case / 带空格的后代选择器 → camelCase 内部名。 */
function normalizeKey(key: string): string {
  return key
    .trim()
    .replace(/[-_\s]+([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
}

/** 去掉 !important：它只在 class 体系里有意义，内联样式里是噪音。 */
export function stripImportant(css: string): string {
  return css.replace(/\s*!important/gi, '')
}

/** 把任意来源的样式字典归一成内部 ThemeStyles，未识别的字段丢弃。 */
export function mapStyles(raw: Record<string, string>): ThemeStyles {
  const lookup = new Map<string, keyof ThemeStyles>()
  for (const [internal, aliases] of ALIAS) {
    for (const a of aliases) lookup.set(normalizeKey(a), internal)
  }
  const out: ThemeStyles = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || !value.trim()) continue
    // md-wechat 一类来源把 HTML 片段（hrHtml / h2WrapOpen / preLabel）和 CSS 串混在
    // 同一个字典里；带尖括号的值不是样式，塞进 style="" 会把整段标记打散。
    if (/[<>]/.test(value)) continue
    const internal = lookup.get(normalizeKey(key))
    if (!internal) continue
    // 同一内部字段有多个上游别名时，保留信息量更大的那份
    const prev = out[internal]
    const next = stripImportant(value).trim()
    if (!prev || next.length > prev.length) out[internal] = next
  }
  return out
}

/** 从一段 CSS 里取某个属性的值；取不到返回空串。 */
export function decl(css: string | undefined, prop: string): string {
  if (!css) return ''
  for (const raw of css.split(';')) {
    const sep = raw.indexOf(':')
    if (sep < 0) continue
    if (raw.slice(0, sep).trim().toLowerCase() !== prop) continue
    return stripImportant(raw.slice(sep + 1)).trim()
  }
  return ''
}

/** 只接受纯色：渐变、背景图、transparent 都不算。 */
function solidColor(value: string): string | null {
  if (!value) return null
  if (/gradient|url\(|none|transparent|inherit/i.test(value)) return null
  const first = value.split(/\s+/)[0]
  const rgb = parseColor(first)
  return rgb ? toHex(rgb) : null
}

/** border 简写里的颜色：`1px solid #abc` → `#abc`。 */
function borderColor(value: string): string | null {
  if (!value) return null
  const m = value.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/)
  return m ? solidColor(m[1]) : null
}

function firstSolid(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const v = solidColor(c ?? '')
    if (v) return v
  }
  return null
}

export interface PaletteHints {
  background?: string
  text?: string
  accent?: string
  heading?: string
  quoteBg?: string
  codeBg?: string
  muted?: string
  border?: string
}

/**
 * 反推色板。上游给了 colors 就用它做 hint，其余从样式里挖；
 * 都挖不到的用与背景/正文相关的中性推导，保证不会落下未定义的颜色。
 */
export function derivePalette(styles: ThemeStyles, hints: PaletteHints = {}): ThemePalette {
  const all = Object.values(styles).filter(Boolean).join(';')
  const background =
    firstSolid(hints.background, decl(styles.wrapper, 'background-color'), decl(styles.wrapper, 'background')) ??
    '#FFFFFF'

  const text =
    firstSolid(hints.text, decl(styles.p, 'color')) ??
    (parseColor(background) && hsl(parseColor(background)!).l < 0.4 ? '#D8DCE6' : '#3F3F46')

  const heading = firstSolid(hints.heading, decl(styles.h2, 'color'), decl(styles.h1, 'color')) ?? text

  // 主色按证据强弱依次找：标题描边 → 标题底色 → 加粗色 → 链接色 → 全主题最饱和的高频色
  const accentFromBorder =
    borderColor(decl(styles.h2, 'border-left')) ||
    borderColor(decl(styles.h2, 'border-bottom')) ||
    borderColor(decl(styles.h3, 'border-left')) ||
    borderColor(decl(styles.h1, 'border-bottom'))
  const accentFromBg = firstSolid(decl(styles.h2, 'background-color'), decl(styles.h2, 'background'))
  const accentFromStrong = firstSolid(decl(styles.strong, 'color'))
  const accentFromLink = firstSolid(decl(styles.a, 'color'))
  const accent =
    firstSolid(hints.accent) ??
    accentFromBorder ??
    accentFromBg ??
    accentFromStrong ??
    accentFromLink ??
    dominantColor(all, background) ??
    heading

  const border =
    firstSolid(hints.border) ??
    borderColor(decl(styles.td, 'border')) ??
    borderColor(decl(styles.th, 'border')) ??
    borderColor(decl(styles.blockquote, 'border')) ??
    mix(text, background, 0.82)

  const muted = firstSolid(hints.muted, decl(styles.figcaption, 'color')) ?? mix(text, background, 0.42)

  const quoteBg =
    firstSolid(hints.quoteBg, decl(styles.blockquote, 'background-color'), decl(styles.blockquote, 'background')) ??
    tint(accent, background, 0.94)

  const codeBg =
    firstSolid(hints.codeBg, decl(styles.codeBlock, 'background-color'), decl(styles.codeBlock, 'background'), decl(styles.pre, 'background-color'), decl(styles.code, 'background-color')) ??
    mix(background, text, 0.06)

  const codeText = firstSolid(decl(styles.pre, 'color'), decl(styles.code, 'color')) ?? text

  return { background, text, muted, heading, accent, soft: tint(accent, background, 0.76), border, quoteBg, codeBg, codeText }
}

/** 全主题里出现最多、且与背景拉开距离的饱和色，作为主色兜底。 */
function dominantColor(css: string, background: string): string | null {
  const counts = new Map<string, number>()
  for (const c of collectColors(css)) {
    const rgb = parseColor(c)
    if (!rgb) continue
    const { s, l } = hsl(rgb)
    if (s < 0.2 || l < 0.12 || l > 0.92) continue
    const hex = toHex(rgb)
    if (hex === background.toUpperCase()) continue
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  let best: string | null = null
  let bestScore = 0
  for (const [hex, n] of counts) {
    const { s } = hsl(parseColor(hex)!)
    const score = n * (0.4 + s)
    if (score > bestScore) {
      bestScore = score
      best = hex
    }
  }
  return best
}

export { saturatedHues }
