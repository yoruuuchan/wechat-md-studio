import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { getTheme, THEMES } from './themes'

// The carousel strip is the article's one horizontally scrolling structure, and
// the part a WeChat paste touches first. These tests pin its contract at the
// string level: slides take a percentage of the strip, images take 100% of the
// slide, the crop ratio rides on the width/height attributes, and no
// `width:<n>px` survives inside the strip (fixed pixel boxes overflow narrow
// screens). The WeChat editor's paste-time structure dialog is NOT about these
// widths — it flags any horizontal scroll strip; measured 2026-10-13 with five
// control payloads, see the HANDOFF entry of that date. The browser-level proof
// (geometry, scrollability, payload identity across copies) lives in
// scripts/cdp-verify-carousel-copy.mjs.

const SIG = { layout: '排版', proof: '校对', review: '审核' }
const resolveImg = (s: string) => (s.startsWith('img:') ? `https://img.example/api/img/${s.slice(4)}` : s)

const THREE = ':::carousel 4:3 组\n![甲](img:a.png)\n![乙](img:b.png)\n![丙](img:c.png)\n:::\n'

function render(src: string, themeId = 'golden') {
  return renderDoc(parseMarkdown(src), getTheme(themeId), SIG, resolveImg).html
}

/** The strip: from its opening section to the caption paragraph's 图N line. */
function stripOf(html: string): string {
  const start = html.indexOf('<section style="margin:0;padding:0 0 6px;overflow-x:auto;white-space:nowrap;">')
  if (start < 0) throw new Error('no carousel strip in:\n' + html.slice(0, 500))
  const capIdx = html.indexOf('<span leaf="">图', start)
  return html.slice(start, html.lastIndexOf('</section>', capIdx) + '</section>'.length)
}

describe('the carousel strip', () => {
  it('writes no fixed pixel width — fixed-wide boxes overflow narrow screens', () => {
    expect(stripOf(render(THREE))).not.toMatch(/width\s*:\s*[^;"]*\d+px/i)
  })

  it('sizes slides as a percentage of the strip and images as 100% of the slide', () => {
    const strip = stripOf(render(THREE))
    expect((strip.match(/display:inline-block;vertical-align:top;width:88%/g) || [])).toHaveLength(3)
    const imgs = strip.match(/<img\b[^>]*>/g) || []
    expect(imgs).toHaveLength(3)
    for (const img of imgs) {
      expect(img).toMatch(/style="display:block;width:100%;height:auto;/)
      expect(img).toMatch(/width="\d+" height="\d+"/)
    }
  })

  it('keeps the crop ratio on the attributes and resolves img:key to a public URL', () => {
    const strip = stripOf(render(THREE))
    expect((strip.match(/width="240" height="180"/g) || [])).toHaveLength(3)
    expect(strip).toContain('src="https://img.example/api/img/a.png"')
    expect(strip).not.toMatch(/src="img:/)
  })

  it('leaves the strip genuinely scrollable and drops the dead -webkit property', () => {
    const html = render(THREE)
    const strip = stripOf(html)
    expect(strip).toContain('overflow-x:auto;white-space:nowrap;')
    expect(html).not.toContain('-webkit-overflow-scrolling')
  })

  it('renders one strip per carousel, not one per slide', () => {
    const html = render(THREE + '\n正文\n\n' + THREE)
    expect((html.match(/overflow-x:auto;white-space:nowrap;/g) || [])).toHaveLength(2)
  })

  it('gives the last slide no trailing gutter, so the strip ends flush', () => {
    const strip = stripOf(render(THREE))
    expect((strip.match(/margin-right:2%/g) || [])).toHaveLength(2)
    expect(strip).toContain('margin-right:0;')
  })

  it('sizes placeholder boxes to the frame ratio with percentage padding only', () => {
    const strip = stripOf(render(':::carousel 16:9 组\n![甲]()\n![乙]()\n:::\n'))
    expect((strip.match(/padding:28\.125% 0/g) || [])).toHaveLength(2)
    expect(strip).not.toContain('<img')
  })

  it('holds for every theme family: handwritten and imported alike', () => {
    const ids = ['golden', 'minimal', 'steady', THEMES[THEMES.length - 1].id]
    for (const id of ids) {
      const strip = stripOf(render(THREE, id))
      expect(strip, id).not.toMatch(/width\s*:\s*[^;"]*\d+px/i)
      expect((strip.match(/width:100%;height:auto;/g) || []).length, id).toBe(3)
    }
  })
})
