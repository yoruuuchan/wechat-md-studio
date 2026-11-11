// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import {
  CARD_FONT_SHEETS, CARD_TEMPLATE_FONTS, CARD_WIDTH, type CardFontFace, type CardTemplate, type CardTemplateId,
} from './cards'
import { t } from './i18n'

/** Faces the embedder should keep, plus package faces that need no fetch. */
export interface CardFontEmbedSpec {
  faces: readonly CardFontFace[]
  /** @font-face rules with data: URLs, built from the template archive. */
  packageCss?: string
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Embed the exact displayed bytes before measuring, so export cannot drop a picture. */
export async function prepareCardImages(root: HTMLElement, signal: AbortSignal): Promise<string[]> {
  const failed = new Set<string>()
  await Promise.all(Array.from(root.querySelectorAll('img')).map(async (img) => {
    const src = img.src
    try {
      if (!src.startsWith('data:image/')) {
        const response = await fetch(src, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          credentials: new URL(src).origin === location.origin ? 'same-origin' : 'omit',
        })
        if (!response.ok) throw new Error(`image: HTTP ${response.status}`)
        const blob = await response.blob()
        img.src = await blobDataUrl(blob)
      }
      await img.decode()
      signal.throwIfAborted()
      img.width = img.naturalWidth
      img.height = img.naturalHeight
    } catch {
      signal.throwIfAborted()
      img.src = src
      failed.add(src)
    }
  }))
  return [...failed]
}

/** Google-style slices are selected by glyph, including punctuation and non-BMP text. */
export function rangeContainsText(range: string, text: string): boolean {
  if (!range.trim()) return true
  const intervals = range.split(',').map((part) => {
    const value = part.trim().replace(/^U\+/i, '')
    if (value.includes('?')) return [parseInt(value.replace(/\?/g, '0'), 16), parseInt(value.replace(/\?/g, 'f'), 16)]
    const [lo, hi = lo] = value.split('-')
    return [parseInt(lo, 16), parseInt(hi, 16)]
  })
  return Array.from(text).some((char) => {
    const code = char.codePointAt(0)!
    return intervals.some(([lo, hi]) => code >= lo && code <= hi)
  })
}

const fontBytes = new Map<string, Promise<string>>()
async function fontDataUrl(url: string): Promise<string> {
  let pending = fontBytes.get(url)
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`font: HTTP ${response.status}`)
      return blobDataUrl(await response.blob())
    }).catch((error) => {
      fontBytes.delete(url)
      throw error
    })
    fontBytes.set(url, pending)
  }
  return pending
}

/**
 * html-to-image's skipFonts loses CJK webfonts. Its automatic embedding also
 * fetches hundreds of unused CJK slices. Embed the faces declared by the
 * current card template for the actual glyphs instead, preserving
 * unicode-range and family ordering.
 */
export async function cardFontCss(
  text: string,
  source: CardTemplateId | CardFontEmbedSpec = 'reed',
): Promise<string> {
  const spec: CardFontEmbedSpec = typeof source === 'string'
    ? { faces: CARD_TEMPLATE_FONTS[source as CardTemplate] ?? [] }
    : source
  const declared = spec.faces
  const wanted = (family: string, weight: string, style: string) => declared.some((face) =>
    face.family === family &&
    face.weights.includes(Number(weight)) &&
    (face.styles ?? ['normal']).includes(style as 'normal' | 'italic'),
  )
  if (!declared.length) return spec.packageCss ?? ''
  const rules = await Promise.all(CARD_FONT_SHEETS.map(async (path) => {
    const url = new URL(path, location.href)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`font CSS: HTTP ${response.status}`)
    const css = await response.text()
    return Promise.all([...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(async ([rule, body]) => {
      const family = body.match(/font-family:\s*['"]?([^;'"\n]+)/)?.[1].trim()
      const weight = body.match(/font-weight:\s*([^;]+)/)?.[1].trim() ?? '400'
      const style = body.match(/font-style:\s*([^;]+)/)?.[1].trim() ?? 'normal'
      const range = body.match(/unicode-range:\s*([^;]+)/)?.[1] ?? ''
      if (!family || !wanted(family, weight, style) || !rangeContainsText(range, text)) return ''
      const src = body.match(/url\(([^)]+)\)/)?.[1].replace(/['"]/g, '')
      if (!src) throw new Error('font face has no source')
      const data = await fontDataUrl(new URL(src, url).href)
      return rule.replace(/url\([^)]+\)/, `url("${data}")`)
    }))
  }))
  return [...rules.flat().filter(Boolean), spec.packageCss ?? ''].filter(Boolean).join('\n')
}

const EXACT_FONT_SIZE = '--xhs-export-font-size'

/**
 * html-to-image rewrites every font-size to `floor(size) - 0.1px` while it
 * clones. At 17–18px that 0.6% shave moves CJK line breaks away from the
 * preview. Mark the frozen cards with their exact computed size; a temporary
 * setProperty patch below substitutes that value during the clone, after every
 * other computed property (margins in em, line-height, ...) came from the
 * untouched original.
 */
export function markExactFontSizes(nodes: HTMLElement[], snapshots: HTMLElement[]): void {
  const visit = (source: Element, target: Element) => {
    const styled = target as HTMLElement | SVGElement
    styled.style.setProperty(EXACT_FONT_SIZE, getComputedStyle(source).fontSize)
    const sources = source.children
    const targets = target.children
    for (let i = 0; i < sources.length && i < targets.length; i++) visit(sources[i], targets[i])
  }
  nodes.forEach((node, index) => visit(node, snapshots[index]))
}

export async function toBlobWithExactFonts(
  toBlob: (node: HTMLElement, options: Record<string, unknown>) => Promise<Blob | null>,
  node: HTMLElement,
  options: Record<string, unknown>,
): Promise<Blob | null> {
  const original = CSSStyleDeclaration.prototype.setProperty
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    if (name === 'font-size') {
      const exact = this.getPropertyValue(EXACT_FONT_SIZE)
      if (exact) return original.call(this, name, exact, priority)
    }
    return original.call(this, name, value, priority)
  }
  try {
    return await toBlob(node, options)
  } finally {
    CSSStyleDeclaration.prototype.setProperty = original
  }
}

/** Freeze the cards, so editing or switching panes during ZIP export is safe. */
export async function createCardExporter(
  nodes: HTMLElement[],
  source: CardTemplateId | CardFontEmbedSpec = 'reed',
) {
  const stage = document.createElement('div')
  stage.setAttribute('aria-hidden', 'true')
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
  const snapshots = nodes.map((node) => node.cloneNode(true) as HTMLElement)
  stage.append(...snapshots)
  document.body.append(stage)
  markExactFontSizes(nodes, snapshots)
  try {
    const fontEmbedCSS = await cardFontCss(stage.textContent ?? '', source)
    await document.fonts.ready
    const { toBlob } = await import('html-to-image')
    return {
      async shoot(index: number): Promise<Blob> {
        const node = snapshots[index]
        const height = Number.parseInt(node.style.height)
        const options = { width: CARD_WIDTH, height, pixelRatio: 2, fontEmbedCSS, skipAutoScale: true }
        const blob = await toBlobWithExactFonts(toBlob, node, options)
        if (!blob) throw new Error(t('cards.exportFailed'))
        return blob
      },
      dispose: () => stage.remove(),
    }
  } catch (error) {
    stage.remove()
    throw error
  }
}

export function downloadCardBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
