// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import { ensureFontSheets } from './font-catalog'

export const CARD_WIDTH = 540
export const CARD_RATIOS = { '3:4': 720, '1:1': 540, '9:16': 960 } as const
export type CardRatio = keyof typeof CARD_RATIOS

/**
 * A card template is a layout system, not a paint job. Each one owns its
 * variants (background ids), metrics and webfont declaration; switching
 * template swaps the background to the first variant of the new template.
 */
export const CARD_TEMPLATES = ['reed'] as const
export type CardTemplate = typeof CARD_TEMPLATES[number]
export type CardTemplateId = string

export const CARD_TEMPLATE_VARIANTS = {
  reed: ['paper', 'white', 'grid', 'tint', 'night'],
} as const satisfies Record<CardTemplate, readonly string[]>

/** Reed's original background ids, kept for callers that only speak old API. */
export const CARD_BACKGROUNDS = CARD_TEMPLATE_VARIANTS.reed
export type CardBackground = string
export interface CardOptions { ratio: CardRatio; template: CardTemplateId; background: CardBackground }

export function templateVariants(template: CardTemplateId): readonly CardBackground[] {
  return customCardTemplateRuntime(template)?.variants.map((variant) => variant.id) ??
    (CARD_TEMPLATE_VARIANTS as Record<string, readonly string[]>)[template] ?? []
}

export function defaultVariant(template: CardTemplateId): CardBackground {
  return templateVariants(template)[0] ?? 'paper'
}

/**
 * Reed accepts all three ratios. Uploaded templates always declare their own
 * set; this is the built-in fallback.
 */
export function templateRatios(template: CardTemplateId): readonly CardRatio[] {
  return customCardTemplateRuntime(template)?.ratios ?? ['3:4', '1:1', '9:16']
}

/** Ratio and variant survive a template switch; the variant becomes the new first one. */
export function withTemplate(options: CardOptions, template: CardTemplateId): CardOptions {
  const ratio = templateRatios(template).includes(options.ratio) ? options.ratio : templateRatios(template)[0]
  return { ratio, template, background: defaultVariant(template) }
}

/** Ratios that must switch the whole card to dark paper. */
export function isDarkVariant(template: CardTemplateId, background: CardBackground): boolean {
  const custom = customCardTemplateRuntime(template)
  if (custom) return custom.variants.find((variant) => variant.id === background)?.dark ?? false
  return template === 'reed' && background === 'night'
}

/** Reed keeps the article theme's accent; uploaded templates own their accent. */
export function cardAccent(template: CardTemplateId, background: CardBackground, fallback: string): string {
  const custom = customCardTemplateRuntime(template)
  if (custom) return custom.variants.find((variant) => variant.id === background)?.accent || fallback
  return fallback
}

/** Measurements a long template declares for the shared photo-row engine. */
export interface LongImageMetrics {
  padX: number
  contentWidth: number
  photoGap: number
  photoInset: number
}

export interface CardMeasurements {
  padX: number
  /** Top of the article body, i.e. space reserved for the masthead. */
  padTop: number
  /** Space kept below the body for the footer and page number. */
  padBottom: number
  contentWidth: number
  headerTop: number
  footerBottom: number
  coverInsetX: number
  coverInsetY: number
  coverFootBottom: number
  /** Title block height is fitted to `height - coverReserve`. */
  coverReserve: number
  coverTitleSize: readonly [number, number, number, number, number]
  coverSmallScale: number
}

/**
 * One measurement table shared by pagination, the DOM/CSS shell and the cover
 * fitter. Reed's row is byte-for-byte the old hardcoded behavior.
 */
export const CARD_METRICS: Record<CardTemplate, CardMeasurements> = {
  reed: {
    padX: 40, padTop: 52, padBottom: 76, contentWidth: 460,
    headerTop: 22, footerBottom: 26,
    coverInsetX: 48, coverInsetY: 56, coverFootBottom: 40, coverReserve: 156,
    coverTitleSize: [56, 48, 42, 36, 30], coverSmallScale: 0.86,
  },
}

export function cardMetrics(template: CardTemplateId): CardMeasurements {
  return customCardTemplateRuntime(template)?.metrics ?? CARD_METRICS[template as CardTemplate] ?? CARD_METRICS.reed
}

export interface CardFontFace {
  family: string
  weights: readonly number[]
  styles?: readonly ('normal' | 'italic')[]
}

/** Read by both the pagination preloader and the PNG font embedder. */
export const CARD_TEMPLATE_FONTS: Record<CardTemplate, readonly CardFontFace[]> = {
  reed: [
    { family: 'Geist', weights: [400, 700] },
    { family: 'Geist Mono', weights: [400, 700] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
}

/** Colour and font slots a reader may change (manifest `customize`). */
export interface TemplateCustomizeRuntime {
  colors: readonly { var: string; name: string }[]
  fonts: readonly { var: string; name: string }[]
}

const NO_CUSTOMIZE: TemplateCustomizeRuntime = { colors: [], fonts: [] }

export interface CardTemplateVariantRuntime {
  id: string
  name: string
  /** Fixed accent for this variant; empty means the article theme supplies it. */
  accent?: string
  dark: boolean
}

/**
 * An uploaded template, flattened to the few measurements and font faces the
 * shared pagination / cover fitter needs. Built-in templates never enter this
 * map; their rows stay the single source for their pixel-identical output.
 */
export interface CardTemplateRuntime {
  template: CardTemplateId
  name: string
  variants: readonly CardTemplateVariantRuntime[]
  ratios: readonly CardRatio[]
  metrics: CardMeasurements
  fonts: readonly CardFontFace[]
  customize?: TemplateCustomizeRuntime
}

/** An uploaded long template, flattened for the shared long-image engine. */
export interface LongTemplateRuntime {
  kind: 'long'
  template: CardTemplateId
  name: string
  variants: readonly CardTemplateVariantRuntime[]
  metrics: LongImageMetrics
  fonts: readonly CardFontFace[]
  customize?: TemplateCustomizeRuntime
}

const CUSTOM_TEMPLATE_RUNTIMES = new Map<CardTemplateId, CardTemplateRuntime>()
const LONG_TEMPLATE_RUNTIMES = new Map<CardTemplateId, LongTemplateRuntime>()

export function isBuiltinCardTemplate(template: CardTemplateId): template is CardTemplate {
  return (CARD_TEMPLATES as readonly string[]).includes(template)
}

export function registerCardTemplateRuntime(runtime: CardTemplateRuntime): void {
  CUSTOM_TEMPLATE_RUNTIMES.set(runtime.template, runtime)
}

export function unregisterCardTemplateRuntime(template: CardTemplateId): void {
  CUSTOM_TEMPLATE_RUNTIMES.delete(template)
}

export function customCardTemplateRuntime(template: CardTemplateId): CardTemplateRuntime | undefined {
  return CUSTOM_TEMPLATE_RUNTIMES.get(template)
}

export function registerLongTemplateRuntime(runtime: LongTemplateRuntime): void {
  LONG_TEMPLATE_RUNTIMES.set(runtime.template, runtime)
}

export function unregisterLongTemplateRuntime(template: CardTemplateId): void {
  LONG_TEMPLATE_RUNTIMES.delete(template)
}

export function longTemplateRuntime(template: CardTemplateId): LongTemplateRuntime | undefined {
  return LONG_TEMPLATE_RUNTIMES.get(template)
}

/** Long templates have the same variant rules as cards, without ratios. */
export function longTemplateVariants(template: CardTemplateId): readonly CardBackground[] {
  return longTemplateRuntime(template)?.variants.map((variant) => variant.id) ?? []
}

export function longTemplateFonts(template: CardTemplateId): readonly CardFontFace[] {
  return longTemplateRuntime(template)?.fonts ?? []
}

/**
 * Reed's built-in card reads these from src/components/cards.css. Its slot
 * names are i18n keys (the settings panel translates them); package slots
 * carry the template author's own words.
 */
const BUILTIN_CUSTOMIZE: Record<CardTemplate, TemplateCustomizeRuntime> = {
  reed: {
    colors: [{ var: '--xhs-accent', name: 'customize.slot.accent' }],
    fonts: [{ var: '--font-ui', name: 'customize.slot.font' }],
  },
}

export function cardTemplateCustomize(template: CardTemplateId): TemplateCustomizeRuntime {
  return customCardTemplateRuntime(template)?.customize ??
    BUILTIN_CUSTOMIZE[template as CardTemplate] ?? NO_CUSTOMIZE
}

export function longTemplateCustomize(template: CardTemplateId): TemplateCustomizeRuntime {
  return longTemplateRuntime(template)?.customize ?? NO_CUSTOMIZE
}

/** The face list shared by pagination preload and PNG embedding. */
export function cardTemplateFonts(template: CardTemplateId): readonly CardFontFace[] {
  return customCardTemplateRuntime(template)?.fonts ?? CARD_TEMPLATE_FONTS[template as CardTemplate] ?? []
}

/**
 * The built-in families an uploaded manifest may reference by name.
 *
 * This registry is deliberately wider than Reed's own row: packages converted
 * from the retired design-system cards still reference these families, and the
 * font files and @font-face sheets stay in the repository. Removing the card
 * templates must not make those packages fail `font-not-builtin`.
 */
export const BUILTIN_CARD_FONT_FACES: ReadonlyMap<string, CardFontFace> = new Map<string, CardFontFace>([
  ['Geist', { family: 'Geist', weights: [400, 700] }],
  ['Geist Mono', { family: 'Geist Mono', weights: [400, 700] }],
  ['Noto Sans SC', { family: 'Noto Sans SC', weights: [400, 700] }],
  // A separate family, so existing 800/900 text in Noto Sans SC keeps its 700 face.
  ['Noto Sans SC Black', { family: 'Noto Sans SC Black', weights: [900] }],
  ['Noto Serif SC', { family: 'Noto Serif SC', weights: [400, 700] }],
  ['Zhuque Fangsong', { family: 'Zhuque Fangsong', weights: [400] }],
  ['Inter', { family: 'Inter', weights: [400, 600] }],
  ['JetBrains Mono', { family: 'JetBrains Mono', weights: [400, 700] }],
  ['EB Garamond', { family: 'EB Garamond', weights: [400, 600], styles: ['normal', 'italic'] }],
  ['IBM Plex Sans', { family: 'IBM Plex Sans', weights: [400, 500] }],
  ['IBM Plex Mono', { family: 'IBM Plex Mono', weights: [400] }],
  ['Caveat', { family: 'Caveat', weights: [400] }],
  ['Orbitron', { family: 'Orbitron', weights: [500, 700, 900] }],
  ['VT323', { family: 'VT323', weights: [400] }],
  ['Space Grotesk', { family: 'Space Grotesk', weights: [300, 400, 500, 600, 700] }],
  ['DM Serif Display', { family: 'DM Serif Display', weights: [400], styles: ['italic'] }],
  ['Rajdhani', { family: 'Rajdhani', weights: [400, 500, 600, 700] }],
  ['Share Tech Mono', { family: 'Share Tech Mono', weights: [400] }],
  ['Pixelify Sans', { family: 'Pixelify Sans', weights: [400, 500, 600, 700] }],
  ['Tinos', { family: 'Tinos', weights: [400, 700], styles: ['normal', 'italic'] }],
  ['Instrument Sans', { family: 'Instrument Sans', weights: [400, 500, 700] }],
  ['B612 Mono', { family: 'B612 Mono', weights: [400, 700] }],
  // Reader-selectable Chinese faces (font-catalog.ts); single weight each.
  ['LXGW WenKai', { family: 'LXGW WenKai', weights: [400] }],
  ['Smiley Sans', { family: 'Smiley Sans', weights: [400] }],
  ['ZCOOL XiaoWei', { family: 'ZCOOL XiaoWei', weights: [400] }],
  ['ZCOOL QingKe HuangYou', { family: 'ZCOOL QingKe HuangYou', weights: [400] }],
  ['ZCOOL KuaiLe', { family: 'ZCOOL KuaiLe', weights: [400] }],
  ['Ma Shan Zheng', { family: 'Ma Shan Zheng', weights: [400] }],
])

/** The CSS files that declare the faces above. */
export const CARD_FONT_SHEETS = [
  '/fonts/fonts-local.css',
  '/fonts/noto-sans-sc-local.css',
  '/fonts/fonts-templates.css',
  '/fonts/fonts-design.css',
  '/fonts/zhuque-fangsong.css',
  '/fonts/noto-sans-sc-black.css',
  '/fonts/lxgw-wenkai.css',
  '/fonts/smiley-sans.css',
  '/fonts/zcool-xiaowei.css',
  '/fonts/zcool-qingke-huangyou.css',
  '/fonts/zcool-kuaile.css',
  '/fonts/ma-shan-zheng.css',
] as const

const CN_DIGIT = '〇一二三四五六七八九'
export function chinesePageNumber(n: number): string {
  return String(n).padStart(2, '0').split('').map((d) => CN_DIGIT[Number(d)] ?? d).join('')
}

// Legacy aliases: Reed's row in CARD_METRICS is the single source, these keep
// older imports (and the existing tests) working without a second table.
export const CARD_PAD_X = CARD_METRICS.reed.padX
export const CARD_PAD_TOP = CARD_METRICS.reed.padTop
export const CARD_PAD_BOTTOM = CARD_METRICS.reed.padBottom

export type CardPage =
  | { kind: 'cover'; title: string; subtitle: string }
  | { kind: 'body'; html: string }

interface Shell { outer: HTMLElement; inner: HTMLElement }
interface Splitter { units: Node[]; shell: () => Shell }

/** Slice the text across inline boundaries, retaining emphasis and hard breaks. */
function tokenize(el: HTMLElement): Node[] {
  const text = el.textContent ?? ''
  const texts: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  if (!texts.length) return Array.from(el.childNodes).map((node) => node.cloneNode(true))
  const boundaries: number[] = [0]
  for (const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+/gu) ?? []) {
    // An unpunctuated sentence must still fit on an otherwise empty page.
    const chars = Array.from(sentence)
    for (let i = 0; i < chars.length; i += 40) {
      boundaries.push(boundaries[boundaries.length - 1] + chars.slice(i, i + 40).join('').length)
    }
  }
  const point = (offset: number): [Text, number] => {
    for (const node of texts) {
      if (offset <= node.length) return [node, offset]
      offset -= node.length
    }
    const last = texts[texts.length - 1]
    return [last, last.length]
  }
  return boundaries.slice(1).map((end, i) => {
    const range = document.createRange()
    if (i === 0) range.setStart(el, 0)
    else range.setStart(...point(boundaries[i]))
    if (i === boundaries.length - 2) range.setEnd(el, el.childNodes.length)
    else range.setEnd(...point(end))
    let fragment = range.cloneContents()
    // cloneContents omits the common ancestor itself. A slice entirely
    // inside <strong> still needs that wrapper on the next page.
    let ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode
    while (ancestor && ancestor !== el) {
      const wrapper = ancestor.cloneNode(false)
      wrapper.appendChild(fragment)
      fragment = document.createDocumentFragment()
      fragment.append(wrapper)
      ancestor = ancestor.parentNode
    }
    return fragment
  })
}

function splitter(block: HTMLElement): Splitter | null {
  const flat = (): Shell => {
    const outer = block.cloneNode(false) as HTMLElement
    return { outer, inner: outer }
  }
  if (block.matches('p')) return { units: tokenize(block), shell: flat }
  if (block.matches('ul, ol')) return { units: Array.from(block.children), shell: flat }
  if (block.matches('blockquote')) {
    const children = Array.from(block.children) as HTMLElement[]
    if (children.length === 1 && children[0].matches('p')) {
      return {
        units: tokenize(children[0]),
        shell: () => {
          const outer = block.cloneNode(false) as HTMLElement
          const inner = children[0].cloneNode(false) as HTMLElement
          outer.append(inner)
          return { outer, inner }
        },
      }
    }
    return { units: children, shell: flat }
  }
  if (block.matches('pre')) {
    const code = block.querySelector('code')
    if (!code) return null
    return {
      units: (code.textContent?.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => document.createTextNode(line)),
      shell: () => {
        const outer = block.cloneNode(false) as HTMLElement
        const inner = code.cloneNode(false) as HTMLElement
        outer.append(inner)
        return { outer, inner }
      },
    }
  }
  if (block.matches('table')) {
    const body = block.querySelector('tbody')
    if (!body) return null
    return {
      units: Array.from(body.children),
      shell: () => {
        const outer = block.cloneNode(false) as HTMLElement
        const head = block.querySelector('thead')
        if (head) outer.append(head.cloneNode(true))
        const inner = body.cloneNode(false) as HTMLElement
        outer.append(inner)
        return { outer, inner }
      },
    }
  }
  return null
}

/**
 * Measure in the browser using exactly the final body's CSS and width.
 * `measure` is a layout adapter for unit tests; Chrome acceptance uses real layout.
 * The input article is owned by the caller and may be consumed.
 */
export async function paginateCards(article: HTMLElement, options: {
  height: number
  template?: CardTemplateId
  signal?: AbortSignal
  measure?: (page: HTMLElement) => number
  /** Faces picked by the reader on top of the template's own (template-custom.ts). */
  extraFaces?: readonly CardFontFace[]
}): Promise<{ pages: CardPage[]; scaledBlocks: number }> {
  const { height, signal } = options
  const template = options.template ?? article.dataset.template ?? 'reed'
  const metrics = cardMetrics(template)
  const measure = options.measure ?? ((el) => el.getBoundingClientRect().height)
  const maxHeight = height - metrics.padTop - metrics.padBottom
  const pages: CardPage[] = []
  const blocks = Array.from(article.children) as HTMLElement[]
  const coverIndex = blocks.findIndex((block) => block.tagName === 'H1')
  if (coverIndex >= 0) {
    const [heading] = blocks.splice(coverIndex, 1)
    const title = heading.textContent?.trim() ?? ''
    let subtitle = ''
    const next = blocks[coverIndex]
    if (next?.matches('p') && (next.textContent?.trim().length ?? 0) <= 60 && !next.querySelector('img')) {
      subtitle = next.textContent?.trim() ?? ''
      blocks.splice(coverIndex, 1)
    }
    pages.push({ kind: 'cover', title, subtitle })
  }

  const host = document.createElement('div')
  host.className = 'xhs-measure'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none'
  document.body.append(host)
  let scaledBlocks = 0
  /**
   * The hidden body is a clone of the article root, so it keeps the same
   * `data-template` / `data-card-template-source` attributes and the variables
   * declared on `.xhs-body`. Uploaded CSS is scoped to that attribute, which is
   * what lets measurement and the preview resolve the same body rules.
   */
  const newPage = () => {
    const el = article.cloneNode(false) as HTMLElement
    host.replaceChildren(el)
    return el
  }
  let page = newPage()
  const fits = () => measure(page) <= maxHeight + 0.5
  const flush = (carryHeading = false) => {
    const carry: Element[] = []
    if (carryHeading) {
      while (page.children.length > 1 && page.lastElementChild?.matches('h1,h2,h3')) {
        carry.unshift(page.lastElementChild)
        page.lastElementChild.remove()
      }
    }
    if (page.children.length) pages.push({ kind: 'body', html: page.outerHTML })
    page = newPage()
    page.append(...carry)
  }
  const fitAtomic = (block: HTMLElement) => {
    // An indivisible item (e.g. a very tall table row) is reduced visibly as a
    // last resort, with a notice in the UI. Never clip or silently omit content.
    block.remove()
    const available = Math.max(1, maxHeight - measure(page) - 4)
    const holder = document.createElement('div')
    holder.style.display = 'flow-root'
    const content = document.createElement('div')
    content.style.cssText = `display:flow-root;width:${metrics.contentWidth}px`
    content.append(block)
    holder.append(content)
    page.append(holder)
    const natural = measure(content)
    const scale = Math.min(1, available / Math.max(1, natural))
    holder.style.height = `${natural * scale}px`
    content.style.transform = `scale(${scale})`
    content.style.transformOrigin = 'top left'
    scaledBlocks++
  }

  try {
    // Hidden DOM still participates in font selection. Explicit loads also
    // cover the bold title and footer, which are outside this article.
    host.append(article)
    if (document.fonts) {
      const text = article.textContent ?? ''
      const faces = [...cardTemplateFonts(template), ...(options.extraFaces ?? [])]
      await ensureFontSheets(faces.map((face) => face.family))
      await Promise.all(faces.flatMap(({ family, weights, styles }) =>
        weights.flatMap((weight) => (styles ?? ['normal']).map((style) =>
          document.fonts.load(`${style === 'italic' ? 'italic ' : ''}${weight} 18px "${family}"`, text),
        )),
      ))
      await document.fonts.ready
    }
    signal?.throwIfAborted()
    article.remove()
    for (const block of blocks) {
      signal?.throwIfAborted()
      if (block.hasAttribute('data-card-break')) {
        flush()
        continue
      }
      page.append(block)
      if (fits()) continue
      block.remove()
      const split = splitter(block)
      if (!split || split.units.length < 2) {
        if (page.children.length) flush(true)
        page.append(block)
        if (!fits()) fitAtomic(block)
        continue
      }

      let piece: Shell | null = null
      const start = (): Shell => {
        const shell = split.shell()
        page.append(shell.outer)
        return shell
      }
      for (const unit of split.units) {
        if (!piece) piece = start()
        // Fragments disappear when appended; keep their children to undo a
        // failed probe without losing inline markup or text.
        const nodes = unit.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? Array.from(unit.childNodes) : [unit]
        const hadContent = piece.inner.childNodes.length > 0
        piece.inner.append(...nodes)
        if (fits()) continue
        nodes.forEach((node) => node.parentNode?.removeChild(node))
        if (!hadContent) piece.outer.remove()
        if (page.children.length) flush(!hadContent)
        piece = start()
        piece.inner.append(...nodes)
        if (!fits()) {
          fitAtomic(piece.outer)
          flush()
          piece = null
        }
      }
    }
    flush()
    return { pages, scaledBlocks }
  } finally {
    host.remove()
  }
}

export function coverTitleSize(title: string, height: number, template: CardTemplateId = 'reed'): number {
  const n = Array.from(title).length
  const metrics = cardMetrics(template)
  const size = n <= 8 ? metrics.coverTitleSize[0] : n <= 14 ? metrics.coverTitleSize[1]
    : n <= 22 ? metrics.coverTitleSize[2] : n <= 32 ? metrics.coverTitleSize[3] : metrics.coverTitleSize[4]
  return Math.round(size * (height < 600 ? metrics.coverSmallScale : 1))
}
