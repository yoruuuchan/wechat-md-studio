/**
 * Long-image content model.
 *
 * The engine reads Reed's semantic AST, not a second Markdown dialect. A long
 * image is one continuous page: an optional header, any number of H2 sections
 * (each with a photo group), separators, and an optional closing block after
 * the last standalone `---`.
 */
import type { Block, Doc } from './types'

export const LONG_WIDTH = 540
export const LONG_EXPORT_WIDTHS = [1080, 1440] as const
export type LongExportWidth = (typeof LONG_EXPORT_WIDTHS)[number]
export const LONG_FORMATS = ['jpg', 'png'] as const
export type LongFormat = (typeof LONG_FORMATS)[number]

export interface LongPhoto {
  src: string
  alt: string
}

export type LongContentBlock =
  | { type: 'photos'; photos: LongPhoto[] }
  | { type: 'separator' }
  | { type: 'html'; html: string }

export interface LongSection {
  title: string
  kicker: string
  /** The first paragraph of the section, styled as the section's introduction. */
  lede: string
  blocks: LongContentBlock[]
}

export interface LongDocument {
  /** False when the Markdown has no first-level heading. */
  hasHeader: boolean
  title: string
  subtitle: string
  cover: string
  preamble: LongContentBlock[]
  sections: LongSection[]
  /** Rendered footer content; empty when there is no closing `---`. */
  footer: string
  hasFooter: boolean
}

export interface PhotoLayoutItem {
  width: number
  height: number
}

export interface PhotoRow {
  items: PhotoLayoutItem[]
  height: number
}

/** How many photos share each row:1 /2s, with the first odd photo alone. */
export function photoRowSizes(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [1]
  if (count % 2 === 0) return Array.from({ length: count / 2 }, () => 2)
  return [1, ...Array.from({ length: (count - 1) / 2 }, () => 2)]
}

/**
 * Equal-height rows that fill the available width. Each image keeps its own
 * aspect ratio, so a mixed landscape/portrait pair gets two different widths
 * with one shared height. No cropping happens here.
 */
export function layoutPhotoGroup(
  aspects: readonly number[],
  contentWidth: number,
  gap: number,
): PhotoRow[] {
  const rows: PhotoRow[] = []
  let index = 0
  for (const count of photoRowSizes(aspects.length)) {
    const slice = aspects.slice(index, index + count).map((aspect) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1))
    index += count
    const available = Math.max(1, contentWidth - gap * (count - 1))
    const sum = slice.reduce((total, aspect) => total + aspect, 0)
    const height = Math.max(1, available / sum)
    rows.push({
      height: Math.round(height * 100) / 100,
      items: slice.map((aspect) => ({
        width: Math.round(height * aspect * 100) / 100,
        height: Math.round(height * 100) / 100,
      })),
    })
  }
  return rows
}

/** Target width for an embedded photo: display px × export scale, never up. */
export function resampledPhotoWidth(displayWidth: number, scale: number, naturalWidth: number): number {
  return Math.max(1, Math.min(naturalWidth, Math.ceil(displayWidth * scale)))
}

function paragraphText(block: Extract<Block, { type: 'paragraph' }>): string {
  return block.segs.map((seg) => seg.text).join('').trim()
}

function isFooterLine(source: string, line: number): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  return (lines[line] ?? '').trim() === '---'
}

function photoItems(block: Extract<Block, { type: 'image' | 'gallery' | 'carousel' }>): LongPhoto[] {
  if (block.type === 'image') return [{ src: block.src, alt: block.alt }]
  return block.items.map((item) => ({ src: item.src, alt: item.alt }))
}

/**
 * Split the AST into the long-image model. `render` converts non-photo blocks
 * to HTML; photo grouping stays here so row layout can be tested without a DOM.
 */
interface RawPhotosBlock {
  type: 'rawPhotos'
  photos: LongPhoto[]
  line: number
  lineEnd: number
}

type BuildBlock = Block | RawPhotosBlock

/**
 * Runs of image-only source lines. Markdown merges these into one paragraph
 * and Reed's AST intentionally drops inline images, so the long engine reads
 * the same lines back at the source level.
 */
export function scanPhotoRuns(source: string): { start: number; end: number; photos: LongPhoto[] }[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const runs: { start: number; end: number; photos: LongPhoto[] }[] = []
  let current: { start: number; end: number; photos: LongPhoto[] } | null = null
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim()
    const match = /^!\[([^\]]*)\]\((.+)\)$/.exec(text)
    if (!match) {
      if (text && current) { runs.push(current); current = null }
      continue
    }
    if (!current) current = { start: index, end: index + 1, photos: [] }
    current.photos.push({ alt: match[1].trim(), src: match[2].trim() })
    current.end = index + 1
  }
  if (current) runs.push(current)
  return runs
}

/**
 * Split the AST into the long-image model. `render` converts non-photo blocks
 * to HTML; `renderPhotos` is used only for a photo run that lands in the
 * footer, where the section photo-group markup is not available.
 */
export function buildLongDocument(
  doc: Doc,
  source: string,
  render: (blocks: readonly Block[]) => string,
  renderPhotos: (photos: readonly LongPhoto[]) => string = () => '',
): LongDocument {
  const blocks: BuildBlock[] = [...doc.blocks]
  for (const run of scanPhotoRuns(source)) {
    const represented = blocks.some((block) =>
      (block.type === 'image' || block.type === 'gallery' || block.type === 'carousel') &&
      block.line >= run.start && block.line < run.end)
    const overlapped = blocks.some((block) =>
      block.type === 'paragraph' && block.line < run.end && block.lineEnd > run.start)
    if (represented || overlapped) continue
    blocks.push({ type: 'rawPhotos', photos: run.photos, line: run.start, lineEnd: run.end })
  }
  blocks.sort((a, b) => a.line - b.line)

  let hasHeader = false
  let title = ''
  let subtitle = ''
  let cover = ''
  let start = 0
  const firstHeading = blocks.findIndex((block) => block.type === 'heading' && !block.numbered)
  if (firstHeading >= 0) {
    hasHeader = true
    const heading = blocks[firstHeading] as Extract<Block, { type: 'heading' }>
    title = heading.title.trim()
    start = firstHeading + 1
    const candidate = blocks[start]
    if (candidate?.type === 'paragraph' && paragraphText(candidate).trim().length > 0 && paragraphText(candidate).length <= 60) {
      subtitle = paragraphText(candidate)
      start++
    }
  }

  let footerAt = -1
  for (let index = blocks.length - 1; index >= start; index--) {
    const block = blocks[index]
    if (block.type === 'hr' && isFooterLine(source, block.line) && index < blocks.length - 1) {
      footerAt = index
      break
    }
  }
  const footerBlocks = footerAt >= 0 ? blocks.slice(footerAt + 1) : []
  let bodyEnd = footerAt >= 0 ? footerAt : blocks.length

  if (hasHeader) {
    for (let index = start; index < bodyEnd; index++) {
      const block = blocks[index]
      if (block.type === 'heading' && block.numbered) break
      if (block.type === 'image') {
        cover = block.src
        blocks.splice(index, 1)
        if (index < footerAt) footerAt--
        bodyEnd--
        break
      }
      if (block.type === 'gallery' || block.type === 'carousel') {
        if (!block.items.length) continue
        cover = block.items[0].src
        if (block.items.length === 1) {
          blocks.splice(index, 1)
          if (index < footerAt) footerAt--
          bodyEnd--
        } else {
          block.items = block.items.slice(1)
        }
        break
      }
      if (block.type === 'rawPhotos') {
        cover = block.photos[0].src
        if (block.photos.length === 1) {
          blocks.splice(index, 1)
          if (index < footerAt) footerAt--
          bodyEnd--
        } else {
          block.photos = block.photos.slice(1)
        }
        break
      }
    }
  }

  const preamble: LongContentBlock[] = []
  const sections: LongSection[] = []
  let section: LongSection | null = null
  let pendingHtml: Block[] = []
  let pendingPhotos: LongPhoto[] = []

  const flushHtml = () => {
    if (!pendingHtml.length) return
    const html = render(pendingHtml)
    if (section) section.blocks.push({ type: 'html', html })
    else preamble.push({ type: 'html', html })
    pendingHtml = []
  }
  const flushPhotos = () => {
    if (!pendingPhotos.length) return
    const photos = pendingPhotos
    pendingPhotos = []
    if (section) section.blocks.push({ type: 'photos', photos })
    else preamble.push({ type: 'photos', photos })
  }

  for (let index = start; index < bodyEnd; index++) {
    const block = blocks[index]
    if (block.type === 'heading' && block.numbered) {
      flushPhotos()
      flushHtml()
      section = { title: block.title.trim(), kicker: block.kicker.trim(), lede: '', blocks: [] }
      sections.push(section)
      continue
    }
    if (block.type === 'rawPhotos') {
      flushHtml()
      pendingPhotos.push(...block.photos)
      continue
    }
    if (block.type === 'image' || block.type === 'gallery' || block.type === 'carousel') {
      flushHtml()
      pendingPhotos.push(...photoItems(block))
      continue
    }
    flushPhotos()
    if (block.type === 'hr') {
      flushHtml()
      if (section) section.blocks.push({ type: 'separator' })
      else preamble.push({ type: 'separator' })
      continue
    }
    if (section && section.blocks.length === 0 && !section.lede && block.type === 'paragraph') {
      section.lede = render([block]).replace(/^<p>/, '<p class="reed-long-lede">')
      continue
    }
    pendingHtml.push(block)
  }
  flushPhotos()
  flushHtml()

  return {
    hasHeader,
    title,
    subtitle,
    cover,
    preamble,
    sections,
    footer: footerBlocks.length
      ? footerBlocks.map((block) => block.type === 'rawPhotos'
        ? renderPhotos(block.photos)
        : render([block])).join('')
      : '',
    hasFooter: footerBlocks.length > 0,
  }
}
