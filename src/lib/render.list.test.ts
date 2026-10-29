import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { THEMES } from './themes'

const SIG = { layout: 'L', proof: 'P', review: 'R' }

describe('nested list rendering across the full theme registry', () => {
  const source = [
    '- outer',
    '  - inner',
    '    - deep',
    '  - inner sibling',
    '- after',
    '',
    '3. three',
    '4. four',
    '   1. child',
    '5. five',
  ].join('\n')

  it.each(THEMES.map((theme) => [theme.id, theme] as const))(
    '%s keeps order, hierarchy and text for every list item',
    (_id, theme) => {
      const html = renderDoc(parseMarkdown(source), theme, SIG).html
      const texts = ['outer', 'inner', 'deep', 'inner sibling', 'after', 'three', 'four', 'child', 'five']
      let cursor = -1
      for (const text of texts) {
        const at = html.indexOf(text, cursor + 1)
        expect(at, `${theme.id} lost or reordered ${text}`).toBeGreaterThan(cursor)
        cursor = at
      }
      expect((html.match(/<ul/g) || []).length).toBeGreaterThanOrEqual(2)
      expect((html.match(/<ol/g) || []).length).toBeGreaterThanOrEqual(2)
      expect((html.match(/<li/g) || []).length).toBeGreaterThanOrEqual(8)
      expect(html).not.toMatch(/<(ul|ol|li)[^>]*class=/)
      expect(html).not.toMatch(/<(div|script|style)[\s>]/i)
      expect(html).not.toMatch(/\s(class|id)=/i)
    },
  )

  it.each(THEMES.map((theme) => [theme.id, theme] as const))(
    '%s honors an ordered-list starting number',
    (_id, theme) => {
      const html = theme.listBlock(true, ['<span leaf="">alpha</span>', '<span leaf="">beta</span>'], 3)
      const leafText = [...html.matchAll(/<span leaf="">([^<]*)<\/span>/g)].map((m) => m[1])
      expect(
        /<ol[^>]*start="3"/.test(html) ||
        (leafText.some((value) => Number(value) === 3) && leafText.some((value) => Number(value) === 4)),
      ).toBe(true)
    },
  )

  it.each(THEMES.map((theme) => [theme.id, theme] as const))(
    '%s keeps the existing flat-list renderer',
    (_id, theme) => {
      const doc = parseMarkdown('3. alpha\n4. beta\n')
      const html = renderDoc(doc, theme, SIG).html
      const expected = theme.listBlock(
        true,
        [theme.seg({ text: 'alpha' }), theme.seg({ text: 'beta' })],
        3,
      )
      expect(html).toContain(expected)
    },
  )
})
