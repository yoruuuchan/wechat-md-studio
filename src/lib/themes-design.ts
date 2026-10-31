// 三套从 Yoru 的设计系统移植来的手写主题：
//   yoru-type        YORU Content · 冷纸铅印
//   paper-editorial  PAPER · 编辑部印刷（只做 Editorial 浅色纸）
//   console-akari    yoru·akari Console · 瓷白内凹（只做 akari 浅色）
//
// 不是把设计系统的 CSS 搬进来：公众号只吃内联样式，还要守住
// class/id/div/style 标签、CSS 变量、position/float/grid/@media 这些红线。
// 因此每套主题按上游的「结构」重写：线条、编号、强调手段、承载块的质感，
// 颜色与字号从上游 tokens 换算到 677px 文章栏宽。正文不指定网页字体——
// 微信读者端只能用手机自带字体；标题写字体栈，缺字体时按栈回落。
//
// 上游仓库：https://github.com/yoruuuchan/yoru-design-systems（MIT）

import { baseTableBlock, carouselStrip, esc, type Theme } from './theme-kit'
import type { FootnoteItem, ThemeExtensions } from './theme-fallbacks'
import type { CarouselRatio, InlineSeg } from './types'
import { t } from './i18n'
import type { ThemeMeta } from './theme-meta'

// 字体栈里的族名一律单引号：它们要拼进 style="…"，双引号会截断属性。
const SERIF = "'Noto Serif SC','Source Han Serif SC','Songti SC','STSong',serif"
const FANGSONG = "'FangSong','STFangsong','Noto Serif SC','Songti SC',serif"
const SANS = "'Geist','Inter','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const PAPER_SANS = "'IBM Plex Sans','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const MONO = "Menlo,Consolas,'Liberation Mono',monospace"

const SLIDE_HINT = '← 左右滑动查看图片 →'
const END_MARK = '· 完 ·'

// ============================================================
// 来源档案
// ============================================================

const YORU_ORIGIN = {
  kind: 'ported' as const,
  project: 'yoru-design-systems',
  author: 'Yoru',
  repo: 'https://github.com/yoruuuchan/yoru-design-systems',
  license: 'MIT' as const,
  licenseFile: 'LICENSES/yoru-design-systems-LICENSE.txt',
}

function designMeta(
  system: string,
  upstream: string,
  adapted: string,
  meta: Omit<ThemeMeta, 'origin'>,
): ThemeMeta {
  return {
    ...meta,
    origin: {
      ...YORU_ORIGIN,
      upstream,
      adapted,
      attribution: `主题移植自 Yoru 的 yoru-design-systems（${system}），Copyright (c) 2026 Yoru，依据 MIT 许可使用并修改。`,
    },
  }
}

// ============================================================
// 共享构件：图号、网格、脚注
// ============================================================

/** 把渲染器给的「图1 说明」拆成图号与说明，图号单独着色。 */
function figureCaption(caption: string, numStyle: string, restStyle: string): string {
  const match = caption.match(/^(图\d+)(\s*)([\s\S]*)$/)
  if (!match) return `<span leaf="">${esc(caption)}</span>`
  return `<span leaf=""><span style="${numStyle}">${esc(match[1])}</span><span style="${restStyle}">${esc(match[2] + match[3])}</span></span>`
}

/**
 * 没有 src 的占位说明保持「<p><span leaf="">图N …</span></p>」的简单形态：
 * verify:themes 用这个形状确认空图位仍然生成可读的占位段，嵌套着色会破坏契约。
 */
function plainCaption(caption: string): string {
  return `<span leaf="">${esc(caption)}</span>`
}

const GALLERY_GAP = 2

interface GalleryStyle {
  marginTop: string
  titleStyle: string
  captionStyle: string
  numStyle: string
  restStyle: string
  cellCaptionStyle: string
  placeholderBorder: string
  placeholderBg: string
  hintColor: string
  imgStyle: string
}

/**
 * 多图网格。结构与主题无关的那部分必须和默认实现一致：百分比宽度、
 * inline-block、不用 grid/float/object-fit，图片 width:100%;height:auto。
 * 这里只换颜色、字体、边框与留白，让设计系统的线条和色板延伸进图组。
 */
function galleryBlock(style: GalleryStyle) {
  return (
    title: string,
    caption: string,
    items: { src: string; alt: string }[],
    ratio: CarouselRatio,
    cols: number,
  ): string => {
    const columns = Math.max(1, cols)
    const cellW = Math.floor(((100 - GALLERY_GAP * (columns - 1)) / columns) * 1000) / 1000
    const [rw, rh] = ratio.split(':').map(Number)
    // 占位框按百分比内边距撑出画框比例，和轮播占位同一套办法：不写固定像素高度，
    // 375px 手机与 677px 编辑器里都不会被拉成竖长条。
    const placeholderPad = ((rh / rw) * 50).toFixed(3)
    const lastRowStart = Math.floor((items.length - 1) / columns) * columns

    const head = title
      ? `<p style="margin:0 0 12px;${style.titleStyle}"><span leaf="">${esc(title)}</span></p>`
      : ''

    const cells = items
      .map((it, i) => {
        const cellStyle = [
          `width:${cellW}%`,
          'display:inline-block',
          'vertical-align:top',
          'box-sizing:border-box',
          (i + 1) % columns === 0 ? '' : `margin-right:${GALLERY_GAP}%`,
          i >= lastRowStart ? '' : `margin-bottom:${GALLERY_GAP}%`,
        ]
          .filter(Boolean)
          .join(';')
        const body = it.src
          ? `<img src="${esc(it.src)}" width="${rw * 100}" height="${rh * 100}" style="display:block;width:100%;max-width:100%;height:auto;${style.imgStyle}" />`
          : `<p style="margin:0;padding:${placeholderPad}% 0;box-sizing:border-box;border:1px solid ${style.placeholderBorder};background:${style.placeholderBg};font-size:12px;line-height:1.5;letter-spacing:.08em;color:${style.hintColor};text-indent:0;text-align:center;"><span leaf="">${t('theme.pendingImage')}</span></p>`
        const cap = it.alt
          ? `<p style="margin:6px 0 0;${style.cellCaptionStyle}"><span leaf="">${esc(it.alt)}</span></p>`
          : ''
        return `<section style="${cellStyle}">${body}${cap}</section>`
      })
      .join('')

    const rawCaption = items.every((it) => !it.src)
      ? plainCaption(caption)
      : figureCaption(caption, style.numStyle, style.restStyle)
    return `<section style="margin:${style.marginTop} 20px 0;">${head}<section style="margin:0;">${cells}</section></section><p style="margin:12px 20px 28px;${style.captionStyle}">${rawCaption}</p>`
  }
}

interface FootnoteStyle {
  rule: string
  labelStyle: string
  rowStyle: string
}

/** 文末参考列表：沿用现有渲染契约，只把线、标签与字号换成主题语言。 */
function footnotesBlock(style: FootnoteStyle) {
  return (items: FootnoteItem[]): string => {
    const rows = items
      .map(
        (f) =>
          `<p style="margin:6px 20px 0;${style.rowStyle}"><span leaf="">${f.index}. ${esc(f.url)}</span></p>`,
      )
      .join('')
    return `<section style="margin:0;padding-top:16px;border-top:${style.rule};"><p style="margin:0 20px 8px;${style.labelStyle}"><span leaf="">${t('render.refsHeading')}</span></p>${rows}</section>`
  }
}

// ============================================================
// 铅字房 · YORU Content（Signal）
// ============================================================

const YORU_INK_1 = '#1B2127'
const YORU_INK_2 = '#2C3440'
const YORU_INK_3 = '#4A5566'
const YORU_INK_4 = '#7B8798'
const YORU_INK_5 = '#A9B4C4'
const YORU_LINE_1 = '#DEE5E8'
const YORU_LINE_2 = '#B4C0C4'
const YORU_ACCENT = '#3186FF'
const YORU_ACCENT_INK = '#1B5FC7'
const YORU_ACCENT_SOFT = '#D0E8FF'
const YORU_PAPER = '#F2F5F5'

function yoruSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${MONO};font-size:13px;line-height:1.6;background:#FFFFFF;border:1px solid ${YORU_LINE_1};padding:1px 5px;border-radius:2px;color:${YORU_INK_1};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${YORU_INK_4};">${inner}</span>`
  if (s.link) inner = `<span style="color:${YORU_ACCENT_INK};border-bottom:1px solid #A9C2FF;">${inner}</span>`
  if (s.bold && !s.mark) {
    inner = `<strong style="font-weight:700;color:${YORU_INK_1};-webkit-text-emphasis:filled dot ${YORU_ACCENT};text-emphasis:filled dot ${YORU_ACCENT};-webkit-text-emphasis-position:under right;text-emphasis-position:under right;">${inner}</strong>`
  }
  if (s.mark) {
    inner = `<span style="font-weight:500;color:${YORU_INK_1};background:linear-gradient(180deg,transparent 58%,${YORU_ACCENT_SOFT} 58%,${YORU_ACCENT_SOFT} 100%);padding:0 .08em;">${inner}</span>`
  }
  return inner
}

const YORU_GALLERY = galleryBlock({
  marginTop: '30px',
  titleStyle: `font-family:${SERIF};font-size:15px;line-height:1.75;letter-spacing:.02em;text-align:center;text-indent:0;color:${YORU_INK_1};font-weight:700;`,
  captionStyle: `font-size:13px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${YORU_INK_3};`,
  numStyle: `font-family:${MONO};font-size:12px;color:${YORU_ACCENT};letter-spacing:.08em;`,
  restStyle: 'letter-spacing:.04em;',
  cellCaptionStyle: `font-size:12px;line-height:1.5;letter-spacing:.04em;text-align:center;text-indent:0;color:${YORU_INK_4};`,
  placeholderBorder: YORU_LINE_2,
  placeholderBg: '#FFFFFF',
  hintColor: YORU_INK_3,
  imgStyle: `border:1px solid ${YORU_LINE_2};border-radius:2px;`,
})

const YORU_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${YORU_LINE_1}`,
  labelStyle: `font-family:${MONO};font-size:11px;line-height:1.5;letter-spacing:.14em;color:${YORU_ACCENT_INK};text-indent:0;`,
  rowStyle: `font-family:${MONO};font-size:11px;line-height:1.7;letter-spacing:0;color:${YORU_INK_3};text-align:left;text-indent:0;word-break:break-all;`,
})

export const yoruTypeTheme: Theme & ThemeExtensions = {
  id: 'yoru-type',
  name: '铅字房',
  desc: 'YORU Content · 冷纸铅印',
  category: '杂志',
  ui: { accent: YORU_ACCENT, soft: YORU_ACCENT_SOFT, ink: YORU_INK_1 },
  meta: designMeta(
    'YORU Content Design System',
    'YORU Content Design System/',
    '取冷纸、报头墨线、等宽章节号、着重号、荧光笔、上下线引用与深色内凹代码块，改写成公众号内联样式；去掉月相报头、直排书脊等正文里无法复现的页面家具。',
    { styles: ['杂志', '科技'], complexity: 2, color: '冷色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:${YORU_PAPER};color:${YORU_INK_2};line-height:1.72;letter-spacing:.01em;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: yoruSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 24px;font-size:16px;line-height:1.72;letter-spacing:.01em;text-align:justify;text-indent:0;color:${YORU_INK_2};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 10px;font-family:${MONO};font-size:11px;line-height:1.5;letter-spacing:.14em;color:${YORU_ACCENT_INK};font-weight:500;text-indent:0;"><span leaf="">${esc(kicker)}</span></p>`
        : ''
      return `<section style="margin:0 20px 30px;border-top:3px solid ${YORU_INK_1};padding-top:16px;">${label}<h1 style="margin:0;font-family:${SERIF};font-size:28px;line-height:1.3;letter-spacing:0;font-weight:900;color:${YORU_INK_1};"><span leaf="">${esc(title)}</span></h1></section>`
    }
    const numText = String(num).padStart(2, '0')
    const label = `<p style="margin:0 0 10px;font-family:${MONO};font-size:11px;line-height:1.5;letter-spacing:.14em;font-weight:500;text-indent:0;"><span leaf=""><span style="color:${YORU_ACCENT};font-weight:700;">${numText}</span>${kicker ? `<span style="color:${YORU_INK_4};"> / ${esc(kicker)}</span>` : ''}</span></p>`
    // 无 H1 的稿件（例如主题预览稿）从第一章开始，也在第一章上方留一条墨线。
    const rule = num === 1 ? `border-top:3px solid ${YORU_INK_1};padding-top:16px;` : ''
    return `<section style="margin:44px 20px 22px;${rule}">${label}<h2 style="margin:0;font-family:${SERIF};font-size:22px;line-height:1.35;letter-spacing:0;font-weight:700;color:${YORU_INK_1};"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:34px 20px 14px;font-family:${SERIF};font-size:18px;line-height:1.5;letter-spacing:0;font-weight:700;color:${YORU_INK_1};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:26px 20px;font-family:${SERIF};font-size:16px;line-height:1.8;letter-spacing:.02em;text-align:center;text-indent:0;color:${YORU_INK_1};">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;padding:18px 0;border-top:1px solid ${YORU_INK_1};border-bottom:1px solid ${YORU_INK_1};"><p style="margin:0;font-family:${FANGSONG};font-size:17px;line-height:1.85;letter-spacing:.01em;text-align:center;text-indent:0;color:${YORU_INK_2};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;padding:18px 0;border-top:1px solid ${YORU_INK_1};border-bottom:1px solid ${YORU_INK_1};">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-family:${FANGSONG};font-size:15px;line-height:1.85;letter-spacing:.01em;text-align:justify;text-indent:0;color:${YORU_INK_2};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    const capStyle = `margin:0 20px 30px;font-size:13px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${YORU_INK_3};`
    const cap = `<p style="${capStyle}">${figureCaption(caption, `font-family:${MONO};font-size:12px;color:${YORU_ACCENT};letter-spacing:.08em;`, 'letter-spacing:.04em;')}</p>`
    if (!src) return `<p style="margin:26px 20px;font-size:13px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${YORU_INK_3};">${plainCaption(caption)}</p>`
    return `<p style="margin:30px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid ${YORU_LINE_2};border-radius:2px;box-shadow:0 1px 2px rgba(17,24,39,.05),0 8px 24px rgba(17,24,39,.07);" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-family:${SERIF};font-size:15px;line-height:1.75;letter-spacing:.02em;text-align:center;text-indent:0;color:${YORU_INK_1};font-weight:700;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-size:12px;line-height:1.6;letter-spacing:.08em;text-align:center;text-indent:0;color:${YORU_INK_4};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${YORU_LINE_2};border-radius:2px;`,
      placeholderBorder: YORU_LINE_2,
      placeholderBg: '#FFFFFF',
      hintColor: YORU_INK_3,
      captionColor: YORU_INK_3,
    })
    const cap = `<p style="margin:12px 20px 30px;font-size:13px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${YORU_INK_3};">${items.every((it) => !it.src) ? plainCaption(caption) : figureCaption(caption, `font-family:${MONO};font-size:12px;color:${YORU_ACCENT};letter-spacing:.08em;`, 'letter-spacing:.04em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:16px;border-top:1px solid ${YORU_LINE_1};text-align:center;"><p style="margin:0;font-family:${FANGSONG};font-size:13px;line-height:1.75;letter-spacing:.04em;text-indent:0;color:${YORU_INK_3};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:8px 0 0;font-size:10px;line-height:1.5;letter-spacing:.24em;text-indent:0;color:${YORU_INK_5};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:16px;line-height:1.72;letter-spacing:.01em;color:${YORU_INK_2};">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:24px 20px;">${baseTableBlock(head, rows, align, {
      accent: YORU_INK_1,
      border: YORU_LINE_1,
      headBg: '#FFFFFF',
      text: YORU_INK_2,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:16px 18px;background:#20293C;border-radius:2px;box-shadow:inset 2px 2px 5px rgba(0,0,0,.42),inset -2px -2px 5px rgba(255,255,255,.05);overflow-x:hidden;"><p style="margin:0;font-family:${MONO};font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#E8EAF0;white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:40px 20px;border-top:1px solid ${YORU_INK_1};"><span leaf=""><br></span></section>`,

  footnoteRef: (index) =>
    `<span style="font-size:11px;line-height:1;color:${YORU_ACCENT_INK};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: YORU_FOOTNOTES,

  gallery: YORU_GALLERY,
}

// ============================================================
// 纸本 · PAPER（Editorial）
// ============================================================

const PAPER_PAGE = '#F4F1EA'
const PAPER_RAISED = '#FCFBF8'
const PAPER_INK = '#26241E'
const PAPER_INK_DEEP = '#15140F'
const PAPER_MUTED = '#847D6E'
const PAPER_FAINT = '#B3AB9A'
const PAPER_RULE_HAIR = '#D6CFBF'
const PAPER_RUST = '#B8543A'
const PAPER_FRAME = 'rgba(38,36,30,.14)'

/** 3px + 1px 的双线：文章大标题与分隔线共用。 */
function paperDoubleRule(margin: string): string {
  return `<section style="margin:${margin};border-top:3px solid ${PAPER_INK};padding-top:1px;"><p style="margin:0;border-top:1px solid ${PAPER_INK};font-size:0;line-height:0;"><span leaf=""><br></span></p></section>`
}

function paperSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${MONO};font-size:13px;line-height:1.6;background:${PAPER_RAISED};border:1px solid ${PAPER_RULE_HAIR};padding:1px 5px;border-radius:0;color:${PAPER_INK};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${PAPER_MUTED};">${inner}</span>`
  if (s.link) inner = `<span style="color:${PAPER_INK};border-bottom:1px solid ${PAPER_FAINT};">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="font-weight:600;color:${PAPER_INK_DEEP};">${inner}</strong>`
  if (s.mark) {
    inner = `<span style="font-weight:500;color:${PAPER_INK_DEEP};background:linear-gradient(180deg,transparent 58%,#E3D9C5 58%);padding:0 .06em;">${inner}</span>`
  }
  return inner
}

const PAPER_GALLERY = galleryBlock({
  marginTop: '32px',
  titleStyle: `font-family:${SERIF};font-size:16px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${PAPER_INK_DEEP};font-weight:600;`,
  captionStyle: `font-family:${PAPER_SANS};font-size:12px;line-height:1.55;letter-spacing:.14em;text-align:left;text-indent:0;color:${PAPER_MUTED};`,
  numStyle: `font-family:${MONO};font-size:12px;color:${PAPER_RUST};letter-spacing:.06em;`,
  restStyle: 'letter-spacing:.14em;',
  cellCaptionStyle: `font-family:${PAPER_SANS};font-size:12px;line-height:1.5;letter-spacing:.14em;text-align:left;text-indent:0;color:${PAPER_MUTED};`,
  placeholderBorder: PAPER_RULE_HAIR,
  placeholderBg: PAPER_RAISED,
  hintColor: PAPER_MUTED,
  imgStyle: `border:1px solid ${PAPER_FRAME};border-radius:0;`,
})

const PAPER_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${PAPER_RULE_HAIR}`,
  labelStyle: `font-family:${PAPER_SANS};font-size:11px;line-height:1.5;letter-spacing:.14em;color:${PAPER_MUTED};text-indent:0;`,
  rowStyle: `font-family:${PAPER_SANS};font-size:12px;line-height:1.6;letter-spacing:.02em;color:${PAPER_MUTED};text-align:left;text-indent:0;word-break:break-all;`,
})

export const paperEditorialTheme: Theme & ThemeExtensions = {
  id: 'paper-editorial',
  name: '纸本',
  desc: 'PAPER · 编辑部印刷',
  category: '杂志',
  ui: { accent: PAPER_RUST, soft: '#F1DCD2', ink: PAPER_INK_DEEP },
  meta: designMeta(
    'PAPER Design System',
    'PAPER Design System/',
    '只取 Editorial 浅色纸：零圆角、三档横线、首段后缩进不空行、直角描边图片与小字加宽图注；铁锈红只留章节数字与图号，省略胶片、胶带、颗粒与 Analog 倾斜。',
    { styles: ['杂志', '文艺复古'], complexity: 2, color: '暖色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:${PAPER_PAGE};color:${PAPER_INK};line-height:1.68;letter-spacing:0;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: paperSeg,

  paragraph: (inner, opts) => {
    const indent = opts?.first === false ? 'text-indent:2em;' : 'text-indent:0;'
    return `<p style="margin:0 20px;font-size:17px;line-height:1.68;letter-spacing:0;text-align:justify;${indent}color:${PAPER_INK};">${inner}</p>`
  },

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 10px;font-family:${PAPER_SANS};font-size:11px;line-height:1.5;letter-spacing:.14em;color:${PAPER_MUTED};text-indent:0;"><span leaf="">${esc(kicker)}</span></p>`
        : ''
      return `<section style="margin:0 20px 30px;">${paperDoubleRule('0 0 18px')}${label}<h1 style="margin:0;font-family:${SERIF};font-size:30px;line-height:1.16;letter-spacing:-.012em;font-weight:600;color:${PAPER_INK_DEEP};"><span leaf="">${esc(title)}</span></h1></section>`
    }
    const numText = String(num).padStart(2, '0')
    const label = `<p style="margin:0 0 10px;font-family:${MONO};font-size:11px;line-height:1.5;letter-spacing:.14em;font-weight:500;text-indent:0;"><span leaf=""><span style="color:${PAPER_RUST};">${numText}</span>${kicker ? `<span style="color:${PAPER_MUTED};"> / ${esc(kicker)}</span>` : ''}</span></p>`
    return `<section style="margin:44px 20px 20px;border-top:1px solid ${PAPER_INK};padding-top:16px;">${label}<h2 style="margin:0;font-family:${SERIF};font-size:22px;line-height:1.3;letter-spacing:-.012em;font-weight:600;color:${PAPER_INK_DEEP};"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 12px;padding-bottom:8px;border-bottom:1px solid ${PAPER_RULE_HAIR};font-family:${SERIF};font-size:16px;line-height:1.5;letter-spacing:0;font-weight:600;color:${PAPER_INK_DEEP};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:28px 20px;font-family:${SERIF};font-size:17px;line-height:1.55;letter-spacing:0;text-align:center;text-indent:0;color:${PAPER_INK_DEEP};">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;padding:22px 0;border-top:1px solid ${PAPER_INK};border-bottom:1px solid ${PAPER_INK};"><p style="margin:0;font-family:${SERIF};font-size:19px;line-height:1.55;letter-spacing:0;text-align:center;text-indent:0;color:${PAPER_INK_DEEP};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;padding:22px 0;border-top:1px solid ${PAPER_INK};border-bottom:1px solid ${PAPER_INK};">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '12px 0 0'};font-family:${SERIF};font-size:17px;line-height:1.68;letter-spacing:0;text-align:justify;text-indent:0;color:${PAPER_INK};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    const capStyle = `margin:0 20px 32px;font-family:${PAPER_SANS};font-size:12px;line-height:1.55;letter-spacing:.14em;text-align:left;text-indent:0;color:${PAPER_MUTED};`
    const cap = `<p style="${capStyle}">${figureCaption(caption, `font-family:${MONO};font-size:12px;color:${PAPER_RUST};letter-spacing:.06em;`, 'letter-spacing:.14em;')}</p>`
    if (!src) return `<p style="margin:26px 20px;font-family:${PAPER_SANS};font-size:12px;line-height:1.55;letter-spacing:.14em;text-align:left;text-indent:0;color:${PAPER_MUTED};">${plainCaption(caption)}</p>`
    return `<p style="margin:32px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid ${PAPER_FRAME};border-radius:0;" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-family:${SERIF};font-size:16px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${PAPER_INK_DEEP};font-weight:600;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-family:${PAPER_SANS};font-size:12px;line-height:1.5;letter-spacing:.14em;text-align:left;text-indent:0;color:${PAPER_MUTED};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${PAPER_FRAME};border-radius:0;`,
      placeholderBorder: PAPER_RULE_HAIR,
      placeholderBg: PAPER_RAISED,
      hintColor: PAPER_MUTED,
      captionColor: PAPER_MUTED,
    })
    const cap = `<p style="margin:12px 20px 32px;font-family:${PAPER_SANS};font-size:12px;line-height:1.55;letter-spacing:.14em;text-align:left;text-indent:0;color:${PAPER_MUTED};">${items.every((it) => !it.src) ? plainCaption(caption) : figureCaption(caption, `font-family:${MONO};font-size:12px;color:${PAPER_RUST};letter-spacing:.06em;`, 'letter-spacing:.14em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:16px;border-top:1px solid ${PAPER_INK};"><p style="margin:0 0 6px;font-family:${PAPER_SANS};font-size:12px;line-height:1.6;letter-spacing:.14em;text-indent:0;color:${PAPER_MUTED};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:0;font-family:${PAPER_SANS};font-size:10px;line-height:1.5;letter-spacing:.22em;text-indent:0;color:${PAPER_FAINT};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:17px;line-height:1.68;letter-spacing:0;color:${PAPER_INK};">${items
      .map((it) => `<li style="margin:4px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:28px 20px;">${baseTableBlock(head, rows, align, {
      accent: PAPER_INK_DEEP,
      border: PAPER_RULE_HAIR,
      headBg: PAPER_RAISED,
      text: PAPER_INK,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:16px 18px;background:#EDE6D7;border-top:1px solid ${PAPER_INK};border-bottom:1px solid ${PAPER_INK};border-radius:0;overflow-x:hidden;"><p style="margin:0;font-family:${MONO};font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:${PAPER_INK};white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () => paperDoubleRule('44px 20px'),

  footnoteRef: (index) =>
    `<span style="font-size:11px;line-height:1;color:${PAPER_INK};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: PAPER_FOOTNOTES,

  gallery: PAPER_GALLERY,
}

// ============================================================
// 灯 · yoru-and-akari Console（akari）
// ============================================================

const CONSOLE_PAGE = '#FFFFFF'
const CONSOLE_PORCELAIN = '#E8ECF3'
const CONSOLE_SURFACE = '#EFF2F8'
const CONSOLE_INK = '#0E1525'
const CONSOLE_INK_2 = '#394560'
const CONSOLE_INK_3 = '#6B7793'
const CONSOLE_LINE = '#E1E6EF'
const CONSOLE_PRIMARY = '#4F6CE8'
const CONSOLE_PRIMARY_SOFT = '#DCE3FE'
const CONSOLE_PILL_BG = '#EEF2FF'
/** 新拟态内凹：瓷白底 + 带色双阴影，圆角 16。 */
const CONSOLE_INSET =
  `background:${CONSOLE_PORCELAIN};border-radius:16px;box-shadow:inset 3px 3px 6px rgba(143,158,191,.28),inset -3px -3px 6px rgba(255,255,255,.95);`

function consoleSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${MONO};font-size:13px;line-height:1.6;background:${CONSOLE_SURFACE};padding:1px 5px;border-radius:6px;color:${CONSOLE_INK_2};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${CONSOLE_INK_3};">${inner}</span>`
  if (s.link) inner = `<span style="color:${CONSOLE_PRIMARY};border-bottom:1px solid #B9C6FD;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="font-weight:600;color:${CONSOLE_INK};">${inner}</strong>`
  if (s.mark) {
    inner = `<span style="font-weight:500;color:${CONSOLE_INK};background:linear-gradient(180deg,transparent 58%,${CONSOLE_PRIMARY_SOFT} 58%);padding:0 .06em;">${inner}</span>`
  }
  return inner
}

const CONSOLE_GALLERY = galleryBlock({
  marginTop: '28px',
  titleStyle: `font-family:${SANS};font-size:15px;line-height:1.6;letter-spacing:-.012em;text-align:left;text-indent:0;color:${CONSOLE_INK};font-weight:500;`,
  captionStyle: `font-family:${SANS};font-size:12px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${CONSOLE_INK_3};`,
  numStyle: `font-family:${MONO};font-size:12px;color:${CONSOLE_PRIMARY};letter-spacing:.04em;`,
  restStyle: 'letter-spacing:.04em;',
  cellCaptionStyle: `font-family:${SANS};font-size:12px;line-height:1.5;letter-spacing:.04em;text-align:center;text-indent:0;color:${CONSOLE_INK_3};`,
  placeholderBorder: '#B9C6FD',
  placeholderBg: '#F6F8FC',
  hintColor: CONSOLE_INK_3,
  imgStyle: `border:1px solid ${CONSOLE_LINE};border-radius:12px;`,
})

const CONSOLE_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${CONSOLE_LINE}`,
  labelStyle: `font-family:${SANS};font-size:11px;line-height:1.5;letter-spacing:.08em;color:${CONSOLE_INK_3};text-indent:0;`,
  rowStyle: `font-family:${SANS};font-size:12px;line-height:1.6;letter-spacing:0;color:${CONSOLE_INK_3};text-align:left;text-indent:0;word-break:break-all;`,
})

export const consoleAkariTheme: Theme & ThemeExtensions = {
  id: 'console-akari',
  name: '灯',
  desc: 'yoru·akari Console · 瓷白内凹',
  category: '简约',
  ui: { accent: CONSOLE_PRIMARY, soft: CONSOLE_PRIMARY_SOFT, ink: CONSOLE_INK },
  meta: designMeta(
    'yoru-and-akari Console Design System',
    'yoru-and-akari Console Design System/',
    '只取 akari 浅色：白纸页面、瓷白内凹的引用与代码承载块、胶囊章节号、主色与内凹阴影；页面不做径向光，不用彩色左边条，标题统一 -0.012em 字距，深色与玻璃留给界面本身。',
    { styles: ['科技', '商务'], complexity: 2, color: '冷色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:${CONSOLE_PAGE};color:${CONSOLE_INK_2};line-height:1.8;letter-spacing:0;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: consoleSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 20px;font-size:15px;line-height:1.8;letter-spacing:0;text-align:justify;text-indent:0;color:${CONSOLE_INK_2};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 10px;font-size:11px;line-height:1.5;letter-spacing:.08em;color:${CONSOLE_INK_3};text-indent:0;"><span leaf="">${esc(kicker)}</span></p>`
        : ''
      return `<section style="margin:32px 20px 28px;">${label}<h1 style="margin:0;font-family:${SANS};font-size:28px;line-height:1.2;letter-spacing:-.012em;font-weight:600;color:${CONSOLE_INK};"><span leaf="">${esc(title)}</span></h1></section>`
    }
    const numText = String(num).padStart(2, '0')
    const pill = `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${CONSOLE_PILL_BG};color:${CONSOLE_PRIMARY};font-family:${MONO};font-size:11px;line-height:1.6;letter-spacing:.04em;font-weight:500;"><span leaf="">${numText}</span></span>`
    const label = kicker
      ? `<span style="display:inline-block;margin-left:8px;font-size:11px;line-height:1.6;letter-spacing:.04em;color:${CONSOLE_INK_3};"><span leaf="">${esc(kicker)}</span></span>`
      : ''
    return `<section style="margin:44px 20px 20px;"><p style="margin:0 0 10px;text-indent:0;">${pill}${label}</p><h2 style="margin:0;font-family:${SANS};font-size:19px;line-height:1.35;letter-spacing:-.012em;font-weight:600;color:${CONSOLE_INK};"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 12px;padding-bottom:8px;border-bottom:1px solid ${CONSOLE_LINE};font-family:${SANS};font-size:16px;line-height:1.35;letter-spacing:-.012em;font-weight:600;color:${CONSOLE_INK};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:24px 20px;font-size:15px;line-height:1.8;letter-spacing:0;text-align:center;text-indent:0;color:${CONSOLE_PRIMARY};font-weight:500;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;padding:18px 20px;${CONSOLE_INSET}"><p style="margin:0;font-size:15px;line-height:1.8;letter-spacing:0;text-align:center;text-indent:0;color:${CONSOLE_INK};font-weight:500;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;padding:18px 20px;${CONSOLE_INSET}">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-size:14px;line-height:1.8;letter-spacing:0;text-align:justify;text-indent:0;color:${CONSOLE_INK_2};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    const capStyle = `margin:0 20px 28px;font-size:12px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${CONSOLE_INK_3};`
    const cap = `<p style="${capStyle}">${figureCaption(caption, `font-family:${MONO};font-size:12px;color:${CONSOLE_PRIMARY};letter-spacing:.04em;`, 'letter-spacing:.04em;')}</p>`
    if (!src) return `<p style="margin:24px 20px;font-size:12px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${CONSOLE_INK_3};">${plainCaption(caption)}</p>`
    return `<p style="margin:28px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid ${CONSOLE_LINE};border-radius:12px;" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-size:15px;line-height:1.6;letter-spacing:-.012em;text-align:left;text-indent:0;color:${CONSOLE_INK};font-weight:500;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-size:12px;line-height:1.5;letter-spacing:.04em;text-align:center;text-indent:0;color:${CONSOLE_INK_3};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${CONSOLE_LINE};border-radius:12px;`,
      placeholderBorder: '#B9C6FD',
      placeholderBg: '#F6F8FC',
      hintColor: CONSOLE_INK_3,
      captionColor: CONSOLE_INK_3,
    })
    const cap = `<p style="margin:12px 20px 28px;font-size:12px;line-height:1.55;letter-spacing:.04em;text-align:center;text-indent:0;color:${CONSOLE_INK_3};">${items.every((it) => !it.src) ? plainCaption(caption) : figureCaption(caption, `font-family:${MONO};font-size:12px;color:${CONSOLE_PRIMARY};letter-spacing:.04em;`, 'letter-spacing:.04em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:16px;border-top:1px solid ${CONSOLE_LINE};text-align:center;"><p style="margin:0;font-size:12px;line-height:1.7;letter-spacing:.04em;text-indent:0;color:${CONSOLE_INK_3};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:8px 0 0;font-size:10px;line-height:1.5;letter-spacing:.22em;text-indent:0;color:#A1ABBF;"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:15px;line-height:1.8;letter-spacing:0;color:${CONSOLE_INK_2};">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:24px 20px;">${baseTableBlock(head, rows, align, {
      accent: CONSOLE_PRIMARY,
      border: CONSOLE_LINE,
      headBg: '#F1F4FB',
      text: CONSOLE_INK_2,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:16px 18px;${CONSOLE_INSET}overflow-x:hidden;"><p style="margin:0;font-family:${MONO};font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:${CONSOLE_INK};white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:40px 20px;border-top:1px solid ${CONSOLE_LINE};"><span leaf=""><br></span></section>`,

  footnoteRef: (index) =>
    `<span style="font-size:11px;line-height:1;color:${CONSOLE_PRIMARY};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: CONSOLE_FOOTNOTES,

  gallery: CONSOLE_GALLERY,
}

export const DESIGN_THEMES: Theme[] = [yoruTypeTheme, paperEditorialTheme, consoleAkariTheme]