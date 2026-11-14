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
const { createVisitorResolver, visitorKey } = await import('./lib/visitor')
const { ANON_OWNER_ID } = await import('./lib/anon-quota')
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
  clientIp: '203.0.113.10',
  visitorIdentity: createVisitorResolver(new Headers(), new Headers()),
  user,
})

/** An anonymous visitor of this browser, the owner of the images below. */
const VISITOR_ID = 'c'.repeat(32)
function visitorCaller(id = VISITOR_ID) {
  const headers = new Headers({ cookie: `mopai_vid=${id}` })
  return storageRouter.createCaller({
    req: new Request('http://test/', { headers }),
    resHeaders: new Headers(),
    clientIp: '203.0.113.11',
    visitorIdentity: createVisitorResolver(headers, new Headers()),
  })
}
const anonCaller = visitorCaller()

let seq = 0
async function addFile(size = 1024): Promise<string> {
  const key = `key-${++seq}`
  await getDb().insert(files).values({ key, ownerId: user.id, name: `mopai/${key}.png`, size, visitor: null })
  return key
}

/** An anonymous upload, owned by the browser that sent `VISITOR_ID`. */
async function addAnonFile(size = 1024, visitor = VISITOR_ID): Promise<string> {
  const key = `anon-${++seq}`
  await getDb()
    .insert(files)
    .values({ key, ownerId: ANON_OWNER_ID, name: `mopai/v/${key}.png`, size, visitor: visitorKey(visitor) })
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

  it('keeps an image the browser still references, and never asks the worker to delete it', async () => {
    // The check that matters is not just "the ledger row survives": the object
    // must not receive a DELETE at all, or a worker that deletes anyway would
    // leave a row pointing at nothing.
    const kept = await addFile(1111)
    const free = await addFile(2222)
    const calls = mockWorker(ok)

    const res = await caller.removeOrphans({ keys: [kept, free], alsoKeep: [kept] })
    expect(res).toEqual({ deleted: 1, freedBytes: 2222, skipped: [kept], failed: [] })
    expect(calls).toEqual([free])
    expect(await rowExists(kept)).toBe(true)
    expect(await rowExists(free)).toBe(false)
  })

  it('combines the local keep-list with the cloud article references', async () => {
    const cloud = await addFile(10)
    const local = await addFile(20)
    const free = await addFile(30)
    await getDb()
      .insert(docs)
      .values({
        id: 'doc-keep',
        ownerId: user.id,
        name: '稿件',
        content: `![配图](img:${cloud})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    const calls = mockWorker(ok)

    const res = await caller.removeOrphans({ keys: [cloud, local, free], alsoKeep: [local] })
    expect(res.skipped.sort()).toEqual([cloud, local].sort())
    expect(res.deleted).toBe(1)
    expect(res.freedBytes).toBe(30)
    expect(calls).toEqual([free])
    expect(await rowExists(cloud)).toBe(true)
    expect(await rowExists(local)).toBe(true)
  })

  it('treats a keep key that is not in the ledger as harmless', async () => {
    // A stale local index can name an image that was already deleted. It must
    // neither block the batch nor count as a skip.
    const mine = await addFile(64)
    const calls = mockWorker(ok)

    const res = await caller.removeOrphans({ keys: [mine], alsoKeep: ['never-uploaded'] })
    expect(res).toEqual({ deleted: 1, freedBytes: 64, skipped: [], failed: [] })
    expect(calls).toEqual([mine])
  })

  it('will not delete an image another account owns, keep-list or not', async () => {
    const foreign = `foreign-${++seq}`
    await getDb().insert(files).values({ key: foreign, ownerId: 99, name: 'x', size: 10, visitor: null })
    const calls = mockWorker(ok)

    const res = await caller.removeOrphans({ keys: [foreign], alsoKeep: [foreign] })
    expect(res).toEqual({ deleted: 0, freedBytes: 0, skipped: [], failed: [] })
    expect(calls).toEqual([])
    expect(await rowExists(foreign)).toBe(true)
  })

  it('applies the keep-list to anonymous uploads and stays inside one visitor', async () => {
    const kept = await addAnonFile(100)
    const free = await addAnonFile(200)
    const anotherBrowsers = await addAnonFile(300, 'd'.repeat(32))
    const calls = mockWorker(ok)

    const res = await anonCaller.removeOrphans({ keys: [kept, free, anotherBrowsers], alsoKeep: [kept] })
    expect(res.skipped).toEqual([kept])
    expect(res.deleted).toBe(1)
    expect(res.freedBytes).toBe(200)
    expect(calls).toEqual([free])
    expect(await rowExists(kept)).toBe(true)
    expect(await rowExists(anotherBrowsers)).toBe(true)
    // Another browser cannot reach the same images, even by guessing keys.
    const other = visitorCaller('e'.repeat(32))
    const denied = await other.removeOrphans({ keys: [kept], alsoKeep: [] })
    expect(denied.deleted).toBe(0)
    expect(await rowExists(kept)).toBe(true)
  })

  it('answers an empty request without calling the worker', async () => {
    const calls = mockWorker(ok)
    expect(await caller.removeOrphans({ keys: [] })).toMatchObject({ deleted: 0, failed: [] })
    expect(calls).toEqual([])
  })
})
