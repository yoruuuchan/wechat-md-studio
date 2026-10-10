// 主题库的公共底座：渲染原语 + 微信红线消毒 + 由「样式规格」构建 Theme。
//
// 外部主题来源的形态各不相同（纯 JSON 的扁平样式字典、逐元素 CSS 串、完整 CSS 文件），
// 但落到本项目都收敛成同一件事：给每个语义节点一段内联 CSS。所以这里只认
// ThemeStyles —— 语义节点到 CSS 文本的映射 —— 由 buildTheme 统一装配成 Theme，
// 顺带把公众号平台不接受的声明过滤掉。新增一个来源 = 写一个 importer 产出 ThemeStyles。

import type { CarouselRatio, CellAlign, InlineSeg, SignatureConfig } from './types'
import type { ThemeMeta } from './theme-meta'
import { t } from './i18n'

export type ThemeCategory = '简约' | '商务' | '杂志' | '活力'

/**
 * 主题契约：语义节点 → 内联样式 HTML。
 * 手写主题与导入主题都实现它；themes.ts 再导出，外部调用点不必改。
 */
export interface Theme {
  id: string
  name: string
  desc: string
  /** 模板专区的分组（编辑器快速切换用），浏览与筛选走 meta.styles 多标签 */
  category: ThemeCategory
  /** 供 UI 缩略图/标识使用 */
  ui: { accent: string; soft: string; ink: string }
  /** 分类维度与来源档案：风格标签、复杂度、色系、原仓库/作者/许可证/署名 */
  meta: ThemeMeta
  root(inner: string): string
  seg(s: InlineSeg): string
  paragraph(inner: string): string
  heading(num: number | null, kicker: string, title: string): string
  subheading(title: string): string
  center(inner: string): string
  quoteCard(inner: string): string
  quoteBox(paras: string[]): string
  imageBlock(src: string, caption: string): string
  carousel(title: string, caption: string, items: { src: string; alt: string }[], ratio: CarouselRatio): string
  signature(cfg: SignatureConfig): string
  listBlock(ordered: boolean, items: string[]): string
  /** 缺省时用 baseTableBlock：表格是可选风格，不是可选能力 */
  tableBlock?(head: string[], rows: string[][], align: CellAlign[]): string
  codeBlock(lang: string, code: string): string
  hr(): string
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const BLANK = '<p style="margin:0;"><span leaf="">&nbsp;</span></p>'

// ---------- 轮播画框 ----------
// 同一轮播里的图片在上传时就被裁成同一比例，所以这里可以直接给出确定宽高。
// 用 width + height + height:auto：公众号会把 width 压到可用宽度，height:auto
// 让高度跟着属性里的固有比例走，画框比例在任何宽度下都不变。
const CAROUSEL_MAX_W = 240
const CAROUSEL_MAX_H = 240

export interface CarouselFrame {
  width: number
  height: number
  cropWidth: number
  cropHeight: number
}

export function carouselFrame(ratio: CarouselRatio): CarouselFrame {
  const [rw, rh] = ratio.split(':').map(Number)
  let width = CAROUSEL_MAX_W
  let height = Math.round((width * rh) / rw)
  if (height > CAROUSEL_MAX_H) {
    height = CAROUSEL_MAX_H
    width = Math.round((height * rw) / rh)
  }
  // 按 3 倍屏取裁切尺寸，缩放后仍然清晰
  return { width, height, cropWidth: width * 3, cropHeight: height * 3 }
}

/**
 * 表格的默认样式：细线网格 + 浅底表头，配色中性，任何主题套用都不违和。
 * 公众号支持 <table>，但只吃内联样式，所以边框必须逐格写在 td/th 上——
 * 表级 border-collapse 之外，单元格不写边框就会得到无边框表格。
 */
export function baseTableBlock(
  head: string[],
  rows: string[][],
  align: CellAlign[],
  opts: { accent?: string; border?: string; headBg?: string; text?: string } = {},
): string {
  const border = opts.border ?? '#DFE4EC'
  const text = opts.text ?? '#333333'
  const headBg = opts.headBg ?? '#F5F7FA'
  const headColor = opts.accent ?? '#1F2937'
  const cellBase = `padding:8px 10px;border:1px solid ${border};font-size:13px;line-height:1.7;letter-spacing:0.5px;`
  const at = (i: number) => `text-align:${align[i] ?? 'left'};`
  const headRow = head.length
    ? `<tr>${head.map((c, i) => `<th style="${cellBase}${at(i)}background:${headBg};color:${headColor};font-weight:700;text-indent:0;">${c}</th>`).join('')}</tr>`
    : ''
  const body = rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td style="${cellBase}${at(i)}color:${text};text-indent:0;">${c}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<section style="margin:0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;table-layout:auto;"><tbody>${headRow}${body}</tbody></table></section>`
}

// ============================================================
// 微信红线消毒
// ============================================================

/**
 * 公众号编辑器会丢弃或破坏这些声明，留在内联样式里轻则无效、重则打乱版面。
 * 外部主题（尤其 Typora 系）常带 position:absolute 做装饰、float 做列表图标，
 * 必须在进 catalog 之前统一剥掉。
 */
const FORBIDDEN_VALUES: Record<string, RegExp> = {
  position: /^(fixed|absolute|sticky)$/i,
  display: /^grid$/i,
}

const FORBIDDEN_PROPS = new Set([
  'float',
  'animation',
  'animation-name',
  'transition',
  'content',
  'behavior',
  '-webkit-position',
])

/**
 * 属性名黑名单之外，任何残留的 var()/attr()/url() 都无法在公众号里求值。
 * url() 另有一层问题：data-URI SVG 内含单引号，而整段声明要写进双引号的
 * style 属性，没有任何引号方案能两全；外链背景图微信也不放行。
 */
function hasUnresolvable(value: string): boolean {
  return /var\(|attr\(|@media|@keyframes|url\(/i.test(value)
}

/**
 * 过滤一段扁平 CSS 声明文本，返回可以安全写进 style="" 的形式。
 * 双引号换成单引号：CSS 里的 font-family 常用双引号，直接进属性会截断样式。
 */
export function sanitizeStyle(css: string | undefined): string {
  if (!css) return ''
  const kept: string[] = []
  for (const raw of css.split(';')) {
    const decl = raw.trim()
    if (!decl) continue
    const sep = decl.indexOf(':')
    if (sep < 0) continue
    const prop = decl.slice(0, sep).trim().toLowerCase()
    let value = decl.slice(sep + 1).trim()
    if (!prop || !value) continue
    if (FORBIDDEN_PROPS.has(prop)) continue
    if (prop === 'position' && !FORBIDDEN_VALUES.position.test(value)) {
      // position:relative 在公众号里是保留的，可以继续用
      kept.push(`${prop}:${value}`)
      continue
    }
    if (FORBIDDEN_VALUES[prop]?.test(value)) continue
    if (hasUnresolvable(value)) continue
    value = value.replace(/!important/gi, '').trim()
    if (!value) continue
    kept.push(`${prop}:${value.replace(/"/g, "'")}`)
  }
  return kept.join(';').replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/**
 * 去掉 flex 布局声明。CSS 型来源常用 `display:flex` 在标题元素上排装饰件，
 * 微信对 h1/h2/h3 上的 flex 支持不稳；装饰改挂到内层 span 后这些声明就是死重。
 */
function noFlex(css: string): string {
  return css
    .split(';')
    .filter(
      (d) =>
        !/^\s*display\s*:\s*(inline-)?flex\s*$/i.test(d) &&
        !/^\s*(align-items|align-self|justify-content|flex|gap)\s*:/i.test(d),
    )
    .join(';')
}

/** 代码块必须逐段换行，`white-space:pre` 会把源码缩进渲染成大左缩进。 */
function forcePreWrap(css: string): string {
  const base = css
    .split(';')
    .filter((d) => !/^\s*white-space\s*:/i.test(d))
    .join(';')
  return `${base};white-space:pre-wrap;word-wrap:break-word`.replace(/^;/, '')
}

/**
 * 把 margin-top 从元素样式里摘出来，交给外层容器：
 * 标题上方还要放 kicker/序号，两者之间不该再留一个章节间距。
 * 左右与下边距原样保留，主题自己的横向留白不能被吃掉。
 */
function liftMarginTop(css: string): { top: string; rest: string } {
  let top = ''
  const parts: string[] = []
  for (const raw of css.split(';')) {
    const decl = raw.trim()
    if (!decl) continue
    const sep = decl.indexOf(':')
    const prop = decl.slice(0, sep).trim().toLowerCase()
    const value = decl.slice(sep + 1).trim()
    if (prop === 'margin-top') {
      top = value
      continue
    }
    if (prop === 'margin') {
      const [t, r, b, l] = value.split(/\s+/)
      top = t
      parts.push(`margin:0 ${r ?? t} ${b ?? t} ${l ?? r ?? t}`)
      continue
    }
    parts.push(decl)
  }
  return { top, rest: parts.join(';') }
}

function s(css: string | undefined, fallback = ''): string {
  const out = sanitizeStyle(css)
  return out || fallback
}

// ============================================================
// 规格：语义节点 → 内联 CSS
// ============================================================

/** 主题配色。缺省项由 buildTheme 从 accent 推导，importer 能给多少给多少。 */
export interface ThemePalette {
  background: string
  /** 正文文字 */
  text: string
  /** 图注、提示等次要文字 */
  muted: string
  /** 标题文字 */
  heading: string
  /** 主色 */
  accent: string
  /** 主色的浅底 / 下划线色 */
  soft: string
  /** 细线、表格边框 */
  border: string
  quoteBg: string
  codeBg: string
  codeText: string
}

export interface ThemeStyles {
  wrapper?: string
  p?: string
  /** 文章大标题（Markdown `#`） */
  h1?: string
  /** 章节标题（Markdown `##`，带自动序号） */
  h2?: string
  /** 小节标题（Markdown `###`） */
  h3?: string
  /** 更深层标题，上游有而 h3 缺时作为 h3 的兜底 */
  h4?: string
  /** 标题内层 span 的样式：CSS 型来源把签名装饰（色块、下划带）放在这里 */
  h1Span?: string
  h2Span?: string
  h3Span?: string
  blockquote?: string
  blockquoteP?: string
  /** 强调卡 / callout，用于 :::quote 与金句卡 */
  callout?: string
  calloutTitle?: string
  calloutContent?: string
  strong?: string
  em?: string
  del?: string
  mark?: string
  a?: string
  /** 行内代码 */
  code?: string
  /** 代码块外层 */
  codeBlock?: string
  /** 代码块顶栏（显示语言） */
  codeHeader?: string
  /** 代码正文 */
  pre?: string
  table?: string
  th?: string
  td?: string
  img?: string
  imgWrapper?: string
  figcaption?: string
  hr?: string
  listWrapper?: string
  listItemRow?: string
  /** 无序列表符号 */
  listBullet?: string
  /** 有序列表序号 */
  olBullet?: string
  listItemText?: string
  ul?: string
  ol?: string
  li?: string
}

export interface ImportedThemeSpec {
  id: string
  name: string
  desc: string
  category: ThemeCategory
  meta: ThemeMeta
  palette: ThemePalette
  styles: ThemeStyles
}

// ============================================================
// 共享构件
// ============================================================

interface CarouselColors {
  titleStyle: string
  hintColor: string
  captionColor: string
  placeholderBorder: string
  placeholderBg: string
}

/** 轮播骨架（各主题共用结构，换配色）：标题 + 滑动提示 + 横向滚动 + 底部说明。 */
export function makeCarousel(opts: CarouselColors) {
  return (title: string, caption: string, items: { src: string; alt: string }[], ratio: CarouselRatio): string => {
    const f = carouselFrame(ratio)
    const head = `<section style="margin:0;">${
      title ? `<p style="margin:0 0 10px;${opts.titleStyle}"><span leaf="">${esc(title)}</span></p>` : ''
    }<p style="margin:0 0 14px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:${opts.hintColor};"><span leaf="">← 左右滑动查看图片 →</span></p></section>`
    const body = `<section style="margin:0;padding:0 0 6px;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;">${items
      .map((it, i) => {
        const img = it.src
          ? `<img src="${esc(it.src)}" width="${f.width}" height="${f.height}" style="display:block;width:${f.width}px;height:auto;" />`
          : `<section style="width:${f.width}px;height:${f.height}px;box-sizing:border-box;border:1px dashed ${opts.placeholderBorder};background:${opts.placeholderBg};display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:${opts.hintColor};text-indent:0;text-align:center;"><span leaf="">${t('theme.pendingImage')}</span></p></section>`
        const cap = it.alt
          ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;letter-spacing:0.5px;text-align:center;text-indent:0;color:${opts.captionColor};"><span leaf="">${esc(it.alt)}</span></p>`
          : ''
        return `<section style="display:inline-block;vertical-align:top;width:${f.width}px;margin-right:${i === items.length - 1 ? 0 : 10}px;white-space:normal;">${img}${cap}</section>`
      })
      .join('')}</section>`
    const cap = `<p style="margin:12px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:${opts.captionColor};"><span leaf="">${esc(caption)}</span></p>`
    return head + body + cap
  }
}

/** 图片块（各主题共用结构，换配色）：图 + 图注；无 src 时只留占位段。 */
export function makeImageBlock(opts: {
  imgStyle: string
  wrapperStyle?: string
  captionColor: string
}) {
  return (src: string, caption: string): string => {
    const capStyle = `margin:8px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:${opts.captionColor};`
    if (!src) {
      return `<p style="margin:24px 0;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:${opts.captionColor};"><span leaf="">${esc(caption)}</span></p>`
    }
    const img = `<img src="${esc(src)}" style="display:block;width:100%;height:auto;${opts.imgStyle}" />`
    const figure = opts.wrapperStyle
      ? `<section style="margin:24px 0 8px;${opts.wrapperStyle}">${img}</section>`
      : `<p style="margin:24px 0 8px;text-align:center;text-indent:0;">${img}</p>`
    return `${figure}<p style="${capStyle}"><span leaf="">${esc(caption)}</span></p>`
  }
}

// ============================================================
// buildTheme：规格 → Theme
// ============================================================

/** 外部主题没有本项目自研的语义节点，这些从主题自己的配色推出来。 */
function derive(spec: ImportedThemeSpec) {
  const { palette: p, styles: st } = spec
  // 字体栈里的族名必须用单引号：这两个常量直接拼进 style="" 属性，
  // 双引号会提前闭合属性，后半段样式（含 max-width）被浏览器整段丢掉。
  const bodyFont = `font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;`
  const mono = `font-family:Menlo,Consolas,'Liberation Mono',monospace;`

  const paragraph = s(st.p, `margin:20px 0;font-size:15px;line-height:1.8;letter-spacing:0.5px;text-align:justify;color:${p.text};`)
  const h1 = s(st.h1, st.h2) || `margin:34px 0 18px;font-size:21px;line-height:1.4;font-weight:700;color:${p.heading};text-align:center;`
  const h2Raw = s(st.h2, st.h1) || `margin:36px 0 20px;font-size:19px;line-height:1.45;font-weight:700;color:${p.heading};border-left:4px solid ${p.accent};padding-left:10px;`
  const h3 = s(st.h3, st.h4) || `margin:28px 0 14px;font-size:16px;line-height:1.5;font-weight:700;color:${p.heading};`

  const quoteWrap = s(st.blockquote, st.callout) || `margin:0;padding:14px 16px;border-left:3px solid ${p.accent};background:${p.quoteBg};`
  const quoteText =
    s(st.blockquoteP, st.calloutContent) ||
    `font-size:14px;line-height:1.8;letter-spacing:0.5px;text-align:justify;text-indent:0;color:${p.text};`

  const inlineCode =
    s(st.code) || `background:${p.codeBg};color:${p.codeText};padding:2px 6px;border-radius:4px;font-size:13px;${mono}`
  const codeWrap = s(st.codeBlock) || `margin:0;padding:14px 16px;background:${p.codeBg};border-radius:8px;overflow-x:auto;`
  const codeText = forcePreWrap(s(st.pre) || `${mono}font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:${p.codeText};margin:0;`)
  const codeHeader = s(st.codeHeader)

  const strong = s(st.strong) || `font-weight:700;color:${p.accent};`
  const em = s(st.em)
  const del = s(st.del) || 'text-decoration:line-through;'
  const mark = s(st.mark) || `border-bottom:2px solid ${p.soft};font-weight:700;color:${p.heading};`
  const link = s(st.a) || `color:${p.accent};border-bottom:1px solid ${p.soft};`

  const caption = s(st.figcaption) || `margin:8px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:${p.muted};`
  const imgStyle = s(st.img).replace(/max-width:100%;?/gi, '').replace(/width:100%;?/gi, '')
  const imgWrapper = s(st.imgWrapper)

  const hrStyle = s(st.hr) || `height:1px;background:${p.border};margin:32px 0;`

  const tableStyle = s(st.table) || `width:100%;border-collapse:collapse;`
  const thStyle = s(st.th) || `padding:8px 12px;border:1px solid ${p.border};background:${p.quoteBg};color:${p.heading};font-weight:700;font-size:13px;`
  const tdStyle = s(st.td) || `padding:8px 12px;border:1px solid ${p.border};color:${p.text};font-size:13px;`

  const listRow = s(st.listItemRow)
  const listBullet = s(st.listBullet)
  const olBullet = s(st.olBullet)
  const listText = s(st.listItemText) || `font-size:15px;line-height:1.8;color:${p.text};margin:0;`
  const listWrap = s(st.listWrapper) || 'margin:20px 0;'
  const ulStyle = s(st.ul) || `margin:20px 0;padding-left:1.5em;font-size:15px;line-height:1.8;color:${p.text};`
  const olStyle = s(st.ol) || ulStyle
  const liStyle = s(st.li) || 'margin:6px 0;'

  const rootStyle = s(st.wrapper)

  const h1Span = s(st.h1Span)
  const h2Span = s(st.h2Span)
  const h3Span = s(st.h3Span)

  return {
    bodyFont,
    mono,
    paragraph,
    h1: noFlex(h1),
    h2Raw: noFlex(h2Raw),
    h3: noFlex(h3),
    h1Span,
    h2Span,
    h3Span,
    quoteWrap,
    quoteText,
    inlineCode,
    codeWrap,
    codeText,
    codeHeader,
    strong,
    em,
    del,
    mark,
    link,
    caption,
    imgStyle,
    imgWrapper,
    hrStyle,
    tableStyle,
    thStyle,
    tdStyle,
    listRow,
    listBullet,
    olBullet,
    listText,
    listWrap,
    ulStyle,
    olStyle,
    liStyle,
    rootStyle,
  }
}

/**
 * 把一份样式规格装配成 Theme。
 *
 * 上游主题都不认识本项目的自研节点（金句卡、居中强调、轮播、署名），
 * 这些一律从主题自己的配色推导，保证换主题时整篇气质一致，而不是某一块突然变默认蓝。
 */
export function buildTheme(spec: ImportedThemeSpec): Theme {
  const p = spec.palette
  const d = derive(spec)
  const { top: h2Top, rest: h2Style } = liftMarginTop(d.h2Raw)
  const headingGap = h2Top || '36px'

  const seg = (seg_: InlineSeg): string => {
    let inner = `<span leaf="">${esc(seg_.text)}</span>`
    if (seg_.code) inner = `<span style="${d.inlineCode}">${inner}</span>`
    if (seg_.italic) inner = d.em ? `<em style="${d.em}">${inner}</em>` : `<em>${inner}</em>`
    if (seg_.strike) inner = `<span style="${d.del}">${inner}</span>`
    if (seg_.link) inner = `<span style="${d.link}">${inner}</span>`
    if (seg_.bold && !seg_.mark) inner = `<strong style="${d.strong}">${inner}</strong>`
    if (seg_.mark) inner = `<span style="${d.mark}">${inner}</span>`
    return inner
  }

  const eyebrow = (label: string) =>
    `<p style="margin:0 0 8px;font-size:11px;line-height:1.4;letter-spacing:2px;font-weight:700;text-indent:0;color:${p.accent};"><span leaf="">${esc(label)}</span></p>`

  return {
    id: spec.id,
    name: spec.name,
    desc: spec.desc,
    category: spec.category,
    meta: spec.meta,
    ui: { accent: p.accent, soft: p.soft, ink: p.heading },

    root: (inner) =>
      `<section style="${/font-family/i.test(d.rootStyle) ? '' : d.bodyFont}background:${p.background};color:${p.text};line-height:1.75;${d.rootStyle};max-width:677px;margin:0 auto;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

    seg,

    paragraph: (inner) => `<p style="${d.paragraph}">${inner}</p>`,

    heading: (num, kicker, title) => {
      const spanStyle = num == null ? d.h1Span : d.h2Span
      const inner = spanStyle
        ? `<span style="${spanStyle}" leaf="">${esc(title)}</span>`
        : `<span leaf="">${esc(title)}</span>`
      if (num == null) {
        const label = kicker ? eyebrow(kicker) : ''
        return `<section style="margin:${headingGap} 0 0;">${label}<h1 style="${h2Style};margin:0;">${inner}</h1></section>`
      }
      const label = `${String(num).padStart(2, '0')}${kicker ? ' / ' + esc(kicker) : ''}`
      return `<section style="margin:${headingGap} 0 0;">${eyebrow(label)}<h2 style="${h2Style};margin:0;">${inner}</h2></section>`
    },

    subheading: (title) => {
      const inner = d.h3Span
        ? `<span style="${d.h3Span}" leaf="">${esc(title)}</span>`
        : `<span leaf="">${esc(title)}</span>`
      return `<h3 style="${d.h3}">${inner}</h3>`
    },

    center: (inner) =>
      `<p style="margin:26px 0;font-size:15px;line-height:1.8;letter-spacing:1px;text-align:center;text-indent:0;font-weight:700;color:${p.accent};"><span style="border-bottom:2px solid ${p.soft};">${inner}</span></p>`,

    quoteCard: (inner) =>
      `<section style="${d.quoteWrap}"><p style="margin:0;font-size:16px;line-height:1.8;letter-spacing:1px;text-align:center;text-indent:0;font-weight:700;color:${p.heading};"><span style="border-bottom:2px solid ${p.soft};">${inner}</span></p></section>`,

    quoteBox: (paras) =>
      `<section style="${d.quoteWrap}">${paras
        .map((para, i) => `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};${d.quoteText}">${para}</p>`)
        .join('')}</section>`,

    imageBlock: makeImageBlock({ imgStyle: d.imgStyle, wrapperStyle: d.imgWrapper, captionColor: p.muted }),

    carousel: makeCarousel({
      titleStyle: `font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:${p.accent};font-weight:700;`,
      hintColor: p.muted,
      captionColor: p.muted,
      placeholderBorder: p.soft,
      placeholderBg: p.quoteBg,
    }),

    signature: (cfg: SignatureConfig) =>
      `<section style="margin:36px 0 0;padding:16px 0 0;border-top:1px solid ${p.border};text-align:center;"><p style="margin:0 0 6px;font-size:13px;line-height:1.75;letter-spacing:1px;text-indent:0;color:${p.muted};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:0;font-size:10px;letter-spacing:2px;text-indent:0;color:${p.soft};"><span leaf="">THE END</span></p></section>`,

    listBlock: (ordered, items) => {
      // 上游给了自定义符号（xiaohu 系主题普遍给）就用它的行结构，否则退回标准列表
      if (ordered && d.olBullet) {
        return `<section style="${d.listWrap}">${items
          .map(
            (it, i) =>
              `<section style="${d.listRow || 'display:flex;align-items:flex-start;margin-bottom:10px;'}"><span style="${d.olBullet}"><span leaf="">${i + 1}</span></span><p style="${d.listText};flex:1;">${it}</p></section>`,
          )
          .join('')}</section>`
      }
      if (!ordered && d.listBullet) {
        return `<section style="${d.listWrap}">${items
          .map(
            (it) =>
              `<section style="${d.listRow || 'display:flex;align-items:flex-start;margin-bottom:10px;'}"><span style="${d.listBullet}"><span leaf="">•</span></span><p style="${d.listText};flex:1;">${it}</p></section>`,
          )
          .join('')}</section>`
      }
      const tag = ordered ? 'ol' : 'ul'
      return `<${tag} style="${ordered ? d.olStyle : d.ulStyle}">${items
        .map((it) => `<li style="${d.liStyle}">${it}</li>`)
        .join('')}</${tag}>`
    },

    tableBlock: (head, rows, align) => {
      // 表格是布局元素：上游只写 max-width + auto 外边距时会缩成内容宽，补满栏宽
      const tableStyle = /(^|;)\s*width\s*:/i.test(d.tableStyle) ? d.tableStyle : `width:100%;${d.tableStyle}`
      const at = (i: number) => `text-align:${align[i] ?? 'left'};`
      const headRow = head.length
        ? `<tr>${head.map((c, i) => `<th style="${d.thStyle};${at(i)}text-indent:0;">${c}</th>`).join('')}</tr>`
        : ''
      const body = rows
        .map((r) => `<tr>${r.map((c, i) => `<td style="${d.tdStyle};${at(i)}text-indent:0;">${c}</td>`).join('')}</tr>`)
        .join('')
      return `<section style="margin:24px 0;overflow-x:auto;"><table style="${tableStyle}"><tbody>${headRow}${body}</tbody></table></section>`
    },

    codeBlock: (lang, code) => {
      const header =
        d.codeHeader && lang
          ? `<section style="${d.codeHeader}"><p style="margin:0;font-size:11px;letter-spacing:1px;text-indent:0;color:${p.muted};"><span leaf="">${esc(lang.toUpperCase())}</span></p></section>`
          : ''
      return `<section style="${d.codeWrap}">${header}<p style="${d.codeText}"><span leaf="">${esc(code)}</span></p></section>`
    },

    hr: () => `<section style="${d.hrStyle}"><span leaf=""><br></span></section>`,
  }
}
