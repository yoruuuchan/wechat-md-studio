import { describe, expect, it } from 'vitest'
import { sanitizeMathSvg, sanitizeStyleValue, UnsafeMathMarkupError } from './math-sanitize'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
// The html extension is exactly what the app's package allowlist refuses to
// load. Importing it here is what lets these tests feed the sanitizer the real
// markup an attacker would get if that allowlist ever regressed.
import 'mathjax-full/js/input/tex/html/HtmlConfiguration.js'
import 'mathjax-full/js/input/tex/bbox/BboxConfiguration.js'
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const hostile = mathjax.document('', {
  InputJax: new TeX({
    packages: ['base', 'html', 'bbox', 'color', 'ams'],
    formatError: (_jax: unknown, err: unknown) => {
      throw err
    },
  }),
  OutputJax: new SVG({ fontCache: 'none' }),
  compileError: (_doc: unknown, _math: unknown, err: unknown) => {
    throw err
  },
  typesetError: (_doc: unknown, _math: unknown, err: unknown) => {
    throw err
  },
})

/** Raw, unscreened MathJax output - the shape the sanitizer has to survive. */
function rawSvg(tex: string, display = true): string {
  return adaptor.outerHTML(hostile.convert(tex, { display }) as never)
}

describe('sanitizeMathSvg over real MathJax output', () => {
  it('keeps a plain formula, and only its drawing', () => {
    const out = sanitizeMathSvg(rawSvg('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'))
    expect(out.startsWith('<svg')).toBe(true)
    expect(out.endsWith('</svg>')).toBe(true)
    expect(out).toContain('<path')
    expect(out).toContain('viewBox')
    // MathJax bookkeeping nobody needs in the article, incl. data-latex which
    // echoes the raw TeX back verbatim.
    expect(out).not.toMatch(/data-[a-z-]+=/i)
    expect(out).not.toContain('mjx-container')
    expect(out).not.toMatch(/\sclass=/i)
    expect(out).not.toMatch(/\sid=/i)
  })

  it('drops the anchor \\href produces, keeping the glyphs', () => {
    const raw = rawSvg('\\href{javascript:alert(1)}{x}')
    expect(raw).toContain('<a href="javascript:alert(1)">')
    const out = sanitizeMathSvg(raw)
    expect(out).not.toContain('<a')
    expect(out).not.toContain('href')
    expect(out).not.toContain('javascript')
    expect(out).toContain('<path')
  })

  it('drops a data: href the same way', () => {
    const out = sanitizeMathSvg(rawSvg('\\href{data:text/html,<script>alert(1)</script>}{x}'))
    expect(out).not.toContain('href')
    expect(out).not.toContain('script')
    expect(out).not.toContain('data:text/html')
  })

  it('drops \\style entirely when the value carries a URL', () => {
    const raw = rawSvg('\\style{background:url(https://evil.example/pixel.png)}{x}')
    expect(raw).toMatch(/style="[^"]*url\(/)
    const out = sanitizeMathSvg(raw)
    expect(out).not.toMatch(/url\(/)
    expect(out).not.toContain('evil.example')
  })

  it('drops \\class and \\cssId', () => {
    expect(sanitizeMathSvg(rawSvg('\\class{evil}{x}'))).not.toMatch(/class=/i)
    expect(sanitizeMathSvg(rawSvg('\\cssId{evil}{x}'))).not.toMatch(/\sid=/i)
  })

  it('keeps the colours and boxes the allowlisted packages legitimately emit', () => {
    const colored = sanitizeMathSvg(rawSvg('\\color{red}{x}'))
    expect(colored).toContain('fill="red"')

    const boxed = sanitizeMathSvg(rawSvg('\\bbox[5px, border: 2px solid red]{x}'))
    expect(boxed).toContain('style="border: 2px solid red"')
    expect(boxed).toContain('<polygon')
  })

  it('keeps CJK text as text', () => {
    const out = sanitizeMathSvg(rawSvg('中文速度 = 5 米/秒'))
    expect(out).toContain('中')
    expect(out).toContain('<text')
  })
})

describe('sanitizeMathSvg against hand-built markup', () => {
  const svg = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 1 1">${inner}</svg>`

  it('strips every on* handler', () => {
    const out = sanitizeMathSvg(svg('<g onload="alert(1)" onmouseover="x"><path d="M0 0"/></g>'))
    expect(out).not.toContain('onload')
    expect(out).not.toContain('onmouseover')
    expect(out).toContain('<path d="M0 0">')
  })

  it('strips xlink:href, href and foreign namespace urls', () => {
    const out = sanitizeMathSvg(svg('<g xlink:href="javascript:alert(1)" href="javascript:alert(1)"><path d="M0 0"/></g>'))
    expect(out).not.toContain('href')
    expect(out).not.toContain('javascript')
  })

  it('removes script, style, foreignObject and image subtrees whole', () => {
    const out = sanitizeMathSvg(
      svg(
        '<script>alert(1)</script><style>*{x:1}</style>' +
          '<foreignObject><g><path d="M0 0"/></g></foreignObject>' +
          '<image href="https://evil.example/x.png"/>' +
          '<text>ok</text>',
      ),
    )
    expect(out).not.toContain('alert(1)')
    expect(out).not.toContain('foreignObject')
    expect(out).not.toContain('<image')
    expect(out).not.toContain('evil.example')
    expect(out).not.toContain('<path')
    expect(out).toContain('ok')
  })

  it('throws on markup that is not well formed instead of reading it a browser way', () => {
    // HTML's own leniency (`<img>` as a void element, implied close tags) is
    // exactly what a smuggled payload would lean on; MathJax never writes it.
    expect(() => sanitizeMathSvg(svg('<foreignObject><img src="x" onerror="alert(1)"></foreignObject>'))).toThrow(
      UnsafeMathMarkupError,
    )
    expect(() => sanitizeMathSvg(svg('<g><path d="M0 0"></g>'))).toThrow(UnsafeMathMarkupError)
  })

  it('removes use/defs so no dangling reference can resolve', () => {
    const out = sanitizeMathSvg(svg('<defs><path id="p" d="M0 0"/></defs><use href="#p"/>'))
    expect(out).not.toContain('defs')
    expect(out).not.toContain('use')
    expect(out).not.toContain('#p')
  })

  it('rejects a value that does not match its attribute pattern', () => {
    const out = sanitizeMathSvg(svg('<g transform="javascript:alert(1) scale(1)"><path d="x &quot; onload=&quot;y"/></g>'))
    expect(out).not.toContain('javascript')
    expect(out).not.toContain('onload')
  })

  it('unwraps mjx-container and rejects anything else at the root', () => {
    const wrapped = `<mjx-container class="MathJax" jax="SVG">${svg('<path d="M0 0"/>')}</mjx-container>`
    const out = sanitizeMathSvg(wrapped)
    expect(out.startsWith('<svg')).toBe(true)
    expect(out).not.toContain('mjx-container')

    expect(() => sanitizeMathSvg('<div>hi</div>')).toThrow(UnsafeMathMarkupError)
    expect(() => sanitizeMathSvg('<svg viewBox="0 0 1 1"></svg><svg viewBox="0 0 1 1"></svg>')).toThrow(/exactly one root/)
    expect(() => sanitizeMathSvg(svg('<iframe src="x"></iframe>') + '<p>trailing</p>')).toThrow(UnsafeMathMarkupError)
  })

  it('rejects unbalanced or unparseable markup instead of guessing', () => {
    expect(() => sanitizeMathSvg(svg('<g><path d="M0 0"></svg>'))).toThrow(UnsafeMathMarkupError)
    // An unquoted attribute is not something MathJax writes, so it is damage,
    // not markup to be interpreted leniently the way a browser would.
    expect(() => sanitizeMathSvg(svg('<g onload=alert(1)><path d="M0 0"/></g>'))).toThrow(UnsafeMathMarkupError)
    expect(() => sanitizeMathSvg('<svg viewBox="0 0 1 1" <path/>')).toThrow(UnsafeMathMarkupError)
    expect(() => sanitizeMathSvg('no markup at all')).toThrow(UnsafeMathMarkupError)
  })

  it('escapes a text node that tries to open a tag or a fake entity', () => {
    const out = sanitizeMathSvg(svg('<text>a &lt; b &amp;c &fake; &lt;/text&gt;</text>'))
    expect(out).toContain('&lt;')
    expect(out).toContain('&amp;')
    expect(out).not.toContain('&fake;')
    expect(out).not.toContain('</text></text>')
  })
})

describe('sanitizeStyleValue', () => {
  it('keeps the declarations MathJax emits', () => {
    expect(sanitizeStyleValue('vertical-align: -0.025ex')).toBe('vertical-align: -0.025ex')
    expect(sanitizeStyleValue('border: 2px solid red;')).toBe('border: 2px solid red')
    expect(sanitizeStyleValue('background-color: rgba(0, 0, 0, 0.5)')).toBe('background-color: rgba(0, 0, 0, 0.5)')
  })

  it('rejects urls, unknown properties and non-values', () => {
    expect(sanitizeStyleValue('background: url(https://evil.example/x.png)')).toBeNull()
    expect(sanitizeStyleValue('background: url(javascript:alert(1))')).toBeNull()
    expect(sanitizeStyleValue('behavior: url(#default#time2)')).toBeNull()
    expect(sanitizeStyleValue('-moz-binding: url(x)')).toBeNull()
    expect(sanitizeStyleValue('position: fixed')).toBeNull()
    expect(sanitizeStyleValue('color: red; position: fixed')).toBeNull()
    expect(sanitizeStyleValue('color')).toBeNull()
    expect(sanitizeStyleValue('')).toBeNull()
  })
})
