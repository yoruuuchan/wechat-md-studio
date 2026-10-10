/**
 * Rich-text clipboard → our WeChat Markdown dialect.
 *
 * turndown already gets the three things a hand-rolled HTML→Markdown converter
 * leaks on: whitespace collapsing, flanking whitespace around emphasis, and
 * Markdown escaping. So the parsing is delegated to it and everything
 * dialect-specific (`==mark==`, `:::quote`, `:::center`, `![alt]()`, `---`) is
 * layered on top as turndown rules plus a Markdown post-pass.
 *
 * Node/browser: turndown parses the HTML itself (domino under Node, DOMParser in
 * the browser), so nothing here touches `document`/`window`/`DOMParser`. Every
 * helper is a pure string function, which is what makes the module testable
 * under vitest's node environment.
 */
import TurndownService from 'turndown'
// `gfm` bundles the tables + strikethrough + taskListItems plugins (plus GitHub's
// highlight-div rule). The individual exports are typed through vendor.d.ts, which
// cannot see turndown's `highlightedCodeBlock`; going through `gfm` keeps it.
import { gfm } from 'turndown-plugin-gfm'
import { t } from './i18n'

// ---------------------------------------------------------------------------
// public contract
// ---------------------------------------------------------------------------

export interface PastedImage {
  src: string
  alt: string
  isDataUri: boolean
}

export interface HtmlToDialectOptions {
  /**
   * Caption generator for images. Called once per `<img>` in document order with
   * whatever alt/title/figcaption was already extracted; return a non-empty
   * string to override it, or '' to keep the extracted one.
   */
  imageAlt?: (image: PastedImage, index: number) => string
}

/** Why a paste was or was not run through the converter. */
export type PasteKind =
  | 'convert' // rich HTML worth converting
  | 'already-markdown' // gate 1: the plain text is Markdown already
  | 'ide-code' // gate 2: HTML came from a code editor's syntax highlighting
  | 'code-block' // gate 3: the body is code, wrap it in a fence instead
  | 'image-placeholder' // gate 4: an AI client left `[Image #N]` behind
  | 'plain-text' // nothing to convert

export interface PasteDecision {
  kind: PasteKind
  /** Same as `kind === 'convert'`; what `shouldConvertHtml` returns. */
  convert: boolean
  /** Fence language to use when the paste should land inside a code block. */
  lang: string
  /** User-facing reason (the editor shows it in a toast). */
  reason: string
}

// ---------------------------------------------------------------------------
// gate 1 — the plain text is already Markdown
// ---------------------------------------------------------------------------

/**
 * Weights mirror upstream huasheng_editor's `isMarkdown`, except that its flat
 * "≥2 of 13 patterns" lets two *weak* patterns decide. Block-level structures
 * (fence, heading, image, table, container, `==mark==`, link) are worth a
 * decision on their own; inline-only hints need a partner.
 */
const STRONG = 2
const WEAK = 1

interface MdSignal {
  re: RegExp
  weight: number
  label: string
}

const MD_SIGNALS: MdSignal[] = [
  { re: /(^|\n)```[^\n]*\n[\s\S]*?\n[ \t]*```/, weight: STRONG, label: 'fenced-code' },
  { re: /^[ \t]{0,3}#{1,6}[ \t]+\S/m, weight: STRONG, label: 'atx-heading' },
  { re: /!\[[^\]]*\]\([^)]*\)/, weight: STRONG, label: 'image' },
  { re: /(?<![\\`])\[[^\]\s][^\]]*\]\([^)\s]+\)/, weight: STRONG, label: 'link' },
  { re: /(^|\n)\|.+\|[ \t]*\n\|[\s:|-]+\|/, weight: STRONG, label: 'table' },
  { re: /^[ \t]{0,3}:::(?:quote|center|carousel)\b/m, weight: STRONG, label: 'container' },
  { re: /==[^=\s][^=]*?==/, weight: STRONG, label: 'mark' },
  { re: /(^|\n)@signature[ \t]*$/, weight: STRONG, label: 'signature' },
  { re: /\*\*[^\s*][^*]*?\*\*/, weight: WEAK, label: 'bold' },
  { re: /~~[^\s~][^~]*?~~/, weight: WEAK, label: 'strikethrough' },
  { re: /(^|\n)[ \t]*[-*+][ \t]+\S/m, weight: WEAK, label: 'bullet-list' },
  { re: /(^|\n)[ \t]*\d+[.)][ \t]+\S/m, weight: WEAK, label: 'ordered-list' },
  { re: /(^|\n)>[ \t]+\S/m, weight: WEAK, label: 'quote' },
  { re: /`[^`\n]+`/, weight: WEAK, label: 'inline-code' },
  { re: /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m, weight: WEAK, label: 'hr' },
]

export const MARKDOWN_SCORE_THRESHOLD = 2

export function markdownScore(text: string): { score: number; signals: string[] } {
  const signals: string[] = []
  let score = 0
  for (const s of MD_SIGNALS) {
    if (s.re.test(text)) {
      score += s.weight
      signals.push(s.label)
    }
  }
  return { score, signals }
}

/** Gate 1. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false
  return markdownScore(text).score >= MARKDOWN_SCORE_THRESHOLD
}

// ---------------------------------------------------------------------------
// gate 2 — the HTML is an IDE's syntax-highlighted clipboard dump
// ---------------------------------------------------------------------------

/**
 * Hard fingerprints of code-editor clipboard HTML. `<meta charset>` is
 * deliberately absent: Word, Feishu and Google Docs all ship one too, and using
 * it flagged every Word paste as an IDE.
 */
const IDE_HARD_SIGNALS: RegExp[] = [
  /class=["'][^"']*\bmtk\d+\b/i, // Monaco / VS Code token classes
  /class=["'][^"']*\bace_line\b/i, // Ace editor
  /class=["'][^"']*\bCodeMirror-/i,
  /class=["'][^"']*\bhljs-/i, // highlight.js tokens
  /class=["'][^"']*highlight-source-/i, // GitHub syntax highlight wrapper
  /style=["'][^"']*font-family:[^"']*(?:consolas|monaco|menlo|courier|jetbrains|fira code|source code|sf ?mono|cascadia|dejavu sans mono|liberation mono|roboto mono|inconsolata|hack|iosevka)/i,
]

export const IDE_SCORE_THRESHOLD = 2

/**
 * Office/云文档 markers. Their presence veto gate 2 outright: Word does put a
 * monospace `font-family` on inline code, and without the veto a Word document
 * containing one snippet would lose all of its formatting.
 */
const DOC_APP_SIGNATURES: RegExp[] = [
  /class=["']?Mso/i,
  /<o:p\b/i,
  /urn:schemas-microsoft-com/i,
  /<w:WordDocument/i,
  /content=["']Microsoft Word/i,
  /docs-internal-guid/i, // Google Docs
  /class=["'][^"']*\bnotion-/i, // Notion
  /data-(?:page|block|record|token|zone)-id=/i, // Feishu / Lark
  /\bfeishu\b|\blarksuite\b/i,
]

export function isFromDocApp(html: string): boolean {
  return DOC_APP_SIGNATURES.some((re) => re.test(html))
}

/**
 * Share of the visible text that lives inside `<pre>`. A document with one
 * highlighted snippet must not be mistaken for a code editor dump, so the IDE
 * and code gates both require the code to actually dominate.
 */
export function preTextRatio(html: string): number {
  const total = compact(stripTags(html))
  if (!total) return 0
  let inside = 0
  const re = /<pre\b[\s\S]*?<\/pre>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) inside += compact(stripTags(m[0])).length
  return Math.min(1, inside / total.length)
}

export const PRE_DOMINANCE = 0.6

/** Gate 2. `plain` is used to spot HTML that adds nothing over the text. */
export function isIdeFormattedHtml(html: string, plain: string): boolean {
  if (!html || !plain) return false
  if (isFromDocApp(html)) return false

  let score = 0
  for (const re of IDE_HARD_SIGNALS) if (re.test(html)) score += 2
  // Supporting, not decisive: a prose article with one long snippet can easily be
  // 70% code by character count, and that article must still be converted.
  if (preTextRatio(html) >= PRE_DOMINANCE) score += 1

  // div/span scaffolding with no rich-text semantics at all.
  const hasScaffold = /<(?:div|span)[\s>]/i.test(html)
  const hasSemantics = /<(?:p|h[1-6]|strong|b|em|i|u|s|del|ins|ul|ol|li|blockquote|table|figure|mark|a)[\s>]/i.test(html)
  if (hasScaffold && !hasSemantics) score += 1

  // Stripping tags reproduces the plain text exactly: no formatting to preserve.
  const hasInlineStyle = /<(?:span|font|b|strong|i|em|u|s|del)\b[^>]*style=["'][^"']*(?:font-weight|font-style|color|background|text-decoration)/i.test(html)
  if (!hasInlineStyle && !hasSemantics && compact(stripTags(html)) === compact(decodeEntities(plain))) score += 1

  return score >= IDE_SCORE_THRESHOLD
}

// ---------------------------------------------------------------------------
// gate 3 — the body is code
// ---------------------------------------------------------------------------

const CODE_KEYWORDS =
  /\b(?:function|return|const|let|var|class|interface|extends|implements|import|export|from|require|def|elif|lambda|self|public|private|protected|static|void|struct|enum|namespace|template|typename|include|package|func|println|printf|await|async|yield|throw|try|catch|finally|switch|case|break|continue|new|delete|typeof|instanceof)\b/g

const CODE_OPERATORS = [/=>/, /::/, /&&/, /\|\|/, /===?/, /!==?/, /[+\-*/%]=/, /\+\+|--/, /->/, /<\/?$/, /\$\{/, /@\w+/]

export const CODE_SCORE_THRESHOLD = 3

export function codeScore(text: string): { score: number; signals: string[] } {
  const signals: string[] = []
  const lines = text.split('\n')
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  if (nonEmpty.length < 2) return { score: 0, signals }

  let score = 0
  const hit = (label: string, weight = 1) => {
    score += weight
    signals.push(label)
  }

  // Statement terminators / block braces at end of line.
  const terminated = nonEmpty.filter((l) => /[;{}][ \t]*$/.test(l.trimEnd())).length
  if (terminated / nonEmpty.length >= 0.2) hit('line-terminators')

  // Braces present and roughly balanced — prose never balances braces.
  const open = (text.match(/\{/g) || []).length
  const close = (text.match(/\}/g) || []).length
  if (open >= 2 && Math.abs(open - close) <= 1) hit('balanced-braces')

  // Leading indentation on a quarter of the lines.
  const indented = nonEmpty.filter((l) => /^(?:[ \t]{2,})\S/.test(l)).length
  if (indented / nonEmpty.length >= 0.25) hit('indentation')

  const ops = CODE_OPERATORS.filter((re) => re.test(text)).length
  if (ops >= 2) hit('operators')

  const keywords = new Set<string>()
  for (const m of text.matchAll(CODE_KEYWORDS)) keywords.add(m[0])
  if (keywords.size >= 2) hit('keywords')

  // Prose punctuation / CJK density argues the other way.
  const cjk = (text.match(/[\u3000-\u30ff\u4e00-\u9fff]/g) || []).length
  const hasProsePunct = /[。，、；：？！“”‘’（）]/.test(text)
  if (cjk / Math.max(1, text.length) < 0.05 && !hasProsePunct) hit('low-prose')

  return { score, signals }
}

/** Gate 3 (text side). */
export function isMostlyCode(text: string): boolean {
  if (!text) return false
  return codeScore(text).score >= CODE_SCORE_THRESHOLD
}

/** Gate 3 (HTML side): a bare `<pre>`/`<code>` dump with no prose markup. */
export function isCodeOnlyHtml(html: string): boolean {
  if (!html) return false
  if (isFromDocApp(html)) return false
  const hasCode = /<(?:pre|code)[\s>]/i.test(html)
  if (!hasCode) return false
  if (/<(?:p|h[1-6]|ul|ol|blockquote|table|figure)[\s>]/i.test(html)) return false
  return preTextRatio(html) >= PRE_DOMINANCE || !/<(?:div|section|article)[\s>]/i.test(html)
}

// ---------------------------------------------------------------------------
// gate 4 — `[Image #N]` placeholders left behind by AI clients
// ---------------------------------------------------------------------------

const IMAGE_PLACEHOLDER = /^[ \t]*\[[ \t]*(?:image|图片|img|圖)[ \t]*#?\d*[ \t]*\][ \t]*$/i

/**
 * Gate 4. Only fires when the whole paste is placeholders — a real sentence that
 * happens to mention `[Image #1]` should still convert.
 */
export function isImagePlaceholderText(text: string): boolean {
  const lines = (text || '').split('\n').filter((l) => l.trim() !== '')
  if (!lines.length) return false
  return lines.every((l) => IMAGE_PLACEHOLDER.test(l))
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

/**
 * Full decision, so the editor can explain itself instead of silently falling
 * back to plain text. `shouldConvertHtml` is just `classifyPaste(...).convert`.
 */
export function classifyPaste(html: string, plain: string): PasteDecision {
  const text = plain || stripTags(html || '')

  if (isImagePlaceholderText(text)) {
    return {
      kind: 'image-placeholder',
      convert: false,
      lang: '',
      reason: t('paste.imagePlaceholder'),
    }
  }

  if (!html || !html.trim()) {
    return { kind: 'plain-text', convert: false, lang: '', reason: t('paste.plainText') }
  }

  if (looksLikeMarkdown(text)) {
    return { kind: 'already-markdown', convert: false, lang: '', reason: t('paste.alreadyMarkdown') }
  }

  if (isIdeFormattedHtml(html, text)) {
    return {
      kind: 'ide-code',
      convert: false,
      lang: detectLanguageFromHtml(html),
      reason: t('paste.ideCode'),
    }
  }

  if (isCodeOnlyHtml(html) || isMostlyCode(text)) {
    return {
      kind: 'code-block',
      convert: false,
      lang: detectLanguageFromHtml(html),
      reason: t('paste.codeBlock'),
    }
  }

  return { kind: 'convert', convert: true, lang: '', reason: '' }
}

/** Gate aggregate: should this paste go through `htmlToDialect`? */
export function shouldConvertHtml(html: string, plain: string): boolean {
  return classifyPaste(html, plain).convert
}

// ---------------------------------------------------------------------------
// HTML source cleaning (runs before turndown sees the markup)
// ---------------------------------------------------------------------------

/**
 * Word/Feishu/Notion clipboard HTML is mostly bookkeeping. turndown happily
 * turns the leftovers into text, so the junk has to go first.
 *
 * Regex rather than DOM: this module must run under vitest's node environment,
 * where there is no DOMParser. Every pattern below targets a whole construct
 * (comment, element pair, attribute) so it cannot split a tag in half.
 */
export function cleanHtmlSource(html: string): string {
  let s = html
  // Word wraps VML in conditional comments; the payload is not HTML at all.
  s = s.replace(/<!--\[if\b[\s\S]*?<!\[endif\]-->/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<\?xml[\s\S]*?\?>/gi, '')
  s = s.replace(/<!DOCTYPE[^>]*>/gi, '')
  // Non-content islands. Paired first, then any self-closing/unclosed leftovers.
  s = s.replace(/<(style|script|xml|title|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  // Regions turndown drops wholesale. They have to go here too, or the regex
  // image scan counts <img> tags turndown never visits — the classic case is
  // `<noscript><img src="real.png"></noscript>` from a lazy-loading page — and
  // every caption after it lands on the wrong image.
  s = s.replace(/<(svg|math|noscript|template|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  s = s.replace(/<(?:style|script|xml|meta|link|base|title|head)\b[^>]*>/gi, '')
  // Office namespaces: <o:p>, </w:WordDocument>, <v:shape …>.
  s = s.replace(/<\/?[a-z][a-z0-9]*(?::[a-z0-9._-]+)+\b[^>]*>/gi, '')
  // Editor bookkeeping attributes. Requires a preceding space so `src="data:…"`
  // is never touched, and keeps data-language/data-lang, which is how some code
  // blocks declare their fence language.
  s = s.replace(/\s(?:data-(?!language\b|lang\b)[\w:.-]+|aria-[\w:.-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/gi, '')
  // Word paragraph classes carry layout, not meaning.
  s = s.replace(/\sclass\s*=\s*(?:"Mso[A-Za-z]*"|'Mso[A-Za-z]*'|Mso[A-Za-z]*)(?=[\s/>])/gi, '')
  // Zero-width junk that would otherwise survive as text nodes.
  return s.replace(/[\u200b\u2060\ufeff]/g, '')
}

// ---------------------------------------------------------------------------
// image scanning
// ---------------------------------------------------------------------------

/**
 * Every `<img>` in document order, src-less ones included so the sequence lines
 * up with the `![alt]()` slots `htmlToDialect` emits.
 */
function scanImages(html: string): PastedImage[] {
  const out: PastedImage[] = []
  // Quoted-attribute aware: a `>` inside alt="a > b" must not end the tag.
  const re = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[0]
    const src = decodeEntities(attr(tag, 'src') || firstSrcsetUrl(attr(tag, 'srcset')) || '')
    const alt = compact(decodeEntities(attr(tag, 'alt') || attr(tag, 'title') || attr(tag, 'aria-label') || ''))
    out.push({ src, alt: alt.slice(0, 120), isDataUri: /^data:/i.test(src) })
  }
  return out
}

/**
 * Images worth uploading, in document order.
 *
 * The k-th entry corresponds to the k-th image slot `htmlToDialect` produced for
 * an `<img>` that had a src. `fillImageSlots` does that rewrite; prefer it over
 * hand-rolled string surgery.
 */
export function extractImages(html: string): PastedImage[] {
  return scanImages(cleanHtmlSource(html)).filter((img) => img.src !== '')
}

/**
 * Write uploaded URLs back into `![alt]()` placeholders, in document order.
 * Slots left over keep their empty src and stay placeholder figures.
 */
export function fillImageSlots(md: string, urls: string[]): string {
  let i = 0
  let inCode = false
  let fenceChar = ''
  let fenceLen = 0
  return md
    .split('\n')
    .map((line) => {
      const open = line.match(/^[ \t]*(`{3,}|~{3,})/)
      if (inCode) {
        if (open && open[1][0] === fenceChar && open[1].length >= fenceLen && /^[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(line)) inCode = false
        return line
      }
      if (open) {
        inCode = true
        fenceChar = open[1][0]
        fenceLen = open[1].length
        return line
      }
      return line.replace(/(!\[[^\]]*\])\(\s*\)/g, (whole, altPart: string) => {
        const url = urls[i++]
        // A bare space or paren would end the destination early; %-encode them.
        return url ? `${altPart}(${url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')})` : whole
      })
    })
    .join('\n')
}

function firstSrcsetUrl(srcset: string): string {
  if (!srcset) return ''
  const first = srcset.split(',')[0] || ''
  return first.trim().split(/\s+/)[0] || ''
}

// ---------------------------------------------------------------------------
// shared string helpers
// ---------------------------------------------------------------------------

const ZERO_WIDTH_RE = /[\u200b\u2060\ufeff]/g

function compact(s: string): string {
  return s.replace(ZERO_WIDTH_RE, '').replace(/[\u00a0\s]+/g, ' ').trim()
}

export function stripTags(html: string): string {
  return html
    .replace(/<(style|script|xml|title|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '\u00b7',
  times: '\u00d7',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}

/** Read one attribute out of a single tag's source text. */
function attr(tag: string, name: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const m = tag.match(re)
  if (!m) return ''
  return (m[1] ?? m[2] ?? m[3] ?? '').trim()
}

/**
 * Move whitespace outside the delimiters. markdown-it-mark refuses `== a ==`,
 * and `** x **` has the same problem, so emphasis has to hug its content.
 */
function emphasize(content: string, open: string, close: string): string {
  const m = content.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m) return content
  const [, lead, core, trail] = m
  if (!core) return content
  return lead + open + core + close + trail
}

// ---------------------------------------------------------------------------
// inline style → dialect emphasis
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  olive: [128, 128, 0],
  fuchsia: [255, 0, 255],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
}

export function parseCssColor(value: string): [number, number, number] | null {
  const v = (value || '').trim().toLowerCase()
  if (!v) return null
  const hex = v.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    }
    if (h.length >= 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    return null
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/)
  if (rgb) {
    const chan = (raw: string) => {
      const n = parseFloat(raw)
      return raw.endsWith('%') ? Math.round((n / 100) * 255) : Math.round(n)
    }
    return [chan(rgb[1]), chan(rgb[2]), chan(rgb[3])]
  }
  const named = NAMED_COLORS[v.replace(/[^a-z]/g, '')]
  return named ? [named[0], named[1], named[2]] : null
}

/**
 * Is this a deliberate accent colour rather than body text? Feishu tags every
 * bold span with `color: rgb(31, 35, 41)` and Word with `#333`, so "any colour
 * at all" would flood the document with `==`. Chroma separates the two: a real
 * accent is saturated, body text is near-grey.
 */
export function isAccentColor(value: string): boolean {
  const rgb = parseCssColor(value)
  if (!rgb) return false
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 40) return false // near-black
  if (min > 215) return false // near-white
  return max - min >= 48
}

const NON_HIGHLIGHT_BG = /^(?:none|transparent|inherit|initial|unset|auto|#fff|#ffffff|#ffffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*[,/]\s*(?:1|1\.0*)\s*\))$/

/**
 * Does this inline style mean "highlighted"? Covers `<span style="background…">`,
 * Word's `mso-highlight`, and `text-decoration: underline` — all of which are
 * what our `==重点==` is for.
 */
export function isHighlightStyle(style: string): boolean {
  const s = (style || '').toLowerCase().replace(/\s+/g, ' ')
  if (!s) return false
  if (/mso-highlight:[^;]*(?:;|$)/.test(s) && !/mso-highlight:\s*none/.test(s)) return true
  if (/text-decoration(?:-line)?\s*:[^;]*underline/.test(s)) return true
  const bg = s.match(/(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/)
  if (bg) {
    const value = bg[1].trim()
    if (value && !/url\(/.test(value) && !NON_HIGHLIGHT_BG.test(value.replace(/\s+/g, ' '))) return true
  }
  return false
}

export function styleOf(node: { getAttribute: (n: string) => string | null }): string {
  return (node.getAttribute('style') || '').toLowerCase()
}

/** Colour declared on the element itself, via style or a legacy `color` attr. */
function colorOf(node: { getAttribute: (n: string) => string | null }): string {
  const style = styleOf(node)
  const m = style.match(/(?:^|[;\s])color\s*:\s*([^;]+)/)
  if (m) return m[1].trim()
  return node.getAttribute('color') || ''
}

// ---------------------------------------------------------------------------
// code fences
// ---------------------------------------------------------------------------

const LANG_ALIAS: Record<string, string> = {
  javascript: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  tsx: 'tsx',
  node: 'js',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  shellscript: 'bash',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  golang: 'go',
  'c++': 'cpp',
  cxx: 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  cshtml: 'razor',
  plaintext: 'text',
  plain: 'text',
  none: '',
  txt: 'text',
  vue: 'vue',
  objectivec: 'objc',
  'objective-c': 'objc',
}

export function normalizeLanguage(raw: string): string {
  const lang = (raw || '').trim().toLowerCase().replace(/^\.+/, '')
  if (!lang || !/^[a-z0-9+#._-]+$/.test(lang)) return ''
  return LANG_ALIAS[lang] ?? lang
}

/**
 * Pull a fence language out of whatever a source app left behind: Prism's
 * `language-x`, `lang-x`, highlight.js, SyntaxHighlighter's `brush: x`,
 * `data-language`, or a bare `class="js"`.
 */
export function detectCodeLanguage(...classOrDataSources: (string | null | undefined)[]): string {
  for (const source of classOrDataSources) {
    const s = (source || '').trim()
    if (!s) continue
    const explicit =
      s.match(/(?:language|lang)-([a-z0-9+#._-]+)/i) ||
      s.match(/brush:\s*([a-z0-9+#._-]+)/i) ||
      s.match(
        /^(?:js|ts|jsx|tsx|javascript|typescript|py|python|rb|ruby|go|golang|rs|rust|java|kt|kotlin|swift|scala|c|cpp|c\+\+|cs|csharp|php|pl|perl|lua|r|dart|bash|sh|shell|zsh|console|sql|css|scss|less|html|xml|json|ya?ml|toml|ini|conf|md|markdown|diff|makefile|dockerfile|cmake|graphql|vue|svelte|text|plaintext)$/i,
      )
    if (explicit) {
      const lang = normalizeLanguage(explicit[1] ?? explicit[0])
      if (lang) return lang
    }
  }
  return ''
}

/** Detect a language straight from raw HTML, for the "wrap it in a fence" gates. */
export function detectLanguageFromHtml(html: string): string {
  const tags = html.match(/<(?:pre|code)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || []
  for (const tag of tags) {
    const lang = detectCodeLanguage(attr(tag, 'class'), attr(tag, 'data-language'), attr(tag, 'lang'))
    if (lang) return lang
  }
  const wrapper = html.match(/<div\b[^>]*class=["'][^"']*highlight-source-([a-z0-9+#-]+)/i)
  return wrapper ? normalizeLanguage(wrapper[1]) : ''
}

/** Longest backtick run in the code decides how long the fence has to be. */
export function fenceFor(code: string): string {
  let len = 3
  const re = /`{3,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) len = Math.max(len, m[0].length + 1)
  return '`'.repeat(len)
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

type CellAlign = '---' | ':---' | ':---:' | '---:'

function cellAlignOf(node: HTMLElement): CellAlign {
  const style = styleOf(node)
  const fromStyle = style.match(/text-align\s*:\s*([a-z]+)/)
  // Word puts the alignment on the paragraph inside the cell, not the cell.
  const inner = node.querySelector('[align],[style*="text-align"]')
  const innerStyle = inner ? styleOf(inner as HTMLElement) : ''
  const innerMatch = innerStyle.match(/text-align\s*:\s*([a-z]+)/)
  const value = (
    (node.getAttribute('align') || '').toLowerCase() ||
    (fromStyle ? fromStyle[1] : '') ||
    (inner && inner.getAttribute('align') ? (inner.getAttribute('align') || '').toLowerCase() : '') ||
    (innerMatch ? innerMatch[1] : '')
  )
  if (value === 'center') return ':---:'
  if (value === 'right') return '---:'
  if (value === 'left') return ':---'
  return '---'
}

function cellElements(row: HTMLElement): HTMLElement[] {
  return Array.from(row.children).filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH') as HTMLElement[]
}

/**
 * A row that can carry the GFM header. The plugin only accepts a `<thead>` or an
 * all-`<th>` first row, and `keep`s every other table as raw HTML — which our
 * dialect cannot render at all. Header-less tables promote their first row.
 */
function isHeadingRow(row: HTMLElement): boolean {
  const parent = row.parentElement
  if (!parent) return false
  if (parent.nodeName === 'THEAD') return true
  const cells = cellElements(row)
  if (cells.length > 0 && cells.every((c) => c.nodeName === 'TH')) return true
  // Header-less table: promote the first row, otherwise there is no place to
  // hang the GFM separator and the table cannot be parsed at all.
  let table: HTMLElement | null = parent
  while (table && table.nodeName !== 'TABLE') table = table.parentElement
  if (!table) return false
  const rows = Array.from(table.querySelectorAll('tr'))
  return rows.length > 0 && rows[0] === row
}

/** GFM cells are single-line, so nested blocks collapse into one row of text. */
export function flattenCellContent(content: string): string {
  return content
    .trim()
    .replace(/(?<!\\)\|/g, '\\|')
    // A <br> became a `\` hard break; only an odd trailing run is a break, an
    // even one is an escaped literal backslash and must survive.
    .replace(/(^|[^\\])((?:\\\\)*)\\\n/g, '$1$2\n')
    .replace(/\s*\n\s*/g, ' ')
}

export function countTableCells(line: string): number {
  return Math.max(0, (line.match(/(?<!\\)\|/g) || []).length - 1)
}

// ---------------------------------------------------------------------------
// quotes & centered blocks
// ---------------------------------------------------------------------------

const BLOCK_MARKERS = /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|>|:::|\||`{3,}|~{3,}|#{1,6}[ \t])/m

/**
 * Our dialect renders a single-paragraph `>` as a pull-quote card and a
 * `:::quote` box for everything else, so the decision is "is this one paragraph
 * of prose?".
 */
export function isQuoteCardContent(content: string): boolean {
  const t = (content || '').trim()
  if (!t) return false
  if (t.split(/\n{2,}/).filter((s) => s.trim() !== '').length !== 1) return false
  return !BLOCK_MARKERS.test(t)
}

function isCenterAligned(node: HTMLElement): boolean {
  if (node.nodeName === 'CENTER') return true
  if ((node.getAttribute('align') || '').toLowerCase() === 'center') return true
  return /text-align\s*:\s*center/.test(styleOf(node))
}

/**
 * Manual ancestor walk rather than `Element.closest`: the module has to behave
 * identically under domino (Node) and a real browser DOM.
 */
function hasAncestor(node: HTMLElement, names: Set<string>): boolean {
  let current: HTMLElement | null = node.parentElement
  while (current) {
    if (names.has(current.nodeName)) return true
    current = current.parentElement
  }
  return false
}

const TABLE_ANCESTORS = new Set(['TD', 'TH', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR'])

// ---------------------------------------------------------------------------
// turndown service
// ---------------------------------------------------------------------------

const NOISE_TAGS = new Set([
  'STYLE',
  'SCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'SVG',
  'MATH',
  'FORM',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'NOSCRIPT',
  'TEMPLATE',
  'PROGRESS',
  'METER',
  'DIALOG',
  'MAP',
  'AREA',
  'PARAM',
  'SOURCE',
  'TRACK',
  'PORTAL',
])

const MARK_TAGS = new Set(['MARK', 'U', 'INS'])
const EMPHASIS_DELIMITERS: Record<string, [string, string]> = {
  B: ['**', '**'],
  STRONG: ['**', '**'],
  I: ['*', '*'],
  EM: ['*', '*'],
  DEL: ['~~', '~~'],
  S: ['~~', '~~'],
  STRIKE: ['~~', '~~'],
}

interface ServiceContext {
  images: PastedImage[]
  options: HtmlToDialectOptions
}

function createService(ctx: ServiceContext): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    // `\` survives the trailing-whitespace pass; two spaces would not.
    br: '\\',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })
  td.use(gfm)
  td.remove((node) => NOISE_TAGS.has(node.nodeName))

  // --- headings: h1..h3 map 1:1, h4..h6 collapse onto our third level -------
  td.addRule('dialectHeading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const text = content.trim()
      if (!text) return ''
      const level = Math.min(3, Number(node.nodeName.charAt(1)))
      // `## a | b` is our KICKER | 标题 form. A pasted title never means that, so
      // swap in the fullwidth bar: same look when rendered, no kicker split.
      const body = level === 2 ? text.replace(/\|/g, '\uff5c') : text
      return `\n\n${'#'.repeat(level)} ${body}\n\n`
    },
  })

  // --- `==重点==`: <mark>/<u>/<ins>, plus highlighted or accented emphasis ---
  td.addRule('dialectMark', {
    filter: (node) => {
      if (MARK_TAGS.has(node.nodeName)) return true
      const delimiters = EMPHASIS_DELIMITERS[node.nodeName]
      if (!delimiters) return false
      const style = styleOf(node)
      if (isHighlightStyle(style)) return true
      return (node.nodeName === 'B' || node.nodeName === 'STRONG') && isAccentColor(colorOf(node))
    },
    replacement: (content, node) => {
      const delimiters = EMPHASIS_DELIMITERS[node.nodeName]
      const inner = delimiters ? emphasize(content, delimiters[0], delimiters[1]) : content
      return emphasize(inner, '==', '==')
    },
  })

  // --- <del>/<s> need `~~`, the gfm plugin emits a single tilde -------------
  td.addRule('dialectStrikethrough', {
    // A function rather than ['del','s','strike']: `strike` is obsolete and is
    // not in HTMLElementTagNameMap, so it cannot appear in a TagName[] filter.
    filter: (node) => node.nodeName === 'DEL' || node.nodeName === 'S' || node.nodeName === 'STRIKE',
    replacement: (content) => emphasize(content, '~~', '~~'),
  })

  // --- Notion/Feishu style with spans instead of semantic tags --------------
  td.addRule('dialectStyledSpan', {
    filter: (node) => node.nodeName === 'SPAN' || node.nodeName === 'FONT',
    replacement: (content, node) => {
      const style = styleOf(node)
      let out = content
      if (/font-weight\s*:\s*(?:bold(?:er)?|[6-9]00)/.test(style)) out = emphasize(out, '**', '**')
      if (/font-style\s*:\s*italic/.test(style)) out = emphasize(out, '*', '*')
      if (/text-decoration(?:-line)?\s*:[^;]*line-through/.test(style)) out = emphasize(out, '~~', '~~')
      if (isHighlightStyle(style)) out = emphasize(out, '==', '==')
      return out
    },
  })

  // --- links: drop `file:` and fragment-only hrefs, keep the text -----------
  td.addRule('dialectLink', {
    filter: (node) => node.nodeName === 'A',
    replacement: (content, node) => {
      const href = (node.getAttribute('href') || '').trim()
      const text = content.trim()
      if (!href || /^(?:#|file:|javascript:|data:)/i.test(href)) return text
      const label = text || href
      if (!label) return ''
      return `[${label}](${href.replace(/\s/g, '%20')})`
    },
  })

  // --- images: src is always blanked, the upload flow fills it back in ------
  let imageIndex = 0
  td.addRule('dialectImage', {
    filter: (node) => node.nodeName === 'IMG',
    replacement: (_content, node) => {
      const index = imageIndex++
      // Attributes come from the node, not from the positional scan: the scan
      // counts images turndown never visits (inside a removed <svg>), and an
      // index lookup would mis-caption every image after the divergence.
      const src = node.getAttribute('src') || ''
      const image: PastedImage = ctx.images[index] ?? {
        src,
        alt: node.getAttribute('alt') || '',
        isDataUri: /^data:/i.test(src),
      }
      // A wrapping <figure>'s caption is the best alt we are going to get.
      const figure = node.parentElement && node.parentElement.nodeName === 'FIGURE' ? node.parentElement : null
      const caption = figure ? (figure.querySelector('figcaption')?.textContent || '') : ''
      const rawAlt = node.getAttribute('alt') || node.getAttribute('title') || ''
      const alt = compact(ctx.options.imageAlt?.(image, index) || rawAlt || compact(caption))
      return `![${alt.replace(/[\[\]]/g, '')}]()`
    },
  })

  // The caption already became the figure's alt, which is our dialect's 图注;
  // emitting it again as a paragraph would print it twice.
  td.addRule('dialectFigcaption', {
    filter: (node) => node.nodeName === 'FIGCAPTION',
    replacement: (content, node) => {
      const figure = node.parentElement
      if (figure && figure.querySelector('img')) return ''
      const text = content.trim()
      return text ? `\n\n${text}\n\n` : ''
    },
  })

  // --- code blocks: language from class/data-*, fence sized to the content --
  td.addRule('dialectPre', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const codeEl = Array.from(node.children).find((c) => c.nodeName === 'CODE') as HTMLElement | undefined
      const parent = node.parentElement
      const lang = detectCodeLanguage(
        codeEl?.getAttribute('data-language'),
        node.getAttribute('data-language'),
        codeEl?.getAttribute('class'),
        node.getAttribute('class'),
        parent?.getAttribute('class'),
      )
      const code = ((codeEl ?? node).textContent || '').replace(/\n$/, '')
      if (!code.trim()) return ''
      const fence = fenceFor(code)
      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`
    },
  })

  // --- lists: CommonMark nesting indent, i.e. the width of the marker -------
  td.addRule('dialectListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentElement
      let prefix = `${options.bulletListMarker ?? '-'} `
      if (parent && parent.nodeName === 'OL') {
        const start = parent.getAttribute('start')
        const index = parent ? Array.from(parent.children).indexOf(node) : 0
        prefix = `${start ? Number(start) + index : index + 1}. `
      }
      const isParagraph = /\n$/.test(content)
      // gfm's taskListItems emits `[x] ` and the label text keeps its own space.
      const body = trimNewlines(content).replace(/^\[([ xX])\][ \t]+/, '[$1] ') + (isParagraph ? '\n' : '')
      const indented = body.replace(/\n/gm, `\n${' '.repeat(prefix.length)}`)
      return prefix + indented + (node.nextSibling ? '\n' : '')
    },
  })

  // --- tables ---------------------------------------------------------------
  td.addRule('dialectTableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const text = flattenCellContent(content)
      const siblings = node.parentElement ? Array.from(node.parentElement.children) : []
      const prefix = siblings.indexOf(node) === 0 ? '| ' : ' '
      return `${prefix}${text} |`
    },
  })

  td.addRule('dialectTableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      let border = ''
      if (isHeadingRow(node as HTMLElement)) {
        border = cellElements(node as HTMLElement).map((c) => ` ${cellAlignOf(c)} `).join('|')
        border = `|${border}|`
      }
      return `\n${content}${border ? `\n${border}` : ''}`
    },
  })

  td.addRule('dialectTableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: (content) => content,
  })

  td.addRule('dialectTable', {
    // Every table, header row or not: raw HTML kept by the gfm plugin renders as
    // literal text in our dialect.
    filter: 'table',
    replacement: (content) => {
      const lines = content
        .split('\n')
        .map((l) => l.replace(/[ \t]+$/, ''))
        .filter((l) => l.trim() !== '')
      if (!lines.length) return ''
      const hasBorder = lines.length > 1 && /^\|[\s:|-]+\|$/.test(lines[1])
      if (!hasBorder) {
        const cols = Math.max(1, countTableCells(lines[0]))
        lines.splice(1, 0, `|${' --- |'.repeat(cols)}`)
      }
      return `\n\n${lines.join('\n')}\n\n`
    },
  })

  // --- blockquote: one paragraph is a pull-quote card, more is a :::quote box
  td.addRule('dialectBlockquote', {
    filter: 'blockquote',
    replacement: (content) => {
      const text = content.trim()
      if (!text) return ''
      if (isQuoteCardContent(text)) {
        const quoted = text
          .split('\n')
          .map((l) => (l.trim() ? `> ${l}` : '>'))
          .join('\n')
        return `\n\n${quoted}\n\n`
      }
      return `\n\n:::quote\n${text}\n:::\n\n`
    },
  })

  // --- centered paragraphs become :::center ---------------------------------
  td.addRule('dialectCenter', {
    filter: (node) => {
      const tag = node.nodeName
      if (tag !== 'CENTER' && tag !== 'P' && tag !== 'DIV' && tag !== 'SECTION') return false
      if (!isCenterAligned(node as HTMLElement)) return false
      // A centered paragraph inside a cell would leak `:::center` into the GFM
      // row, where it is just text. Alignment there is the cell's business.
      if (hasAncestor(node as HTMLElement, TABLE_ANCESTORS)) return false
      // A page-wide centered wrapper would swallow the whole document, and an
      // image inside :::center is dropped by the parser (containers only keep
      // inline tokens), so both stay transparent.
      if (node.querySelector('img,table,ul,ol,pre,blockquote,h1,h2,h3,h4,h5,h6,p,div,section')) return false
      return (node.textContent || '').trim() !== ''
    },
    replacement: (content) => {
      const text = content.trim()
      if (!text) return ''
      return `\n\n:::center\n${text}\n:::\n\n`
    },
  })

  return td
}

function trimNewlines(s: string): string {
  return s.replace(/^\n+/, '').replace(/\n+$/, '')
}

// ---------------------------------------------------------------------------
// Markdown post-pass
// ---------------------------------------------------------------------------

interface MdLine {
  line: string
  code: boolean
}

/** Line view that knows which lines are inside a fence, so code is never touched. */
export function splitCodeAware(src: string): MdLine[] {
  const out: MdLine[] = []
  let fenceChar = ''
  let fenceLen = 0
  for (const line of src.split('\n')) {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})/)
    if (fenceChar) {
      out.push({ line, code: true })
      if (marker && marker[1][0] === fenceChar && marker[1].length >= fenceLen && /^[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(line)) {
        fenceChar = ''
        fenceLen = 0
      }
      continue
    }
    if (marker) {
      fenceChar = marker[1][0]
      fenceLen = marker[1].length
      out.push({ line, code: true })
      continue
    }
    out.push({ line, code: false })
  }
  return out
}

/**
 * Trailing backslash count tells a `\` hard break apart from an escaped `\\`.
 */
function trailingBackslashes(line: string): number {
  let n = 0
  while (n < line.length && line[line.length - 1 - n] === '\\') n++
  return n
}

/**
 * Clean up after turndown: zero-width junk, NBSP, trailing whitespace, blank-line
 * runs, and the indentation artifacts Word's spacerun spans leave behind.
 */
export function normalizeDialectMarkdown(src: string): string {
  const lines = splitCodeAware(src.replace(/\r\n?/g, '\n').replace(ZERO_WIDTH_RE, ''))
  const out: string[] = []
  let blanks = 0

  for (let i = 0; i < lines.length; i++) {
    const { line, code } = lines[i]
    if (code) {
      out.push(line)
      blanks = 0
      continue
    }
    let l = line.replace(/\u00a0/g, ' ').replace(/[ \t]+$/, '')
    l = l.replace(/^([ \t]*)>[ \t]+$/, '$1>')
    if (!l.trim()) {
      blanks++
      if (blanks > 1) continue
      out.push('')
      continue
    }
    blanks = 0
    // Word's spacerun spans leave leading whitespace on a paragraph. Four spaces
    // would turn it into an indented code block; any amount is just noise. Real
    // nesting is safe here: it always follows another list line (so `startsBlock`
    // is false) or is itself a list item (so the marker guard excludes it).
    const startsBlock = out.length === 0 || out[out.length - 1] === ''
    if (startsBlock && /^[ \t]+\S/.test(l) && !/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/.test(l)) {
      l = l.replace(/^[ \t]+/, '')
    }
    out.push(l)
  }

  // A hard break that ended up at the very end of a paragraph is just noise.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1] === '' && trailingBackslashes(out[i]) % 2 === 1) out[i] = out[i].slice(0, -1)
  }

  return trimNewlines(out.join('\n'))
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Convert clipboard `text/html` into our dialect.
 *
 * The second argument is optional: pass `imageAlt` to caption figures that the
 * source left unnamed. Images are emitted as `![alt]()` with an empty src —
 * a base64 data URI in the editor buffer would freeze CodeMirror and blow past
 * the document row's size, and `extractImages` + `fillImageSlots` already carry
 * the bytes through the upload flow without ever putting them in the text.
 */
export function htmlToDialect(html: string, options: HtmlToDialectOptions = {}): string {
  const cleaned = cleanHtmlSource(html || '')
  if (!cleaned.trim()) return ''
  const td = createService({ images: scanImages(cleaned), options })
  return normalizeDialectMarkdown(td.turndown(cleaned))
}
