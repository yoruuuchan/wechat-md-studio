// 语义 IR：Markdown 解析后的中间结构，与任何视觉样式无关。
// 主题渲染器只消费这些节点，新增主题不需要改稿件。

export interface InlineSeg {
  text: string // '\n' 表示段内换行
  bold?: boolean
  mark?: boolean // ==下划线重点==
  code?: boolean
  italic?: boolean
  strike?: boolean
  link?: string // 公众号正文外链不可点，渲染降级并产生警告
}

export type CellAlign = 'left' | 'center' | 'right'

/**
 * Where a block came from, in lines of the full Markdown source.
 *
 * 0-based, `lineEnd` exclusive, and counted from the top of the file rather
 * than from the top of the body — front matter occupies real editor lines, so
 * a body-relative number sends "jump to this image" to the wrong place.
 */
export interface SourceSpan {
  line: number
  lineEnd: number
}

export type Block =
  | ({ type: 'paragraph'; segs: InlineSeg[] } & SourceSpan)
  | ({ type: 'heading'; kicker: string; title: string; numbered: boolean } & SourceSpan) // ## KICKER | 标题
  | ({ type: 'subheading'; title: string } & SourceSpan) // ###
  | ({ type: 'center'; segs: InlineSeg[] } & SourceSpan) // :::center 居中强调句
  | ({ type: 'quoteCard'; segs: InlineSeg[] } & SourceSpan) // > 金句卡片
  | ({ type: 'quoteBox'; paras: InlineSeg[][] } & SourceSpan) // :::quote 引文框
  | ({ type: 'image'; alt: string; src: string; occurrence: number } & SourceSpan) // ![图注](src)
  | ({ type: 'carousel'; title: string; ratio: CarouselRatio; items: CarouselItem[]; occurrence: number } & SourceSpan) // :::carousel [比例] 标题
  | ({ type: 'gallery'; title: string; ratio: CarouselRatio; cols: number; items: CarouselItem[]; occurrence: number } & SourceSpan) // :::gallery [列数] [比例] 标题
  | ({ type: 'signature' } & SourceSpan) // @signature
  | ({ type: 'list'; ordered: boolean; items: InlineSeg[][] } & SourceSpan)
  | ({ type: 'table'; align: CellAlign[]; head: InlineSeg[][]; rows: InlineSeg[][][] } & SourceSpan) // GFM 表格
  | ({ type: 'code'; lang: string; code: string } & SourceSpan)
  | ({ type: 'math'; tex: string; display: boolean } & SourceSpan) // $$…$$ on its own lines
  | ({ type: 'hr' } & SourceSpan)

/**
 * One image inside a multi-image block (carousel or gallery).
 *
 * `occurrence` is the 1-based index of this image among every `![...](...)` in
 * the raw Markdown, counted in document order. It is the only unambiguous way to
 * address one image back in the source: captions repeat, and every image in one
 * block shares a single line number.
 */
export interface CarouselItem {
  alt: string
  src: string
  occurrence: number
}

/** Uniform frame every image in one carousel or gallery is cropped to at upload time. */
export const CAROUSEL_RATIOS = ['4:3', '3:4', '16:9', '9:16', '1:1'] as const

export type CarouselRatio = (typeof CAROUSEL_RATIOS)[number]

export const DEFAULT_CAROUSEL_RATIO: CarouselRatio = '4:3'

export function isCarouselRatio(v: string): v is CarouselRatio {
  return (CAROUSEL_RATIOS as readonly string[]).includes(v)
}

/** Columns a gallery may lay its images out in. One column is just a stack, so it starts at two. */
export const GALLERY_COLS = [2, 3, 4] as const

export const DEFAULT_GALLERY_COLS = 2

/** Square by default: unlike a carousel strip, a grid reads best when cells match. */
export const DEFAULT_GALLERY_RATIO: CarouselRatio = '1:1'

export function isGalleryCols(v: number): v is (typeof GALLERY_COLS)[number] {
  return (GALLERY_COLS as readonly number[]).includes(v)
}

/** "4:3" -> 4/3, used for cropping and for sizing the frame. */
export function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 4 / 3
}

export interface DocMeta {
  titles: string[] // 标题候选，渲染进侧栏而非正文
  cover: string
  author: string
}

export interface Doc {
  meta: DocMeta
  blocks: Block[]
}

export interface RenderStats {
  chars: number
  images: number
  carousels: number
  galleries: number
  warnings: string[]
}

export interface SignatureConfig {
  layout: string // 排版
  proof: string // 校对
  review: string // 审核
}
