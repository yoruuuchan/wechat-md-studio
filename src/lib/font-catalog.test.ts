import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHOOSABLE_FONTS, GLOBAL_FONT_SHEETS, SHARED_FONT_SHEETS, fontFamiliesIn, fontSheetsFor,
} from './font-catalog'
import { BUILTIN_CARD_FONT_FACES, CARD_FONT_SHEETS } from './cards'

function familiesDeclaredIn(sheet: string): string[] {
  const css = fs.readFileSync(path.resolve('public', sheet.replace(/^\//, '')), 'utf8')
  const names = new Set<string>()
  for (const match of css.matchAll(/font-family:\s*["']?([^;"']+)["']?\s*;/g)) names.add(match[1].trim())
  return [...names].sort()
}

describe('font sheets', () => {
  it('lists exactly the families each shared on-demand sheet declares', () => {
    for (const [sheet, families] of Object.entries(SHARED_FONT_SHEETS)) {
      expect([...families].sort(), sheet).toEqual(familiesDeclaredIn(sheet))
    }
  })

  it('imports only the global sheets from src/index.css', () => {
    const css = fs.readFileSync(path.resolve('src/index.css'), 'utf8')
    const imported = [...css.matchAll(/@import url\("([^"]+)"\)/g)].map((match) => match[1])
    expect(new Set(imported)).toEqual(GLOBAL_FONT_SHEETS)
  })

  it('can load every built-in card family that no global sheet declares', () => {
    const global = new Set([...GLOBAL_FONT_SHEETS].flatMap(familiesDeclaredIn))
    for (const family of BUILTIN_CARD_FONT_FACES.keys()) {
      if (global.has(family)) continue
      const sheets = fontSheetsFor(family)
      expect(sheets.length, family).toBeGreaterThan(0)
      for (const sheet of sheets) expect(familiesDeclaredIn(sheet), `${family} in ${sheet}`).toContain(family)
    }
  })

  it('finds a family in every sheet that declares it outside the global ones', () => {
    for (const sheet of CARD_FONT_SHEETS) {
      if (GLOBAL_FONT_SHEETS.has(sheet)) continue
      for (const family of familiesDeclaredIn(sheet)) expect(fontSheetsFor(family), family).toContain(sheet)
    }
  })

  it('needs no on-demand sheet for the interface fonts', () => {
    for (const family of ['Geist', 'Geist Mono', 'Noto Sans SC']) expect(fontSheetsFor(family)).toEqual([])
    expect(CHOOSABLE_FONTS.some((font) => font.family === 'Noto Serif SC')).toBe(true)
    // 700 is global, 400 comes from the template sheet.
    expect(fontSheetsFor('Noto Serif SC')).toEqual(['/fonts/fonts-templates.css'])
    expect(fontSheetsFor('JetBrains Mono')).toEqual(['/fonts/fonts-templates.css', '/fonts/fonts-design.css'])
  })
})

describe('fontFamiliesIn', () => {
  it('reads inline styles, entity quotes and stylesheet declarations', () => {
    const html = '<p style="font-family: &quot;EB Garamond&quot;, Georgia, serif; color: red">a</p>' +
      "<h1 style='font-family: \"Space Grotesk\", sans-serif'>b</h1>" +
      '<style>.x{font-family:VT323,monospace}</style>'
    expect([...fontFamiliesIn(html)]).toEqual(['EB Garamond', 'Georgia', 'serif', 'Space Grotesk', 'sans-serif', 'VT323', 'monospace'])
  })

  it('returns nothing for markup without font declarations', () => {
    expect(fontFamiliesIn('<p>font-family is a word here</p>').size).toBe(0)
  })
})
