import { describe, expect, it, vi } from 'vitest'
import { TEX_PACKAGES, TEX_PACKAGE_NAMES, createMathRenderer } from './math'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { mathFailure } from './theme-fallbacks'
import { THEMES } from './themes'

const sig = { layout: '排版', proof: '校对', review: '审核' }
const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="12" viewBox="0 0 40 12"><g fill="currentColor"><path d="M0 0h40v12H0z"></path></g></svg>'

describe('display equations', () => {
  it('parses $$…$$ on its own lines as a math block', () => {
    const doc = parseMarkdown('前言。\n\n$$\nx = \\frac{-b}{2a}\n$$\n\n后语。\n')
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'math', 'paragraph'])
    const math = doc.blocks[1]
    if (math.type !== 'math') throw new Error('expected math')
    expect(math.tex).toBe('x = \\frac{-b}{2a}')
    expect(math.display).toBe(true)
  })

  it('keeps the newlines of a multi-line formula', () => {
    // inline.content joins soft-broken lines, which would corrupt an aligned
    // environment; the parser must reconstruct them.
    const doc = parseMarkdown('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n')
    const math = doc.blocks[0]
    if (math.type !== 'math') throw new Error('expected math')
    expect(math.tex).toContain('\n')
    expect(math.tex.startsWith('\\begin{aligned}')).toBe(true)
  })

  it('accepts a single-line equation', () => {
    const doc = parseMarkdown('$$E = mc^2$$\n')
    expect(doc.blocks[0].type).toBe('math')
  })

  it('leaves a lone $$ inside prose alone', () => {
    // A price or a stray dollar sign must not swallow the rest of the article.
    const doc = parseMarkdown('花了 $$5 和 $$10 两笔钱。\n')
    expect(doc.blocks[0].type).toBe('paragraph')
  })

  it('does not treat an inline $5 as math', () => {
    const doc = parseMarkdown('价格是 $5 不是公式。\n')
    expect(doc.blocks[0].type).toBe('paragraph')
  })

  it('records the source span of the equation', () => {
    const src = '---\ntitles:\n  - 甲\n---\n\n$$\nx=1\n$$\n'
    const doc = parseMarkdown(src)
    const math = doc.blocks[0]
    if (math.type !== 'math') throw new Error('expected math')
    expect(src.split('\n')[math.line]).toBe('$$')
  })
})

describe('rendering equations', () => {
  const doc = parseMarkdown('正文。\n\n$$E = mc^2$$\n\n结尾。\n')

  it('emits the resolved SVG', () => {
    const { html } = renderDoc(doc, THEMES[0], sig, (s) => s, () => FAKE_SVG)
    expect(html).toContain(FAKE_SVG)
    expect(html).not.toContain('E = mc^2')
  })

  it('shows the TeX as a placeholder while the resolver has nothing', () => {
    const { html } = renderDoc(doc, THEMES[0], sig, (s) => s, () => null)
    expect(html).toContain('E = mc^2')
    expect(html).not.toContain('<svg')
  })

  it('keeps the element count identical between the two states', () => {
    // The scroll mapping is an index into the root section's children; if the
    // pending and rendered states emitted different shapes, the preview would
    // jump the moment MathJax finished.
    const pending = renderDoc(doc, THEMES[0], sig, (s) => s, () => null)
    const ready = renderDoc(doc, THEMES[0], sig, (s) => s, () => FAKE_SVG)
    expect(pending.blockOffsets).toEqual(ready.blockOffsets)
  })

  it('keeps the element count identical when a formula fails', () => {
    const pending = renderDoc(doc, THEMES[0], sig, (s) => s, () => null)
    const failed = renderDoc(doc, THEMES[0], sig, (s) => s, (tex) => mathFailure(tex))
    expect(pending.blockOffsets).toEqual(failed.blockOffsets)
  })

  it('keeps the failure box inside the platform red lines', () => {
    const { html } = renderDoc(doc, THEMES[0], sig, (s) => s, (tex) => mathFailure(tex))
    expect(html).toContain('公式无法编译')
    expect(html).not.toMatch(/\s(class|id)=|<script|<style|<div/i)
    const bare = html
      .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    expect(bare).toEqual([])
  })

  it('stays inside the platform red lines in every theme', () => {
    for (const theme of THEMES) {
      const { html } = renderDoc(doc, theme, sig, (s) => s, () => FAKE_SVG)
      expect(html, theme.id).not.toMatch(/\sclass=/i)
      expect(html, theme.id).not.toMatch(/\sid=/i)
      expect(html, theme.id).not.toMatch(/<style/i)
      expect(html, theme.id).not.toMatch(/<script/i)
      expect(html, theme.id).not.toMatch(/<div/i)
      // The SVG carries no text nodes, so the leaf-span rule still holds.
      const bare = html
        .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
      expect(bare, theme.id).toEqual([])
    }
  })

  it('counts the formula into the article stats', () => {
    const { stats } = renderDoc(doc, THEMES[0], sig, (s) => s, () => FAKE_SVG)
    expect(stats.chars).toBeGreaterThan('正文。'.length)
  })
})

describe('the lazy renderer', () => {
  it('publishes a new snapshot when a formula lands', async () => {
    const r = createMathRenderer()
    const before = r.snapshot()
    expect(before.get('E = mc^2', true)).toBeNull()

    let notified = 0
    const off = r.subscribe(() => {
      notified++
    })
    expect(await r.warm('E = mc^2', true)).toBe(true)
    off()

    const after = r.snapshot()
    // A caller holding the old view must not see the new SVG: swapping identity
    // is the only signal it has that a re-render is worth doing.
    expect(after).not.toBe(before)
    expect(before.get('E = mc^2', true)).toBeNull()
    expect(after.get('E = mc^2', true)).toMatch(/^<svg/)
    expect(after.get('E = mc^2', true)).toContain('<path')
    expect(after.get('E = mc^2', false)).toBeNull()
    expect(notified).toBe(1)
  }, 60000)

  it('renders one formula once when asked twice at the same time', async () => {
    const r = createMathRenderer()
    let notified = 0
    const off = r.subscribe(() => {
      notified++
    })
    const [a, b] = await Promise.all([r.warm('x = 1', true), r.warm('x = 1', true)])
    off()
    expect([a, b]).toEqual([true, true])
    expect(notified).toBe(1)
    expect(await r.warm('x = 1', true)).toBe(true)
  }, 60000)

  it('shows the TeX back when a formula does not compile', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = createMathRenderer()
    const before = r.snapshot()
    let notified = 0
    const off = r.subscribe(() => {
      notified++
    })

    expect(await r.warm('\\frac{1}{', true)).toBe(false)

    const after = r.snapshot()
    expect(after).not.toBe(before)
    const shown = after.get('\\frac{1}{', true) ?? ''
    // MathJax's own fallback is a red merror box with a mirrored <text> node;
    // none of that may reach the article.
    expect(shown).toContain('\\frac{1}{')
    expect(shown).not.toContain('<svg')
    expect(shown).not.toContain('merror')
    expect(notified).toBe(1)
    expect(logged).toHaveBeenCalledWith('[math] render failed', '\\frac{1}{', expect.anything())

    // Retrying must not re-run MathJax over TeX that already failed.
    expect(await r.warm('\\frac{1}{', true)).toBe(false)
    expect(notified).toBe(1)
    off()
    logged.mockRestore()
  }, 60000)
})

describe('the TeX package allowlist', () => {
  const EXCLUDED = ['html', 'require', 'autoload', 'setoptions', 'action', 'noerrors', 'noundefined']

  it('leaves out every package that can inject markup, load itself, or hide a failure', () => {
    for (const name of EXCLUDED) expect(TEX_PACKAGE_NAMES, name).not.toContain(name)
  })

  it('names and modules agree: every listed package has a loader that resolves', async () => {
    // Registration is a side effect of importing the configuration module, so a
    // name with no module behind it would be dropped with a console warning and
    // its commands would silently stop working.
    const loaded = await Promise.all(Object.values(TEX_PACKAGES).map((load) => load()))
    expect(loaded).toHaveLength(TEX_PACKAGE_NAMES.length)
  }, 60000)

  const samples: Record<string, string> = {
    base: 'a^2 + \\frac{1}{2}',
    ams: '\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}',
    amscd: '\\begin{CD}A @>a>> B\\end{CD}',
    bbox: '\\bbox[5px, border: 1px solid red]{x}',
    boldsymbol: '\\boldsymbol{\\alpha}',
    braket: '\\braket{\\phi | \\psi}',
    bussproofs: '\\begin{prooftree}\\AxiomC{A}\\UnaryInfC{B}\\end{prooftree}',
    cancel: '\\cancel{x} + \\bcancel{y}',
    cases: '\\begin{cases}1 & x>0\\\\ 0 & x\\le 0\\end{cases}',
    centernot: '\\centernot\\longrightarrow',
    color: '\\textcolor{blue}{x}',
    colorv2: '\\color{green}y',
    colortbl: '\\begin{array}{c}\\cellcolor{red}a\\end{array}',
    empheq: '\\begin{empheq}{align}x&=1\\end{empheq}',
    enclose: '\\enclose{circle}{x}',
    gensymb: '\\degree\\celsius\\perthousand',
    mathtools: '\\coloneqq',
    mhchem: '\\ce{H2O}',
    newcommand: '\\def\\z{1}\\z',
    physics: '\\dv{f}{x}',
    tagformat: 'x \\tag{1}',
    textcomp: '\\textdegree',
    textmacros: '\\text{a \\textbf{b}}',
    upgreek: '\\upalpha',
    unicode: '\\unicode{x3B1}',
    verb: '\\verb|a b|',
  }

  it('registers each package it claims to support', async () => {
    const r = createMathRenderer()
    const missing: string[] = []
    for (const [name, tex] of Object.entries(samples)) {
      if (!(await r.warm(tex, true))) missing.push(name)
    }
    expect(missing).toEqual([])
  }, 120000)
})

describe('hostile TeX', () => {
  // Every one of these is a command the `html` extension defines. The allowlist
  // does not load it, so they are not "filtered" - they do not exist, and the
  // author sees the TeX back instead of markup in the article.
  const hostile = [
    ['\\href with a javascript URL', '\\href{javascript:alert(1)}{x}'],
    ['\\href with an escaped javascript URL', '\\href{java\\script:alert(1)}{x}'],
    ['\\href with a data URL', '\\href{data:text/html,<script>alert(1)</script>}{x}'],
    ['\\style with a url()', '\\style{background:url(https://evil.example/pixel.png)}{x}'],
    ['\\style with behavior', '\\style{behavior:url(#default#time2)}{x}'],
    ['\\class', '\\class{evil}{x}'],
    ['\\cssId', '\\cssId{evil}{x}'],
    ['\\require pulling html back in', '\\require{html}\\href{javascript:alert(1)}{y}'],
    ['\\autoload pulling html back in', '\\autoload{html}\\href{javascript:alert(1)}{z}'],
    ['\\setOptions', '\\setOptions{formatError:null}x'],
  ] as const

  it.each(hostile)('refuses %s', async (_name, tex) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = createMathRenderer()
    expect(await r.warm(tex, true)).toBe(false)
    const shown = r.snapshot().get(tex, true) ?? ''
    // What the author gets instead is the TeX itself as escaped text. The
    // payload words do appear - as text, which is the point - so the assertion
    // is about the tags and their attributes, not about the words.
    expect(shown).toContain('公式无法编译')
    expect(shown).not.toContain('<svg')
    for (const tag of shown.match(/<[^>]*>/g) ?? []) {
      expect(tag, tag).not.toMatch(/<\/?(svg|a|script|style|iframe|image|use|foreignObject)\b/i)
      expect(tag, tag).not.toMatch(/\son[a-z]+=/i)
      expect(tag, tag).not.toMatch(/\s(href|class|id|src|xlink:href)=/i)
      expect(tag, tag).not.toMatch(/url\(/i)
    }
    logged.mockRestore()
  }, 60000)

  it('leaves no exploitable attribute in the markup of an ordinary formula', async () => {
    const r = createMathRenderer()
    const benign = [
      'E = mc^2',
      'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      '\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}',
      '\\text{速度} = 5\\,\\mathrm{m/s}',
      '\\color{red}{x}',
      '\\mathbb{R}^n',
      '\\sum_{i=1}^{n} i^2',
    ]
    for (const tex of benign) {
      expect(await r.warm(tex, true), tex).toBe(true)
      const svg = r.snapshot().get(tex, true) ?? ''
      expect(svg, tex).toMatch(/^<svg/)
      expect(svg, tex).not.toContain('<mjx-container')
      expect(svg, tex).not.toMatch(/<a[\s>]/i)
      expect(svg, tex).not.toMatch(/\shref=/i)
      expect(svg, tex).not.toMatch(/\son[a-z]+=/i)
      expect(svg, tex).not.toMatch(/\sclass=/i)
      expect(svg, tex).not.toMatch(/\sid=/i)
      expect(svg, tex).not.toMatch(/javascript:|url\(/i)
    }
  }, 120000)

  it('keeps the TeX source out of the markup it does emit', async () => {
    // data-latex would carry the raw formula (including anything the author
    // typed) into the article as an attribute value.
    const r = createMathRenderer()
    const tex = 'x = \\sqrt{2}'
    expect(await r.warm(tex, true)).toBe(true)
    const svg = r.snapshot().get(tex, true) ?? ''
    expect(svg).not.toContain('data-latex')
    expect(svg).not.toContain('\\sqrt')
  }, 60000)
})
