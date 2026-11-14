import { describe, expect, it } from 'vitest'
import {
  QUICK_LOAD_BATCH,
  QUICK_PREVIEW_BATCH,
  QUICK_PREVIEW_DEBOUNCE_MS,
  QUICK_PREVIEW_ROOT_MARGIN,
  chunkQuickIds,
  planQuickPreviews,
} from './quick-preview'

const loaded = new Set(['current', 'visible-a', 'visible-b', 'offscreen-a'])
const displayed = ['favorite', 'current', 'visible-a', 'visible-b', 'offscreen-a']

describe('theme quick preview plan', () => {
  it('renders the current theme and the visible tiles, in UI order', () => {
    const plan = planQuickPreviews({
      displayed,
      visible: new Set(['visible-b', 'visible-a']),
      loaded,
      currentId: 'current',
    })
    expect(plan).toEqual(['current', 'visible-a', 'visible-b'])
  })

  it('never plans an off-screen tile, even when its implementation is cached', () => {
    const plan = planQuickPreviews({
      displayed,
      visible: new Set(['visible-a']),
      loaded,
      currentId: 'current',
    })
    expect(plan).not.toContain('offscreen-a')
  })

  it('keeps the current theme first even when its own tile is out of view', () => {
    const plan = planQuickPreviews({
      displayed: ['visible-a', 'current'],
      visible: new Set(['visible-a']),
      loaded,
      currentId: 'current',
    })
    expect(plan).toEqual(['current', 'visible-a'])
  })

  it('skips tiles whose implementation has not been loaded yet', () => {
    const plan = planQuickPreviews({
      displayed,
      visible: new Set(['visible-a', 'visible-b']),
      loaded: new Set(['current']),
      currentId: 'current',
    })
    expect(plan).toEqual(['current'])
  })

  it('does not plan a current id that is not in the panel', () => {
    const plan = planQuickPreviews({
      displayed: ['visible-a'],
      visible: new Set(['visible-a']),
      loaded,
      currentId: 'not-listed',
    })
    expect(plan).toEqual(['visible-a'])
  })
})

describe('theme quick preview scheduling helpers', () => {
  it('debounces document changes for200-250ms', () => {
    expect(QUICK_PREVIEW_DEBOUNCE_MS).toBeGreaterThanOrEqual(200)
    expect(QUICK_PREVIEW_DEBOUNCE_MS).toBeLessThanOrEqual(250)
  })

  it('prefetches roughly one row beyond the visible area', () => {
    expect(QUICK_PREVIEW_ROOT_MARGIN).toMatch(/\d+px\s+\d+px/)
    expect(QUICK_LOAD_BATCH).toBeGreaterThan(0)
    expect(QUICK_PREVIEW_BATCH).toBeGreaterThan(0)
  })

  it('chunks ids in order without dropping the tail', () => {
    expect(chunkQuickIds(['a', 'b', 'c', 'd', 'e'], 3)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ])
    expect(chunkQuickIds([], 3)).toEqual([])
  })

  it('treats a non-positive batch size as one item per batch', () => {
    expect(chunkQuickIds(['a', 'b'], 0)).toEqual([['a'], ['b']])
    expect(chunkQuickIds(['a', 'b'], -4)).toEqual([['a'], ['b']])
  })
})
