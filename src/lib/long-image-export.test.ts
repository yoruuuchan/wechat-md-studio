// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LONG_CANVAS_LIMIT_KEY, canvasLimitOverride, computeTileCuts, cutCandidates, prepareLongImages,
} from './long-image-export'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('photo preparation failure', () => {
  it('keeps the original src and still lays out a row when a photo cannot be read', async () => {
    const src = 'http://blocked.invalid/a.jpg'
    document.body.innerHTML = `<div class="reed-long-root"><div class="reed-long-photos"><div class="reed-long-photo-frame"><div class="reed-long-photo-row"><figure class="reed-long-photo"><img src="${src}" alt=""></figure></div></div></div></div>`
    const root = document.querySelector<HTMLElement>('.reed-long-root')!
    const image = root.querySelector('img')!
    Object.defineProperty(image, 'decode', { value: vi.fn().mockRejectedValue(new Error('blocked')) })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')))
    const result = await prepareLongImages(root, { padX: 24, contentWidth: 492, photoGap: 4, photoInset: 13 }, {
      scale: 2,
      signal: new AbortController().signal,
    })
    expect(result.failed).toEqual([src])
    expect(image.getAttribute('src')).toBe(src)
    expect(image.dataset.longMissing).toBe('true')
    expect(root.querySelectorAll('.reed-long-photo-row')).toHaveLength(1)
  })
})

describe('tile cut planning', () => {
  it('keeps the whole page on one tile when it fits', () => {
    expect(computeTileCuts([100, 200], 1000, 2000)).toEqual([0, 1000])
  })

  it('cuts at measured module boundaries below the limit', () => {
    expect(computeTileCuts([1000, 2000, 3000], 4000, 1500)).toEqual([0, 1000, 2000, 3000, 4000])
  })

  it('falls back to the limit when no boundary is available', () => {
    expect(computeTileCuts([], 2000, 800)).toEqual([0, 800, 1600, 2000])
  })

  it('never returns a cut beyond the page or at zero', () => {
    expect(computeTileCuts([0, 2000, 2000], 2000, 1200)).toEqual([0, 1200, 2000])
  })

  it('offers paragraph edges inside the preamble, so an article without H2 is not cut mid-line', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="reed-long-flow"><div class="reed-long-header"></div>' +
      '<div class="reed-long-preamble"><p></p><p></p><p></p></div></div>'
    const box = (element: Element, top: number, bottom: number) => {
      element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top } as DOMRect)
    }
    box(root, 0, 12600)
    box(root.querySelector('.reed-long-header')!, 0, 600)
    box(root.querySelector('.reed-long-preamble')!, 600, 12600)
    const paragraphs = root.querySelectorAll('.reed-long-preamble > p')
    box(paragraphs[0], 600, 4800)
    box(paragraphs[1], 4800, 9000)
    box(paragraphs[2], 9000, 12600)
    const candidates = cutCandidates(root)
    expect(candidates).toEqual(expect.arrayContaining([4800, 9000]))
    expect(computeTileCuts(candidates, 12600, 5000)).toEqual([0, 4800, 9000, 12600])
  })
})

describe('test-only canvas limit override', () => {
  it('accepts a valid override and rejects malformed values', () => {
    localStorage.setItem(LONG_CANVAS_LIMIT_KEY, JSON.stringify({ maxEdge: 1200, maxArea: 2000000 }))
    expect(canvasLimitOverride()).toEqual({ maxEdge: 1200, maxArea: 2000000 })
    for (const value of ['{', JSON.stringify({ maxEdge: 100 }), JSON.stringify({ maxEdge: 1200, maxArea: -1 })]) {
      localStorage.setItem(LONG_CANVAS_LIMIT_KEY, value)
      expect(canvasLimitOverride()).toBeNull()
    }
  })
})
