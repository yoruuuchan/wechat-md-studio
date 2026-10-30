import { describe, expect, it } from 'vitest'
import { THEMES } from './themes'
import { THEME_CATALOG, THEME_COUNT } from './theme-catalog'
import { catalogEntryOf } from './theme-meta'
import { loadAllThemes, loadTheme } from './theme-api'

describe('theme catalog', () => {
  it('keeps every registered theme, in order, with the same metadata', () => {
    expect(THEME_COUNT).toBe(THEMES.length)
    expect(THEME_CATALOG.map((entry) => entry.id)).toEqual(THEMES.map((theme) => theme.id))

    for (let i = 0; i < THEMES.length; i += 1) {
      const theme = THEMES[i]
      const entry = THEME_CATALOG[i]
      expect(entry.id).toBe(theme.id)
      expect(entry.name).toBe(theme.name)
      expect(entry.desc).toBe(theme.desc)
      expect(entry.category).toBe(theme.category)
      expect(entry.ui).toEqual(theme.ui)
      expect(entry.meta).toEqual(theme.meta)
    }
  })

  it('attributes every imported theme to a generated source pack', () => {
    for (const entry of THEME_CATALOG) {
      if (entry.meta.origin.kind === 'ported' && entry.meta.origin.project !== 'gzh-design-skill') {
        expect(entry.source, entry.id).toBeTruthy()
      }
    }
  })

  it('loads the pack for a single imported theme', async () => {
    const theme = await loadTheme('wenyan-default')
    expect(theme.id).toBe('wenyan-default')
    const entry = THEME_CATALOG.find((item) => item.id === 'wenyan-default')
    expect(entry).toBeTruthy()
    const withoutSource = { ...entry! }
    delete withoutSource.source
    expect(catalogEntryOf(theme)).toEqual(withoutSource)
  })

  it('loads all implementations in registry order', async () => {
    const themes = await loadAllThemes()
    expect(themes.map((theme) => theme.id)).toEqual(THEMES.map((theme) => theme.id))
  })
})