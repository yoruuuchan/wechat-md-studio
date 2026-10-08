import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { collectMaterials, renderDoc } from './render'
import { getTheme } from './themes'
import { DEFAULT_GALLERY_COLS, DEFAULT_GALLERY_RATIO, GALLERY_COLS, type Block } from './types'

const SIG = { layout: '排版', proof: '校对', review: '审核' }

function galleryOf(src: string) {
  const block = parseMarkdown(src).blocks.find((b): b is Extract<Block, { type: 'gallery' }> => b.type === 'gallery')
  if (!block) throw new Error(`no gallery block in:\n${src}`)
  return block
}

function render(src: string, resolveImg: (s: string) => string = (s) => s) {
  return renderDoc(parseMarkdown(src), getTheme('golden'), SIG, resolveImg)
}

describe('the gallery opener', () => {
  it('takes columns, ratio and title', () => {
    const g = galleryOf(':::gallery 3 4:3 现场花絮\n![]()\n![]()\n![]()\n:::\n')
    expect(g.cols).toBe(3)
    expect(g.ratio).toBe('4:3')
    expect(g.title).toBe('现场花絮')
    expect(g.items).toHaveLength(3)
  })

  it('reads a leading ratio as a ratio, not as a column count', () => {
    // The whole point of the lookahead: "4:3" must not become four columns.
    const g = galleryOf(':::gallery 4:3 标题\n![]()\n![]()\n:::\n')
    expect(g.cols).toBe(DEFAULT_GALLERY_COLS)
    expect(g.ratio).toBe('4:3')
    expect(g.title).toBe('标题')
  })

  it('defaults both parameters', () => {
    const g = galleryOf(':::gallery 只有标题\n![]()\n![]()\n:::\n')
    expect(g.cols).toBe(DEFAULT_GALLERY_COLS)
    expect(g.ratio).toBe(DEFAULT_GALLERY_RATIO)
    expect(g.title).toBe('只有标题')
  })

  it('accepts a bare column count with no title', () => {
    const g = galleryOf(':::gallery 4\n![]()\n![]()\n:::\n')
    expect(g.cols).toBe(4)
    expect(g.title).toBe('')
  })

  it('leaves an unsupported column count in the title instead of guessing', () => {
    const g = galleryOf(':::gallery 7 张现场图\n![]()\n![]()\n:::\n')
    expect(g.cols).toBe(DEFAULT_GALLERY_COLS)
    expect(g.title).toBe('7 张现场图')
  })

  it('accepts spaces around the ratio colon', () => {
    const g = galleryOf(':::gallery 3 16 : 9 标题\n![]()\n![]()\n:::\n')
    expect(g.cols).toBe(3)
    expect(g.ratio).toBe('16:9')
    expect(g.title).toBe('标题')
  })

  it('collects several images written on one line', () => {
    const g = galleryOf(':::gallery 2\n![甲]() ![乙]()\n:::\n')
    expect(g.items.map((i) => i.alt)).toEqual(['甲', '乙'])
  })

  it('numbers occurrences across the whole document, not per block', () => {
    const g = galleryOf('![单图]()\n\n:::gallery 2\n![甲]()\n![乙]()\n:::\n')
    expect(g.items.map((i) => i.occurrence)).toEqual([2, 3])
    expect(g.occurrence).toBe(2)
  })

  it('reports a source span, so scroll sync can map the block', () => {
    const g = galleryOf('前言\n\n:::gallery 2\n![]()\n![]()\n:::\n\n后记\n')
    expect(g.line).toBe(2)
    expect(g.lineEnd).toBeGreaterThan(g.line)
  })

  it('does not disturb the carousel opener next door', () => {
    const doc = parseMarkdown(':::carousel 16:9 轮播\n![]()\n![]()\n:::\n\n:::gallery 3 网格\n![]()\n![]()\n:::\n')
    const carousel = doc.blocks.find((b) => b.type === 'carousel')
    const gallery = doc.blocks.find((b) => b.type === 'gallery')
    expect(carousel?.type === 'carousel' && carousel.ratio).toBe('16:9')
    expect(gallery?.type === 'gallery' && gallery.cols).toBe(3)
    expect(gallery?.type === 'gallery' && gallery.title).toBe('网格')
  })
})

describe('the gallery grid', () => {
  const SRC = ':::gallery 3 4:3 三列网格\n![甲](img:k1)\n![乙](img:k2)\n![丙](img:k3)\n![丁](img:k4)\n:::\n'

  it('lays cells out with percentages, never with grid or float', () => {
    const { html } = render(SRC)
    expect(html).not.toContain('display:grid')
    expect(html).not.toContain('float:')
    expect(html).not.toContain('object-fit')
    expect(html).toContain('display:inline-block')
    expect(html).toContain('width:100%;height:auto')
  })

  it('never puts a fixed height on an image', () => {
    const { html } = render(SRC)
    // The height attribute carries the crop ratio; a height *style* would
    // letterbox an image whose shape does not match the cell.
    for (const img of html.match(/<img[^>]*>/g) ?? []) {
      expect(img).toMatch(/height="\d+"/)
      expect(img).not.toMatch(/style="[^"]*height:\s*\d/)
    }
  })

  it('keeps every row at or under 100% so no cell wraps early', () => {
    for (const cols of GALLERY_COLS) {
      const src = `:::gallery ${cols}\n${'![]()\n'.repeat(cols * 2)}:::\n`
      const { html } = render(src)
      const widths = [...html.matchAll(/width:([\d.]+)%;display:inline-block/g)].map((m) => Number(m[1]))
      expect(widths).toHaveLength(cols * 2)
      const gutters = (cols - 1) * 2
      expect(widths[0] * cols + gutters).toBeLessThanOrEqual(100)
    }
  })

  it('resolves img: references, so cells are not broken images', () => {
    const { html } = render(SRC, (s) => (s.startsWith('img:') ? `https://x/api/img/${s.slice(4)}` : s))
    expect(html).toContain('https://x/api/img/k1')
    expect(html).not.toContain('"img:k1"')
  })

  it('takes one figure number for the whole grid and numbers captions after it', () => {
    const { html } = render(`![单图](img:a)\n\n${SRC}\n\n![后一张](img:b)\n`)
    expect(html).toContain('图1 单图')
    expect(html).toContain('图2 三列网格（共 4 张）')
    expect(html).toContain('图3 后一张')
    expect(html).not.toContain('图2-1')
  })

  it('counts every image but only one gallery', () => {
    const { stats } = render(`![单图](img:a)\n\n${SRC}\n`)
    expect(stats.images).toBe(5)
    expect(stats.galleries).toBe(1)
    expect(stats.carousels).toBe(0)
  })

  it('warns when a grid has less than two images', () => {
    expect(render(':::gallery 2\n![只有一张]()\n:::\n').stats.warnings).toContain('画廊至少需要 2 张图片')
    expect(render(SRC).stats.warnings).toEqual([])
  })

  it('renders a placeholder cell while an image is still missing', () => {
    const { html } = render(':::gallery 2\n![甲]()\n![乙]()\n:::\n')
    expect(html).toContain('待插入图片')
    expect(html).not.toContain('<img')
  })
})

describe('gallery images in the materials list', () => {
  const SRC = '![单图]()\n\n:::gallery 3 1:1 网格标题\n![甲]()\n![乙]()\n![丙]()\n:::\n'

  it('lists every cell as 图N-M, matching the article', () => {
    const rows = collectMaterials(parseMarkdown(SRC))
    expect(rows.map((r) => r.no)).toEqual(['图1', '图2-1', '图2-2', '图2-3'])
  })

  it('marks them as gallery rows carrying the shared frame', () => {
    const rows = collectMaterials(parseMarkdown(SRC)).filter((r) => r.kind === '画廊')
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.ratio === '1:1')).toBe(true)
    expect(rows.map((r) => r.desc)).toEqual(['网格标题 · 甲', '网格标题 · 乙', '网格标题 · 丙'])
  })

  it('gives them no carousel ordinal, so the panel does not offer a ratio picker', () => {
    // A gallery's ratio is written in its fence line; an ordinal would group the
    // rows under a control that has nothing to write back to.
    const rows = collectMaterials(parseMarkdown(SRC)).filter((r) => r.kind === '画廊')
    expect(rows.every((r) => r.carouselOrdinal === undefined)).toBe(true)
  })

  it('keeps occurrences distinct, so each cell is filled with its own image', () => {
    const rows = collectMaterials(parseMarkdown(SRC))
    expect(rows.map((r) => r.occurrence)).toEqual([1, 2, 3, 4])
  })

  it('counts a gallery once for figure numbering, like a carousel', () => {
    const both = collectMaterials(
      parseMarkdown(':::carousel 4:3 轮播\n![]()\n![]()\n:::\n\n:::gallery 2 网格\n![]()\n![]()\n:::\n'),
    )
    expect(both.map((r) => r.no)).toEqual(['图1-1', '图1-2', '图2-1', '图2-2'])
    expect(both.map((r) => r.kind)).toEqual(['轮播', '轮播', '画廊', '画廊'])
  })
})
