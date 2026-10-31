// 八套从 Yoru 的设计系统移植来的手写主题：
//   yoru-type        YORU Content · 冷纸铅印
//   paper-editorial  PAPER · 编辑部印刷（只做 Editorial 浅色纸）
//   console-akari    yoru·akari Console · 瓷白内凹（只做 akari 浅色）
//   kunlun-snowline  KUNLUN · 雪线仪表台（只做 SNOWLINE 浅色）
//   rift-daybreak    RIFT · 黎明玻璃（只做 daybreak 浅色）
//   core-frost       core · 霜纸档案窗（只做 frost 浅色）
//   aozora-daylight  Aozora 青空 · 晨空玻璃（只做 daylight 浅色）
//   kihon-gin        KIHON 基本 · 银灰金属（只做 gin 浅色）
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

// ============================================================
// 雪线 · KUNLUN Design System（snowline）
// ============================================================

const KUNLUN_PAGE = '#E2E9F2'
const KUNLUN_PANEL = '#F7FAFD'
const KUNLUN_INSET = '#D9E2EE'
const KUNLUN_INK_900 = '#0C1526'
const KUNLUN_INK_700 = '#24334D'
const KUNLUN_INK_500 = '#4A5C7A'
const KUNLUN_INK_300 = '#8595AF'
const KUNLUN_LINE = '#C7D3E3'
const KUNLUN_LINE_STRONG = '#9DAEC7'
const KUNLUN_CYAN_600 = '#0098D4'
const KUNLUN_CYAN_700 = '#0075A8'
const KUNLUN_LCD = '#C9D6D8'
const KUNLUN_LCD_INK = '#1C3038'

const KUNLUN_DISPLAY =
  "'Orbitron','Arial Black','Impact','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const KUNLUN_MONO =
  "'JetBrains Mono','Menlo','Consolas','Noto Sans SC','PingFang SC','Microsoft YaHei',monospace"
const KUNLUN_LCD_FONT = "'VT323','Courier New',monospace"

/** 2 个 L 形角标（左上 + 右下）：不用 position，纯背景色块，作为切角的公众号兜底。 */
function twoCornerMarks(color: string, arm: number, thickness: number): string {
  const t = `${thickness}px`
  return `background-image:linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color});background-size:${arm}px ${t},${t} ${arm}px,${arm}px ${t},${t} ${arm}px;background-position:left top,left top,right bottom,right bottom;background-repeat:no-repeat;`
}

/** 4 个 L 形角标：RIFT 的 .rift-frame 在流式正文里的静态等价物。 */
function fourCornerMarks(color: string, arm: number, thickness: number): string {
  const t = `${thickness}px`
  const pair = `${arm}px ${t},${t} ${arm}px`
  return `background-image:linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color}),linear-gradient(${color},${color});background-size:${pair},${pair},${pair},${pair};background-position:left top,left top,right top,right top,right bottom,right bottom,left bottom,left bottom;background-repeat:no-repeat;`
}

/** KUNLUN / RIFT 的图注：图1 → FIG. 01 // 说明；空图位仍保留「图N」契约。 */
function labeledFigureCaption(caption: string, numStyle: string, restStyle: string): string {
  const match = caption.match(/^图(\d+)(\s*)([\s\S]*)$/)
  if (!match) return `<span leaf="">${esc(caption)}</span>`
  const num = String(match[1]).padStart(2, '0')
  const rest = (match[2] + match[3]).trim()
  return `<span leaf=""><span style="${numStyle}">FIG. ${num}</span><span style="${restStyle}">${rest ? ` // ${esc(rest)}` : ''}</span></span>`
}

/** core 的图注：保留「图N」，前面加档案脚注的 // 前缀。 */
function archiveFigureCaption(caption: string, numStyle: string, restStyle: string): string {
  const match = caption.match(/^图(\d+)(\s*)([\s\S]*)$/)
  if (!match) return `<span leaf="">${esc(caption)}</span>`
  const rest = (match[2] + match[3]).trim()
  return `<span leaf=""><span style="${numStyle}">// 图${match[1]}</span><span style="${restStyle}">${rest ? ` ${esc(rest)}` : ''}</span></span>`
}

function kunlunSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${KUNLUN_MONO};font-size:12.5px;line-height:1.6;background:${KUNLUN_INSET};border:1px solid ${KUNLUN_LINE};padding:1px 5px;border-radius:2px;color:${KUNLUN_LCD_INK};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${KUNLUN_INK_300};">${inner}</span>`
  if (s.link) {
    inner = `<span style="color:${KUNLUN_CYAN_700};border-bottom:1px solid rgba(0,117,168,.45);">${inner}</span>`
  }
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;color:${KUNLUN_INK_900};">${inner}</strong>`
  if (s.mark) {
    inner = `<span style="font-weight:500;color:${KUNLUN_INK_900};background:rgba(0,152,212,.12);border-bottom:1px solid ${KUNLUN_CYAN_600};padding:0 .06em;">${inner}</span>`
  }
  return inner
}

const KUNLUN_GALLERY = galleryBlock({
  marginTop: '30px',
  titleStyle: `font-family:${KUNLUN_MONO};font-size:12px;line-height:1.5;letter-spacing:.2em;text-transform:uppercase;text-align:left;text-indent:0;color:${KUNLUN_INK_500};font-weight:500;`,
  captionStyle: `font-family:${KUNLUN_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-align:left;text-indent:0;color:${KUNLUN_INK_500};`,
  numStyle: `font-family:${KUNLUN_MONO};font-size:11px;color:${KUNLUN_CYAN_700};letter-spacing:.12em;`,
  restStyle: 'letter-spacing:.12em;',
  cellCaptionStyle: `font-family:${KUNLUN_MONO};font-size:10.5px;line-height:1.5;letter-spacing:.12em;text-align:left;text-indent:0;color:${KUNLUN_INK_500};`,
  placeholderBorder: KUNLUN_LINE,
  placeholderBg: KUNLUN_PANEL,
  hintColor: KUNLUN_INK_500,
  imgStyle: `border:1px solid ${KUNLUN_LINE_STRONG};border-radius:2px;`,
})

const KUNLUN_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${KUNLUN_LINE}`,
  labelStyle: `font-family:${KUNLUN_MONO};font-size:10px;line-height:1.5;letter-spacing:.2em;text-transform:uppercase;color:${KUNLUN_CYAN_700};text-indent:0;`,
  rowStyle: `font-family:${KUNLUN_MONO};font-size:11px;line-height:1.7;letter-spacing:0;color:${KUNLUN_INK_500};text-align:left;text-indent:0;word-break:break-all;`,
})

export const kunlunSnowlineTheme: Theme & ThemeExtensions = {
  id: 'kunlun-snowline',
  name: '雪线',
  desc: 'KUNLUN · 雪线仪表台',
  category: '商务',
  ui: { accent: KUNLUN_CYAN_600, soft: '#D5F6FF', ink: KUNLUN_INK_900 },
  meta: designMeta(
    'KUNLUN Design System',
    'KUNLUN Design System/',
    '只做已批准的 SNOWLINE 雪线：实验台底色、40px 蓝图网格、切角用 L 形角标兜底、LCD 代码块、HUD 等宽编号；中文正文不套等宽栈，去掉坐标读数和满屏刻度。',
    { styles: ['科技', '商务'], complexity: 2, color: '冷色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background-color:${KUNLUN_PAGE};background-image:linear-gradient(rgba(20,90,180,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(20,90,180,.08) 1px,transparent 1px);background-size:40px 40px;color:${KUNLUN_INK_700};line-height:1.7;letter-spacing:.01em;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: kunlunSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 24px;font-size:15px;line-height:1.7;letter-spacing:.01em;text-align:justify;text-indent:0;color:${KUNLUN_INK_700};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 8px;font-family:${KUNLUN_MONO};font-size:10px;line-height:1.4;letter-spacing:.22em;text-transform:uppercase;text-indent:0;color:${KUNLUN_CYAN_700};"><span leaf="">// ${esc(kicker)}</span></p>`
        : ''
      return `<section style="margin:0 20px 30px;background-color:${KUNLUN_PANEL};border:1px solid ${KUNLUN_LINE_STRONG};${twoCornerMarks(KUNLUN_CYAN_700, 12, 2)}padding:16px 18px;">${label}<h1 style="margin:0;font-family:${KUNLUN_DISPLAY};font-size:30px;line-height:1.15;letter-spacing:-.01em;font-weight:900;color:${KUNLUN_INK_900};"><span leaf="">${esc(title)}</span></h1></section>`
    }
    const numText = `[ ${String(num).padStart(2, '0')} ]`
    const label = `<p style="margin:0 0 8px;font-family:${KUNLUN_MONO};font-size:10.5px;line-height:1.5;letter-spacing:.2em;text-transform:uppercase;text-indent:0;"><span leaf=""><span style="color:${KUNLUN_CYAN_700};font-weight:700;">${numText}</span>${kicker ? `<span style="color:${KUNLUN_INK_500};"> // ${esc(kicker)}</span>` : ''}</span></p>`
    return `<section style="margin:44px 20px 20px;border-top:1px solid ${KUNLUN_LINE_STRONG};padding-top:14px;">${label}<h2 style="margin:0;font-family:${KUNLUN_DISPLAY};font-size:21px;line-height:1.25;letter-spacing:-.01em;font-weight:700;color:${KUNLUN_INK_900};"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 12px;padding-bottom:7px;border-bottom:1px dashed ${KUNLUN_LINE};font-family:${KUNLUN_MONO};font-size:15px;line-height:1.5;letter-spacing:.04em;font-weight:700;color:${KUNLUN_INK_900};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:26px 20px;font-family:${KUNLUN_MONO};font-size:14px;line-height:1.75;letter-spacing:.08em;text-align:center;text-indent:0;color:${KUNLUN_CYAN_700};">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;background-color:${KUNLUN_PANEL};border:1px solid ${KUNLUN_CYAN_600};${twoCornerMarks(KUNLUN_CYAN_700, 12, 1)}box-shadow:inset 0 0 12px rgba(0,152,212,.10);padding:18px;"><p style="margin:0;font-family:${KUNLUN_MONO};font-size:16px;line-height:1.7;letter-spacing:.04em;text-align:center;text-indent:0;color:${KUNLUN_INK_900};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;background-color:${KUNLUN_PANEL};border:1px solid ${KUNLUN_CYAN_600};${twoCornerMarks(KUNLUN_CYAN_700, 12, 1)}box-shadow:inset 0 0 12px rgba(0,152,212,.10);padding:16px 18px;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-size:15px;line-height:1.75;letter-spacing:.01em;text-align:justify;text-indent:0;color:${KUNLUN_INK_700};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    const capStyle = `margin:8px 20px 30px;font-family:${KUNLUN_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-align:left;text-indent:0;color:${KUNLUN_INK_500};`
    const cap = `<p style="${capStyle}">${labeledFigureCaption(caption, `font-family:${KUNLUN_MONO};font-size:11px;color:${KUNLUN_CYAN_700};letter-spacing:.12em;`, 'letter-spacing:.12em;')}</p>`
    if (!src) {
      return `<p style="margin:26px 20px;font-family:${KUNLUN_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-align:left;text-indent:0;color:${KUNLUN_INK_500};">${plainCaption(caption)}</p>`
    }
    return `<p style="margin:30px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid ${KUNLUN_LINE_STRONG};border-radius:2px;" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-family:${KUNLUN_MONO};font-size:12px;line-height:1.5;letter-spacing:.2em;text-transform:uppercase;text-align:left;text-indent:0;color:${KUNLUN_INK_500};font-weight:500;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-family:${KUNLUN_MONO};font-size:10px;line-height:1.6;letter-spacing:.16em;text-align:left;text-indent:0;color:${KUNLUN_INK_500};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${KUNLUN_LINE_STRONG};border-radius:2px;`,
      placeholderBorder: KUNLUN_LINE,
      placeholderBg: KUNLUN_PANEL,
      hintColor: KUNLUN_INK_500,
      captionColor: KUNLUN_INK_500,
    })
    const cap = `<p style="margin:12px 20px 30px;font-family:${KUNLUN_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-align:left;text-indent:0;color:${KUNLUN_INK_500};">${items.every((it) => !it.src) ? plainCaption(caption) : labeledFigureCaption(caption, `font-family:${KUNLUN_MONO};font-size:11px;color:${KUNLUN_CYAN_700};letter-spacing:.12em;`, 'letter-spacing:.12em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:14px;border-top:1px solid ${KUNLUN_LINE_STRONG};"><p style="margin:0;font-family:${KUNLUN_MONO};font-size:10px;line-height:1.7;letter-spacing:.12em;text-indent:0;color:${KUNLUN_INK_500};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:8px 0 0;font-family:${KUNLUN_MONO};font-size:10px;line-height:1.5;letter-spacing:.18em;text-indent:0;color:${KUNLUN_CYAN_700};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    const marker = ordered ? 'decimal-leading-zero' : 'square'
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:15px;line-height:1.7;letter-spacing:.01em;color:${KUNLUN_INK_700};list-style-type:${marker};">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:26px 20px;font-family:${KUNLUN_MONO};">${baseTableBlock(head, rows, align, {
      accent: KUNLUN_CYAN_700,
      border: KUNLUN_LINE,
      headBg: KUNLUN_PANEL,
      text: KUNLUN_INK_700,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:14px 16px;background-color:${KUNLUN_LCD};background-image:linear-gradient(180deg,rgba(255,255,255,.28) 0,rgba(255,255,255,0) 18px),repeating-linear-gradient(to bottom,transparent 0,transparent 2px,rgba(18,52,64,.07) 2px,rgba(18,52,64,.07) 3px);border:1px solid ${KUNLUN_LINE_STRONG};box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 3px 10px rgba(12,21,38,.18);overflow-x:hidden;"><p style="margin:0;font-family:${KUNLUN_LCD_FONT};font-size:16px;line-height:1.5;letter-spacing:.02em;text-indent:0;color:${KUNLUN_LCD_INK};white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:40px 20px;border-top:1px solid ${KUNLUN_LINE_STRONG};"><span leaf=""><br></span></section>`,

  footnoteRef: (index) =>
    `<span style="font-family:${KUNLUN_MONO};font-size:10px;line-height:1;color:${KUNLUN_CYAN_700};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: KUNLUN_FOOTNOTES,

  gallery: KUNLUN_GALLERY,
}

// ============================================================
// 黎明 · RIFT Design System（daybreak）
// ============================================================

const RIFT_PAGE = '#EAF1FC'
const RIFT_GLASS = 'rgba(255,255,255,.55)'
const RIFT_GLASS_BORDER = 'rgba(40,72,130,.20)'
const RIFT_INNER_HI = 'rgba(255,255,255,.90)'
const RIFT_INK_1 = '#0A1430'
const RIFT_INK_2 = '#3E4F76'
const RIFT_INK_3 = '#6B7896'
const RIFT_ROYAL = '#3F5BE6'
const RIFT_SUNKEN = '#DCE7F8'
const RIFT_LINE_2 = 'rgba(20,45,95,.15)'
const RIFT_GRID = 'rgba(34,64,128,.07)'

const RIFT_DISPLAY =
  "'Space Grotesk','Helvetica Neue','Arial','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const RIFT_MONO =
  "'Share Tech Mono','Menlo','Consolas','Noto Sans SC','PingFang SC','Microsoft YaHei',monospace"
const RIFT_ITALIC = "'DM Serif Display','Georgia','Songti SC','STSong',serif"

/** 静态 chromatic edge：两个方向的固定偏移，不跑 7s 动画。 */
const RIFT_EDGE = `text-shadow:-1px 0 rgba(107,182,240,.45),1px 0 rgba(63,91,230,.45);`

function riftSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${RIFT_MONO};font-size:12.5px;line-height:1.6;background:${RIFT_SUNKEN};border:1px solid ${RIFT_LINE_2};padding:1px 5px;border-radius:6px;color:${RIFT_INK_1};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${RIFT_INK_3};">${inner}</span>`
  if (s.link) {
    inner = `<span style="color:${RIFT_ROYAL};border-bottom:1px solid rgba(63,91,230,.45);">${inner}</span>`
  }
  if (s.bold && !s.mark) inner = `<strong style="font-weight:600;color:${RIFT_INK_1};">${inner}</strong>`
  if (s.mark) {
    inner = `<span style="font-weight:500;color:${RIFT_INK_1};background:rgba(63,91,230,.14);border-bottom:1px solid ${RIFT_ROYAL};padding:0 .06em;">${inner}</span>`
  }
  return inner
}

const RIFT_GALLERY = galleryBlock({
  marginTop: '30px',
  titleStyle: `font-family:${RIFT_DISPLAY};font-size:14px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${RIFT_INK_1};font-weight:600;`,
  captionStyle: `font-family:${RIFT_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-transform:uppercase;text-align:left;text-indent:0;color:${RIFT_INK_3};`,
  numStyle: `font-family:${RIFT_MONO};font-size:11px;color:${RIFT_ROYAL};letter-spacing:.12em;`,
  restStyle: 'letter-spacing:.12em;',
  cellCaptionStyle: `font-family:${RIFT_MONO};font-size:10.5px;line-height:1.5;letter-spacing:.12em;text-transform:uppercase;text-align:left;text-indent:0;color:${RIFT_INK_3};`,
  placeholderBorder: RIFT_GLASS_BORDER,
  placeholderBg: RIFT_GLASS,
  hintColor: RIFT_INK_3,
  imgStyle: `border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;box-shadow:0 6px 18px rgba(20,45,95,.08);`,
})

const RIFT_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${RIFT_LINE_2}`,
  labelStyle: `font-family:${RIFT_MONO};font-size:11px;line-height:1.5;letter-spacing:.14em;text-transform:uppercase;color:${RIFT_ROYAL};text-indent:0;`,
  rowStyle: `font-family:${RIFT_MONO};font-size:11px;line-height:1.7;letter-spacing:0;color:${RIFT_INK_3};text-align:left;text-indent:0;word-break:break-all;`,
})

export const riftDaybreakTheme: Theme & ThemeExtensions = {
  id: 'rift-daybreak',
  name: '黎明',
  desc: 'RIFT · 黎明玻璃',
  category: '商务',
  ui: { accent: RIFT_ROYAL, soft: '#DCE7F8', ink: RIFT_INK_1 },
  meta: designMeta(
    'RIFT Design System',
    'RIFT Design System/',
    '只做 daybreak 黎明：白到冰蓝的径向底、72px 网格、玻璃用半透明填充与顶部内高光模拟、标题用静态双色偏移；glitch 不跑动画，删掉裂隙水印与扫描线满屏装饰。',
    { styles: ['科技', '商务'], complexity: 2, color: '冷色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background-color:${RIFT_PAGE};background-image:linear-gradient(${RIFT_GRID} 1px,transparent 1px),linear-gradient(90deg,${RIFT_GRID} 1px,transparent 1px),radial-gradient(125% 90% at 50% -10%,#FFFFFF 0%,#E8F0FD 46%,#D2E0F6 100%);background-size:72px 72px,72px 72px,auto;color:${RIFT_INK_2};line-height:1.7;letter-spacing:.01em;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: riftSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 24px;font-size:15.5px;line-height:1.7;letter-spacing:.01em;text-align:justify;text-indent:0;color:${RIFT_INK_2};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 8px;font-family:${RIFT_MONO};font-size:11px;line-height:1.5;letter-spacing:.14em;text-transform:uppercase;text-indent:0;color:${RIFT_INK_3};"><span leaf="">// ${esc(kicker)}</span></p>`
        : ''
      return `<section style="margin:0 20px 32px;background-color:${RIFT_GLASS};border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;box-shadow:inset 0 1px 0 ${RIFT_INNER_HI},0 10px 28px rgba(20,45,95,.08);padding:20px;">${label}<h1 style="margin:0;font-family:${RIFT_DISPLAY};font-size:30px;line-height:1.2;letter-spacing:-.01em;font-weight:600;color:${RIFT_INK_1};${RIFT_EDGE}"><span leaf="">${esc(title)}</span></h1></section>`
    }
    const numText = `${String(num).padStart(2, '0')} /`
    const label = `<p style="margin:0 0 8px;font-family:${RIFT_MONO};font-size:11px;line-height:1.5;letter-spacing:.16em;text-transform:uppercase;text-indent:0;"><span leaf=""><span style="color:${RIFT_ROYAL};">${numText}</span>${kicker ? `<span style="color:${RIFT_INK_3};"> ${esc(kicker)}</span>` : ''}</span></p>`
    return `<section style="margin:44px 20px 20px;border-top:1px solid ${RIFT_LINE_2};padding-top:14px;">${label}<h2 style="margin:0;font-family:${RIFT_DISPLAY};font-size:22px;line-height:1.3;letter-spacing:-.01em;font-weight:600;color:${RIFT_INK_1};${RIFT_EDGE}"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 12px;padding-bottom:7px;border-bottom:1px solid ${RIFT_LINE_2};font-family:${RIFT_DISPLAY};font-size:17px;line-height:1.4;letter-spacing:-.01em;font-weight:600;color:${RIFT_INK_1};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:28px 20px;font-family:${RIFT_ITALIC};font-size:19px;line-height:1.6;letter-spacing:0;font-style:italic;text-align:center;text-indent:0;color:${RIFT_INK_1};">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;background-color:${RIFT_GLASS};border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;box-shadow:inset 0 1px 0 ${RIFT_INNER_HI},0 8px 22px rgba(20,45,95,.08);padding:18px 20px;"><p style="margin:0;font-family:${RIFT_ITALIC};font-size:19px;line-height:1.6;letter-spacing:0;font-style:italic;text-align:center;text-indent:0;color:${RIFT_INK_1};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;background-color:${RIFT_GLASS};${fourCornerMarks('rgba(63,91,230,.55)', 18, 1.5)}border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;box-shadow:inset 0 1px 0 ${RIFT_INNER_HI};padding:18px 20px;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-size:15.5px;line-height:1.8;letter-spacing:.01em;text-align:justify;text-indent:0;color:${RIFT_INK_2};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    const capStyle = `margin:8px 20px 30px;font-family:${RIFT_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-transform:uppercase;text-align:left;text-indent:0;color:${RIFT_INK_3};`
    const cap = `<p style="${capStyle}">${labeledFigureCaption(caption, `font-family:${RIFT_MONO};font-size:11px;color:${RIFT_ROYAL};letter-spacing:.12em;`, 'letter-spacing:.12em;')}</p>`
    if (!src) {
      return `<p style="margin:26px 20px;font-family:${RIFT_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-transform:uppercase;text-align:left;text-indent:0;color:${RIFT_INK_3};">${plainCaption(caption)}</p>`
    }
    return `<p style="margin:30px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;box-shadow:0 6px 18px rgba(20,45,95,.08);" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-family:${RIFT_DISPLAY};font-size:14px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${RIFT_INK_1};font-weight:600;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-family:${RIFT_MONO};font-size:10px;line-height:1.6;letter-spacing:.14em;text-transform:uppercase;text-align:left;text-indent:0;color:${RIFT_INK_3};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;`,
      placeholderBorder: RIFT_GLASS_BORDER,
      placeholderBg: RIFT_GLASS,
      hintColor: RIFT_INK_3,
      captionColor: RIFT_INK_3,
    })
    const cap = `<p style="margin:12px 20px 30px;font-family:${RIFT_MONO};font-size:11px;line-height:1.6;letter-spacing:.12em;text-transform:uppercase;text-align:left;text-indent:0;color:${RIFT_INK_3};">${items.every((it) => !it.src) ? plainCaption(caption) : labeledFigureCaption(caption, `font-family:${RIFT_MONO};font-size:11px;color:${RIFT_ROYAL};letter-spacing:.12em;`, 'letter-spacing:.12em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:14px;border-top:1px solid ${RIFT_LINE_2};"><p style="margin:0;font-family:${RIFT_MONO};font-size:10.5px;line-height:1.7;letter-spacing:.12em;text-transform:uppercase;text-indent:0;color:${RIFT_INK_3};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:8px 0 0;font-family:${RIFT_MONO};font-size:10px;line-height:1.5;letter-spacing:.18em;text-indent:0;color:${RIFT_ROYAL};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:15.5px;line-height:1.7;letter-spacing:.01em;color:${RIFT_INK_2};">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:26px 20px;padding:10px;background-color:${RIFT_GLASS};border:1px solid ${RIFT_GLASS_BORDER};border-radius:18px;box-shadow:inset 0 1px 0 ${RIFT_INNER_HI};">${baseTableBlock(head, rows, align, {
      accent: RIFT_INK_1,
      border: RIFT_LINE_2,
      headBg: 'rgba(255,255,255,.55)',
      text: RIFT_INK_2,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:16px 18px;background-color:${RIFT_SUNKEN};background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 2px,rgba(20,45,95,.05) 2px,rgba(20,45,95,.05) 3px);border:1px solid ${RIFT_LINE_2};border-radius:10px;box-shadow:inset 0 1px 0 ${RIFT_INNER_HI};overflow-x:hidden;"><p style="margin:0;font-family:${RIFT_MONO};font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:${RIFT_INK_1};white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:40px 20px;border-top:1px solid ${RIFT_LINE_2};"><span leaf=""><br></span></section>`,

  footnoteRef: (index) =>
    `<span style="font-family:${RIFT_MONO};font-size:10px;line-height:1;color:${RIFT_ROYAL};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: RIFT_FOOTNOTES,

  gallery: RIFT_GALLERY,
}

// ============================================================
// 霜纸 · core Design System（frost）
// ============================================================

const CORE_PAGE = '#EAF4F8'
const CORE_CARD = '#F5FAFD'
const CORE_WINDOW = '#E0F4FB'
const CORE_SUNK = '#DDE4EC'
const CORE_INK = '#0C1A26'
const CORE_SOFT = '#1A2F42'
const CORE_MUTED = '#4A5E72'
const CORE_FAINT = '#7A8C9E'
const CORE_BONDI = '#009DE0'
const CORE_BONDI_DARK = '#006A99'
const CORE_BEVEL_LO = '#8895A3'
const CORE_BEVEL_HI = '#F5FAFD'

const CORE_PIXEL =
  "'Pixelify Sans','VT323','Courier New','PingFang SC','Microsoft YaHei',monospace"
const CORE_SERIF = "'Songti SC','STSong','SimSun','Times New Roman',serif"
const CORE_MONO = "'VT323','Courier New',monospace"
const CORE_UI = "'MS Sans Serif',Tahoma,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"

const CORE_BEVEL_IN =
  `box-shadow:inset 1px 1px 0 ${CORE_BEVEL_LO},inset -1px -1px 0 ${CORE_BEVEL_HI};`
const CORE_HARD_SHADOW = `box-shadow:2px 2px 0 ${CORE_INK};`
const CORE_WINDOW_SHADOW = `box-shadow:3px 3px 0 ${CORE_INK},6px 6px 0 rgba(26,20,12,.25);`

function coreSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${CORE_MONO};font-size:14px;line-height:1.5;background:${CORE_SUNK};border:1px solid ${CORE_INK};padding:1px 4px;color:${CORE_SOFT};${CORE_BEVEL_IN}">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${CORE_MUTED};">${inner}</span>`
  if (s.link) {
    inner = `<span style="color:${CORE_BONDI_DARK};border-bottom:1px solid ${CORE_BONDI};">${inner}</span>`
  }
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;color:${CORE_INK};">${inner}</strong>`
  if (s.mark) {
    inner = `<span style="font-weight:500;color:${CORE_INK};background:linear-gradient(180deg,transparent 55%,rgba(255,126,182,.45) 55%);padding:0 .04em;">${inner}</span>`
  }
  return inner
}

const CORE_GALLERY = galleryBlock({
  marginTop: '30px',
  titleStyle: `font-family:${CORE_PIXEL};font-size:15px;line-height:1.3;letter-spacing:-.01em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_INK};font-weight:700;`,
  captionStyle: `font-family:${CORE_MONO};font-size:11.5px;line-height:1.6;letter-spacing:.04em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_MUTED};`,
  numStyle: `font-family:${CORE_MONO};font-size:11.5px;color:${CORE_BONDI_DARK};letter-spacing:.04em;`,
  restStyle: 'letter-spacing:.04em;',
  cellCaptionStyle: `font-family:${CORE_MONO};font-size:11px;line-height:1.5;letter-spacing:.04em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_MUTED};`,
  placeholderBorder: CORE_INK,
  placeholderBg: CORE_SUNK,
  hintColor: CORE_FAINT,
  imgStyle: `border:1px solid ${CORE_INK};box-shadow:2px 2px 0 ${CORE_INK};`,
})

const CORE_FOOTNOTES = footnotesBlock({
  rule: `1px dashed ${CORE_INK}`,
  labelStyle: `font-family:${CORE_UI};font-size:11px;line-height:1.5;letter-spacing:.04em;color:${CORE_MUTED};text-indent:0;`,
  rowStyle: `font-family:${CORE_MONO};font-size:11.5px;line-height:1.7;letter-spacing:0;color:${CORE_MUTED};text-align:left;text-indent:0;word-break:break-all;`,
})

export const coreFrostTheme: Theme & ThemeExtensions = {
  id: 'core-frost',
  name: '霜纸',
  desc: 'core · 霜纸档案窗',
  category: '活力',
  ui: { accent: CORE_BONDI, soft: '#E0F4FB', ink: CORE_INK },
  meta: designMeta(
    'core Design System',
    'core Design System/',
    '只做 frost 霜纸：32px 瓷砖网格、每个章节纵向叠一扇 Window、1px 墨线与硬偏移阴影、Tinos 系衬线正文、VT323 档案脚注；不做假关闭键、斜纹、绝对定位和夜池。',
    { styles: ['文艺复古', '卡通'], complexity: 2, color: '冷色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background-color:${CORE_PAGE};background-image:linear-gradient(rgba(12,26,38,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(12,26,38,.035) 1px,transparent 1px);background-size:32px 32px;color:${CORE_SOFT};line-height:1.6;letter-spacing:0;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: coreSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 20px;font-family:${CORE_SERIF};font-size:16px;line-height:1.6;letter-spacing:0;text-align:justify;text-indent:0;color:${CORE_SOFT};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker ? `// ${esc(kicker)}` : 'untitled'
      return `<section style="margin:0 20px 30px;background-color:${CORE_CARD};border:1px solid ${CORE_INK};${CORE_WINDOW_SHADOW}"><section style="padding:4px 10px;background-color:${CORE_BONDI};border-bottom:1px solid ${CORE_INK};"><p style="margin:0;font-family:${CORE_UI};font-size:11px;line-height:1.6;letter-spacing:.02em;text-transform:lowercase;text-indent:0;color:${CORE_CARD};"><span leaf="">${label}</span></p></section><section style="padding:14px 16px 18px;background-color:${CORE_WINDOW};"><h1 style="margin:0;font-family:${CORE_PIXEL};font-size:34px;line-height:1.05;letter-spacing:-.01em;font-weight:700;color:${CORE_INK};text-transform:lowercase;"><span leaf="">${esc(title)}</span></h1></section></section>`
    }
    const numText = `[ ${String(num).padStart(2, '0')} ]`
    const bar = `${numText}${kicker ? ` · ${esc(kicker)}` : ''}`
    return `<section style="margin:44px 20px 18px;background-color:${CORE_CARD};border:1px solid ${CORE_INK};${CORE_WINDOW_SHADOW}"><section style="padding:5px 10px 7px;background-color:${CORE_BONDI};border-bottom:1px solid ${CORE_INK};"><p style="margin:0 0 2px;font-family:${CORE_MONO};font-size:11px;line-height:1.5;letter-spacing:.06em;text-transform:lowercase;text-indent:0;color:${CORE_CARD};"><span leaf="">${bar}</span></p><h2 style="margin:0;font-family:${CORE_PIXEL};font-size:20px;line-height:1.15;letter-spacing:-.01em;font-weight:700;color:${CORE_CARD};text-transform:lowercase;"><span leaf="">${esc(title)}</span></h2></section></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 10px;padding-bottom:6px;border-bottom:1px dashed ${CORE_INK};font-family:${CORE_PIXEL};font-size:19px;line-height:1.2;letter-spacing:-.01em;font-weight:700;color:${CORE_INK};text-transform:lowercase;"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:28px 20px;font-family:${CORE_SERIF};font-size:18px;line-height:1.65;letter-spacing:0;font-style:italic;text-align:center;text-indent:0;color:${CORE_SOFT};text-shadow:0 0 10px rgba(244,184,160,.55);">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;background-color:${CORE_SUNK};border:1px solid ${CORE_INK};${CORE_BEVEL_IN}padding:16px 18px;"><p style="margin:0;font-family:${CORE_SERIF};font-size:18px;line-height:1.7;letter-spacing:0;font-style:italic;text-align:center;text-indent:0;color:${CORE_SOFT};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;background-color:${CORE_SUNK};border:1px solid ${CORE_INK};${CORE_BEVEL_IN}padding:16px 18px;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-family:${CORE_SERIF};font-size:17px;line-height:1.7;letter-spacing:0;font-style:italic;text-align:justify;text-indent:0;color:${CORE_SOFT};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    const capStyle = `margin:8px 20px 30px;font-family:${CORE_MONO};font-size:11.5px;line-height:1.6;letter-spacing:.04em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_MUTED};`
    const cap = `<p style="${capStyle}">${archiveFigureCaption(caption, `font-family:${CORE_MONO};font-size:11.5px;color:${CORE_BONDI_DARK};letter-spacing:.04em;`, 'letter-spacing:.04em;')}</p>`
    if (!src) {
      return `<p style="margin:26px 20px;font-family:${CORE_MONO};font-size:11.5px;line-height:1.6;letter-spacing:.04em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_MUTED};">${plainCaption(caption)}</p>`
    }
    return `<p style="margin:30px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid ${CORE_INK};box-shadow:2px 2px 0 ${CORE_INK};" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-family:${CORE_PIXEL};font-size:15px;line-height:1.3;letter-spacing:-.01em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_INK};font-weight:700;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-family:${CORE_MONO};font-size:11px;line-height:1.6;letter-spacing:.04em;text-align:left;text-indent:0;color:${CORE_MUTED};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${CORE_INK};box-shadow:2px 2px 0 ${CORE_INK};`,
      placeholderBorder: CORE_INK,
      placeholderBg: CORE_SUNK,
      hintColor: CORE_MUTED,
      captionColor: CORE_MUTED,
    })
    const cap = `<p style="margin:12px 20px 30px;font-family:${CORE_MONO};font-size:11.5px;line-height:1.6;letter-spacing:.04em;text-transform:lowercase;text-align:left;text-indent:0;color:${CORE_MUTED};">${items.every((it) => !it.src) ? plainCaption(caption) : archiveFigureCaption(caption, `font-family:${CORE_MONO};font-size:11.5px;color:${CORE_BONDI_DARK};letter-spacing:.04em;`, 'letter-spacing:.04em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;background-color:${CORE_SUNK};border:1px solid ${CORE_INK};${CORE_BEVEL_IN}padding:7px 10px;"><p style="margin:0;font-family:${CORE_UI};font-size:11px;line-height:1.7;letter-spacing:.02em;text-indent:0;color:${CORE_MUTED};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:4px 0 0;font-family:${CORE_MONO};font-size:12px;line-height:1.5;letter-spacing:.08em;text-indent:0;color:${CORE_BONDI_DARK};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    const marker = ordered ? 'decimal' : 'square'
    return `<${tag}${startAttr} style="margin:0 20px 22px;padding-left:1.5em;font-family:${CORE_SERIF};font-size:16px;line-height:1.6;letter-spacing:0;color:${CORE_SOFT};list-style-type:${marker};">${items
      .map((it) => `<li style="margin:5px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:28px 20px;background-color:${CORE_CARD};border:1px solid ${CORE_INK};${CORE_HARD_SHADOW}overflow-x:auto;">${baseTableBlock(head, rows, align, {
      accent: CORE_CARD,
      border: CORE_INK,
      headBg: CORE_BONDI,
      text: CORE_SOFT,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:14px 16px;background-color:${CORE_SUNK};border:1px solid ${CORE_INK};${CORE_BEVEL_IN}overflow-x:hidden;"><p style="margin:0;font-family:${CORE_MONO};font-size:15px;line-height:1.5;letter-spacing:.02em;text-indent:0;color:${CORE_SOFT};white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:40px 20px;border-top:1px dashed ${CORE_INK};"><span leaf=""><br></span></section>`,

  footnoteRef: (index) =>
    `<span style="font-family:${CORE_MONO};font-size:11px;line-height:1;color:${CORE_BONDI_DARK};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: CORE_FOOTNOTES,

  gallery: CORE_GALLERY,
}

// ============================================================
// 青空 · Aozora Design System（daylight）
// ============================================================

const AOZORA_PAGE = '#F7FAFD'
const AOZORA_INK_STRONG = '#131922'
const AOZORA_INK = '#232C36'
const AOZORA_MUTED = '#5C6B7C'
const AOZORA_FAINT = '#8A9AAB'
const AOZORA_BLUE = '#0A84FF'
const AOZORA_BLUE_INK = '#006FE0'
const AOZORA_HAIRLINE = 'rgba(10,68,140,.08)'
const AOZORA_GLASS = 'rgba(255,255,255,.72)'
const AOZORA_GLASS_STROKE = 'rgba(255,255,255,.55)'
/** 玻璃边缘：顶部亮边 + 一圈内白描边 + 蓝调外阴影，全部静态，不依赖模糊。 */
const AOZORA_GLASS_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,.90),inset 0 0 0 1px rgba(255,255,255,.18),0 6px 18px rgba(10,68,140,.12)'
/** 玻璃永远压在浅蓝渐变上：白 72% 覆在晨空蓝上，既保留玻璃的透光感，又不靠背景图；黄色只留给标题海报与高亮。 */
const AOZORA_GLASS_FILL =
  `background-color:${AOZORA_GLASS};background-image:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.72)),linear-gradient(135deg,#EAF5FF 0%,#CFE8FF 55%,#9DD2FF 100%);`

const AOZORA_DISPLAY =
  "'Bebas Neue','Impact','Arial Narrow','Inter','Helvetica','PingFang SC','Microsoft YaHei',sans-serif"
const AOZORA_SANS = "'Inter','Helvetica','Arial','PingFang SC','Microsoft YaHei',sans-serif"
const AOZORA_MONO =
  "'JetBrains Mono','Menlo','Consolas','PingFang SC','Microsoft YaHei',monospace"

function aozoraSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${AOZORA_MONO};font-size:12.5px;line-height:1.6;background:${AOZORA_GLASS};border:1px solid ${AOZORA_HAIRLINE};padding:1px 5px;border-radius:14px;color:${AOZORA_INK_STRONG};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${AOZORA_FAINT};">${inner}</span>`
  if (s.link) {
    inner = `<span style="color:${AOZORA_BLUE_INK};border-bottom:1px solid rgba(10,132,255,.35);">${inner}</span>`
  }
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;color:${AOZORA_INK_STRONG};">${inner}</strong>`
  if (s.mark) {
    // 系统只规定黄色是 accent：这里把它收成下半行 55% 的荧光带，不做整块底色。
    inner = `<span style="font-weight:500;color:${AOZORA_INK_STRONG};background:linear-gradient(180deg,transparent 55%,rgba(255,227,77,.55) 55%,rgba(255,227,77,.55) 100%);padding:0 .06em;">${inner}</span>`
  }
  return inner
}

const AOZORA_GALLERY = galleryBlock({
  marginTop: '30px',
  titleStyle: `font-family:${AOZORA_DISPLAY};font-size:15px;line-height:1.4;letter-spacing:-.01em;text-align:left;text-indent:0;color:${AOZORA_INK_STRONG};font-weight:700;`,
  captionStyle: `font-family:${AOZORA_MONO};font-size:11px;line-height:1.6;letter-spacing:.16em;text-align:center;text-indent:0;color:${AOZORA_MUTED};`,
  numStyle: `font-family:${AOZORA_MONO};font-size:11px;color:${AOZORA_BLUE_INK};letter-spacing:.08em;`,
  restStyle: 'letter-spacing:.16em;',
  cellCaptionStyle: `font-family:${AOZORA_MONO};font-size:10.5px;line-height:1.6;letter-spacing:.12em;text-align:center;text-indent:0;color:${AOZORA_MUTED};`,
  placeholderBorder: AOZORA_HAIRLINE,
  placeholderBg: '#EEF3F8',
  hintColor: AOZORA_MUTED,
  imgStyle: `border:1px solid ${AOZORA_GLASS_STROKE};border-radius:20px;box-shadow:0 6px 18px rgba(10,68,140,.12);`,
})

const AOZORA_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${AOZORA_HAIRLINE}`,
  labelStyle: `font-family:${AOZORA_MONO};font-size:10.5px;line-height:1.5;letter-spacing:.16em;text-transform:uppercase;color:${AOZORA_BLUE_INK};text-indent:0;`,
  rowStyle: `font-family:${AOZORA_MONO};font-size:11px;line-height:1.7;letter-spacing:0;color:${AOZORA_MUTED};text-align:left;text-indent:0;word-break:break-all;`,
})

export const aozoraDaylightTheme: Theme & ThemeExtensions = {
  id: 'aozora-daylight',
  name: '青空',
  desc: 'Aozora · 晨空玻璃',
  category: '活力',
  ui: { accent: AOZORA_BLUE, soft: '#CFE8FF', ink: AOZORA_INK_STRONG },
  meta: designMeta(
    'Aozora 青空 Design System',
    'Aozora 青空 Design System/',
    '只做 daylight：neutral-50 纸色、morning 渐变标题区、静态玻璃（白 72% + 白描边 + 顶部内高光 + 蓝调轻阴影）用于引用与重点段；图片按普通图片展示、不套玻璃框，不做 yozora，不用背景图、滤镜与 emoji。',
    { styles: ['科技', '治愈'], complexity: 2, color: '冷色' },
  ),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:${AOZORA_PAGE};color:${AOZORA_INK};line-height:1.75;letter-spacing:.01em;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: aozoraSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 24px;font-size:16px;line-height:1.75;letter-spacing:.01em;text-align:justify;text-indent:0;color:${AOZORA_INK};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 10px;font-family:${AOZORA_MONO};font-size:10.5px;line-height:1.5;letter-spacing:.16em;text-transform:uppercase;text-indent:0;color:${AOZORA_MUTED};"><span leaf="">${esc(kicker)}</span></p>`
        : ''
      // 海报语法：巨大标题 + 小副题。公众号没有竖排 corner 注，只把标题放进 morning 渐变。
      return `<section style="margin:0 20px 32px;padding:26px 22px;background-color:#EAF5FF;background-image:linear-gradient(180deg,#EAF5FF 0%,#CFE8FF 35%,#9DD2FF 70%,#FFE980 100%);border:1px solid ${AOZORA_GLASS_STROKE};border-radius:28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.90),0 6px 18px rgba(10,68,140,.12);">${label}<h1 style="margin:0;font-family:${AOZORA_DISPLAY};font-size:30px;line-height:1.15;letter-spacing:-.03em;font-weight:900;color:${AOZORA_INK_STRONG};"><span leaf="">${esc(title)}</span></h1></section>`
    }
    // 上游没有章节号；等宽 `01 / kicker` 是载体适配的 PROPOSAL，格式对齐海报的 eyebrow。
    const numText = String(num).padStart(2, '0')
    const label = `<p style="margin:0 0 10px;font-family:${AOZORA_MONO};font-size:10.5px;line-height:1.5;letter-spacing:.16em;text-transform:uppercase;text-indent:0;"><span leaf=""><span style="color:${AOZORA_BLUE};font-weight:700;">${numText}</span>${kicker ? `<span style="color:${AOZORA_MUTED};"> / ${esc(kicker)}</span>` : ''}</span></p>`
    return `<section style="margin:44px 20px 22px;">${label}<h2 style="margin:0;font-family:${AOZORA_DISPLAY};font-size:22px;line-height:1.3;letter-spacing:-.02em;font-weight:900;color:${AOZORA_INK_STRONG};"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 12px;font-family:${AOZORA_SANS};font-size:17px;line-height:1.5;letter-spacing:-.01em;font-weight:700;color:${AOZORA_INK_STRONG};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<section style="margin:0 20px;padding:20px 22px;${AOZORA_GLASS_FILL}border:1px solid ${AOZORA_GLASS_STROKE};border-radius:24px;box-shadow:${AOZORA_GLASS_SHADOW};"><p style="margin:0;font-size:17px;line-height:1.65;letter-spacing:.01em;font-weight:600;text-align:center;text-indent:0;color:${AOZORA_INK_STRONG};">${inner}</p></section>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;padding:20px 22px;${AOZORA_GLASS_FILL}border:1px solid ${AOZORA_GLASS_STROKE};border-radius:24px;box-shadow:${AOZORA_GLASS_SHADOW};"><p style="margin:0;font-size:18px;line-height:1.65;letter-spacing:.01em;font-weight:500;text-align:center;text-indent:0;color:${AOZORA_INK_STRONG};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;padding:18px 22px;${AOZORA_GLASS_FILL}border:1px solid ${AOZORA_GLASS_STROKE};border-radius:24px;box-shadow:${AOZORA_GLASS_SHADOW};">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-size:15.5px;line-height:1.8;letter-spacing:.01em;text-align:justify;text-indent:0;color:${AOZORA_INK};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    // Yoru 的决定：系统禁止真实照片，图片按普通图片展示，不额外套一层玻璃框。
    const capStyle = `margin:8px 20px 30px;font-family:${AOZORA_MONO};font-size:11px;line-height:1.6;letter-spacing:.16em;text-align:center;text-indent:0;color:${AOZORA_MUTED};`
    const cap = `<p style="${capStyle}">${figureCaption(caption, `font-family:${AOZORA_MONO};font-size:11px;color:${AOZORA_BLUE_INK};letter-spacing:.08em;`, 'letter-spacing:.16em;')}</p>`
    if (!src) {
      return `<p style="margin:26px 20px;font-family:${AOZORA_MONO};font-size:11px;line-height:1.6;letter-spacing:.16em;text-align:center;text-indent:0;color:${AOZORA_MUTED};">${plainCaption(caption)}</p>`
    }
    return `<p style="margin:30px 20px 10px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid ${AOZORA_GLASS_STROKE};border-radius:20px;box-shadow:0 6px 18px rgba(10,68,140,.12);" /></p>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 10px;font-family:${AOZORA_DISPLAY};font-size:15px;line-height:1.4;letter-spacing:-.01em;text-align:left;text-indent:0;color:${AOZORA_INK_STRONG};font-weight:700;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 14px;font-family:${AOZORA_SANS};font-size:11px;line-height:1.5;letter-spacing:.08em;text-align:center;text-indent:0;color:${AOZORA_MUTED};"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${AOZORA_GLASS_STROKE};border-radius:20px;`,
      placeholderBorder: AOZORA_HAIRLINE,
      placeholderBg: '#EEF3F8',
      hintColor: AOZORA_MUTED,
      captionColor: AOZORA_MUTED,
    })
    const cap = `<p style="margin:12px 20px 30px;font-family:${AOZORA_MONO};font-size:11px;line-height:1.6;letter-spacing:.16em;text-align:center;text-indent:0;color:${AOZORA_MUTED};">${items.every((it) => !it.src) ? plainCaption(caption) : figureCaption(caption, `font-family:${AOZORA_MONO};font-size:11px;color:${AOZORA_BLUE_INK};letter-spacing:.08em;`, 'letter-spacing:.16em;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:16px;border-top:1px solid ${AOZORA_HAIRLINE};"><p style="margin:0;font-family:${AOZORA_MONO};font-size:10.5px;line-height:1.7;letter-spacing:.12em;text-indent:0;color:${AOZORA_FAINT};"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:8px 0 0;font-family:${AOZORA_MONO};font-size:10px;line-height:1.5;letter-spacing:.24em;text-indent:0;color:${AOZORA_FAINT};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:16px;line-height:1.75;letter-spacing:.01em;color:${AOZORA_INK};list-style-type:${ordered ? 'decimal' : 'disc'};">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:26px 20px;">${baseTableBlock(head, rows, align, {
      accent: AOZORA_INK_STRONG,
      border: AOZORA_HAIRLINE,
      headBg: '#EEF3F8',
      text: AOZORA_INK,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:16px 18px;background-color:#07090E;border:1px solid rgba(255,255,255,.14);border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.20),0 6px 18px rgba(10,68,140,.14);overflow-x:hidden;"><p style="margin:0;font-family:${AOZORA_MONO};font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#F7FAFD;white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:40px 20px;border-top:1px solid ${AOZORA_HAIRLINE};"><span leaf=""><br></span></section>`,

  footnoteRef: (index) =>
    `<span style="font-family:${AOZORA_MONO};font-size:10px;line-height:1;color:${AOZORA_BLUE_INK};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: AOZORA_FOOTNOTES,

  gallery: AOZORA_GALLERY,
}

// ============================================================
// 银 · KIHON 基本 Design System（gin）
// ============================================================

const KIHON_PAGE = '#E7E9EB'
const KIHON_WELL = '#DDE0E3'
const KIHON_PLATE = '#EDEFF1'
const KIHON_CARD = '#F4F5F6'
const KIHON_CONTROL = '#FAFBFB'
const KIHON_INK = '#16191C'
const KIHON_MUTED = '#5A636B'
const KIHON_FAINT = '#8D969D'
const KIHON_LINE = '#C8CDD1'
const KIHON_ACCENT = '#2B4C6F'
const KIHON_ACCENT_SOFT = '#DCE3EB'
const KIHON_RAMP_2 = '#8E979E'

const KIHON_DISPLAY =
  "'Instrument Sans','Helvetica','Arial','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif"
const KIHON_MONO =
  "'B612 Mono','Menlo','Consolas','PingFang SC','Microsoft YaHei',monospace"

/** 两段式 chamfer + 三层定向阴影：上亮下暗，金属面保留 1px 线，不做软阴影新拟态。 */
const KIHON_CARD_SHADOW =
  'box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 2px 0 rgba(255,255,255,.42),inset 0 -1px 0 rgba(22,25,28,.22),inset 0 -2px 0 rgba(22,25,28,.07),0 1px 1px rgba(22,25,28,.10),0 3px 6px rgba(22,25,28,.09),0 14px 34px rgba(22,25,28,.10);'
const KIHON_PLATE_SHADOW =
  'box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 2px 0 rgba(255,255,255,.42),inset 0 -1px 0 rgba(22,25,28,.22),inset 0 -2px 0 rgba(22,25,28,.07),0 1px 1px rgba(22,25,28,.08),0 2px 4px rgba(22,25,28,.06),0 8px 20px rgba(22,25,28,.06);'
const KIHON_WELL_SHADOW =
  'box-shadow:inset 0 3px 6px rgba(10,12,14,.22),inset 0 1px 2px rgba(10,12,14,.18),inset 0 -1px 0 rgba(255,255,255,.95),inset 0 -2px 0 rgba(255,255,255,.42);'
const KIHON_CARD_FILL =
  `background-color:${KIHON_CARD};background-image:linear-gradient(180deg,#F6F7F8 0%,#F3F4F5 100%);`
const KIHON_PLATE_FILL =
  `background-color:${KIHON_PLATE};background-image:linear-gradient(180deg,#F0F2F3 0%,#EDEFF1 100%);`
const KIHON_WELL_FILL =
  `background-color:${KIHON_WELL};background-image:linear-gradient(180deg,#DADDE0 0%,#DFE2E5 100%);`
/** 刻字：标签、编号、图号共用，凹槽下唇接光。 */
const KIHON_ENGRAVE = 'text-shadow:0 1px 0 rgba(255,255,255,.85);'

/** Rule：一条普通 1px 线；2026-10-31 起不用两端 5px 竖向刻点。 */
function kihonRule(margin: string): string {
  return `<section style="margin:${margin};height:1px;background-color:${KIHON_LINE};font-size:0;line-height:0;"></section>`
}

/** Divider：一条普通 1px 线；2026-10-31 起不用齿纹带。 */
function kihonDivider(margin: string): string {
  return `<section style="margin:${margin};border-top:1px solid ${KIHON_LINE};"><span leaf=""><br></span></section>`
}

function kihonSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:${KIHON_MONO};font-size:12.5px;line-height:1.6;background:${KIHON_CONTROL};border:1px solid ${KIHON_LINE};padding:1px 5px;border-radius:6px;color:${KIHON_INK};">${inner}</span>`
  }
  if (s.italic) inner = `<em style="font-style:italic;">${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;color:${KIHON_FAINT};">${inner}</span>`
  if (s.link) {
    inner = `<span style="color:${KIHON_ACCENT};border-bottom:1px solid rgba(43,76,111,.45);">${inner}</span>`
  }
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;color:${KIHON_INK};">${inner}</strong>`
  if (s.mark) {
    // 浅金属凹槽 + 1px 底线（PROPOSAL）；不用黄色荧光笔，也不把 accent 当高亮底。
    inner = `<span style="font-weight:500;color:${KIHON_INK};background:${KIHON_ACCENT_SOFT};border-bottom:1px solid ${KIHON_RAMP_2};padding:0 .04em;">${inner}</span>`
  }
  return inner
}

const KIHON_GALLERY = galleryBlock({
  marginTop: '30px',
  titleStyle: `font-family:${KIHON_DISPLAY};font-size:14px;line-height:1.4;letter-spacing:-.01em;text-align:left;text-indent:0;color:${KIHON_INK};font-weight:700;`,
  captionStyle: `font-family:${KIHON_DISPLAY};font-size:12px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${KIHON_MUTED};`,
  numStyle: `font-family:${KIHON_MONO};font-size:12px;color:${KIHON_ACCENT};letter-spacing:0;font-variant-numeric:tabular-nums;text-shadow:0 1px 0 rgba(255,255,255,.85);`,
  restStyle: 'letter-spacing:0;',
  cellCaptionStyle: `font-family:${KIHON_DISPLAY};font-size:11.5px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${KIHON_MUTED};`,
  placeholderBorder: KIHON_LINE,
  placeholderBg: KIHON_WELL,
  hintColor: KIHON_MUTED,
  imgStyle: `border:1px solid ${KIHON_LINE};border-radius:10px;box-shadow:0 1px 1px rgba(22,25,28,.10),0 3px 6px rgba(22,25,28,.09),0 14px 34px rgba(22,25,28,.10);`,
})

const KIHON_FOOTNOTES = footnotesBlock({
  rule: `1px solid ${KIHON_LINE}`,
  labelStyle: `font-family:${KIHON_MONO};font-size:10px;line-height:1.5;letter-spacing:.14em;text-transform:uppercase;color:${KIHON_ACCENT};text-indent:0;${KIHON_ENGRAVE}`,
  rowStyle: `font-family:${KIHON_DISPLAY};font-size:11.5px;line-height:1.7;letter-spacing:0;color:${KIHON_MUTED};text-align:left;text-indent:0;word-break:break-all;`,
})

export const kihonGinTheme: Theme & ThemeExtensions = {
  id: 'kihon-gin',
  name: '银',
  desc: 'KIHON · 银灰金属',
  category: '商务',
  ui: { accent: KIHON_ACCENT, soft: KIHON_ACCENT_SOFT, ink: KIHON_INK },
  meta: designMeta(
    'KIHON 基本 Design System',
    'KIHON 基本 Design System/',
    '只做银 gin：五档金属面、1px 线与两段 chamfer、刻字标签、等宽章节号与 tabular 数字；正文按 677/1920 换算成 15.5px，中文不套等宽栈；页面不铺颗粒，帧边缘不加标签条与刻度装饰。',
    { styles: ['商务', '科技'], complexity: 2, color: '中性' },
  ),

  // 页面：银灰底 + 约 1.5% 竖向拉丝渐变 + 镜头式 falloff；不铺颗粒，避免微信转色后发脏。
  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background-color:${KIHON_PAGE};background-image:radial-gradient(125% 105% at 50% 30%,rgba(255,255,255,0) 42%,rgba(10,12,14,.05) 100%),linear-gradient(180deg,#E9EBED 0%,#E7E9EB 100%);color:${KIHON_INK};line-height:1.7;letter-spacing:.01em;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: kihonSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 24px;font-size:15.5px;line-height:1.7;letter-spacing:.01em;text-align:justify;text-indent:0;color:${KIHON_INK};">${inner}</p>`,

  heading: (num, kicker, title) => {
    if (num == null) {
      const label = kicker
        ? `<p style="margin:0 0 10px;font-family:${KIHON_MONO};font-size:10px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;text-indent:0;color:${KIHON_MUTED};${KIHON_ENGRAVE}"><span leaf="">${esc(kicker)}</span></p>`
        : ''
      // H1 是一块 card 面：标题 88→31px，Bold 700 对 Light 副题的字重轴只保留标题端。
      return `<section style="margin:0 20px 30px;padding:18px 20px;${KIHON_CARD_FILL}border:1px solid ${KIHON_LINE};border-radius:10px;${KIHON_CARD_SHADOW}">${label}<h1 style="margin:0;font-family:${KIHON_DISPLAY};font-size:31px;line-height:1.12;letter-spacing:-.015em;font-weight:700;color:${KIHON_INK};"><span leaf="">${esc(title)}</span></h1>${kihonRule('12px 0 0')}</section>`
    }
    // 编号用等宽 `01 / kicker` 标签加一条普通 1px 线，不写「第几章」的汉字。
    const numText = String(num).padStart(2, '0')
    const label = `<p style="margin:0 0 8px;font-family:${KIHON_MONO};font-size:10.5px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;text-indent:0;color:${KIHON_ACCENT};${KIHON_ENGRAVE}"><span leaf=""><span style="font-weight:700;">${numText}</span>${kicker ? `<span style="color:${KIHON_MUTED};"> / ${esc(kicker)}</span>` : ''}</span></p>`
    return `<section style="margin:44px 20px 20px;">${label}${kihonRule('0 0 12px')}<h2 style="margin:0;font-family:${KIHON_DISPLAY};font-size:21px;line-height:1.3;letter-spacing:-.015em;font-weight:700;color:${KIHON_INK};"><span leaf="">${esc(title)}</span></h2></section>`
  },

  subheading: (title) =>
    `<h3 style="margin:32px 20px 12px;padding-bottom:7px;border-bottom:1px solid ${KIHON_LINE};font-family:${KIHON_DISPLAY};font-size:17px;line-height:1.4;letter-spacing:-.01em;font-weight:700;color:${KIHON_INK};"><span leaf="">${esc(title)}</span></h3>`,

  center: (inner) =>
    `<p style="margin:28px 20px;font-family:${KIHON_DISPLAY};font-size:19px;line-height:1.5;letter-spacing:0;font-weight:300;text-align:center;text-indent:0;color:${KIHON_INK};${KIHON_ENGRAVE}">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;padding:18px 20px;${KIHON_WELL_FILL}border:1px solid ${KIHON_LINE};border-radius:8px;${KIHON_WELL_SHADOW}"><p style="margin:0;font-family:${KIHON_DISPLAY};font-size:18px;line-height:1.55;letter-spacing:0;font-weight:400;text-align:center;text-indent:0;color:${KIHON_INK};">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;padding:16px 18px;${KIHON_WELL_FILL}border:1px solid ${KIHON_LINE};border-radius:8px;${KIHON_WELL_SHADOW}">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '10px 0 0'};font-size:15.5px;line-height:1.75;letter-spacing:.01em;text-align:justify;text-indent:0;color:${KIHON_INK};">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) => {
    // 图片放在 card 面：1px 线、10px 圆角、两段 chamfer 与三层定向阴影；图片本身不倾斜、不裁成异形。
    const capStyle = `margin:8px 20px 30px;font-family:${KIHON_DISPLAY};font-size:12px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${KIHON_MUTED};`
    const cap = `<p style="${capStyle}">${figureCaption(caption, `font-family:${KIHON_MONO};font-size:12px;color:${KIHON_ACCENT};letter-spacing:0;font-variant-numeric:tabular-nums;${KIHON_ENGRAVE}`, 'letter-spacing:0;')}</p>`
    if (!src) {
      return `<p style="margin:26px 20px;font-family:${KIHON_DISPLAY};font-size:12px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${KIHON_MUTED};">${plainCaption(caption)}</p>`
    }
    return `<section style="margin:30px 20px 10px;padding:8px;${KIHON_CARD_FILL}border:1px solid ${KIHON_LINE};border-radius:10px;${KIHON_CARD_SHADOW}"><img src="${esc(src)}" style="display:block;max-width:100%;height:auto;margin:0 auto;border:1px solid ${KIHON_LINE};border-radius:6px;" /></section>${cap}`
  },

  carousel: (title, caption, items, ratio) => {
    const head = title
      ? `<p style="margin:0 20px 8px;font-family:${KIHON_DISPLAY};font-size:14px;line-height:1.4;letter-spacing:-.01em;text-align:left;text-indent:0;color:${KIHON_INK};font-weight:700;"><span leaf="">${esc(title)}</span></p>`
      : ''
    const hint = `<p style="margin:0 20px 10px;font-family:${KIHON_MONO};font-size:10px;line-height:1.6;letter-spacing:.14em;text-transform:uppercase;text-align:left;text-indent:0;color:${KIHON_MUTED};${KIHON_ENGRAVE}"><span leaf="">${SLIDE_HINT}</span></p>`
    const body = carouselStrip(items, ratio, {
      imgStyle: `max-width:100%;border:1px solid ${KIHON_LINE};border-radius:10px;`,
      placeholderBorder: KIHON_LINE,
      placeholderBg: KIHON_WELL,
      hintColor: KIHON_MUTED,
      captionColor: KIHON_MUTED,
    })
    const cap = `<p style="margin:12px 20px 30px;font-family:${KIHON_DISPLAY};font-size:12px;line-height:1.5;letter-spacing:0;text-align:left;text-indent:0;color:${KIHON_MUTED};">${items.every((it) => !it.src) ? plainCaption(caption) : figureCaption(caption, `font-family:${KIHON_MONO};font-size:12px;color:${KIHON_ACCENT};letter-spacing:0;font-variant-numeric:tabular-nums;${KIHON_ENGRAVE}`, 'letter-spacing:0;')}</p>`
    return `<section style="margin:0;">${head}${hint}</section>${body}${cap}`
  },

  signature: (cfg) =>
    `<section style="margin:40px 20px 0;padding-top:14px;border-top:1px solid ${KIHON_LINE};"><p style="margin:0;font-family:${KIHON_MONO};font-size:10.5px;line-height:1.7;letter-spacing:.12em;text-indent:0;color:${KIHON_MUTED};${KIHON_ENGRAVE}"><span leaf="">${t('render.sigLayout')} ${esc(cfg.layout)} · ${t('render.sigProof')} ${esc(cfg.proof)} · ${t('render.sigReview')} ${esc(cfg.review)}</span></p><p style="margin:8px 0 0;font-family:${KIHON_MONO};font-size:10px;line-height:1.5;letter-spacing:.18em;text-indent:0;color:${KIHON_ACCENT};"><span leaf="">${END_MARK}</span></p></section>`,

  listBlock: (ordered, items, start = 1) => {
    const tag = ordered ? 'ol' : 'ul'
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
    // 无序列表用系统的 `·` 圆点；有序列表保持两位补零。
    const rows = items
      .map((it) =>
        ordered
          ? `<li style="margin:6px 0;">${it}</li>`
          : `<li style="margin:6px 0;list-style-type:none;"><span leaf="" style="color:${KIHON_MUTED};">·</span> ${it}</li>`,
      )
      .join('')
    return `<${tag}${startAttr} style="margin:0 20px 24px;padding-left:1.5em;font-size:15.5px;line-height:1.7;letter-spacing:.01em;color:${KIHON_INK};list-style-type:${ordered ? 'decimal-leading-zero' : 'none'};">${rows}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    `<section style="margin:26px 20px;padding:8px;${KIHON_PLATE_FILL}border:1px solid ${KIHON_LINE};border-radius:10px;${KIHON_PLATE_SHADOW}">${baseTableBlock(head, rows, align, {
      accent: KIHON_INK,
      border: KIHON_LINE,
      headBg: KIHON_PLATE,
      text: KIHON_INK,
    })}</section>`,

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:14px 16px;${KIHON_WELL_FILL}border:1px solid ${KIHON_LINE};border-radius:8px;${KIHON_WELL_SHADOW}overflow-x:hidden;"><p style="margin:0;font-family:${KIHON_MONO};font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:${KIHON_INK};white-space:pre-wrap;word-wrap:break-word;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () => kihonDivider('40px 20px'),

  footnoteRef: (index) =>
    `<span style="font-family:${KIHON_MONO};font-size:10px;line-height:1;color:${KIHON_ACCENT};vertical-align:super;"><span leaf="">[${index}]</span></span>`,

  footnotes: KIHON_FOOTNOTES,

  gallery: KIHON_GALLERY,
}

export const DESIGN_THEMES: Theme[] = [
  yoruTypeTheme,
  paperEditorialTheme,
  consoleAkariTheme,
  kunlunSnowlineTheme,
  riftDaybreakTheme,
  coreFrostTheme,
  aozoraDaylightTheme,
  kihonGinTheme,
]