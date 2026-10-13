/**
 * Browser-side image compression for uploads.
 *
 * The loose (non-carousel) upload path in EditorPage hands the original File
 * straight to base64, so a 12 MP phone photo reaches R2 as a 3-5 MB object even
 * though the article body renders it at most 657 CSS px wide. This module
 * downscales to a pixel budget first, then walks a quality ladder until a byte
 * budget is met.
 *
 * The sizing, format and pass-through decisions are pure functions (targetSize /
 * needsMatte / pickMime / passesThrough / uploadBudget) so the rules stay
 * testable under Node, where there is no canvas. Only compressImage and
 * drawWithMatte touch the DOM.
 */

import { t } from './i18n'

/**
 * Longest edge in pixels.
 *
 * WeChat lays the article out in a `max-width:677px` container with `padding:0
 * 10px`, and body images are `width:100%`, so an image is displayed at 657 CSS
 * px at most. 657 * 3 DPR = 1971, and 2048 is the power of two that covers it —
 * the same "3x the real display size" convention `carouselFrame()` already uses
 * for `cropWidth`. Anything wider is bytes WeChat's own CDN will throw away.
 */
const DEFAULT_MAX_EDGE = 2048

/**
 * Byte budget for the encoded result.
 *
 * This is a safety net, not a routine squeeze: a 2048 px photo at quality 0.9
 * already lands around 600-900 KB, so the ladder only engages on outliers
 * (dense screenshots, noisy night shots). Keeping it loose means the common case
 * stays at 0.9 instead of being pushed into visible banding. base64 inflates the
 * payload by ~1.33x to ~1.07 MB, which is far inside the 20 MB decoded limit
 * api/storage-router.ts enforces per image.
 */
const DEFAULT_TARGET_BYTES = 800 * 1024

/** First quality tried. Just under the 0.92 image.ts uses for crops, so a
 *  compressed loose image is not visibly softer than a cropped carousel slide. */
const START_QUALITY = 0.9

/** Quality floor. Below this JPEG starts to smear text in screenshots, and the
 *  byte savings no longer justify it. */
const DEFAULT_MIN_QUALITY = 0.6

const QUALITY_STEP = 0.1

/** Encoders take a float quality; keep the ladder on exact tenths. */
function tenth(q: number): number {
  return Math.round(q * 10) / 10
}

export interface CompressOptions {
  /** Longest edge in pixels. Never upscales. Defaults to 2048. */
  maxEdge?: number
  /** Target encoded size in bytes. Drives the quality ladder. Defaults to 800 KB. */
  targetBytes?: number
  /** Quality floor for the ladder. Defaults to 0.6. */
  minQuality?: number
  /** Force an output format; without it the orientation rule in pickMime wins. */
  mime?: string
}

/**
 * The upload-size choices offered before a loose image goes up.
 *
 * 'auto' is the shipped default; '1'–'5' are byte targets in MB; 'original'
 * explicitly skips compression. Stored as `AppSettings.uploadSize` under these
 * exact string values, so they are a persistence contract, not just UI labels.
 */
export const UPLOAD_SIZE_CHOICES = ['auto', '1', '2', '3', '4', '5', 'original'] as const

export type UploadSizeChoice = (typeof UPLOAD_SIZE_CHOICES)[number]

/** Boundary check for values read back from storage (localStorage, bundles). */
export function isUploadSize(value: unknown): value is UploadSizeChoice {
  return typeof value === 'string' && (UPLOAD_SIZE_CHOICES as readonly string[]).includes(value)
}

/** Pixel + byte budget behind one non-original choice. */
export interface UploadBudget {
  maxEdge: number
  targetBytes: number
}

/**
 * Budget per size choice.
 *
 * 'auto' is the historical default, untouched. '1 MB' keeps the same 2048px
 * budget — "3x the 657px WeChat display width" — and only loosens the byte cap,
 * so it is a mild choice for photos already inside the pixel budget.
 *
 * From 2 MB up the pixel budget grows 512px per step instead of staying at
 * 2048: at 2048px even a quality-1.0 encode of a dense photo rarely reaches
 * 2 MB, so a byte cap alone would make the larger numbers identical to `auto`
 * and therefore meaningless. Raising both budgets is what gives every tier a
 * distinct result; the byte target stays an upper bound (smaller sources are
 * passed through, never padded up to it).
 *
 * 4096 is the cap: a 12MP phone photo (4032px long edge) keeps essentially all
 * its pixels, while a panorama's 10000px original — which no reader will ever
 * see at full size — is still refused. `original` remains the explicit way to
 * upload the file byte-for-byte.
 */
const UPLOAD_BUDGETS: Record<Exclude<UploadSizeChoice, 'original'>, UploadBudget> = {
  auto: { maxEdge: DEFAULT_MAX_EDGE, targetBytes: DEFAULT_TARGET_BYTES },
  '1': { maxEdge: 2048, targetBytes: 1 * 1024 * 1024 },
  '2': { maxEdge: 2560, targetBytes: 2 * 1024 * 1024 },
  '3': { maxEdge: 3072, targetBytes: 3 * 1024 * 1024 },
  '4': { maxEdge: 3584, targetBytes: 4 * 1024 * 1024 },
  '5': { maxEdge: 4096, targetBytes: 5 * 1024 * 1024 },
}

/**
 * Budget for a size choice. Pure.
 *
 * `null` means "skip compression entirely" ('original'). Unknown values fall
 * back to the auto budget, so a bundle or an edited localStorage entry can
 * never blow up an upload.
 */
export function uploadBudget(size: UploadSizeChoice): UploadBudget | null {
  if (size === 'original') return null
  const budgets = UPLOAD_BUDGETS as Record<string, UploadBudget | undefined>
  return budgets[size] ?? UPLOAD_BUDGETS.auto
}

export interface CompressedImage {
  /** The encoded result. When `grew` is set the caller should prefer its
   *  original blob instead — this stays the compressed one so the numbers below
   *  keep describing what compression actually achieved. */
  blob: Blob
  mime: string
  width: number
  height: number
  /** Original size in bytes, so the UI can report "X MB -> Y KB". */
  sourceBytes: number
  bytes: number
  /** The quality the result was encoded at. 1 is the sentinel for "the source
   *  blob was handed back untouched, nothing was re-encoded". */
  quality: number
  /** True when the output is smaller in pixels than the source. False both for
   *  a pass-through and for an image already inside the pixel budget. */
  scaled: boolean
  /** True when compression produced something no smaller than the source.
   *  Common for icons and flat-colour screenshots; the caller should use the
   *  original file in that case. */
  grew: boolean
}

/**
 * Output size for a downscale. Pure, so the sizing rules are testable outside a
 * browser.
 *
 * Same "the source pixels are the hard limit" principle as `manualOutputSize()`
 * in image.ts: a smaller image keeps its own size rather than being stretched.
 */
export function targetSize(
  width: number,
  height: number,
  opts?: { maxEdge?: number },
): { width: number; height: number; scaled: boolean } {
  const maxEdge = opts?.maxEdge ?? DEFAULT_MAX_EDGE
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scaled: false }

  const scale = maxEdge / longest
  // Math.max(1, ...): a very thin source would otherwise round to 0 px on the
  // short edge, which is not a drawable canvas.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  }
}

/**
 * Whether the output format needs an opaque backdrop laid down first. Pure.
 *
 * JPEG carries no alpha channel, and the HTML spec requires a canvas with
 * transparency to be composited over BLACK when it is serialised to a format
 * without alpha. Every engine does this (Chromium's tracker closes the reports
 * as spec-correct), so without a matte a transparent PNG exported as JPEG comes
 * out on a black background. WebP and PNG both keep alpha, so they need none.
 */
export function needsMatte(mime: string): boolean {
  return mime === 'image/jpeg'
}

/**
 * Output format for a given size and source type. Pure.
 *
 * Follows image.ts's `preferredMime()`: portrait frames read better as JPEG,
 * everything else as WebP. `sourceType` exists so formats that a canvas cannot
 * survive — animation and vectors — are named as pass-through rather than
 * silently re-encoded.
 */
export function pickMime(width: number, height: number, sourceType?: string): string {
  if (sourceType === 'image/gif' || sourceType === 'image/svg+xml') return sourceType
  return height > width ? 'image/jpeg' : 'image/webp'
}

/**
 * Whether a source is handed back without a canvas pass. Pure.
 *
 * Two reasons, and only two:
 * - GIF and SVG, which a canvas would flatten to a first frame or rasterise
 * - a JPEG or WebP that is already inside both the pixel budget and the byte
 *   budget, where re-encoding would spend quality to save nothing
 *
 * Pulled out of compressImage so the pass-through rules stay testable in Node,
 * which is also what pins the upload-size tiers to them: no tier may push an
 * animated GIF, a vector, or an already-small lossy image through a canvas.
 */
export function passesThrough(
  sourceType: string,
  opts: { scaled: boolean; sourceBytes: number; targetBytes: number },
): boolean {
  if (sourceType === 'image/gif' || sourceType === 'image/svg+xml') return true
  const alreadyEncoded = sourceType === 'image/jpeg' || sourceType === 'image/webp'
  return !opts.scaled && alreadyEncoded && opts.sourceBytes <= opts.targetBytes
}

/**
 * Draw one source rectangle into a destination rectangle, laying down a white
 * backdrop first when the target format cannot carry alpha.
 *
 * Exported on its own so image.ts's `renderCrop()` can share the fix: it is the
 * crop path that currently turns a portrait transparent PNG black, and it needs
 * this exact backdrop rather than a second copy of the rule.
 */
export function drawWithMatte(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mime: string,
): void {
  if (needsMatte(mime)) {
    // save/restore so the caller's fillStyle survives: this lands inside an
    // existing drawing routine that does not expect its state to be clobbered.
    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(dx, dy, dw, dh)
    ctx.restore()
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

/**
 * Decode through `new Image()`, mirroring image.ts's private loadImage.
 *
 * Browsers apply EXIF orientation when decoding for rendering —
 * `image-orientation: from-image` has been the CSS initial value since Chrome 81
 * / Safari 13.1 / Firefox 77 — and drawImage reads those corrected pixels, so a
 * compressed photo comes out the same way up as a cropped one.
 * `createImageBitmap(file, { imageOrientation: 'from-image' })` would be correct
 * too, but reusing this loader is what makes it impossible for the crop path and
 * the compress path to disagree about orientation, and it needs no feature
 * detection for ImageBitmapOptions.
 */
async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(t('img.decodeFailed')))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('img.compressExportFailed')))),
      mime,
      quality,
    )
  })
}

/**
 * Downscale and re-encode an image for upload.
 *
 * Two ways out do no re-encoding at all, because re-encoding always costs
 * quality and sometimes costs bytes:
 * - GIF and SVG, which a canvas would flatten to a first frame or rasterise
 * - a JPEG or WebP that is already inside both budgets
 *
 * When the encode comes out no smaller than the source, `grew` is set and the
 * caller should upload its original blob.
 */
export async function compressImage(
  file: Blob,
  opts?: CompressOptions,
): Promise<CompressedImage> {
  // A programmer-error boundary: without a DOM there is nothing to draw into, so
  // say so instead of leaking an incidental "document is not defined" from the
  // first canvas touch. Note Node 24 does define URL.createObjectURL, so
  // `document` is the global that actually distinguishes the two environments.
  if (typeof document === 'undefined') {
    throw new Error(
      'compressImage needs a browser DOM (Image, canvas, URL.createObjectURL); it cannot run under Node',
    )
  }

  const targetBytes = opts?.targetBytes ?? DEFAULT_TARGET_BYTES
  const minQuality = opts?.minQuality ?? DEFAULT_MIN_QUALITY
  const sourceBytes = file.size
  const sourceType = file.type

  const img = await loadImage(file)
  const sourceWidth = img.naturalWidth
  const sourceHeight = img.naturalHeight
  const { width, height, scaled } = targetSize(sourceWidth, sourceHeight, {
    maxEdge: opts?.maxEdge,
  })

  const untouched = (mime: string): CompressedImage => ({
    blob: file,
    mime,
    width: sourceWidth,
    height: sourceHeight,
    sourceBytes,
    bytes: sourceBytes,
    quality: 1,
    scaled: false,
    grew: false,
  })

  // Animation, vectors, and lossy rasters already inside both budgets: hand the
  // original back (see passesThrough for the two reasons).
  if (passesThrough(sourceType, { scaled, sourceBytes, targetBytes })) return untouched(sourceType)

  const mime = opts?.mime ?? pickMime(width, height, sourceType)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('img.noCanvasCompress'))
  ctx.imageSmoothingQuality = 'high'
  drawWithMatte(ctx, img, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height, mime)

  // The pixels are fixed once drawn, so the ladder re-encodes the same canvas at
  // a lower quality rather than redrawing. Both JPEG and WebP encoders are
  // monotonic in quality, so the first encode inside the budget is also the
  // highest-quality one that fits.
  let quality = START_QUALITY
  let blob = await canvasToBlob(canvas, mime, quality)
  const floor = Math.min(minQuality, START_QUALITY)
  while (blob.size > targetBytes && tenth(quality - QUALITY_STEP) >= floor - 1e-9) {
    quality = tenth(quality - QUALITY_STEP)
    blob = await canvasToBlob(canvas, mime, quality)
  }

  return {
    blob,
    // Safari cannot encode WebP and falls back to PNG per spec; blob.type is what
    // actually got written, so trust it over what we asked for. The matte
    // decision stays correct either way, because it was made from the requested
    // mime: a WebP request drew no matte, and a PNG fallback keeps alpha.
    mime: blob.type || mime,
    width,
    height,
    sourceBytes,
    bytes: blob.size,
    quality,
    scaled,
    // >= rather than >: an exact tie bought nothing and cost quality, so prefer
    // the original.
    grew: blob.size >= sourceBytes,
  }
}
