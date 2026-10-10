import { esc, type Theme } from './themes'
import type { CarouselRatio } from './types'
import { t } from './i18n'

/**
 * Capabilities a theme may optionally implement.
 *
 * Declared here rather than on `Theme` itself so new block kinds can ship
 * without editing the theme files: every theme in the catalog keeps working
 * through the defaults below, and a theme that wants its own look adds the
 * method later. With two hundred-odd themes now generated from imported specs,
 * one default here is the difference between a block that ships and a block that
 * needs two hundred edits. It also keeps the theme files free to change
 * underneath us - the renderer never requires a method a theme must provide.
 */
export interface ThemeExtensions {
  /** Superscript marker left behind where a link used to be. */
  footnoteRef?(index: number): string
  /** The reference list appended to the end of the article. */
  footnotes?(items: FootnoteItem[]): string
  /** A display equation. `inner` is rendered SVG, or a pending TeX placeholder. */
  math?(tex: string, inner: string, display: boolean): string
  /** A multi-image grid. `items` arrive already resolved to real URLs. */
  gallery?(
    title: string,
    caption: string,
    items: { src: string; alt: string }[],
    ratio: CarouselRatio,
    cols: number,
  ): string
}

export type ExtendedTheme = Theme & ThemeExtensions

export interface FootnoteItem {
  index: number
  /** Link text, kept so the reader can tell two references to the same host apart. */
  text: string
  url: string
}

/**
 * WeChat makes body links unclickable, so a link rendered as coloured text loses
 * the URL outright - the reader has no way to recover it. Numbering the link in
 * place and listing the URLs at the end keeps the citation reachable on paper.
 */
export function defaultFootnoteRef(index: number): string {
  return `<span style="font-size:11px;line-height:1;color:#1677FF;vertical-align:super;"><span leaf="">[${index}]</span></span>`
}

export function defaultFootnotes(items: FootnoteItem[]): string {
  const rows = items
    .map(
      (f) =>
        `<p style="margin:6px 0 0;font-size:12px;line-height:1.7;letter-spacing:.5px;color:#888888;text-align:left;text-indent:0;word-break:break-all;"><span leaf="">${f.index}. ${esc(f.url)}</span></p>`,
    )
    .join('')
  return `<section style="margin:0;padding-top:14px;border-top:1px solid #E6EDF6;"><p style="margin:0;font-size:12px;line-height:1.5;letter-spacing:2px;color:#888888;text-indent:0;"><span leaf="">${t('render.refsHeading')}</span></p>${rows}</section>`
}

/**
 * A display equation, centred like every other display element.
 *
 * The explicit `color` is load-bearing: MathJax's glyphs are drawn with
 * `currentColor`, and the WeChat paste target's inherited colour is not something
 * we control. Measured to survive the paste with the colour set this way.
 */
export function defaultMath(_tex: string, inner: string, _display: boolean): string {
  return `<section style="margin:0;padding:12px 0;color:#1F2937;text-align:center;text-indent:0;overflow-x:auto;">${inner}</section>`
}

/**
 * What the author sees when a formula does not compile.
 *
 * MathJax's own default is to typeset the problem as a red merror box holding a
 * mirrored <text> node and a data-mjx-error attribute - markup that would be
 * pasted straight into the article. The renderer rethrows instead and shows the
 * TeX back. Same one-paragraph shape as the pending placeholder in render.ts, so
 * the block mapping does not shift when a formula fails.
 */
export function mathFailure(tex: string): string {
  return `<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:#B42318;text-align:center;text-indent:0;word-break:break-all;"><span leaf="">${t('render.mathError')} ${esc(tex)}</span></p>`
}

/** Every theme caps its root at this width, which is all a placeholder cell needs to size itself. */
const GALLERY_NOMINAL_WIDTH = 677
/** Gap between cells, as a percentage of the container so it scales with the column. */
const GALLERY_GAP = 2

/**
 * A multi-image grid.
 *
 * Percentage-width inline-block cells are not a stylistic choice, they are the
 * only layout that survives the paste: WeChat's editor drops `display:grid` and
 * `float`, `object-fit` would crop content away from an image whose shape does
 * not match the cell, and a fixed height letterboxes it instead. So cells take a
 * percentage of the row and the image inside takes `width:100%;height:auto`.
 *
 * Cell widths round *down*: a row whose percentages sum to just over 100 wraps
 * its last cell onto the next line, which reads as a broken grid rather than as
 * slightly tighter gutters.
 *
 * What makes the rows land even is the crop, not the markup. The `width` and
 * `height` attributes only hold the space open until the file loads and stop the
 * page jumping; measured in Chrome, an image whose own shape differs from those
 * attributes still renders at its own ratio (a 1:2 source in a 4:3 cell came out
 * 222px tall beside an 83px neighbour). So evenness comes from every image in one
 * gallery being cropped to the fence ratio at upload time.
 *
 * The consequence is worth stating rather than hiding: an image that reaches a
 * cell by some other route — a hand-written URL, or one pushed through the agent
 * API — keeps its own shape and its row goes ragged. There is no markup-level fix
 * inside the platform's rules, since the two available ones are exactly the
 * `object-fit` and fixed-height tricks WeChat discards.
 */
export function defaultGallery(
  title: string,
  caption: string,
  items: { src: string; alt: string }[],
  ratio: CarouselRatio,
  cols: number,
): string {
  const columns = Math.max(1, cols)
  const cellW = Math.floor(((100 - GALLERY_GAP * (columns - 1)) / columns) * 1000) / 1000
  const [rw, rh] = ratio.split(':').map(Number)
  // Only the placeholder needs a pixel height: a percentage-wide cell has no
  // intrinsic height, and centring a label in it would take absolute positioning.
  const placeholderH = Math.round(((GALLERY_NOMINAL_WIDTH * cellW) / 100 / rw) * rh)
  const lastRowStart = Math.floor((items.length - 1) / columns) * columns

  const head = title
    ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#1F2937;font-weight:700;"><span leaf="">${esc(title)}</span></p>`
    : ''

  const cells = items
    .map((it, i) => {
      const cellStyle = [
        `width:${cellW}%`,
        'display:inline-block',
        'vertical-align:top',
        'box-sizing:border-box',
        // No gutter after the last cell in a row, none under the last row: the
        // outer margin already provides the space around the whole grid.
        (i + 1) % columns === 0 ? '' : `margin-right:${GALLERY_GAP}%`,
        i >= lastRowStart ? '' : `margin-bottom:${GALLERY_GAP}%`,
      ]
        .filter(Boolean)
        .join(';')
      const body = it.src
        ? `<img src="${esc(it.src)}" width="${rw * 100}" height="${rh * 100}" style="display:block;width:100%;height:auto;" />`
        : `<section style="width:100%;height:${placeholderH}px;box-sizing:border-box;border:1px dashed #B9DAFF;background:#F6FAFF;display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:#888888;text-indent:0;text-align:center;"><span leaf="">${t('theme.pendingImage')}</span></p></section>`
      const cap = it.alt
        ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.5;letter-spacing:0.5px;text-align:center;text-indent:0;color:#888888;"><span leaf="">${esc(it.alt)}</span></p>`
        : ''
      return `<section style="${cellStyle}">${body}${cap}</section>`
    })
    .join('')

  const grid = `<section style="margin:0;">${cells}</section>`
  const cap = `<p style="margin:12px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#888888;"><span leaf="">${esc(caption)}</span></p>`
  return `<section style="margin:24px 0 0;">${head}${grid}</section>${cap}`
}

/** Read an optional theme method, falling back to the default implementation. */
export function ext(theme: Theme): Required<ThemeExtensions> {
  const t = theme as ExtendedTheme
  return {
    footnoteRef: t.footnoteRef ?? defaultFootnoteRef,
    footnotes: t.footnotes ?? defaultFootnotes,
    math: t.math ?? defaultMath,
    gallery: t.gallery ?? defaultGallery,
  }
}
