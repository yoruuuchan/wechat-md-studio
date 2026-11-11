/**
 * DOM builder for long images.
 *
 * The semantic structure is fixed and documented (`reed-long-*` classes); the
 * template contributes two fragments (header/footer) and CSS. Photo rows are
 * laid out by the engine after images decode, so equal-height rows work with
 * any mixture of aspect ratios and never crop.
 */
import type { Block, Doc, InlineSeg, SignatureConfig } from './types'
import type { DiagramResolver, ImageResolver, MathResolver } from './render'
import type { LongImageMetrics } from './cards'
import { esc } from './theme-kit'
import { inline, listHtml } from './cards-render'
import { renderLongTemplatePage, type LoadedLongTemplate } from './card-template'
import {
  buildLongDocument, layoutPhotoGroup, LONG_WIDTH, type LongContentBlock, type LongDocument,
  type LongPhoto, type LongSection, textUnits,
} from './long-image'

export interface LongRenderOptions {
  source: string
  lang: 'zh' | 'en'
  template: string
  renderTemplate?: string
  templateSource?: string
  variant: string
  dark: boolean
  metrics: LongImageMetrics
  sig: SignatureConfig
  resolveImage: ImageResolver
  resolveMath: MathResolver
  resolveDiagram: DiagramResolver
}

function tableHtml(block: Extract<Block, { type: 'table' }>): string {
  const cell = (tag: string, segs: InlineSeg[], index: number) =>
    `<${tag} style="text-align:${block.align[index] ?? 'left'}">${inline(segs)}</${tag}>`
  return `<table><thead><tr>${block.head.map((cellSegs, index) => cell('th', cellSegs, index)).join('')}</tr></thead><tbody>${block.rows.map((row) =>
    `<tr>${row.map((cellSegs, index) => cell('td', cellSegs, index)).join('')}</tr>`,
  ).join('')}</tbody></table>`
}

function blockHtml(block: Block, options: LongRenderOptions, lines: string[]): string {
  switch (block.type) {
    case 'paragraph': return `<p>${inline(block.segs)}</p>`
    case 'heading': {
      const tag = block.numbered ? 'h2' : 'h1'
      return `<${tag}>${block.kicker ? `<small>${esc(block.kicker)} · </small>` : ''}${esc(block.title)}</${tag}>`
    }
    case 'subheading': return `<h3>${esc(block.title)}</h3>`
    case 'center': return `<p class="reed-long-center">${inline(block.segs)}</p>`
    case 'quoteCard': return `<blockquote><p>${inline(block.segs)}</p></blockquote>`
    case 'quoteBox': return `<blockquote>${block.paras.map((paras) => `<p>${inline(paras)}</p>`).join('')}</blockquote>`
    case 'list': return listHtml(block)
    case 'table': return tableHtml(block)
    case 'code': {
      if (block.lang.split(/\s/)[0] === 'mermaid') {
        const src = options.resolveDiagram(block.code)
        if (src) return `<figure class="reed-long-inline-image"><img src="${esc(src)}" alt=""></figure>`
      }
      return `<pre><code>${esc(block.code)}</code></pre>`
    }
    case 'math': return `<div class="reed-long-math">${options.resolveMath(block.tex, block.display) ?? `<pre>${esc(block.tex)}</pre>`}</div>`
    case 'signature': return `<p class="reed-long-signature">${Object.values(options.sig).filter(Boolean).map(esc).join(' · ')}</p>`
    case 'hr': return lines[block.line]?.trim() === '---' ? '<div class="reed-long-divider" role="separator"></div>' : '<hr>'
    default: return ''
  }
}

function renderBlocks(blocks: readonly Block[], options: LongRenderOptions): string {
  const lines = options.source.replace(/\r\n?/g, '\n').split('\n')
  return blocks.map((block) => blockHtml(block, options, lines)).join('')
}

function photoFigure(photo: LongPhoto, options: LongRenderOptions): string {
  return `<figure class="reed-long-photo"><img src="${esc(options.resolveImage(photo.src))}" alt="" data-long-photo></figure>`
}

function photosHtml(photos: LongPhoto[], options: LongRenderOptions): string {
  return `<div class="reed-long-photos" data-photo-count="${photos.length}"><div class="reed-long-photo-frame"><div class="reed-long-photo-row">${photos.map((photo) => photoFigure(photo, options)).join('')
    }</div></div><span class="reed-long-photo-next" aria-hidden="true"></span></div>`
}

function contentHtml(blocks: readonly LongContentBlock[], options: LongRenderOptions): string {
  return blocks.map((block) => {
    if (block.type === 'photos') return photosHtml(block.photos, options)
    if (block.type === 'separator') return '<div class="reed-long-divider" role="separator"></div>'
    return block.html
  }).join('')
}

function sectionHtml(section: LongSection, options: LongRenderOptions): string {
  return `<section class="reed-long-section"><div class="reed-long-section-head"><span class="reed-long-section-mark" aria-hidden="true"></span><h2 class="reed-long-section-label"><span>${esc(section.title)}</span></h2>${section.kicker ? `<span class="reed-long-section-kicker">${esc(section.kicker)}</span>` : ''}</div><div class="reed-long-section-body">${section.lede}${contentHtml(section.blocks, options)}</div></section>`
}

/** Build the complete long-image root, including template fragments. */
export function renderLongArticle(
  doc: Doc,
  options: LongRenderOptions,
  loaded: LoadedLongTemplate,
): { root: HTMLElement; flow: HTMLElement; model: LongDocument } {
  const model = buildLongDocument(
    doc,
    options.source,
    (blocks) => renderBlocks(blocks, options),
    (photos) => photosHtml([...photos], options),
  )
  const root = document.createElement('div')
  root.className = 'reed-long-root'
  root.dataset.template = options.renderTemplate ?? options.template
  if (options.templateSource) root.dataset.cardTemplateSource = options.templateSource
  root.dataset.variant = options.variant
  root.dataset.kind = 'long'
  root.style.width = `${LONG_WIDTH}px`
  root.style.setProperty('--long-pad-x', `${options.metrics.padX}px`)
  root.style.setProperty('--long-content-w', `${options.metrics.contentWidth}px`)
  root.style.setProperty('--long-photo-gap', `${options.metrics.photoGap}px`)
  root.style.setProperty('--long-photo-inset', `${options.metrics.photoInset}px`)
  root.style.setProperty('--long-title-units', String(textUnits(model.title)))
  root.style.setProperty('--long-subtitle-units', String(textUnits(model.subtitle)))

  const flow = document.createElement('div')
  flow.className = 'reed-long-flow'
  if (options.templateSource) flow.dataset.cardTemplateSource = options.templateSource
  flow.dataset.variant = options.variant
  flow.dataset.kind = 'long'

  if (model.hasHeader) {
    flow.append(renderLongTemplatePage(loaded, {
      kind: 'header',
      title: model.title,
      subtitle: model.subtitle,
      coverSrc: model.cover ? options.resolveImage(model.cover) : '',
      author: doc.meta.author,
      lang: options.lang,
    }, options.variant, options.dark))
  }
  if (model.preamble.length) {
    const preamble = document.createElement('div')
    preamble.className = 'reed-long-preamble'
    preamble.innerHTML = contentHtml(model.preamble, options)
    flow.append(preamble)
  }
  for (const section of model.sections) {
    const holder = document.createElement('div')
    holder.innerHTML = sectionHtml(section, options)
    const sectionNode = holder.firstElementChild
    if (sectionNode) flow.append(sectionNode)
  }
  if (model.hasFooter) {
    const footer = renderLongTemplatePage(loaded, {
      kind: 'footer',
      title: model.title,
      subtitle: model.subtitle,
      coverSrc: '',
      author: doc.meta.author,
      contentHtml: model.footer,
      lang: options.lang,
    }, options.variant, options.dark)
    flow.append(footer)
  }
  root.append(flow)
  return { root, flow, model }
}

/**
 * Regroup the flat photo list into equal-height rows and freeze the geometry.
 * Runs after the embedded images have natural dimensions.
 */
export function layoutLongPhotoGroups(root: HTMLElement, metrics: LongImageMetrics): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>('.reed-long-photos'))) {
    const frame = group.querySelector<HTMLElement>('.reed-long-photo-frame')
    if (!frame) continue
    const figures = Array.from(group.querySelectorAll<HTMLElement>('.reed-long-photo'))
    if (!figures.length) continue
    const aspects = figures.map((figure) => {
      const image = figure.querySelector('img')
      const width = Number(image?.dataset.naturalWidth ?? 0) || image?.naturalWidth || 0
      const height = Number(image?.dataset.naturalHeight ?? 0) || image?.naturalHeight || 0
      return width > 0 && height > 0 ? width / height : 1
    })
    const rows = layoutPhotoGroup(aspects, metrics.contentWidth - metrics.photoInset * 2, metrics.photoGap)
    frame.replaceChildren()
    let figureIndex = 0
    rows.forEach((row, rowIndex) => {
      const rowNode = document.createElement('div')
      rowNode.className = 'reed-long-photo-row'
      rowNode.style.display = 'flex'
      rowNode.style.gap = `${metrics.photoGap}px`
      rowNode.style.alignItems = 'flex-start'
      rowNode.style.justifyContent = 'flex-start'
      if (rowIndex < rows.length - 1) rowNode.style.marginBottom = `${metrics.photoGap}px`
      for (const item of row.items) {
        const figure = figures[figureIndex++]
        if (!figure) continue
        figure.style.width = `${item.width}px`
        figure.style.height = `${item.height}px`
        figure.style.margin = '0'
        figure.style.flex = 'none'
        const image = figure.querySelector('img')
        if (image) {
          image.style.width = '100%'
          image.style.height = '100%'
          image.style.objectFit = 'contain'
          image.style.display = 'block'
        }
        rowNode.append(figure)
      }
      frame.append(rowNode)
    })
  }
}
