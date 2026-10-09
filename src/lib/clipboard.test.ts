import { describe, expect, it } from 'vitest'
import { escapeHtmlText, previewPage } from './clipboard'
import { safeFilename } from './import-export'

const BODY = '<section><p><span leaf="">正文</span></p></section>'

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('escapeHtmlText', () => {
  it('neutralises the characters that can change how markup is read', () => {
    expect(escapeHtmlText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtmlText('a & b')).toBe('a &amp; b')
    expect(escapeHtmlText('say "hi"')).toBe('say &quot;hi&quot;')
    expect(escapeHtmlText("it's")).toBe('it&#39;s')
  })

  it('leaves Unicode, CJK and emoji alone', () => {
    expect(escapeHtmlText('关于「AI Agent」的一人公司 🎉 — 5 ≤ x')).toBe('关于「AI Agent」的一人公司 🎉 — 5 ≤ x')
  })

  it('escapes an ampersand that already looks like an entity', () => {
    // The title is text, not markup: `&amp;` typed by the author must show as
    // `&amp;`, not turn into `&`.
    expect(escapeHtmlText('A&amp;B')).toBe('A&amp;amp;B')
  })
})

describe('previewPage', () => {
  it('keeps a normal title intact in both sinks', () => {
    const page = previewPage(BODY, '排版示例 · 2026 春 🚀')
    expect(count(page, '<title>')).toBe(1)
    expect(count(page, '</title>')).toBe(1)
    expect(page).toContain('<title>排版示例 · 2026 春 🚀</title>')
    expect(page).toContain('<div class="hint">排版示例 · 2026 春 🚀 · 预览页</div>')
    expect(page).toContain(BODY)
  })

  it('cannot be closed out of the title with a fake end tag', () => {
    const page = previewPage(BODY, '</title><script>alert(1)</script>')
    expect(count(page, '</title>')).toBe(1)
    expect(count(page, '<title>')).toBe(1)
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('cannot introduce tags through either sink', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<style>body{display:none}</style>',
      '"><script>alert(1)</script>',
      "' onmouseover='alert(1)",
    ]
    // A payload may only ever add *text*. Counting tags is what says so: the
    // page keeps exactly the tags it always has, whatever the title holds.
    const baselineTags = (previewPage(BODY, 'x').match(/<[^>]*>/g) ?? []).length
    for (const payload of payloads) {
      const page = previewPage(BODY, payload)
      expect((page.match(/<[^>]*>/g) ?? []).length, payload).toBe(baselineTags)
      // The payload survives as text, so the author can still see what they named it.
      expect(page, payload).toContain(escapeHtmlText(payload))
    }
  })

  it('keeps attribute-breaking quotes out of the hint sink', () => {
    const page = previewPage(BODY, '" onload="alert(1)')
    expect(page).toContain('<div class="hint">&quot; onload=&quot;alert(1) · 预览页</div>')
    expect(page).not.toContain('<div class="hint" onload')
  })

  it('carries the body through untouched', () => {
    // The body is this app's own rendered article - escaping it here would paste
    // visible tags into WeChat.
    const page = previewPage('<section><p>2 &lt; 3</p></section>', 'x')
    expect(page).toContain('<section><p>2 &lt; 3</p></section>')
  })

  it('survives an empty title', () => {
    const page = previewPage(BODY, '')
    expect(count(page, '<title>')).toBe(1)
    expect(page).toContain('<title></title>')
  })

  it('escapes for HTML independently of how the file name is sanitized', () => {
    // Two different sinks, two different rulebooks: `<` is illegal in a file name
    // and must be escaped in markup, `·` and emoji are fine on disk and in text
    // but the shell script names in scripts/ have to survive Windows too.
    const title = 'A<b> · 示例 🚀.html'
    expect(safeFilename(title, '推文', 'html')).toBe('Ab · 示例 🚀.html')
    const page = previewPage(BODY, title)
    expect(page).toContain('<title>A&lt;b&gt; · 示例 🚀.html</title>')
    expect(count(page, '<b>')).toBe(0)
  })
})
