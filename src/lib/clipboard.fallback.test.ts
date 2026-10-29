// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// These tests pin the copy contract the UI relies on: a function may only
// resolve `true` after the clipboard really received the content, every
// fallback leaves no DOM behind, and a missing API becomes `false` instead of
// a synchronous throw.

type WriteBatch = ClipboardItem[]

const originalNavigator = globalThis.navigator
const originalClipboardItem = window.ClipboardItem

class FakeClipboardItem {
  items: Record<string, Blob>
  constructor(items: Record<string, Blob>) {
    this.items = items
  }
}

/** Define a global on both `globalThis` and the jsdom `window`. */
function setGlobal(name: string, value: unknown) {
  vi.stubGlobal(name, value)
  ;(window as unknown as Record<string, unknown>)[name] = value
}

function stubClipboardApi(options: { failWrite?: boolean; failWriteText?: boolean } = {}) {
  const batches: WriteBatch[] = []
  const texts: string[] = []
  setGlobal('ClipboardItem', FakeClipboardItem as unknown as typeof ClipboardItem)
  setGlobal('navigator', {
    clipboard: {
      write: async (batch: WriteBatch) => {
        batches.push(batch)
        if (options.failWrite) throw new Error('denied')
      },
      writeText: async (text: string) => {
        texts.push(text)
        if (options.failWriteText) throw new Error('denied')
      },
    },
  })
  return { batches, texts }
}

function removeClipboardApi() {
  setGlobal('ClipboardItem', undefined)
  setGlobal('navigator', { clipboard: undefined })
}

function stubExecCommand(implementation: (command: string) => boolean) {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: implementation })
}

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('navigator', originalNavigator)
  ;(window as unknown as Record<string, unknown>).navigator = originalNavigator
  if (originalClipboardItem === undefined) setGlobal('ClipboardItem', undefined)
  else setGlobal('ClipboardItem', originalClipboardItem)
  delete (document as unknown as { execCommand?: unknown }).execCommand
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('copyRichText', () => {
  it('writes the same HTML and plain text through ClipboardItem', async () => {
    const { batches } = stubClipboardApi()
    const { copyRichText } = await import('./clipboard')

    await expect(copyRichText('<section><p>正文</p></section>', '正文')).resolves.toBe(true)

    expect(batches).toHaveLength(1)
    const item = batches[0][0] as unknown as FakeClipboardItem
    expect(Object.keys(item.items).sort()).toEqual(['text/html', 'text/plain'])
    expect(item.items['text/html'].type).toBe('text/html')
    expect(item.items['text/plain'].type).toBe('text/plain')
    await expect(item.items['text/html'].text()).resolves.toBe('<section><p>正文</p></section>')
    await expect(item.items['text/plain'].text()).resolves.toBe('正文')
  })

  it('falls back to a mounted DOM selection when ClipboardItem is missing', async () => {
    removeClipboardApi()
    let seen = { html: '', mounted: false }
    stubExecCommand(() => {
      const holder = document.body.firstElementChild as HTMLElement | null
      seen = {
        html: holder?.innerHTML ?? '',
        mounted: Boolean(holder && holder.parentNode === document.body),
      }
      return true
    })
    const { copyRichText } = await import('./clipboard')

    await expect(copyRichText('<p>fallback</p>', 'fallback')).resolves.toBe(true)
    expect(seen).toEqual({ html: '<p>fallback</p>', mounted: true })
    expect(document.body.innerHTML).toBe('')
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0)
  })

  it('removes the fallback holder and reports false when execCommand returns false', async () => {
    removeClipboardApi()
    stubExecCommand(() => false)
    const { copyRichText } = await import('./clipboard')

    await expect(copyRichText('<p>refused</p>', 'refused')).resolves.toBe(false)
    expect(document.body.innerHTML).toBe('')
  })

  it('cleans up and reports false when execCommand throws', async () => {
    removeClipboardApi()
    stubExecCommand(() => {
      throw new Error('copy blocked')
    })
    const { copyRichText } = await import('./clipboard')

    await expect(copyRichText('<p>boom</p>', 'boom')).resolves.toBe(false)
    expect(document.body.innerHTML).toBe('')
  })

  it('falls back to the DOM selection after a rejected ClipboardItem write', async () => {
    stubClipboardApi({ failWrite: true })
    const commands: string[] = []
    stubExecCommand((command) => {
      commands.push(command)
      return true
    })
    const { copyRichText } = await import('./clipboard')

    await expect(copyRichText('<p>denied</p>', 'denied')).resolves.toBe(true)
    expect(commands).toEqual(['copy'])
    expect(document.body.innerHTML).toBe('')
  })

  it('reports false when the async write is rejected and execCommand is unavailable', async () => {
    stubClipboardApi({ failWrite: true })
    const { copyRichText } = await import('./clipboard')

    await expect(copyRichText('<p>nowhere</p>', 'nowhere')).resolves.toBe(false)
    expect(document.body.innerHTML).toBe('')
  })
})

describe('copyPlain', () => {
  it('writes through writeText and resolves true', async () => {
    const { texts, batches } = stubClipboardApi()
    const { copyPlain } = await import('./clipboard')

    await expect(copyPlain('hello')).resolves.toBe(true)
    expect(texts).toEqual(['hello'])
    expect(batches).toHaveLength(0)
  })

  it('uses the textarea fallback when writeText is rejected and reports its result', async () => {
    stubClipboardApi({ failWriteText: true })
    let copied = ''
    stubExecCommand(() => {
      const area = document.querySelector('textarea')
      copied = area?.value ?? ''
      return true
    })
    const { copyPlain } = await import('./clipboard')

    await expect(copyPlain('标题草稿')).resolves.toBe(true)
    expect(copied).toBe('标题草稿')
    expect(document.body.innerHTML).toBe('')
  })

  it('reports false when writeText is rejected and execCommand refuses', async () => {
    stubClipboardApi({ failWriteText: true })
    stubExecCommand(() => false)
    const { copyPlain } = await import('./clipboard')

    await expect(copyPlain('hello')).resolves.toBe(false)
    expect(document.body.innerHTML).toBe('')
  })

  it('does not throw when the Clipboard API is missing', async () => {
    removeClipboardApi()
    stubExecCommand(() => false)
    const { copyPlain } = await import('./clipboard')

    await expect(copyPlain('hello')).resolves.toBe(false)
  })
})
