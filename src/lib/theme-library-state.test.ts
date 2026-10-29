import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_COMPARE_THEMES,
  __resetThemeLibraryStateForTests,
  loadThemeLibraryState,
  sanitizeThemeLibraryState,
  saveThemeLibraryState,
  toggleCompareTheme,
} from './theme-library-state'

describe('theme library UI state', () => {
  beforeEach(() => {
    __resetThemeLibraryStateForTests()
  })

  it('treats missing or corrupt state as the clean library', () => {
    expect(sanitizeThemeLibraryState(null)).toEqual({
      query: '',
      tags: [],
      levels: [],
      colors: [],
      sources: [],
      favOnly: false,
      source: 'sample',
      scrollY: 0,
    })
    expect(sanitizeThemeLibraryState('nope').source).toBe('sample')
    expect(loadThemeLibraryState().scrollY).toBe(0)
  })

  it('keeps only values the filters can use', () => {
    const state = sanitizeThemeLibraryState({
      query: '  学术  ',
      tags: ['科技', '科技', 'not-a-tag', 42],
      levels: [2, 9, '1', 2],
      colors: ['冷色', '彩虹色'],
      sources: ['xiaohu-wechat-format', '  ', 'xiaohu-wechat-format'],
      favOnly: true,
      source: 'current',
      scrollY: 1234.6,
    })
    expect(state.query).toBe('  学术  ')
    expect(state.tags).toEqual(['科技'])
    expect(state.levels).toEqual([2])
    expect(state.colors).toEqual(['冷色'])
    expect(state.sources).toEqual(['xiaohu-wechat-format'])
    expect(state.favOnly).toBe(true)
    expect(state.source).toBe('current')
    expect(state.scrollY).toBe(1235)
  })

  it('round-trips through session storage', () => {
    saveThemeLibraryState({
      query: '摘',
      tags: ['杂志'],
      levels: [1],
      colors: ['暖色'],
      sources: ['inkpress'],
      favOnly: true,
      source: 'current',
      scrollY: 640,
    })
    expect(loadThemeLibraryState()).toEqual({
      query: '摘',
      tags: ['杂志'],
      levels: [1],
      colors: ['暖色'],
      sources: ['inkpress'],
      favOnly: true,
      source: 'current',
      scrollY: 640,
    })
  })

  it('allows two or three candidates and rejects a fourth without dropping earlier picks', () => {
    let ids: string[] = []
    for (const id of ['a', 'b', 'c']) ids = toggleCompareTheme(ids, id).ids
    expect(ids).toEqual(['a', 'b', 'c'])
    expect(MAX_COMPARE_THEMES).toBe(3)

    const rejected = toggleCompareTheme(ids, 'd')
    expect(rejected.ids).toEqual(['a', 'b', 'c'])
    expect(rejected.added).toBe(false)
    expect(rejected.limitReached).toBe(true)

    const removed = toggleCompareTheme(ids, 'b')
    expect(removed.ids).toEqual(['a', 'c'])
    expect(removed.added).toBe(false)
  })
})