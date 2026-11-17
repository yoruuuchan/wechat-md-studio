/**
 * Imports and renders untrusted template archives.
 *
 * Upload validation and render-time validation deliberately share this module:
 * the archive is parsed again when a stored template is activated, so a record
 * edited in DevTools cannot skip the filters. HTML is whitelisted with
 * DOMPurify (Apache-2.0 option) after an explicit scan, and CSS is parsed by
 * the browser's own CSSOM and emitted inside `@scope`, so no rule can style the
 * editor or the rest of the page. No template code is ever executed.
 */
import DOMPurify from 'dompurify'
// Type only: the zip library is fetched when a package is first opened, so
// it stays out of the editor's entry bundle.
import type JSZip from 'jszip'
import {
  CARD_TEMPLATE_LIMITS, CardTemplateError, extensionOf, isAllowedTemplatePath,
  normalizeTemplatePath, parseCardTemplateManifest,
  type ReedTemplateManifest, type TemplateKind,
} from './card-template-format'

export interface CardTemplateArchiveFile {
  path: string
  bytes: Uint8Array
}

export interface CardTemplateArchive {
  manifest: ReedTemplateManifest
  files: Map<string, CardTemplateArchiveFile>
}

const TEXT = new TextDecoder('utf-8', { fatal: true })

function text(bytes: Uint8Array, what: string): string {
  try {
    return TEXT.decode(bytes)
  } catch {
    throw new CardTemplateError('bad-manifest', `${what} 不是 UTF-8 文本`)
  }
}

function store(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * The runtime JSZipObject exposes `internalStream` / pause / resume, but the
 * published typings omit them. Keep the narrow shape this module uses.
 */
interface StreamingEntry {
  name: string
  internalStream(type: 'uint8array'): {
    on(event: 'data', callback: (chunk: Uint8Array) => void): unknown
    on(event: 'end', callback: () => void): unknown
    on(event: 'error', callback: (error: unknown) => void): unknown
    pause(): unknown
    resume(): unknown
  }
}

/**
 * Decompress one entry while counting bytes as they arrive.
 *
 * The central directory is attacker-controlled: it can claim a 1 KB file while
 * the deflate stream expands to hundreds of megabytes. JSZip's `async()` would
 * accumulate all of it before the caller could compare lengths. The streaming
 * reader pauses the worker on the first chunk past the ceiling, drops what it
 * has, and rejects, so an oversized entry never materializes in memory.
 */
export async function readArchiveEntry(
  entry: JSZip.JSZipObject,
  limit: number,
  onChunk?: (bytes: number) => void,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let stream: ReturnType<StreamingEntry['internalStream']>
    try {
      stream = (entry as unknown as StreamingEntry).internalStream('uint8array')
    } catch (error) {
      reject(new CardTemplateError('bad-zip', error instanceof Error ? error.message : String(error)))
      return
    }
    let settled = false
    let total = 0
    let chunks: Uint8Array[] = []
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      chunks = []
      stream.pause()
      reject(error instanceof CardTemplateError
        ? error
        : new CardTemplateError('bad-zip', error instanceof Error ? error.message : String(error)))
    }
    stream.on('data', (chunk: Uint8Array) => {
      if (settled) return
      total += chunk.byteLength
      onChunk?.(chunk.byteLength)
      if (total > limit) {
        fail(new CardTemplateError('archive-too-large-unpacked', `${entry.name}: ${total} bytes`))
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', fail)
    stream.on('end', () => {
      if (settled) return
      settled = true
      let size = 0
      for (const chunk of chunks) size += chunk.byteLength
      const out = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(out)
    })
    stream.resume()
  })
}

/** Read, size-check and path-check a `.reedcard` archive before decompressing. */
export async function openCardTemplateArchive(data: ArrayBuffer): Promise<CardTemplateArchive> {
  if (data.byteLength > CARD_TEMPLATE_LIMITS.archiveBytes) {
    throw new CardTemplateError('archive-too-large', `${data.byteLength} bytes`)
  }
  // Outside the try: a failed chunk download is a network error, not a bad zip.
  const { default: Zip } = await import('jszip')
  let zip: JSZip
  try {
    zip = await Zip.loadAsync(data)
  } catch (error) {
    throw new CardTemplateError('bad-zip', error instanceof Error ? error.message : String(error))
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length > CARD_TEMPLATE_LIMITS.files) {
    throw new CardTemplateError('too-many-files', String(entries.length))
  }
  const seen = new Set<string>()
  let declaredTotal = 0
  for (const entry of entries) {
    // JSZip resolves `../` to a safe basename on load. The original name is
    // still available; a template with such a name is rejected rather than
    // silently rewritten.
    const original = (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName
    if (typeof original === 'string' && original !== entry.name) {
      throw new CardTemplateError('path-traversal', original)
    }
    const path = normalizeTemplatePath(entry.name, 'zip entry')
    if (seen.has(path)) throw new CardTemplateError('bad-manifest', `重复文件: ${path}`)
    seen.add(path)
    if (!isAllowedTemplatePath(path)) throw new CardTemplateError('bad-extension', path)
    // JSZip exposes the central-directory size before inflating. Checking it
    // first is what keeps a small compressed bomb from being expanded at all.
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof declared === 'number' && declared > CARD_TEMPLATE_LIMITS.unpackedBytes) {
      throw new CardTemplateError('archive-too-large-unpacked', path)
    }
    declaredTotal += declared ?? 0
    if (declaredTotal > CARD_TEMPLATE_LIMITS.unpackedBytes) {
      throw new CardTemplateError('archive-too-large-unpacked', String(declaredTotal))
    }
  }
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) throw new CardTemplateError('bad-manifest', '缺少 manifest.json')
  // The declared size is only a cheap early answer; the actual bytes are
  // enforced below while they stream out.
  const manifestBytes = await readArchiveEntry(manifestEntry, CARD_TEMPLATE_LIMITS.manifestBytes)
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(text(manifestBytes, 'manifest.json'))
  } catch (error) {
    if (error instanceof CardTemplateError) throw error
    throw new CardTemplateError('bad-manifest', 'manifest.json 不是有效 JSON')
  }

  const files = new Map<string, CardTemplateArchiveFile>()
  let actualTotal = 0
  for (const entry of entries) {
    // JSZip resolves `../` to a safe basename on load. The original name is
    // still available; a template with such a name is rejected rather than
    // silently rewritten.
    const original = (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName
    if (typeof original === 'string' && original !== entry.name) {
      throw new CardTemplateError('path-traversal', original)
    }
    const path = normalizeTemplatePath(entry.name, 'zip entry')
    if (path === 'manifest.json') continue
    const ext = extensionOf(path)
    const limit = ext === '.woff2' || ext === '.woff' ? CARD_TEMPLATE_LIMITS.fontBytes
      : ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext) ? CARD_TEMPLATE_LIMITS.imageBytes
        : ext === '.html' ? CARD_TEMPLATE_LIMITS.pageBytes
          : ext === '.css' ? CARD_TEMPLATE_LIMITS.cssBytes
            : CARD_TEMPLATE_LIMITS.manifestBytes
    // The remaining archive budget is enforced together with the per-file
    // ceiling, so the sum of all entries can never exceed the total even when
    // every central-directory size is a lie.
    const remaining = CARD_TEMPLATE_LIMITS.unpackedBytes - actualTotal
    const bytes = await readArchiveEntry(entry, Math.min(limit, remaining))
    actualTotal += bytes.byteLength
    files.set(path, { path, bytes })
  }
  const manifest = parseCardTemplateManifest(manifestJson, new Set([...files.keys(), 'manifest.json']))
  return { manifest, files }
}

const ALLOWED_TAGS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
  'header', 'footer', 'main', 'aside', 'ul', 'ol', 'li', 'figure', 'figcaption',
  'blockquote', 'pre', 'code', 'small', 'strong', 'em', 'b', 'i', 'u', 's',
  'hr', 'br', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'img',
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'clippath',
]

const ALLOWED_ATTR = [
  'class', 'id', 'role', 'title', 'lang', 'dir', 'alt', 'width', 'height',
  'viewbox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'd', 'cx', 'cy', 'r',
  'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
  'preserveaspectratio', 'text-anchor', 'dominant-baseline', 'font-family',
  'font-size', 'font-weight', 'aria-hidden', 'aria-label',
  // URL attribute, but scanHtml checks it against the package before this
  // list is consulted; DOMPurify needs it listed or every <img> loses it.
  'src',
]

const URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'data', 'action', 'formaction'])
/** SVG paint values may reference a gradient, but never a remote resource. */
const SVG_PAINT_ATTRS = new Set(['fill', 'stroke', 'clip-path'])
const IMAGE_DATA_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.svg']

function mimeFor(path: string): string {
  switch (extensionOf(path)) {
    case '.png': return 'image/png'
    case '.jpg': return 'image/jpeg'
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    case '.woff2': return 'font/woff2'
    case '.woff': return 'font/woff'
    default: return 'application/octet-stream'
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function relativeTo(basePath: string, reference: string): string {
  const base = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : ''
  return normalizeTemplatePath(base + reference, 'asset reference')
}

interface AssetContext {
  files: Map<string, CardTemplateArchiveFile>
  /** Injected so tests can validate without building megabytes of data URLs. */
  resolve?: (path: string) => string | null
}

function resolveAsset(context: AssetContext, path: string): string | null {
  if (!context.files.has(path) || !IMAGE_EXT.includes(extensionOf(path))) return null
  if (context.resolve) return context.resolve(path)
  const file = context.files.get(path)!
  return bytesToDataUrl(file.bytes, mimeFor(path))
}

function checkUrl(raw: string, basePath: string, context: AssetContext, what: string): string {
  const value = raw.trim()
  if (!value) throw new CardTemplateError('unsafe-url', `${what} 为空`)
  if (value.startsWith('#')) return value
  if (/^data:/i.test(value)) {
    if (IMAGE_DATA_RE.test(value)) return value
    throw new CardTemplateError('unsafe-url', `${what} 只允许 png/jpeg/webp/gif data URL`)
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new CardTemplateError('unsafe-url', `${what}: ${value.slice(0, 80)}`)
  }
  const path = relativeTo(basePath, value)
  if (!context.files.has(path) || !IMAGE_EXT.includes(extensionOf(path))) {
    throw new CardTemplateError('unsafe-url', `${what}: ${path}`)
  }
  return path
}

function scanHtml(root: ParentNode, basePath: string, context: AssetContext): void {
  const walk = (node: Node): void => {
    if (node.nodeType === Node.COMMENT_NODE) {
      throw new CardTemplateError('unsafe-html', 'HTML 注释')
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (!ALLOWED_TAGS.includes(tag)) throw new CardTemplateError('unsafe-html', `<${tag}>`)
    // Dangerous names are checked before URLs so `<img src=x onerror=…>`
    // reports the handler, not merely the unresolved source.
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) throw new CardTemplateError('unsafe-html', `${tag}[${name}]`)
      if (name === 'style') throw new CardTemplateError('unsafe-html', 'style 属性')
      if (name === 'srcset') throw new CardTemplateError('unsafe-html', 'srcset')
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      if (URL_ATTRS.has(name)) {
        checkUrl(attr.value, basePath, context, `${tag}[${name}]`)
        continue
      }
      if (name === 'xmlns') {
        if (attr.value !== 'http://www.w3.org/2000/svg') {
          throw new CardTemplateError('unsafe-url', `xmlns=${attr.value}`)
        }
        continue
      }
      if (SVG_PAINT_ATTRS.has(name) && /url\s*\(/i.test(attr.value)) {
        // `url(#local-gradient)` is metadata inside the fragment; anything else
        // would make the SVG paint server fetch a resource outside the package.
        if (!/^url\(\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*\)$/.test(attr.value.trim())) {
          throw new CardTemplateError('unsafe-url', `${tag}[${name}] paint server`)
        }
        continue
      }
      if (name.startsWith('data-') || name.startsWith('aria-')) {
        if (attr.value.length > 400) throw new CardTemplateError('unsafe-html', `${name} 太长`)
        continue
      }
      if (!ALLOWED_ATTR.includes(name)) {
        throw new CardTemplateError('unsafe-html', `${tag}[${name}]`)
      }
    }
    for (const child of Array.from(element.childNodes)) walk(child)
  }
  for (const child of Array.from(root.childNodes)) walk(child)
}

function rewriteHtmlAssets(root: ParentNode, basePath: string, context: AssetContext): string {
  for (const element of Array.from(root.querySelectorAll('img[src]'))) {
    const src = element.getAttribute('src') ?? ''
    if (/^data:/i.test(src)) continue
    const path = relativeTo(basePath, src)
    const resolved = resolveAsset(context, path)
    if (!resolved) throw new CardTemplateError('unsafe-url', src)
    element.setAttribute('src', resolved)
  }
  const holder = document.createElement('div')
  holder.append(...Array.from(root.childNodes).map((node) => node.cloneNode(true)))
  return holder.innerHTML
}

/**
 * Whitelist one page fragment. The explicit scan names the exact offending
 * construct; DOMPurify then runs as the last line of defence and its result is
 * scanned again before serialization.
 */
export function sanitizeTemplateHtml(
  html: string,
  pagePath: string,
  context: AssetContext,
): string {
  if (html.length > CARD_TEMPLATE_LIMITS.pageBytes) throw new CardTemplateError('bad-manifest', `${pagePath} 过大`)
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  if (parsed.head.children.length || parsed.head.textContent?.trim()) {
    throw new CardTemplateError('unsafe-html', 'head 内容')
  }
  scanHtml(parsed.body, pagePath, context)
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_ARIA_ATTR: true,
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'foreignObject', 'style', 'link', 'meta', 'base', 'template'],
    FORBID_ATTR: ['style'],
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment
  scanHtml(clean, pagePath, context)
  return rewriteHtmlAssets(clean, pagePath, context)
}

/** Serialize package assets to data URLs once per activation. */
export function archiveAssetUrls(files: Map<string, CardTemplateArchiveFile>): Map<string, string> {
  const urls = new Map<string, string>()
  for (const [path, file] of files) {
    if (IMAGE_EXT.includes(extensionOf(path)) || extensionOf(path) === '.woff2' || extensionOf(path) === '.woff') {
      urls.set(path, bytesToDataUrl(file.bytes, mimeFor(path)))
    }
  }
  return urls
}

const BANNED_CSS = [
  /@import\b/i, /expression\s*\(/i, /(?:^|[;{\s])behavior\s*:/i, /-moz-binding/i,
  /javascript\s*:/i, /vbscript\s*:/i, /@font-face\b/i, /@namespace\b/i, /@page\b/i,
  /@property\b/i, /@counter-style\b/i, /@keyframes\b/i, /@-webkit-keyframes\b/i,
  /@layer\b/i, /@scope\b/i,
]

/**
 * CSS functions that resolve one or more strings as a URL for the image engine.
 * `url()` is the only fetch-capable form a template may keep; every other
 * address-taking function is rejected outright, including relative strings:
 * `image-set("a.png" 1x)` still makes the browser request this site even though
 * there is no `url()` and no scheme.
 */
const REQUEST_CSS_FUNCTIONS = [
  'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade',
  'element', '-moz-element', 'paint', 'src', 'image', '-webkit-canvas',
  '-webkit-named-image',
] as const
const REQUEST_FUNCTION_RE = new RegExp(
  `(?:^|[^\\w-])(${REQUEST_CSS_FUNCTIONS.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`,
  'i',
)
const SAFE_POSITIONS = new Set(['static', 'relative', 'absolute', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])

function bannedCssFunction(value: string): string | null {
  const match = REQUEST_FUNCTION_RE.exec(value)
  return match ? match[1] : null
}
const BAD_SELECTOR = /(^|[\s>+~,(])(?:body|html)(?=$|[\s>+~,.#:[)])|:root(?![\w-])|:host(?![\w-])|::slotted/i
const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

export interface CssSanitizeOptions {
  template: string
  cssPath: string
  files: Map<string, CardTemplateArchiveFile>
  assetUrls?: Map<string, string>
  /** Which root the rules are scoped to; cards when omitted. */
  kind?: TemplateKind
}

function scopeRoot(template: string, kind: TemplateKind = 'card'): string {
  if (!/^[\w.:-]{1,120}$/.test(template)) throw new CardTemplateError('bad-manifest', '模板内部 id 不合法')
  // Scope by the upload's unique runtime id, not by manifest.renderId. A
  // converted design keeps its original [data-template="console"] selectors,
  // but two packages (or a package and the built-in template) sharing that key
  // must not be able to restyle each other.
  if (kind === 'long') {
    return `.reed-long-root[data-card-template-source="${template}"], .reed-long-flow[data-card-template-source="${template}"]`
  }
  return `.xhs-card[data-card-template-source="${template}"], .xhs-body[data-card-template-source="${template}"]`
}

function rewriteCssValue(
  value: string,
  cssPath: string,
  files: Map<string, CardTemplateArchiveFile>,
  assetUrls?: Map<string, string>,
): string {
  return value.replace(URL_RE, (_match, _quote: string, raw: string) => {
    const target = raw.trim()
    if (!target) throw new CardTemplateError('unsafe-css', '空 url()')
    if (target.startsWith('#')) return `url("${target}")`
    if (/^data:/i.test(target)) {
      if (IMAGE_DATA_RE.test(target)) return `url("${target}")`
      throw new CardTemplateError('unsafe-url', 'CSS data URL')
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
      throw new CardTemplateError('unsafe-url', `CSS url(${target.slice(0, 80)})`)
    }
    const path = relativeTo(cssPath, target)
    if (!files.has(path)) throw new CardTemplateError('unsafe-url', `CSS 资源不存在: ${path}`)
    const ext = extensionOf(path)
    if (!IMAGE_EXT.includes(ext) && ext !== '.woff2' && ext !== '.woff') {
      throw new CardTemplateError('unsafe-url', `CSS 资源类型不允许: ${path}`)
    }
    const url = assetUrls?.get(path)
    if (!url) throw new CardTemplateError('unsafe-url', `CSS 资源未加载: ${path}`)
    return `url("${url}")`
  })
}

function sanitizeStyle(
  style: CSSStyleDeclaration,
  cssPath: string,
  files: Map<string, CardTemplateArchiveFile>,
  assetUrls?: Map<string, string>,
): void {
  for (let index = 0; index < style.length; index++) {
    const property = style.item(index)
    const value = style.getPropertyValue(property)
    if (BANNED_CSS.some((pattern) => pattern.test(value))) {
      throw new CardTemplateError('unsafe-css', `${property}: ${value.slice(0, 80)}`)
    }
    const requestFunction = bannedCssFunction(value)
    if (requestFunction) {
      throw new CardTemplateError('unsafe-css', `${property}: ${requestFunction}()`)
    }
    // Fixed/sticky leaves the scoped card and can cover the editor even when a
    // selector is technically inside the scope. The virtual scope root itself
    // is checked the same way — the base `.xhs-card` rule is not template CSS.
    if (property === 'position' && !SAFE_POSITIONS.has(value.trim().toLowerCase())) {
      throw new CardTemplateError('unsafe-css', `${property}: ${value}`)
    }
    const rewritten = rewriteCssValue(value, cssPath, files, assetUrls)
    if (rewritten !== value) style.setProperty(property, rewritten, style.getPropertyPriority(property))
  }
}

function splitSelectors(text: string): string[] {
  const selectors: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      selectors.push(text.slice(start, index))
      start = index + 1
    }
  }
  selectors.push(text.slice(start))
  return selectors.map((selector) => selector.trim()).filter(Boolean)
}

/**
 * The scope root itself is only matched by `:scope`, so a selector that starts
 * with the card/body class gets a second, explicit root form. The original form
 * still matches the body as a descendant of the card.
 */
function rootScopedSelectors(selectorText: string, kind: TemplateKind): string {
  const roots = splitSelectors(selectorText)
    .map((selector) => (kind === 'long'
      ? selector.replace(/^\.reed-long-(root|flow)\b/, ':scope.reed-long-$1')
      : selector.replace(/^\.xhs-(card|body)\b/, ':scope.xhs-$1')))
    .filter((selector, index) => selector !== splitSelectors(selectorText)[index])
  return roots.join(', ')
}

function collectRules(
  rules: CSSRuleList,
  cssPath: string,
  files: Map<string, CardTemplateArchiveFile>,
  assetUrls: Map<string, string> | undefined,
  out: string[],
  kind: TemplateKind,
): void {
  for (const rule of Array.from(rules)) {
    const candidate = rule as CSSRule & { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList; media?: MediaList; conditionText?: string }
    if (typeof candidate.selectorText === 'string' && candidate.style) {
      const selector = candidate.selectorText.trim()
      if (!selector || BAD_SELECTOR.test(selector)) throw new CardTemplateError('unsafe-css', `选择器: ${selector}`)
      sanitizeStyle(candidate.style, cssPath, files, assetUrls)
      out.push(`${selector} { ${candidate.style.cssText} }`)
      const roots = rootScopedSelectors(selector, kind)
      if (roots) out.push(`${roots} { ${candidate.style.cssText} }`)
      continue
    }
    if (candidate.cssRules) {
      const name = rule.constructor.name
      if (name === 'CSSMediaRule' && candidate.media) {
        out.push(`@media ${candidate.media.mediaText} {`)
        collectRules(candidate.cssRules, cssPath, files, assetUrls, out, kind)
        out.push('}')
        continue
      }
      if (name === 'CSSSupportsRule' && typeof candidate.conditionText === 'string') {
        out.push(`@supports ${candidate.conditionText} {`)
        collectRules(candidate.cssRules, cssPath, files, assetUrls, out, kind)
        out.push('}')
        continue
      }
      if (name === 'CSSContainerRule' && typeof candidate.conditionText === 'string') {
        out.push(`@container ${candidate.conditionText} {`)
        collectRules(candidate.cssRules, cssPath, files, assetUrls, out, kind)
        out.push('}')
        continue
      }
      throw new CardTemplateError('unsafe-css', `不允许的 @ 规则: ${name}`)
    }
    throw new CardTemplateError('unsafe-css', `不允许的 CSS 规则: ${rule.constructor.name}`)
  }
}

/**
 * Parse with the browser CSSOM, check every rule and emit it inside two scope
 * roots (the preview card and the hidden measurement body). `assetUrls` is the
 * final substitution map; omit it during upload validation.
 */
export function sanitizeTemplateCss(css: string, options: CssSanitizeOptions): string {
  if (css.length > CARD_TEMPLATE_LIMITS.cssBytes) throw new CardTemplateError('bad-manifest', `${options.cssPath} 过大`)
  for (const pattern of BANNED_CSS) {
    if (pattern.test(css)) throw new CardTemplateError('unsafe-css', `${options.cssPath}: ${pattern}`)
  }
  // CSSOM can drop an unsupported function before it reaches a declaration
  // value, so inspect the raw text too. The same applies inside @supports,
  // @font-face or any other at-rule: every occurrence is checked.
  const requestFunction = bannedCssFunction(css)
  if (requestFunction) {
    throw new CardTemplateError('unsafe-css', `${options.cssPath}: ${requestFunction}()`)
  }
  if (/(?:^|[;{\s])position\s*:\s*(?:fixed|sticky|-webkit-sticky)\b/i.test(css)) {
    throw new CardTemplateError('unsafe-css', `${options.cssPath}: position fixed/sticky`)
  }
  let sheet: CSSStyleSheet
  try {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
  } catch (error) {
    throw new CardTemplateError('unsafe-css', `${options.cssPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const out: string[] = []
  collectRules(sheet.cssRules, options.cssPath, options.files, options.assetUrls, out, options.kind ?? 'card')
  const scoped = `@scope (${scopeRoot(options.template, options.kind ?? 'card')}) {\n${out.join('\n')}\n}`
  try {
    const verify = new CSSStyleSheet()
    verify.replaceSync(scoped)
  } catch (error) {
    throw new CardTemplateError('unsafe-css', `scope 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  return scoped
}

/** Build the `@font-face` CSS embedded into exported PNGs (data URLs only). */
export function packageFontCss(
  manifest: ReedTemplateManifest,
  files: Map<string, CardTemplateArchiveFile>,
): string {
  return manifest.fonts.filter((font) => font.source === 'package').map((font) => {
    const file = files.get(font.file)
    if (!file) throw new CardTemplateError('missing-file', font.file)
    const data = bytesToDataUrl(file.bytes, mimeFor(font.file))
    return `@font-face { font-family: "${font.family}"; font-style: ${font.style}; font-weight: ${font.weight}; src: url("${data}") format("${extensionOf(font.file) === '.woff' ? 'woff' : 'woff2'}");${font.unicodeRange ? ` unicode-range: ${font.unicodeRange};` : ''} }`
  }).join('\n')
}

/** Load package webfaces from ArrayBuffers, never from a network request. */
export async function loadPackageFonts(
  manifest: ReedTemplateManifest,
  files: Map<string, CardTemplateArchiveFile>,
): Promise<FontFace[]> {
  if (typeof FontFace === 'undefined' || !document.fonts) return []
  const loaded: FontFace[] = []
  for (const font of manifest.fonts) {
    if (font.source !== 'package') continue
    const file = files.get(font.file)
    if (!file) throw new CardTemplateError('missing-file', font.file)
    const face = new FontFace(font.family, store(file.bytes), {
      weight: String(font.weight),
      style: font.style,
      ...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}),
    })
    await face.load()
    document.fonts.add(face)
    loaded.push(face)
  }
  return loaded
}