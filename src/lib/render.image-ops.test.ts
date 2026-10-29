import { describe, expect, it } from 'vitest'
import {
  canLocateImage,
  clearImageSrc,
  collectMaterials,
  fillImageSrc,
  locateImage,
  removeImageLine,
  setCarouselRatio,
} from './render'
import { parseMarkdown } from './parse'

// The three image-positioning helpers used to locate their target by
// "alt text + nearest line number". When several images share a caption, or a
// carousel gives every slide the same line, the nearest-line search picked an
// arbitrary match and edited the wrong image. These tests pin the correct
// behaviour: one exact occurrence, addressed by its document-order index.

const DOC = [
  '---',
  'titles:',
  '  - 示例',
  '---',
  '',
  '## 01 | 开头',
  '',
  '![同一张图注](img:aaa)',
  '',
  '中间一段文字。',
  '',
  '![同一张图注](img:bbb)',
  '',
].join('\n')

const CAROUSEL = [
  ':::carousel 4:3 三张图',
  '![同图注](img:a)',
  '![同图注](img:b)',
  '![同图注](img:c)',
  ':::',
  '',
].join('\n')

describe('fillImageSrc addresses the exact occurrence', () => {
  it('fills the second of two images that share the same caption', () => {
    const out = fillImageSrc(DOC, '同一张图注', 2, 'img:ccc')
    // occurrence 2 must touch the `img:bbb` line, not `img:aaa`
    expect(out).toContain('![同一张图注](img:aaa)')
    expect(out).toContain('![同一张图注](img:ccc)')
    expect(out).not.toContain('img:bbb')
  })

  it('leaves content untouched when the occurrence is missing', () => {
    expect(fillImageSrc(DOC, '同一张图注', 9, 'img:zzz')).toBe(DOC)
    expect(canLocateImage(DOC, '同一张图注', 9)).toBe(false)
    expect(canLocateImage(DOC, '同一张图注', 1)).toBe(true)
  })

  it('refuses to edit when the caption at that index no longer matches', () => {
    // Simulates a new image typed above: the index now points at a stranger.
    const shifted = '![新插入的图](img:new)\n\n' + DOC
    expect(fillImageSrc(shifted, '同一张图注', 1, 'img:zzz')).toBe(shifted)
    expect(canLocateImage(shifted, '同一张图注', 1)).toBe(false)
  })
})

describe('carousel slides are individually addressable', () => {
  it('gives each slide a distinct occurrence', () => {
    const mats = collectMaterials(parseMarkdown(CAROUSEL))
    expect(mats.length).toBe(3)
    expect(mats.map((m) => m.occurrence)).toEqual([1, 2, 3])
  })

  it('clears only the addressed slide, leaving the others intact', () => {
    const out = clearImageSrc(CAROUSEL, '同图注', 2)
    expect(out).toContain('![同图注](img:a)')
    expect(out).toContain('![同图注]()')
    expect(out).toContain('![同图注](img:c)')
    expect(out).not.toContain('img:b')
  })

  it('removes only the addressed line', () => {
    const out = removeImageLine(CAROUSEL, '同图注', 2)
    expect(out).toContain('![同图注](img:a)')
    expect(out).not.toContain('img:b')
    expect(out).toContain('![同图注](img:c)')
  })
})

describe('occurrence survives images the AST cannot see', () => {
  // An image wrapped in running text is not a block, so it never reaches the
  // materials list — but it still occupies a `![` slot in the raw source. The
  // index must stay aligned with the raw text, not with the AST.
  const MIXED = [
    '![第一张](img:1)',
    '',
    '正文里夹着 ![行内图](img:inline) 一张图。',
    '',
    '![第二张](img:2)',
    '',
  ].join('\n')

  it('numbers the third source image as 3, not 2', () => {
    const mats = collectMaterials(parseMarkdown(MIXED))
    expect(mats.map((m) => m.alt)).toEqual(['第一张', '第二张'])
    expect(mats.map((m) => m.occurrence)).toEqual([1, 3])
  })

  it('writes to the correct image past an inline one', () => {
    const out = fillImageSrc(MIXED, '第二张', 3, 'img:new')
    expect(out).toContain('![第二张](img:new)')
    expect(out).toContain('![行内图](img:inline)')
  })
})

describe('a commented-out image is not an occurrence', () => {
  // A note can hold anything, including image syntax the author parked for
  // later. Both scanners skip comment spans, so the index the editor computes
  // and the span this helper edits still describe the same picture.
  const PARKED = [
    '![真图](img:1)',
    '',
    '<!-- 先放这里：![暂存的图](img:parked) -->',
    '',
    '![第二张真图](img:2)',
    '',
  ].join('\n')

  it('numbers the second real image as 2', () => {
    const mats = collectMaterials(parseMarkdown(PARKED))
    expect(mats.map((m) => m.alt)).toEqual(['真图', '第二张真图'])
    expect(mats.map((m) => m.occurrence)).toEqual([1, 2])
  })

  it('writes to the second real image, leaving the parked one alone', () => {
    const out = fillImageSrc(PARKED, '第二张真图', 2, 'img:new')
    expect(out).toContain('![第二张真图](img:new)')
    expect(out).toContain('![暂存的图](img:parked)')
  })
})

describe('image sources are consumed with the parser grammar', () => {
  // `findImageSpan` used to end at the first `)`. For a source that contains
  // parentheses or a title, that left the tail (`.png)`) in the article and the
  // replacement or clear silently corrupted the source. The span now walks the
  // same destination / title grammar markdown-it accepted in the first place.
  const destinations = [
    ['balanced parentheses', 'https://example.com/a(b).png'],
    ['nested parentheses', 'https://example.com/a(b(c)d).png'],
    ['escaped parentheses', 'https://example.com/a\\(b\\).png'],
    ['angle-bracket form', '<https://example.com/a(b).png>'],
  ] as const

  for (const [name, src] of destinations) {
    it(`replaces, clears and deletes ${name} without leftovers`, () => {
      const doc = `前文\n\n![photo](${src})\n\n后文\n`
      expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe('前文\n\n![photo](img:NEW)\n\n后文\n')
      expect(clearImageSrc(doc, 'photo', 1)).toBe('前文\n\n![photo]()\n\n后文\n')
      expect(removeImageLine(doc, 'photo', 1)).toBe('前文\n\n后文\n')
    })
  }

  it('drops all three title forms together with the source', () => {
    for (const title of ['"说明"', "'说明'", '(说明)']) {
      const doc = `![photo](https://example.com/a(b).png ${title})`
      expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe('![photo](img:NEW)')
      expect(clearImageSrc(doc, 'photo', 1)).toBe('![photo]()')
      expect(removeImageLine(doc, 'photo', 1)).toBe('')
    }
  })

  it('accepts a title that wraps onto the next line of the paragraph', () => {
    const doc = '![photo](https://example.com/a(b).png "第一行\n第二行")'
    expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe('![photo](img:NEW)')
  })

  it('does not stop at a `)` inside a quoted title', () => {
    const doc = '![photo](https://example.com/a(b).png "图注（草稿)")'
    expect(locateImage(doc, 'photo', 1)?.end).toBe(doc.length - 1)
    expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe('![photo](img:NEW)')
  })

  it('applies all three operations to empty, plain and img:key sources', () => {
    for (const src of ['', 'https://example.com/plain.png', 'img:old']) {
      const doc = `前文\n\n![photo](${src})\n\n后文\n`
      expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe('前文\n\n![photo](img:NEW)\n\n后文\n')
      expect(clearImageSrc(doc, 'photo', 1)).toBe('前文\n\n![photo]()\n\n后文\n')
      expect(removeImageLine(doc, 'photo', 1)).toBe('前文\n\n后文\n')
    }
  })

  it('targets the right image when an earlier one has parentheses in its source', () => {
    const doc = [
      '![同图注](https://example.com/a(b).png)',
      '',
      '正文里夹着 ![行内图](https://example.com/x(y).png) 一张图。',
      '',
      '![同图注](img:second)',
      '',
    ].join('\n')
    const mats = collectMaterials(parseMarkdown(doc))
    expect(mats.map((m) => m.occurrence)).toEqual([1, 3])
    const out = fillImageSrc(doc, '同图注', 3, 'img:NEW')
    expect(out).toContain('![同图注](https://example.com/a(b).png)')
    expect(out).toContain('![同图注](img:NEW)')
    expect(out).not.toContain('img:second')
  })

  it('keeps the rest of the line when the image shares it with text', () => {
    const doc = '正文前 ![photo](https://example.com/a(b).png) 正文后'
    expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe('正文前 ![photo](img:NEW) 正文后')
    expect(removeImageLine(doc, 'photo', 1)).toBe('正文前  正文后')
  })

  it('leaves fenced and commented examples with parentheses untouched', () => {
    const doc = [
      '```md',
      '![photo](https://example.com/a(b).png)',
      '```',
      '',
      '<!-- ![photo](https://example.com/c(d).png) -->',
      '',
      '![photo](https://example.com/real(e).png)',
      '',
    ].join('\n')
    const out = fillImageSrc(doc, 'photo', 1, 'img:NEW')
    expect(out).toContain('```md\n![photo](https://example.com/a(b).png)\n```')
    expect(out).toContain('<!-- ![photo](https://example.com/c(d).png) -->')
    expect(out).toContain('![photo](img:NEW)')
    expect(out).not.toContain('real(e).png')
  })

  it('refuses a destination the parser cannot close, instead of editing the tail', () => {
    const doc = '![photo](https://example.com/a(b.png)'
    expect(collectMaterials(parseMarkdown(doc))).toHaveLength(0)
    expect(locateImage(doc, 'photo', 1)).toBeNull()
    expect(canLocateImage(doc, 'photo', 1)).toBe(false)
    expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe(doc)
    expect(clearImageSrc(doc, 'photo', 1)).toBe(doc)
    expect(removeImageLine(doc, 'photo', 1)).toBe(doc)
  })

  it('does not reach across a blank line to close an unclosed title', () => {
    const doc = [
      '![photo](https://example.com/a(b).png "unclosed',
      '',
      '正文 "t")',
      '',
    ].join('\n')
    expect(collectMaterials(parseMarkdown(doc))).toHaveLength(0)
    expect(locateImage(doc, 'photo', 1)).toBeNull()
    expect(fillImageSrc(doc, 'photo', 1, 'img:NEW')).toBe(doc)
  })
})

describe('carousel and gallery slides with parentheses in their sources', () => {
  const CAROUSEL = [
    ':::carousel 4:3 括号图',
    '![同图注](https://example.com/a(b).png)',
    '![同图注](https://example.com/c(d).png)',
    ':::',
    '',
  ].join('\n')

  it('clears only the addressed slide and keeps the other one intact', () => {
    const out = clearImageSrc(CAROUSEL, '同图注', 2)
    expect(out).toContain('![同图注](https://example.com/a(b).png)')
    expect(out).toContain('![同图注]()')
    expect(out).not.toContain('c(d)')
    expect(out).toContain(':::carousel 4:3 括号图')
  })

  it('removes only the addressed slide line', () => {
    const out = removeImageLine(CAROUSEL, '同图注', 1)
    expect(out).not.toContain('a(b)')
    expect(out).toContain('![同图注](https://example.com/c(d).png)')
    expect(out).toContain(':::')
  })

  const GALLERY = [
    ':::gallery 2 4:3 括号网格',
    '![网格](https://example.com/g(1).png)',
    '![网格](https://example.com/g(2).png)',
    ':::',
    '',
  ].join('\n')

  it('fills only the addressed gallery cell', () => {
    const out = fillImageSrc(GALLERY, '网格', 2, 'img:NEW')
    expect(out).toContain('![网格](https://example.com/g(1).png)')
    expect(out).toContain('![网格](img:NEW)')
    expect(out).not.toContain('g(2)')
  })
})

describe('setCarouselRatio targets one carousel', () => {
  const TWO = [
    ':::carousel 4:3 第一组',
    '![a](img:a)',
    '![b](img:b)',
    ':::',
    '',
    ':::carousel 4:3 第二组',
    '![c](img:c)',
    '![d](img:d)',
    ':::',
    '',
  ].join('\n')

  it('changes only the requested carousel', () => {
    const out = setCarouselRatio(TWO, 2, '1:1')
    expect(out).toContain(':::carousel 4:3 第一组')
    expect(out).toContain(':::carousel 1:1 第二组')
  })
})
