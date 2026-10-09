import type { Block, CarouselRatio, Doc, InlineSeg, RenderStats, SignatureConfig } from './types'
import { baseTableBlock, BLANK, esc, type Theme } from './themes'
import { ext, type FootnoteItem } from './theme-fallbacks'
import { diagramOf } from './diagram'
import { fencedRanges, isInFence } from './fences'
import { commentRanges, isInComment } from './comments'

// 盒式模块的前后空行由 pushBlock(boxed=true) 统一插入

/**
 * Numbers every distinct URL once, in the order the reader meets them.
 * The same host cited twice gets one entry, which is what a reference list is for.
 */
function createLinkRegistry() {
  const byUrl = new Map<string, number>()
  const items: FootnoteItem[] = []
  return {
    items,
    register(url: string, text: string): number {
      const seen = byUrl.get(url)
      if (seen) return seen
      const index = items.length + 1
      byUrl.set(url, index)
      items.push({ index, text, url })
      return index
    },
  }
}

type LinkRegistry = ReturnType<typeof createLinkRegistry>

/** A `#fragment` points at nothing once the article is published on its own. */
function isFootnotable(url: string): boolean {
  return url.length > 0 && !url.startsWith('#')
}

function renderSegs(theme: Theme, segs: InlineSeg[], links: LinkRegistry): string {
  const e = ext(theme)
  return segs
    .map((s) => {
      if (s.text === '\n') return '<br/>'
      if (!s.link || !isFootnotable(s.link)) return theme.seg({ ...s, link: undefined })
      // Drop the link styling and leave a number instead: the colour used to
      // promise something tappable, and WeChat delivers nothing.
      return theme.seg({ ...s, link: undefined }) + e.footnoteRef(links.register(s.link, s.text))
    })
    .join('')
}

export type ImageResolver = (src: string) => string
export type MathResolver = (tex: string, display: boolean) => string | null
/** mermaid source -> an uploaded `img:<key>`, or null while it is still pending. */
export type DiagramResolver = (code: string) => string | null

export function renderDoc(
  doc: Doc,
  theme: Theme,
  sig: SignatureConfig,
  resolveImg: ImageResolver = (s) => s,
  resolveMath: MathResolver = () => null,
  resolveDiagram: DiagramResolver = () => null,
): { html: string; stats: RenderStats; blockOffsets: number[] } {
  const warnings: string[] = []
  const links = createLinkRegistry()
  let chars = 0
  let images = 0
  let carousels = 0
  let galleries = 0
  let headingNo = 0
  let imageNo = 0

  // Every part remembers which block produced it. Spacer paragraphs inherit
  // their block's index, so a boxed module maps to the whitespace above it -
  // which is where the eye actually lands when scrolling.
  const parts: { html: string; block: number }[] = []

  const pushBlock = (html: string, boxed: boolean, block: number) => {
    const isFirst = parts.length === 0
    if (boxed && !isFirst) parts.push({ html: BLANK, block })
    parts.push({ html, block })
    if (boxed) parts.push({ html: BLANK, block })
  }

  for (let bi = 0; bi < doc.blocks.length; bi++) {
    const b = doc.blocks[bi]
    switch (b.type) {
      case 'paragraph': {
        chars += countSegs(b.segs)
        warnLinks(b.segs, warnings)
        parts.push({ html: theme.paragraph(renderSegs(theme, b.segs, links)), block: bi })
        break
      }
      case 'heading': {
        headingNo += b.numbered ? 1 : 0
        chars += b.title.length + b.kicker.length
        parts.push({ html: theme.heading(b.numbered ? headingNo : null, b.kicker, b.title), block: bi })
        break
      }
      case 'subheading':
        chars += b.title.length
        parts.push({ html: theme.subheading(b.title), block: bi })
        break
      case 'center':
        chars += countSegs(b.segs)
        warnLinks(b.segs, warnings)
        parts.push({ html: theme.center(renderSegs(theme, b.segs, links)), block: bi })
        break
      case 'quoteCard':
        chars += countSegs(b.segs)
        pushBlock(theme.quoteCard(renderSegs(theme, b.segs, links)), true, bi)
        break
      case 'quoteBox':
        b.paras.forEach((p) => (chars += countSegs(p)))
        pushBlock(theme.quoteBox(b.paras.map((p) => renderSegs(theme, p, links))), true, bi)
        break
      case 'image': {
        images++
        imageNo++
        const alt = b.alt || '未命名图片'
        if (!b.alt) warnings.push(`图${imageNo} 缺少说明文字（![说明](src)）`)
        const caption = `图${imageNo} ${alt}`
        parts.push({ html: theme.imageBlock(b.src ? resolveImg(b.src) : '', caption), block: bi })
        break
      }
      case 'carousel': {
        carousels++
        imageNo++
        images += b.items.length
        if (b.items.length < 2) warnings.push('轮播至少需要 2 张图片')
        const caption = `图${imageNo} ${b.title || '多图轮播'}（共 ${b.items.length} 张）`
        // Carousel slides go through the same resolver as single images; skipping
        // it left `img:key` untouched and the slides rendered as broken images.
        const items = b.items.map((it) => ({ ...it, src: it.src ? resolveImg(it.src) : '' }))
        pushBlock(theme.carousel(b.title, caption, items, b.ratio), true, bi)
        break
      }
      case 'gallery': {
        galleries++
        imageNo++
        images += b.items.length
        if (b.items.length < 2) warnings.push('画廊至少需要 2 张图片')
        const caption = `图${imageNo} ${b.title || '多图网格'}（共 ${b.items.length} 张）`
        // Same resolver as single images and carousel slides: without it the
        // cells keep a raw `img:key` and render as broken images.
        const items = b.items.map((it) => ({ ...it, src: it.src ? resolveImg(it.src) : '' }))
        pushBlock(ext(theme).gallery(b.title, caption, items, b.ratio, b.cols), true, bi)
        break
      }
      case 'signature':
        pushBlock(theme.signature(sig), true, bi)
        break
      case 'list':
        b.items.forEach((it) => {
          chars += countSegs(it)
          warnLinks(it, warnings)
        })
        parts.push({ html: theme.listBlock(b.ordered, b.items.map((it) => renderSegs(theme, it, links))), block: bi })
        break
      case 'table': {
        const cells = [...b.head, ...b.rows.flat()]
        cells.forEach((c) => {
          chars += countSegs(c)
          warnLinks(c, warnings)
        })
        const tableBlock = theme.tableBlock ?? ((h, r, a) => baseTableBlock(h, r, a))
        pushBlock(
          tableBlock(
            b.head.map((c) => renderSegs(theme, c, links)),
            b.rows.map((r) => r.map((c) => renderSegs(theme, c, links))),
            b.align,
          ),
          true,
          bi,
        )
        break
      }
      case 'math': {
        chars += b.tex.length
        const svg = resolveMath(b.tex, b.display)
        // The pending state must emit the same shape as the rendered one, or the
        // block mapping would shift the moment MathJax finishes and the preview
        // would jump under the reader's thumb.
        const inner =
          svg ??
          `<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:#A57427;text-align:center;text-indent:0;word-break:break-all;"><span leaf="">${esc(b.tex)}</span></p>`
        pushBlock(ext(theme).math(b.tex, inner, b.display), true, bi)
        break
      }
      case 'code': {
        const diagram = diagramOf(b.lang)
        const ref = diagram ? resolveDiagram(b.code) : null
        if (diagram && ref) {
          // From here on it is an ordinary figure: same numbering, same block,
          // same place in the materials list as an uploaded photograph.
          images++
          imageNo++
          if (!diagram.title) warnings.push(`图${imageNo} 是图表，可在 \`\`\`mermaid 后面加一句说明`)
          const caption = `图${imageNo} ${diagram.title || '示意图'}`
          parts.push({ html: theme.imageBlock(resolveImg(ref), caption), block: bi })
        } else {
          // Still rasterizing, invalid syntax, or no account to upload with. The
          // source is the useful thing to show in all three cases.
          pushBlock(theme.codeBlock(diagram ? 'mermaid' : b.lang, b.code), true, bi)
        }
        break
      }
      case 'hr':
        parts.push({ html: theme.hr(), block: bi })
        break
    }
  }

  // The reference list aggregates links from the whole article, so it can only be
  // emitted once the walk is done. Block -1: it has no source line of its own and
  // must stay out of the scroll-sync mapping.
  if (links.items.length) pushBlock(ext(theme).footnotes(links.items), true, -1)

  // 收尾：连续空行去重、去掉末尾多余空行
  const cleaned: { html: string; block: number }[] = []
  for (const p of parts) {
    if (p.html === BLANK && cleaned[cleaned.length - 1]?.html === BLANK) continue
    cleaned.push(p)
  }
  while (cleaned.length && cleaned[cleaned.length - 1].html === BLANK) cleaned.pop()

  // Offsets are computed after dedup so each one is a real child index of the
  // root <section>, ready to be matched against the preview DOM. A part is not
  // necessarily one element - theme.carousel returns a heading, a slide strip
  // and a caption as three siblings - so the running index advances by however
  // many top-level elements the part actually contributes.
  const blockOffsets = new Array<number>(doc.blocks.length).fill(-1)
  let childIndex = 0
  for (const p of cleaned) {
    if (p.block >= 0 && blockOffsets[p.block] === -1) blockOffsets[p.block] = childIndex
    childIndex += countRootElements(p.html)
  }

  const html = theme.root(cleaned.map((p) => p.html).join('\n'))
  return { html, stats: { chars, images, carousels, galleries, warnings: [...new Set(warnings)] }, blockOffsets }
}

const VOID_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr',
])

/**
 * How many sibling elements sit at the top level of an HTML fragment.
 *
 * Themes build HTML by string concatenation, so the renderer cannot know from
 * the return type whether it got one element or three. This is the only thing
 * standing between "block i" and "the element block i starts at" in the preview.
 */
export function countRootElements(html: string): number {
  let depth = 0
  let roots = 0
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[1] === '/') {
      depth--
      continue
    }
    if (depth === 0) roots++
    // Void and self-closing tags never open a level.
    if (m[3] === '/' || VOID_TAGS.has(m[2].toLowerCase())) continue
    depth++
  }
  return roots
}

function countSegs(segs: InlineSeg[]): number {
  return segs.reduce((n, s) => n + (s.text === '\n' ? 0 : s.text.length), 0)
}

function warnLinks(segs: InlineSeg[], warnings: string[]) {
  if (segs.some((s) => s.link && isFootnotable(s.link))) {
    warnings.push('检测到链接：公众号正文外链不可点击，已编号并汇总到文末「参考链接」')
  }
}

// 素材清单：逐张图片一行（轮播拆成单张），供后台插图对照与上传回填
export interface MaterialItem {
  no: string // 图N 或 图N-M
  kind: '单图' | '轮播' | '画廊'
  desc: string
  alt: string // Markdown 中的 alt，用于上传后定位回填
  /** Raw src from the Markdown, e.g. `img:<key>`; empty for a placeholder. */
  src: string
  hasSrc: boolean
  line: number
  /**
   * 1-based index of this image among every `![...](...)` in the raw Markdown.
   * Used to address the exact image back in the source — captions are not
   * unique, and every slide in a carousel shares one line number.
   */
  occurrence: number
  /** Set for carousel and gallery items: every image in one block shares this frame. */
  ratio?: CarouselRatio
  /**
   * Index of the carousel block, so the UI can group items of the same carousel
   * under one ratio control.
   *
   * Gallery rows deliberately do not set it. The ordinal is what triggers that
   * grouping, and a gallery's ratio is written in its fence line rather than
   * picked in the panel — so its images belong in the loose list, where each one
   * gets its own upload control and the ratio still arrives via `ratio`.
   */
  carouselOrdinal?: number
}

export function collectMaterials(doc: Doc, resolveDiagram: DiagramResolver = () => null): MaterialItem[] {
  const out: MaterialItem[] = []
  let imageNo = 0
  let carouselNo = 0
  for (const b of doc.blocks) {
    if (b.type === 'code') {
      // A rendered diagram takes a figure number in the article but has no
      // placeholder to fill here, so it is counted and not listed. Counting it
      // is what keeps 图N in this panel agreeing with 图N in the article.
      if (diagramOf(b.lang) && resolveDiagram(b.code)) imageNo++
      continue
    }
    if (b.type === 'image') {
      imageNo++
      out.push({
        no: `图${imageNo}`,
        kind: '单图',
        desc: b.alt || '未命名图片',
        alt: b.alt,
        src: b.src,
        hasSrc: !!b.src,
        line: b.line,
        occurrence: b.occurrence,
      })
    } else if (b.type === 'carousel') {
      imageNo++
      carouselNo++
      b.items.forEach((it, idx) => {
        out.push({
          no: `图${imageNo}-${idx + 1}`,
          kind: '轮播',
          desc: `${b.title ? b.title + ' · ' : ''}${it.alt || '未命名'}`,
          alt: it.alt,
          src: it.src,
          hasSrc: !!it.src,
          line: b.line,
          occurrence: it.occurrence,
          ratio: b.ratio,
          carouselOrdinal: carouselNo,
        })
      })
    } else if (b.type === 'gallery') {
      imageNo++
      b.items.forEach((it, idx) => {
        out.push({
          no: `图${imageNo}-${idx + 1}`,
          kind: '画廊',
          desc: `${b.title ? b.title + ' · ' : ''}${it.alt || '未命名'}`,
          alt: it.alt,
          src: it.src,
          hasSrc: !!it.src,
          line: b.line,
          occurrence: it.occurrence,
          ratio: b.ratio,
        })
      })
    }
  }
  return out
}

/**
 * Locate the exact `![alt](...)` that `occurrence` refers to.
 *
 * The old implementation searched by "nearest line number, then first line whose
 * text contains the caption". Both halves are wrong once captions repeat:
 * a carousel hands every slide the same line, and several images may share a
 * caption, so the search silently edited whichever match it hit first. We now
 * count `![...](` in document order and pick the Nth — the same order the
 * parser numbered them in.
 *
 * Returns null when the index does not exist, so callers can report a failure
 * instead of quietly writing to the wrong image.
 */
interface ImageSpan {
  start: number
  openEnd: number // index just past the opening `![alt](`
  end: number // index of the closing `)`
  alt: string // caption as it appears in the source
}

function findImageSpan(content: string, occurrence: number): ImageSpan | null {
  if (occurrence < 1) return null
  const fences = fencedRanges(content)
  const comments = commentRanges(content, fences)
  const re = /!\[([^\]]*)\]\(/g
  let m: RegExpExecArray | null
  let seen = 0
  while ((m = re.exec(content))) {
    // Must match parse.ts's scanImageOccurrences exactly: the occurrence number
    // comes from there, so skipping a different set of matches here would send
    // an uploaded key to the wrong image. parse.ts counts over the blanked body,
    // where a comment's `![…](…)` is already spaces — this is the same rule
    // applied to the untouched source.
    if (isInFence(fences, m.index) || isInComment(comments, m.index)) continue
    seen++
    if (seen !== occurrence) continue
    const start = m.index
    const openEnd = m.index + m[0].length
    const end = content.indexOf(')', openEnd)
    if (end < 0) return null
    return { start, openEnd, end, alt: m[1].trim() }
  }
  return null
}

/**
 * Address one image by its document-order index, checking the caption matches.
 *
 * The index alone is enough to find the Nth `![`, but if the user typed a new
 * image above it the index shifts and we would edit a stranger. Comparing the
 * caption turns that silent corruption into a refused edit.
 */
function locate(content: string, alt: string, occurrence: number): ImageSpan | null {
  const span = findImageSpan(content, occurrence)
  if (!span) return null
  if (span.alt !== alt.trim()) return null
  return span
}

/**
 * Fill the src of the addressed image. Returns the content unchanged when the
 * occurrence cannot be found — the caller is expected to surface that as an
 * error rather than assume success.
 */
export function fillImageSrc(content: string, alt: string, occurrence: number, src: string): string {
  const span = locate(content, alt, occurrence)
  if (!span) return content
  return content.slice(0, span.openEnd) + src + content.slice(span.end)
}

/**
 * Clear the src of one `![alt](...)`, turning it back into a placeholder.
 * Used by 删除 for carousel slides, where the slide line itself should stay so
 * the carousel keeps its shape.
 */
export function clearImageSrc(content: string, alt: string, occurrence: number): string {
  const span = locate(content, alt, occurrence)
  if (!span) return content
  return content.slice(0, span.openEnd) + content.slice(span.end)
}

/**
 * Remove one whole image line / block.
 * A standalone image is a block on its own line, so the line goes; an image
 * inside a carousel is one slide, handled by clearImageSrc instead.
 */
export function removeImageLine(content: string, alt: string, occurrence: number): string {
  const span = locate(content, alt, occurrence)
  if (!span) return content
  const lineStart = content.lastIndexOf('\n', span.start) + 1
  const lineEnd = content.indexOf('\n', span.end)
  // Keep the rest of the line: only drop it when the image is the whole line.
  const before = content.slice(lineStart, span.start).trim()
  const after = content.slice(span.end + 1, lineEnd < 0 ? content.length : lineEnd).trim()
  if (before || after) {
    // Image shares its line with text — remove just the image syntax.
    return content.slice(0, span.start) + content.slice(span.end + 1)
  }
  const cutFrom = lineStart
  let cutTo = lineEnd < 0 ? content.length : lineEnd + 1
  // Collapse one of the blank lines the image used to occupy.
  if (content.slice(cutTo, cutTo + 1) === '\n' && content.slice(cutFrom - 1, cutFrom) === '\n') {
    cutTo += 1
  }
  return content.slice(0, cutFrom) + content.slice(cutTo)
}

/** Whether the addressed occurrence exists and still carries this caption. */
export function canLocateImage(content: string, alt: string, occurrence: number): boolean {
  return locate(content, alt, occurrence) !== null
}

/**
 * Write the chosen frame ratio into the `:::carousel` opener of a given carousel.
 * The opener carries `:::carousel [比例] 标题`; a later `:::carousel-open` marker
 * found after an earlier ratio belongs to a different carousel.
 */
export function setCarouselRatio(
  content: string,
  occurrence: number,
  ratio: CarouselRatio,
): string {
  const lines = content.split('\n')
  const openers: number[] = []
  const OPEN = /^(\s*:::carousel(?:-open)?)(?![-\w])/
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN.test(lines[i])) continue
    // 在遇到本行之前，若最近一个 :::carousel-close 之后已经有开启器，则该行不是新轮播
    const since = openers.length ? openers[openers.length - 1] : -1
    let hasClose = false
    for (let j = since; j < i; j++) {
      if (/^\s*:::carousel-close\s*$/.test(lines[j])) hasClose = true
    }
    if (!hasClose) openers.push(i)
  }
  const target = openers[occurrence - 1]
  if (target === undefined) return content
  lines[target] = lines[target].replace(
    /^(\s*:::carousel(?:-open)?)(?![-\w])\s*(?:\d+\s*:\s*\d+)?\s*/,
    (_m, head: string) => `${head} ${ratio} `,
  )
  return lines.join('\n')
}

export { esc }
export type { Block }
