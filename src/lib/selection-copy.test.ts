// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { serializeWechatSelection } from './selection-copy'

// Fixtures mirror the golden theme's real output, inline styles included - the
// whole point of the serializer is which of these styles survive a copy.

const ROOT_STYLE =
  'max-width:677px;margin:0 auto;background:#FFFFFF;color:#333333;line-height:1.75;letter-spacing:1px;overflow-x:hidden;padding:0 10px;box-sizing:border-box;'
const PARA_STYLE = 'margin:24px 0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:justify;text-indent:2em;color:#333333;'
const CARD_STYLE = 'margin:0;padding:16px 18px;background:#F6FAFF;border-left:3px solid #1677FF;'

/** Mount a slice of preview markup and return its article root. */
function mount(inner: string): Element {
  const host = document.createElement('div')
  host.innerHTML = `<section style="${ROOT_STYLE}">${inner}</section>`
  document.body.appendChild(host)
  return host.firstElementChild as Element
}

/** Hand the page a selection from one text position to another. */
function select(start: Node, startOffset: number, end: Node, endOffset: number): Selection {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

/** The first text node under `scope` that contains `needle`. */
function textNodeOf(scope: Element, needle: string): Text {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.includes(needle)) return node as Text
  }
  throw new Error(`no text node containing "${needle}"`)
}

/** Selection covering `needle` split at [from, to) inside its own text node. */
function selectWithin(root: Element, needle: string, from: number, to: number): Selection {
  const text = textNodeOf(root, needle)
  const at = text.nodeValue!.indexOf(needle)
  return select(text, at + from, text, at + to)
}

/** The one thing every serialized fragment must be: a single article root. */
function expectSelfContained(html: string, root: Element) {
  const host = document.createElement('div')
  host.innerHTML = html
  expect(host.children).toHaveLength(1)
  expect(host.firstElementChild!.tagName).toBe('SECTION')
  expect((host.firstElementChild as Element).getAttribute('style')).toBe(root.getAttribute('style'))
  expect(html).not.toMatch(/\sclass=|\sid=/)
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('serializeWechatSelection', () => {
  it('copies a few characters without widening to the paragraph', () => {
    const root = mount(`<p style="${PARA_STYLE}"><span leaf="">一段文字</span></p>`)
    const text = textNodeOf(root, '一段文字')
    const out = serializeWechatSelection(root, select(text, 2, text, 4))
    expect(out).not.toBeNull()
    expect(out!.html).toBe(`<section style="${ROOT_STYLE}"><p style="${PARA_STYLE}"><span leaf="">文字</span></p></section>`)
    expect(out!.plainText).toBe('文字')
    expectSelfContained(out!.html, root)
  })

  it('copies the tail half of a paragraph and leaves the head behind', () => {
    const root = mount(`<p style="${PARA_STYLE}"><span leaf="">开头几个字，然后是一段正文。</span></p>`)
    const out = serializeWechatSelection(root, selectWithin(root, '开头几个字，然后是一段正文。', 6, 14))
    expect(out!.html).toBe(`<section style="${ROOT_STYLE}"><p style="${PARA_STYLE}"><span leaf="">然后是一段正文。</span></p></section>`)
    expect(out!.html).not.toContain('开头')
    expect(out!.plainText).toBe('然后是一段正文。')
  })

  it('keeps both paragraphs when the selection crosses them', () => {
    const root = mount(
      `<p style="第一条"><span leaf="">第一段前半部分</span></p><p style="第二条"><span leaf="">第二段后半部分</span></p>`,
    )
    const first = textNodeOf(root, '第一段前半部分')
    const second = textNodeOf(root, '第二段后半部分')
    const out = serializeWechatSelection(root, select(first, 3, second, 3))
    expect(out!.html).toBe(
      `<section style="${ROOT_STYLE}"><p style="第一条"><span leaf="">前半部分</span></p><p style="第二条"><span leaf="">第二段</span></p></section>`,
    )
    expect(out!.plainText).toBe('前半部分第二段')
  })

  it('carries the heading wrapper when the selection starts in a heading', () => {
    const root = mount(
      `<section style="章节"><p style="眉题">01 / 章节</p><h3 style="标题"><span leaf="">局部复制验收</span></h3></section><p style="正文"><span leaf="">正文第一句话在这里。</span></p>`,
    )
    const heading = textNodeOf(root, '局部复制验收')
    const body = textNodeOf(root, '正文第一句话在这里。')
    const out = serializeWechatSelection(root, select(heading, 2, body, 4))
    expect(out!.html).toContain('<section style="章节">')
    expect(out!.html).toContain('<h3 style="标题">')
    expect(out!.html).toContain('<p style="正文">')
    // The kicker sits before the selection start and must not come along.
    expect(out!.html).not.toContain('01 / 章节')
    expect(out!.plainText).toBe('复制验收正文第一')
  })

  it('keeps bold and marked runs intact when they are selected', () => {
    const root = mount(
      `<p style="${PARA_STYLE}"><span leaf="">普通</span><strong style="font-weight:700;"><span leaf="">加粗</span></strong><span style="border-bottom:2px solid #B9DAFF;font-weight:700;color:#1677FF;"><span leaf="">重点</span></span></p>`,
    )
    const plain = textNodeOf(root, '普通')
    const marked = textNodeOf(root, '重点')
    const out = serializeWechatSelection(root, select(plain, 1, marked, 2))
    expect(out!.html).toContain('<strong style="font-weight:700;"><span leaf="">加粗</span></strong>')
    expect(out!.html).toContain('<span style="border-bottom:2px solid #B9DAFF;font-weight:700;color:#1677FF;"><span leaf="">重点</span></span>')
    expect(out!.plainText).toBe('通加粗重点')
    expectSelfContained(out!.html, root)
  })

  it('rebuilds the quote card wrapper around a partial selection', () => {
    const root = mount(`<section style="${CARD_STYLE}"><p style="引文"><span leaf="">引文卡片里的文字</span></p></section>`)
    const out = serializeWechatSelection(root, selectWithin(root, '引文卡片里的文字', 4, 8))
    expect(out!.html).toBe(
      `<section style="${ROOT_STYLE}"><section style="${CARD_STYLE}"><p style="引文"><span leaf="">里的文字</span></p></section></section>`,
    )
    expect(out!.plainText).toBe('里的文字')
  })

  it('keeps list items inside their list', () => {
    const root = mount(
      `<ul style="列表"><li style="项"><span leaf="">列表第一项</span></li><li style="项"><span leaf="">列表第二项</span></li></ul>`,
    )
    const first = textNodeOf(root, '列表第一项')
    const second = textNodeOf(root, '列表第二项')
    const out = serializeWechatSelection(root, select(first, 2, second, 2))
    expect(out!.html).toContain('<ul style="列表">')
    expect(out!.html).toContain('<li style="项"><span leaf="">第一项</span></li>')
    expect(out!.html).toContain('<li style="项"><span leaf="">列表</span></li>')
    expect(out!.plainText).toBe('第一项列表')
  })

  it('rebuilds table scaffolding for a cell-to-cell selection', () => {
    const root = mount(
      `<section style="表格外框"><table style="表格"><tbody><tr><th style="表头">表头甲</th><th style="表头">表头乙</th></tr><tr><td style="格">单元格甲</td><td style="格">单元格乙</td></tr></tbody></table></section>`,
    )
    const cellA = textNodeOf(root, '单元格甲')
    const cellB = textNodeOf(root, '单元格乙')
    const out = serializeWechatSelection(root, select(cellA, 2, cellB, cellB.nodeValue!.length))
    expect(out!.html).toContain('<section style="表格外框"><table style="表格"><tbody><tr>')
    expect(out!.html).toContain('<td style="格">格甲</td>')
    expect(out!.html).toContain('<td style="格">单元格乙</td>')
    expect(out!.html).not.toContain('表头')
    expect(out!.html).not.toContain('单元格丙')
    expect(out!.plainText).toBe('格甲单元格乙')
    expectSelfContained(out!.html, root)
  })

  it('copies an image together with its caption', () => {
    const root = mount(
      `<p style="图"><img src="/favicon.svg" style="img-style" /></p><p style="图注"><span leaf="">图1 配图说明</span></p>`,
    )
    const figure = root.querySelector('p')!
    const caption = textNodeOf(root, '图1 配图说明')
    const out = serializeWechatSelection(root, select(figure, 0, caption, caption.nodeValue!.length))
    expect(out!.html).toContain('<img src="/favicon.svg" style="img-style"')
    expect(out!.html).toContain('<p style="图注"><span leaf="">图1 配图说明</span></p>')
    expect(out!.plainText).toBe('图1 配图说明')
  })

  it('spans two modules from the middle of one to the middle of the next', () => {
    const root = mount(
      `<p style="模块一"><span leaf="">模块一的文字</span></p><section style="模块二"><p style="内文"><span leaf="">模块二的文字</span></p></section>`,
    )
    const first = textNodeOf(root, '模块一的文字')
    const second = textNodeOf(root, '模块二的文字')
    const out = serializeWechatSelection(root, select(first, 3, second, 3))
    expect(out!.html).toContain('<p style="模块一"><span leaf="">的文字</span></p>')
    expect(out!.html).toContain('<section style="模块二"><p style="内文"><span leaf="">模块二</span></p></section>')
    expect(out!.plainText).toBe('的文字模块二')
    expectSelfContained(out!.html, root)
  })

  it('wraps a whole-block selection in a single root without duplicating it', () => {
    const root = mount(
      `<p style="甲"><span leaf="">甲段</span></p><p style="乙"><span leaf="">乙段</span></p>`,
    )
    const out = serializeWechatSelection(root, select(root, 0, root, root.childNodes.length))
    expect(out!.html).toBe(
      `<section style="${ROOT_STYLE}"><p style="甲"><span leaf="">甲段</span></p><p style="乙"><span leaf="">乙段</span></p></section>`,
    )
    expect(out!.plainText).toBe('甲段乙段')
  })

  describe('leaves the native copy alone', () => {
    const root = mount(`<p style="甲"><span leaf="">可选中文字</span></p>`)

    it('for no selection at all', () => {
      expect(serializeWechatSelection(root, null)).toBeNull()
      expect(serializeWechatSelection(root, window.getSelection())).toBeNull()
    })

    it('for a collapsed selection', () => {
      const text = textNodeOf(root, '可选中文字')
      expect(serializeWechatSelection(root, select(text, 2, text, 2))).toBeNull()
    })

    it('for a selection outside the article', () => {
      const outside = document.createElement('p')
      outside.textContent = '预览之外'
      document.body.appendChild(outside)
      expect(serializeWechatSelection(root, select(outside.firstChild!, 0, outside.firstChild!, 2))).toBeNull()
    })

    it('for a selection that starts inside and ends outside the article', () => {
      const inside = textNodeOf(root, '可选中文字')
      const outside = document.createElement('p')
      outside.textContent = '文章之外'
      document.body.appendChild(outside)
      expect(serializeWechatSelection(root, select(inside, 0, outside.firstChild!, 4))).toBeNull()
    })
  })
})
