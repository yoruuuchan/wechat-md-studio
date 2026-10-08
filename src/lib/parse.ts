import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import markdownItContainer from 'markdown-it-container'
import type { Block, CarouselItem, CarouselRatio, CellAlign, Doc, DocMeta, InlineSeg, SourceSpan } from './types'
import {
  DEFAULT_CAROUSEL_RATIO,
  DEFAULT_GALLERY_COLS,
  DEFAULT_GALLERY_RATIO,
  isCarouselRatio,
  isGalleryCols,
} from './types'
import { fencedRanges, isInFence } from './fences'

// ---------- front matter ----------
// 只支持简单键值与列表，刻意不引入 YAML 依赖：
// ---
// titles:
//   - 标题一
//   - 标题二
// cover: 封面说明
// ---

function parseFrontMatter(src: string): { meta: DocMeta; body: string; offset: number } {
  const meta: DocMeta = { titles: [], cover: '', author: '' }
  const m = src.match(/^\s*---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta, body: src, offset: 0 }
  const lines = m[1].split('\n')
  let curKey = ''
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const listItem = line.match(/^\s+-\s+(.*)$/)
    if (listItem && curKey) {
      if (curKey === 'titles') meta.titles.push(listItem[1].trim())
      continue
    }
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/)
    if (kv) {
      curKey = kv[1]
      const v = kv[2].trim()
      if (curKey === 'cover') meta.cover = v
      else if (curKey === 'author') meta.author = v
      else if (curKey === 'titles' && v) meta.titles.push(v)
    }
  }
  return { meta, body: src.slice(m[0].length), offset: m[0].split('\n').length - 1 }
}

// ---------- markdown-it ----------

const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
  .use(markdownItMark)
  .use(markdownItContainer, 'quote')
  .use(markdownItContainer, 'center')
  .use(markdownItContainer, 'carousel')
  .use(markdownItContainer, 'gallery')

// ---------- inline ----------

interface Flags {
  bold?: boolean
  mark?: boolean
  code?: boolean
  italic?: boolean
  strike?: boolean
  link?: string
}

/** Order-independent identity of a flag set, for deciding whether runs merge. */
function flagKey(f: Flags): string {
  return [f.bold, f.mark, f.code, f.italic, f.strike, f.link].map((v) => v ?? '').join('\u0000')
}

function pushSeg(out: InlineSeg[], text: string, flags: Flags) {
  if (!text) return
  const prev = out[out.length - 1]
  if (prev && flagKey(prev) === flagKey(flags) && prev.text !== '\n' && text !== '\n') {
    prev.text += text
    return
  }
  out.push({ text, ...flags })
}

/**
 * Inline emphasis is a stack: an opener pushes the flags as they were and adds
 * its own, the matching closer pops them back.
 *
 * This used to be `Object.assign(flags, stack.pop())`, which silently does
 * nothing useful: the snapshot has no `bold` key at all, and Object.assign never
 * deletes one. Every flag therefore stayed set for the rest of the paragraph, so
 * `**粗** 普通` rendered as one bold run and text after a link inherited that
 * link. Replacing the object instead of mutating it makes the pop exact.
 */
const INLINE_TOGGLE: Record<string, keyof Flags> = {
  strong: 'bold',
  em: 'italic',
  s: 'strike',
  mark: 'mark',
}

export function walkInline(children: Token[] | null): InlineSeg[] {
  const out: InlineSeg[] = []
  if (!children) return out
  // 必须是 let：关闭标记时要把 flags 整体换回开标记之前的快照。
  // 用 Object.assign 恢复会漏掉"快照里没有的键"，导致加粗/下划线/斜体
  // 在标记结束后继续泄漏到同段剩余文字上。
  let flags: Flags = {}
  const stack: Flags[] = []
  for (const t of children) {
    const toggle = t.type.endsWith('_open') || t.type.endsWith('_close')
      ? INLINE_TOGGLE[t.type.slice(0, t.type.lastIndexOf('_'))]
      : undefined

    if (toggle) {
      if (t.type.endsWith('_open')) {
        stack.push(flags)
        flags = { ...flags, [toggle]: true }
      } else {
        flags = stack.pop() ?? {}
      }
      continue
    }

    switch (t.type) {
      case 'text':
        pushSeg(out, t.content, flags)
        break
      case 'code_inline':
        pushSeg(out, t.content, { ...flags, code: true })
        break
      case 'link_open':
        stack.push(flags)
        flags = { ...flags, link: String(t.attrGet('href') ?? '') }
        break
      case 'link_close':
        flags = stack.pop() ?? {}
        break
      case 'softbreak':
        pushSeg(out, '', flags) // CJK：段内软换行直接接合
        break
      case 'hardbreak':
        pushSeg(out, '\n', flags)
        break
      default:
        break
    }
  }
  return out
}

/**
 * A paragraph's source text with its line breaks put back.
 *
 * `inline.content` joins soft-broken lines, which is right for prose and wrong
 * for a multi-line `$$…$$` equation: the newlines are part of the TeX.
 */
function rawParagraphText(inline: Token | undefined): string {
  if (!inline?.children) return inline?.content ?? ''
  let out = ''
  for (const c of inline.children) {
    if (c.type === 'softbreak' || c.type === 'hardbreak') out += '\n'
    else out += c.content
  }
  return out
}

function imageFromInline(t: Token): { alt: string; src: string } | null {
  if (!t.children || t.children.length !== 1) return null
  const img = t.children[0]
  if (img.type !== 'image') return null
  return { alt: img.content.trim(), src: String(img.attrGet('src') ?? '') }
}

// ---------- block ----------

/**
 * Every `![alt](...)` in the raw body, in document order, 1-based.
 * The AST skips inline images (an image wrapped in running text is not a block),
 * but the source line those blocks get edited on still contains them, so the
 * occurrence index has to be counted over the raw text to stay aligned.
 */
function scanImageOccurrences(body: string): { alt: string; occurrence: number }[] {
  const out: { alt: string; occurrence: number }[] = []
  const fences = fencedRanges(body)
  const re = /!\[([^\]]*)\]\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    // An image example inside a ``` block is documentation, not an image, and
    // counting it would shift every real image after it by one.
    if (isInFence(fences, m.index)) continue
    out.push({ alt: m[1].trim(), occurrence: out.length + 1 })
  }
  return out
}

export function parseMarkdown(src: string): Doc {
  const { meta, body, offset } = parseFrontMatter(src)
  const tokens = md.parse(body, {})
  const blocks: Block[] = []
  // Cursor into the raw-scan list; images appear in the same order in both.
  const imgScan = scanImageOccurrences(body)
  let imgCursor = 0
  const nextOccurrence = (alt: string): number => {
    // Prefer the entry that matches the caption; markdown-it drops images that
    // are not alone in their paragraph, so the two sequences can drift apart.
    for (let i = imgCursor; i < imgScan.length; i++) {
      if (imgScan[i].alt === alt) {
        imgCursor = i + 1
        return imgScan[i].occurrence
      }
    }
    // Fall back to "the next one in the source" rather than failing outright.
    const fallback = imgScan[imgCursor]?.occurrence ?? 0
    imgCursor++
    return fallback
  }

  // Token maps are relative to `body`; every caller wants a whole-file line so
  // the editor can scroll to it. Blocks whose token carries no map inherit the
  // end of the previous one rather than collapsing onto line 0.
  const totalLines = src.split('\n').length
  let lastEnd = 0
  const span = (open: Token | undefined, close?: Token, extraEnd = 0): SourceSpan => {
    const endMap = close?.map ?? open?.map
    const line = open?.map ? open.map[0] + offset : lastEnd
    const raw = endMap ? endMap[1] + offset + extraEnd : line + 1
    const lineEnd = Math.max(Math.min(raw, totalLines), line + 1)
    lastEnd = lineEnd
    return { line, lineEnd }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]

    if (t.type === 'heading_open') {
      const inline = tokens[i + 1]
      const level = Number(t.tag.slice(1))
      const content = inline?.content || ''
      const at = span(t)
      if (level === 2) {
        const pipe = content.indexOf('|')
        const kicker = pipe >= 0 ? content.slice(0, pipe).trim() : ''
        const title = (pipe >= 0 ? content.slice(pipe + 1) : content).trim()
        blocks.push({ type: 'heading', kicker, title, numbered: true, ...at })
      } else if (level === 1) {
        blocks.push({ type: 'heading', kicker: '', title: content.trim(), numbered: false, ...at })
      } else {
        blocks.push({ type: 'subheading', title: content.trim(), ...at })
      }
      i += 2
      continue
    }

    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1]
      const img = inline ? imageFromInline(inline) : null
      const at = span(t)
      if (img) {
        blocks.push({
          type: 'image',
          alt: img.alt,
          src: img.src,
          occurrence: nextOccurrence(img.alt),
          ...at,
        })
      } else {
        const text = inline?.content.trim() || ''
        if (text === '@signature') {
          blocks.push({ type: 'signature', ...at })
        } else {
          const math = rawParagraphText(inline).trim().match(/^\$\$([\s\S]+?)\$\$$/)
          if (math) {
            blocks.push({ type: 'math', tex: math[1].trim(), display: true, ...at })
          } else {
            const segs = walkInline(inline?.children || null)
            if (segs.length) blocks.push({ type: 'paragraph', segs, ...at })
            else lastEnd = at.line // nothing emitted: do not advance the cursor
          }
        }
      }
      i += 2
      continue
    }

    if (t.type === 'blockquote_open') {
      // > 金句卡片：收集到 blockquote_close 之间的段落
      const paras: InlineSeg[][] = []
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
        if (tokens[i].type === 'inline') paras.push(walkInline(tokens[i].children))
        i++
      }
      const segs: InlineSeg[] = []
      paras.forEach((p, idx) => {
        if (idx > 0) segs.push({ text: '\n' })
        segs.push(...p)
      })
      blocks.push({ type: 'quoteCard', segs, ...span(t, tokens[i]) })
      continue
    }

    if (t.type === 'container_quote_open') {
      const paras: InlineSeg[][] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_quote_close') {
        if (tokens[i].type === 'inline') paras.push(walkInline(tokens[i].children))
        i++
      }
      blocks.push({ type: 'quoteBox', paras, ...span(t, tokens[i], 1) })
      continue
    }

    if (t.type === 'container_center_open') {
      const paras: InlineSeg[][] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_center_close') {
        if (tokens[i].type === 'inline') paras.push(walkInline(tokens[i].children))
        i++
      }
      const segs: InlineSeg[] = []
      paras.forEach((p, idx) => {
        if (idx > 0) segs.push({ text: '\n' })
        segs.push(...p)
      })
      blocks.push({ type: 'center', segs, ...span(t, tokens[i], 1) })
      continue
    }

    if (t.type === 'container_carousel_open') {
      // :::carousel [比例] 标题 —— 比例可省略，老稿件照旧按默认比例渲染
      let rest = (t.info || '').replace(/^carousel\s*/, '').trim()
      let ratio: CarouselRatio = DEFAULT_CAROUSEL_RATIO
      const ratioMatch = rest.match(/^(\d+\s*:\s*\d+)\s*/)
      if (ratioMatch) {
        const candidate = ratioMatch[1].replace(/\s+/g, '')
        // 只吃下确实是受支持的比例；「7:5 说明」这种要原样留在标题里
        if (isCarouselRatio(candidate)) {
          ratio = candidate
          rest = rest.slice(ratioMatch[0].length).trim()
        }
      }
      const title = rest
      const items: { alt: string; src: string; occurrence: number }[] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_carousel_close') {
        // 同一行的多张图（软换行分隔）也要全部收集
        if (tokens[i].type === 'inline' && tokens[i].children) {
          for (const c of tokens[i].children!) {
            if (c.type === 'image') {
              const alt = c.content.trim()
              items.push({ alt, src: String(c.attrGet('src') ?? ''), occurrence: nextOccurrence(alt) })
            }
          }
        }
        i++
      }
      blocks.push({
        type: 'carousel',
        title,
        ratio,
        items,
        occurrence: items.length ? items[0].occurrence : nextOccurrence(''),
        ...span(t, tokens[i], 1),
      })
      continue
    }

    if (t.type === 'container_gallery_open') {
      // :::gallery [列数] [比例] 标题 —— 两个参数都可省略
      let rest = (t.info || '').replace(/^gallery\s*/, '').trim()
      let cols = DEFAULT_GALLERY_COLS
      let ratio: CarouselRatio = DEFAULT_GALLERY_RATIO
      // 列数是裸整数，比例带冒号。负向预查挡住「4:3」被读成 4 列，
      // 这样 :::gallery 4:3 标题 才是「默认列数 + 4:3」。
      const colsMatch = rest.match(/^(\d+)(?!\s*:)\s*/)
      if (colsMatch) {
        const n = Number(colsMatch[1])
        // 只吃下确实支持的列数；「7 张现场图」这种要原样留在标题里
        if (isGalleryCols(n)) {
          cols = n
          rest = rest.slice(colsMatch[0].length).trim()
        }
      }
      const ratioMatch = rest.match(/^(\d+\s*:\s*\d+)\s*/)
      if (ratioMatch) {
        const candidate = ratioMatch[1].replace(/\s+/g, '')
        if (isCarouselRatio(candidate)) {
          ratio = candidate
          rest = rest.slice(ratioMatch[0].length).trim()
        }
      }
      const title = rest
      const items: CarouselItem[] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_gallery_close') {
        // 同一行的多张图（软换行分隔）也要全部收集
        if (tokens[i].type === 'inline' && tokens[i].children) {
          for (const c of tokens[i].children!) {
            if (c.type === 'image') {
              const alt = c.content.trim()
              items.push({ alt, src: String(c.attrGet('src') ?? ''), occurrence: nextOccurrence(alt) })
            }
          }
        }
        i++
      }
      blocks.push({
        type: 'gallery',
        title,
        ratio,
        cols,
        items,
        occurrence: items.length ? items[0].occurrence : nextOccurrence(''),
        ...span(t, tokens[i], 1),
      })
      continue
    }

    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const ordered = t.type === 'ordered_list_open'
      const close = ordered ? 'ordered_list_close' : 'bullet_list_close'
      const items: InlineSeg[][] = []
      while (i < tokens.length && tokens[i].type !== close) {
        if (tokens[i].type === 'inline') items.push(walkInline(tokens[i].children))
        i++
      }
      blocks.push({ type: 'list', ordered, items, ...span(t, tokens[i]) })
      continue
    }

    if (t.type === 'table_open') {
      // markdown-it puts the column alignment on each th/td as `style="text-align:…"`;
      // only the header row is authoritative, body cells just repeat it.
      let align: CellAlign[] = []
      const head: InlineSeg[][] = []
      const rows: InlineSeg[][][] = []
      let inHead = false
      let row: InlineSeg[][] | null = null
      let rowAlign: CellAlign[] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'table_close') {
        const tk = tokens[i]
        if (tk.type === 'thead_open') inHead = true
        else if (tk.type === 'thead_close') inHead = false
        else if (tk.type === 'tr_open') {
          row = []
          rowAlign = []
        } else if (tk.type === 'tr_close') {
          if (row) {
            if (inHead) {
              // GFM 表头只有一行；再来一行也不覆盖已取的表头与对齐
              if (!head.length) {
                head.push(...row)
                align = rowAlign
              }
            } else {
              rows.push(row)
            }
          }
          row = null
        } else if (tk.type === 'th_open' || tk.type === 'td_open') {
          const m = /text-align:\s*(left|center|right)/.exec(String(tk.attrGet('style') ?? ''))
          rowAlign.push(m ? (m[1] as CellAlign) : 'left')
          const inline = tokens[i + 1]
          row?.push(inline?.type === 'inline' ? walkInline(inline.children) : [])
          i += 2
        }
        i++
      }
      blocks.push({ type: 'table', align, head, rows, ...span(t, tokens[i]) })
      continue
    }

    if (t.type === 'fence') {
      blocks.push({ type: 'code', lang: t.info.trim(), code: t.content.replace(/\n$/, ''), ...span(t) })
      continue
    }

    if (t.type === 'hr') {
      blocks.push({ type: 'hr', ...span(t) })
      continue
    }
  }

  return { meta, blocks }
}
