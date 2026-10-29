import { describe, expect, it } from 'vitest'
import { parseMarkdown, walkInline } from './parse'
import type { ListBlock, ListItemPart } from './types'
import MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'

const md = new MarkdownIt({ html: false }).use(markdownItMark)

function segsOf(text: string) {
  const tokens = md.parseInline(text, {})
  return walkInline(tokens[0]?.children ?? null)
}

describe('walkInline', () => {
  it('does not leak bold past its closing marker', () => {
    const segs = segsOf('前面 **加粗** 后面')
    expect(segs.map((s) => [s.text, !!s.bold])).toEqual([
      ['前面 ', false],
      ['加粗', true],
      [' 后面', false],
    ])
  })

  it('does not leak mark, italic, strike or link', () => {
    for (const [src, key] of [
      ['==重点== 后文', 'mark'],
      ['*斜体* 后文', 'italic'],
      ['~~删除~~ 后文', 'strike'],
      ['[链接](https://a.b) 后文', 'link'],
    ] as const) {
      const segs = segsOf(src)
      const last = segs[segs.length - 1]
      expect(last[key as keyof typeof last], `${src} leaked ${key}`).toBeFalsy()
      expect(segs[0][key as keyof typeof segs[0]], `${src} lost ${key}`).toBeTruthy()
    }
  })

  it('restores the outer style when a nested marker closes', () => {
    const segs = segsOf('**粗 *斜* 仍粗** 普通')
    expect(segs.map((s) => [s.text, !!s.bold, !!s.italic])).toEqual([
      ['粗 ', true, false],
      ['斜', true, true],
      [' 仍粗', true, false],
      [' 普通', false, false],
    ])
  })
})

describe('parseMarkdown tables', () => {
  it('keeps header, rows and per-column alignment', () => {
    const doc = parseMarkdown('| 甲 | 乙 | 丙 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n')
    const table = doc.blocks.find((b) => b.type === 'table')
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.align).toEqual(['left', 'center', 'right'])
    expect(table.head).toHaveLength(3)
    expect(table.head.map((c) => c[0].text)).toEqual(['甲', '乙', '丙'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[1].map((c) => c[0].text)).toEqual(['4', '5', '6'])
  })

  it('keeps inline emphasis inside cells', () => {
    const doc = parseMarkdown('| 甲 |\n|---|\n| **粗** |\n')
    const table = doc.blocks.find((b) => b.type === 'table')
    if (table?.type !== 'table') throw new Error('no table')
    expect(table.rows[0][0].map((s) => [s.text, !!s.bold])).toEqual([['粗', true]])
  })
})

const segText = (segs: { text: string }[]) => segs.map((s) => s.text).join('')

function listShape(list: ListBlock): unknown[] {
  return list.items.map((item) => ({
    id: item.id,
    parts: item.parts.map((part: ListItemPart) =>
      part.type === 'paragraph'
        ? { paragraph: segText(part.segs) }
        : { list: listShape(part.list) },
    ),
  }))
}

describe('parseMarkdown nested lists', () => {
  it('keeps three levels, sibling order and the item after the child list', () => {
    const doc = parseMarkdown('- outer\n  - inner\n    - deep\n  - inner2\n- after\n')
    const list = doc.blocks.find((b) => b.type === 'list')
    if (!list || list.type !== 'list') throw new Error('no list')
    expect(list.ordered).toBe(false)
    expect(list.start).toBe(1)
    expect(listShape(list)).toEqual([
      {
        id: '1',
        parts: [
          { paragraph: 'outer' },
          {
            list: [
              {
                id: '1.1',
                parts: [
                  { paragraph: 'inner' },
                  { list: [{ id: '1.1.1', parts: [{ paragraph: 'deep' }] }] },
                ],
              },
              { id: '1.2', parts: [{ paragraph: 'inner2' }] },
            ],
          },
        ],
      },
      { id: '2', parts: [{ paragraph: 'after' }] },
    ])
  })

  it('preserves ordered start values and mixed nested marker types', () => {
    const doc = parseMarkdown('3. three\n   - bullet\n4. four\n   1. ordered child\n   2. child two\n5. five\n')
    const list = doc.blocks.find((b) => b.type === 'list')
    if (!list || list.type !== 'list') throw new Error('no list')
    expect(list.ordered).toBe(true)
    expect(list.start).toBe(3)
    expect(list.items.map((item) => item.id)).toEqual(['1', '2', '3'])
    const firstChild = list.items[0].parts.find((part) => part.type === 'list')
    expect(firstChild?.type === 'list' && firstChild.list.ordered).toBe(false)
    const secondChild = list.items[1].parts.find((part) => part.type === 'list')
    expect(secondChild?.type === 'list' && secondChild.list.start).toBe(1)
    expect(secondChild?.type === 'list' && secondChild.list.items.map((item) => segText(
      item.parts[0].type === 'paragraph' ? item.parts[0].segs : [],
    ))).toEqual(['ordered child', 'child two'])
  })

  it('keeps multiple paragraphs inside one item in order', () => {
    const doc = parseMarkdown('- first paragraph\n\n  second paragraph\n- next\n')
    const list = doc.blocks.find((b) => b.type === 'list')
    if (!list || list.type !== 'list') throw new Error('no list')
    expect(list.items[0].parts.map((part) =>
      part.type === 'paragraph' ? segText(part.segs) : 'nested',
    )).toEqual(['first paragraph', 'second paragraph'])
    expect(list.items).toHaveLength(2)
  })

  it('keeps the whole token span for scroll mapping', () => {
    const doc = parseMarkdown('# 标题\n\n- outer\n  - inner\n- after\n\n尾段\n')
    const list = doc.blocks.find((b) => b.type === 'list')
    if (!list || list.type !== 'list') throw new Error('no list')
    expect(list.line).toBe(2)
    expect(list.lineEnd).toBeGreaterThanOrEqual(5)
  })
})
