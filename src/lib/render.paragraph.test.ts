import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { THEMES, paperEditorialTheme } from './themes'

const SIG = { layout: 'L', proof: 'P', review: 'R' }

/** text-indent of each paragraph whose text starts with 段, in document order. */
function indents(html: string): string[] {
  return [...html.matchAll(/<p style="([^"]*)"><span leaf="">段/g)].map(
    (m) => /text-indent:([^;]+);/.exec(m[1])?.[1] ?? '',
  )
}

describe('paragraph context', () => {
  it('marks only paragraphs that follow another paragraph as continuations', () => {
    const source = ['段零', '## 第一节', '段一', '段二', '段三', '> 引用', '段四', '段五'].join('\n\n')
    const html = renderDoc(parseMarkdown(source), paperEditorialTheme, SIG).html
    expect(indents(html)).toEqual(['0', '0', '2em', '2em', '0', '2em'])
  })

  it('treats paragraphs inside nested lists as first paragraphs', () => {
    const source = ['- 段甲', '  - 段乙', '- 段丙'].join('\n')
    const html = renderDoc(parseMarkdown(source), paperEditorialTheme, SIG).html
    expect(html).toContain('段乙')
    expect(html).not.toContain('text-indent:2em')
  })

  // Only themes listed here read the context; every other theme must render exactly as before.
  const readsContext = new Set(['paper-editorial'])
  it.each(THEMES.filter((theme) => !readsContext.has(theme.id)).map((theme) => [theme.id, theme] as const))(
    '%s renders paragraphs the same with or without context',
    (_id, theme) => {
      const inner = '<span leaf="">正文</span>'
      const plain = theme.paragraph(inner)
      expect(theme.paragraph(inner, { first: true })).toBe(plain)
      expect(theme.paragraph(inner, { first: false })).toBe(plain)
    },
  )
})
