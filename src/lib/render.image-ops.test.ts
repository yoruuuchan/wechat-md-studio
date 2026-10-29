import { describe, expect, it } from 'vitest'
import {
  canLocateImage,
  clearImageSrc,
  collectMaterials,
  fillImageSrc,
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

  // The ordinal comes from collectMaterials(), i.e. from the parser's carousel
  // list. Counting `:::carousel` lines instead let anything parked in a code
  // block or a note take a number, so every real carousel after it was off by
  // one and the sidebar rewrote the example.
  describe('numbers carousels the way the parser does', () => {
    const withExamples = [
      '```md',
      ':::carousel 1:1 示例一',
      '![x]()',
      '![y]()',
      ':::',
      '```',
      '',
      '~~~md',
      ':::carousel 16:9 示例二',
      '![x]()',
      '![y]()',
      ':::',
      '~~~',
      '',
      '<!-- :::carousel 9:16 单行备注 -->',
      '',
      '<!--',
      ':::carousel 9:16 多行备注',
      '![x]()',
      '![y]()',
      ':::',
      '-->',
      '',
      ':::carousel 4:3 真实一',
      '![a]()',
      '![b]()',
      ':::',
      '',
      ':::carousel 4:3 真实二',
      '![c]()',
      '![d]()',
      ':::',
      '',
    ].join('\n')

    it('skips fenced examples and notes, so the first real carousel is 1', () => {
      const out = setCarouselRatio(withExamples, 1, '3:4')
      expect(out).toContain(':::carousel 3:4 真实一')
      expect(out).toContain(':::carousel 4:3 真实二')
      expect(out).toContain(':::carousel 1:1 示例一')
      expect(out).toContain(':::carousel 16:9 示例二')
      expect(out).toContain('<!-- :::carousel 9:16 单行备注 -->')
      expect(out).toContain(':::carousel 9:16 多行备注')
    })

    it('leaves every example and the earlier real carousel byte-identical', () => {
      const out = setCarouselRatio(withExamples, 2, '9:16')
      const before = withExamples.split('\n')
      const after = out.split('\n')
      const changed = before.flatMap((line, i) => (line === after[i] ? [] : [i]))
      expect(changed).toEqual([before.indexOf(':::carousel 4:3 真实二')])
      expect(after[changed[0]]).toBe(':::carousel 9:16 真实二')
    })

    it('ignores front matter that mentions a carousel', () => {
      const doc = [
        '---',
        'titles:',
        '  - :::carousel 9:16 示例',
        '---',
        ':::carousel 4:3 正文轮播',
        '![a]()',
        '![b]()',
        ':::',
        '',
      ].join('\n')
      const out = setCarouselRatio(doc, 1, '1:1')
      expect(out).toContain('  - :::carousel 9:16 示例')
      expect(out).toContain(':::carousel 1:1 正文轮播')
    })

    it('does not count the :::carousel-open form the parser never accepted', () => {
      const doc = [
        ':::carousel-open 1:1 旧示例',
        '![x]()',
        '![y]()',
        ':::carousel-close',
        '',
        ':::carousel 4:3 真实',
        '![a]()',
        '![b]()',
        ':::',
        '',
      ].join('\n')
      const out = setCarouselRatio(doc, 1, '9:16')
      expect(out).toContain(':::carousel-open 1:1 旧示例')
      expect(out).toContain(':::carousel 9:16 真实')
    })
  })

  describe('the fence and closing forms the parser really accepts', () => {
    const MIXED = [
      ':::carousel 第一组',
      '![a]()',
      '![b]()',
      ':::',
      '',
      '::::carousel 16:9 第二组',
      '![c]()',
      '![d]()',
      '::::',
      '',
      ':::carousel 9:16 第三组',
      '![e]()',
      '![f]()',
    ].join('\n') // last one is left unclosed, which the parser also accepts

    it('adds a ratio to an opener that has none', () => {
      const out = setCarouselRatio(MIXED, 1, '1:1')
      expect(out).toContain(':::carousel 1:1 第一组')
      expect(out).toContain('::::carousel 16:9 第二组')
      expect(out).toContain(':::carousel 9:16 第三组')
      expect(parseMarkdown(out).blocks.filter((b) => b.type === 'carousel')[0]).toMatchObject({
        ratio: '1:1',
        title: '第一组',
      })
    })

    it('keeps a longer marker and its matching closer', () => {
      const out = setCarouselRatio(MIXED, 2, '3:4')
      expect(out).toContain(':::carousel 第一组\n![a]()\n![b]()\n:::')
      expect(out).toContain('::::carousel 3:4 第二组')
      expect(out).toContain('\n::::\n')
      expect(out).toContain(':::carousel 9:16 第三组')
    })

    it('updates an unclosed last carousel and nothing else', () => {
      const out = setCarouselRatio(MIXED, 3, '1:1')
      expect(out.endsWith(':::carousel 1:1 第三组\n![e]()\n![f]()')).toBe(true)
      expect(out).toContain(':::carousel 第一组')
      expect(out).toContain('::::carousel 16:9 第二组')
    })

    it('accepts the space-after-marker form the container plugin opens', () => {
      const doc = '::: carousel 16:9 标题\n![a]()\n![b]()\n:::'
      const out = setCarouselRatio(doc, 1, '1:1')
      expect(out).toBe('::: carousel 1:1 标题\n![a]()\n![b]()\n:::')
      expect(parseMarkdown(out).blocks[0]).toMatchObject({ ratio: '1:1', title: '标题' })
    })

    it('handles two carousels back to back with no blank line', () => {
      const doc = [':::carousel 4:3 一', '![a]()', ':::', ':::carousel 4:3 二', '![b]()', ':::'].join('\n')
      const out = setCarouselRatio(doc, 2, '1:1')
      expect(out).toBe(
        [':::carousel 4:3 一', '![a]()', ':::', ':::carousel 1:1 二', '![b]()', ':::'].join('\n'),
      )
    })
  })

  describe('only the ratio token changes', () => {
    it('keeps titles, images, trailing spaces and CRLF line endings', () => {
      const doc = ':::carousel 4:3  标题  \r\n![a](img:a)\r\n![b](img:b)\r\n:::  \r\n'
      expect(setCarouselRatio(doc, 1, '1:1')).toBe(
        ':::carousel 1:1  标题  \r\n![a](img:a)\r\n![b](img:b)\r\n:::  \r\n',
      )
    })

    it('keeps a ratio the parser does not support as title text', () => {
      const doc = ':::carousel 7:5 说明\n![a]()\n![b]()\n:::'
      const out = setCarouselRatio(doc, 1, '1:1')
      expect(out).toBe(':::carousel 1:1 7:5 说明\n![a]()\n![b]()\n:::')
      expect(parseMarkdown(out).blocks[0]).toMatchObject({ ratio: '1:1', title: '7:5 说明' })
    })

    it('keeps CRLF front matter and line endings intact', () => {
      const doc = '---\r\ntitles:\r\n  - 标题\r\n---\r\n\r\n:::carousel 4:3 正文\r\n![a]()\r\n![b]()\r\n:::\r\n'
      const out = setCarouselRatio(doc, 1, '1:1')
      expect(out).toBe(doc.replace(':::carousel 4:3 正文', ':::carousel 1:1 正文'))
      expect(out).toContain('titles:\r\n  - 标题\r\n')
    })

    it('normalises only the ratio token spacing', () => {
      const doc = ':::carousel 4 : 3 标题\n![a]()\n![b]()\n:::'
      expect(setCarouselRatio(doc, 1, '16:9')).toBe(':::carousel 16:9 标题\n![a]()\n![b]()\n:::')
    })

    it('leaves the article alone for a carousel number that does not exist', () => {
      expect(setCarouselRatio(TWO, 3, '1:1')).toBe(TWO)
      expect(setCarouselRatio(TWO, 0, '1:1')).toBe(TWO)
    })

    // A fence left open swallows the rest of the file, so those carousels are
    // code to the parser as well. Refusing the edit beats writing into code.
    it('does not touch a carousel inside an unterminated fence', () => {
      const doc = [
        '```md',
        ':::carousel 4:3 未闭合代码块里的示例',
        '![a]()',
        '![b]()',
        ':::',
        '',
      ].join('\n')
      expect(setCarouselRatio(doc, 1, '1:1')).toBe(doc)
    })
  })
})

