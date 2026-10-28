import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { getTheme } from './themes'

const SIG = { layout: '', proof: '', review: '' }

// Front matter plus one of every body shape the parser has to keep aligned:
// a heading, prose, a fenced code block, an editor note and two images.
// Built with LF and re-joined with every line ending a file may arrive with.
const LF_DOC = [
  '---',
  'titles:',
  '  - Private Headline',
  '  - Second Candidate',
  'cover: Private Notes',
  'author: Private Author',
  '---',
  '',
  '# Body',
  '',
  'Paragraph one.',
  '',
  '![photo](img:photo1)',
  '',
  '```js',
  'const a = 1',
  'const b = 2',
  '```',
  '',
  '<!-- 编辑备注，不渲染 -->',
  '',
  '![second](img:photo2)',
  '',
].join('\n')

const DOCS = {
  LF: LF_DOC,
  CRLF: LF_DOC.replace(/\n/g, '\r\n'),
  CR: LF_DOC.replace(/\n/g, '\r'),
}

const EXPECTED_META = {
  titles: ['Private Headline', 'Second Candidate'],
  cover: 'Private Notes',
  author: 'Private Author',
}

const render = (src: string) => renderDoc(parseMarkdown(src), getTheme('golden'), SIG).html

describe('front matter line endings', () => {
  it('reads the same metadata from LF, CRLF and lone CR', () => {
    for (const [name, src] of Object.entries(DOCS)) {
      expect(parseMarkdown(src).meta, name).toEqual(EXPECTED_META)
    }
  })

  it('produces an identical semantic AST from LF, CRLF and lone CR', () => {
    const baseline = parseMarkdown(DOCS.LF)
    expect(baseline.meta).toEqual(EXPECTED_META)
    for (const [name, src] of Object.entries(DOCS).slice(1)) {
      expect(parseMarkdown(src), name).toEqual(baseline)
    }
  })

  it('keeps the cover, titles and author out of the rendered article', () => {
    for (const [name, src] of Object.entries(DOCS)) {
      const html = render(src)
      expect(html, name).not.toContain('Private Headline')
      expect(html, name).not.toContain('Private Notes')
      expect(html, name).not.toContain('Private Author')
      expect(html, name).not.toContain('titles:')
      expect(html, name).toContain('Body')
      expect(html, name).toContain('Paragraph one.')
    }
  })

  it('renders byte-identical preview HTML for every line ending', () => {
    const baseline = render(DOCS.LF)
    expect(baseline).toContain('Paragraph one.')
    for (const [name, src] of Object.entries(DOCS).slice(1)) {
      expect(render(src), name).toBe(baseline)
    }
  })

  it('maps the first block after front matter to its real source line', () => {
    for (const [name, src] of Object.entries(DOCS)) {
      const lines = src.split(/\r\n|\r|\n/)
      const doc = parseMarkdown(src)
      const heading = doc.blocks[0]
      expect(heading.type, name).toBe('heading')
      expect(heading.line, name).toBe(8)
      expect(lines[heading.line], name).toBe('# Body')
      const image = doc.blocks.find((b) => b.type === 'image')!
      expect(image.line, name).toBe(12)
      expect(lines[image.line], name).toBe('![photo](img:photo1)')
    }
  })

  it('keeps code and image occurrences intact under CRLF and CR', () => {
    for (const [name, src] of Object.entries(DOCS)) {
      const doc = parseMarkdown(src)
      const code = doc.blocks.find((b) => b.type === 'code')!
      expect(code.lang, name).toBe('js')
      expect(code.code, name).toBe('const a = 1\nconst b = 2')
      const images = doc.blocks.filter((b) => b.type === 'image')
      expect(images.map((b) => [b.alt, b.occurrence]), name).toEqual([
        ['photo', 1],
        ['second', 2],
      ])
    }
  })

  it('keeps an editor note out of the article and its line numbers unchanged', () => {
    for (const [name, src] of Object.entries(DOCS)) {
      expect(render(src), name).not.toContain('编辑备注')
    }
  })

  it('accepts a BOM in front of CRLF or CR front matter', () => {
    const baseline = parseMarkdown(DOCS.LF)
    for (const name of ['CRLF', 'CR'] as const) {
      const doc = parseMarkdown(`\uFEFF${DOCS[name]}`)
      expect(doc.meta, name).toEqual(EXPECTED_META)
      expect(doc.blocks, name).toEqual(baseline.blocks)
    }
  })

  it('leaves a BOM-only body unchanged across line endings', () => {
    expect(parseMarkdown('\uFEFF# 标题\r\n\r\n正文\r\n')).toEqual(
      parseMarkdown('\uFEFF# 标题\n\n正文\n'),
    )
  })

  it('normalises front matter that mixes LF and CRLF', () => {
    const mixed = '---\r\ntitles:\n  - 混合行尾\r\ncover: 封面\r\n---\r\n\r\nBody\r\n'
    expect(parseMarkdown(mixed).meta).toEqual({
      titles: ['混合行尾'],
      cover: '封面',
      author: '',
    })
  })

  it('does not mistake a front-matter-looking body for front matter', () => {
    const plain = '---\n\nBody\n'
    for (const [name, src] of Object.entries({
      LF: plain,
      CRLF: plain.replace(/\n/g, '\r\n'),
      CR: plain.replace(/\n/g, '\r'),
    })) {
      const doc = parseMarkdown(src)
      expect(doc.meta, name).toEqual({ titles: [], cover: '', author: '' })
      expect(doc.blocks.map((b) => b.type), name).toEqual(['hr', 'paragraph'])
    }
  })

  it('keeps the first block at line zero when there is no front matter', () => {
    for (const [name, src] of Object.entries({
      LF: '# 标题\n\n正文\n',
      CRLF: '# 标题\r\n\r\n正文\r\n',
      CR: '# 标题\r\r正文\r',
    })) {
      const doc = parseMarkdown(src)
      expect(doc.blocks[0].line, name).toBe(0)
      expect(doc.blocks[1].line, name).toBe(2)
    }
  })
})
