import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import type { Block, Doc, InlineSeg } from './types'
import {
  buildLongDocument, layoutPhotoGroup, photoRowSizes, resampledPhotoWidth, textUnits,
} from './long-image'

const at = (line: number): { line: number; lineEnd: number } => ({ line, lineEnd: line + 1 })

function paragraph(text: string, line = 0): Block {
  return { type: 'paragraph', segs: [{ text }], ...at(line) }
}

function image(src: string, alt = '', line = 0): Block {
  return { type: 'image', src, alt, occurrence: 1, ...at(line) }
}

function heading(title: string, numbered: boolean, line = 0): Block {
  return { type: 'heading', title, kicker: '', numbered, ...at(line) }
}

function hr(line: number): Block {
  return { type: 'hr', ...at(line) }
}

function doc(blocks: Block[]): Doc {
  return { meta: { titles: [], cover: '', author: '' }, blocks }
}

/** Minimal stand-in for the real block renderer; tests only care about grouping. */
function render(blocks: readonly Block[]): string {
  return blocks.map((block) => {
    if (block.type === 'paragraph') return `<p>${block.segs.map((seg: InlineSeg) => seg.text).join('')}</p>`
    return `<div data-kind="${block.type}"></div>`
  }).join('')
}

const source = `# 标题

副标题

![头图](cover.jpg)

## 第一节

说明一

![a](a.jpg)
![b](b.jpg)

---

## 第二节

说明二

![c](c.jpg)

---

共同走过这一年。`

describe('long-image Markdown mapping', () => {
  it('takes the first H1, the short paragraph after it and the first image as the header', () => {
    const model = buildLongDocument(doc([
      heading('标题', false, 0), paragraph('副标题', 2), image('cover.jpg', '', 4),
      heading('第一节', true, 6), paragraph('说明一', 8),
    ]), source, render)
    expect(model.hasHeader).toBe(true)
    expect(model.title).toBe('标题')
    expect(model.subtitle).toBe('副标题')
    expect(model.cover).toBe('cover.jpg')
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].lede).toContain('说明一')
    expect(model.sections[0].lede).toContain('reed-long-lede')
  })

  it('does not grow a header when there is no H1', () => {
    const model = buildLongDocument(doc([
      heading('只有小节', true, 0), paragraph('正文', 2),
    ]), '## 只有小节\n\n正文', render)
    expect(model.hasHeader).toBe(false)
    expect(model.sections).toHaveLength(1)
  })

  it('uses the last standalone --- as the footer and earlier ones as dividers', () => {
    const model = buildLongDocument(doc([
      heading('标题', false, 0), paragraph('副标题', 2),
      heading('第一节', true, 6), paragraph('说明一', 8), image('a.jpg', '', 10),
      hr(13),
      heading('第二节', true, 15), paragraph('说明二', 17),
      hr(21),
      paragraph('共同走过这一年。', 23),
    ]), source, render)
    expect(model.hasFooter).toBe(true)
    expect(model.footer).toContain('共同走过这一年。')
    expect(model.sections).toHaveLength(2)
    expect(model.sections[0].blocks.some((block) => block.type === 'separator')).toBe(true)
  })

  it('groups only adjacent images and leaves a paragraph as a divider', () => {
    const model = buildLongDocument(doc([
      heading('标题', false, 0),
      heading('一节', true, 2),
      image('a.jpg', '', 4), image('b.jpg', '', 5), paragraph('中间', 6), image('c.jpg', '', 7),
    ]), source, render)
    const blocks = model.sections[0].blocks
    expect(blocks[0].type).toBe('photos')
    expect(blocks[0].type === 'photos' && blocks[0].photos).toHaveLength(2)
    expect(blocks[1].type).toBe('html')
    expect(blocks[2].type).toBe('photos')
  })

  it('reads consecutive image lines that Markdown keeps as one paragraph', () => {
    const src = '# 标题\n\n副标题\n\n## 一节\n\n说明\n\n![a](a.jpg)\n![b](b.jpg)\n![c](c.jpg)\n'
    const model = buildLongDocument(doc([
      heading('标题', false, 0), paragraph('副标题', 2),
      heading('一节', true, 4), paragraph('说明', 6),
    ]), src, render)
    expect(model.cover).toBe('')
    const photos = model.sections[0].blocks.find((block) => block.type === 'photos')
    expect(photos?.type === 'photos' && photos.photos.map((photo) => photo.src)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('keeps a gallery first item as the cover and leaves the rest as photos', () => {
    const gallery: Block = {
      type: 'gallery', title: '', ratio: '1:1', cols: 2, occurrence: 1,
      items: [{ src: 'a.jpg', alt: '', occurrence: 1 }, { src: 'b.jpg', alt: '', occurrence: 2 }],
      ...at(4),
    }
    const model = buildLongDocument(doc([
      heading('标题', false, 0), paragraph('副标题', 2), gallery,
      heading('一节', true, 6), paragraph('说明', 8),
    ]), source, render)
    expect(model.cover).toBe('a.jpg')
    const photos = model.preamble.find((block) => block.type === 'photos')
    expect(photos?.type === 'photos' && photos.photos.map((photo) => photo.src)).toEqual(['b.jpg'])
  })
})

describe('long-image mapping from the real parser', () => {
  it('turns parsed blocks into header, sections, one photo group and a footer', () => {
    const md = [
      '# 一次读书会',
      '',
      '把一本书读成一条长图',
      '',
      '![头图](cover.jpg)',
      '',
      '## 开场',
      '',
      '大家带来的书摊在桌上。',
      '',
      '![a](a.jpg)',
      '![b](b.jpg)',
      '![c](c.jpg)',
      '',
      '## 共读',
      '',
      '![d](d.jpg)',
      '',
      '---',
      '',
      '共同走过这一年。',
    ].join('\n')
    const model = buildLongDocument(parseMarkdown(md), md, render, (photos) =>
      `<div class="reed-long-photos">${photos.map((photo) => photo.src).join(',')}</div>`)
    expect(model.hasHeader).toBe(true)
    expect(model.title).toBe('一次读书会')
    expect(model.subtitle).toBe('把一本书读成一条长图')
    expect(model.cover).toBe('cover.jpg')
    expect(model.sections.map((section) => section.title)).toEqual(['开场', '共读'])
    expect(model.sections[0].lede).toContain('大家带来的书摊在桌上。')
    const group = model.sections[0].blocks.find((block) => block.type === 'photos')
    expect(group?.type === 'photos' && group.photos.map((photo) => photo.src)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(model.hasFooter).toBe(true)
    expect(model.footer).toContain('共同走过这一年。')
  })
})

describe('photo rows', () => {
  it('lays out 1 to 7 photos', () => {
    expect(photoRowSizes(1)).toEqual([1])
    expect(photoRowSizes(2)).toEqual([2])
    expect(photoRowSizes(3)).toEqual([1, 2])
    expect(photoRowSizes(4)).toEqual([2, 2])
    expect(photoRowSizes(5)).toEqual([1, 2, 2])
    expect(photoRowSizes(6)).toEqual([2, 2, 2])
    expect(photoRowSizes(7)).toEqual([1, 2, 2, 2])
  })

  it('keeps a landscape and a portrait at the same height', () => {
    const rows = layoutPhotoGroup([1.5, 0.75], 400, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].items[0].height).toBe(rows[0].items[1].height)
    expect(rows[0].items[0].width + rows[0].items[1].width + 10).toBeCloseTo(400, 1)
    expect(rows[0].items[0].width).toBeCloseTo(rows[0].items[1].width * 2, 1)
  })

  it('uses the full width for a single photo and never crops', () => {
    const rows = layoutPhotoGroup([2], 444, 8)
    expect(rows).toHaveLength(1)
    expect(rows[0].items[0].width).toBe(444)
    expect(rows[0].items[0].height).toBe(222)
  })

  it('puts the first of an odd group alone and fills the rest in pairs', () => {
    const rows = layoutPhotoGroup([1, 1, 1], 400, 10)
    expect(rows.map((row) => row.items.length)).toEqual([1, 2])
    expect(rows[0].items[0].width).toBe(400)
    expect(rows[1].items[0].width).toBe(195)
  })

  it('never upscales a photo during resampling', () => {
    expect(resampledPhotoWidth(200, 2, 300)).toBe(300)
    expect(resampledPhotoWidth(160, 2, 500)).toBe(320)
    expect(resampledPhotoWidth(160, 2.666, 300)).toBe(300)
  })
})

describe('textUnits', () => {
  it('counts CJK as one and Latin as about half', () => {
    expect(textUnits('一次读书会')).toBe(5)
    expect(textUnits('Reed')).toBe(2.2)
    expect(textUnits('')).toBe(1)
  })
})
