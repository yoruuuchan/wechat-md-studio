/**
 * HTML comments as source-only editor notes.
 *
 * `<!-- … -->` is the note syntax the sample article and the editor's slash menu
 * both advertise ("编辑备注，不渲染"): it belongs to the source, not to the
 * article a reader gets. markdown-it runs with `html: false` — raw HTML must
 * never reach the copied payload — so a comment arrives as ordinary text, and
 * without this module it was escaped, shown in the preview and copied into
 * WeChat like prose.
 *
 * A comment inside a fenced code block is code: a document about HTML has to be
 * able to show `<!-- … -->` literally, exactly like the fence rule the image
 * scanners already follow.
 *
 * Blanking rather than deleting is the point: every character offset and line
 * number survives, so the token maps the parser hands the editor and the "Nth
 * image in the source" numbering render.ts re-walks keep agreeing with the text
 * the author sees. The two image scanners skip these ranges symmetrically;
 * parse.ts reads the blanked text, render.ts reads the untouched source.
 *
 * Known limitation, shared with those scanners: a comment inside an inline code
 * span (`` `<!-- … -->` ``) is blanked as well.
 */
import { fencedRanges, isInFence, type Range } from './fences'

const OPEN = '<!--'
const CLOSE = '-->'

/** Every comment span that lies outside fenced code, in character offsets. */
export function commentRanges(content: string, fences: Range[] = fencedRanges(content)): Range[] {
  const out: Range[] = []
  let i = 0
  for (;;) {
    const start = content.indexOf(OPEN, i)
    if (start < 0) return out
    // An opening inside a fence is code, and so is everything to its close.
    if (isInFence(fences, start)) {
      i = start + OPEN.length
      continue
    }
    const close = content.indexOf(CLOSE, start + OPEN.length)
    // Unclosed: not a comment. Leaving the text alone is what a renderer does
    // with a stray `<!--`, and guessing an end would swallow the article.
    if (close < 0) return out
    const end = close + CLOSE.length

    // A note that merely spans a fence still leaves the fenced code literal.
    let cursor = start
    for (const [fenceStart, fenceEnd] of fences) {
      if (fenceEnd <= cursor || fenceStart >= end) continue
      if (fenceStart > cursor) out.push([cursor, fenceStart])
      cursor = Math.max(cursor, fenceEnd)
    }
    if (cursor < end) out.push([cursor, end])
    i = end
  }
}

/** Whether a character offset sits inside any comment span. */
export function isInComment(ranges: Range[], index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

/** The same text, same length, with every comment outside fences blanked out. */
export function blankComments(content: string, fences?: Range[]): string {
  const ranges = commentRanges(content, fences)
  if (ranges.length === 0) return content
  let out = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    out += content.slice(cursor, start)
    out += content.slice(start, end).replace(/[^\n]/g, ' ')
    cursor = end
  }
  return out + content.slice(cursor)
}
