/* eslint-disable no-control-regex -- stripping C0 control characters out of filenames and article names is the entire purpose of these two patterns. */
// Import / export for the article library: Markdown files, whole-library
// backups, and DOCX import.
//
// Two hard rules shaped this module:
//
// 1. The article body already IS our Markdown dialect (`DocRecord.content`), so
//    exporting it must be byte-for-byte. `==mark==`, `:::carousel`, `:::quote`,
//    `:::center`, `@signature`, `img:<key>` and the front matter are ours alone;
//    every general-purpose Markdown round-tripper rewrites them. So there is
//    deliberately no Markdown-to-Markdown normaliser anywhere in here.
// 2. Nothing in this file touches the DOM. Every export returns plain data and
//    the caller hands it to `downloadFile` from `./clipboard`, which keeps the
//    module testable under vitest's `node` environment.

import type { AppSettings, DocRecord } from './store'
import { t } from './i18n'

/** Bumped whenever the on-disk shape of a backup changes. */
export const BUNDLE_VERSION = 1

export const MARKDOWN_MIME = 'text/markdown'
export const BUNDLE_MIME = 'application/json'

/** Shape `downloadFile` from `./clipboard` expects. */
export interface ExportFile {
  filename: string
  content: string
  mime: string
}

// ---------- filenames ----------

/**
 * Characters no filesystem allows, plus C0/C1 control codes. A control code in
 * a filename is legal on Unix but makes the file impossible to open on Windows.
 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/**
 * Names Windows reserves for devices regardless of extension. `CON.md` cannot
 * be created at all, so it has to be renamed rather than merely cleaned.
 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Cap on the stem, in code points. Long enough for a real Chinese headline,
 * short enough that stem + extension + a download directory stays well inside
 * the 260-character MAX_PATH that Windows still honours by default.
 */
const MAX_STEM_CODEPOINTS = 100

/** Longest trailing extension we strip, e.g. `.markdown`. */
const MAX_EXT_LENGTH = 8

function sanitizeStem(raw: string): string {
  // Iterate code points rather than UTF-16 units: slicing a surrogate pair in
  // half leaves an unpaired surrogate that Windows renders as a box.
  let chars = Array.from(raw.replace(ILLEGAL_FILENAME_CHARS, ''))

  // Drop a trailing extension before truncating, so "report.docx" exported as
  // Markdown becomes "report.md" and not "report.docx.md". Only an alphabetic
  // suffix counts as an extension — otherwise "第1.5章" would lose its ".5章".
  const joined = chars.join('')
  const withoutExt = joined.replace(
    new RegExp(`\\.[A-Za-z]{1,${MAX_EXT_LENGTH}}$`),
    '',
  )
  chars = Array.from(withoutExt)

  if (chars.length > MAX_STEM_CODEPOINTS) chars = chars.slice(0, MAX_STEM_CODEPOINTS)

  // Windows silently strips trailing dots and spaces from a filename, which
  // would make the saved name differ from the one we announced. Trim first.
  let stem = chars.join('').replace(/^[\s.]+/, '').replace(/[\s.]+$/, '')

  if (WINDOWS_RESERVED_NAME.test(stem)) stem = `_${stem}`
  return stem
}

/**
 * Turn an arbitrary article or file name into a safe `<stem>.<ext>`.
 *
 * `fallback` is used when `name` contains nothing usable (empty, or made
 * entirely of illegal characters). The final `'untitled'` guard exists because
 * names arrive from user-picked files, and returning a bare `.md` would be a
 * hidden, extension-only filename that several file managers refuse to show.
 */
export function safeFilename(name: string, fallback: string, ext: string): string {
  const cleanExt = ext.replace(/^[.]+/, '').replace(ILLEGAL_FILENAME_CHARS, '')
  const stem = sanitizeStem(name) || sanitizeStem(fallback) || 'untitled'
  return cleanExt ? `${stem}.${cleanExt}` : stem
}

// ---------- Markdown ----------

/**
 * Export an article as a `.md` file.
 *
 * The body is passed through untouched. No BOM: the file must stay
 * byte-identical to `content` so that exporting and re-importing is provably a
 * no-op, and a leading U+FEFF would end up inside `content` on the way back in.
 * Windows Notepad has defaulted to UTF-8 and detected it without a BOM since
 * Windows 10 1903, and every other consumer of these files — our own importer,
 * VS Code, Typora, Obsidian, git — is either BOM-neutral or actively confused
 * by one. Line endings are left as the editor holds them for the same reason.
 */
export function toMarkdownFile(name: string, content: string): ExportFile {
  return {
    filename: safeFilename(name, t('io.fallbackArticle'), 'md'),
    content,
    mime: MARKDOWN_MIME,
  }
}

/**
 * The import half of `toMarkdownFile`.
 *
 * Strips a BOM because inbound files were not written by us: an editor that
 * re-saved the export may have added one. Everything after the BOM is returned
 * verbatim, so a round trip through export and import cannot alter the dialect.
 */
export function parseMarkdownFile(
  text: string,
  filename: string,
): { name: string; content: string } {
  const content = stripBom(text)
  return { name: articleName(content, filename), content }
}

/**
 * Pick a display name for an imported article: the first front matter title,
 * then an ATX `#` title, then the file name.
 *
 * Front matter comes first because `titles` is what this app renders as the
 * headline candidates; an `#` heading in the body is usually a section title.
 */
function articleName(content: string, filename: string): string {
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const fromTitles = frontMatter?.[1].match(/^[ \t]+-[ \t]+(\S.*)$/m)?.[1]?.trim()
  const fromHeading = content.match(/^#[ \t]+(\S.*)$/m)?.[1]?.trim()
  const fromFile = sanitizeStem(filename)
  const raw = fromTitles || fromHeading || fromFile || t('io.importFallback')
  // Trim to the server's own limit for a doc name (see DocInput in
  // api/docs-router.ts) so an imported article can always be synced.
  return Array.from(raw.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 200).join('')
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// ---------- whole-library backup ----------

export interface DocBundle {
  version: number
  /** ISO-8601, so a backup can be dated without trusting the file's mtime. */
  exportedAt: string
  docs: DocRecord[]
  /**
   * Theme and signature names, which have no other way off this device: the
   * server stores docs and files only, never settings. Optional so a bundle
   * stays readable by anything that only cares about the articles.
   */
  settings?: AppSettings
}

/**
 * Per-field limits, mirroring `DocInput` in `api/docs-router.ts` and the
 * `.max(500)` on its `importLocal` route. Validating against the same numbers
 * here means a bundle that parses locally is also one the server will accept,
 * instead of failing later with a much less helpful message.
 */
const MAX_DOCS = 500
const MAX_ID_LENGTH = 64
const MAX_NAME_LENGTH = 200
const MAX_CONTENT_LENGTH = 2_000_000

/**
 * Serialise the whole library. Compact rather than pretty-printed: a backup can
 * hold hundreds of articles and is a machine round-trip format, not something
 * anybody reads line by line.
 */
export function toBundle(docs: DocRecord[], settings?: AppSettings): string {
  const bundle: DocBundle = {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    docs,
  }
  if (settings) bundle.settings = settings
  return JSON.stringify(bundle)
}

/**
 * Date-stamped backup filename. The stamp matters more than it looks: without
 * it every export is the same name and the browser quietly appends `(1)`, `(2)`,
 * which makes "which backup is newest" unanswerable from the Downloads folder.
 *
 * Built from local date parts rather than `toISOString().slice(0, 10)`, because
 * UTC would stamp yesterday's date on anything exported before 08:00 in China.
 */
export function bundleFilename(count: number): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${t('io.bundleName', { date: stamp, n: count })}.json`
}

export type BundleParseResult =
  | { ok: true; docs: DocRecord[]; version: number; settings: AppSettings | null }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a backup file.
 *
 * Every failure carries a sentence aimed at the owner rather than a thrown
 * exception, because the usual causes are "wrong file picked" and "download
 * truncated" and neither is debuggable from a stack trace.
 */
export function parseBundle(text: string): BundleParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(stripBom(text))
  } catch {
    return { ok: false, reason: t('io.reason.parse') }
  }

  if (!isRecord(raw)) {
    return { ok: false, reason: t('io.reason.notBundle') }
  }

  const { version } = raw
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: t('io.reason.noVersion') }
  }
  if (version !== BUNDLE_VERSION) {
    return {
      ok: false,
      reason: t('io.reason.version', { n: version, m: BUNDLE_VERSION }),
    }
  }

  const { docs } = raw
  if (!Array.isArray(docs)) {
    return { ok: false, reason: t('io.reason.noDocs') }
  }
  if (docs.length > MAX_DOCS) {
    return {
      ok: false,
      reason: t('io.reason.tooMany', { n: docs.length, max: MAX_DOCS }),
    }
  }

  const out: DocRecord[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < docs.length; i++) {
    const entry = docs[i]
    // 1-based: the owner counts articles the way a list shows them.
    const label = t('io.entryLabel', { n: i + 1 })
    if (!isRecord(entry)) {
      return { ok: false, reason: t('io.reason.entryNotObject', { label }) }
    }

    const id = entry.id
    if (typeof id !== 'string' || id.length === 0) {
      return { ok: false, reason: t('io.reason.entryNoId', { label }) }
    }
    if (id.length > MAX_ID_LENGTH) {
      return { ok: false, reason: t('io.reason.entryIdLong', { label, n: MAX_ID_LENGTH }) }
    }
    if (seenIds.has(id)) {
      return { ok: false, reason: t('io.reason.entryDupId', { label, id }) }
    }

    const name = entry.name
    if (typeof name !== 'string') {
      return { ok: false, reason: t('io.reason.entryNoName', { label }) }
    }
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, reason: t('io.reason.entryNameLong', { label, n: MAX_NAME_LENGTH }) }
    }

    const content = entry.content
    if (typeof content !== 'string') {
      return { ok: false, reason: t('io.reason.entryNoContent', { label }) }
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, reason: t('io.reason.entryContentLong', { label, n: MAX_CONTENT_LENGTH }) }
    }

    const updatedAt = entry.updatedAt
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
      return { ok: false, reason: t('io.reason.entryNoUpdatedAt', { label }) }
    }

    // `savedAt` is nullable by design (null = never put into 草稿箱) and a
    // record written before the field existed simply omits it, which
    // `loadDocs` in ./store already tolerates.
    const rawSavedAt = entry.savedAt
    let savedAt: number | null = null
    if (rawSavedAt !== undefined && rawSavedAt !== null) {
      if (typeof rawSavedAt !== 'number' || !Number.isFinite(rawSavedAt)) {
        return { ok: false, reason: t('io.reason.entryNoSavedAt', { label }) }
      }
      savedAt = rawSavedAt
    }

    seenIds.add(id)
    // The original id is kept on purpose. Whether an incoming id that collides
    // with an existing article overwrites it or gets a fresh one is the
    // caller's decision — it depends on UI this module cannot see. For
    // reference, the server's `importLocal` route resolves collisions by
    // skipping the incoming doc and keeping what is already stored.
    // A backup restores articles live: the bundle format carries no bin state.
    out.push({ id, name, content, updatedAt, savedAt, deletedAt: null })
  }

  return { ok: true, docs: out, version, settings: readSettings(raw.settings) }
}

/**
 * Settings are a bonus, never a reason to reject a backup: a malformed settings
 * block still yields `null` so the articles themselves import.
 */
function readSettings(value: unknown): AppSettings | null {
  if (!isRecord(value)) return null
  const sig = value.sig
  if (typeof value.themeId !== 'string' || !isRecord(sig)) return null
  const { layout, proof, review } = sig
  if (typeof layout !== 'string' || typeof proof !== 'string' || typeof review !== 'string') {
    return null
  }
  return {
    themeId: value.themeId,
    sig: { layout, proof, review },
    syncScroll: typeof value.syncScroll === 'boolean' ? value.syncScroll : true,
    zoom: typeof value.zoom === 'number' && value.zoom >= 90 && value.zoom <= 125 ? value.zoom : 100,
  }
}

// ---------- DOCX ----------

/**
 * HTML to our Markdown dialect. Injected rather than built in: `rich-paste.ts`
 * owns that conversion for pasted rich text, and a second, worse copy of it here
 * would drift. Making it a required parameter means forgetting to wire it up is
 * a compile error instead of a silent quality regression on every DOCX import.
 *
 * The intended implementation is `htmlToDialect` from `./rich-paste`.
 */
export type HtmlToMarkdown = (html: string) => string

/** A picture pulled out of a Word file, held in memory until it is uploaded. */
export interface DocxImage {
  /** Word's picture description; `''` when the document never set one. */
  alt: string
  contentType: string
  /**
   * `data:<contentType>;base64,<...>`. Directly usable as a preview src, and
   * directly `fetch`-able into a Blob for the existing upload mutation, whose
   * `contentBase64` is everything after the comma.
   */
  dataUri: string
}

export interface DocxImport {
  /**
   * Our dialect, with one `![alt]()` placeholder per picture in the document.
   *
   * The src is deliberately empty: that is this codebase's existing "slot
   * waiting for an upload" convention (`collectMaterials` reports
   * `hasSrc: false` for it) and `htmlToDialect` blanks every image src anyway.
   * Feed `images` through the upload flow and hand the resulting refs to
   * `fillImageSlots` from `./rich-paste`, which fills `![alt]()` slots in
   * document order and skips code fences.
   */
  markdown: string
  /**
   * Document order, one entry per placeholder in `markdown`, so `images[k]` is
   * the k-th slot.
   */
  images: DocxImage[]
}

/**
 * mammoth's `Image` type omits `altText`, but `lib/images.js` reads it off the
 * element at runtime.
 */
interface MammothImageElement {
  altText?: string
}

/**
 * Style rules layered on top of mammoth's defaults.
 *
 * Heading 1-6 to h1-h6 is intentionally absent: mammoth's own default style map
 * already contains `p.Heading1 => h1:fresh` through `p.Heading6 => h6:fresh`
 * plus the `p[style-name='Heading N']` variants, so repeating it changes
 * nothing. What is missing upstream is Word's Title and Quote styles, which
 * otherwise fall through to a plain `<p>`.
 */
const DOCX_STYLE_MAP = [
  // `#` renders as our unnumbered article title, which is what Word's Title is.
  "p[style-name='Title'] => h1:fresh",
  // `>` renders as our 金句 card.
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
]

/**
 * Read a `.docx` into our dialect plus the pictures it contains.
 *
 * mammoth is imported dynamically on purpose. A static import builds fine but
 * inlines roughly 600 KB of unminified DOCX/XML machinery into the entry chunk;
 * with a dynamic import Vite splits it into its own chunk and the editor's first
 * load never pays for a feature most sessions do not use.
 */
export async function docxToDocxImport(
  buffer: ArrayBuffer,
  htmlToMd: HtmlToMarkdown,
): Promise<DocxImport> {
  const imported = await import('mammoth')
  // mammoth's declarations use `export =`, so the namespace carries a `default`
  // holding the CommonJS exports. Verified present both in a Vite production
  // bundle (Rollup's CommonJS interop) and under vitest's SSR transform.
  const mammoth = imported.default

  const images: DocxImage[] = []
  const result = await mammoth.convertToHtml(
    // mammoth's types describe the input as either `{buffer: Buffer}` (Node) or
    // `{arrayBuffer}` (browser) and never both, because `package.json#browser`
    // swaps `lib/unzip.js` for `browser/unzip.js` at bundle time. We send both
    // keys: the browser build reads `arrayBuffer`, and vitest — which resolves
    // the Node build, since the `browser` field does not apply under SSR —
    // reads `buffer`. jszip accepts either.
    { arrayBuffer: buffer, buffer: new Uint8Array(buffer) } as unknown as Parameters<
      typeof mammoth.convertToHtml
    >[0],
    {
      styleMap: DOCX_STYLE_MAP,
      // Overriding `convertImage` replaces mammoth's default, which inlines the
      // picture as a base64 data URI. We collect it separately instead: images
      // in this app are uploaded to R2 and addressed as `img:<key>`, and a
      // megabyte of base64 pasted into the article body would never survive
      // being pushed to the WeChat editor.
      //
      // The src left in the HTML is empty on purpose, so the converter emits
      // `![alt]()` — the same slot shape the drop and paste flows already fill.
      // It also keeps these pictures out of `extractImages` in `./rich-paste`,
      // which filters on a non-empty src, so `images` below stays the only list
      // of what needs uploading.
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.readAsBase64String()
        images.push({
          alt: (image as unknown as MammothImageElement).altText ?? '',
          contentType: image.contentType,
          dataUri: `data:${image.contentType};base64,${base64}`,
        })
        return { src: '' }
      }),
    },
  )

  return { markdown: htmlToMd(result.value), images }
}
