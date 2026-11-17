// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toCanvas } from 'html-to-image'
import {
  LONG_CANVAS_LIMIT_KEY, canvasLimitOverride, computeTileCuts, cutCandidates, exportLongImage, prepareLongImages,
} from './long-image-export'

const zipGate = vi.hoisted(() => {
  const state = { started: false, resolve: (_blob: Blob) => {} }
  const promise = new Promise<Blob>((resolve) => { state.resolve = resolve })
  return { state, promise }
})

vi.mock('html-to-image', () => ({ toCanvas: vi.fn(), toBlob: vi.fn() }))
// The real ZIP writer is irrelevant here; this gate lets a test cancel after
// the archive was built.
vi.mock('jszip', () => ({
  default: class {
    file(): void {}
    generateAsync(): Promise<Blob> {
      zipGate.state.started = true
      return zipGate.promise
    }
  },
}))

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('photo preparation failure', () => {
  it('keeps the original src and still lays out a row when a photo cannot be read', async () => {
    const src = 'http://blocked.invalid/a.jpg'
    document.body.innerHTML = `<div class="reed-long-root"><div class="reed-long-photos"><div class="reed-long-photo-frame"><div class="reed-long-photo-row"><figure class="reed-long-photo"><img src="${src}" alt=""></figure></div></div></div></div>`
    const root = document.querySelector<HTMLElement>('.reed-long-root')!
    const image = root.querySelector('img')!
    Object.defineProperty(image, 'decode', { value: vi.fn().mockRejectedValue(new Error('blocked')) })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')))
    const result = await prepareLongImages(root, { padX: 24, contentWidth: 492, photoGap: 4, photoInset: 13 }, {
      scale: 2,
      signal: new AbortController().signal,
    })
    expect(result.failed).toEqual([src])
    expect(image.getAttribute('src')).toBe(src)
    expect(image.dataset.longMissing).toBe('true')
    expect(root.querySelectorAll('.reed-long-photo-row')).toHaveLength(1)
  })
})

describe('tile cut planning', () => {
  it('keeps the whole page on one tile when it fits', () => {
    expect(computeTileCuts([100, 200], 1000, 2000)).toEqual([0, 1000])
  })

  it('cuts at measured module boundaries below the limit', () => {
    expect(computeTileCuts([1000, 2000, 3000], 4000, 1500)).toEqual([0, 1000, 2000, 3000, 4000])
  })

  it('falls back to the limit when no boundary is available', () => {
    expect(computeTileCuts([], 2000, 800)).toEqual([0, 800, 1600, 2000])
  })

  it('never returns a cut beyond the page or at zero', () => {
    expect(computeTileCuts([0, 2000, 2000], 2000, 1200)).toEqual([0, 1200, 2000])
  })

  it('offers paragraph edges inside the preamble, so an article without H2 is not cut mid-line', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="reed-long-flow"><div class="reed-long-header"></div>' +
      '<div class="reed-long-preamble"><p></p><p></p><p></p></div></div>'
    const box = (element: Element, top: number, bottom: number) => {
      element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top } as DOMRect)
    }
    box(root, 0, 12600)
    box(root.querySelector('.reed-long-header')!, 0, 600)
    box(root.querySelector('.reed-long-preamble')!, 600, 12600)
    const paragraphs = root.querySelectorAll('.reed-long-preamble > p')
    box(paragraphs[0], 600, 4800)
    box(paragraphs[1], 4800, 9000)
    box(paragraphs[2], 9000, 12600)
    const candidates = cutCandidates(root)
    expect(candidates).toEqual(expect.arrayContaining([4800, 9000]))
    expect(computeTileCuts(candidates, 12600, 5000)).toEqual([0, 4800, 9000, 12600])
  })
})

describe('test-only canvas limit override', () => {
  it('accepts a valid override and rejects malformed values', () => {
    localStorage.setItem(LONG_CANVAS_LIMIT_KEY, JSON.stringify({ maxEdge: 1200, maxArea: 2000000 }))
    expect(canvasLimitOverride()).toEqual({ maxEdge: 1200, maxArea: 2000000 })
    for (const value of ['{', JSON.stringify({ maxEdge: 100 }), JSON.stringify({ maxEdge: 1200, maxArea: -1 })]) {
      localStorage.setItem(LONG_CANVAS_LIMIT_KEY, value)
      expect(canvasLimitOverride()).toBeNull()
    }
  })
})

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
  } as unknown as HTMLCanvasElement
}

describe('export cancellation', () => {
  const rect = {
    top: 0, bottom: 1000, left: 0, right: 540, width: 540, height: 1000, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    vi.mocked(toCanvas).mockReset()
    zipGate.state.started = false
  })
  afterEach(() => rectSpy.mockRestore())

  const options = (signal: AbortSignal) => ({
    faces: [], scale: 2, format: 'png' as const, filename: 'cancelled', signal,
  })

  it('rejects when cancelled while the canvas render is pending', async () => {
    const controller = new AbortController()
    let resolveCanvas = (_canvas: HTMLCanvasElement) => {}
    vi.mocked(toCanvas).mockImplementationOnce(() => new Promise<HTMLCanvasElement>((resolve) => {
      resolveCanvas = resolve
    }))
    const pending = exportLongImage(document.createElement('div'), options(controller.signal))
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalled())
    controller.abort()
    resolveCanvas(fakeCanvas())
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops between tiles and never builds a ZIP when cancelled mid-render', async () => {
    localStorage.setItem(LONG_CANVAS_LIMIT_KEY, JSON.stringify({ maxEdge: 600, maxArea: 600 * 1080 }))
    const controller = new AbortController()
    let resolveSecond = (_canvas: HTMLCanvasElement) => {}
    vi.mocked(toCanvas)
      .mockImplementationOnce(async () => fakeCanvas())
      .mockImplementationOnce(() => new Promise<HTMLCanvasElement>((resolve) => { resolveSecond = resolve }))
    const pending = exportLongImage(document.createElement('div'), options(controller.signal))
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalledTimes(2))
    controller.abort()
    resolveSecond(fakeCanvas())
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(zipGate.state.started).toBe(false)
  })

  it('rejects when cancelled after the ZIP was generated', async () => {
    localStorage.setItem(LONG_CANVAS_LIMIT_KEY, JSON.stringify({ maxEdge: 600, maxArea: 600 * 1080 }))
    const controller = new AbortController()
    vi.mocked(toCanvas).mockImplementation(async () => fakeCanvas())
    const pending = exportLongImage(document.createElement('div'), options(controller.signal))
    await vi.waitFor(() => expect(zipGate.state.started).toBe(true))
    controller.abort()
    zipGate.state.resolve(new Blob(['zip']))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('photo preparation cleanup', () => {
  const metrics = { padX: 24, contentWidth: 492, photoGap: 4, photoInset: 0 }
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  let createdUrls = 0
  let revokedUrls = 0
  let createdBitmaps = 0
  let closedBitmaps = 0

  const root = () => document.querySelector<HTMLElement>('.reed-long-root')!

  function buildRoot(count: number) {
    document.body.innerHTML = `<div class="reed-long-root">${Array.from({ length: count }, () =>
      '<div class="reed-long-photos"><div class="reed-long-photo-frame"><div class="reed-long-photo-row">' +
      '<figure class="reed-long-photo"><img src="data:image/png;base64,AAAA" alt=""></figure></div></div></div>',
    ).join('')}</div>`
    for (const img of root().querySelectorAll('img')) {
      Object.defineProperty(img, 'decode', { value: vi.fn().mockResolvedValue(undefined) })
    }
  }

  function bitmap() {
    return { width: 10, height: 10, close: vi.fn(() => { closedBitmaps++ }) } as unknown as ImageBitmap
  }

  beforeEach(() => {
    createdUrls = 0
    revokedUrls = 0
    createdBitmaps = 0
    closedBitmaps = 0
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, writable: true,
      value: vi.fn(() => { createdUrls++; return `blob:test/${createdUrls}` }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, writable: true,
      value: vi.fn(() => { revokedUrls++ }),
    })
  })
  afterEach(() => {
    if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor)
    else delete (URL as unknown as Record<string, unknown>).createObjectURL
    if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
    else delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  })

  it('closes every bitmap and revokes every URL on the normal path', async () => {
    buildRoot(3)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { createdBitmaps++; return bitmap() }))
    const result = await prepareLongImages(root(), metrics, { scale: 0.1, signal: new AbortController().signal })
    expect(result.failed).toEqual([])
    expect(createdUrls).toBe(3)
    expect(revokedUrls).toBe(3)
    expect(createdBitmaps).toBe(3)
    expect(closedBitmaps).toBe(3)
  })

  it('releases the first two photos when cancelled after the second decode', async () => {
    buildRoot(4)
    const controller = new AbortController()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      createdBitmaps++
      if (createdBitmaps === 2) controller.abort()
      return bitmap()
    }))
    await expect(prepareLongImages(root(), metrics, { scale: 0.1, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(createdBitmaps).toBe(2)
    expect(closedBitmaps).toBe(2)
    expect(createdUrls).toBe(2)
    expect(revokedUrls).toBe(2)
  })

  it('leaves zero unreleased URLs and bitmaps after twenty interrupted preparations', async () => {
    for (let run = 0; run < 20; run++) {
      buildRoot(3)
      const controller = new AbortController()
      vi.stubGlobal('createImageBitmap', vi.fn(async () => {
        createdBitmaps++
        // Abort on the first decode of each run; the next loop turn throws.
        controller.abort()
        return bitmap()
      }))
      await expect(prepareLongImages(root(), metrics, { scale: 0.1, signal: controller.signal }))
        .rejects.toMatchObject({ name: 'AbortError' })
    }
    expect(createdUrls).toBe(revokedUrls)
    expect(createdBitmaps).toBe(closedBitmaps)
    expect(createdBitmaps).toBe(20)
  })
})
