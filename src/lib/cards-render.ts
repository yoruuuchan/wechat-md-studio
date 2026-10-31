// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import type { Doc, InlineSeg, ListBlock, SignatureConfig } from './types'
import type { DiagramResolver, ImageResolver, MathResolver } from './render'
import { esc } from './theme-kit'
import { t } from './i18n'
import { cardMetrics, type CardBackground, type CardTemplate } from './cards'

function inline(segs: InlineSeg[]): string {
  return segs.map((seg) => {
    if (seg.text === '\n') return '<br>'
    let text = esc(seg.text)
    if (seg.code) text = `<code>${text}</code>`
    if (seg.bold) text = `<strong>${text}</strong>`
    if (seg.mark) text = `<mark>${text}</mark>`
    if (seg.italic) text = `<em>${text}</em>`
    if (seg.strike) text = `<del>${text}</del>`
    if (seg.link) text = `<span class="xhs-link">${text}</span>`
    return text
  }).join('')
}

function listHtml(list: ListBlock): string {
  const tag = list.ordered ? 'ol' : 'ul'
  return `<${tag}${list.ordered ? ` start="${list.start}"` : ''}>${list.items.map((item, i) =>
    `<li${list.ordered ? ` value="${list.start + i}"` : ''}>${item.parts.map((part) =>
      part.type === 'list' ? listHtml(part.list) : `<p>${inline(part.segs)}</p>`,
    ).join('')}</li>`,
  ).join('')}</${tag}>`
}

/** A second presentation of Reed's semantic AST, never a second Markdown parser. */
export function renderCardArticle(doc: Doc, options: {
  source: string
  height: number
  template: CardTemplate
  background: CardBackground
  accent: string
  dark: boolean
  sig: SignatureConfig
  resolveImage: ImageResolver
  resolveMath: MathResolver
  resolveDiagram: DiagramResolver
}): HTMLElement {
  const root = document.createElement('section')
  const metrics = cardMetrics(options.template)
  root.className = 'xhs-body'
  root.dataset.template = options.template
  root.dataset.variant = options.background
  root.style.width = `${metrics.contentWidth}px`
  root.style.setProperty('--xhs-accent', options.accent)
  root.dataset.night = String(options.dark)
  const lines = options.source.replace(/\r\n?/g, '\n').split('\n')
  const maxImageHeight = Math.floor((options.height - metrics.padTop - metrics.padBottom) * 0.72)
  const image = (src: string, alt: string) => `<figure>${src
    ? `<img src="${esc(options.resolveImage(src))}" alt="${esc(alt)}" style="max-height:${maxImageHeight}px">`
    : `<p class="xhs-placeholder">${esc(t('theme.pendingImage'))}</p>`
  }${alt ? `<figcaption>${esc(alt)}</figcaption>` : ''}</figure>`
  root.innerHTML = doc.blocks.map((block) => {
    switch (block.type) {
      case 'paragraph': return `<p>${inline(block.segs)}</p>`
      case 'heading': {
        const tag = block.numbered ? 'h2' : 'h1'
        return `<${tag}>${block.kicker ? `<small>${esc(block.kicker)} · </small>` : ''}${esc(block.title)}</${tag}>`
      }
      case 'subheading': return `<h3>${esc(block.title)}</h3>`
      case 'center': return `<p class="xhs-center">${inline(block.segs)}</p>`
      case 'quoteCard': return `<blockquote><p>${inline(block.segs)}</p></blockquote>`
      case 'quoteBox': return `<blockquote>${block.paras.map((p) => `<p>${inline(p)}</p>`).join('')}</blockquote>`
      case 'list': return listHtml(block)
      case 'table': {
        const cell = (tag: string, segs: InlineSeg[], i: number) =>
          `<${tag} style="text-align:${block.align[i] ?? 'left'}">${inline(segs)}</${tag}>`
        return `<table><thead><tr>${block.head.map((c, i) => cell('th', c, i)).join('')}</tr></thead><tbody>${block.rows.map((row) =>
          `<tr>${row.map((c, i) => cell('td', c, i)).join('')}</tr>`,
        ).join('')}</tbody></table>`
      }
      case 'code': {
        if (block.lang.split(/\s/)[0] === 'mermaid') {
          const src = options.resolveDiagram(block.code)
          if (src) return image(src, block.lang.slice('mermaid'.length).trim())
        }
        return `<pre><code>${esc(block.code)}</code></pre>`
      }
      case 'image': return image(block.src, block.alt)
      // A static card presents every image; a horizontal carousel cannot be
      // swiped inside a PNG. Separate figures also give pagination useful units.
      case 'carousel':
      case 'gallery': return block.items.map((item) => image(item.src, item.alt)).join('')
      case 'math': return `<div class="xhs-math">${options.resolveMath(block.tex, block.display) ?? `<pre>${esc(block.tex)}</pre>`}</div>`
      case 'signature': return `<p class="xhs-signature">${Object.values(options.sig).filter(Boolean).map(esc).join(' · ')}</p>`
      case 'hr': return lines[block.line]?.trim() === '---' ? '<hr data-card-break>' : '<hr>'
    }
  }).join('')
  return root
}
