/**
 * Markdown editing commands for the editor toolbar and the semantic format
 * painter.
 *
 * Everything here is pure: it takes the document text plus a selection and
 * returns the new text with the new selection. No CodeMirror, no React, so the
 * rules stay unit-testable and the editor layer only has to know how to
 * dispatch the result.
 *
 * The markers are exactly the dialect the parser accepts (see parse.ts):
 * `**bold**`, `==mark==`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`,
 * `## KICKER | title`, `### title`, `> quote card`, the `:::quote` / `:::center`
 * containers and `- ` / `1. ` lists. Nothing here invents syntax of its own.
 *
 * State is read back with the same rules it is written with: the toolbar lights
 * a button by scanning the block for the same marker pair a click would toggle,
 * so "what is lit" and "what happens on click" can never drift apart.
 */
import { fencedRanges, isInFence } from './fences'
import type { Block, CarouselRatio } from './types'

// ---------- shapes ----------

export interface Selection {
  from: number
  to: number
}

/** New document text plus the selection that goes with it. */
export interface EditResult {
  doc: string
  from: number
  to: number
}

export interface Edit {
  from: number
  to: number
  insert: string
}

export type InlineFormat = 'bold' | 'mark' | 'italic' | 'strike' | 'code'

export interface InlineState {
  bold: boolean
  mark: boolean
  italic: boolean
  strike: boolean
  code: boolean
  link: boolean
}

/**
 * Block semantics the toolbar can read and write.
 *
 * `list`, `table`, `code` and `other` are read-only on purpose: a format that
 * is not one of the six convertible kinds is never rewritten by a brush, and
 * its cells/rows are nobody's paragraph.
 */
export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'subheading'
  | 'quoteCard'
  | 'quoteBox'
  | 'center'
  | 'list'
  | 'table'
  | 'code'
  | 'other'

/** The subset a block conversion may produce or consume. */
export type ConvertibleKind = 'paragraph' | 'heading' | 'subheading' | 'quoteCard' | 'quoteBox' | 'center'

const CONVERTIBLE: readonly ConvertibleKind[] = [
  'paragraph',
  'heading',
  'subheading',
  'quoteCard',
  'quoteBox',
  'center',
]

export function isConvertible(kind: BlockKind): kind is ConvertibleKind {
  return (CONVERTIBLE as readonly string[]).includes(kind)
}

/** One parsed block, reduced to what editing decisions need. */
export interface BlockInfo {
  kind: BlockKind
  /** 0-based first and one-past-last source line, counted from the file top. */
  line: number
  lineEnd: number
  ordered?: boolean
  /** Heading only: the `KICKER` part written before the `|`. */
  kicker?: string
}

export interface BlockTarget {
  kind: ConvertibleKind
  /** Used when the target is a heading; kept verbatim. */
  kicker?: string
}

/** What a click on the format brush captured from its source passage. */
export interface BrushSnapshot {
  inline: Omit<InlineState, 'link'>
  block: BlockKind
  kicker: string
}

// ---------- offsets ----------

export function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1)
  return out
}

export function lineOfOffset(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function mapPosWithEdits(p: number, edits: Edit[]): number {
  let delta = 0
  for (const e of edits) {
    // `edits` is sorted ascending by `from` by the caller.
    if (e.to <= p) {
      delta += e.insert.length - (e.to - e.from)
      continue
    }
    if (e.from >= p) break
    // The position sits inside the replaced span: keep it as close to the
    // start of the replacement as the replacement allows.
    return e.from + delta + clamp(p - e.from, 0, e.insert.length)
  }
  return p + delta
}

/**
 * Apply a set of non-overlapping edits and carry the selection through.
 *
 * An insertion exactly at a position pushes that position to its right, which
 * is what keeps a cursor sitting at a line start on the content side of a `> `.
 */
export function applyEdits(text: string, sel: Selection, edits: Edit[]): EditResult {
  const asc = [...edits].sort((a, b) => a.from - b.from)
  let doc = text
  for (let i = asc.length - 1; i >= 0; i--) {
    const e = asc[i]
    doc = doc.slice(0, e.from) + e.insert + doc.slice(e.to)
  }
  const from = mapPosWithEdits(sel.from, asc)
  const to = mapPosWithEdits(sel.to, asc)
  return { doc, from: Math.min(from, to), to: Math.max(from, to) }
}

// ---------- inline scanning ----------

interface Span {
  openStart: number
  openEnd: number
  closeStart: number
  closeEnd: number
}

export interface InlineScan {
  byFormat: Record<InlineFormat, Span[]>
  links: Span[]
}

const FORMATS: readonly InlineFormat[] = ['bold', 'mark', 'italic', 'strike', 'code']

export const INLINE_PAIR: Record<InlineFormat, [string, string]> = {
  bold: ['**', '**'],
  mark: ['==', '=='],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
}

const PLACEHOLDER: Record<InlineFormat, string> = {
  bold: '加粗文字',
  mark: '重点文字',
  italic: '斜体文字',
  strike: '删除文字',
  code: '代码',
}

function isSpace(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c)
}

/** The delimiter run starting at `i`, longest form first. */
function markerAt(text: string, i: number): { format: InlineFormat; len: number } | null {
  const two = text.slice(i, i + 2)
  if (two === '**' || two === '__') return { format: 'bold', len: 2 }
  if (two === '==') return { format: 'mark', len: 2 }
  if (two === '~~') return { format: 'strike', len: 2 }
  const c = text[i]
  if (c === '*' || c === '_') return { format: 'italic', len: 1 }
  return null
}

function findBacktickRun(text: string, from: number, end: number, n: number): number {
  for (let j = from; j <= end - n; j++) {
    if (text[j] !== '`') continue
    let len = 0
    while (text[j + len] === '`') len++
    if (len === n) return j
    j += len - 1
  }
  return -1
}

function matchLink(text: string, at: number, end: number): Span | null {
  if (text[at] !== '[') return null
  let j = at + 1
  while (j < end && text[j] !== ']') {
    if (text[j] === '\\') j++
    j++
  }
  if (j >= end || text[j] !== ']' || text[j + 1] !== '(') return null
  let depth = 1
  let k = j + 2
  while (k < end && depth > 0) {
    if (text[k] === '(') depth++
    else if (text[k] === ')') depth--
    k++
  }
  if (depth !== 0) return null
  return { openStart: at, openEnd: at + 1, closeStart: j, closeEnd: k }
}

/**
 * Every matched marker pair inside `[from, to)`.
 *
 * Openers and closers are matched per format with a pending stack, which is the
 * same "next same marker closes it" model the parser's delimiter scan resolves
 * for well-formed text. Flanking is approximated with the two rules that
 * actually matter for an editor: a delimiter run may not open against
 * whitespace, nor close against it. Escaped characters and the URL part of a
 * link are skipped, and an image keeps its caption out of the scan (the caption
 * is rendered as literal text).
 */
export function scanInline(text: string, from: number, to: number): InlineScan {
  const byFormat: Record<InlineFormat, Span[]> = { bold: [], mark: [], italic: [], strike: [], code: [] }
  const links: Span[] = []
  const pending = new Map<InlineFormat, { start: number; end: number }>()
  const start = Math.max(0, from)
  const end = Math.min(text.length, to)
  let i = start

  while (i < end) {
    const c = text[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      let n = 1
      while (text[i + n] === '`') n++
      const close = findBacktickRun(text, i + n, end, n)
      if (close >= 0) {
        byFormat.code.push({ openStart: i, openEnd: i + n, closeStart: close, closeEnd: close + n })
        i = close + n
        continue
      }
      i += n
      continue
    }
    if (c === '!' && text[i + 1] === '[') {
      const span = matchLink(text, i + 1, end)
      if (span) {
        i = span.closeEnd
        continue
      }
    }
    if (c === '[') {
      const span = matchLink(text, i, end)
      if (span) {
        links.push(span)
        i += 1
        continue
      }
    }
    const marker = markerAt(text, i)
    if (marker) {
      const open = pending.get(marker.format)
      if (open && !isSpace(text[i - 1])) {
        byFormat[marker.format].push({
          openStart: open.start,
          openEnd: open.end,
          closeStart: i,
          closeEnd: i + marker.len,
        })
        pending.delete(marker.format)
      } else if (!open && !isSpace(text[i + marker.len])) {
        pending.set(marker.format, { start: i, end: i + marker.len })
      }
      i += marker.len
      continue
    }
    i++
  }
  return { byFormat, links }
}

export interface ActiveInline {
  state: Record<InlineFormat, boolean>
  spans: Record<InlineFormat, Span | null>
  link: { active: boolean; span: Span | null }
}

function findSpan(spans: Span[], sel: Selection): Span | null {
  const collapsed = sel.from === sel.to
  let best: Span | null = null
  for (const s of spans) {
    // A collapsed cursor counts as inside right up to the end of the closing
    // run, so it still reads as "in the bold" while the caret sits between the
    // two closing characters; one column further it is ordinary text again.
    const inside = collapsed
      ? s.openEnd <= sel.from && sel.from < s.closeEnd
      : s.openEnd <= sel.from && sel.to <= s.closeStart
    // A selection that already spans the pair is treated as formatted too.
    const covers = sel.from < sel.to && s.openStart <= sel.from && sel.to <= s.closeEnd
    if (!inside && !covers) continue
    if (!best || s.closeEnd - s.openStart < best.closeEnd - best.openStart) best = s
  }
  return best
}

/** Where the inline markers around the selection map to, per format. */
export function inlineActiveAt(text: string, sel: Selection, range?: { from: number; to: number }): ActiveInline {
  const scan = scanInline(text, range?.from ?? 0, range?.to ?? text.length)
  const spans: Record<InlineFormat, Span | null> = { bold: null, mark: null, italic: null, strike: null, code: null }
  const state: Record<InlineFormat, boolean> = { bold: false, mark: false, italic: false, strike: false, code: false }
  for (const f of FORMATS) {
    const s = findSpan(scan.byFormat[f], sel)
    spans[f] = s
    state[f] = s !== null
  }
  const linkSpan = findSpan(scan.links, sel)
  return { state, spans, link: { active: linkSpan !== null, span: linkSpan } }
}

/** The plain-text state the toolbar lights up, without the span bookkeeping. */
export function inlineStateAt(text: string, sel: Selection, range?: { from: number; to: number }): InlineState {
  const a = inlineActiveAt(text, sel, range)
  return { ...a.state, link: a.link.active }
}

function wrapInline(text: string, sel: Selection, format: InlineFormat): EditResult | null {
  const inner = text.slice(sel.from, sel.to)
  // A code span cannot cross a line break: markdown-it would leave the
  // backticks as literal text.
  if (format === 'code' && inner.includes('\n')) return null
  const taken = inner || PLACEHOLDER[format]
  const [open, close] = INLINE_PAIR[format]
  const doc = text.slice(0, sel.from) + open + taken + close + text.slice(sel.to)
  const from = sel.from + open.length
  return { doc, from, to: from + taken.length }
}

function unwrapInline(text: string, sel: Selection, format: InlineFormat, span: Span): EditResult {
  const [open, close] = INLINE_PAIR[format]
  const selected = text.slice(sel.from, sel.to)
  // Selecting the markers themselves (or a fragment with both edges) removes
  // the ones inside the selection instead of the ones enclosing it.
  if (sel.from < sel.to && selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    return applyEdits(text, sel, [
      { from: sel.from, to: sel.from + open.length, insert: '' },
      { from: sel.to - close.length, to: sel.to, insert: '' },
    ])
  }
  return applyEdits(text, sel, [
    { from: span.openStart, to: span.openEnd, insert: '' },
    { from: span.closeStart, to: span.closeEnd, insert: '' },
  ])
}

/**
 * Put `format` into the given state for the selection.
 *
 * With no selection the marker pair is inserted with a placeholder inside and
 * the placeholder selected, so typing replaces it — the same gesture the
 * existing Ctrl+B keybinding already used.
 */
export function setInline(
  text: string,
  sel: Selection,
  format: InlineFormat,
  on: boolean,
  range?: { from: number; to: number },
): EditResult | null {
  if (isInFence(fencedRanges(text), sel.from)) return null
  const active = inlineActiveAt(text, sel, range)
  if (active.state[format] === on) return null
  if (on) return wrapInline(text, sel, format)
  const span = active.spans[format]
  return span ? unwrapInline(text, sel, format, span) : null
}

/** One click of B / 重点 / I / S / <>: on when off, off when on. */
export function toggleInline(
  text: string,
  sel: Selection,
  format: InlineFormat,
  range?: { from: number; to: number },
): EditResult | null {
  const active = inlineActiveAt(text, sel, range)
  return setInline(text, sel, format, !active.state[format], range)
}

/**
 * Insert or remove a link. Existing link syntax is stripped back to its label;
 * otherwise a selection becomes the label and the cursor lands in the empty
 * URL parens.
 */
export function toggleLink(text: string, sel: Selection, range?: { from: number; to: number }): EditResult | null {
  if (isInFence(fencedRanges(text), sel.from)) return null
  const active = inlineActiveAt(text, sel, range)
  if (active.link.active && active.link.span) {
    const span = active.link.span
    return applyEdits(text, sel, [
      { from: span.openStart, to: span.openEnd, insert: '' },
      { from: span.closeStart, to: span.closeEnd, insert: '' },
    ])
  }
  const selected = text.slice(sel.from, sel.to)
  if (selected) {
    const doc = text.slice(0, sel.from) + `[${selected}]()` + text.slice(sel.to)
    // Land inside the empty parens, ready for a URL.
    const at = sel.from + selected.length + 3
    return { doc, from: at, to: at }
  }
  const label = '链接文字'
  const doc = text.slice(0, sel.from) + `[${label}]()` + text.slice(sel.from)
  return { doc, from: sel.from + 1, to: sel.from + 1 + label.length }
}

/**
 * Strip every supported inline format that touches the selection.
 *
 * Collapsed: the pairs enclosing the cursor. Otherwise: any pair whose range
 * overlaps what is selected — a keyword the user dragged across is meant to
 * come out plain.
 */
export function clearInline(text: string, sel: Selection, range?: { from: number; to: number }): EditResult | null {
  if (isInFence(fencedRanges(text), sel.from)) return null
  const scan = scanInline(text, range?.from ?? 0, range?.to ?? text.length)
  const edits: Edit[] = []
  const collapsed = sel.from === sel.to
  const hits = (s: Span): boolean => {
    if (collapsed) return s.openEnd <= sel.from && sel.to <= s.closeStart
    return !(s.closeEnd <= sel.from || s.openStart >= sel.to)
  }
  for (const f of FORMATS) for (const s of scan.byFormat[f]) if (hits(s)) edits.push({ from: s.openStart, to: s.openEnd, insert: '' }, { from: s.closeStart, to: s.closeEnd, insert: '' })
  for (const s of scan.links) if (hits(s)) edits.push({ from: s.openStart, to: s.openEnd, insert: '' }, { from: s.closeStart, to: s.closeEnd, insert: '' })
  if (!edits.length) return null
  return applyEdits(text, sel, edits)
}

// ---------- blocks ----------

/** Reduce the parser's blocks to the shape the editing commands read. */
export function toBlockInfo(blocks: Block[]): BlockInfo[] {
  return blocks.map((b) => {
    switch (b.type) {
      case 'paragraph':
        return { kind: 'paragraph' as const, line: b.line, lineEnd: b.lineEnd }
      case 'heading':
        return { kind: 'heading' as const, line: b.line, lineEnd: b.lineEnd, kicker: b.kicker }
      case 'subheading':
        return { kind: 'subheading' as const, line: b.line, lineEnd: b.lineEnd }
      case 'quoteCard':
        return { kind: 'quoteCard' as const, line: b.line, lineEnd: b.lineEnd }
      case 'quoteBox':
        return { kind: 'quoteBox' as const, line: b.line, lineEnd: b.lineEnd }
      case 'center':
        return { kind: 'center' as const, line: b.line, lineEnd: b.lineEnd }
      case 'list':
        return { kind: 'list' as const, line: b.line, lineEnd: b.lineEnd, ordered: b.ordered }
      case 'table':
        return { kind: 'table' as const, line: b.line, lineEnd: b.lineEnd }
      case 'code':
        return { kind: 'code' as const, line: b.line, lineEnd: b.lineEnd }
      default:
        return { kind: 'other' as const, line: b.line, lineEnd: b.lineEnd }
    }
  })
}

/** The block containing a source line, or null when no block covers it. */
export function blockAtLine(blocks: BlockInfo[], line: number): BlockInfo | null {
  for (const b of blocks) if (b.line <= line && line < Math.max(b.lineEnd, b.line + 1)) return b
  return null
}

/** Character range of a block, for scoping an inline scan. */
export function blockCharRange(text: string, b: BlockInfo, starts = lineStarts(text)): { from: number; to: number } {
  const last = clamp(b.lineEnd - 1, b.line, starts.length - 1)
  const from = starts[clamp(b.line, 0, starts.length - 1)]
  const next = last + 1 < starts.length ? starts[last + 1] : text.length + 1
  return { from, to: Math.min(text.length, next - 1) }
}

interface Extent {
  start: number
  end: number
}

/** Lines a block actually occupies; container closers are found by scanning. */
function blockExtent(lines: string[], b: BlockInfo): Extent | null {
  const start = b.line
  if (start < 0 || start >= lines.length) return null
  if (b.kind === 'heading' || b.kind === 'subheading') {
    // ATX is one line; a setext heading is the text line plus its underline.
    if (!/^\s{0,3}#{1,6}[ \t]/.test(lines[start]) && /^\s{0,3}(=+|-+)\s*$/.test(lines[start + 1] ?? '')) {
      return { start, end: start + 2 }
    }
    return { start, end: start + 1 }
  }
  if (b.kind === 'quoteBox' || b.kind === 'center') {
    for (let i = start + 1; i < lines.length; i++) if (/^\s*:::\s*$/.test(lines[i])) return { start, end: i + 1 }
    return { start, end: clamp(b.lineEnd, start + 1, lines.length) }
  }
  let end = clamp(b.lineEnd, start + 1, lines.length)
  while (end > start + 1 && lines[end - 1].trim() === '') end--
  return { start, end }
}

const QUOTE_PREFIX = /^\s{0,3}>[ \t]?/
const ATX_PREFIX = /^\s{0,3}#{1,6}[ \t]+/

interface BuiltBlock {
  lines: string[]
  /** Prefix length before the content starts, per line. */
  prefixLens: number[]
  /** Index of the first content line inside `lines`. */
  contentOffset: number
  /** Content line count (clamped when the target collapses lines). */
  contentCount: number
}

function joinTitle(content: string[]): string {
  return content
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
}

/** Build the block's lines in the target form. */
function buildBlock(kind: ConvertibleKind, content: string[], kicker: string): BuiltBlock {
  switch (kind) {
    case 'paragraph':
      return { lines: [...content], prefixLens: content.map(() => 0), contentOffset: 0, contentCount: content.length }
    case 'heading': {
      const title = joinTitle(content)
      const head = kicker ? `## ${kicker} | ` : '## '
      return { lines: [head + title], prefixLens: [head.length], contentOffset: 0, contentCount: 1 }
    }
    case 'subheading': {
      const title = joinTitle(content)
      return { lines: ['### ' + title], prefixLens: [4], contentOffset: 0, contentCount: 1 }
    }
    case 'quoteCard': {
      const lines = content.map((l) => (l.trim() ? '> ' + l : '>'))
      return { lines, prefixLens: lines.map((l) => (l === '>' ? 1 : 2)), contentOffset: 0, contentCount: lines.length }
    }
    case 'quoteBox':
    case 'center': {
      const head = kind === 'quoteBox' ? ':::quote' : ':::center'
      const lines = [head, ...content, ':::']
      return { lines, prefixLens: lines.map(() => 0), contentOffset: 1, contentCount: content.length }
    }
  }
}

/** The content lines of a block, marker prefixes removed. */
function readContent(lines: string[], ext: Extent, kind: BlockKind): { content: string[]; kicker: string } {
  const body = lines.slice(ext.start, ext.end)
  switch (kind) {
    case 'heading':
    case 'subheading': {
      const text = body.filter((l) => !/^\s{0,3}(=+|-+)\s*$/.test(l)).join('\n')
      const m = ATX_PREFIX.exec(text)
      const stripped = m ? text.slice(m[0].length) : text
      if (kind === 'heading') {
        const pipe = stripped.indexOf('|')
        if (pipe >= 0) return { content: [stripped.slice(pipe + 1).trim()], kicker: stripped.slice(0, pipe).trim() }
      }
      return { content: [stripped.trim()], kicker: '' }
    }
    case 'quoteCard':
      return { content: body.map((l) => l.replace(QUOTE_PREFIX, '')), kicker: '' }
    case 'quoteBox':
    case 'center': {
      const body_ = body.slice(1)
      // An unterminated container (mid-typing) still has all its text: only a
      // real `:::` closer is cut off.
      const closed = /^\s*:::\s*$/.test(body[body.length - 1] ?? '')
      return { content: closed ? body_.slice(0, Math.max(0, body_.length - 1)) : body_, kicker: '' }
    }
    default:
      return { content: body, kicker: '' }
  }
}

/** Content coordinates (line + column within the content) of a document position. */
function contentPosOf(kind: BlockKind, lines: string[], ext: Extent, starts: number[], pos: number): { li: number; col: number } {
  const line = lineOfOffset(starts, pos)
  const rawCol = pos - starts[line]
  if (line < ext.start) return { li: 0, col: 0 }
  if (line >= ext.end) return { li: Math.max(0, ext.end - ext.start - 1), col: Number.MAX_SAFE_INTEGER }
  const rel = line - ext.start
  const text = lines[line]
  switch (kind) {
    case 'heading':
    case 'subheading': {
      const m = ATX_PREFIX.exec(text)
      if (!m) return { li: 0, col: 0 }
      let off = m[0].length
      let rest = text.slice(off)
      if (kind === 'heading') {
        const pipe = rest.indexOf('|')
        if (pipe >= 0) {
          off += pipe + 1
          rest = rest.slice(pipe + 1)
        }
      }
      return { li: 0, col: clamp(rawCol - off, 0, rest.trim().length) }
    }
    case 'quoteCard':
      return { li: rel, col: clamp(rawCol - (QUOTE_PREFIX.exec(text)?.[0].length ?? 0), 0, text.length) }
    case 'quoteBox':
    case 'center':
      if (rel === 0) return { li: 0, col: 0 }
      if (rel >= ext.end - ext.start - 1) return { li: Number.MAX_SAFE_INTEGER, col: Number.MAX_SAFE_INTEGER }
      return { li: rel - 1, col: rawCol }
    default:
      return { li: rel, col: rawCol }
  }
}

/** The document offset a content position lands on inside the built block. */
function builtPos(built: BuiltBlock, li: number, col: number, blockStart: number): number {
  if (!built.contentCount) return blockStart
  const contentLi = clamp(li, 0, built.contentCount - 1)
  const idx = clamp(built.contentOffset + contentLi, 0, built.lines.length - 1)
  let off = 0
  for (let i = 0; i < idx; i++) off += built.lines[i].length + 1
  const prefix = built.prefixLens[idx] ?? 0
  const room = Math.max(0, built.lines[idx].length - prefix)
  return blockStart + off + prefix + clamp(col, 0, room)
}

/**
 * Rewrite every convertible block the selection touches into `target`.
 *
 * Text is preserved exactly where it is text: switching a `## KICKER | title`
 * to a subheading or a plain paragraph keeps the title and drops the kicker, a
 * quote card becomes the same sentences without the `>`, and a paragraph
 * becomes a container without having one character rewritten.
 *
 * Returns null when nothing has to change, so callers can tell a real edit
 * from a click that did nothing.
 */
export function convertBlocksTo(
  text: string,
  sel: Selection,
  blocks: BlockInfo[],
  target: BlockTarget,
): EditResult | null {
  const starts = lineStarts(text)
  const lines = text.split('\n')
  const fromLine = lineOfOffset(starts, sel.from)
  const toLine = lineOfOffset(starts, sel.to)
  const affected = blocks.filter(
    (b) => b.line <= toLine && b.lineEnd > fromLine && isConvertible(b.kind) && b.kind !== target.kind,
  )
  if (!affected.length) return null

  const edits: Edit[] = []
  const maps: ((p: number) => number)[] = []
  for (const b of affected) {
    const ext = blockExtent(lines, b)
    if (!ext) continue
    const { content, kicker } = readContent(lines, ext, b.kind)
    const built = buildBlock(target.kind, content, target.kicker ?? kicker ?? '')
    if (!built.lines.length) continue
    const editFrom = starts[ext.start]
    const editTo = ext.end >= starts.length ? text.length : starts[ext.end] - 1
    const insert = built.lines.join('\n')
    const delta = insert.length - (editTo - editFrom)
    edits.push({ from: editFrom, to: editTo, insert })
    maps.push((p) => {
      if (p <= editFrom) return p
      if (p >= editTo) return p + delta
      const { li, col } = contentPosOf(b.kind, lines, ext, starts, p)
      return builtPos(built, li, col, editFrom)
    })
  }
  if (!edits.length) return null

  if (maps.length === 1) {
    const map = maps[0]
    const from = map(sel.from)
    const to = map(sel.to)
    return { doc: applyEdits(text, sel, edits).doc, from: Math.min(from, to), to: Math.max(from, to) }
  }
  // Several blocks: the selection covers everything that was rewritten.
  const asc = [...edits].sort((a, b) => a.from - b.from)
  const from = asc[0].from
  const last = asc[asc.length - 1]
  return { doc: applyEdits(text, sel, edits).doc, from, to: last.from + last.insert.length }
}

// ---------- lists ----------

const LIST_MARKER = /^(\s*)(?:([-*+])|(\d+)[.)])([ \t]+)/

/** Whether a line carries the target list marker already. */
function listMarkerOf(line: string): { indent: string; ordered: boolean } | null {
  const m = LIST_MARKER.exec(line)
  if (!m) return null
  return { indent: m[1], ordered: Boolean(m[3]) }
}

/**
 * Convert the selected lines (or the cursor's line) to a bullet or ordered
 * list. When every line already carries that marker the markers are removed
 * again, which is the toggle the other toolbar buttons have as well.
 */
export function toggleList(text: string, sel: Selection, ordered: boolean): EditResult | null {
  if (isInFence(fencedRanges(text), sel.from)) return null
  const starts = lineStarts(text)
  const lines = text.split('\n')
  const fromLine = lineOfOffset(starts, sel.from)
  const toLine = lineOfOffset(starts, sel.to)
  const targets: number[] = []
  for (let i = fromLine; i <= toLine && i < lines.length; i++) if (lines[i].trim()) targets.push(i)
  if (!targets.length) return null

  const already = targets.every((i) => listMarkerOf(lines[i])?.ordered === ordered)
  const edits: Edit[] = []
  let n = 0
  for (const i of targets) {
    const line = lines[i]
    if (already) {
      const m = LIST_MARKER.exec(line)!
      edits.push({ from: starts[i] + m[1].length, to: starts[i] + m[0].length, insert: '' })
      continue
    }
    const m = LIST_MARKER.exec(line)
    n++
    const bullet = ordered ? `${n}. ` : '- '
    if (m) edits.push({ from: starts[i] + m[1].length, to: starts[i] + m[0].length, insert: bullet })
    else edits.push({ from: starts[i], to: starts[i], insert: bullet })
  }
  return applyEdits(text, sel, edits)
}

// ---------- format brush ----------

/** Read the semantic format of the passage a click lands on. */
export function snapshotAt(text: string, sel: Selection, blocks: BlockInfo[]): BrushSnapshot {
  const starts = lineStarts(text)
  const line = lineOfOffset(starts, sel.from)
  const block = blockAtLine(blocks, line)
  const range = block ? blockCharRange(text, block, starts) : undefined
  const inline = inlineStateAt(text, sel, range)
  return {
    inline: { bold: inline.bold, mark: inline.mark, italic: inline.italic, strike: inline.strike, code: inline.code },
    block: block?.kind ?? 'paragraph',
    kicker: block?.kicker ?? '',
  }
}

/**
 * Paint a captured format onto a target passage.
 *
 * Inline: the five formats are brought to exactly the captured state — markers
 * the source has are added, markers it does not have are removed. Block: every
 * convertible block under the selection takes the source's block kind, with the
 * source's kicker when that kind is a heading. This is why the brush is
 * theme-independent: it only ever copies these semantics, never a colour.
 *
 * The inline pass runs first: it never adds or removes a line, so the parsed
 * block spans the block pass still relies on stay valid.
 */
export function applyBrush(
  text: string,
  sel: Selection,
  snap: BrushSnapshot,
  blocks: BlockInfo[],
): EditResult | null {
  let cur: EditResult = { doc: text, from: sel.from, to: sel.to }
  let changed = false
  if (cur.from !== cur.to) {
    const starts = lineStarts(cur.doc)
    const line = lineOfOffset(starts, cur.from)
    const block = blockAtLine(blocks, line)
    const range = block ? blockCharRange(cur.doc, block, starts) : undefined
    for (const f of FORMATS) {
      const next = setInline(cur.doc, { from: cur.from, to: cur.to }, f, snap.inline[f], range)
      if (next) {
        cur = next
        changed = true
      }
    }
  }
  if (isConvertible(snap.block)) {
    const next = convertBlocksTo(cur.doc, { from: cur.from, to: cur.to }, blocks, {
      kind: snap.block,
      kicker: snap.kicker,
    })
    if (next) {
      cur = next
      changed = true
    }
  }
  return changed ? cur : null
}

// ---------- inserts ----------

export interface Template {
  text: string
  /** Caret offset into `text`; defaults to the end. */
  caret?: number
  /** Selects `caret`..`caretEnd` when given. */
  caretEnd?: number
}

function withCaret(raw: string, marker = '|'): Template {
  const i = raw.indexOf(marker)
  if (i < 0) return { text: raw, caret: raw.length }
  return { text: raw.slice(0, i) + raw.slice(i + 1), caret: i }
}

/**
 * GFM table with a header row and a separator that carries the alignment.
 * `rows` counts the header, so 2x2 means one header row and one body row —
 * the same meaning the size picker shows.
 */
export function buildTable(cols: number, rows: number, align: 'none' | 'left' | 'center' | 'right'): Template {
  const dash = align === 'none' ? '---' : align === 'left' ? ':---' : align === 'center' ? ':---:' : '---:'
  const head = `| ${Array.from({ length: cols }, () => '表头').join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => dash).join(' | ')} |`
  const bodyCount = Math.max(0, rows - 1)
  const body = Array.from({ length: bodyCount }, () => `|${'  |'.repeat(cols)}`).join('\n')
  const text = body ? `${head}\n${sep}\n${body}` : `${head}\n${sep}`
  return { text, caret: 2 }
}

export function buildCarousel(ratio: CarouselRatio): Template {
  return withCaret(`:::carousel ${ratio} |\n![]()\n![]()\n:::\n`)
}

export function buildGallery(cols: number, ratio: CarouselRatio): Template {
  const slots = Array.from({ length: cols }, () => '![]()').join('\n')
  return withCaret(`:::gallery ${cols} ${ratio} |\n${slots}\n:::\n`)
}

export function buildMath(tex: string): Template {
  const body = tex.trim() || '公式'
  const text = `$$\n${body}\n$$`
  return { text, caret: 3 }
}

export function buildCodeFence(lang: string): Template {
  const head = '```' + lang
  const text = `${head}\n\n\`\`\``
  return { text, caret: head.length + 1 }
}

export function buildMermaid(): Template {
  const text = '```mermaid 图注\n\n```'
  return { text, caret: 14 }
}

export function buildImagePlaceholder(): Template {
  const text = '![图注]()'
  return { text, caret: 2, caretEnd: 4 }
}
