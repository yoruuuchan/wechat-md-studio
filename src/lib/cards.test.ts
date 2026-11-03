// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { goldenTheme } from './themes-core'
import { readFileSync } from 'node:fs'
import { renderCardArticle } from './cards-render'
import {
  BUILTIN_CARD_FONT_FACES, CARD_FONT_SHEETS, CARD_METRICS, CARD_TEMPLATES,
  CARD_TEMPLATE_VARIANTS, CARD_WIDTH, cardMetrics, defaultVariant, isDarkVariant,
  paginateCards, registerCardTemplateRuntime, templateRatios, unregisterCardTemplateRuntime,
  withTemplate, type CardPage, type CardTemplate,
} from './cards'
import { rangeContainsText } from './cards-export'

const sig = { layout: '', proof: '', review: '' }

// jsdom has no line layout. This deliberately small layout adapter assigns
// text lines, list items and table rows heights. Real CSS, fonts, images and
// page bounds are measured separately in cdp-verify-xhs-cards.mjs.
function measure(el: HTMLElement): number {
  if (el.style.height) return Number.parseFloat(el.style.height)
  const children = Array.from(el.children) as HTMLElement[]
  if (el.matches('pre')) return (el.textContent?.match(/[^\n]*\n|[^\n]+$/g)?.length ?? 0) * 20 + 8
  if (el.matches('tr')) return 24
  if (el.matches('p,h1,h2,h3')) return Math.max(1, Math.ceil((el.textContent?.length ?? 0) / 24)) * 20
  if (el.matches('li')) return Math.max(20, children.reduce((n, c) => n + measure(c), 0))
  if (el.matches('blockquote')) return children.reduce((n, c) => n + measure(c), 0) + 16
  return children.reduce((n, c) => n + measure(c), 0)
}

function article(source: string, maxHeight = 80, template: CardTemplate = 'reed') {
  const metrics = cardMetrics(template)
  return renderCardArticle(parseMarkdown(source), {
    source, height: maxHeight + metrics.padTop + metrics.padBottom, template,
    background: defaultVariant(template),
    accent: '#4F6CE8', dark: false, sig,
    resolveImage: (s) => s, resolveMath: () => null, resolveDiagram: () => null,
  })
}

async function paginate(source: string, maxHeight = 80, template: CardTemplate = 'reed') {
  const metrics = cardMetrics(template)
  return paginateCards(article(source, maxHeight, template), {
    height: maxHeight + metrics.padTop + metrics.padBottom, template, measure,
  })
}

function bodies(pages: CardPage[]): HTMLElement[] {
  return pages.filter((p) => p.kind === 'body').map((p) => {
    const holder = document.createElement('div')
    holder.innerHTML = p.html
    return holder.firstElementChild as HTMLElement
  })
}

afterEach(() => { document.body.replaceChildren() })

describe('card cover and manual pagination', () => {
  it('takes the first H1 and the following short paragraph as cover, preserving the rest', async () => {
    const { pages } = await paginate('开场。\n\n# 旅行笔记\n\n把沿途写下来。\n\n## 第一天\n\n正文。\n\n# 第二个一级标题')
    expect(pages[0]).toEqual({ kind: 'cover', title: '旅行笔记', subtitle: '把沿途写下来。' })
    const text = bodies(pages).map((b) => b.textContent).join('')
    expect(text).toContain('开场。')
    expect(text).toContain('第二个一级标题')
    expect(text).not.toContain('把沿途写下来。')
  })

  it('does not consume a long paragraph as a subtitle or use H2 as a cover', async () => {
    const text = '一段较长的正文。'.repeat(12)
    const { pages } = await paginate(`# 标题\n\n${text}`)
    expect(pages[0]).toEqual({ kind: 'cover', title: '标题', subtitle: '' })
    expect(bodies(pages).map((b) => b.textContent).join('')).toBe(text)
    expect((await paginate('## 章节\n\n正文。')).pages.every((p) => p.kind === 'body')).toBe(true)
  })

  it('treats --- as a forced break without producing empty cards', async () => {
    const { pages } = await paginate('第一页。\n\n---\n\n---\n\n第二页。\n\n---')
    expect(bodies(pages).map((b) => b.textContent)).toEqual(['第一页。', '第二页。'])
    expect(document.querySelector('.xhs-measure')).toBeNull()
  })

  it('keeps other horizontal rules and the WeChat rendering unchanged', () => {
    const source = '前文。\n\n***\n\n后文。\n\n---\n\n结束。'
    const root = article(source)
    expect(root.querySelectorAll('hr')).toHaveLength(2)
    expect(root.querySelectorAll('[data-card-break]')).toHaveLength(1)
    const html = renderDoc(parseMarkdown(source), goldenTheme, sig).html
    expect(html).not.toContain('data-card-break')
    expect(html).toContain(goldenTheme.hr())
  })

  it('handles an empty document and a title-only document', async () => {
    expect((await paginate('')).pages).toEqual([])
    expect((await paginate('# 只有标题')).pages).toEqual([{ kind: 'cover', title: '只有标题', subtitle: '' }])
  })
})

describe('card splitting preserves content', () => {
  it('splits long paragraphs at sentences, retaining inline emphasis and hard breaks', async () => {
    const source = '**第一句话。第二句话。第三句话。第四句话。**第五句话。第六句话。  \n最后一句。'
    const { pages, scaledBlocks } = await paginate(source, 20)
    const roots = bodies(pages)
    expect(roots.length).toBeGreaterThan(1)
    expect(roots.map((r) => r.textContent).join('')).toBe(article(source).textContent)
    expect(roots.flatMap((r) => Array.from(r.querySelectorAll('strong'))).map((s) => s.textContent).join(''))
      .toBe('第一句话。第二句话。第三句话。第四句话。')
    expect(roots.flatMap((r) => Array.from(r.querySelectorAll('br')))).toHaveLength(1)
    expect(roots.every((r) => measure(r) <= 20)).toBe(true)
    expect(scaledBlocks).toBe(0)
  })

  it('retains every character of unpunctuated text and surrogate pairs', async () => {
    const source = '𠮷野家abcdefghijklmnopqrstuvwxyz'.repeat(40)
    const { pages } = await paginate(source)
    expect(bodies(pages).map((r) => r.textContent).join('')).toBe(source)
    expect(bodies(pages).every((r) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r.textContent ?? ''))).toBe(true)
  })

  it('splits code by lines, preserving indentation, blank lines and trailing newline', async () => {
    const code = Array.from({ length: 25 }, (_, i) => i % 4 === 0 ? '' : `  console.log(${i})`).join('\n') + '\n'
    const source = `\`\`\`js\n${code}\`\`\``
    const { pages, scaledBlocks } = await paginate(source)
    const chunks = bodies(pages).flatMap((r) => Array.from(r.querySelectorAll('pre code')))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((c) => c.textContent).join('')).toBe(article(source).querySelector('pre code')?.textContent)
    expect(chunks.slice(0, -1).every((c) => c.textContent?.endsWith('\n'))).toBe(true)
    expect(scaledBlocks).toBe(0)
  })

  it('splits ordered and unordered lists by item, continuing an arbitrary start number', async () => {
    const source = Array.from({ length: 19 }, (_, i) => `${7 + i}. 步骤${i}`).join('\n') + '\n\n' +
      Array.from({ length: 17 }, (_, i) => `- 要点${i}`).join('\n')
    const { pages, scaledBlocks } = await paginate(source)
    const roots = bodies(pages)
    expect(roots.filter((r) => r.querySelector('ol')).length).toBeGreaterThan(1)
    expect(roots.flatMap((r) => Array.from(r.querySelectorAll('ol > li'))).map((li) => li.getAttribute('value')))
      .toEqual(Array.from({ length: 19 }, (_, i) => String(7 + i)))
    expect(roots.flatMap((r) => Array.from(r.querySelectorAll('ul > li'))).map((li) => li.textContent))
      .toEqual(Array.from({ length: 17 }, (_, i) => `要点${i}`))
    expect(scaledBlocks).toBe(0)
  })

  it('keeps nested list structure and counters', async () => {
    const { pages } = await paginate('3. 外层甲\n\n   8. 内层甲\n   9. 内层乙\n\n4. 外层乙\n5. 外层丙', 120)
    const root = bodies(pages)[0]
    expect(root.querySelector('ol > li > ol')?.getAttribute('start')).toBe('8')
    expect(Array.from(root.querySelectorAll('ol > li')).map((li) => li.getAttribute('value'))).toEqual(['3', '8', '9', '4', '5'])
  })

  it('splits tables by row and repeats the header with each fragment', async () => {
    const source = '| 项目 | 数量 |\n|:--|--:|\n' + Array.from({ length: 17 }, (_, i) => `| 条目${i} | ${i} |`).join('\n')
    const { pages, scaledBlocks } = await paginate(source)
    const tables = bodies(pages).flatMap((r) => Array.from(r.querySelectorAll('table')))
    expect(tables.length).toBeGreaterThan(1)
    expect(tables.every((table) => table.querySelector('thead')?.textContent === '项目数量')).toBe(true)
    expect(tables.flatMap((table) => Array.from(table.querySelectorAll('tbody tr'))).map((tr) => tr.textContent))
      .toEqual(Array.from({ length: 17 }, (_, i) => `条目${i}${i}`))
    expect(tables.every((table) => table.querySelector('th:last-child')?.getAttribute('style') === 'text-align:right')).toBe(true)
    expect(scaledBlocks).toBe(0)
  })

  it('splits a long quote without losing text and cleans up after cancellation', async () => {
    const source = '> ' + '有时候慢一点。'.repeat(35)
    const { pages } = await paginate(source)
    expect(bodies(pages).length).toBeGreaterThan(1)
    expect(bodies(pages).map((b) => b.textContent).join('')).toBe('有时候慢一点。'.repeat(35))
    const controller = new AbortController()
    controller.abort()
    await expect(paginateCards(article(source), { height: 540, measure, signal: controller.signal })).rejects.toThrow()
    expect(document.querySelector('.xhs-measure')).toBeNull()
  })

  it('reports an indivisible oversized block and keeps all of its content inside a page', async () => {
    const title = '很长的章节标题'.repeat(200)
    const { pages, scaledBlocks } = await paginate('## ' + title)
    expect(scaledBlocks).toBe(1)
    const roots = bodies(pages)
    expect(roots.map((root) => root.textContent).join('')).toBe(title)
    expect(roots.every((root) => measure(root) <= 80)).toBe(true)
    expect(roots[0].querySelector('[style*="transform: scale"]')).not.toBeNull()
  })
})

describe('card assets and font slices', () => {
  it('uses the image resolver for single images, carousels and galleries', () => {
    const source = '![单图](img:a)\n\n:::carousel 4:3\n![甲](img:b)\n![乙](img:c)\n:::\n\n:::gallery 2 1:1\n![丙](img:d)\n![丁](img:e)\n:::'
    const root = renderCardArticle(parseMarkdown(source), {
      source, height: 720, template: 'reed', background: 'paper', accent: '#4F6CE8', dark: false, sig,
      resolveImage: (s) => '/api/img/' + s.slice(4), resolveMath: () => null, resolveDiagram: () => null,
    })
    expect(Array.from(root.querySelectorAll('img')).map((img) => img.getAttribute('src')))
      .toEqual(['a', 'b', 'c', 'd', 'e'].map((key) => '/api/img/' + key))
  })

  it('selects CJK, Latin, punctuation, wildcard and non-BMP font ranges', () => {
    expect(rangeContainsText('U+4E00-9FFF', '芦苇')).toBe(true)
    expect(rangeContainsText('U+0000-00FF', 'Reed 2026')).toBe(true)
    expect(rangeContainsText('U+3000-303F, U+FF00-FFEF', '，。')).toBe(true)
    expect(rangeContainsText('U+2????', '𠮷')).toBe(true)
    expect(rangeContainsText('U+4E00-9FFF', 'Reed')).toBe(false)
  })
})

describe('card template dimension', () => {
  it('keeps Reed metrics and gives every template a usable single-column measure', () => {
    expect(CARD_METRICS.reed).toMatchObject({
      padX: 40, padTop: 52, padBottom: 76, contentWidth: 460, coverReserve: 156,
    })
    for (const template of CARD_TEMPLATES) {
      const m = CARD_METRICS[template]
      expect(m.contentWidth + m.padX * 2).toBeLessThanOrEqual(CARD_WIDTH)
      expect(m.contentWidth).toBeGreaterThan(380)
      expect(m.padTop + m.padBottom).toBeLessThan(400)
      expect(m.coverReserve).toBeGreaterThan(100)
      expect(m.coverTitleSize).toHaveLength(5)
      expect(m.coverTitleSize.every((size) => size > 20)).toBe(true)
    }
  })

  it('declares Reed as the only built-in template and keeps its five variants', () => {
    expect(CARD_TEMPLATES).toEqual(['reed'])
    expect(CARD_TEMPLATE_VARIANTS).toEqual({
      reed: ['paper', 'white', 'grid', 'tint', 'night'],
    })
    expect(isDarkVariant('reed', 'night')).toBe(true)
    expect(isDarkVariant('reed', 'paper')).toBe(false)
    // An uploaded runtime still owns its own dark variants.
    registerCardTemplateRuntime({
      template: 'custom.night', name: 'Night',
      variants: [{ id: 'dusk', name: 'Dusk', dark: true }],
      ratios: ['3:4'], metrics: CARD_METRICS.reed, fonts: [],
    })
    expect(isDarkVariant('custom.night', 'dusk')).toBe(true)
    unregisterCardTemplateRuntime('custom.night')
  })

  it('keeps the selected ratio when switching to Reed', () => {
    expect(templateRatios('reed')).toEqual(['3:4', '1:1', '9:16'])
    expect(withTemplate({ ratio: '1:1', template: 'reed', background: 'paper' }, 'reed'))
      .toEqual({ ratio: '1:1', template: 'reed', background: 'paper' })
    expect(withTemplate({ ratio: '9:16', template: 'reed', background: 'grid' }, 'reed'))
      .toEqual({ ratio: '9:16', template: 'reed', background: 'paper' })
  })

  it('writes template and variant on the measured body and paginates with its own measures', async () => {
    const source = '一段不短也不长的正文，用来确认模板宽度已经生效。'.repeat(8)
    for (const template of CARD_TEMPLATES) {
      const metrics = cardMetrics(template)
      const root = article(source, 80, template)
      expect(root.dataset.template).toBe(template)
      expect(root.dataset.variant).toBe(defaultVariant(template))
      expect(root.style.width).toBe(`${metrics.contentWidth}px`)
      const { pages } = await paginate(source, 80, template)
      const pageBodies = pages.filter((p) => p.kind === 'body').map((p) => {
        const holder = document.createElement('div')
        holder.innerHTML = p.html
        return holder.firstElementChild as HTMLElement
      })
      expect(pageBodies.length).toBeGreaterThan(0)
      expect(pageBodies.every((body) => body.dataset.template === template)).toBe(true)
      expect(pageBodies.every((body) => measure(body) <= 80)).toBe(true)
    }
  })

  it('keeps every packaged font family available to uploaded manifests', () => {
    // These families are no longer built-in card rows, but the converted
    // packages reference them by name and their files stay in public/fonts.
    const expected: [string, number, 'normal' | 'italic'][] = [
      ['Noto Serif SC', 400, 'normal'], ['Noto Serif SC', 700, 'normal'],
      ['Zhuque Fangsong', 400, 'normal'], ['EB Garamond', 400, 'italic'],
      ['IBM Plex Sans', 500, 'normal'], ['IBM Plex Mono', 400, 'normal'],
      ['Caveat', 400, 'normal'], ['Inter', 600, 'normal'], ['JetBrains Mono', 400, 'normal'],
      ['Noto Sans SC', 400, 'normal'], ['Geist Mono', 700, 'normal'],
      ['Orbitron', 900, 'normal'], ['VT323', 400, 'normal'], ['Space Grotesk', 300, 'normal'],
      ['DM Serif Display', 400, 'italic'], ['Rajdhani', 700, 'normal'], ['Share Tech Mono', 400, 'normal'],
      ['Pixelify Sans', 600, 'normal'], ['Tinos', 700, 'italic'], ['Instrument Sans', 500, 'normal'],
      ['B612 Mono', 700, 'normal'],
    ]
    const css = CARD_FONT_SHEETS.map((sheet) =>
      readFileSync(new URL('../../public' + sheet, import.meta.url), 'utf8')).join('\n')
    for (const [family, weight, style] of expected) {
      const face = BUILTIN_CARD_FONT_FACES.get(family)
      expect(face, family).toBeDefined()
      expect(face!.weights).toContain(weight)
      expect(face!.styles ?? ['normal']).toContain(style)
      const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(css).toMatch(new RegExp(
        `font-family: '${escaped}';\\s*font-style: ${style};[\\s\\S]*?font-weight: ${weight};`,
      ))
    }
  })
})
