import { describe, expect, it } from 'vitest'
import { blankComments, commentRanges, isInComment } from './comments'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { getTheme } from './themes'

const SIG = { layout: '', proof: '', review: '' }
const render = (src: string) => renderDoc(parseMarkdown(src), getTheme('golden'), SIG).html

describe('commentRanges', () => {
  it('finds a comment and reports its whole span', () => {
    const src = '甲 <!-- 备注 --> 乙'
    expect(commentRanges(src)).toEqual([[2, 13]])
    expect(isInComment(commentRanges(src), 3)).toBe(true)
    expect(isInComment(commentRanges(src), 15)).toBe(false)
  })

  it('finds several, including a multi-line one', () => {
    const src = '<!-- 一 -->\n正文\n<!--\n二\n-->'
    const ranges = commentRanges(src)
    expect(ranges).toHaveLength(2)
    expect(ranges[1]).toEqual([src.indexOf('<!--\n'), src.length])
  })

  it('leaves a comment inside a fenced code block alone', () => {
    expect(commentRanges('```html\n<!-- 代码里的 -->\n```')).toEqual([])
  })

  it('clips a comment that spans a fence, keeping the code literal', () => {
    const src = '<!-- 起\n```\ncode\n```\n-->'
    const ranges = commentRanges(src)
    const inside = (needle: string) => isInComment(ranges, src.indexOf(needle))
    expect(inside('<!--')).toBe(true)
    expect(inside('code')).toBe(false)
    expect(inside('-->')).toBe(true)
  })

  it('treats an unclosed opener as ordinary text', () => {
    expect(commentRanges('正文 <!-- 没有收尾')).toEqual([])
  })
})

describe('blankComments', () => {
  it('keeps every offset and line, blanks the characters', () => {
    const src = '甲 <!-- 备\n注 --> 乙'
    const out = blankComments(src)
    expect(out).toHaveLength(src.length)
    expect(out.split('\n')).toHaveLength(src.split('\n').length)
    expect(out.startsWith('甲 ')).toBe(true)
    expect(out.endsWith(' 乙')).toBe(true)
    expect(out).not.toContain('备')
    expect(out).not.toContain('<!--')
  })

  it('returns the input untouched when there is nothing to blank', () => {
    const src = '普通正文\n\n![图](img:key)'
    expect(blankComments(src)).toBe(src)
  })
})

describe('the note is source-only all the way through the pipeline', () => {
  it('drops a paragraph that is nothing but a comment', () => {
    const doc = parseMarkdown('<!-- 这行只是备注 -->\n\n正文一段。\n')
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].type).toBe('paragraph')
  })

  it('strips an inline comment out of the sentence around it', () => {
    const html = render('前<!-- 备注 -->后\n')
    expect(html).toContain('前')
    expect(html).toContain('后')
    expect(html).not.toContain('备注')
    expect(html).not.toContain('&lt;!--')
  })

  it('keeps the note out of what the reader gets, front matter or not', () => {
    const html = render('---\ntitles:\n  - 标题\n---\n\n<!-- 只存在源稿里 -->\n\n正文\n')
    expect(html).not.toContain('只存在源稿里')
    expect(html).not.toContain('&lt;!--')
    expect(html).toContain('正文')
  })

  it('still renders a comment inside a code fence, literally', () => {
    // A document about HTML has to be able to show one.
    expect(render('```html\n<!-- 代码示例 -->\n```\n')).toContain('&lt;!-- 代码示例 --&gt;')
  })

  it('keeps block line numbers pointing at the editor text', () => {
    // Blanking instead of deleting is what makes this hold: the paragraph sits
    // on the same line whether the note above it is there or not.
    const withNote = parseMarkdown('<!-- 备注 -->\n\n正文\n')
    const withoutNote = parseMarkdown('\n\n正文\n')
    expect(withNote.blocks[0].line).toBe(withoutNote.blocks[0].line)
  })

  it('leaves the shipped sample article free of its own note', () => {
    const html = render(
      '<!-- 这一行是编辑备注，只存在于源稿里，渲染和复制都不会带上它。 -->\n\n正文\n',
    )
    expect(html).not.toContain('编辑备注')
  })
})
