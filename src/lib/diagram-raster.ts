/**
 * Mermaid -> opaque PNG, in the browser.
 *
 * WeChat strips everything an inline SVG needs to survive (class, id, <style>,
 * foreignObject), and the doocs/md sanitizer that keeps inline SVG alive needs a
 * live DOM (getComputedStyle, getBBox) this pure-string renderer cannot host. So
 * the diagram travels as an ordinary image, which the existing upload pipeline,
 * asset library and re-cropping already handle. mermaid is multi-megabyte: it is
 * imported inside the function and memoised, so nothing runs on first load.
 */

import { t } from './i18n'

/** WeChat lays the article out in a `max-width:677px` container. */
export const MAX_DIAGRAM_WIDTH = 677

/** 677 * 2 = 1354 px, sharp on every phone in circulation. */
const DEVICE_SCALE = 2

/**
 * Canvas ceiling for the raster. iOS Safari refuses canvases above ~16.7M px, so
 * a long diagram is scaled down instead of exporting blank; 1354 x 12000 = 16.25M
 * px sits just under that.
 */
const MAX_PIXEL_HEIGHT = 12000

export interface DiagramPng {
  blob: Blob
  width: number
  height: number
}

interface MermaidEngine {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string, container: Element): Promise<{ svg: string }>
}

const MERMAID_CONFIG: Record<string, unknown> = {
  startOnLoad: false,
  // render() rejects on a parse failure either way; without this it still draws
  // its red error box into our host first, and a failure has no business touching
  // pixels at all.
  suppressErrorRendering: true,
  // <text>/<tspan> labels instead of HTML ones. Measured in Chrome,
  // <foreignObject> does survive an SVG-as-image (mermaid's own HTML labels all
  // paint), so this is a quality and portability choice, not a survival
  // requirement: HTML labels come out measurably lighter (probe: 11% ink per label
  // box vs 22% as SVG text), are sized against the live DOM then re-laid-out in an
  // isolated image document, and Safari never matched Chrome's foreignObject
  // support there. Root-level htmlLabels is the v12 knob; the per-diagram copies
  // are deprecated but still read.
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false },
  // sequence has no htmlLabels: its placement defaults to "fo", which wraps every
  // actor name in a <foreignObject> inside a <switch> whose <tspan> fallback can
  // never be selected - <switch> takes the first child with no conditionals.
  sequence: { textPlacement: 'tspan' },
  // mermaid's own stack ("trebuchet ms", verdana, arial) has no CJK member, and
  // Chinese labels are the common case here.
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
}

let engine: Promise<MermaidEngine> | null = null

function loadMermaid(): Promise<MermaidEngine> {
  return (engine ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG)
    return mermaid as unknown as MermaidEngine
  }))
}

/** Intrinsic size of a rendered SVG. Pure; null when the SVG carries neither. */
export function svgNaturalSize(attrs: {
  viewBox: string | null
  width: string | null
  height: string | null
}): { width: number; height: number } | null {
  const box = (attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  if (box.length === 4 && box.slice(2).every((n) => Number.isFinite(n) && n > 0)) {
    return { width: box[2], height: box[3] }
  }
  // A percentage width is not a size, so it fails the same test.
  const px = (v: string | null) => {
    const n = Number.parseFloat(v ?? '')
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const width = px(attrs.width)
  const height = px(attrs.height)
  return width && height ? { width, height } : null
}

/**
 * Logical size (CSS px, what the article shows) and pixel size (what the canvas
 * draws at) for a diagram of a given intrinsic size. Pure.
 *
 * imageBlock lays every image out at width:100%, so the article shows the diagram
 * at the column width whatever the diagram itself measured; rasterising at the
 * diagram's own width would hand the browser a bitmap to stretch. Scaling a
 * vector costs nothing, so narrow diagrams are drawn up, wide ones down, and both
 * edges come off the same factor. Diagrams tall enough to breach the canvas
 * ceiling are the one case that shrinks below the column.
 */
export function rasterSize(width: number, height: number): {
  width: number
  height: number
  pixelWidth: number
  pixelHeight: number
} {
  let scale = MAX_DIAGRAM_WIDTH / width
  const maxHeight = MAX_PIXEL_HEIGHT / DEVICE_SCALE
  if (height * scale > maxHeight) scale = maxHeight / height
  const logicalWidth = Math.max(1, Math.round(width * scale))
  const logicalHeight = Math.max(1, Math.round(height * scale))
  return {
    width: logicalWidth,
    height: logicalHeight,
    pixelWidth: logicalWidth * DEVICE_SCALE,
    pixelHeight: logicalHeight * DEVICE_SCALE,
  }
}

let seq = 0

export async function renderDiagramPng(code: string): Promise<DiagramPng> {
  const mermaid = await loadMermaid()

  // Off-screen but still laid out: mermaid measures text with
  // getBoundingClientRect, so display:none would hand it zero-sized boxes.
  // position:fixed keeps it out of the document's scroll area.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;top:0;left:-100000px;'
  document.body.appendChild(host)
  // mermaid draws into the container we hand it but cleans up by selecting
  // "#d<id>" from the whole document, so concurrent renders must not share an id.
  const id = `reed-diagram-${++seq}`
  let markup: string
  try {
    markup = (await mermaid.render(id, code, host)).svg
  } catch (e) {
    // mermaid's parse errors dump the whole expected-token grammar; the caller
    // shows this string to the article author, who can only act on the line.
    throw new Error(String((e as Error)?.message ?? e).split('\n')[0].slice(0, 120))
  } finally {
    host.remove()
  }

  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  const natural = svgNaturalSize({
    viewBox: svg.getAttribute('viewBox'),
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
  })
  if (!natural) throw new Error(t('diagram.noSize'))
  const { width, height, pixelWidth, pixelHeight } = rasterSize(natural.width, natural.height)

  // mermaid leaves width="100%" plus a max-width style and no height, which Chrome
  // resolves to a 202x150 image: the whole diagram, thumbnail sized. The explicit
  // pixel size is what makes the raster sharp. Stripping the style is belt and
  // braces - measured, Chrome ignores max-width on an SVG-as-image root.
  svg.setAttribute('width', String(pixelWidth))
  svg.setAttribute('height', String(pixelHeight))
  svg.removeAttribute('style')

  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    // A blob URL can taint the canvas and make toBlob fail; a data URL cannot.
    img.onerror = () => reject(new Error(t('diagram.noDraw')))
  })

  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('diagram.noCanvas'))
  // Opaque white: the crop and compress paths re-encode to formats without alpha,
  // which composite transparency over black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pixelWidth, pixelHeight)
  ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('diagram.exportFailed')))), 'image/png')
  })
  return { blob, width, height }
}
