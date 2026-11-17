import { describe, expect, it } from 'vitest'
import { catalogEntryOf } from './theme-meta'
import { CORE_THEMES } from './themes-core'
import { EXTRA_THEMES } from './themes-extra'
import { DESIGN_THEMES } from './themes-design'
import { LOCAL_THEME_CATALOG, LOCAL_THEME_MODULE } from './themes-local-catalog'
import { getCachedTheme, loadAllThemes, loadTheme } from './theme-api'
import { THEMES } from './themes'

const STALE = 'themes-local-catalog.ts is stale: run `npm run gen:local-themes`'

describe('generated local theme catalog', () => {
  it('matches the metadata of the theme objects', () => {
    const live = [...CORE_THEMES, ...EXTRA_THEMES, ...DESIGN_THEMES].map(catalogEntryOf)
    expect(JSON.parse(JSON.stringify(live)), STALE).toEqual(LOCAL_THEME_CATALOG)
  })

  it('names the module each local theme lives in', () => {
    const expected = Object.fromEntries([
      ...CORE_THEMES.map((theme) => [theme.id, 'core']),
      ...EXTRA_THEMES.map((theme) => [theme.id, 'extra']),
      ...DESIGN_THEMES.map((theme) => [theme.id, 'design']),
    ])
    expect(LOCAL_THEME_MODULE, STALE).toEqual(expected)
  })
})

describe('local themes through the theme API', () => {
  it('serves core themes synchronously and loads a design theme on demand', async () => {
    expect(getCachedTheme(CORE_THEMES[0].id)).toBe(CORE_THEMES[0])
    const design = DESIGN_THEMES[0]
    expect(await loadTheme(design.id)).toBe(design)
    expect(getCachedTheme(design.id)).toBe(design)
    const extra = EXTRA_THEMES[0]
    expect(await loadTheme(extra.id)).toBe(extra)
  })

  it('keeps the full registry order for loadAllThemes', async () => {
    expect((await loadAllThemes()).map((theme) => theme.id)).toEqual(THEMES.map((theme) => theme.id))
  })
})
