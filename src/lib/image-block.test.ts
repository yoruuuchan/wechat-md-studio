import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { getTheme } from './themes'

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
    expect(html).toContain('<section style="margin:0 0 24px;"><p style="margin:24px 0 8px;')
    expect(html).toMatch(/<section style="margin:0 0 24px;">.*<img .*图1 说明.*<\/section>/)
    // The caption no longer ends the block with its own bottom margin.
    expect(html).not.toContain('margin:8px 0 24px')
  })

  it('carries the theme caption spacing onto the block', () => {
    expect(render('paper-editorial')).toContain('<section style="margin:0 0 32px;">')
    expect(render('kunlun-snowline')).toContain('<section style="margin:0 0 30px;">')
  })
})
