import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetFavoritesForTests,
  favoritesSnapshot,
  keepKnownIds,
  loadFavoriteIds,
  sanitizeFavoriteIds,
  setFavoriteIds,
  subscribeFavorites,
  toggleId,
} from './favorites'

const FAVORITES_KEY = 'mopai.theme-favorites.v1'

class MemoryStorage {
  private map = new Map<string, string>()
  quotaExceeded = false
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.quotaExceeded) {
      const err = new Error('quota')
      err.name = 'QuotaExceededError'
      throw err
    }
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  __resetFavoritesForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetFavoritesForTests()
})

describe('sanitizeFavoriteIds', () => {
  it('keeps a clean list as-is', () => {
    expect(sanitizeFavoriteIds(['golden', 'steady'])).toEqual(['golden', 'steady'])
  })

  it('drops non-strings, blanks and duplicates while keeping order', () => {
    expect(sanitizeFavoriteIds(['b', 7, '', '  ', 'a', 'b', null, ' a '])).toEqual(['b', 'a'])
  })

  it('degrades anything that is not an array to empty', () => {
    expect(sanitizeFavoriteIds(null)).toEqual([])
    expect(sanitizeFavoriteIds('golden')).toEqual([])
    expect(sanitizeFavoriteIds({ 0: 'golden' })).toEqual([])
  })
})

describe('toggleId / keepKnownIds', () => {
  it('adds a new id at the end', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('removes an existing id and leaves the rest alone', () => {
    expect(toggleId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('filters out ids the catalog no longer has', () => {
    const known = new Set(['a', 'c'])
    expect(keepKnownIds(['a', 'removed-theme', 'c'], known)).toEqual(['a', 'c'])
    expect(keepKnownIds([], known)).toEqual([])
  })
})

describe('persistence', () => {
  it('round-trips through localStorage', () => {
    setFavoriteIds(['minimal', 'golden'])
    expect(JSON.parse(storage.getItem(FAVORITES_KEY) as string)).toEqual(['minimal', 'golden'])
    __resetFavoritesForTests()
    expect(loadFavoriteIds()).toEqual(['minimal', 'golden'])
  })

  it('treats an unreadable value as no favorites instead of throwing', () => {
    storage.setItem(FAVORITES_KEY, '{not json')
    expect(loadFavoriteIds()).toEqual([])
  })

  it('keeps the session list usable when the write fails', () => {
    setFavoriteIds(['golden'])
    storage.quotaExceeded = true
    expect(() => setFavoriteIds(['golden', 'steady'])).not.toThrow()
    // The in-memory snapshot still reflects what the user just did.
    expect(favoritesSnapshot()).toEqual(['golden', 'steady'])
  })
})

describe('snapshot + subscription', () => {
  it('serves a stable reference until something changes', () => {
    const first = favoritesSnapshot()
    expect(favoritesSnapshot()).toBe(first)
    setFavoriteIds(['golden'])
    expect(favoritesSnapshot()).not.toBe(first)
  })

  it('notifies subscribers on every write, including removals', () => {
    const seen: string[][] = []
    const off = subscribeFavorites(() => seen.push(favoritesSnapshot()))
    setFavoriteIds(['a'])
    setFavoriteIds([])
    off()
    setFavoriteIds(['b'])
    expect(seen).toEqual([['a'], []])
  })

  it('reads the written value back after a cache reset', () => {
    setFavoriteIds(['steady'])
    __resetFavoritesForTests()
    expect(favoritesSnapshot()).toEqual(['steady'])
  })
})
