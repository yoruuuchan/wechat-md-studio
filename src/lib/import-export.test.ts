import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  BUNDLE_MIME,
  BUNDLE_VERSION,
  MARKDOWN_MIME,
  bundleFilename,
  docxToDocxImport,
  parseBundle,
  parseMarkdownFile,
  safeFilename,
  toBundle,
  toMarkdownFile,
} from './import-export'
import type { DocRecord } from './store'

// ---------- fixtures ----------

/**
 * mammoth ships its own test documents with the npm package, which beats
 * hand-rolling a .docx here: a DOCX is a ZIP of XML parts and there is no
 * writer for it in this project. Skipped, rather than red, if a future mammoth
 * release stops shipping `test/`.
 */
const DOCX_DIR = path.resolve(
  import.meta.dirname,
  '../../node_modules/mammoth/test/test-data',
)
const HAS_DOCX_FIXTURES = existsSync(path.join(DOCX_DIR, 'tiny-picture.docx'))

function readDocx(name: string): ArrayBuffer {
  const bytes = readFileSync(path.join(DOCX_DIR, name))
  // readFileSync returns a view onto a shared pool, so `.buffer` alone can
  // point at unrelated bytes. Slice the exact range.
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

/**
 * Stand-in for `rich-paste`'s `htmlToDialect`, kept out of the suite so this
 * file does not go red whenever that module is being edited in parallel.
 *
 * Only the shapes these fixtures produce are handled. The image branch copies
 * `dialectImage`'s contract exactly: it always emits `![alt]()` and discards
 * whatever src arrived, which is why the DOCX importer collects pictures
 * separately instead of relying on a src surviving conversion.
 */
function stubHtmlToMd(html: string): string {
  return html.replace(/<img([^>]*)>/g, (_match, attrs: string) => {
    const alt = /alt="([^"]*)"/.exec(attrs)?.[1] ?? ''
    return `![${alt}]()`
  })
}

/** Every construct only this app understands. None of it may change on a round trip. */
const DIALECT_DOC = `---
titles:
  - 标题甲
  - 标题乙
cover: 封面说明
author: 作者
---

# 主标题

## KICKER | 章节标题

### 小标题

正文 ==重点== **粗** *斜* ~~删除~~ \`代码\` [文字](https://example.com)

![图注](img:abc123)

> 金句

:::quote
引文一段
:::

:::center
居中强调
:::

:::carousel 4:3 标题
![轮播一](img:k1)
![轮播二](img:k2)
:::

@signature

| 甲 | 乙 |
| -- | -- |
| 1 | 2 |

- 无序项

1. 有序项

\`\`\`js
const a = 1
\`\`\`

---
`

function doc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: 'a1b2c3d4',
    name: '测试稿件',
    content: DIALECT_DOC,
    updatedAt: 1_700_000_000_000,
    savedAt: 1_700_000_999_000,
    deletedAt: null,
    ...overrides,
  }
}

// ---------- safeFilename ----------

describe('safeFilename', () => {
  it('removes every character Windows and Unix both forbid', () => {
    expect(safeFilename('a\\b/c:d*e?f"g<h>i|j', 'f', 'md')).toBe('abcdefghij.md')
  })

  it('removes control characters', () => {
    expect(safeFilename('a\u0000b\u001fc\u007fd', 'f', 'md')).toBe('abcd.md')
  })

  it('falls back when the name has nothing usable in it', () => {
    expect(safeFilename('', '推文', 'md')).toBe('推文.md')
    expect(safeFilename('   ', '推文', 'md')).toBe('推文.md')
    expect(safeFilename('//*??"', '推文', 'md')).toBe('推文.md')
  })

  it('still produces a usable name when the fallback is empty too', () => {
    expect(safeFilename('', '', 'md')).toBe('untitled.md')
  })

  it('keeps CJK and emoji intact', () => {
    expect(safeFilename('公众号排版 · 2026春', 'f', 'md')).toBe('公众号排版 · 2026春.md')
    expect(safeFilename('稿子🌙', 'f', 'md')).toBe('稿子🌙.md')
  })

  it('replaces an existing extension instead of stacking another one', () => {
    expect(safeFilename('报告.docx', 'f', 'md')).toBe('报告.md')
    expect(safeFilename('报告.md', 'f', 'md')).toBe('报告.md')
    expect(safeFilename('report.MARKDOWN', 'f', 'md')).toBe('report.md')
  })

  it('keeps a numeric suffix that only looks like an extension', () => {
    expect(safeFilename('v1.2', 'f', 'md')).toBe('v1.2.md')
    expect(safeFilename('第1.5章', 'f', 'md')).toBe('第1.5章.md')
  })

  it('accepts an extension written with a leading dot, or none at all', () => {
    expect(safeFilename('a', 'f', '.md')).toBe('a.md')
    expect(safeFilename('a', 'f', '')).toBe('a')
  })

  it('truncates a long stem but keeps the extension', () => {
    const long = 'a'.repeat(150) + '.docx'
    expect(safeFilename(long, 'f', 'md')).toBe(`${'a'.repeat(100)}.md`)
    expect(safeFilename('标'.repeat(300), 'f', 'md')).toBe(`${'标'.repeat(100)}.md`)
  })

  it('never cuts a surrogate pair in half', () => {
    const out = safeFilename('🌙'.repeat(200), 'f', 'md')
    const stem = out.replace(/\.md$/, '')
    expect(Array.from(stem)).toHaveLength(100)
    // An unpaired surrogate would survive .length checks but break encoders.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(stem)).toBe(
      false,
    )
  })

  it('renames a Windows device name rather than producing an unopenable file', () => {
    expect(safeFilename('CON', 'f', 'md')).toBe('_CON.md')
    expect(safeFilename('con.txt', 'f', 'md')).toBe('_con.md')
    expect(safeFilename('NUL', 'f', 'md')).toBe('_NUL.md')
    expect(safeFilename('LPT9', 'f', 'md')).toBe('_LPT9.md')
    // Only the bare device names are reserved; a longer word is a normal file.
    expect(safeFilename('CONNECT', 'f', 'md')).toBe('CONNECT.md')
  })

  it('trims the dots and spaces Windows would strip on its own', () => {
    expect(safeFilename('报告...', 'f', 'md')).toBe('报告.md')
    expect(safeFilename('报告   ', 'f', 'md')).toBe('报告.md')
    expect(safeFilename('...报告', 'f', 'md')).toBe('报告.md')
  })
})

// ---------- Markdown ----------

describe('toMarkdownFile', () => {
  it('returns the dialect byte-for-byte', () => {
    const out = toMarkdownFile('公众号排版 · 2026春', DIALECT_DOC)
    expect(out.content).toBe(DIALECT_DOC)
    expect(out.mime).toBe(MARKDOWN_MIME)
    expect(out.filename).toBe('公众号排版 · 2026春.md')
  })

  it.each([
    ['==重点==', '==重点=='],
    [':::carousel 4:3 标题', ':::carousel 4:3 标题'],
    [':::quote', ':::quote'],
    [':::center', ':::center'],
    ['@signature', '@signature'],
    ['img:abc123', 'img:abc123'],
    ['titles:', 'titles:'],
  ])('preserves %s exactly', (needle) => {
    const out = toMarkdownFile('x', DIALECT_DOC)
    expect(out.content).toContain(needle)
    // No escaping of the markers a general-purpose converter would rewrite.
    expect(out.content).not.toContain('\\=')
    expect(out.content).not.toContain('<mark>')
  })

  it('adds no BOM, so the file stays identical to content', () => {
    const out = toMarkdownFile('x', DIALECT_DOC)
    expect(out.content.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('sanitises a name that cannot be a filename', () => {
    expect(toMarkdownFile('2024/2025 年度: 总结?', DIALECT_DOC).filename).toBe(
      '20242025 年度 总结.md',
    )
    expect(toMarkdownFile('', DIALECT_DOC).filename).toBe('推文.md')
  })
})

describe('parseMarkdownFile', () => {
  it('round trips an export back to the same content', () => {
    const out = toMarkdownFile('报告', DIALECT_DOC)
    const back = parseMarkdownFile(out.content, out.filename)
    expect(back.content).toBe(DIALECT_DOC)
    expect(back.name).toBe('标题甲')
  })

  it('strips a BOM an outside editor added', () => {
    const back = parseMarkdownFile(`\uFEFF${DIALECT_DOC}`, '报告.md')
    expect(back.content).toBe(DIALECT_DOC)
    expect(back.content.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('names from front matter, then an ATX title, then the file name', () => {
    expect(parseMarkdownFile('---\ntitles:\n  - 甲\n  - 乙\n---\n\n# 正文标题\n', 'x.md').name).toBe(
      '甲',
    )
    expect(parseMarkdownFile('# 只有一个标题\n\n正文', 'x.md').name).toBe('只有一个标题')
    expect(parseMarkdownFile('没有标题的正文', '季度总结.md').name).toBe('季度总结')
    expect(parseMarkdownFile('', '   .md').name).toBe('导入稿件')
  })

  it('caps the derived name at the server limit', () => {
    const back = parseMarkdownFile(`# ${'标'.repeat(400)}`, 'x.md')
    expect(Array.from(back.name)).toHaveLength(200)
  })
})

// ---------- bundle ----------

describe('toBundle / bundleFilename', () => {
  it('stamps a version and an export time', () => {
    const parsed = JSON.parse(toBundle([doc()])) as {
      version: number
      exportedAt: string
      docs: DocRecord[]
      settings?: unknown
    }
    expect(parsed.version).toBe(BUNDLE_VERSION)
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false)
    expect(parsed.docs).toHaveLength(1)
    // Settings are opt-in: a bundle without them must not carry the key at all.
    expect(parsed.settings).toBeUndefined()
  })

  it('carries settings only when the caller passes them', () => {
    const settings = {
      themeId: 'golden',
      sig: { layout: '赵', proof: '钱', review: '孙' },
      syncScroll: false,
      zoom: 110,
    }
    const parsed = JSON.parse(toBundle([doc()], settings)) as { settings: typeof settings }
    expect(parsed.settings).toEqual(settings)
  })

  it('date-stamps the filename locally and counts the docs', () => {
    const name = bundleFilename(3)
    expect(name).toMatch(/^公众号稿件备份_\d{4}-\d{2}-\d{2}_3篇\.json$/)
    // Local date, not UTC: a 00:30 export in China must not read as yesterday.
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(name).toContain(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    )
  })

  it('publishes the MIME a caller hands to downloadFile', () => {
    expect(BUNDLE_MIME).toBe('application/json')
  })
})

describe('parseBundle', () => {
  it('round trips a bundle', () => {
    const docs = [doc(), doc({ id: 'z9y8x7w6', name: '第二篇', savedAt: null })]
    const result = parseBundle(toBundle(docs))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.version).toBe(BUNDLE_VERSION)
    expect(result.docs).toEqual(docs)
    expect(result.settings).toBeNull()
  })

  it('rejects text that is not JSON', () => {
    const result = parseBundle('这不是 JSON{')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('JSON')
  })

  it('rejects JSON that is not an object', () => {
    expect(parseBundle('[1,2,3]').ok).toBe(false)
    expect(parseBundle('"a string"').ok).toBe(false)
    expect(parseBundle('null').ok).toBe(false)
  })

  it('rejects a bundle with no version', () => {
    const result = parseBundle(JSON.stringify({ docs: [] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('版本号')
  })

  it('names both versions when the file is from another release', () => {
    const result = parseBundle(JSON.stringify({ version: 7, docs: [] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('v7')
    expect(result.reason).toContain(`v${BUNDLE_VERSION}`)
  })

  it('rejects a bundle whose docs are not an array', () => {
    const result = parseBundle(JSON.stringify({ version: BUNDLE_VERSION, docs: {} }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('docs')
  })

  it('accepts an empty library', () => {
    const result = parseBundle(toBundle([]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.docs).toEqual([])
  })

  it('rejects more docs than one import can take', () => {
    const many = Array.from({ length: 501 }, (_, i) => doc({ id: `id${i}` }))
    const result = parseBundle(toBundle(many))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('501')
    expect(result.reason).toContain('500')
  })

  it('points at the offending article and the missing field', () => {
    const broken = [doc(), { id: 'x', name: '没有正文', updatedAt: 1 }]
    const result = parseBundle(JSON.stringify({ version: BUNDLE_VERSION, docs: broken }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('第 2 篇')
    expect(result.reason).toContain('content')
  })

  it.each([
    ['a non-object entry', 42, '不是一个对象'],
    ['an empty id', { ...doc(), id: '' }, '缺少 id'],
    ['an over-long id', { ...doc(), id: 'x'.repeat(65) }, '超过 64'],
    ['a missing name', { id: 'a', content: 'c', updatedAt: 1, savedAt: null }, '缺少 name'],
    ['an over-long name', { ...doc(), name: 'n'.repeat(201) }, '超过 200'],
    ['a missing content', { id: 'a', name: 'n', updatedAt: 1, savedAt: null }, '缺少 content'],
    ['a string updatedAt', { ...doc(), updatedAt: '1700000000000' }, 'updatedAt'],
    ['a NaN updatedAt', { ...doc(), updatedAt: Number.NaN }, 'updatedAt'],
    ['a string savedAt', { ...doc(), savedAt: '1700000000000' }, 'savedAt'],
  ])('rejects %s', (_label, entry, expected) => {
    const result = parseBundle(JSON.stringify({ version: BUNDLE_VERSION, docs: [entry] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(expected)
  })

  it('accepts savedAt as null, as a number, and as absent', () => {
    for (const entry of [
      doc({ savedAt: null }),
      doc({ savedAt: 1_700_000_000_000 }),
      { id: 'a', name: 'n', content: 'c', updatedAt: 1 },
    ]) {
      const result = parseBundle(JSON.stringify({ version: BUNDLE_VERSION, docs: [entry] }))
      expect(result.ok).toBe(true)
    }
    const absent = parseBundle(
      JSON.stringify({ version: BUNDLE_VERSION, docs: [{ id: 'a', name: 'n', content: 'c', updatedAt: 1 }] }),
    )
    expect(absent.ok && absent.docs[0].savedAt).toBeNull()
  })

  it('keeps the original ids so the caller can decide about collisions', () => {
    const result = parseBundle(toBundle([doc({ id: 'keep-me-please' })]))
    expect(result.ok && result.docs[0].id).toBe('keep-me-please')
  })

  it('rejects a bundle that repeats an id', () => {
    const result = parseBundle(toBundle([doc({ id: 'dup' }), doc({ id: 'dup' })]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('第 2 篇')
    expect(result.reason).toContain('重复')
  })

  it('drops fields a newer build may have added', () => {
    const result = parseBundle(
      JSON.stringify({
        version: BUNDLE_VERSION,
        docs: [{ ...doc(), futureField: true, tags: ['x'] }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.docs[0]).sort()).toEqual([
      'content',
      'deletedAt',
      'id',
      'name',
      'savedAt',
      'updatedAt',
    ])
  })

  it('reads settings, and ignores a malformed settings block', () => {
    const good = parseBundle(
      toBundle([doc()], {
        themeId: 'paper',
        sig: { layout: 'a', proof: 'b', review: 'c' },
        syncScroll: false,
        zoom: 110,
      }),
    )
    expect(good.ok && good.settings).toEqual({
      themeId: 'paper',
      sig: { layout: 'a', proof: 'b', review: 'c' },
      syncScroll: false,
      zoom: 110,
    })

    // A broken settings block must never cost the owner their articles.
    const bad = parseBundle(JSON.stringify({ version: BUNDLE_VERSION, docs: [doc()], settings: { themeId: 7 } }))
    expect(bad.ok).toBe(true)
    expect(bad.ok && bad.settings).toBeNull()
  })

  it('tolerates a BOM on the file', () => {
    const result = parseBundle(`\uFEFF${toBundle([doc()])}`)
    expect(result.ok).toBe(true)
  })
})

// ---------- DOCX ----------

describe.skipIf(!HAS_DOCX_FIXTURES)('docxToDocxImport', () => {
  it("hands mammoth's HTML to the injected converter", async () => {
    const seen: string[] = []
    const out = await docxToDocxImport(readDocx('single-paragraph.docx'), (html) => {
      seen.push(html)
      return stubHtmlToMd(html)
    })
    expect(seen).toEqual(['<p>Walking on imported air</p>'])
    expect(out.images).toEqual([])
  })

  it('passes headings through as h1', async () => {
    const seen: string[] = []
    await docxToDocxImport(readDocx('embedded-style-map.docx'), (html) => {
      seen.push(html)
      return html
    })
    expect(seen[0]).toBe('<h1>Walking on imported air</h1>')
  })

  it('passes tables and lists through as HTML for the converter to own', async () => {
    const list = await docxToDocxImport(readDocx('simple-list.docx'), (h) => h)
    expect(list.markdown).toBe('<ul><li>Apple</li><li>Banana</li></ul>')

    const table = await docxToDocxImport(readDocx('tables.docx'), (h) => h)
    expect(table.markdown).toContain('<table><tr><td><p>Top left</p></td>')
  })

  it('handles an empty document', async () => {
    const out = await docxToDocxImport(readDocx('empty.docx'), stubHtmlToMd)
    expect(out.markdown).toBe('')
    expect(out.images).toEqual([])
  })

  it('collects pictures instead of inlining them, and leaves an empty upload slot', async () => {
    const out = await docxToDocxImport(readDocx('tiny-picture.docx'), stubHtmlToMd)

    expect(out.images).toHaveLength(1)
    const [image] = out.images
    expect(image.contentType).toBe('image/png')
    expect(image.dataUri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
    // tiny-picture.docx sets no alt text on its picture.
    expect(image.alt).toBe('')

    // The base64 must stay out of the article body: it belongs in the upload,
    // not in the Markdown that gets pushed to the WeChat editor.
    expect(out.markdown).not.toContain('base64')
    expect(out.markdown).toContain('![]()')

    // The contract fillImageSlots relies on: one empty slot per collected
    // picture, in the same order.
    const slots = out.markdown.match(/!\[[^\]]*\]\(\s*\)/g) ?? []
    expect(slots).toHaveLength(out.images.length)

    // The upload mutation wants bare base64, which is everything after the comma.
    const base64 = image.dataUri.split(',')[1]
    expect(base64.length).toBeGreaterThan(0)
    expect(image.dataUri).toBe(`data:${image.contentType};base64,${base64}`)
  })
})
