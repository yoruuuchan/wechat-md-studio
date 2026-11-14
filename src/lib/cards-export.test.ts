// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { toBlobWithExactFonts } from './cards-export'

const MARKER = '--xhs-export-font-size'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** A frozen card carries its exact computed size; html-to-image clones it. */
function markedNode(exactPx: string): HTMLElement {
  const node = document.createElement('div')
  node.textContent = '同一段密集中文'
  node.style.setProperty(MARKER, exactPx)
  return node
}

/** What html-to-image does to a clone: shave the size, then read what landed. */
function cloneFontSize(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  clone.style.setProperty('font-size', '16.9px')
  return clone.style.getPropertyValue('font-size')
}

const protoOf = () => CSSStyleDeclaration.prototype.setProperty

describe('toBlobWithExactFonts', () => {
  it('keeps two overlapping exports independent and restores the exact method', async () => {
    const native = protoOf()
    const gateA = deferred()
    const gateB = deferred()
    const sizes: string[] = []
    const a = toBlobWithExactFonts(
      async (node) => {
        sizes.push(cloneFontSize(node as HTMLElement))
        await gateA.promise
        return new Blob(['a'])
      },
      markedNode('17.5px'),
      {},
    )
    const b = toBlobWithExactFonts(
      async (node) => {
        sizes.push(cloneFontSize(node as HTMLElement))
        await gateB.promise
        return new Blob(['b'])
      },
      markedNode('18.5px'),
      {},
    )
    await Promise.resolve()
    expect(sizes).toEqual(['17.5px', '18.5px'])
    expect(protoOf()).not.toBe(native)
    // The first export ends first: the other must keep its exact sizes.
    gateA.resolve()
    await a
    expect(protoOf()).not.toBe(native)
    gateB.resolve()
    await b
    expect(protoOf()).toBe(native)
  })

  it('substitutes only nodes that carry the marker', async () => {
    let marked = ''
    let plain = ''
    await toBlobWithExactFonts(
      async (node) => {
        marked = cloneFontSize(node as HTMLElement)
        const bare = document.createElement('div')
        const clone = bare.cloneNode(true) as HTMLElement
        clone.style.setProperty('font-size', '16.9px')
        plain = clone.style.getPropertyValue('font-size')
        return null
      },
      markedNode('17.5px'),
      {},
    )
    expect(marked).toBe('17.5px')
    expect(plain).toBe('16.9px')
  })

  it('restores after one export throws while the other is still running', async () => {
    const native = protoOf()
    const gate = deferred()
    const ok = toBlobWithExactFonts(
      async (node) => {
        expect(cloneFontSize(node as HTMLElement)).toBe('17.5px')
        await gate.promise
        return null
      },
      markedNode('17.5px'),
      {},
    )
    await expect(
      toBlobWithExactFonts(
        async () => {
          throw new Error('boom')
        },
        markedNode('18.5px'),
        {},
      ),
    ).rejects.toThrow('boom')
    expect(protoOf()).not.toBe(native)
    gate.resolve()
    await ok
    expect(protoOf()).toBe(native)
  })

  it('keeps no patch behind when both overlapping exports throw', async () => {
    const native = protoOf()
    const gate = deferred()
    const late = toBlobWithExactFonts(
      async () => {
        await gate.promise
        throw new Error('late')
      },
      markedNode('17.5px'),
      {},
    )
    const expectation = expect(late).rejects.toThrow('late')
    await expect(
      toBlobWithExactFonts(
        async () => {
          throw new Error('first')
        },
        markedNode('18.5px'),
        {},
      ),
    ).rejects.toThrow('first')
    expect(protoOf()).not.toBe(native)
    gate.resolve()
    await expectation
    expect(protoOf()).toBe(native)
  })

  it('still substitutes exact sizes on a third export after two failures', async () => {
    const native = protoOf()
    await expect(
      toBlobWithExactFonts(
        async () => {
          throw new Error('one')
        },
        markedNode('17.5px'),
        {},
      ),
    ).rejects.toThrow('one')
    await expect(
      toBlobWithExactFonts(
        async () => {
          throw new Error('two')
        },
        markedNode('18.5px'),
        {},
      ),
    ).rejects.toThrow('two')
    let size = ''
    await toBlobWithExactFonts(
      async (node) => {
        size = cloneFontSize(node as HTMLElement)
        return null
      },
      markedNode('19.5px'),
      {},
    )
    expect(size).toBe('19.5px')
    expect(protoOf()).toBe(native)
  })

  it('keeps substituting after the first of two overlapping exports finishes', async () => {
    const native = protoOf()
    const gate = deferred()
    let lateSize = ''
    const first = toBlobWithExactFonts(
      async () => {
        await gate.promise
        return null
      },
      markedNode('17.5px'),
      {},
    )
    const second = toBlobWithExactFonts(
      async (node) => {
        // The first export has finished and released by now; the second one must
        // still read exact sizes. The old per-call restore put the native method
        // back underneath it at this point.
        await gate.promise
        await Promise.resolve()
        lateSize = cloneFontSize(node as HTMLElement)
        return null
      },
      markedNode('18.5px'),
      {},
    )
    gate.resolve()
    await first
    await second
    expect(lateSize).toBe('18.5px')
    expect(protoOf()).toBe(native)
  })
})
