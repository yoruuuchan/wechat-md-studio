import { describe, expect, it } from 'vitest'
import {
  applyBrush,
  buildCarousel,
  buildCodeFence,
  buildGallery,
  buildImagePlaceholder,
  buildMath,
  buildMermaid,
  buildTable,
  clearInline,
  convertBlocksTo,
  inlineStateAt,
  snapshotAt,
  toggleInline,
  toggleLink,
  toggleList,
  toBlockInfo,
  type BlockInfo,
  type Selection,
} from './md-format'
import { parseMarkdown } from './parse'

/** Blocks of a document, in the shape the toolbar reads. */
function blocksOf(src: string): BlockInfo[] {
  return toBlockInfo(parseMarkdown(src).blocks)
}

/** A selection covering the first occurrence of `needle`. */
function selOf(src: string, needle: string): Selection {
  const at = src.indexOf(needle)
  if (at < 0) throw new Error(`needle not found: ${needle}`)
  return { from: at, to: at + needle.length }
}

describe('inline state detection', () => {
  it('lights a format when the cursor is inside it', () => {
    const src = '前**加粗**后'
    const at = src.indexOf('加') + 1
    const st = inlineStateAt(src, { from: at, to: at })
    expect(st.bold).toBe(true)
    expect(st.italic).toBe(false)
  })

  it('reads every format the dialect supports', () => {
    const cases: [string, keyof ReturnType<typeof inlineStateAt>][] = [
      ['**b**', 'bold'],
      ['==m==', 'mark'],
      ['*i*', 'italic'],
      ['~~s~~', 'strike'],
      ['`c`', 'code'],
      ['[t](https://a.com)', 'link'],
    ]
    for (const [frag, flag] of cases) {
      const src = `前${frag}后`
      const at = src.indexOf(frag[0]) + 2
      const st = inlineStateAt(src, { from: at, to: at })
      expect(st[flag], `${frag} -> ${flag}`).toBe(true)
    }
  })

  it('detects nesting', () => {
    const src = '**==重点==**'
    const at = src.indexOf('重')
    const st = inlineStateAt(src, { from: at, to: at })
    expect(st.bold).toBe(true)
    expect(st.mark).toBe(true)
  })

  it('stays on across CJK punctuation, which the parser accepts too', () => {
    const src = '这是==“重点”==内容'
    const at = src.indexOf('重')
    expect(inlineStateAt(src, { from: at, to: at }).mark).toBe(true)
  })

  it('is on at the inner boundary and off just outside it', () => {
    const src = 'x**ab**y'
    expect(inlineStateAt(src, { from: 2, to: 2 }).bold).toBe(false) // before **
    expect(inlineStateAt(src, { from: 4, to: 4 }).bold).toBe(true) // right after **
    expect(inlineStateAt(src, { from: 6, to: 6 }).bold).toBe(true) // right before close
    expect(inlineStateAt(src, { from: 8, to: 8 }).bold).toBe(false) // after the pair
  })

  it('ignores escaped markers', () => {
    const src = '\\*\\*不是加粗\\*\\*'
    const st = inlineStateAt(src, { from: 6, to: 6 })
    expect(st.bold).toBe(false)
    expect(st.italic).toBe(false)
  })

  it('does not light markers inside an inline code span', () => {
    const src = '`**a**` 普通'
    const st = inlineStateAt(src, { from: 4, to: 4 })
    expect(st.bold).toBe(false)
    expect(st.code).toBe(true)
  })

  it('does not pair markers across paragraphs', () => {
    const src = '**开\n\n收**'
    const st = inlineStateAt(src, { from: 1, to: 1 })
    expect(st.bold).toBe(false)
  })
})

describe('inline toggles', () => {
  const wrap = (src: string, needle: string, format: Parameters<typeof toggleInline>[2]) =>
    toggleInline(src, selOf(src, needle), format)

  it('wraps the selection and keeps the text selected', () => {
    const r = wrap('甲乙丙', '甲乙', 'bold')!
    expect(r.doc).toBe('**甲乙**丙')
    expect(r.doc.slice(r.from, r.to)).toBe('甲乙')
  })

  it('inserts a placeholder and selects it when nothing is selected', () => {
    const r = toggleInline('甲乙', { from: 1, to: 1 }, 'italic')!
    expect(r.doc).toBe('甲*斜体文字*乙')
    expect(r.doc.slice(r.from, r.to)).toBe('斜体文字')
  })

  it('takes the format off when the cursor sits inside it', () => {
    const src = '前**加粗**后'
    const at = src.indexOf('加') + 1
    const r = toggleInline(src, { from: at, to: at }, 'bold')!
    expect(r.doc).toBe('前加粗后')
  })

  it('takes the format off when the selection covers the whole pair', () => {
    const r = toggleInline('**甲乙**', { from: 0, to: 6 }, 'bold')!
    expect(r.doc).toBe('甲乙')
  })

  it('unwraps only the pair the selection sits in', () => {
    const src = '**a** 与 **b**'
    const at = src.indexOf('b')
    const r = toggleInline(src, { from: at, to: at + 1 }, 'bold')!
    expect(r.doc).toBe('**a** 与 b')
  })

  it('nests by wrapping inside the existing pair', () => {
    const src = '**甲乙**'
    const r = toggleInline(src, selOf(src, '甲乙'), 'mark')!
    expect(r.doc).toBe('**==甲乙==**')
    const back = toggleInline(r.doc, { from: r.from, to: r.to }, 'mark')!
    expect(back.doc).toBe('**甲乙**')
  })

  it('uses placeholders per format', () => {
    expect(toggleInline('x', { from: 1, to: 1 }, 'mark')!.doc).toBe('x==重点文字==')
    expect(toggleInline('x', { from: 1, to: 1 }, 'strike')!.doc).toBe('x~~删除文字~~')
    expect(toggleInline('x', { from: 1, to: 1 }, 'code')!.doc).toBe('x`代码`')
  })

  it('leaves a code span alone when the selection crosses lines', () => {
    expect(toggleInline('ab\ncd', { from: 0, to: 5 }, 'code')).toBeNull()
  })

  it('does nothing inside a fenced code block', () => {
    const src = '```\n**text**\n```'
    const at = src.indexOf('text')
    expect(toggleInline(src, { from: at, to: at + 4 }, 'bold')).toBeNull()
  })
})

describe('link toggle', () => {
  it('turns a selection into a label with the cursor in the parens', () => {
    const r = toggleLink('见甲乙', selOf('见甲乙', '甲乙'))!
    expect(r.doc).toBe('见[甲乙]()')
    expect(r.from).toBe(r.doc.indexOf('(') + 1)
  })

  it('inserts a placeholder label and selects it', () => {
    const r = toggleLink('x', { from: 1, to: 1 })!
    expect(r.doc).toBe('x[链接文字]()')
    expect(r.doc.slice(r.from, r.to)).toBe('链接文字')
  })

  it('removes an existing link but keeps its label', () => {
    const src = '见[甲乙](https://a.com)了'
    const r = toggleLink(src, selOf(src, '甲乙'))!
    expect(r.doc).toBe('见甲乙了')
  })
})

describe('clear format', () => {
  it('strips the formats inside the selection', () => {
    const src = '前**加==重**点==后'
    // Select roughly the middle; every pair overlapping it goes.
    const r = clearInline(src, { from: src.indexOf('加'), to: src.indexOf('重') + 1 })!
    expect(r.doc).toBe('前加重点后')
  })

  it('strips the pair the cursor sits in', () => {
    const src = '前==重点==后'
    const at = src.indexOf('点')
    const r = clearInline(src, { from: at, to: at })!
    expect(r.doc).toBe('前重点后')
  })

  it('keeps the label of a link it clears', () => {
    const src = '看[这里](https://a.com)'
    const r = clearInline(src, { from: 1, to: 3 })!
    expect(r.doc).toBe('看这里')
  })

  it('returns null when there is nothing to clear', () => {
    expect(clearInline('普通文字', { from: 1, to: 3 })).toBeNull()
  })
})

describe('block conversion', () => {
  const convert = (src: string, target: Parameters<typeof convertBlocksTo>[3], needle?: string) => {
    const sel = needle ? selOf(src, needle) : { from: 0, to: 0 }
    return convertBlocksTo(src, sel, blocksOf(src), target)
  }

  it('turns a paragraph into a numbered section heading', () => {
    const r = convert('一段说明文字', { kind: 'heading' })!
    expect(r.doc).toBe('## 一段说明文字')
    const [b] = blocksOf(r.doc)
    expect(b).toMatchObject({ kind: 'heading', kicker: '' })
    expect(parseMarkdown(r.doc).blocks[0]).toMatchObject({ type: 'heading', numbered: true, title: '一段说明文字' })
  })

  it('keeps the title and drops the kicker when a section becomes a subheading', () => {
    const r = convert('## IMAGES | 图片与轮播', { kind: 'subheading' })!
    expect(r.doc).toBe('### 图片与轮播')
  })

  it('keeps the title when a section becomes a plain paragraph', () => {
    const r = convert('## IMAGES | 图片与轮播', { kind: 'paragraph' })!
    expect(r.doc).toBe('图片与轮播')
  })

  it('carries the kicker into a new section heading', () => {
    const r = convert('普通一段', { kind: 'heading', kicker: 'NOTE' })!
    expect(r.doc).toBe('## NOTE | 普通一段')
  })

  it('wraps a paragraph in the quote card and back', () => {
    const card = convert('金句内容', { kind: 'quoteCard' })!
    expect(card.doc).toBe('> 金句内容')
    const plain = convertBlocksTo(card.doc, { from: 1, to: 1 }, blocksOf(card.doc), { kind: 'paragraph' })!
    expect(plain.doc).toBe('金句内容')
  })

  it('wraps multi-line paragraphs without losing text', () => {
    const r = convert('第一行\n第二行', { kind: 'quoteBox' })!
    expect(r.doc).toBe(':::quote\n第一行\n第二行\n:::')
    const back = convertBlocksTo(r.doc, { from: 3, to: 3 }, blocksOf(r.doc), { kind: 'paragraph' })!
    expect(back.doc).toBe('第一行\n第二行')
  })

  it('moves a quote card into a centered block', () => {
    const src = '> 一句话'
    const r = convertBlocksTo(src, { from: 0, to: 0 }, blocksOf(src), { kind: 'center' })!
    expect(r.doc).toBe(':::center\n一句话\n:::')
  })

  it('leaves a block alone when it already has the target kind', () => {
    expect(convert('> 一句话', { kind: 'quoteCard' })).toBeNull()
    expect(convert('普通正文', { kind: 'paragraph' })).toBeNull()
  })

  it('converts every block the selection touches', () => {
    const src = '第一段\n\n第二段'
    const r = convertBlocksTo(src, { from: 0, to: src.length }, blocksOf(src), { kind: 'quoteCard' })!
    expect(r.doc).toBe('> 第一段\n\n> 第二段')
  })

  it('does not touch a table or a code block', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(convert(src, { kind: 'heading' })).toBeNull()
  })

  it('keeps the cursor near the same text in a one-line conversion', () => {
    const src = '一二三四五'
    const r = convertBlocksTo(src, { from: 2, to: 2 }, blocksOf(src), { kind: 'heading' })!
    expect(r.doc).toBe('## 一二三四五')
    expect(r.doc[r.from - 1]).toBe('二')
  })
})

describe('list toggle', () => {
  it('bullets the selected lines', () => {
    const src = '第一项\n第二项'
    const r = toggleList(src, { from: 0, to: src.length }, false)!
    expect(r.doc).toBe('- 第一项\n- 第二项')
  })

  it('numbers the selected lines in order', () => {
    const src = '第一项\n第二项\n第三项'
    const r = toggleList(src, { from: 0, to: src.length }, true)!
    expect(r.doc).toBe('1. 第一项\n2. 第二项\n3. 第三项')
  })

  it('switches an existing list to the other kind', () => {
    const src = '- 甲\n- 乙'
    const r = toggleList(src, { from: 0, to: src.length }, true)!
    expect(r.doc).toBe('1. 甲\n2. 乙')
  })

  it('takes the markers off when every line already has them', () => {
    const src = '- 甲\n- 乙'
    const r = toggleList(src, { from: 0, to: src.length }, false)!
    expect(r.doc).toBe('甲\n乙')
  })

  it('converts only the cursor line when nothing is selected', () => {
    const src = '甲\n乙'
    const r = toggleList(src, { from: 2, to: 2 }, false)!
    expect(r.doc).toBe('甲\n- 乙')
  })

  it('keeps indentation', () => {
    const src = '  - 甲'
    const r = toggleList(src, { from: 4, to: 4 }, true)!
    expect(r.doc).toBe('  1. 甲')
  })
})

describe('format brush', () => {
  it('captures the semantic format, not a style', () => {
    const src = '**==重点==**'
    const snap = snapshotAt(src, { from: src.indexOf('重'), to: src.indexOf('点') + 1 }, blocksOf(src))
    expect(snap.inline).toEqual({ bold: true, mark: true, italic: false, strike: false, code: false })
    expect(snap.block).toBe('paragraph')
  })

  it('paints inline formats onto another passage', () => {
    const src = '**==重点==**\n\n普通文字'
    const snap = snapshotAt(src, selOf(src, '重点'), blocksOf(src))
    const target = selOf(src, '普通文字')
    const r = applyBrush(src, target, snap, blocksOf(src))!
    expect(r.doc).toBe('**==重点==**\n\n**==普通文字==**')
  })

  it('brings the target to exactly the captured inline state', () => {
    const src = '==重点==\n\n**加粗**'
    const snap = snapshotAt(src, selOf(src, '重点'), blocksOf(src))
    const r = applyBrush(src, selOf(src, '加粗'), snap, blocksOf(src))!
    expect(r.doc).toBe('==重点==\n\n==加粗==')
  })

  it('paints a block kind onto another block', () => {
    const src = '## IMAGES | 图片\n\n普通段落'
    const snap = snapshotAt(src, { from: 4, to: 4 }, blocksOf(src))
    const r = applyBrush(src, selOf(src, '普通段落'), snap, blocksOf(src))!
    expect(r.doc).toBe('## IMAGES | 图片\n\n## IMAGES | 普通段落')
  })

  it('paints plain text back over a decorated block', () => {
    const src = '普通段落\n\n## IMAGES | 图片'
    const snap = snapshotAt(src, { from: 1, to: 1 }, blocksOf(src))
    const r = applyBrush(src, selOf(src, '图片'), snap, blocksOf(src))!
    expect(r.doc).toBe('普通段落\n\n图片')
  })

  it('does nothing when target and source already match', () => {
    const src = '**甲**\n\n**乙**'
    const blocks = blocksOf(src)
    const snap = snapshotAt(src, { from: 3, to: 3 }, blocks)
    const r = applyBrush(src, { from: src.indexOf('乙'), to: src.indexOf('乙') + 1 }, snap, blocks)
    expect(r).toBeNull()
  })
})

describe('insert templates', () => {
  it('builds a table with the requested alignment', () => {
    const t = buildTable(3, 3, 'center')
    const lines = t.text.split('\n')
    expect(lines[0]).toBe('| 表头 | 表头 | 表头 |')
    expect(lines[1]).toBe('| :---: | :---: | :---: |')
    // `rows` counts the header: 3x3 is a header plus two body rows.
    expect(lines).toHaveLength(4)
    expect(t.caret).toBe(2)
  })

  it('builds a table the project parser accepts', () => {
    const doc = parseMarkdown(buildTable(2, 2, 'right').text)
    const table = doc.blocks[0]
    expect(table.type).toBe('table')
    if (table.type === 'table') {
      expect(table.head).toHaveLength(2)
      expect(table.align).toEqual(['right', 'right'])
      expect(table.rows).toHaveLength(1)
    }
  })

  it('builds a carousel with the chosen ratio', () => {
    const t = buildCarousel('9:16')
    expect(t.text).toContain(':::carousel 9:16 ')
    expect(t.text.split('\n').filter((l) => l === '![]()')).toHaveLength(2)
    expect(parseMarkdown(t.text).blocks[0]).toMatchObject({ type: 'carousel', ratio: '9:16' })
  })

  it('builds a gallery with columns and ratio', () => {
    const t = buildGallery(3, '1:1')
    expect(t.text).toContain(':::gallery 3 1:1 ')
    expect(t.text.split('\n').filter((l) => l === '![]()')).toHaveLength(3)
    expect(parseMarkdown(t.text).blocks[0]).toMatchObject({ type: 'gallery', cols: 3, ratio: '1:1' })
  })

  it('builds math, code, mermaid and image templates', () => {
    expect(parseMarkdown(buildMath('a+b').text).blocks[0]).toMatchObject({ type: 'math', tex: 'a+b' })
    expect(buildCodeFence('bash').text).toBe('```bash\n\n```')
    expect(buildMermaid().text).toBe('```mermaid 图注\n\n```')
    const ph = buildImagePlaceholder()
    expect(ph.text).toBe('![图注]()')
    expect(ph.text.slice(ph.caret!, ph.caretEnd!)).toBe('图注')
  })
})
