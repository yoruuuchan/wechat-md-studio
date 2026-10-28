import { locateImage } from './render'

/**
 * A write-back that was started for one image slot in one article.
 *
 * The upload runs for a second or more, so by the time it finishes the source
 * text may have moved or been edited. Keeping an absolute offset alone is not
 * enough: inserting a paragraph above the image shifts it. We therefore map
 * every later edit through the target before writing, and verify the exact
 * image syntax before touching the source at all.
 */
export interface ImageWriteTarget {
  kind: 'image'
  alt: string
  occurrence: number
  /** Index of the target's `!`. */
  start: number
  /** Index just past `![alt](`. */
  openEnd: number
  /** Index of the closing `)`. */
  end: number
  /** The exact `![alt](src)` text captured when the upload started. */
  original: string
  /** Set once an edit touches the captured span; the write must then be refused. */
  stale: boolean
}

/**
 * A new image that was dropped or pasted at a document position. Only the
 * position needs tracking: the surrounding text is rebuilt when the upload
 * finishes, exactly as the editor's own insert command would have done.
 */
export interface InsertWriteTarget {
  kind: 'insert'
  pos: number
  stale: boolean
}

export type WriteTarget = ImageWriteTarget | InsertWriteTarget

export type WriteResult =
  | { ok: true; content: string; at: number }
  | { ok: false; reason: 'stale' }

interface TextChange {
  from: number
  to: number
  inserted: number
  removed: number
}

/**
 * The single changed range between two versions of the source.
 *
 * React state changes arrive one edit at a time in practice (a keystroke, a
 * paste, a toolbar command), so the common prefix/suffix is enough to describe
 * them. A render that batches two distant edits widens the range instead of
 * guessing; that can only make a target look stale, never point it at the
 * wrong span.
 */
function changeBetween(before: string, after: string): TextChange | null {
  if (before === after) return null
  let head = 0
  const min = Math.min(before.length, after.length)
  while (head < min && before[head] === after[head]) head++
  let tail = 0
  while (tail < min - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  return {
    from: head,
    to: before.length - tail,
    inserted: after.length - before.length + (before.length - tail) - head,
    removed: before.length - tail - head,
  }
}

/**
 * Move a pending target through one edit.
 *
 * An edit entirely before the target shifts it; one entirely after leaves it
 * alone. Anything that overlaps the target invalidates it: the upload no
 * longer knows which image it was filling, and silently writing there could
 * overwrite someone else's replacement.
 */
export function mapWriteTarget(target: WriteTarget, before: string, after: string): void {
  if (target.stale) return
  const change = changeBetween(before, after)
  if (!change) return
  const delta = change.inserted - change.removed
  if (target.kind === 'image') {
    // `to <= start` covers an insertion ending at the target's first character;
    // `from > end` covers an insertion after the closing parenthesis.
    if (change.to <= target.start) {
      target.start += delta
      target.openEnd += delta
      target.end += delta
      return
    }
    if (change.from > target.end) return
    target.stale = true
    return
  }
  if (change.to <= target.pos) {
    target.pos += delta
    return
  }
  if (change.from > target.pos) return
  target.stale = true
}

/** Capture an image slot by the same occurrence + caption pair the parser used. */
export function captureImageWriteTarget(
  content: string,
  alt: string,
  occurrence: number,
): ImageWriteTarget | null {
  const span = locateImage(content, alt, occurrence)
  if (!span) return null
  return {
    kind: 'image',
    alt,
    occurrence,
    start: span.start,
    openEnd: span.openEnd,
    end: span.end,
    original: content.slice(span.start, span.end + 1),
    stale: false,
  }
}

/**
 * Where the editor's insert-at-position command would put a block.
 * Mirrors `insertBlock` in EditorPane: a mid-line position snaps to the line
 * end, and an empty line keeps the exact position.
 */
export function insertionPoint(content: string, at: number): number {
  const clamped = Math.max(0, Math.min(at, content.length))
  const lineStart = clamped === 0 ? 0 : content.lastIndexOf('\n', clamped - 1) + 1
  const newline = content.indexOf('\n', clamped)
  const lineEnd = newline < 0 ? content.length : newline
  const lineText = content.slice(lineStart, lineEnd)
  return lineText.trim() ? lineEnd : clamped
}

export function captureInsertWriteTarget(content: string, at: number): InsertWriteTarget {
  return { kind: 'insert', pos: insertionPoint(content, at), stale: false }
}

/**
 * Fill a captured image span. The stored `original` text is the identity
 * check: offsets may have moved with the surrounding text, but the bytes at
 * the target must still be the same image syntax. Otherwise the upload refuses
 * to write instead of filling a lookalike image (repeated captions are common
 * in carousels and grids).
 */
export function applyImageWriteTarget(
  content: string,
  target: ImageWriteTarget,
  src: string,
): WriteResult {
  if (target.stale) return { ok: false, reason: 'stale' }
  if (
    target.start < 0 ||
    target.openEnd > content.length ||
    target.end >= content.length ||
    content.slice(target.start, target.end + 1) !== target.original
  ) {
    return { ok: false, reason: 'stale' }
  }
  return {
    ok: true,
    content: content.slice(0, target.openEnd) + src + content.slice(target.end),
    at: target.start,
  }
}

/** Insert a whole image block at a captured position, adding blank lines around it. */
export function applyInsertWriteTarget(
  content: string,
  target: InsertWriteTarget,
  markdown: string,
): WriteResult {
  if (target.stale) return { ok: false, reason: 'stale' }
  const pos = insertionPoint(content, target.pos)
  const lineStart = pos === 0 ? 0 : content.lastIndexOf('\n', pos - 1) + 1
  const newline = content.indexOf('\n', pos)
  const lineEnd = newline < 0 ? content.length : newline
  const lineText = content.slice(lineStart, lineEnd)
  const before = lineText.trim() ? '\n\n' : lineStart > 0 ? '\n' : ''
  return {
    ok: true,
    content: content.slice(0, pos) + before + markdown + '\n' + content.slice(pos),
    at: pos,
  }
}
