/**
 * Runtime for uploaded card templates.
 *
 * `parseCardTemplateSource` validates a zip and keeps the raw archive and the
 * parsed pieces in IndexedDB. `activateCardTemplate` runs the same HTML/CSS
 * filters again at render time, installs the scoped stylesheet once and
 * registers the measurements/fonts the shared pagination code consumes.
 */
import {
  chinesePageNumber, coverTitleSize, registerCardTemplateRuntime,
  unregisterCardTemplateRuntime, type CardFontFace, type CardTemplateRuntime,
} from './cards'
import {
  CardTemplateError, type CardTemplateManifest, type CardTemplateSummary,
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
  manifest: CardTemplateManifest
  pages: { cover: CardTemplatePageSource; body: CardTemplatePageSource; end?: CardTemplatePageSource }
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

export interface LoadedCardTemplate {
  template: string
  /** CSS key written to `data-template`, from manifest.renderId. */
  renderId: string
  manifest: CardTemplateManifest
  summary: CardTemplateSummary
  pages: { cover: string; body: string; end: string }
  files: Map<string, CardTemplateArchiveFile>
  packageFontCss: string
  style: HTMLStyleElement | null
  fonts: FontFace[]
}

const LOADED = new Map<string, LoadedCardTemplate>()
const STYLE_ID_PREFIX = 'reed-card-template-style-'

export function customTemplateId(id: string): string {
  return `custom.${id}`
}

export function getLoadedCardTemplate(template: string): LoadedCardTemplate | undefined {
  return LOADED.get(template)
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

function checkFontMagic(files: Map<string, CardTemplateArchiveFile>, manifest: CardTemplateManifest): void {
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
  const pages: CardTemplateParsed['pages'] = {
    cover: {
      path: archive.manifest.pages.cover,
      html: sanitizeTemplateHtml(decode(files.get(archive.manifest.pages.cover)!.bytes, 'cover'),
        archive.manifest.pages.cover, { files, resolve: (path) => path }),
    },
    body: {
      path: archive.manifest.pages.body,
      html: sanitizeTemplateHtml(decode(files.get(archive.manifest.pages.body)!.bytes, 'body'),
        archive.manifest.pages.body, { files, resolve: (path) => path }),
    },
    ...(archive.manifest.pages.end ? {
      end: {
        path: archive.manifest.pages.end,
        html: sanitizeTemplateHtml(decode(files.get(archive.manifest.pages.end)!.bytes, 'end'),
          archive.manifest.pages.end, { files, resolve: (path) => path }),
      },
    } : {}),
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
      manifest: archive.manifest,
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
export async function activateCardTemplate(record: CardTemplateSourceRecord): Promise<LoadedCardTemplate> {
  const { parsed } = record
  const manifest = parsed.manifest
  const renderId = manifest.renderId
  const files = filesFromParsed(parsed)
  const assetUrls = archiveAssetUrls(files)
  const pages = {
    cover: sanitizeTemplateHtml(parsed.pages.cover.html, parsed.pages.cover.path, { files, resolve: (path) => assetUrls.get(path) ?? null }),
    body: sanitizeTemplateHtml(parsed.pages.body.html, parsed.pages.body.path, { files, resolve: (path) => assetUrls.get(path) ?? null }),
    end: sanitizeTemplateHtml((parsed.pages.end ?? parsed.pages.body).html,
      (parsed.pages.end ?? parsed.pages.body).path, { files, resolve: (path) => assetUrls.get(path) ?? null }),
  }
  const css = manifest.styles.map((path) => {
    const source = parsed.styles.find((style) => style.path === path)
    if (!source) throw new CardTemplateError('missing-file', path)
    return sanitizeTemplateCss(source.css, {
      template: record.template, cssPath: path, files, assetUrls,
    })
  }).join('\n')
  deactivateCardTemplate(record.template)
  const style = document.createElement('style')
  style.id = STYLE_ID_PREFIX + record.id
  style.dataset.cardTemplateStyle = record.template
  style.textContent = css
  document.head.append(style)
  try {
    const fonts = await loadPackageFonts(manifest, files)
    const loaded: LoadedCardTemplate = {
      template: record.template,
      renderId,
      manifest,
      summary: summaryOf(record),
      pages,
      files,
      packageFontCss: packageFontCss(manifest, files),
      style,
      fonts,
    }
    LOADED.set(record.template, loaded)
    registerCardTemplateRuntime(runtimeOf(loaded))
    return loaded
  } catch (error) {
    style.remove()
    throw error
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
}

export function summaryOf(record: CardTemplateSourceRecord): CardTemplateSummary {
  const manifest = record.parsed.manifest
  return {
    id: record.id,
    template: record.template,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    variants: manifest.variants.map((variant) => ({ id: variant.id, name: variant.name })),
    ratios: [...manifest.ratios],
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