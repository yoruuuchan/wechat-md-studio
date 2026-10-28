import { describe, expect, it } from 'vitest'
import {
  applyImageWriteTarget,
  applyInsertWriteTarget,
  captureImageWriteTarget,
  captureInsertWriteTarget,
  insertionPoint,
  mapWriteTarget,
} from './upload-writeback'

const GALLERY = [':::gallery 2 1:1 Test', '![same]()', '![same]()', ':::', '', 'TAIL'].join('\n')

describe('image write targets survive edits around the slot', () => {
  it('follows text typed before the target', () => {
    const target = captureImageWriteTarget(GALLERY, 'same', 2)!
    const edited = 'TYPED AT THE TOP\n\n' + GALLERY
    mapWriteTarget(target, GALLERY, edited)
    const out = applyImageWriteTarget(edited, target, 'img:filled')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).toContain('![same]()\n![same](img:filled)')
    expect(out.content).toContain('TYPED AT THE TOP')
  })

  it('follows text typed after the target', () => {
    const target = captureImageWriteTarget(GALLERY, 'same', 2)!
    const edited = GALLERY + '\n\nTYPED AT THE BOTTOM'
    mapWriteTarget(target, GALLERY, edited)
    const out = applyImageWriteTarget(edited, target, 'img:filled')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).toContain('![same](img:filled)\n:::')
    expect(out.content).toContain('TYPED AT THE BOTTOM')
  })

  it('does not confuse a duplicate caption inserted above', () => {
    // Both images share one caption and both are empty. The old occurrence-only
    // lookup would now address the new first image; the tracked span must still
    // hit the second one.
    const target = captureImageWriteTarget(GALLERY, 'same', 2)!
    const edited = GALLERY.replace(':::gallery 2 1:1 Test\n', ':::gallery 2 1:1 Test\n![same]()\n')
    mapWriteTarget(target, GALLERY, edited)
    const out = applyImageWriteTarget(edited, target, 'img:filled')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const lines = out.content.split('\n')
    expect(lines.filter((l) => l === '![same](img:filled)')).toHaveLength(1)
    expect(lines.filter((l) => l === '![same]()')).toHaveLength(2)
  })

  it('refuses to write when the caption was edited under it', () => {
    const target = captureImageWriteTarget(GALLERY, 'same', 2)!
    const edited = GALLERY.replace('![same]()\n:::', '![renamed]()\n:::')
    mapWriteTarget(target, GALLERY, edited)
    expect(target.stale).toBe(true)
    expect(applyImageWriteTarget(edited, target, 'img:filled')).toEqual({
      ok: false,
      reason: 'stale',
    })
  })

  it('refuses to write after the target was removed', () => {
    const target = captureImageWriteTarget(GALLERY, 'same', 2)!
    const edited = GALLERY.replace('![same]()\n:::', ':::')
    mapWriteTarget(target, GALLERY, edited)
    expect(applyImageWriteTarget(edited, target, 'img:filled').ok).toBe(false)
  })

  it('refuses to write after moving the target elsewhere', () => {
    const target = captureImageWriteTarget(GALLERY, 'same', 2)!
    const inserted = '![same]()\n\n' + GALLERY
    mapWriteTarget(target, GALLERY, inserted)
    const edited = inserted.replace('![same]()\n:::', ':::')
    mapWriteTarget(target, inserted, edited)
    expect(target.stale).toBe(true)
  })
})

describe('insert write targets keep the drop position', () => {
  it('inserts after text typed before the drop point', () => {
    const base = '# Title\n\nBEFORE_UPLOAD'
    const target = captureInsertWriteTarget(base, base.length)
    const edited = 'TYPED\n\n' + base
    mapWriteTarget(target, base, edited)
    const out = applyInsertWriteTarget(edited, target, '![shot](img:key)')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).toBe('TYPED\n\n# Title\n\nBEFORE_UPLOAD\n\n![shot](img:key)\n')
  })

  it('follows text typed after the drop point', () => {
    const base = '# Title\n\nBEFORE_UPLOAD'
    const target = captureInsertWriteTarget(base, base.length)
    const edited = base + '\n\nTYPED_AFTER'
    mapWriteTarget(target, base, edited)
    const out = applyInsertWriteTarget(edited, target, '![shot](img:key)')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).toContain('BEFORE_UPLOAD\n\nTYPED_AFTER\n\n![shot](img:key)')
  })

  it('keeps consecutive drops in order', () => {
    const base = '# Title\n\nTAIL'
    const first = captureInsertWriteTarget(base, base.length)
    const second = captureInsertWriteTarget(base, base.length)
    const one = applyInsertWriteTarget(base, first, '![one](img:1)')
    expect(one.ok).toBe(true)
    if (!one.ok) return
    mapWriteTarget(second, base, one.content)
    const two = applyInsertWriteTarget(one.content, second, '![two](img:2)')
    expect(two.ok).toBe(true)
    if (!two.ok) return
    expect(two.content).toBe('# Title\n\nTAIL\n\n![one](img:1)\n\n![two](img:2)\n')
  })

  it('refuses a drop point that was cut out of the document', () => {
    const base = '# Title\n\nDELETE ME\n\nTAIL'
    const target = captureInsertWriteTarget(base, base.indexOf('DELETE ME'))
    const edited = base.replace('DELETE ME\n\n', '')
    mapWriteTarget(target, base, edited)
    expect(target.stale).toBe(true)
    expect(applyInsertWriteTarget(edited, target, '![shot](img:key)').ok).toBe(false)
  })
})

describe('insertionPoint matches the editor block insert', () => {
  it('snaps a mid-line position to the end of that line', () => {
    const text = 'first line\nsecond line\n'
    expect(insertionPoint(text, 3)).toBe('first line'.length)
  })

  it('keeps a position on an empty line', () => {
    const text = 'first\n\nlast'
    expect(insertionPoint(text, 6)).toBe(6)
  })

  it('clamps positions outside the document', () => {
    expect(insertionPoint('abc', 99)).toBe(3)
    // The editor also snaps a clamped position to the line end.
    expect(insertionPoint('abc', -1)).toBe(3)
  })
})
