import { afterEach, describe, expect, it, vi } from 'vitest'

// The module reads IMG_BASE_URL / IMG_ADMIN_KEY when it loads, so the
// environment has to be in place before the import - imports are hoisted.
process.env.IMG_BASE_URL = process.env.IMG_BASE_URL || 'https://img.example.test'
process.env.IMG_ADMIN_KEY = process.env.IMG_ADMIN_KEY || 'test-admin-key'
const { storage } = await import('./storage')

const TEXT = (status: number) =>
  new Response('{"error":"nope"}', { status, headers: { 'Content-Type': 'application/json' } })

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => impl(String(input), init))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storage.deleteFile verdicts', () => {
  it('reports the object gone on 2xx, and only then', async () => {
    const spy = mockFetch(() => new Response('{"key":"k","deleted":true}', { status: 200 }))
    const result = await storage.deleteFile({ fileKey: 'k/图 1.png' })
    expect(result).toMatchObject({ gone: true, reason: 'ok', status: 200 })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('https://img.example.test/api/upload?key=k%2F%E5%9B%BE%201.png')
    expect(init?.method).toBe('DELETE')
    expect((init?.headers as Record<string, string>)['X-Admin-Key']).toBe('test-admin-key')
  })

  it('treats a 404 as unconfirmed, not as gone', async () => {
    // This worker answers 200 for a key that was never there (its delete is
    // idempotent), so a 404 means the request did not reach that route: the
    // object may well still be in the bucket.
    mockFetch(() => TEXT(404))
    const result = await storage.deleteFile({ fileKey: 'k' })
    expect(result.gone).toBe(false)
    expect(result.reason).toBe('not-found')
    expect(result.status).toBe(404)
  })

  it('reports a refusal', async () => {
    for (const status of [401, 403, 500, 502, 503]) {
      mockFetch(() => TEXT(status))
      const result = await storage.deleteFile({ fileKey: 'k' })
      expect(result.gone, String(status)).toBe(false)
      expect(result.reason, String(status)).toBe('refused')
      expect(result.status).toBe(status)
    }
  })

  it('reports an unreachable worker instead of throwing', async () => {
    mockFetch(() => Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })))
    const result = await storage.deleteFile({ fileKey: 'k' })
    expect(result.gone).toBe(false)
    expect(result.reason).toBe('network')
    expect(result.detail).toContain('ECONNREFUSED')
  })

  it('reports an unconfigured image host instead of throwing', async () => {
    // endpoint() throws StorageError when IMG_BASE_URL is empty; the caller must
    // still get a verdict it can act on rather than an exception it might catch
    // and swallow.
    const original = process.env.IMG_BASE_URL
    vi.resetModules()
    process.env.IMG_BASE_URL = ''
    const { storage: fresh } = await import('./storage')
    mockFetch(() => new Response('', { status: 200 }))
    const result = await fresh.deleteFile({ fileKey: 'k' })
    expect(result.gone).toBe(false)
    expect(result.reason).toBe('unconfigured')
    process.env.IMG_BASE_URL = original
    vi.resetModules()
  })
})

describe('storage.uploadFile', () => {
  it('still throws a labelled StorageError, which the router maps to a message', async () => {
    mockFetch(() => TEXT(413))
    await expect(storage.uploadFile({ fileContent: new Uint8Array([1, 2, 3]), fileName: 'a.png' })).rejects.toMatchObject({
      code: 'STORAGE_FILE_TOO_LARGE',
    })

    mockFetch(() => TEXT(401))
    await expect(storage.uploadFile({ fileContent: new Uint8Array([1]), fileName: 'b.png' })).rejects.toMatchObject({
      code: 'STORAGE_UNAUTHORIZED',
    })
  })
})
