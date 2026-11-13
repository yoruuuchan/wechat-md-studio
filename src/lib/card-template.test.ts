// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import fs from 'node:fs'
import path from 'node:path'
import {
  CARD_TEMPLATE_LIMITS, CardTemplateError, parseCardTemplateManifest,
} from './card-template-format'
import {
  openCardTemplateArchive, readArchiveEntry, sanitizeTemplateCss, sanitizeTemplateHtml,
} from './card-template-security'
import {
  activateCardTemplate, cardEndIsExtraPage, deactivateCardTemplate, fragmentHtml,
  parseCardTemplateSource, renderTemplatePage, type CardTemplateSourceRecord,
  type LoadedCardTemplate,
} from './card-template'
import { currentLang, setLanguage } from './i18n'

const metrics = {
  padX: 40, padTop: 52, padBottom: 76, contentWidth: 460,
  headerTop: 22, footerBottom: 26,
  coverInsetX: 48, coverInsetY: 56, coverFootBottom: 40, coverReserve: 156,
  coverTitleSize: [56, 48, 42, 36, 30], coverSmallScale: 0.86,
}

const cover = '<div class="xhs-cover"><h1 data-slot="title" data-fit-cover-title></h1><p data-slot="subtitle"></p></div>'
const body = '<div class="xhs-card-content" data-slot="content"></div><span data-slot="page-counter" data-format="pad2"></span>'

function manifest(extra: Record<string, unknown> = {}) {
  return {
    format: 'reed-card-template',
    formatVersion: 1,
    id: 'example',
    name: 'Example',
    version: '1.0.0',
    author: 'Reed',
    description: '',
    ratios: ['3:4', '1:1', '9:16'],
    defaultRatio: '3:4',
    variants: [
      { id: 'paper', name: 'Paper', dark: false, tokens: { accent: '#4F6CE8' } },
      { id: 'night', name: 'Night', dark: true, tokens: { accent: '#ffffff' } },
    ],
    metrics,
    fonts: [{ source: 'builtin', family: 'Noto Sans SC', weights: [400, 700] }],
    pages: { cover: 'pages/cover.html', body: 'pages/body.html' },
    styles: ['styles/template.css'],
    ...extra,
  }
}

function zipFiles(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(files)) zip.file(path, value)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

async function validZip(extra: Record<string, string> = {}): Promise<ArrayBuffer> {
  return zipFiles({
    'manifest.json': JSON.stringify(manifest()),
    'pages/cover.html': cover,
    'pages/body.html': body,
    'styles/template.css': 'p { margin: 0; }',
    ...extra,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    throw new Error('expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(CardTemplateError)
    return (error as CardTemplateError).code
  }
}

/** Rewrite one central-directory uncompressed size without touching the data. */
function patchDeclaredSize(bytes: Uint8Array, name: string, size: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue
    const nameLength = view.getUint16(i + 28, true)
    const entryName = decoder.decode(bytes.subarray(i + 46, i + 46 + nameLength))
    if (entryName !== name) continue
    view.setUint32(i + 24, size, true)
    return
  }
  throw new Error('central directory entry not found: ' + name)
}

afterEach(() => {
  document.body.replaceChildren()
  for (const style of Array.from(document.head.querySelectorAll('style[data-card-template-style]'))) style.remove()
})

describe('card template manifest', () => {
  it('accepts a complete manifest and rejects missing files', () => {
    const files = new Set(['manifest.json', 'pages/cover.html', 'pages/body.html', 'styles/template.css'])
    expect(parseCardTemplateManifest(manifest(), files).id).toBe('example')
    expect(() => parseCardTemplateManifest(manifest(), new Set(['manifest.json']))).toThrow(CardTemplateError)
  })

  it('allows several weights of one packaged family but rejects a duplicate face', () => {
    const files = new Set([
      'manifest.json', 'pages/cover.html', 'pages/body.html', 'styles/template.css',
      'fonts/family-400.woff2', 'fonts/family-700.woff2',
    ])
    const fonts = [
      { source: 'package', family: 'Example Sans', file: 'fonts/family-400.woff2', weight: 400 },
      { source: 'package', family: 'Example Sans', file: 'fonts/family-700.woff2', weight: 700 },
    ]
    expect(parseCardTemplateManifest(manifest({ fonts }), files).fonts).toHaveLength(2)
    expect(() => parseCardTemplateManifest(manifest({
      fonts: [fonts[0], { ...fonts[0], file: 'fonts/family-700.woff2' }],
    }), files)).toThrow(CardTemplateError)
  })

  it('reads customize slots and defaults to none', () => {
    const files = new Set(['manifest.json', 'pages/cover.html', 'pages/body.html', 'styles/template.css'])
    expect(parseCardTemplateManifest(manifest(), files).customize).toEqual({ colors: [], fonts: [] })
    const parsed = parseCardTemplateManifest(manifest({
      customize: {
        colors: [{ var: '--accent', name: '主色' }, { var: '--paper', name: '底色' }],
        fonts: [{ var: '--display', name: '标题' }],
      },
    }), files)
    expect(parsed.customize.colors.map((slot) => slot.var)).toEqual(['--accent', '--paper'])
    expect(parsed.customize.fonts).toEqual([{ var: '--display', name: '标题' }])
    for (const customize of [
      { colors: [{ var: 'accent', name: '主色' }] },
      { colors: [{ var: '--Accent', name: '主色' }] },
      { colors: [{ var: '--xhs-accent', name: '主色' }] },
      { fonts: [{ var: '--long-title', name: '标题' }] },
      { colors: [{ var: '--a', name: 'A' }], fonts: [{ var: '--a', name: 'B' }] },
      { colors: [{ var: '--a', name: 'A', default: '#fff' }] },
      { colors: Array.from({ length: CARD_TEMPLATE_LIMITS.customColors + 1 }, (_, i) => ({ var: `--c${i}`, name: 'C' })) },
      { sizes: [] },
    ]) {
      expect(() => parseCardTemplateManifest(manifest({ customize }), files), JSON.stringify(customize)).toThrow(CardTemplateError)
    }
  })

  it('rejects bad ids, ratios, variants, metrics, fonts and unknown fields', () => {
    const files = new Set(['manifest.json', 'pages/cover.html', 'pages/body.html', 'styles/template.css'])
    for (const patch of [
      { id: 'Bad ID' },
      { formatVersion: 2 },
      { ratios: ['5:4'] },
      { defaultRatio: '1:1' },
      { variants: [] },
      { variants: [{ id: 'x', name: 'X', tokens: { accent: 'url(https://x)' } }] },
      { metrics: { ...metrics, contentWidth: 900 } },
      { fonts: [{ source: 'builtin', family: 'Comic Sans', weights: [400] }] },
      { fonts: [{ source: 'builtin', family: 'Noto Sans SC', weights: [900] }] },
      { pages: { cover: '../cover.html', body: 'pages/body.html' } },
      { styles: [] },
      { renderId: 'reed' },
      { id: 'reed', renderId: undefined },
      { unexpected: true },
    ]) {
      expect(() => parseCardTemplateManifest(manifest(patch), files), JSON.stringify(patch)).toThrow(CardTemplateError)
    }
  })
})

describe('archive checks', () => {
  it('loads a valid archive', async () => {
    const archive = await openCardTemplateArchive(await validZip())
    expect(archive.manifest.id).toBe('example')
    expect(archive.files.get('styles/template.css')?.bytes.byteLength).toBeGreaterThan(0)
  })

  it('rejects a too-large compressed archive before opening it', async () => {
    const code = await codeOf(openCardTemplateArchive(new ArrayBuffer(CARD_TEMPLATE_LIMITS.archiveBytes + 1)))
    expect(code).toBe('archive-too-large')
  })

  it('rejects path traversal and absolute paths', async () => {
    const traversal = await zipFiles({ 'manifest.json': '{}', '../evil.html': 'x' })
    expect(await codeOf(openCardTemplateArchive(traversal))).toBe('path-traversal')
    const absolute = await zipFiles({ 'manifest.json': '{}', '/abs.html': 'x' })
    expect(await codeOf(openCardTemplateArchive(absolute))).toBe('path-traversal')
  })

  it('rejects an unpacked zip bomb and too many files', async () => {
    const bomb = await zipFiles({ 'manifest.json': '{}', 'bomb.html': 'A'.repeat(33 * 1024 * 1024) })
    expect(await codeOf(openCardTemplateArchive(bomb))).toBe('archive-too-large-unpacked')
    const many: Record<string, string> = { 'manifest.json': '{}' }
    for (let i = 0; i < CARD_TEMPLATE_LIMITS.files; i++) many[`f${i}.txt`] = 'x'
    expect(await codeOf(openCardTemplateArchive(await zipFiles(many)))).toBe('too-many-files')
  })

  it('stops an entry whose central-directory size is a lie', async () => {
    // 24 MB of zeros compresses to a few KB. The central directory claims 1 KB,
    // exactly what the old pre-check trusted; the actual stream is 24,000 times
    // larger. The reader must stop near the 512 KB page ceiling, not inflate it.
    const bomb = new JSZip()
    bomb.file('bomb.html', new Uint8Array(24 * 1024 * 1024))
    const bytes = await bomb.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    patchDeclaredSize(bytes, 'bomb.html', 1024)
    const loaded = await JSZip.loadAsync(bytes)
    const entry = loaded.file('bomb.html')!
    expect((entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize).toBe(1024)

    let emitted = 0
    const code = await codeOf(readArchiveEntry(entry, CARD_TEMPLATE_LIMITS.pageBytes, (n) => { emitted += n }))
    expect(code).toBe('archive-too-large-unpacked')
    // One 16 KB JSZip chunk may arrive after the ceiling, never the whole file.
    expect(emitted).toBeLessThanOrEqual(CARD_TEMPLATE_LIMITS.pageBytes + 16 * 1024)
  })

  it('rejects a complete template that carries the lying entry', async () => {
    const zip = await zipFiles({
      'manifest.json': JSON.stringify(manifest()),
      'pages/cover.html': cover,
      'pages/body.html': body,
      'styles/template.css': 'p { margin: 0; }',
      'bomb.html': new Uint8Array(24 * 1024 * 1024),
    })
    // A typed-array view over the same buffer, so the patch reaches the archive.
    patchDeclaredSize(new Uint8Array(zip), 'bomb.html', 1024)
    expect(await codeOf(openCardTemplateArchive(zip))).toBe('archive-too-large-unpacked')
  })

  it('rejects a non-whitelisted extension', async () => {
    const zip = await zipFiles({ 'manifest.json': JSON.stringify(manifest()), 'run.exe': 'MZ' })
    expect(await codeOf(openCardTemplateArchive(zip))).toBe('bad-extension')
  })
})

describe('HTML whitelist', () => {
  const context = { files: new Map() }
  const cases: [string, string][] = [
    ['<script>alert(1)</script>', 'unsafe-html'],
    ['<img src="x" onerror="alert(1)">', 'unsafe-html'],
    ['<iframe src="https://evil.test"></iframe>', 'unsafe-html'],
    ['<form action="https://evil.test"><input></form>', 'unsafe-html'],
    ['<svg><foreignObject><div>x</div></foreignObject></svg>', 'unsafe-html'],
    ['<div style="background:url(https://evil.test/x.png)">x</div>', 'unsafe-html'],
    ['<img src="https://evil.test/x.png">', 'unsafe-url'],
    ['<a href="javascript:alert(1)">x</a>', 'unsafe-html'],
    ['<div onclick="x">x</div>', 'unsafe-html'],
    ['<img src="data:text/html;base64,PHNjcmlwdD4=">', 'unsafe-url'],
    ['<svg><rect fill="url(https://evil.test/paint)"></rect></svg>', 'unsafe-url'],
  ]
  for (const [html, code] of cases) {
    it('rejects ' + html.slice(0, 40), () => {
      let thrown: unknown
      try { sanitizeTemplateHtml(html, 'pages/cover.html', context) } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(CardTemplateError)
      expect((thrown as CardTemplateError).code).toBe(code)
    })
  }

  it('keeps package images and inline image data on <img>', () => {
    const files = new Map([['pages/logo.png', { path: 'pages/logo.png', bytes: new Uint8Array([1, 2, 3]) }]])
    const withAsset = { files, resolve: (path: string) => path === 'pages/logo.png' ? 'data:image/png;base64,AQID' : null }
    const packaged = sanitizeTemplateHtml('<img src="logo.png" alt="logo">', 'pages/cover.html', withAsset)
    expect(packaged).toContain('src="data:image/png;base64,AQID"')
    expect(packaged).toContain('alt="logo"')
    const inline = sanitizeTemplateHtml('<img src="data:image/png;base64,AQID" alt="dot">', 'pages/cover.html', context)
    expect(inline).toContain('src="data:image/png;base64,AQID"')
  })

  it('keeps declarative slots and basic SVG shapes', () => {
    const html = '<div class="xhs-cover"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg><h1 data-slot="title" data-fit-cover-title></h1></div>'
    const clean = sanitizeTemplateHtml(html, 'pages/cover.html', context)
    expect(clean).toContain('data-slot="title"')
    expect(clean).toContain('<circle')
    expect(clean).not.toContain('<script')
  })
})

describe('CSS whitelist and scoping', () => {
  const empty = new Map()
  const assetFiles = new Map([['styles/assets/dot.png', { path: 'styles/assets/dot.png', bytes: new Uint8Array([1, 2, 3]) }]])
  const assetUrls = new Map([['styles/assets/dot.png', 'data:image/png;base64,AQID']])

  function css(source: string, files = empty, urls?: Map<string, string>) {
    return sanitizeTemplateCss(source, { template: 'custom.test', cssPath: 'styles/template.css', files, assetUrls: urls })
  }

  it('wraps rules in a scope for both the card and the measured body', () => {
    const result = css('.xhs-card, .xhs-body { margin: 0; } p { margin: 1px; }')
    expect(result.startsWith('@scope (')).toBe(true)
    expect(result).toContain('.xhs-card[data-card-template-source="custom.test"]')
    expect(result).toContain('.xhs-body[data-card-template-source="custom.test"]')
    expect(result).not.toContain('.xhs-card[data-template="custom.test"]')
    expect(result).toContain(':scope.xhs-card')
    expect(result).toContain(':scope.xhs-body')
    expect(result).toContain('p { margin: 1px; }')
  })

  it('keeps @media rules but not out-of-scope selectors', () => {
    expect(css('@media (min-width: 1px) { p { margin: 0; } }')).toContain('@media')
    expect(() => css('body { display: none; }')).toThrow(CardTemplateError)
    expect(() => css(':root { display: none; }')).toThrow(CardTemplateError)
    expect(() => css('html, body { display: none; }')).toThrow(CardTemplateError)
  })

  it('rejects imports, external URLs and executable expressions', () => {
    for (const source of [
      '@import url("https://evil.test/x.css");',
      '.a { background: url(https://evil.test/x.png); }',
      '.a { background: image-set("https://evil.test/x.png" 1x); }',
      '.a { background: image-set("//evil.test/x.png" 1x); }',
      '.a { width: expression(alert(1)); }',
      '.a { behavior: url(x.htc); }',
      '.a { -moz-binding: url(x.xml); }',
      '@font-face { font-family: X; src: url(https://evil.test/x.woff2); }',
    ]) {
      expect(() => css(source), source).toThrow(CardTemplateError)
    }
  })

  it('rejects every CSS function that turns a string into a request', () => {
    // Relative strings are the point: no scheme, no url(), still a GET.
    const names = ['image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade', 'element', '-moz-element', 'paint', 'src', 'image', '-webkit-canvas', '-webkit-named-image']
    for (const name of names) {
      for (const value of [`"assets/dot.png" 1x`, 'url("assets/dot.png") 1x', '"a.png"']) {
        const source = name.includes('canvas') || name.includes('named-image')
          ? `.a { background: ${name}("probe") }`
          : `.a { background: ${name}(${value}) }`
        expect(() => css(source), source).toThrow(CardTemplateError)
      }
    }
    // They are just as forbidden inside at-rules.
    expect(() => css('@supports (background: image-set("a.png" 1x)) { .a { color: red; } }')).toThrow(CardTemplateError)
    expect(() => css('@media screen { .a { background: paint(probe); } }')).toThrow(CardTemplateError)
    expect(() => css('@font-face { font-family: X; src: src("font.woff2"); }')).toThrow(CardTemplateError)
  })

  it('rejects fixed and sticky positioning, including the virtual scope root', () => {
    for (const source of [
      '.a { position: fixed; }',
      '.a { position: sticky; }',
      '.a { position: -webkit-sticky; }',
      ':scope.xhs-card { position: fixed; }',
      '@media screen { .a { position: fixed; } }',
      '.a { --p: fixed; position: var(--p); }',
      '.a { position: var(--p, fixed); }',
    ]) {
      expect(() => css(source), source).toThrow(CardTemplateError)
    }
    expect(() => css('.a { position: absolute; top: 0; }')).not.toThrow()
  })

  it('rewrites package asset URLs to data URLs and rejects missing assets', () => {
    const result = css('.a { background: url("assets/dot.png"); }', assetFiles, assetUrls)
    expect(result).toContain('data:image/png;base64,AQID')
    expect(() => css('.a { background: url("assets/missing.png"); }', assetFiles, assetUrls)).toThrow(CardTemplateError)
  })
})

describe('parsed template runtime', () => {
  it('parses, activates and fills slots without concatenating HTML', async () => {
    const record = await parseCardTemplateSource(await validZip(), 'test-id')
    expect(record.template).toBe('custom.test-id')
    const loaded = await activateCardTemplate(record) as LoadedCardTemplate
    expect(document.head.querySelector('style[data-card-template-style]')).not.toBeNull()

    const coverPage = renderTemplatePage(loaded, {
      kind: 'cover', pageIndex: 0, total: 3, title: '标题', subtitle: '',
      author: 'Yoru', articleTitle: '文章标题', height: 720, lang: 'zh',
    }, 'paper', false)
    const coverHtml = fragmentHtml(coverPage)
    expect(coverHtml).toContain('标题')
    expect(coverHtml).not.toContain('data-slot="subtitle"')
    expect(coverHtml).toContain('data-cover-title-size')

    const bodyPage = renderTemplatePage(loaded, {
      kind: 'body', pageIndex: 1, total: 3, title: '', subtitle: '',
      author: 'Yoru', articleTitle: '文章标题', contentHtml: '<p>正文</p>', height: 720, lang: 'zh',
    }, 'paper', false)
    const bodyHtml = fragmentHtml(bodyPage)
    expect(bodyHtml).toContain('<p>正文</p>')
    expect(bodyHtml).toContain('02 / 03')
    deactivateCardTemplate(record.template)
    expect(document.head.querySelector('style[data-card-template-style]')).toBeNull()
  })

  it('keeps the shared page-count copy stable for uploaded templates', async () => {
    const before = currentLang()
    setLanguage('zh')
    try {
      const counted = '<div class="xhs-card-content" data-slot="content"></div><span data-slot="page-count" data-format="plain"></span><span data-slot="page-count" data-format="chinese"></span>'
      const zip = await zipFiles({
        'manifest.json': JSON.stringify(manifest()),
        'pages/cover.html': cover,
        'pages/body.html': counted,
        'styles/template.css': 'p { margin: 0; }',
      })
      const record = await parseCardTemplateSource(zip, 'page-count-id')
      const loaded = await activateCardTemplate(record) as LoadedCardTemplate
      const html = fragmentHtml(renderTemplatePage(loaded, {
        kind: 'body', pageIndex: 0, total: 6, title: '', subtitle: '',
        author: 'Yoru', articleTitle: '标题', contentHtml: '<p>正文</p>', height: 720, lang: 'zh',
      }, 'paper', false))
      expect(html).toContain('共6页')
      expect(html).toContain('共〇六页')
      deactivateCardTemplate(record.template)
    } finally {
      setLanguage(before)
    }
  })

  it('prunes variant-only elements declaratively', async () => {
    const variantCover = '<div class="xhs-cover"><h1 data-slot="title"></h1><i data-when-variant="night">moon</i></div>'
    const zip = await zipFiles({
      'manifest.json': JSON.stringify(manifest()),
      'pages/cover.html': variantCover,
      'pages/body.html': body,
      'styles/template.css': 'p { margin: 0; }',
    })
    const record = await parseCardTemplateSource(zip, 'variant-id')
    const loaded = await activateCardTemplate(record) as LoadedCardTemplate
    const ctx = {
      kind: 'cover' as const, pageIndex: 0, total: 2, title: 'T', subtitle: '',
      author: 'A', articleTitle: 'A', height: 720, lang: 'zh' as const,
    }
    expect(fragmentHtml(renderTemplatePage(loaded, ctx, 'paper', false))).not.toContain('moon')
    expect(fragmentHtml(renderTemplatePage(loaded, ctx, 'night', true))).toContain('moon')
    deactivateCardTemplate(record.template)
  })

  it('re-checks stored HTML at activation', async () => {
    const base = await parseCardTemplateSource(await validZip(), 'tampered-id')
    const record: CardTemplateSourceRecord = {
      ...base,
      parsed: {
        ...base.parsed,
        pages: {
          ...base.parsed.pages,
          cover: { ...base.parsed.pages.cover!, html: '<script>alert(1)</script>' },
        },
      },
    }
    await expect(activateCardTemplate(record)).rejects.toMatchObject({ code: 'unsafe-html' })
  })

  it('validates the published example template', async () => {
    const source = path.resolve('examples/card-templates/example')
    const zip = new JSZip()
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(absolute)
        else zip.file(path.relative(source, absolute).replace(/\\/g, '/'), fs.readFileSync(absolute))
      }
    }
    walk(source)
    const record = await parseCardTemplateSource(await zip.generateAsync({ type: 'arraybuffer' }), 'example')
    if (record.parsed.manifest.kind !== 'card') throw new Error('expected a card template')
    expect(record.parsed.manifest.pages.end).toBe('pages/end.html')
    expect(record.parsed.styles[0].css).toContain('.example-end')
    const loaded = await activateCardTemplate(record) as LoadedCardTemplate
    expect(loaded.summary.name).toContain('示例')
    expect(loaded.packageFontCss).toContain('@font-face')
    expect(loaded.packageFontCss).toContain('data:font/woff2;base64,')
    deactivateCardTemplate(record.template)
  })
})
describe('closing page', () => {
  const loaded = (end: string | undefined) => ({
    manifest: { pages: { cover: 'c.html', body: 'b.html', ...(end === undefined ? {} : { end: 'e.html' }) } },
    pages: { cover: '', body: '<div data-slot="content"></div>', end: end ?? '<div data-slot="content"></div>' },
  }) as unknown as LoadedCardTemplate

  it('adds a page of its own when the end page has no content slot', () => {
    expect(cardEndIsExtraPage(loaded('<p data-slot="article-title"></p><span data-slot="author"></span>'))).toBe(true)
  })

  it('keeps framing the last page when the end page places the content', () => {
    expect(cardEndIsExtraPage(loaded('<div class="x" data-slot="content"></div><p data-slot="author"></p>'))).toBe(false)
    expect(cardEndIsExtraPage(loaded('<div data-slot=content></div>'))).toBe(false)
  })

  it('has no closing page when the template declares none', () => {
    expect(cardEndIsExtraPage(loaded(undefined))).toBe(false)
  })
})
