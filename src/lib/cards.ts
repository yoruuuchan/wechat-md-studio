// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.

export const CARD_WIDTH = 540
export const CARD_PAD_X = 40
export const CARD_PAD_TOP = 52
export const CARD_PAD_BOTTOM = 76
export const CARD_RATIOS = { '3:4': 720, '1:1': 540, '9:16': 960 } as const
export type CardRatio = keyof typeof CARD_RATIOS
export const CARD_BACKGROUNDS = ['paper', 'white', 'grid', 'tint', 'night'] as const
export type CardBackground = typeof CARD_BACKGROUNDS[number]
export interface CardOptions { ratio: CardRatio; background: CardBackground }

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
  signal?: AbortSignal
  measure?: (page: HTMLElement) => number
}): Promise<{ pages: CardPage[]; scaledBlocks: number }> {
  const { height, signal } = options
  const measure = options.measure ?? ((el) => el.getBoundingClientRect().height)
  const maxHeight = height - CARD_PAD_TOP - CARD_PAD_BOTTOM
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
    content.style.cssText = `display:flow-root;width:${CARD_WIDTH - CARD_PAD_X * 2}px`
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
      await Promise.all(['Geist', 'Geist Mono', 'Noto Sans SC'].flatMap((family) =>
        [400, 700].map((weight) => document.fonts.load(`${weight} 18px "${family}"`, text)),
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

export function coverTitleSize(title: string, height: number): number {
  const n = Array.from(title).length
  const size = n <= 8 ? 56 : n <= 14 ? 48 : n <= 22 ? 42 : n <= 32 ? 36 : 30
  return Math.round(size * (height < 600 ? 0.86 : 1))
}
