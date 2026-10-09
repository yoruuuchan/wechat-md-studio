/**
 * Block-based mapping between Markdown source lines and rendered blocks.
 *
 * Scroll sync cannot use a percentage of total height: the editor is monospace
 * source and the preview is proportional type with images, so the same fraction
 * of each pane lands on completely different content. Instead both panes are
 * described as "block i, this far through it", and these three functions are the
 * whole translation layer.
 *
 * Every function assumes `blocks` is sorted by `line`, which parseMarkdown
 * guarantees by emitting in document order.
 */

interface Spanned {
  line: number
  lineEnd?: number
}

/**
 * The source line range block i is measured over.
 *
 * The upper bound is where the *next* block starts rather than this block's own
 * `lineEnd`: a paragraph occupying three source lines usually renders as six
 * screen lines, and the gap between blocks is what both panes actually agree on.
 * The last block has no next, so it falls back to its own end.
 */
export function rangeOf(blocks: Spanned[], i: number): { start: number; end: number } {
  const start = blocks[i]?.line ?? 0
  const end = blocks[i + 1]?.line ?? blocks[i]?.lineEnd ?? start + 1
  return { start, end: Math.max(end, start + 1) }
}

/** Index of the last block that starts at or before `line`; -1 when there is none. */
export function blockIndexAtLine(blocks: Spanned[], line: number): number {
  let lo = 0
  let hi = blocks.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (blocks[mid].line <= line) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** How far `line` sits through block i's source range, 0..1. */
export function progressInBlock(blocks: Spanned[], i: number, line: number): number {
  const { start, end } = rangeOf(blocks, i)
  return Math.min(1, Math.max(0, (line - start) / (end - start)))
}

/** Inverse of progressInBlock: the source line for a point `frac` through block i. */
export function lineAtProgress(blocks: Spanned[], i: number, frac: number): number {
  const { start, end } = rangeOf(blocks, i)
  const clamped = Math.min(1, Math.max(0, frac))
  return Math.round(start + clamped * (end - start))
}

/**
 * Where a pixel offset sits inside the pixel span [start, end], as 0..1.
 *
 * A block's extent is measured in pixels on both sides - the editor's lines are
 * not all one screen row tall (a wrapped line is three or four), and the preview
 * is proportional type with images - so a fraction may only be compared with
 * another fraction of the same block. Counting source lines instead mixed two
 * different rulers, and how badly they disagreed depended on how much the editor
 * happened to wrap, which is exactly what a narrow window changes.
 *
 * A collapsed span (a block that rendered to the same pixel as its neighbour)
 * reports 0 rather than dividing by zero.
 */
export function fractionInSpan(value: number, start: number, end: number): number {
  const span = end - start
  if (!(span > 0)) return 0
  return Math.min(1, Math.max(0, (value - start) / span))
}

/** Inverse of fractionInSpan: the pixel offset `frac` of the way through [start, end]. */
export function pointInSpan(frac: number, start: number, end: number): number {
  const span = Math.max(0, end - start)
  return start + Math.min(1, Math.max(0, frac)) * span
}

/**
 * Turn a list of "child index of block i" into the same list with holes filled.
 *
 * A block that emitted no element (an empty paragraph, say) keeps -1 from the
 * renderer; scrolling to it should land on the previous block instead of jumping
 * to the top of the article.
 */
export function fillBlockOffsets(offsets: number[]): number[] {
  const out: number[] = []
  let last = 0
  for (const o of offsets) {
    if (o >= 0) last = o
    out.push(last)
  }
  return out
}
