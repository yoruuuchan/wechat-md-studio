/**
 * The published `*.reedcard` manifest format.
 *
 * A template file is a zip with one manifest at `manifest.json`, page
 * fragments, CSS and optional assets. Nothing in it is executable: the engine
 * fills `data-*` slots, the manifest only describes measurements, variants,
 * fonts and files. Uploaded archives are untrusted; every field and path below
 * is checked before a single byte reaches the DOM.
 */
import {
  BUILTIN_CARD_FONT_FACES, CARD_RATIOS, CARD_TEMPLATES, CARD_WIDTH,
  type CardFontFace, type CardMeasurements, type CardRatio,
} from './cards'

export const CARD_TEMPLATE_FORMAT = 'reed-card-template'
export const CARD_TEMPLATE_FORMAT_VERSION = 1
export const CARD_TEMPLATE_EXTENSION = '.reedcard'
export const CARD_TEMPLATE_MIME = 'application/zip'

export const CARD_TEMPLATE_LIMITS = {
  /** Compressed archive size. */
  archiveBytes: 8 * 1024 * 1024,
  /** Every entry added together, before decompression. */
  unpackedBytes: 32 * 1024 * 1024,
  files: 128,
  manifestBytes: 64 * 1024,
  pageBytes: 512 * 1024,
  cssBytes: 512 * 1024,
  /** One font file. */
  fontBytes: 4 * 1024 * 1024,
  /** One png / webp / svg decoration. */
  imageBytes: 2 * 1024 * 1024,
  variants: 16,
  styles: 8,
  fonts: 24,
  title: 120,
} as const

export const CARD_TEMPLATE_ALLOWED_EXTENSIONS = [
  '.json', '.html', '.css', '.woff2', '.woff', '.png', '.jpg', '.jpeg', '.webp', '.svg',
] as const

export type CardTemplateVariantToken = 'accent' | 'text' | 'muted'

export interface CardTemplateVariant {
  id: string
  name: string
  dark: boolean
  tokens: Partial<Record<CardTemplateVariantToken, string>>
}

export interface CardTemplateBuiltinFont extends CardFontFace {
  source: 'builtin'
}

export interface CardTemplatePackageFont {
  source: 'package'
  family: string
  file: string
  weight: number
  style: 'normal' | 'italic'
  unicodeRange?: string
}

export type CardTemplateFont = CardTemplateBuiltinFont | CardTemplatePackageFont

export interface CardTemplatePages {
  cover: string
  body: string
  /** Optional closing page; omitted means the body page is reused. */
  end?: string
}

export interface CardTemplateManifest {
  format: typeof CARD_TEMPLATE_FORMAT
  formatVersion: typeof CARD_TEMPLATE_FORMAT_VERSION
  id: string
  /**
   * The value written to `data-template` for CSS matching. Defaults to `id`.
   * A converted design can keep its original CSS key so the package stays
   * self-contained after that built-in template is removed.
   */
  renderId: string
  name: string
  version: string
  author: string
  description: string
  ratios: CardRatio[]
  defaultRatio: CardRatio
  variants: CardTemplateVariant[]
  metrics: CardMeasurements
  fonts: CardTemplateFont[]
  pages: CardTemplatePages
  styles: string[]
}

export type CardTemplateErrorCode =
  | 'archive-too-large'
  | 'archive-too-large-unpacked'
  | 'too-many-files'
  | 'path-traversal'
  | 'bad-extension'
  | 'bad-zip'
  | 'bad-manifest'
  | 'missing-file'
  | 'font-not-builtin'
  | 'unsafe-html'
  | 'unsafe-css'
  | 'unsafe-url'
  | 'cloud'
  | 'storage'
  | 'unknown'

export class CardTemplateError extends Error {
  readonly code: CardTemplateErrorCode
  readonly detail?: string

  constructor(code: CardTemplateErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'CardTemplateError'
    this.code = code
    this.detail = detail
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const VARIANT_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const VERSION_RE = /^[0-9]+(?:\.[0-9A-Za-z-]+){0,3}$/
const FONT_FAMILY_RE = /^[^"\\<>;{}]{1,80}$/
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|lab|lch|color)\([0-9a-zA-Z%.,\s/+-]{1,120}\))$/

function bad(detail: string): never {
  throw new CardTemplateError('bad-manifest', detail)
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(`${where} 必须是对象`)
  return value as Record<string, unknown>
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) bad(`${where}.${key} 不是允许的字段`)
}

function text(value: unknown, where: string, max: number, required = true): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') bad(`${where} 必须是字符串`)
  const trimmed = value.trim()
  if (required && !trimmed) bad(`${where} 不能为空`)
  if (trimmed.length > max) bad(`${where} 超过 ${max} 个字符`)
  if (Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0)
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)
  })) bad(`${where} 含控制字符`)
  return trimmed
}

function number(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) bad(`${where} 必须是数字`)
  if (value < min || value > max) bad(`${where} 超出 ${min}–${max}`)
  return value
}

function integer(value: unknown, where: string, min: number, max: number): number {
  const n = number(value, where, min, max)
  if (!Number.isInteger(n)) bad(`${where} 必须是整数`)
  return n
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') bad(`${where} 必须是布尔值`)
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) bad(`${where} 必须是 ${allowed.join(' / ')}`)
  return value as T
}

export function isSafeColor(value: string): boolean {
  return SAFE_COLOR_RE.test(value)
}

/** Reject absolute paths, drive letters, backslashes and any `..` segment. */
export function normalizeTemplatePath(raw: string, where = 'path'): string {
  if (!raw || raw.includes('\u0000')) bad(`${where} 为空或含空字符`)
  if (raw.includes('\\')) throw new CardTemplateError('path-traversal', `${where} 含反斜杠`)
  if (raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:/.test(raw)) {
    throw new CardTemplateError('path-traversal', `${where} 是绝对路径`)
  }
  const parts = raw.split('/')
  const kept: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') throw new CardTemplateError('path-traversal', `${where} 含 ..`)
    kept.push(part)
  }
  if (!kept.length) bad(`${where} 没有文件名`)
  return kept.join('/')
}

export function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}

export function isAllowedTemplatePath(path: string): boolean {
  return (CARD_TEMPLATE_ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(path))
}

function checkFile(path: string, files: ReadonlySet<string>, where: string, extensions?: readonly string[]): string {
  if (!files.has(path)) throw new CardTemplateError('missing-file', `${where}: ${path}`)
  const ext = extensionOf(path)
  if (extensions && !extensions.includes(ext)) bad(`${where} 必须是 ${extensions.join(' / ')}`)
  if (!isAllowedTemplatePath(path)) throw new CardTemplateError('bad-extension', `${where}: ${path}`)
  return path
}

function parseMetrics(value: unknown): CardMeasurements {
  const m = record(value, 'metrics')
  onlyKeys(m, [
    'padX', 'padTop', 'padBottom', 'contentWidth', 'headerTop', 'footerBottom',
    'coverInsetX', 'coverInsetY', 'coverFootBottom', 'coverReserve',
    'coverTitleSize', 'coverSmallScale',
  ], 'metrics')
  const sizes = m.coverTitleSize
  if (!Array.isArray(sizes) || sizes.length !== 5) bad('metrics.coverTitleSize 必须正好 5 个字号')
  const coverTitleSize = sizes.map((size, index) => number(size, `metrics.coverTitleSize[${index}]`, 8, 200)) as unknown as CardMeasurements['coverTitleSize']
  const metrics: CardMeasurements = {
    padX: number(m.padX, 'metrics.padX', 0, 140),
    padTop: number(m.padTop, 'metrics.padTop', 0, 260),
    padBottom: number(m.padBottom, 'metrics.padBottom', 0, 260),
    contentWidth: number(m.contentWidth, 'metrics.contentWidth', 200, CARD_WIDTH),
    headerTop: number(m.headerTop, 'metrics.headerTop', 0, 260),
    footerBottom: number(m.footerBottom, 'metrics.footerBottom', 0, 260),
    coverInsetX: number(m.coverInsetX, 'metrics.coverInsetX', 0, 160),
    coverInsetY: number(m.coverInsetY, 'metrics.coverInsetY', 0, 300),
    coverFootBottom: number(m.coverFootBottom, 'metrics.coverFootBottom', 0, 160),
    coverReserve: number(m.coverReserve, 'metrics.coverReserve', 60, 600),
    coverTitleSize,
    coverSmallScale: number(m.coverSmallScale, 'metrics.coverSmallScale', 0.5, 1),
  }
  if (metrics.padTop + metrics.padBottom >= 620) bad('metrics.padTop + padBottom 太大，正文没有空间')
  if (metrics.contentWidth + metrics.padX * 2 > CARD_WIDTH) bad('metrics.contentWidth + 2 × padX 超出 540px 画布')
  return metrics
}

function parseVariants(value: unknown): CardTemplateVariant[] {
  if (!Array.isArray(value) || value.length < 1) bad('variants 至少要有 1 个')
  if (value.length > CARD_TEMPLATE_LIMITS.variants) bad(`variants 最多 ${CARD_TEMPLATE_LIMITS.variants} 个`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const v = record(entry, `variants[${index}]`)
    onlyKeys(v, ['id', 'name', 'dark', 'tokens'], `variants[${index}]`)
    const id = text(v.id, `variants[${index}].id`, 32)
    if (!VARIANT_ID_RE.test(id)) bad(`variants[${index}].id 只能用小写字母、数字和连字符`)
    if (seen.has(id)) bad(`variants 重复: ${id}`)
    seen.add(id)
    const tokensIn = v.tokens === undefined ? {} : record(v.tokens, `variants[${index}].tokens`)
    onlyKeys(tokensIn, ['accent', 'text', 'muted'], `variants[${index}].tokens`)
    const tokens: CardTemplateVariant['tokens'] = {}
    for (const key of ['accent', 'text', 'muted'] as const) {
      if (tokensIn[key] === undefined) continue
      const color = text(tokensIn[key], `variants[${index}].tokens.${key}`, 140)
      if (!isSafeColor(color)) bad(`variants[${index}].tokens.${key} 必须是十六进制或 rgb()/hsl() 颜色`)
      tokens[key] = color
    }
    return {
      id,
      name: text(v.name, `variants[${index}].name`, 60),
      dark: v.dark === undefined ? false : bool(v.dark, `variants[${index}].dark`),
      tokens,
    }
  })
}

function parseFonts(value: unknown, files: ReadonlySet<string>): CardTemplateFont[] {
  if (!Array.isArray(value)) bad('fonts 必须是数组')
  if (value.length > CARD_TEMPLATE_LIMITS.fonts) bad(`fonts 最多 ${CARD_TEMPLATE_LIMITS.fonts} 个`)
  const packageFaces = new Set<string>()
  return value.map((entry, index) => {
    const f = record(entry, `fonts[${index}]`)
    const source = oneOf(f.source, ['builtin', 'package'] as const, `fonts[${index}].source`)
    if (source === 'builtin') {
      onlyKeys(f, ['source', 'family', 'weights', 'styles'], `fonts[${index}]`)
      const family = text(f.family, `fonts[${index}].family`, 80)
      const builtin = BUILTIN_CARD_FONT_FACES.get(family)
      if (!builtin) throw new CardTemplateError('font-not-builtin', `fonts[${index}]: ${family}`)
      if (!Array.isArray(f.weights) || !f.weights.length) bad(`fonts[${index}].weights 必须是非空数组`)
      const weights = f.weights.map((weight, weightIndex) => integer(weight, `fonts[${index}].weights[${weightIndex}]`, 100, 1000))
      const styles = f.styles === undefined
        ? ['normal' as const]
        : (Array.isArray(f.styles) ? f.styles : bad(`fonts[${index}].styles 必须是数组`))
          .map((style, styleIndex) => oneOf(style, ['normal', 'italic'] as const, `fonts[${index}].styles[${styleIndex}]`))
      for (const weight of weights) if (!builtin.weights.includes(weight)) {
        throw new CardTemplateError('font-not-builtin', `fonts[${index}]: ${family} ${weight}`)
      }
      for (const style of styles) if (!(builtin.styles ?? ['normal']).includes(style)) {
        throw new CardTemplateError('font-not-builtin', `fonts[${index}]: ${family} ${style}`)
      }
      return { source, family, weights, styles }
    }
    onlyKeys(f, ['source', 'family', 'file', 'weight', 'style', 'unicodeRange'], `fonts[${index}]`)
    const family = text(f.family, `fonts[${index}].family`, 80)
    if (!FONT_FAMILY_RE.test(family) || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(family)) {
      bad(`fonts[${index}].family 不是可用的字体名`)
    }
    if (BUILTIN_CARD_FONT_FACES.has(family)) bad(`fonts[${index}].family 不能覆盖内置字体 ${family}`)
    const weight = integer(f.weight, `fonts[${index}].weight`, 100, 1000)
    const style = f.style === undefined ? 'normal' : oneOf(f.style, ['normal', 'italic'] as const, `fonts[${index}].style`)
    // A family may contribute several weights or styles, but one exact face
    // must not be declared twice: duplicate @font-face rules make the winner
    // depend on document order instead of the manifest.
    const faceKey = `${family}\u0000${weight}\u0000${style}`
    if (packageFaces.has(faceKey)) bad(`fonts[${index}] 重复: ${family} ${weight} ${style}`)
    packageFaces.add(faceKey)
    const file = checkFile(normalizeTemplatePath(text(f.file, `fonts[${index}].file`, 240), `fonts[${index}].file`),
      files, `fonts[${index}].file`, ['.woff2', '.woff'])
    const unicodeRange = f.unicodeRange === undefined
      ? undefined
      : text(f.unicodeRange, `fonts[${index}].unicodeRange`, 400)
    if (unicodeRange && !/^[Uu]\+[0-9A-Fa-f?*, -]+$/.test(unicodeRange)) bad(`fonts[${index}].unicodeRange 格式不正确`)
    return {
      source,
      family,
      file,
      weight,
      style,
      ...(unicodeRange ? { unicodeRange } : {}),
    }
  })
}

export function parseCardTemplateManifest(
  value: unknown,
  files: ReadonlySet<string>,
): CardTemplateManifest {
  const m = record(value, 'manifest')
  onlyKeys(m, [
    'format', 'formatVersion', 'id', 'renderId', 'name', 'version', 'author', 'description',
    'ratios', 'defaultRatio', 'variants', 'metrics', 'fonts', 'pages', 'styles',
  ], 'manifest')
  if (m.format !== CARD_TEMPLATE_FORMAT) bad(`format 必须是 ${CARD_TEMPLATE_FORMAT}`)
  if (m.formatVersion !== CARD_TEMPLATE_FORMAT_VERSION) bad(`formatVersion 必须是 ${CARD_TEMPLATE_FORMAT_VERSION}`)
  const id = text(m.id, 'id', 64)
  if (!ID_RE.test(id)) bad('id 只能用小写字母、数字和连字符')
  const renderId = m.renderId === undefined ? id : text(m.renderId, 'renderId', 64)
  if (!ID_RE.test(renderId)) bad('renderId 只能用小写字母、数字和连字符')
  // A package must not borrow the built-in template's CSS key: that would mix
  // uploaded content into the built-in design and make the built-in rule set
  // depend on a file the user can replace.
  if ((CARD_TEMPLATES as readonly string[]).includes(renderId)) {
    bad(`renderId 不能使用内置模板名 ${renderId}`)
  }
  const version = text(m.version, 'version', 40)
  if (!VERSION_RE.test(version)) bad('version 必须是 1.0.0 这样的版本号')
  if (!Array.isArray(m.ratios) || !m.ratios.length) bad('ratios 至少要有一种比例')
  const ratios = [...new Set(m.ratios.map((ratio, index) =>
    oneOf(ratio, Object.keys(CARD_RATIOS) as CardRatio[], `ratios[${index}]`)))]
  if (new Set(m.ratios).size !== m.ratios.length) bad('ratios 不能重复')
  const defaultRatio = oneOf(m.defaultRatio, ratios, 'defaultRatio')
  if (defaultRatio !== ratios[0]) bad('defaultRatio 必须是 ratios 的第一个')
  const pagesIn = record(m.pages, 'pages')
  onlyKeys(pagesIn, ['cover', 'body', 'end'], 'pages')
  const pages: CardTemplatePages = {
    cover: checkFile(normalizeTemplatePath(text(pagesIn.cover, 'pages.cover', 240), 'pages.cover'),
      files, 'pages.cover', ['.html']),
    body: checkFile(normalizeTemplatePath(text(pagesIn.body, 'pages.body', 240), 'pages.body'),
      files, 'pages.body', ['.html']),
    ...(pagesIn.end === undefined ? {} : {
      end: checkFile(normalizeTemplatePath(text(pagesIn.end, 'pages.end', 240), 'pages.end'),
        files, 'pages.end', ['.html']),
    }),
  }
  if (!Array.isArray(m.styles) || !m.styles.length) bad('styles 至少要有 1 个 CSS 文件')
  if (m.styles.length > CARD_TEMPLATE_LIMITS.styles) bad(`styles 最多 ${CARD_TEMPLATE_LIMITS.styles} 个`)
  const styles = [...new Set(m.styles.map((style, index) =>
    checkFile(normalizeTemplatePath(text(style, `styles[${index}]`, 240), `styles[${index}]`),
      files, `styles[${index}]`, ['.css'])))]
  if (styles.length !== m.styles.length) bad('styles 不能重复')

  return {
    format: CARD_TEMPLATE_FORMAT,
    formatVersion: CARD_TEMPLATE_FORMAT_VERSION,
    id,
    renderId,
    name: text(m.name, 'name', 80),
    version,
    author: text(m.author, 'author', 80),
    description: text(m.description, 'description', 500, false),
    ratios,
    defaultRatio,
    variants: parseVariants(m.variants),
    metrics: parseMetrics(m.metrics),
    fonts: parseFonts(m.fonts, files),
    pages,
    styles,
  }
}

/** Summaries shown in the picker, without keeping the archive in memory. */
export interface CardTemplateSummary {
  id: string
  name: string
  version: string
  author: string
  variants: readonly { id: string; name: string }[]
  ratios: readonly CardRatio[]
  template: string
}