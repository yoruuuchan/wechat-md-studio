import { beforeEach, describe, expect, it, vi } from 'vitest'

// compressImage needs a browser DOM, so it is replaced with a stub whose calls
// are inspected instead. What these tests pin is the plumbing: which budget a
// size choice resolves to, and how compressImage's result maps onto the payload
// the upload path actually sends.
vi.mock('./image-compress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image-compress')>()
  return { ...actual, compressImage: vi.fn() }
})

import { compressImage, uploadBudget, type CompressedImage } from './image-compress'
import { compressForUpload, prepareForUpload } from './image'
import { MaxImageBytes } from '@contracts/constants'

const mockedCompress = vi.mocked(compressImage)

function photo(name = 'photo.png', type = 'image/png', bytes = 4096): File {
  return new File([new Uint8Array(bytes).fill(7)], name, { type })
}

function encodeResult(overrides: Partial<CompressedImage> = {}): CompressedImage {
  return {
    blob: new Blob([new Uint8Array(64)], { type: 'image/webp' }),
    mime: 'image/webp',
    width: 2048,
    height: 1536,
    sourceBytes: 4096,
    bytes: 1024,
    quality: 0.9,
    scaled: true,
    grew: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockedCompress.mockReset()
  mockedCompress.mockResolvedValue(encodeResult())
})

describe('prepareForUpload', () => {
  it('passes the shipped auto budget through to compressImage by default', async () => {
    const file = photo()
    await prepareForUpload(file)
    expect(mockedCompress).toHaveBeenCalledTimes(1)
    expect(mockedCompress.mock.calls[0][0]).toBe(file)
    expect(mockedCompress.mock.calls[0][1]).toEqual({ maxEdge: 2048, targetBytes: 800 * 1024 })
  })

  it('passes a tier choice through as its own pixel and byte budget', async () => {
    await prepareForUpload(photo(), '2')
    expect(mockedCompress.mock.calls[0][1]).toEqual({ maxEdge: 2560, targetBytes: 2 * 1024 * 1024 })
  })

  it('sends every tier through the same ladder compressImage owns', async () => {
    for (const choice of ['1', '3', '5'] as const) {
      mockedCompress.mockClear()
      await prepareForUpload(photo(), choice)
      expect(mockedCompress.mock.calls[0][1]).toEqual(uploadBudget(choice))
    }
  })

  it('never re-encodes in original mode: no compressor call, the same file back', async () => {
    const file = photo('camera.png', 'image/png', 8192)
    const out = await prepareForUpload(file, 'original')
    expect(mockedCompress).not.toHaveBeenCalled()
    expect(out.blob).toBe(file)
    expect(out.mime).toBe('image/png')
    expect(out.bytes).toBe(file.size)
    expect(out.untouched).toBe(true)
    expect(out.grew).toBe(false)
  })

  it('maps a compressed result onto the upload payload', async () => {
    const file = photo()
    const outBlob = new Blob([new Uint8Array(512)], { type: 'image/webp' })
    mockedCompress.mockResolvedValue(
      encodeResult({ blob: outBlob, mime: 'image/webp', sourceBytes: 4096, bytes: 512 }),
    )
    const out = await prepareForUpload(file, 'auto')
    expect(out.blob).toBe(outBlob)
    expect(out.mime).toBe('image/webp')
    expect(out).toMatchObject({ sourceBytes: 4096, bytes: 512, grew: false, untouched: false })
  })

  it('falls back to the original file when compression grew it', async () => {
    const file = photo()
    mockedCompress.mockResolvedValue(encodeResult({ bytes: 9000, sourceBytes: file.size, grew: true }))
    const out = await prepareForUpload(file, 'auto')
    expect(out.blob).toBe(file)
    expect(out.bytes).toBe(file.size)
    expect(out.grew).toBe(true)
    expect(out.untouched).toBe(false)
  })
})

describe('prepareForUpload at the per-image cap', () => {
  it('pins the shared cap the server doors enforce', () => {
    expect(MaxImageBytes).toBe(20 * 1024 * 1024)
  })

  it('refuses an over-limit original instead of letting the server reject it', async () => {
    const file = photo('huge.png', 'image/png', 25 * 1024 * 1024)
    const err: unknown = await prepareForUpload(file, 'original').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    // The message names both numbers so the toast is actionable on its own.
    expect((err as Error).message).toContain('25 MB')
    expect((err as Error).message).toContain('20 MB')
    expect(mockedCompress).not.toHaveBeenCalled()
  })

  it('allows an original sitting exactly on the cap, matching the server >', async () => {
    const file = photo('edge.png', 'image/png', MaxImageBytes)
    const out = await prepareForUpload(file, 'original')
    expect(out.blob).toBe(file)
    expect(out.untouched).toBe(true)
  })

  it('never refuses a size tier: compression is the way out for big files', async () => {
    const file = photo('huge.png', 'image/png', 25 * 1024 * 1024)
    await prepareForUpload(file, '5')
    expect(mockedCompress).toHaveBeenCalledTimes(1)
    expect(mockedCompress.mock.calls[0][1]).toEqual(uploadBudget('5'))
  })
})

describe('compressForUpload', () => {
  it('overrides the compressImage defaults only when options are given', async () => {
    await compressForUpload(photo())
    expect(mockedCompress.mock.calls[0][1]).toBeUndefined()
    await compressForUpload(photo(), { maxEdge: 657, targetBytes: 1024 })
    expect(mockedCompress.mock.calls[1][1]).toEqual({ maxEdge: 657, targetBytes: 1024 })
  })

  it('treats compressImage\'s quality-1 sentinel as untouched and keeps the file', async () => {
    const file = photo('icon.webp', 'image/webp')
    mockedCompress.mockResolvedValue(
      encodeResult({ blob: file, mime: 'image/webp', quality: 1, scaled: false, sourceBytes: file.size, bytes: file.size }),
    )
    const out = await compressForUpload(file)
    expect(out.blob).toBe(file)
    expect(out.untouched).toBe(true)
    expect(out.grew).toBe(false)
  })
})
