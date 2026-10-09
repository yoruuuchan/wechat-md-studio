import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The database path and the image host are both read when their modules load,
// so they have to be in place before the router (and therefore connection and
// env) is imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-materials-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'materials.db')}`
process.env.IMG_BASE_URL = 'https://img.example.test'
process.env.IMG_ADMIN_KEY = 'test-admin-key'

const { storageRouter } = await import('./storage-router')
const { getDb } = await import('./queries/connection')
const { files, docs } = await import('../db/schema')

const user = {
  id: 1,
  unionId: 'u1',
  name: null,
  email: null,
  avatar: null,
  role: 'user' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
}
const caller = storageRouter.createCaller({
  req: new Request('http://test/'),
  resHeaders: new Headers(),
  user,
})

let seq = 0
async function addFile(size = 1024): Promise<string> {
  const key = `key-${++seq}`
  await getDb().insert(files).values({ key, ownerId: user.id, name: `mopai/${key}.png`, size, visitor: null })
  return key
}

const rowExists = async (key: string) =>
  (await getDb().select({ key: files.key }).from(files)).some((r) => r.key === key)

/** Deletes answer however the test wants, and every call is recorded. */
function mockWorker(responder: (key: string) => Response) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input))
      calls.push(url.searchParams.get('key') ?? '')
      return responder(url.searchParams.get('key') ?? '')
    }),
  )
  return calls
}

const ok = () => new Response('{"deleted":true}', { status: 200 })
const status = (code: number) => new Response('{"error":"no"}', { status: code })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deleting one image', () => {
  it('removes the object first, then the ledger row', async () => {
    const key = await addFile()
    const calls = mockWorker(ok)
    expect(await caller.remove({ key })).toEqual({ ok: true })
    expect(calls).toEqual([key])
    expect(await rowExists(key)).toBe(false)
  })

  it('keeps the row when the worker refuses, so the image stays deletable', async () => {
    const key = await addFile()
    mockWorker(() => status(500))
    await expect(caller.remove({ key })).rejects.toThrow(/图床拒绝了这次删除/)
    // The row is the ledger entry for an object that is still in the bucket.
    // Dropping it here is exactly the leak this order exists to prevent.
    expect(await rowExists(key)).toBe(true)
    // …and because the row survives, the image is still listed and still an
    // orphan candidate, so the user can try again.
    expect((await caller.list()).map((f) => f.key)).toContain(key)
  })

  it('keeps the row when the worker cannot be reached', async () => {
    const key = await addFile()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }))),
    )
    await expect(caller.remove({ key })).rejects.toThrow(/连不上图床/)
    expect(await rowExists(key)).toBe(true)
  })

  it('keeps the row on a 404 rather than assuming the object is gone', async () => {
    const key = await addFile()
    mockWorker(() => status(404))
    await expect(caller.remove({ key })).rejects.toThrow(/IMG_BASE_URL/)
    expect(await rowExists(key)).toBe(true)
  })

  it('treats a successful delete of an already-missing object as done', async () => {
    // This worker answers 200 for a key that was never there - its DELETE is
    // idempotent - which is what makes a retry safe.
    const key = await addFile()
    mockWorker(ok)
    await caller.remove({ key })
    mockWorker(ok)
    await expect(caller.remove({ key })).rejects.toThrow(/FORBIDDEN|UNAUTHORIZED/i)
  })

  it('will not delete another visitor’s image', async () => {
    const key = await addFile()
    await getDb().insert(files).values({ key: 'someone-else', ownerId: 99, name: 'x', size: 10, visitor: null })
    mockWorker(ok)
    await expect(caller.remove({ key: 'someone-else' })).rejects.toThrow()
    expect(await rowExists('someone-else')).toBe(true)
    expect(await rowExists(key)).toBe(true)
  })
})

describe('cleaning up orphans', () => {
  it('reports what it could not delete and keeps those rows', async () => {
    const a = await addFile(2048)
    const b = await addFile(4096)
    mockWorker((key) => (key === a ? ok() : status(503)))

    const res = await caller.removeOrphans({ keys: [a, b] })
    expect(res.deleted).toBe(1)
    expect(res.freedBytes).toBe(2048)
    expect(res.failed).toEqual([b])
    expect(await rowExists(a)).toBe(false)
    expect(await rowExists(b)).toBe(true)
  })

  it('survives the worker being unreachable, counting every key as failed', async () => {
    const a = await addFile()
    const b = await addFile()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch failed'))))

    const res = await caller.removeOrphans({ keys: [a, b] })
    expect(res).toMatchObject({ deleted: 0, freedBytes: 0, failed: [a, b] })
    expect(await rowExists(a)).toBe(true)
    expect(await rowExists(b)).toBe(true)
  })

  it('still refuses to touch an image a saved article references', async () => {
    const a = await addFile()
    const b = await addFile()
    await getDb()
      .insert(docs)
      .values({
        id: 'doc-1',
        ownerId: user.id,
        name: '稿件',
        content: `![配图](img:${a})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    const calls = mockWorker(ok)

    const res = await caller.removeOrphans({ keys: [a, b] })
    expect(res.skipped).toEqual([a])
    expect(res.deleted).toBe(1)
    expect(calls).toEqual([b])
    expect(await rowExists(a)).toBe(true)
  })

  it('answers an empty request without calling the worker', async () => {
    const calls = mockWorker(ok)
    expect(await caller.removeOrphans({ keys: [] })).toMatchObject({ deleted: 0, failed: [] })
    expect(calls).toEqual([])
  })
})
