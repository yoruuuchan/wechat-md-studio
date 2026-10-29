import { describe, expect, it } from 'vitest'
import { buildPreflight, classifyImageAddress, hostOf, isLocalHost, type PreflightInput } from './preflight'
import { parseMarkdown } from './parse'
import { collectMaterials } from './render'

/** Build one report the way the editor does, from real Markdown. */
function report(markdown: string, overrides: Partial<PreflightInput> = {}) {
  const doc = parseMarkdown(markdown)
  return buildPreflight({
    blocks: doc.blocks,
    materials: collectMaterials(doc, () => null),
    mathStatus: () => 'rendered',
    mathEngineUnavailable: false,
    diagrams: [],
    rendererWarnings: [],
    ...overrides,
  })
}

describe('image addresses', () => {
  it('reads the host out of every URL shape it can meet', () => {
    expect(hostOf('https://example.com/a.png')).toBe('example.com')
    expect(hostOf('http://user:pw@Host.Example.COM:8080/a.png?x=1')).toBe('host.example.com')
    expect(hostOf('//cdn.example.com/a.png')).toBe('cdn.example.com')
    expect(hostOf('[::1]:8080/a.png')).toBe('::1')
    expect(hostOf('/static/a.png')).toBe('')
  })

  it('treats loopback, LAN and intranet names as unreachable from WeChat', () => {
    for (const host of [
      'localhost',
      'api.localhost',
      '127.0.0.1',
      '127.9.9.9',
      '0.0.0.0',
      '::1',
      '10.0.0.5',
      '192.168.1.20',
      '169.254.1.1',
      '172.16.0.1',
      '172.31.255.255',
      'nas.local',
      'build-server',
    ]) {
      expect(isLocalHost(host), host).toBe(true)
    }
  })

  it('leaves public addresses alone', () => {
    for (const host of ['example.com', '172.15.0.1', '172.32.0.1', '8.8.8.8', 'cdn.yoru-and-akari.dev']) {
      expect(isLocalHost(host), host).toBe(false)
    }
  })

  it('classifies each way an image can be addressed', () => {
    expect(classifyImageAddress('')).toBe('placeholder')
    expect(classifyImageAddress('docx-import:3')).toBe('placeholder')
    expect(classifyImageAddress('img:mvtezn3p-key')).toBe('ready')
    expect(classifyImageAddress('data:image/png;base64,AAAA')).toBe('embedded')
    expect(classifyImageAddress('http://localhost:5173/a.png')).toBe('local')
    expect(classifyImageAddress('/static/a.png')).toBe('local')
    expect(classifyImageAddress('https://example.com/a.png')).toBe('external')
  })
})

describe('a finished article', () => {
  it('passes a text-only article without a single finding', () => {
    const r = report('# 标题\n\n一段正文，只有文字。\n')
    expect(r.gates).toBe(false)
    expect(r.items).toHaveLength(0)
  })

  it('passes an article whose images already live on our own image host', () => {
    const r = report('# 标题\n\n![图注](img:abc123)\n\n![另一张](img:def456)\n')
    expect(r.gates).toBe(false)
  })
})

describe('unfinished rendering blocks the output', () => {
  it('names the line of a formula that is still rendering', () => {
    const r = report('# 标题\n\n$$\nE = mc^2\n$$\n', { mathStatus: () => 'pending' })
    expect(r.blockers.map((i) => i.code)).toEqual(['math-pending'])
    expect(r.blockers[0].location?.line).toBe(2)
    expect(r.gates).toBe(true)
  })

  it('carries the TeX of a formula that will not compile', () => {
    const r = report('# 标题\n\n$$\n\\frac{\n$$\n', { mathStatus: () => 'failed' })
    expect(r.blockers.map((i) => i.code)).toEqual(['math-failed'])
    expect(String(r.blockers[0].detailParams?.tex)).toContain('\\frac')
    expect(r.blockers[0].location?.line).toBe(2)
  })

  it('reports one engine finding instead of one per formula', () => {
    const r = report('# 标题\n\n$$\nA\n$$\n\n$$\nB\n$$\n', {
      mathStatus: () => 'pending',
      mathEngineUnavailable: true,
    })
    expect(r.blockers.map((i) => i.code)).toEqual(['math-engine'])
    expect(r.blockers[0].detailParams?.n).toBe(2)
  })

  it('keeps a diagram that failed visible instead of letting it stop counting', () => {
    const doc = parseMarkdown('# 标题\n\n```mermaid\ngraph TD; A-->B\n```\n')
    const r = buildPreflight({
      blocks: doc.blocks,
      materials: collectMaterials(doc, () => null),
      mathStatus: () => 'rendered',
      mathEngineUnavailable: false,
      diagrams: [{ code: 'graph TD; A-->B', line: 2, state: 'failed' }],
      rendererWarnings: [],
    })
    expect(r.blockers.map((i) => i.code)).toEqual(['diagram-failed'])
    expect(r.blockers[0].location?.line).toBe(2)
  })

  it('blocks while a diagram is still being generated', () => {
    const doc = parseMarkdown('# 标题\n\n```mermaid\ngraph TD; A-->B\n```\n')
    const r = buildPreflight({
      blocks: doc.blocks,
      materials: collectMaterials(doc, () => null),
      mathStatus: () => 'rendered',
      mathEngineUnavailable: false,
      diagrams: [
        { code: 'a', line: 2, state: 'pending' },
        { code: 'b', line: 9, state: 'ready' },
      ],
      rendererWarnings: [],
    })
    expect(r.blockers.map((i) => i.code)).toEqual(['diagram-pending'])
    expect(r.blockers[0].location?.line).toBe(2)
  })
})

describe('images the author has to decide about', () => {
  it('marks an empty slot as an ignorable warning that can be located', () => {
    const r = report('# 标题\n\n![封面]()\n')
    expect(r.blockers).toHaveLength(0)
    expect(r.warnings.map((i) => i.code)).toEqual(['image-placeholder'])
    const item = r.warnings[0]
    expect(item.ignorable).toBe(true)
    expect(item.titleParams?.no).toBe('图1')
    expect(item.location).toMatchObject({ line: 2, figure: '图1', alt: '封面', occurrence: 1 })
  })

  it('counts a DOCX import slot the same way', () => {
    const r = report('# 标题\n\n![封面](docx-import:1)\n')
    expect(r.warnings.map((i) => i.code)).toEqual(['image-placeholder'])
  })

  it('blocks a loopback address, naming the article line and the address', () => {
    const r = report('# 标题\n\n![本地](http://localhost:5173/a.png)\n')
    expect(r.blockers.map((i) => i.code)).toEqual(['image-local'])
    expect(String(r.blockers[0].detailParams?.src)).toContain('localhost')
    expect(r.blockers[0].location?.occurrence).toBe(1)
  })

  it('blocks a LAN address and a scheme-relative path', () => {
    expect(report('![a](http://192.168.1.9/a.png)\n').blockers.map((i) => i.code)).toEqual(['image-local'])
    expect(report('![a](/static/a.png)\n').blockers.map((i) => i.code)).toEqual(['image-local'])
  })

  it('blocks inline image data, which WeChat never re-hosts', () => {
    const r = report('![a](data:image/png;base64,AAAA)\n')
    expect(r.blockers.map((i) => i.code)).toEqual(['image-local'])
    expect(r.blockers[0].titleKey).toBe('preflight.embeddedImage.title')
  })

  it('says an external address is unverified rather than claiming it is fine', () => {
    const r = report('# 标题\n\n![外链](https://example.com/a.png)\n')
    expect(r.blockers).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
    expect(r.unverifiable.map((i) => i.code)).toEqual(['image-unverifiable'])
    expect(r.unverifiable[0].severity).toBe('unverifiable')
    expect(String(r.unverifiable[0].detailParams?.src)).toBe('https://example.com/a.png')
    // It is stated, not used to stop the copy: there is nothing to fix here.
    expect(r.gates).toBe(false)
    expect(r.items).toHaveLength(1)
  })

  it('locates every image in a carousel separately', () => {
    const r = report('# 标题\n\n:::carousel 封面 标题\n![一]()\n![二](img:ok)\n:::\n')
    expect(r.warnings.map((i) => i.location?.occurrence)).toEqual([1])
    expect(r.warnings[0].location?.figure).toBe('图1-1')
  })
})

describe('renderer warnings', () => {
  it('passes the renderer sentence through verbatim as a note that does not gate', () => {
    const r = report('# 标题\n\n正文\n', { rendererWarnings: ['图1 缺少说明文字（![说明](src)）'] })
    expect(r.notes.map((i) => i.code)).toEqual(['renderer-warning'])
    expect(r.notes[0].text).toBe('图1 缺少说明文字（![说明](src)）')
    expect(r.notes[0].severity).toBe('note')
    expect(r.notes[0].ignorable).toBe(true)
    // An article with a link in it is not an unfinished article.
    expect(r.gates).toBe(false)
  })
})

describe('the report as a whole', () => {
  it('groups every finding into the section that decides what happens next', () => {
    const r = report('# 标题\n\n$$\nE = mc^2\n$$\n\n![空位]()\n\n![外链](https://example.com/a.png)\n', {
      mathStatus: () => 'pending',
    })
    expect(r.blockers.map((i) => i.code)).toEqual(['math-pending'])
    expect(r.warnings.map((i) => i.code)).toEqual(['image-placeholder'])
    expect(r.unverifiable.map((i) => i.code)).toEqual(['image-unverifiable'])
    expect(r.items).toHaveLength(3)
    expect(r.gates).toBe(true)
  })

  it('keeps every blocker un-ignorable, so none of them can be waved through by accident', () => {
    const r = report('# 标题\n\n$$\nA\n$$\n\n![本地](http://127.0.0.1/a.png)\n', { mathStatus: () => 'failed' })
    expect(r.blockers).toHaveLength(2)
    expect(r.blockers.every((i) => !i.ignorable)).toBe(true)
  })
})