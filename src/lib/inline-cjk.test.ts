import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { THEMES } from './themes'
import { isCjkPunct, isMarker } from './cjk-inline'
import type { InlineSeg } from './types'

const sig = { layout: '排版', proof: '校对', review: '审核' }

/** Segs of the first paragraph of a one-paragraph document. */
function segsOf(src: string): InlineSeg[] {
  const block = parseMarkdown(src + '\n').blocks[0]
  if (block.type !== 'paragraph') throw new Error(`expected a paragraph, got ${block.type}`)
  return block.segs
}

/** The published HTML of a one-paragraph document. */
function htmlOf(src: string): string {
  return renderDoc(parseMarkdown(src + '\n'), THEMES[0], sig, (s) => s).html
}

/**
 * Regression: Chinese prose writes full-width punctuation straight after the
 * word it belongs to, and CommonMark's flanking test counts that punctuation as
 * punctuation - so `这是**“重点”**内容` was scored as an opener followed by
 * punctuation but not preceded by whitespace or punctuation, refused, and the
 * `**` stayed visible in the article with nothing bold.
 */
const STRONG: [string, InlineSeg[]][] = [
  ['这是**重点**内容', [{ text: '这是' }, { text: '重点', bold: true }, { text: '内容' }]],
  ['这是**“重点”**内容', [{ text: '这是' }, { text: '“重点”', bold: true }, { text: '内容' }]],
  ['采用**《办法》**执行', [{ text: '采用' }, { text: '《办法》', bold: true }, { text: '执行' }]],
  ['前文**（重点）**后文', [{ text: '前文' }, { text: '（重点）', bold: true }, { text: '后文' }]],
  [
    '构建**“需求发布—智能拆解—模型调用—智能体开发—接单协作—合同履约—成果交付—数字资产沉淀与变现”**的全链路服务体系',
    [
      { text: '构建' },
      {
        text: '“需求发布—智能拆解—模型调用—智能体开发—接单协作—合同履约—成果交付—数字资产沉淀与变现”',
        bold: true,
      },
      { text: '的全链路服务体系' },
    ],
  ],
]

const MARK: [string, InlineSeg[]][] = [
  ['这是==重点==内容', [{ text: '这是' }, { text: '重点', mark: true }, { text: '内容' }]],
  ['这是==“重点”==内容', [{ text: '这是' }, { text: '“重点”', mark: true }, { text: '内容' }]],
  ['采用==《办法》==执行', [{ text: '采用' }, { text: '《办法》', mark: true }, { text: '执行' }]],
  ['前文==（重点）==后文', [{ text: '前文' }, { text: '（重点）', mark: true }, { text: '后文' }]],
  [
    '赛事采用==“专家评审70% + 大众投票30%”==的综合评审法',
    [
      { text: '赛事采用' },
      { text: '“专家评审70% + 大众投票30%”', mark: true },
      { text: '的综合评审法' },
    ],
  ],
]

describe('strong beside Chinese punctuation', () => {
  it.each(STRONG)('%s', (src, expected) => {
    expect(segsOf(src)).toEqual(expected)
  })
})

describe('mark beside Chinese punctuation', () => {
  it.each(MARK)('%s', (src, expected) => {
    expect(segsOf(src)).toEqual(expected)
  })
})

describe('the delimiters reach neither the text nor the HTML', () => {
  it.each([...STRONG, ...MARK])('%s', (src, expected) => {
    // The text is exactly the source minus the markers, with nothing left over.
    const text = expected.map((s) => s.text).join('')
    expect(segsOf(src).map((s) => s.text).join('')).toBe(text)
    expect(text).not.toContain('**')
    expect(text).not.toContain('==')

    const html = htmlOf(src)
    expect(html).not.toContain('**')
    expect(html).not.toContain('==')
    for (const seg of expected) expect(html).toContain(seg.text)
    if (expected.some((s) => s.bold)) expect(html).toContain('<strong style=')
  })
})

describe('nesting and markers standing next to each other', () => {
  it('keeps a mark inside bold', () => {
    expect(segsOf('这是**加粗且包含==重点==内容**的测试')).toEqual([
      { text: '这是' },
      { text: '加粗且包含', bold: true },
      { text: '重点', bold: true, mark: true },
      { text: '内容', bold: true },
      { text: '的测试' },
    ])
  })

  it('keeps bold inside a mark', () => {
    // The closing `==` is preceded by `*`, which the flanking test used to read
    // as punctuation: the marker was refused and both `==` stayed in the text.
    expect(segsOf('这是==标记中包含**加粗**==的测试')).toEqual([
      { text: '这是' },
      { text: '标记中包含', mark: true },
      { text: '加粗', mark: true, bold: true },
      { text: '的测试' },
    ])
  })

  it('renders the nested pair in the published HTML', () => {
    const html = htmlOf('这是==标记中包含**加粗**==的测试')
    expect(html).not.toContain('==')
    expect(html).not.toContain('**')
    for (const t of ['这是', '标记中包含', '加粗', '的测试']) expect(html).toContain(t)
    // The theme paints a marked run with its highlight border. The run that is
    // both bold and marked gets it too - bold inside a mark is drawn by the
    // mark's own style, which already carries font-weight:700.
    expect(html.match(/border-bottom/g)).toHaveLength(2)
    expect(html).toContain('font-weight:700')
  })

  it('reads a run hugging a code span or a strike as nested too', () => {
    expect(segsOf('==`code`==')).toEqual([{ text: 'code', code: true, mark: true }])
    expect(segsOf('**~~删掉~~**')).toEqual([{ text: '删掉', bold: true, strike: true }])
  })
})

describe('the rest of the inline syntax is unchanged', () => {
  it.each([
    ['*斜体* 普通', [{ text: '斜体', italic: true }, { text: ' 普通' }]],
    ['~~删除线~~ 普通', [{ text: '删除线', strike: true }, { text: ' 普通' }]],
    ['`代码` 普通', [{ text: '代码', code: true }, { text: ' 普通' }]],
    [
      '[链接](https://a.com) 普通',
      [{ text: '链接', link: 'https://a.com' }, { text: ' 普通' }],
    ],
    ['**粗** 普通', [{ text: '粗', bold: true }, { text: ' 普通' }]],
    ['英文**重点**后文', [{ text: '英文' }, { text: '重点', bold: true }, { text: '后文' }]],
  ] as [string, InlineSeg[]][])('%s', (src, expected) => {
    expect(segsOf(src)).toEqual(expected)
  })

  it('leaves a marker that is glued to punctuation in the middle of a word alone', () => {
    // `word**"quote"**word` is the case the CommonMark rule exists for: ASCII
    // punctuation keeps the standard meaning, so this stays literal text. The
    // CJK fix is deliberately not "any punctuation anywhere".
    expect(segsOf('word**"bold"**word')).toEqual([{ text: 'word**"bold"**word' }])
  })

  it('still refuses an underscore inside a word, full-width neighbours included', () => {
    expect(segsOf('甲_重点_乙')).toEqual([{ text: '甲_重点_乙' }])
    expect(segsOf('（_重点_）')).toEqual([
      { text: '（' },
      { text: '重点', italic: true },
      { text: '）' },
    ])
    expect(segsOf('_重点_。')).toEqual([{ text: '重点', italic: true }, { text: '。' }])
  })

  it('keeps a link href off the Chinese text around it', () => {
    expect(segsOf('前文[链接](https://a.com)后文')).toEqual([
      { text: '前文' },
      { text: '链接', link: 'https://a.com' },
      { text: '后文' },
    ])
  })

  it('does not merge styled runs into the plain text beside them', () => {
    const segs = segsOf('前文==“评审”==之后的普通文字')
    expect(segs.map((s) => s.text).join('')).toBe('前文“评审”之后的普通文字')
    expect(segs.filter((s) => s.mark)).toHaveLength(1)
    expect(segs[segs.length - 1].mark).toBeFalsy()
    expect(segs[0].mark).toBeFalsy()
  })
})

describe('what counts as punctuation for flanking', () => {
  it.each(['“', '”', '（', '）', '《', '》', '—', '…', '、', '。', '！', '？', '，', '：', '；', '「', '」', '·'])(
    'treats %s as CJK punctuation',
    (ch) => {
      expect(isCjkPunct(ch.codePointAt(0)!)).toBe(true)
    },
  )

  it.each(['a', '中', 'A', '1', ' ', '.', ',', '"', '(', ')'])(
    'leaves %s to the standard rule',
    (ch) => {
      expect(isCjkPunct(ch.codePointAt(0)!)).toBe(false)
    },
  )

  it('knows the characters a Markdown run is made of', () => {
    for (const ch of ['*', '_', '~', '=', '`']) expect(isMarker(ch.codePointAt(0)!)).toBe(true)
    for (const ch of ['a', '-', '"']) expect(isMarker(ch.codePointAt(0)!)).toBe(false)
  })
})
