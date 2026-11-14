/**
 * Long-image export: resample photos before embedding, then render the page in
 * one canvas when the browser can hold it, or one tile per module boundary when
 * it cannot. Tiles are never presented as one image.
 */
import type { CardFontFace } from './cards'
import { cardFontCss, markExactFontSizes, toBlobWithExactFonts } from './cards-export'
import { LONG_WIDTH, resampledPhotoWidth, type LongFormat } from './long-image'
import { layoutLongPhotoGroups } from './long-image-render'
import type { LongImageMetrics } from './cards'

export const LONG_CANVAS_LIMIT_KEY = 'mopai.long-canvas-limit.v1'

export interface CanvasLimits {
  maxEdge: number
  maxArea: number
}

export interface LongPrepareResult {
  failed: string[]
}

export interface LongExportProgress {
  phase: 'measure' | 'render' | 'zip'
  done: number
  total: number
}

export interface LongExportResult {
  blob: Blob
  filename: string
  /** True when the browser could not hold the whole page in one canvas. */
  split: boolean
  tiles: number
  width: number
  height: number
  limits: CanvasLimits
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** CSP may not allow `connect-src data:`; decode inline pictures locally. */
function dataUrlBlob(src: string): Blob {
  const comma = src.indexOf(',')
  const meta = src.slice(5, comma)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  const binary = atob(src.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

async function fetchBlob(src: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(src, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    credentials: new URL(src, location.href).origin === location.origin ? 'same-origin' : 'omit',
  })
  if (!response.ok) throw new Error(`image: HTTP ${response.status}`)
  return response.blob()
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Fall through to the <img> loader for formats ImageBitmap refuses.
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('image decode failed'))
      image.src = url
    })
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function naturalSize(image: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas encode failed'))), type, quality)
  })
}

/** Downscale one photo to its displayed export pixels; never upscale. */
async function resamplePhoto(
  blob: Blob,
  image: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  targetWidth: number,
): Promise<Blob> {
  if (targetWidth >= width) return blob
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = Math.max(1, Math.round((height * targetWidth) / width))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height, 0, 0, canvas.width, canvas.height)
  try {
    return await canvasBlob(canvas, 'image/webp', 0.92)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Load every image, lay out the photo rows from intrinsic dimensions, then
 * replace each src with a resampled data URL sized for the chosen export width.
 * Runs sequentially so forty photos do not decode at once.
 */
export async function prepareLongImages(
  root: HTMLElement,
  metrics: LongImageMetrics,
  options: { scale: number; signal: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<LongPrepareResult> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
  const failed: string[] = []
  const originalSrc = new Map<HTMLImageElement, string>()
  const objectUrls: string[] = []
  const decoded: (ImageBitmap | HTMLImageElement)[] = []
  const blobs = new Map<HTMLImageElement, { blob: Blob; image: ImageBitmap | HTMLImageElement }>()
  let done = 0
  try {
    for (const img of images) {
      options.signal.throwIfAborted()
      const src = img.getAttribute('src') ?? ''
      if (!src) continue
      originalSrc.set(img, src)
      try {
        const blob = src.startsWith('data:image/') ? dataUrlBlob(src) : await fetchBlob(src, options.signal)
        const image = await decode(blob)
        decoded.push(image)
        const { width, height } = naturalSize(image)
        img.dataset.naturalWidth = String(width)
        img.dataset.naturalHeight = String(height)
        const url = URL.createObjectURL(blob)
        objectUrls.push(url)
        img.src = url
        await img.decode()
        blobs.set(img, { blob, image })
      } catch {
        options.signal.throwIfAborted()
        failed.push(src)
        // A failed blob read must not blank a picture the browser can still show;
        // keep the original src and only mark it when decoding fails too.
        try {
          await img.decode()
        } catch {
          img.dataset.longMissing = 'true'
        }
      } finally {
        done++
        options.onProgress?.(done, images.length)
      }
    }
    layoutLongPhotoGroups(root, metrics)
    done = 0
    for (const img of images) {
      options.signal.throwIfAborted()
      const entry = blobs.get(img)
      if (!entry) continue
      try {
        const { width, height } = naturalSize(entry.image)
        const figure = img.closest<HTMLElement>('.reed-long-photo')
        let displayWidth = metrics.contentWidth
        if (figure) {
          const value = Number.parseFloat(figure.style.width)
          if (Number.isFinite(value) && value > 0) displayWidth = value
        } else {
          const rect = img.getBoundingClientRect()
          if (rect.width > 0) displayWidth = rect.width
        }
        const target = resampledPhotoWidth(displayWidth, options.scale, width)
        const out = await resamplePhoto(entry.blob, entry.image, width, height, target)
        img.src = await blobDataUrl(out)
        await img.decode()
      } catch {
        // An abort must not turn into a picture-missing warning; rethrow first.
        options.signal.throwIfAborted()
        // Keep the last readable src: the preview stays honest and the export is
        // blocked by `failed`, not blanked.
        failed.push(originalSrc.get(img) ?? img.getAttribute('src') ?? '')
      } finally {
        done++
        options.onProgress?.(done, images.length)
      }
    }
    return { failed }
  } finally {
    // Every path — success, a decode error or an abort in either loop — closes
    // the bitmaps it opened and revokes the object URLs it created. Leaving this
    // only at the happy-path tail leaked images on every edit that interrupted
    // preparation.
    for (const image of decoded) {
      if ('close' in image) image.close()
    }
    for (const url of objectUrls) URL.revokeObjectURL(url)
  }
}

const DEFAULT_LIMITS: CanvasLimits = { maxEdge: 32767, maxArea: 64 * 1024 * 1024 }

function validLimits(value: unknown): CanvasLimits | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<CanvasLimits>
  if (!Number.isInteger(candidate.maxEdge) || (candidate.maxEdge ?? 0) < 256) return null
  if (!Number.isInteger(candidate.maxArea) || (candidate.maxArea ?? 0) < 65536) return null
  return { maxEdge: candidate.maxEdge!, maxArea: candidate.maxArea! }
}

/** Test-only override, also useful on a device whose real limit is lower. */
export function canvasLimitOverride(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): CanvasLimits | null {
  if (!storage) return null
  try {
    return validLimits(JSON.parse(storage.getItem(LONG_CANVAS_LIMIT_KEY) ?? 'null'))
  } catch {
    return null
  }
}

function probeCanvas(width: number, height: number): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    if (canvas.width !== width || canvas.height !== height) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, 1)
    ctx.getImageData(0, 0, 1, 1)
    canvas.width = 0
    canvas.height = 0
    return true
  } catch {
    return false
  }
}

let cachedLimits: CanvasLimits | null = null

/**
 * Probe the current browser instead of trusting a platform table. The area
 * probe stops at 64 megapixels (256 MB): beyond that we only need to know that
 * the page does not fit and must be split.
 */
export async function detectCanvasLimits(): Promise<CanvasLimits> {
  const override = canvasLimitOverride()
  if (override) return override
  if (cachedLimits) return cachedLimits
  if (typeof document === 'undefined') return DEFAULT_LIMITS
  let lo = 256
  let hi = 65536
  if (!probeCanvas(lo, 1)) {
    cachedLimits = DEFAULT_LIMITS
    return cachedLimits
  }
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (probeCanvas(mid, 1)) lo = mid
    else hi = mid
  }
  const maxEdge = lo
  let maxArea = 1024 * 1024
  for (const area of [4, 8, 16, 32, 64]) {
    const pixels = area * 1024 * 1024
    const width = Math.min(4096, maxEdge)
    const height = Math.floor(pixels / width)
    if (height > maxEdge) break
    if (!probeCanvas(width, height)) break
    maxArea = pixels
  }
  cachedLimits = { maxEdge, maxArea }
  return cachedLimits
}

/** Pure cut planner: pack candidate boundaries without crossing the limit. */
export function computeTileCuts(
  candidates: readonly number[],
  total: number,
  maxTileHeight: number,
): number[] {
  if (total <= maxTileHeight + 0.5) return [0, total]
  const stops = [...new Set(candidates
    .filter((value) => Number.isFinite(value) && value > 0 && value < total)
    .map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b)
  const cuts = [0]
  let start = 0
  while (total - start > maxTileHeight + 0.5) {
    const limit = start + maxTileHeight
    let next = 0
    for (const stop of stops) {
      if (stop > start + 1 && stop <= limit + 0.5) next = Math.max(next, stop)
    }
    if (!next) next = Math.round(limit * 100) / 100
    cuts.push(next)
    start = next
  }
  cuts.push(Math.round(total * 100) / 100)
  return cuts
}

/**
 * Block edges a tile may end on: every flow child, the blocks inside each
 * section body and inside the preamble (the text before the first H2, which
 * is the whole article when there is no H2), and every photo row.
 */
export function cutCandidates(root: HTMLElement): number[] {
  const base = root.getBoundingClientRect().top
  const out: number[] = []
  const add = (element: Element) => {
    const rect = element.getBoundingClientRect()
    if (!rect.height) return
    out.push(rect.top - base, rect.bottom - base)
  }
  const flow = root.querySelector<HTMLElement>('.reed-long-flow') ?? root
  for (const child of Array.from(flow.children)) {
    add(child)
    const body = child.classList.contains('reed-long-section')
      ? child.querySelector<HTMLElement>('.reed-long-section-body')
      : child.classList.contains('reed-long-preamble') ? child as HTMLElement : null
    if (!body) continue
    for (const block of Array.from(body.children)) add(block)
    for (const row of Array.from(child.querySelectorAll('.reed-long-photo-row'))) add(row)
  }
  return out
}

interface ExportOptions {
  faces: readonly CardFontFace[]
  packageCss?: string
  userFonts?: readonly string[]
  scale: number
  format: LongFormat
  filename: string
  signal: AbortSignal
  onProgress?: (progress: LongExportProgress) => void
}

/**
 * html-to-image's own toBlob always encodes PNG, so take the canvas and encode
 * it here. JPEG has no alpha, so a node that paints no ground of its own gets a
 * white one. html-to-image applies that colour as the node's own
 * background-color: giving it to a template that has a ground would repaint it.
 */
async function shootNode(
  node: HTMLElement,
  width: number,
  height: number,
  options: ExportOptions,
  fontEmbedCSS: string,
): Promise<Blob> {
  const { toCanvas } = await import('html-to-image')
  const jpg = options.format === 'jpg'
  const ground = getComputedStyle(node).backgroundColor
  const bare = ground === 'transparent' || /^rgba\(.*,\s*0\)$/.test(ground)
  const encode = async (target: HTMLElement, settings: Record<string, unknown>): Promise<Blob | null> => {
    const canvas = await toCanvas(target, settings)
    try {
      return await canvasBlob(canvas, jpg ? 'image/jpeg' : 'image/png', 0.92)
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  }
  const blob = await toBlobWithExactFonts(encode, node, {
    width,
    height,
    pixelRatio: options.scale,
    fontEmbedCSS,
    skipAutoScale: true,
    ...(jpg && bare ? { backgroundColor: '#ffffff' } : {}),
  })
  if (!blob) throw new Error('long export returned no image')
  return blob
}

/**
 * Clone the preview into a fixed 540px stage, render the whole page or tile it
 * at measured block boundaries, and return either one image or a ZIP.
 */
export async function exportLongImage(
  root: HTMLElement,
  options: ExportOptions,
): Promise<LongExportResult> {
  const stage = document.createElement('div')
  stage.setAttribute('aria-hidden', 'true')
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:540px;pointer-events:none'
  const snapshot = root.cloneNode(true) as HTMLElement
  snapshot.style.transform = 'none'
  stage.append(snapshot)
  document.body.append(stage)
  try {
    markExactFontSizes([root], [snapshot])
    await document.fonts.ready
    const fontEmbedCSS = await cardFontCss(stage.innerText ?? '', {
      faces: options.faces,
      packageCss: options.packageCss,
      userFonts: options.userFonts,
    })
    const totalHeight = Math.ceil(snapshot.getBoundingClientRect().height)
    if (!(totalHeight > 0)) throw new Error('long image has no content')
    options.onProgress?.({ phase: 'measure', done: 0, total: 1 })
    const limits = await detectCanvasLimits()
    const width = Math.round(LONG_WIDTH * options.scale)
    const maxTileCss = Math.max(200, Math.floor(Math.min(
      limits.maxEdge,
      Math.floor(limits.maxArea / Math.max(1, width)),
    ) / options.scale) - 1)
    const cuts = computeTileCuts(cutCandidates(snapshot), totalHeight, maxTileCss)
    options.signal.throwIfAborted()

    if (cuts.length === 2) {
      options.onProgress?.({ phase: 'render', done: 0, total: 1 })
      const blob = await shootNode(snapshot, LONG_WIDTH, totalHeight, options, fontEmbedCSS)
      // A cancel during the render must not produce a downloadable image.
      options.signal.throwIfAborted()
      options.onProgress?.({ phase: 'render', done: 1, total: 1 })
      const result: LongExportResult = {
        blob,
        filename: `${options.filename}.${options.format}`,
        split: false,
        tiles: 1,
        width,
        height: Math.round(totalHeight * options.scale),
        limits,
      }
      options.signal.throwIfAborted()
      return result
    }

    const count = cuts.length - 1
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    for (let index = 0; index < count; index++) {
      options.signal.throwIfAborted()
      const top = cuts[index]
      const bottom = cuts[index + 1]
      const height = bottom - top
      const tile = document.createElement('div')
      tile.style.cssText = `width:${LONG_WIDTH}px;height:${height}px;overflow:hidden;position:relative`
      const inner = snapshot.cloneNode(true) as HTMLElement
      inner.style.position = 'absolute'
      inner.style.left = '0'
      inner.style.top = `${-top}px`
      inner.style.margin = '0'
      tile.append(inner)
      stage.append(tile)
      try {
        const blob = await shootNode(tile, LONG_WIDTH, height, options, fontEmbedCSS)
        // Checked per tile: a cancel mid-way leaves no partial ZIP behind.
        options.signal.throwIfAborted()
        zip.file(`${options.filename}-${index + 1}of${count}.${options.format}`, await blob.arrayBuffer())
      } finally {
        tile.remove()
      }
      options.onProgress?.({ phase: 'render', done: index + 1, total: count })
    }
    options.onProgress?.({ phase: 'zip', done: 0, total: 1 })
    const blob = await zip.generateAsync({ type: 'blob' })
    options.signal.throwIfAborted()
    options.onProgress?.({ phase: 'zip', done: 1, total: 1 })
    const result: LongExportResult = {
      blob,
      filename: `${options.filename}.zip`,
      split: true,
      tiles: count,
      width,
      height: Math.round(totalHeight * options.scale),
      limits,
    }
    options.signal.throwIfAborted()
    return result
  } finally {
    stage.remove()
  }
}
