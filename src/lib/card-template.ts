/**
 * Runtime for uploaded card templates.
 *
 * `parseCardTemplateSource` validates a zip and keeps the raw archive and the
 * parsed pieces in IndexedDB. `activateCardTemplate` runs the same HTML/CSS
 * filters again at render time, installs the scoped stylesheet once and
 * registers the measurements/fonts the shared pagination code consumes.
 */
import {
  chinesePageNumber, coverTitleSize, registerCardTemplateRuntime, registerLongTemplateRuntime,
  unregisterCardTemplateRuntime, unregisterLongTemplateRuntime, type CardFontFace,
  type CardTemplateRuntime, type LongTemplateRuntime,
} from './cards'
import {
  CardTemplateError, type CardTemplateManifest, type CardTemplateSummary, type LongTemplateManifest,
  type ReedTemplateManifest,
} from './card-template-format'
import {
  archiveAssetUrls, loadPackageFonts, openCardTemplateArchive, packageFontCss,
  sanitizeTemplateCss, sanitizeTemplateHtml, type CardTemplateArchiveFile,
} from './card-template-security'
import { t } from './i18n'

export interface CardTemplatePageSource {
  path: string
  html: string
}

export interface CardTemplateStyleSource {
  path: string
  css: string
}

export interface CardTemplateParsed {
  manifest: ReedTemplateManifest
  pages: {
    cover?: CardTemplatePageSource
    body?: CardTemplatePageSource
    end?: CardTemplatePageSource
    header?: CardTemplatePageSource
    footer?: CardTemplatePageSource
  }
  styles: CardTemplateStyleSource[]
  files: { path: string; bytes: ArrayBuffer }[]
}

export interface CardTemplateSourceRecord {
  id: string
  template: string
  name: string
  createdAt: number
  updatedAt: number
  /**
   * Server `uploadedAt` of the cloud version this record is known to match.
   * Absent until an upload, download or merge confirms it. Server time only:
   * tombstones are compared against this, never against the device clock.
   */
  cloudUploadedAt?: number
  raw: ArrayBuffer
  parsed: CardTemplateParsed
}

interface LoadedTemplateBase {
  template: string
  /** CSS key written to `data-template`, from manifest.renderId. */
  renderId: string
  manifest: ReedTemplateManifest
  summary: CardTemplateSummary
  files: Map<string, CardTemplateArchiveFile>
  packageFontCss: string
  style: HTMLStyleElement | null
  fonts: FontFace[]
}

export interface LoadedCardTemplate extends LoadedTemplateBase {
  kind: 'card'
  manifest: CardTemplateManifest
  pages: { cover: string; body: string; end: string }
}

export interface LoadedLongTemplate extends LoadedTemplateBase {
  kind: 'long'
  manifest: LongTemplateManifest
  pages: { header: string; footer: string }
}

export type LoadedTemplate = LoadedCardTemplate | LoadedLongTemplate

const LOADED = new Map<string, LoadedTemplate>()
const STYLE_ID_PREFIX = 'reed-card-template-style-'

export function customTemplateId(id: string): string {
  return `custom.${id}`
}

export function getLoadedCardTemplate(template: string): LoadedCardTemplate | undefined {
  const loaded = LOADED.get(template)
  return loaded?.kind === 'card' ? loaded : undefined
}

export function getLoadedLongTemplate(template: string): LoadedLongTemplate | undefined {
  const loaded = LOADED.get(template)
  return loaded?.kind === 'long' ? loaded : undefined
}

export function loadedCardTemplateSummaries(): CardTemplateSummary[] {
  return [...LOADED.values()].map((loaded) => loaded.summary)
}

function filesFromParsed(parsed: CardTemplateParsed): Map<string, CardTemplateArchiveFile> {
  return new Map(parsed.files.map((file) => [file.path, { path: file.path, bytes: new Uint8Array(file.bytes) }]))
}

function placeholderAssets(files: Map<string, CardTemplateArchiveFile>): Map<string, string> {
  const urls = new Map<string, string>()
  for (const path of files.keys()) {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    const mime = ext === '.woff2' ? 'font/woff2' : ext === '.woff' ? 'font/woff'
      : ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
    urls.set(path, `data:${mime};base64,AA==`)
  }
  return urls
}

function decode(bytes: Uint8Array, what: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CardTemplateError('bad-manifest', `${what} 不是 UTF-8 文本`)
  }
}

function checkFontMagic(files: Map<string, CardTemplateArchiveFile>, manifest: ReedTemplateManifest): void {
  for (const font of manifest.fonts) {
    if (font.source !== 'package') continue
    const file = files.get(font.file)
    const magic = file && Array.from(file.bytes.subarray(0, 4)).map((byte) => String.fromCharCode(byte)).join('')
    if (magic !== 'wOF2' && magic !== 'wOFF') throw new CardTemplateError('bad-manifest', `${font.file} 不是 woff/woff2`)
  }
}

/** Validate an uploaded archive and keep everything IndexedDB needs. */
export async function parseCardTemplateSource(raw: ArrayBuffer, id: string): Promise<CardTemplateSourceRecord> {
  const archive = await openCardTemplateArchive(raw)
  const files = archive.files
  checkFontMagic(files, archive.manifest)
  const validationAssets = placeholderAssets(files)
  const manifest = archive.manifest
  const pages: CardTemplateParsed['pages'] = {}
  const page = (path: string, what: string): CardTemplatePageSource => ({
    path,
    html: sanitizeTemplateHtml(decode(files.get(path)!.bytes, what), path, { files, resolve: (value) => value }),
  })
  if (manifest.kind === 'long') {
    if (manifest.pages.header) pages.header = page(manifest.pages.header, 'header')
    if (manifest.pages.footer) pages.footer = page(manifest.pages.footer, 'footer')
  } else {
    pages.cover = page(manifest.pages.cover, 'cover')
    pages.body = page(manifest.pages.body, 'body')
    if (manifest.pages.end) pages.end = page(manifest.pages.end, 'end')
  }
  const styles: CardTemplateStyleSource[] = archive.manifest.styles.map((path) => {
    const css = decode(files.get(path)!.bytes, path)
    // Parse and check now, with placeholder URLs; activation repeats it with
    // the real data URLs. Rejecting here is what gives an upload a clear error.
    sanitizeTemplateCss(css, { template: customTemplateId(id), cssPath: path, files, assetUrls: validationAssets })
    return { path, css }
  })
  const now = Date.now()
  return {
    id,
    template: customTemplateId(id),
    name: archive.manifest.name,
    createdAt: now,
    updatedAt: now,
    raw,
    parsed: {
      manifest,
      pages,
      styles,
      files: [...files.values()].map((file) => ({
        path: file.path,
        bytes: file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer,
      })),
    },
  }
}

/** Re-validate stored sources and make the template available to the card UI. */
export async function activateCardTemplate(record: CardTemplateSourceRecord): Promise<LoadedTemplate> {
  const { parsed } = record
  // Packages stored before `customize` existed were parsed without it.
  const manifest = { ...parsed.manifest, customize: parsed.manifest.customize ?? { colors: [], fonts: [] } }
  const renderId = manifest.renderId
  const files = filesFromParsed(parsed)
  const assetUrls = archiveAssetUrls(files)
  const styleCss = manifest.styles.map((path) => {
    const source = parsed.styles.find((style) => style.path === path)
    if (!source) throw new CardTemplateError('missing-file', path)
    return sanitizeTemplateCss(source.css, {
      template: record.template, cssPath: path, files, assetUrls, kind: manifest.kind,
    })
  }).join('\n')
  deactivateCardTemplate(record.template)
  const style = document.createElement('style')
  style.id = STYLE_ID_PREFIX + record.id
  style.dataset.cardTemplateStyle = record.template
  style.textContent = styleCss
  document.head.append(style)
  try {
    const fonts = await loadPackageFonts(manifest, files)
    const base = {
      template: record.template,
      renderId,
      manifest,
      summary: summaryOf(record),
      files,
      packageFontCss: packageFontCss(manifest, files),
      style,
      fonts,
    }
    let loaded: LoadedTemplate
    if (manifest.kind === 'long') {
      const header = parsed.pages.header
      const footer = parsed.pages.footer
      const page = (source?: CardTemplatePageSource) => source
        ? sanitizeTemplateHtml(source.html, source.path, { files, resolve: (path) => assetUrls.get(path) ?? null })
        : ''
      loaded = {
        ...base,
        kind: 'long',
        manifest,
        pages: { header: page(header), footer: page(footer) },
      }
      checkLongPages(loaded)
      LOADED.set(record.template, loaded)
      registerLongTemplateRuntime(runtimeOfLong(loaded))
    } else {
      const page = (source: CardTemplatePageSource | undefined, fallback?: CardTemplatePageSource) =>
        sanitizeTemplateHtml((source ?? fallback)!.html, (source ?? fallback)!.path, {
          files, resolve: (path) => assetUrls.get(path) ?? null,
        })
      loaded = {
        ...base,
        kind: 'card',
        manifest,
        pages: {
          cover: page(parsed.pages.cover),
          body: page(parsed.pages.body),
          end: page(parsed.pages.end, parsed.pages.body),
        },
      }
      LOADED.set(record.template, loaded)
      registerCardTemplateRuntime(runtimeOf(loaded))
    }
    return loaded
  } catch (error) {
    style.remove()
    throw error
  }
}

/** The engine fills the cover slot itself; it must be an img element. */
function checkLongPages(loaded: LoadedLongTemplate): void {
  for (const html of [loaded.pages.header, loaded.pages.footer]) {
    if (!html) continue
    const holder = document.createElement('div')
    holder.innerHTML = html
    for (const element of Array.from(holder.querySelectorAll('[data-slot="cover"]'))) {
      if (element.tagName !== 'IMG') throw new CardTemplateError('bad-manifest', 'cover slot must be an img element')
    }
  }
}

export function deactivateCardTemplate(template: string): void {
  const loaded = LOADED.get(template)
  if (loaded?.style) loaded.style.remove()
  if (loaded) {
    for (const face of loaded.fonts) {
      try { document.fonts?.delete(face) } catch { /* the face may already be gone */ }
    }
  }
  LOADED.delete(template)
  unregisterCardTemplateRuntime(template)
  unregisterLongTemplateRuntime(template)
}

export function summaryOf(record: CardTemplateSourceRecord): CardTemplateSummary {
  const manifest = record.parsed.manifest
  return {
    kind: manifest.kind,
    id: record.id,
    template: record.template,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    variants: manifest.variants.map((variant) => ({ id: variant.id, name: variant.name })),
    ratios: manifest.kind === 'card' ? [...manifest.ratios] : [],
  }
}

function runtimeOf(loaded: LoadedCardTemplate): CardTemplateRuntime {
  const manifest = loaded.manifest
  return {
    template: loaded.template,
    name: manifest.name,
    variants: manifest.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      accent: variant.tokens.accent,
      dark: variant.dark,
    })),
    ratios: [...manifest.ratios],
    metrics: manifest.metrics,
    fonts: manifest.fonts.map((font): CardFontFace => font.source === 'builtin'
      ? { family: font.family, weights: font.weights, styles: font.styles }
      : { family: font.family, weights: [font.weight], styles: [font.style] }),
    customize: manifest.customize ?? { colors: [], fonts: [] },
  }
}

function runtimeOfLong(loaded: LoadedLongTemplate): LongTemplateRuntime {
  const manifest = loaded.manifest
  return {
    kind: 'long',
    template: loaded.template,
    name: manifest.name,
    variants: manifest.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      accent: variant.tokens.accent,
      dark: variant.dark,
    })),
    metrics: manifest.metrics,
    fonts: manifest.fonts.map((font): CardFontFace => font.source === 'builtin'
      ? { family: font.family, weights: font.weights, styles: font.styles }
      : { family: font.family, weights: [font.weight], styles: [font.style] }),
    customize: manifest.customize ?? { colors: [], fonts: [] },
  }
}

export interface TemplatePageContext {
  kind: 'cover' | 'body' | 'end'
  pageIndex: number
  total: number
  title: string
  subtitle: string
  author: string
  articleTitle: string
  contentHtml?: string
  height: number
  lang: 'zh' | 'en'
}

type NumeralFormat = 'pad2' | 'chinese' | 'plain'

function numeral(n: number, format: string | undefined): string {
  switch (format) {
    case 'chinese': return chinesePageNumber(n)
    case 'plain': return String(n)
    case 'pad2':
    default: return String(n).padStart(2, '0')
  }
}

function counter(page: number, total: number, format: string | undefined): string {
  const f: NumeralFormat = format === 'chinese' ? 'chinese' : format === 'plain' ? 'plain' : 'pad2'
  if (format === 'bracket') return `[ ${numeral(page, 'pad2')} / ${numeral(total, 'pad2')} ]`
  return `${numeral(page, f)} / ${numeral(total, f)}`
}

function dateText(lang: 'zh' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function slotValue(slot: string, page: number, total: number, format: string | undefined, ctx: TemplatePageContext): string | null {
  switch (slot) {
    case 'title': return ctx.title
    case 'subtitle': return ctx.subtitle
    case 'author': return ctx.author
    case 'article-title': return ctx.articleTitle
    case 'page-number': return numeral(page, format)
    case 'page-total': return numeral(total, format)
    case 'page-counter': return counter(page, total, format)
    case 'page-count': return t('cards.pageCount', { n: numeral(total, format) })
    case 'brand': return t('app.name')
    case 'hint': return t('cards.swipe')
    case 'date': return dateText(ctx.lang)
    default: return null
  }
}

function parseFragment(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

/**
 * An end page without a content slot is a closing page of its own (title,
 * author) that follows the article. Using it as the frame of the last body
 * page would drop that page's text, so it is added after the body pages
 * instead. An end page that does place the content keeps framing the last page.
 */
export function cardEndIsExtraPage(loaded: LoadedCardTemplate): boolean {
  return Boolean(loaded.manifest.pages.end) && !/data-slot\s*=\s*["']?content["'\s>]/.test(loaded.pages.end)
}

/**
 * Fill declarative slots with DOM nodes. Text values use `textContent`, and the
 * only HTML inserted is the engine's own rendered article, never template text.
 */
export function renderTemplatePage(
  loaded: LoadedCardTemplate,
  ctx: TemplatePageContext,
  variant: string,
  dark: boolean,
): DocumentFragment {
  const source = ctx.kind === 'cover' ? loaded.pages.cover
    : ctx.kind === 'end' ? loaded.pages.end : loaded.pages.body
  const fragment = parseFragment(source)
  const page = ctx.pageIndex + 1

  for (const element of Array.from(fragment.querySelectorAll('[data-when-variant], [data-when-dark]'))) {
    const variants = (element.getAttribute('data-when-variant') ?? '').split(/\s+/).filter(Boolean)
    if (variants.length && !variants.includes(variant)) {
      element.remove()
      continue
    }
    const darkExpectation = element.getAttribute('data-when-dark')
    if (darkExpectation !== null && (darkExpectation === 'true') !== dark) element.remove()
  }

  for (const element of Array.from(fragment.querySelectorAll('[data-slot]'))) {
    if (!fragment.contains(element)) continue
    const slot = element.getAttribute('data-slot') ?? ''
    if (slot === 'content') {
      element.replaceChildren(...Array.from(parseFragment(ctx.contentHtml ?? '').childNodes))
      continue
    }
    const format = element.getAttribute('data-format') ?? undefined
    const value = slotValue(slot, page, ctx.total, format, ctx)
    if (value === null) continue
    element.textContent = value
    const transform = element.getAttribute('data-transform')
    if (transform === 'lowercase') element.textContent = value.toLowerCase()
    if (transform === 'uppercase') element.textContent = value.toUpperCase()
    if (!value && (slot === 'subtitle' || slot === 'title')) element.remove()
  }

  const title = fragment.querySelector<HTMLElement>('[data-fit-cover-title]')
  if (ctx.kind === 'cover' && title) {
    const size = coverTitleSize(ctx.title, ctx.height, loaded.template)
    title.style.fontSize = `${size}px`
    title.dataset.coverTitleSize = String(size)
  }
  return fragment
}

export function fragmentHtml(fragment: DocumentFragment): string {
  const holder = document.createElement('div')
  holder.append(fragment)
  return holder.innerHTML
}

export interface LongTemplatePageContext {
  kind: 'header' | 'footer'
  title: string
  subtitle: string
  /** Empty when the article has no cover image. */
  coverSrc: string
  author: string
  contentHtml?: string
  lang: 'zh' | 'en'
}

/**
 * Fill one long-image fragment. Same declarative rules as cards plus
 * `data-when-cover` and the engine-only `cover` slot.
 */
export function renderLongTemplatePage(
  loaded: LoadedLongTemplate,
  ctx: LongTemplatePageContext,
  variant: string,
  dark: boolean,
): DocumentFragment {
  const source = ctx.kind === 'header' ? loaded.pages.header : loaded.pages.footer
  const fragment = parseFragment(source)
  const hasCover = Boolean(ctx.coverSrc)
  for (const element of Array.from(fragment.querySelectorAll('[data-when-variant], [data-when-dark], [data-when-cover]'))) {
    const variants = (element.getAttribute('data-when-variant') ?? '').split(/\s+/).filter(Boolean)
    if (variants.length && !variants.includes(variant)) {
      element.remove()
      continue
    }
    const darkExpectation = element.getAttribute('data-when-dark')
    if (darkExpectation !== null && (darkExpectation === 'true') !== dark) {
      element.remove()
      continue
    }
    const coverExpectation = element.getAttribute('data-when-cover')
    if (coverExpectation !== null && (coverExpectation === 'true') !== hasCover) element.remove()
  }
  for (const element of Array.from(fragment.querySelectorAll('[data-slot]'))) {
    if (!fragment.contains(element)) continue
    const slot = element.getAttribute('data-slot') ?? ''
    if (slot === 'cover') {
      if (!hasCover) {
        element.remove()
        continue
      }
      element.setAttribute('src', ctx.coverSrc)
      element.setAttribute('alt', '')
      continue
    }
    if (slot === 'content') {
      element.replaceChildren(...Array.from(parseFragment(ctx.contentHtml ?? '').childNodes))
      continue
    }
    const value = slotValue(slot, 1, 1, element.getAttribute('data-format') ?? undefined, {
      kind: 'cover', pageIndex: 0, total: 1, title: ctx.title, subtitle: ctx.subtitle,
      author: ctx.author, articleTitle: ctx.title, height: 0, lang: ctx.lang,
    })
    if (value === null) continue
    element.textContent = value
    const transform = element.getAttribute('data-transform')
    if (transform === 'lowercase') element.textContent = value.toLowerCase()
    if (transform === 'uppercase') element.textContent = value.toUpperCase()
    if (!value && (slot === 'subtitle' || slot === 'title' || slot === 'author')) element.remove()
  }
  return fragment
}