/**
 * The last gate between MathJax's SVG and the article.
 *
 * Everything upstream of this file is a policy decision (which TeX packages
 * exist, whether the Safe extension is on); this is the one that holds even if a
 * policy decision is wrong, an output-jax option changes, or a future MathJax
 * starts emitting an attribute nobody expected. It is a strict, fail-closed
 * filter over the one shape of markup MathJax produces for us:
 *
 *   - `mjx-container` is unwrapped; exactly one `<svg>` must remain.
 *   - Only drawing elements survive. `script`, `style`, `foreignObject`,
 *     `image`, `use`, `defs` and friends are dropped whole - a formula has no
 *     business carrying any of them. `<a>` (which `\href` produces) is
 *     unwrapped, so the formula keeps its glyphs and loses only the link.
 *   - Attributes are a whitelist with a value pattern each, so `class`, `id`,
 *     `href`, `xlink:*`, every `on*` handler and all `data-*` bookkeeping
 *     (`data-latex` echoes the raw TeX) never reach the DOM. A value that does
 *     not match its pattern drops the attribute rather than being escaped: a
 *     formula that loses a decoration still reads, one that keeps a
 *     half-escaped URL does not.
 *   - `style` is the only free-form attribute, so it is parsed declaration by
 *     declaration against a property allowlist, with `url()` and friends
 *     rejected outright.
 *
 * Malformed markup throws. The caller treats that exactly like a formula that
 * does not compile: the TeX is shown as text and the refusal is logged.
 * Silence would be worse - it would paste a half-filtered formula into the
 * article.
 */

/** Element names MathJax's SVG output legitimately uses for our package set. */
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
])

/** Removed together with everything inside them - a formula never needs these. */
const DROPPED_SUBTREES = new Set([
  'script', 'style', 'foreignobject', 'iframe', 'image', 'use', 'defs', 'symbol', 'marker', 'pattern',
  'clippath', 'mask', 'filter', 'animate', 'animatemotion', 'animatetransform', 'set', 'title', 'desc',
  'metadata', 'link', 'meta', 'html', 'body', 'head', 'object', 'embed', 'audio', 'video', 'canvas',
])

/** Containers whose element goes but whose children stay. */
const UNWRAPPED = new Set(['mjx-container', 'a', 'span', 'math', 'semantics'])

const LENGTH = /^-?\d+(?:\.\d+)?(?:ex|em|px|pt|pc|in|cm|mm|%)?$/
const NUMBER = /^-?\d+(?:\.\d+)?$/
const COLOR =
  /^(?:currentColor|none|transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\))$/
const TRANSFORM = /^(?:(?:scale|translate|rotate|matrix|skewX|skewY)\([\d.,eE\s+-]*\))+$/
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/
const FONT_FAMILY = /^[A-Za-z0-9\s',-]+$/

/** name -> value pattern. A name missing here never reaches the DOM. */
const ATTRIBUTES: Record<string, RegExp> = {
  xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
  width: LENGTH,
  height: LENGTH,
  viewBox: /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/,
  role: /^(?:img|presentation)$/,
  focusable: /^(?:true|false)$/,
  'aria-hidden': /^(?:true|false)$/,
  fill: COLOR,
  stroke: COLOR,
  'stroke-width': NUMBER,
  'stroke-dasharray': /^[\d.,\s]+$/,
  'stroke-linecap': /^(?:butt|round|square)$/,
  'stroke-linejoin': /^(?:miter|round|bevel)$/,
  'stroke-miterlimit': NUMBER,
  'fill-rule': /^(?:nonzero|evenodd)$/,
  'clip-rule': /^(?:nonzero|evenodd)$/,
  transform: TRANSFORM,
  d: PATH_DATA,
  points: /^[\d\s,.-]+$/,
  x: LENGTH,
  y: LENGTH,
  x1: NUMBER,
  y1: NUMBER,
  x2: NUMBER,
  y2: NUMBER,
  cx: NUMBER,
  cy: NUMBER,
  r: NUMBER,
  rx: NUMBER,
  ry: NUMBER,
  'font-size': LENGTH,
  'font-family': FONT_FAMILY,
  'font-style': /^(?:normal|italic)$/,
  'font-weight': /^(?:normal|bold|\d{3})$/,
  'text-anchor': /^(?:start|middle|end)$/,
}

/** Properties `\bbox` and `\color` legitimately need; everything else is dropped. */
const STYLE_PROPERTIES = new Set([
  'vertical-align', 'background', 'background-color', 'border', 'border-color', 'border-style',
  'border-width', 'border-radius', 'padding', 'margin', 'color', 'fill', 'stroke', 'font-size',
])

/**
 * Attribute names as they must be written out, keyed by their lowercase form.
 * Lookups are case-insensitive because HTML parsing lowercases attribute names
 * (`ONLOAD` is `onload`), while SVG needs its own spelling back (`viewBox`).
 */
const ATTRIBUTE_NAMES = new Map(Object.keys(ATTRIBUTES).map((name) => [name.toLowerCase(), name]))

/** Attribute names that never survive, however they are spelled. */
function isForbiddenAttribute(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('on') || lower === 'href' || lower.endsWith(':href')
}

const STYLE_VALUE = /^[A-Za-z0-9#.,%() +*/-]+$/

export class UnsafeMathMarkupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeMathMarkupError'
  }
}

/** `style="a: b; c: d"` -> the safe subset, or null when the attribute must go. */
export function sanitizeStyleValue(style: string): string | null {
  const declarations: string[] = []
  for (const raw of style.split(';')) {
    const declaration = raw.trim()
    if (!declaration) continue
    const colon = declaration.indexOf(':')
    if (colon < 0) return null
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (!STYLE_PROPERTIES.has(property)) return null
    if (!value || !STYLE_VALUE.test(value)) return null
    // url() would fetch on open - a tracking pixel in the exported page - and
    // expression/import are the classic CSS escape hatches.
    if (/url|expression|import|javascript|\\/i.test(value)) return null
    declarations.push(`${property}: ${value}`)
  }
  return declarations.length ? declarations.join('; ') : null
}

type Element = { kind: 'element'; tag: string; attrs: Map<string, string>; children: Node[] }
type Text = { kind: 'text'; value: string }
type Node = Element | Text

/**
 * Tokenize and nest. Attribute values must be quoted - which is what MathJax
 * and every browser produce - so an unquoted value or a stray `<` is treated as
 * structural damage instead of being guessed at.
 */
function parse(markup: string): Node[] {
  const root: Element = { kind: 'element', tag: '#root', attrs: new Map(), children: [] }
  const stack: Element[] = [root]
  let i = 0
  while (i < markup.length) {
    const lt = markup.indexOf('<', i)
    if (lt < 0) {
      pushText(stack[stack.length - 1], markup.slice(i))
      break
    }
    if (lt > i) pushText(stack[stack.length - 1], markup.slice(i, lt))
    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt)
      if (end < 0) throw new UnsafeMathMarkupError('unterminated comment')
      i = end + 3
      continue
    }
    const gt = findTagEnd(markup, lt)
    if (gt < 0) throw new UnsafeMathMarkupError('unterminated tag')
    const token = parseTag(markup.slice(lt + 1, gt))
    if (token.closing) {
      const open = stack.pop()
      if (!open || open.tag !== token.tag) {
        throw new UnsafeMathMarkupError(`</${token.tag}> does not close <${open?.tag ?? 'nothing'}>`)
      }
    } else {
      const element: Element = { kind: 'element', tag: token.tag, attrs: token.attrs, children: [] }
      stack[stack.length - 1].children.push(element)
      if (!token.selfClosing) stack.push(element)
    }
    i = gt + 1
  }
  if (stack.length !== 1) throw new UnsafeMathMarkupError(`unclosed <${stack[stack.length - 1].tag}>`)
  return root.children
}

function pushText(parent: Element, value: string): void {
  if (value) parent.children.push({ kind: 'text', value })
}

/** Index of the `>` that closes the tag, ignoring any inside quoted values. */
function findTagEnd(markup: string, from: number): number {
  let quote = ''
  for (let i = from + 1; i < markup.length; i++) {
    const c = markup[i]
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return -1
}

function parseTag(body: string): { tag: string; closing: boolean; selfClosing: boolean; attrs: Map<string, string> } {
  const closing = body.startsWith('/')
  const selfClosing = !closing && body.trimEnd().endsWith('/')
  const inner = body.replace(/^\//, '').replace(/\/$/, '').trimStart()
  const match = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner)
  if (!match) throw new UnsafeMathMarkupError(`unreadable tag: ${body.slice(0, 40)}`)
  const tag = match[1].toLowerCase()
  const attrs = new Map<string, string>()
  const rest = inner.slice(match[1].length)
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  // Names are kept as written: SVG is case-sensitive, and `viewBox` written as
  // `viewbox` is a different attribute. Matching against the whitelist lowercases.
  while ((m = re.exec(rest))) attrs.set(m[1], m[2] !== undefined ? m[2] : m[3])
  // Whatever the attribute regex did not consume must be whitespace; anything
  // else means the tag held something we did not read (an unquoted attribute).
  if (rest.replace(re, ' ').trim()) {
    throw new UnsafeMathMarkupError(`unparsed content in <${tag}>: ${rest.replace(re, ' ').trim().slice(0, 40)}`)
  }
  return { tag, closing, selfClosing, attrs }
}

/** Keep only the children of an unwrapped element, recursively. */
function unwrap(node: Element): Node[] {
  return node.children.flatMap((child) => (child.kind === 'text' ? [child] : transform(child)))
}

function transform(node: Element): Node[] {
  const tag = node.tag
  if (DROPPED_SUBTREES.has(tag)) return []
  if (UNWRAPPED.has(tag)) return unwrap(node)
  if (!ALLOWED_ELEMENTS.has(tag)) throw new UnsafeMathMarkupError(`unexpected element <${tag}>`)
  return [{ kind: 'element', tag, attrs: node.attrs, children: node.children.flatMap((c) => (c.kind === 'text' ? [c] : transform(c))) }]
}

function renderAttrs(attrs: Map<string, string>): string {
  let out = ''
  for (const [name, value] of attrs) {
    if (isForbiddenAttribute(name)) continue
    const lower = name.toLowerCase()
    if (lower === 'style') {
      const style = sanitizeStyleValue(value)
      if (style) out += ` style="${style}"`
      continue
    }
    const canonical = ATTRIBUTE_NAMES.get(lower)
    if (!canonical) continue
    if (!ATTRIBUTES[canonical].test(value)) continue
    out += ` ${canonical}="${value}"`
  }
  return out
}

function render(node: Node): string {
  if (node.kind === 'text') {
    // A text node can hold any character MathJax meant to draw; escape the two
    // that could change how the markup is read at all.
    return node.value.replace(/&(?!(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;')
  }
  const children = node.children.map(render).join('')
  return `<${node.tag}${renderAttrs(node.attrs)}>${children}</${node.tag}>`
}

/**
 * Filter MathJax's own SVG output down to a plain, inert drawing.
 *
 * Returns markup that begins with `<svg` and ends with `</svg>`. Throws
 * `UnsafeMathMarkupError` when the input is not a single, well-formed SVG.
 */
export function sanitizeMathSvg(markup: string): string {
  const nodes = parse(markup.trim())
  const kept = nodes.flatMap((node) => {
    if (node.kind === 'text') {
      if (node.value.trim()) throw new UnsafeMathMarkupError('text outside the root element')
      return []
    }
    return transform(node)
  })
  const roots = kept.filter((n): n is Element => n.kind === 'element')
  if (roots.length !== 1 || kept.some((n) => n.kind === 'text' && n.value.trim())) {
    throw new UnsafeMathMarkupError(`expected exactly one root element, found ${roots.length}`)
  }
  if (roots[0].tag !== 'svg') throw new UnsafeMathMarkupError(`root element is <${roots[0].tag}>, not <svg>`)
  return render(roots[0])
}
