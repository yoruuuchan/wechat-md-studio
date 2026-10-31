// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.

export const CARD_WIDTH = 540
export const CARD_RATIOS = { '3:4': 720, '1:1': 540, '9:16': 960 } as const
export type CardRatio = keyof typeof CARD_RATIOS

/**
 * A card template is a layout system, not a paint job. Each one owns its
 * variants (background ids), metrics and webfont declaration; switching
 * template swaps the background to the first variant of the new template.
 */
export const CARD_TEMPLATES = [
  'reed', 'yoru', 'paper', 'console',
  'kunlun', 'rift', 'core', 'aozora', 'kihon', 'mayonaka',
] as const
export type CardTemplate = typeof CARD_TEMPLATES[number]

export const CARD_TEMPLATE_VARIANTS = {
  reed: ['paper', 'white', 'grid', 'tint', 'night'],
  yoru: ['signal', 'lab', 'studio', 'special'],
  paper: ['editorial', 'analog', 'midnight'],
  console: ['akari', 'yoru'],
  kunlun: ['void', 'snowline'],
  rift: ['dark', 'light'],
  core: ['frost', 'nightpool'],
  aozora: ['daylight', 'yozora'],
  kihon: ['gin', 'kuro'],
  mayonaka: ['midnight', 'sunset'],
} as const satisfies Record<CardTemplate, readonly string[]>

/** Reed's original background ids, kept for callers that only speak old API. */
export const CARD_BACKGROUNDS = CARD_TEMPLATE_VARIANTS.reed
export type CardBackground = typeof CARD_TEMPLATE_VARIANTS[CardTemplate][number]
export interface CardOptions { ratio: CardRatio; template: CardTemplate; background: CardBackground }

export function templateVariants(template: CardTemplate): readonly CardBackground[] {
  return CARD_TEMPLATE_VARIANTS[template]
}

export function defaultVariant(template: CardTemplate): CardBackground {
  return CARD_TEMPLATE_VARIANTS[template][0]
}

/**
 * KIHON only has the 1080×1920 portrait frame. Other templates accept every
 * ratio; switching to KIHON moves a 3:4 / 1:1 card to 9:16 instead of
 * squeezing the native portrait layout into a frame the system does not have.
 */
export function templateRatios(template: CardTemplate): readonly CardRatio[] {
  return template === 'kihon' ? ['9:16'] : ['3:4', '1:1', '9:16']
}

/** Ratio and variant survive a template switch; the variant becomes the new first one. */
export function withTemplate(options: CardOptions, template: CardTemplate): CardOptions {
  const ratio = templateRatios(template).includes(options.ratio) ? options.ratio : templateRatios(template)[0]
  return { ratio, template, background: defaultVariant(template) }
}

/** Ratios that must switch the whole card to dark paper. */
export function isDarkVariant(template: CardTemplate, background: CardBackground): boolean {
  return (template === 'reed' && background === 'night') ||
    (template === 'paper' && background === 'midnight') ||
    (template === 'console' && background === 'yoru') ||
    (template === 'kunlun' && background === 'void') ||
    (template === 'rift' && background === 'dark') ||
    (template === 'core' && background === 'nightpool') ||
    (template === 'aozora' && background === 'yozora') ||
    (template === 'kihon' && background === 'kuro') ||
    template === 'mayonaka'
}

const TEMPLATE_ACCENTS: Partial<Record<CardTemplate, Partial<Record<CardBackground, string>>>> = {
  yoru: { signal: '#3186FF', lab: '#00A9BB', studio: '#45C496', special: '#FF6B78' },
  paper: { editorial: '#B8543A', analog: '#B8543A', midnight: '#D9917A' },
  console: { akari: '#4F6CE8', yoru: '#7A95FA' },
  kunlun: { void: '#00B8FF', snowline: '#005F87' },
  rift: { dark: '#5C7BFF', light: '#2C46C8' },
  core: { frost: '#009DE0', nightpool: '#2EB2E0' },
  aozora: { daylight: '#005DB3', yozora: '#339BFF' },
  kihon: { gin: '#2B4C6F', kuro: '#7BA3CC' },
  mayonaka: { midnight: '#FF2BD6', sunset: '#FF2BD6' },
}

/** Reed keeps the article theme's accent; the design systems own their accent. */
export function cardAccent(template: CardTemplate, background: CardBackground, fallback: string): string {
  return TEMPLATE_ACCENTS[template]?.[background] ?? fallback
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
  // YORU's 1242 canvas: pad 96/104, masthead above the flow, spine eats the
  // right margin. Scaled by 540/1242 in docs/design-templates.md.
  yoru: {
    padX: 42, padTop: 88, padBottom: 54, contentWidth: 424,
    headerTop: 28, footerBottom: 24,
    coverInsetX: 42, coverInsetY: 104, coverFootBottom: 38, coverReserve: 230,
    coverTitleSize: [54, 47, 41, 35, 29], coverSmallScale: 0.86,
  },
  // PAPER's 64px page margin at 1242 → 44px at 540; display serif runs larger.
  paper: {
    padX: 44, padTop: 74, padBottom: 56, contentWidth: 452,
    headerTop: 26, footerBottom: 24,
    coverInsetX: 44, coverInsetY: 84, coverFootBottom: 38, coverReserve: 204,
    coverTitleSize: [58, 50, 44, 38, 32], coverSmallScale: 0.86,
  },
  // Console's 390px design scales up by 1.385; 40px there ≈ 55px here, but the
  // card canvas needs less edge air than the phone chrome.
  console: {
    padX: 40, padTop: 80, padBottom: 60, contentWidth: 460,
    headerTop: 30, footerBottom: 24,
    coverInsetX: 44, coverInsetY: 88, coverFootBottom: 36, coverReserve: 210,
    coverTitleSize: [52, 45, 39, 33, 27], coverSmallScale: 0.86,
  },
  // KUNLUN's 1242 card sheet at 540/1242 ≈ 0.435; cut corners round to 5/8/10.
  kunlun: {
    padX: 42, padTop: 78, padBottom: 58, contentWidth: 456,
    headerTop: 26, footerBottom: 24,
    coverInsetX: 42, coverInsetY: 88, coverFootBottom: 36, coverReserve: 220,
    coverTitleSize: [46, 42, 38, 34, 29], coverSmallScale: 0.86,
  },
  // RIFT's glass cards: 18px radius at 0.435 → 8px, 1px lines stay 1px.
  rift: {
    padX: 42, padTop: 80, padBottom: 58, contentWidth: 456,
    headerTop: 26, footerBottom: 24,
    coverInsetX: 42, coverInsetY: 86, coverFootBottom: 36, coverReserve: 210,
    coverTitleSize: [52, 45, 39, 34, 28], coverSmallScale: 0.86,
  },
  // core's Window: 1px ink frame + 3px/6px hard offset shadow, sharp corners.
  core: {
    padX: 42, padTop: 60, padBottom: 64, contentWidth: 456,
    headerTop: 28, footerBottom: 24,
    coverInsetX: 42, coverInsetY: 78, coverFootBottom: 34, coverReserve: 200,
    coverTitleSize: [56, 49, 43, 37, 31], coverSmallScale: 0.86,
  },
  // Aozora poster: 540/1242 ≈ 0.435; cover 54–72px per docs/design-templates.
  aozora: {
    padX: 42, padTop: 76, padBottom: 64, contentWidth: 440,
    headerTop: 26, footerBottom: 24,
    coverInsetX: 42, coverInsetY: 74, coverFootBottom: 36, coverReserve: 230,
    coverTitleSize: [64, 56, 48, 40, 33], coverSmallScale: 0.86,
  },
  // KIHON is native 540×960 only; 1080 design-px × 0.5 gives 44 title / 22 body.
  kihon: {
    padX: 40, padTop: 58, padBottom: 58, contentWidth: 460,
    headerTop: 0, footerBottom: 28,
    coverInsetX: 40, coverInsetY: 58, coverFootBottom: 30, coverReserve: 190,
    coverTitleSize: [54, 48, 44, 38, 33], coverSmallScale: 0.86,
  },
  // Mayonaka's 1242 card sheet at 0.435; pixel display starts at 32–56.
  mayonaka: {
    padX: 42, padTop: 78, padBottom: 56, contentWidth: 456,
    headerTop: 26, footerBottom: 24,
    coverInsetX: 40, coverInsetY: 64, coverFootBottom: 34, coverReserve: 220,
    coverTitleSize: [56, 50, 44, 38, 32], coverSmallScale: 0.86,
  },
}

export function cardMetrics(template: CardTemplate): CardMeasurements {
  return CARD_METRICS[template]
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
  yoru: [
    { family: 'Noto Serif SC', weights: [400, 700] },
    { family: 'Zhuque Fangsong', weights: [400] },
    { family: 'Inter', weights: [400, 600] },
    { family: 'JetBrains Mono', weights: [400] },
  ],
  paper: [
    { family: 'Noto Serif SC', weights: [400, 700] },
    { family: 'EB Garamond', weights: [400, 600], styles: ['normal', 'italic'] },
    { family: 'IBM Plex Sans', weights: [400, 500] },
    { family: 'IBM Plex Mono', weights: [400] },
    { family: 'Caveat', weights: [400] },
  ],
  console: [
    { family: 'Geist', weights: [400, 700] },
    { family: 'Geist Mono', weights: [400, 700] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
  kunlun: [
    { family: 'Orbitron', weights: [500, 700, 900] },
    { family: 'JetBrains Mono', weights: [400, 700] },
    { family: 'VT323', weights: [400] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
  rift: [
    { family: 'Space Grotesk', weights: [300, 400, 500, 600, 700] },
    { family: 'DM Serif Display', weights: [400], styles: ['italic'] },
    { family: 'Rajdhani', weights: [400, 500, 600, 700] },
    { family: 'Share Tech Mono', weights: [400] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
  core: [
    { family: 'Pixelify Sans', weights: [400, 500, 600, 700] },
    { family: 'VT323', weights: [400] },
    { family: 'Tinos', weights: [400, 700], styles: ['normal', 'italic'] },
    { family: 'Noto Serif SC', weights: [400, 700] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
  aozora: [
    { family: 'Inter', weights: [400, 600] },
    { family: 'Space Grotesk', weights: [500, 700] },
    { family: 'JetBrains Mono', weights: [400] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
  kihon: [
    { family: 'Instrument Sans', weights: [400, 500, 700] },
    { family: 'B612 Mono', weights: [400, 700] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
  mayonaka: [
    { family: 'VT323', weights: [400] },
    { family: 'Noto Sans SC', weights: [400, 700] },
  ],
}

/** The CSS files that declare the faces above. */
export const CARD_FONT_SHEETS = [
  '/fonts/fonts-local.css',
  '/fonts/noto-sans-sc-local.css',
  '/fonts/fonts-templates.css',
  '/fonts/fonts-design.css',
  '/fonts/zhuque-fangsong.css',
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
  template?: CardTemplate
  signal?: AbortSignal
  measure?: (page: HTMLElement) => number
}): Promise<{ pages: CardPage[]; scaledBlocks: number }> {
  const { height, signal } = options
  const template = options.template ?? (article.dataset.template as CardTemplate | undefined) ?? 'reed'
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
      await Promise.all(CARD_TEMPLATE_FONTS[template].flatMap(({ family, weights, styles }) =>
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

export function coverTitleSize(title: string, height: number, template: CardTemplate = 'reed'): number {
  const n = Array.from(title).length
  const metrics = cardMetrics(template)
  const size = n <= 8 ? metrics.coverTitleSize[0] : n <= 14 ? metrics.coverTitleSize[1]
    : n <= 22 ? metrics.coverTitleSize[2] : n <= 32 ? metrics.coverTitleSize[3] : metrics.coverTitleSize[4]
  return Math.round(size * (height < 600 ? metrics.coverSmallScale : 1))
}
