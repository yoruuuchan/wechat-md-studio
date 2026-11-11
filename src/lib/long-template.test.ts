// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
 CardTemplateError, parseCardTemplateManifest, type LongTemplateManifest,
} from './card-template-format'
import {
 activateCardTemplate, deactivateCardTemplate, fragmentHtml,
 parseCardTemplateSource, renderLongTemplatePage,
} from './card-template'
import { sanitizeTemplateCss } from './card-template-security'

const metrics = { padX:22, contentWidth:496, photoGap:7, photoInset:11 }
const header = '<header class="long-head" data-when-cover="true"><img data-slot="cover" alt=""><h1 data-slot="title"></h1><p data-slot="subtitle"></p></header><header class="long-plain" data-when-cover="false"><h1 data-slot="title"></h1></header>'
const footer = '<footer class="long-foot"><div data-slot="content"></div><p data-slot="author"></p></footer>'

function longManifest(extra: Record<string, unknown> = {}) {
 return {
 format: 'reed-card-template',
 formatVersion:1,
 kind: 'long',
 id: 'example-long',
 name: 'Example Long',
 version: '1.0.0',
 author: 'Reed',
 description: '',
 variants: [{ id: 'paper', name: 'Paper', dark: false, tokens: { accent: '#2F6F5E' } }],
 metrics,
 fonts: [{ source: 'builtin', family: 'Noto Sans SC', weights: [400,700] }],
 pages: { header: 'pages/header.html', footer: 'pages/footer.html' },
 styles: ['styles/template.css'],
 ...extra,
 }
}

function files(extra: string[] = []) {
 return new Set(['manifest.json', 'pages/header.html', 'pages/footer.html', 'styles/template.css', ...extra])
}

async function zip(extra: Record<string, string> = {}, extraManifest: Record<string, unknown> = {}): Promise<ArrayBuffer> {
 const archive = new JSZip()
 archive.file('manifest.json', JSON.stringify(longManifest(extraManifest)))
 archive.file('pages/header.html', extra.header ?? header)
 archive.file('pages/footer.html', extra.footer ?? footer)
 archive.file('styles/template.css', extra.css ?? '.reed-long-root { background: #123456; }')
 for (const [path, value] of Object.entries(extra)) {
 if (['header', 'footer', 'css'].includes(path)) continue
 archive.file(path, value)
 }
 return archive.generateAsync({ type: 'arraybuffer' })
}

describe('long template manifest', () => {
 it('keeps card manifests unchanged and marks them as cards', () => {
 const card = {
 format: 'reed-card-template', formatVersion:1, id: 'card', name: 'Card', version: '1.0.0',
 author: 'Reed', description: '', ratios: ['3:4'], defaultRatio: '3:4',
 variants: [{ id: 'paper', name: 'Paper', dark: false, tokens: {} }],
 metrics: {
 padX:40, padTop:52, padBottom:76, contentWidth:460, headerTop:22, footerBottom:26,
 coverInsetX:48, coverInsetY:56, coverFootBottom:40, coverReserve:156,
 coverTitleSize: [56,48,42,36,30], coverSmallScale:0.86,
 },
 fonts: [], pages: { cover: 'pages/cover.html', body: 'pages/body.html' }, styles: ['styles/template.css'],
 }
 const parsed = parseCardTemplateManifest(card, files(['pages/cover.html', 'pages/body.html']))
 expect(parsed.kind).toBe('card')
 })

 it('accepts a long manifest with two optional fragments', () => {
 const parsed = parseCardTemplateManifest(longManifest(), files()) as LongTemplateManifest
 expect(parsed.kind).toBe('long')
 expect(parsed.metrics).toEqual(metrics)
 expect(parsed.pages).toEqual({ header: 'pages/header.html', footer: 'pages/footer.html' })
 const noPages = parseCardTemplateManifest(longManifest({ pages: {} }), files())
 expect(noPages.kind).toBe('long')
 })

 it('rejects card-only fields and missing measurements', () => {
 for (const patch of [
 { ratios: ['3:4'] },
 { defaultRatio: '3:4' },
 { metrics: { padX:22, contentWidth:496 } },
 { metrics: { ...metrics, padX:300 } },
 { pages: { cover: 'pages/header.html' } },
 { kind: 'poster' },
 ]) {
 expect(() => parseCardTemplateManifest(longManifest(patch), files())).toThrow(CardTemplateError)
 }
 })

 it('rejects malicious long fragments and CSS with the same filters as cards', async () => {
 await expect(parseCardTemplateSource(await zip({ header: '<script>alert(1)</script>' }), 'bad-header'))
 .rejects.toMatchObject({ code: 'unsafe-html' })
 await expect(parseCardTemplateSource(await zip({ css: '.reed-long-root { position: fixed; }' }), 'bad-css'))
 .rejects.toMatchObject({ code: 'unsafe-css' })
 await expect(parseCardTemplateSource(await zip({ css: 'body { color: red; }' }), 'bad-scope'))
 .rejects.toMatchObject({ code: 'unsafe-css' })
 })

 it('requires the cover slot to be an img', async () => {
 const cover = '<header><span data-slot="cover"></span><h1 data-slot="title"></h1></header>'
 const record = await parseCardTemplateSource(await zip({ header: cover, footer: '' }), 'bad-cover')
 await expect(activateCardTemplate(record)).rejects.toMatchObject({ code: 'bad-manifest' })
 })
})

describe('long template runtime', () => {
 it('fills header/footer slots, cover conditions and removes empty text', async () => {
 const record = await parseCardTemplateSource(await zip(), 'long-id')
 const loaded = await activateCardTemplate(record)
 expect(loaded.kind).toBe('long')
 expect(loaded.summary.kind).toBe('long')
 const withCover = fragmentHtml(renderLongTemplatePage(loaded as never, {
 kind: 'header', title: '标题', subtitle: '', coverSrc: 'data:image/png;base64,AA==',
 author: '', lang: 'zh',
 }, 'paper', false))
 expect(withCover).toContain('标题')
 expect(withCover).toContain('src="data:image/png;base64,AA=="')
 expect(withCover).toContain('long-head')
 expect(withCover).not.toContain('long-plain')
 expect(withCover).not.toContain('data-slot="subtitle"')

 const noCover = fragmentHtml(renderLongTemplatePage(loaded as never, {
 kind: 'header', title: '标题', subtitle: '', coverSrc: '', author: '', lang: 'zh',
 }, 'paper', false))
 expect(noCover).not.toContain('long-head')
 expect(noCover).toContain('long-plain')
 expect(noCover).not.toContain('<img')

 const close = fragmentHtml(renderLongTemplatePage(loaded as never, {
 kind: 'footer', title: '标题', subtitle: '', coverSrc: '', author: '',
 contentHtml: '<p>共同走过这一年。</p>', lang: 'zh',
 }, 'paper', false))
 expect(close).toContain('共同走过这一年。')
 expect(close).not.toContain('data-slot="author"')
 deactivateCardTemplate(record.template)
 })

 it('scopes long CSS to the long root and leaves card scoping untouched', () => {
 const assetContext = { template: 'custom.x', cssPath: 'styles/template.css', files: new Map(), kind: 'long' as const }
 const scoped = sanitizeTemplateCss('.reed-long-root { color: #fff; }\n.reed-long-section { padding:10px; }', assetContext)
 expect(scoped).toContain('@scope (.reed-long-root[data-card-template-source="custom.x"]')
 expect(scoped).toContain(':scope.reed-long-root')
 expect(scoped).toContain('.reed-long-section')
 const card = sanitizeTemplateCss('.xhs-card { color: #000; }', {
 template: 'custom.x', cssPath: 'styles/template.css', files: new Map(),
 })
 expect(card).toContain('.xhs-card[data-card-template-source="custom.x"]')
 expect(card).not.toContain('reed-long')
 })
})
