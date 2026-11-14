import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import type { Block, Doc, InlineSeg } from './types'
import {
  buildLongDocument, layoutPhotoGroup, photoRowSizes, resampledPhotoWidth, scanPhotoRuns, textUnits,
  type LongPhoto,
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

  it('does not take image examples in code fences or comments as photos', () => {
    const md = [
      '# 标题', '', '```md', '![示例](example.jpg)', '![示例](example2.jpg)', '```', '',
      '<!-- ![草稿](draft.jpg) -->', '',
      '## 一节', '', '说明', '', '![a](a.jpg)', '![b](b.jpg)', '',
    ].join('\n')
    expect(scanPhotoRuns(md).flatMap((run) => run.photos.map((photo) => photo.src))).toEqual(['a.jpg', 'b.jpg'])
    const model = buildLongDocument(parseMarkdown(md), md, render)
    expect(model.cover).toBe('')
    const group = model.sections[0].blocks.find((block) => block.type === 'photos')
    expect(group?.type === 'photos' && group.photos.map((photo) => photo.src)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('reads image lines with the article grammar: titles, brackets, <…> targets, two per line', () => {
    const md = [
      '![a](a.jpg "活动照片")',
      '![图[1]](b.jpg)',
      '![c](<my photo.jpg>)',
      '![d](d.jpg) ![e](e.jpg)',
      '',
      '正文',
    ].join('\n')
    const runs = scanPhotoRuns(md)
    expect(runs).toHaveLength(1)
    expect(runs[0].photos).toEqual([
      { alt: 'a', src: 'a.jpg' },
      { alt: '图[1]', src: 'b.jpg' },
      { alt: 'c', src: 'my%20photo.jpg' },
      { alt: 'd', src: 'd.jpg' },
      { alt: 'e', src: 'e.jpg' },
    ])
  })

  it('ends a photo run at a line that holds more than images', () => {
    const runs = scanPhotoRuns('![a](a.jpg)\n![b](b.jpg) 配文\n![c](c.jpg)')
    expect(runs.map((run) => run.photos.map((photo) => photo.src))).toEqual([['a.jpg'], ['c.jpg']])
  })
})

describe('repeated builds keep the input AST intact', () => {
  /**
   * A gallery/carousel between the header and the first H2: the first item
   * becomes the cover and the rest stay as one photo group. Regression: the
   * build wrote the shortened items array back into the parsed doc, so a second
   * build picked the second photo as its cover (a → b → c).
   */
  function multiImage(type: 'gallery' | 'carousel', line: number): Block {
    const items = ['a.jpg', 'b.jpg', 'c.jpg'].map((src, index) => ({
      src, alt: '', occurrence: index + 1,
    }))
    return type === 'gallery'
      ? { type: 'gallery', title: '', ratio: '1:1', cols: 2, occurrence: 1, items, ...at(line) }
      : { type: 'carousel', title: '', ratio: '9:16', occurrence: 1, items, ...at(line) }
  }

  /** No image-only source lines here, so the build only sees the parsed block. */
  const source = '# 标题\n\n副标题\n\n## 一节\n\n说明'

  function expectRepeatable(type: 'gallery' | 'carousel') {
    const block = multiImage(type, 4)
    const parsed = doc([
      heading('标题', false, 0), paragraph('副标题', 2), block,
      heading('一节', true, 6), paragraph('说明', 8),
    ])
    const before = JSON.stringify(parsed)
    const models = [0, 1, 2].map(() => buildLongDocument(parsed, source, render))
    for (const model of models) {
      expect(model.cover).toBe('a.jpg')
      const photos = model.preamble.find((item) => item.type === 'photos')
      expect(photos?.type === 'photos' && photos.photos.map((photo) => photo.src)).toEqual(['b.jpg', 'c.jpg'])
      expect(model.sections).toHaveLength(1)
    }
    const current = parsed.blocks.find((item) => item.type === type)
    const items = current && (current.type === 'gallery' || current.type === 'carousel') ? current.items : []
    expect(items.map((item) => item.src)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(parsed.blocks).toHaveLength(5)
    // Nothing in the parsed document — not a block, not an items array — moved.
    expect(JSON.stringify(parsed)).toBe(before)
  }

  it('keeps gallery items intact across three builds', () => expectRepeatable('gallery'))

  it('keeps carousel items intact across three builds', () => expectRepeatable('carousel'))

  /** Same regression through the real parser, where the source lines also match. */
  function expectParsedRepeatable(open: string, type: 'gallery' | 'carousel') {
    const markdown = [
      '# 标题', '', '副标题', '',
      open, '![a](a.jpg)', '![b](b.jpg)', '![c](c.jpg)', ':::', '',
      '## 一节', '', '说明',
    ].join('\n')
    const parsed = parseMarkdown(markdown)
    const before = JSON.stringify(parsed)
    const models = [0, 1, 2].map(() => buildLongDocument(parsed, markdown, render))
    for (const model of models) {
      expect(model.cover).toBe('a.jpg')
      const photos = model.preamble.find((item) => item.type === 'photos')
      // The gallery's own image lines must not be scanned a second time.
      expect(photos?.type === 'photos' && photos.photos.map((photo) => photo.src)).toEqual(['b.jpg', 'c.jpg'])
    }
    const block = parsed.blocks.find((item) => item.type === type)
    const items = block && (block.type === 'gallery' || block.type === 'carousel') ? block.items : []
    expect(items.map((item) => item.src)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(JSON.stringify(parsed)).toBe(before)
  }

  it('keeps a parsed gallery stable and does not double its photos', () => {
    expectParsedRepeatable(':::gallery 3 4:3', 'gallery')
  })

  it('keeps a parsed carousel stable and does not double its photos', () => {
    expectParsedRepeatable(':::carousel 9:16', 'carousel')
  })

  it('keeps a source-scanned photo run stable across three builds', () => {
    const markdown = [
      '# 标题', '', '副标题', '',
      '![a](a.jpg)', '![b](b.jpg)', '![c](c.jpg)', '',
      '## 一节', '', '![尾图](d.jpg)',
    ].join('\n')
    const parsed = parseMarkdown(markdown)
    const before = JSON.stringify(parsed)
    const models = [0, 1, 2].map(() => buildLongDocument(parsed, markdown, render))
    for (const model of models) {
      expect(model.cover).toBe('a.jpg')
      const photos = model.preamble.find((item) => item.type === 'photos')
      expect(photos?.type === 'photos' && photos.photos.map((photo) => photo.src)).toEqual(['b.jpg', 'c.jpg'])
    }
    expect(JSON.stringify(parsed)).toBe(before)
  })

  it('does not remove a block from the input when it becomes the cover', () => {
    const markdown = [
      '# 标题', '', '副标题', '',
      '![a](a.jpg)', '', '## 一节', '', '说明',
    ].join('\n')
    const parsed = parseMarkdown(markdown)
    const blocks = parsed.blocks.length
    const image = JSON.stringify(parsed.blocks.find((block) => block.type === 'image'))
    expect(buildLongDocument(parsed, markdown, render).cover).toBe('a.jpg')
    expect(buildLongDocument(parsed, markdown, render).cover).toBe('a.jpg')
    expect(parsed.blocks).toHaveLength(blocks)
    expect(JSON.stringify(parsed.blocks.find((block) => block.type === 'image'))).toBe(image)
  })
})

describe('footer photos', () => {
  function footerOf(markdown: string) {
    const calls: LongPhoto[][] = []
    const model = buildLongDocument(parseMarkdown(markdown), markdown, render, (photos) => {
      calls.push(photos.map((photo) => ({ ...photo })))
      return `<div class="footer-photos">${photos.map((photo) => `${photo.src}|${photo.alt}`).join(',')}</div>`
    })
    return { model, calls }
  }

  it('keeps a single footer image instead of dropping it', () => {
    const { model, calls } = footerOf(['# 标题', '', '副标题', '', '---', '', '![二维码](qr.jpg)'].join('\n'))
    expect(model.footer).toContain('qr.jpg|二维码')
    expect(calls).toEqual([[{ src: 'qr.jpg', alt: '二维码' }]])
  })

  it('keeps consecutive footer image lines in source order', () => {
    const { model } = footerOf([
      '# 标题', '', '副标题', '', '---', '',
      '![二维码](qr.jpg)', '![Logo](logo.jpg)', '![联署](sign.jpg)',
    ].join('\n'))
    expect(model.footer).toContain('qr.jpg|二维码,logo.jpg|Logo,sign.jpg|联署')
  })

  it('keeps a footer gallery in source order', () => {
    const { model } = footerOf([
      '# 标题', '', '副标题', '', '---', '',
      ':::gallery 2', '![联署](sign.jpg)', '![Logo](logo.jpg)', ':::',
    ].join('\n'))
    expect(model.footer).toContain('sign.jpg|联署,logo.jpg|Logo')
  })

  it('keeps a footer carousel in source order', () => {
    const { model } = footerOf([
      '# 标题', '', '副标题', '', '---', '',
      ':::carousel 4:3', '![合影](group.jpg)', '![花絮](bts.jpg)', ':::',
    ].join('\n'))
    expect(model.footer).toContain('group.jpg|合影,bts.jpg|花絮')
  })

  it('leaves code-fence and comment image examples out of the footer', () => {
    const { model, calls } = footerOf([
      '# 标题', '', '副标题', '', '---', '',
      '```md', '![示例](example.jpg)', '```', '',
      '<!-- ![草稿](draft.jpg) -->', '',
      '![正式](qr.jpg)',
    ].join('\n'))
    expect(calls).toEqual([[{ src: 'qr.jpg', alt: '正式' }]])
    expect(model.footer).toContain('qr.jpg')
    expect(model.footer).not.toContain('example.jpg')
    expect(model.footer).not.toContain('draft.jpg')
  })

  it('renders non-photo footer blocks through the normal renderer', () => {
    const { model, calls } = footerOf(['# 标题', '', '副标题', '', '---', '', '共同走过这一年。'].join('\n'))
    expect(model.footer).toContain('<p>共同走过这一年。</p>')
    expect(calls).toEqual([])
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
