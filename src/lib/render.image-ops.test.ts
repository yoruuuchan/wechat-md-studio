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
})
