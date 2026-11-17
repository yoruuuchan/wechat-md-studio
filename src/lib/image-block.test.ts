import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { THEMES, getTheme } from './themes'

// A standalone image is one block: the picture and its caption share a wrapper
// whose margins are the block's outer spacing. Copying only the image then keeps
// that spacing instead of collapsing to the tighter gap between the two inner
// paragraphs (see selection-copy.test.ts for the copy side).

const SIG = { layout: '排版', proof: '校对', review: '审核' }
const IMG = '![说明](https://example.com/a.png)\n'

function render(themeId: string): string {
  return renderDoc(parseMarkdown(IMG), getTheme(themeId), SIG, (s) => s).html
}

describe('image block', () => {
  it('keeps the picture and its caption inside one block', () => {
    const html = render('golden')
    expect(html).toContain('<section style="margin:0 0 24px;"><p style="margin:24px 0;')
    expect(html).toMatch(/<section style="margin:0 0 24px;">.*<img .*图1 说明.*<\/section>/)
    // The caption no longer ends the block with its own bottom margin.
    expect(html).not.toContain('margin:8px 0 24px')
    expect(html).not.toContain('margin:24px 0 8px')
  })

  it('carries the theme caption spacing onto the block', () => {
    expect(render('paper-editorial')).toContain('<section style="margin:0 20px 32px;">')
    expect(render('kunlun-snowline')).toContain('<section style="margin:0 20px 30px;">')
  })

  it('uses the editor 24px paragraph default inside every theme block', () => {
    for (const theme of THEMES) {
      const html = theme.imageBlock('https://example.com/a.png', '图1说明')
      const inner = html.replace(/^<section[^>]*>/, '')
      const margins = [...inner.matchAll(/<(?:p|section) style="margin:([^;"]+)/g)].map((m) => m[1])
      expect(margins.length, theme.id).toBeGreaterThan(0)
      expect(margins.every((m) => m === '24px 0'), `${theme.id}: ${margins.join(' | ')}`).toBe(true)
    }
  })
})
