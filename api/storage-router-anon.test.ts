import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The database path, image host and quotas are read when their modules load.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-anon-router-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'router.db')}`
process.env.IMG_BASE_URL = 'https://img.example.test'
process.env.IMG_ADMIN_KEY = 'test-admin-key'
process.env.ANON_DAILY_IMAGES = '2'
process.env.ANON_DAILY_BYTES = '104857600'
process.env.ANON_TOTAL_BYTES = '104857600'
process.env.ANON_BURST_PER_MINUTE = '1000'
process.env.ANON_IP_DAILY_IMAGES = '1000'

const { storageRouter } = await import('./storage-router')
const { createVisitorResolver } = await import('./lib/visitor')
const { getSqlite } = await import('./queries/connection')
const { env } = await import('./lib/env')

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64').byteLength

const DEFAULTS = {
  anonDailyImages: 2,
  anonDailyBytes: 104857600,
  anonTotalBytes: 104857600,
}

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

/** A visitor id of the only shape api/lib/visitor.ts accepts. */
function visitorId(tag: string) {
  return tag.padEnd(32, '0').slice(0, 32)
}

function caller(tag: string, options: { signal?: AbortSignal; owner?: boolean } = {}) {
  const req = new Request('http://test/', {
    headers: { cookie: `mopai_vid=${visitorId(tag)}` },
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const resHeaders = new Headers()
  return storageRouter.createCaller({
    req,
    resHeaders,
    visitorIdentity: createVisitorResolver(req.headers, resHeaders),
    ...(options.owner ? { user } : {}),
  })
}

const upload = (c: ReturnType<typeof caller>, name = 'audit.png') =>
  c.upload({ name, contentBase64: PNG_BASE64, contentType: 'image/png' })

type PutHandler = (key: string, init: RequestInit) => Response | Promise<Response>
type DeleteHandler = (key: string) => Response

/** The worker is stubbed; each test decides how PUT and DELETE answer. */
function mockWorker(handlers: { put?: PutHandler; del?: DeleteHandler } = {}) {
  const calls = { put: [] as string[], del: [] as string[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      const key = url.searchParams.get('key') ?? ''
      if (init?.method === 'PUT') {
        calls.put.push(key)
        return handlers.put
          ? handlers.put(key, init)
          : new Response(JSON.stringify({ key, size: PNG_BYTES }), { status: 200 })
      }
      calls.del.push(key)
      return handlers.del ? handlers.del(key) : new Response('{"deleted":true}', { status: 200 })
    }),
  )
  return calls
}

function count(sql: string) {
  const row = getSqlite().prepare(sql).get() as Record<string, number>
  return Number(Object.values(row)[0])
}

function resetDb() {
  getSqlite().exec(`
    DROP TRIGGER IF EXISTS fail_files_insert;
    DELETE FROM files;
    DELETE FROM anon_upload_reservations;
  `)
}

beforeEach(() => {
  Object.assign(env, DEFAULTS)
  resetDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // The open handle blocks unlink on Windows; a leftover temp file is fine.
  }
})

describe('anonymous upload quota through the tRPC door', () => {
  it('lets at most two of eight concurrent uploads through when the daily limit is 2', async () => {
    const calls = mockWorker()
    const c = caller('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => upload(c)))

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(2)
    expect(rejected).toHaveLength(6)
    expect(rejected.every((r) => r.reason?.code === 'TOO_MANY_REQUESTS')).toBe(true)

    expect(count('SELECT count(*) FROM files')).toBe(2)
    expect(count('SELECT count(*) FROM anon_upload_reservations')).toBe(0)
    expect(calls.put).toHaveLength(2)
    // Exactly the two stored keys, never the six that were refused.
    const keys = (getSqlite().prepare('SELECT key FROM files ORDER BY key').all() as { key: string }[]).map(
      (r) => r.key,
    )
    expect(keys.sort()).toEqual(calls.put.sort())
  })

  it('releases the claim when the worker rejects the upload', async () => {
    Object.assign(env, { anonDailyImages: 1 })
    const calls = mockWorker({
      put: () => new Response('{"error":"nope"}', { status: 500 }),
    })
    const c = caller('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')

    await expect(upload(c)).rejects.toThrow(/图床上传失败/)
    // The claim is out of the budget (cleanup does not count) and keeps the key
    // for the sweep; nothing is deleted inline.
    expect(count(`SELECT count(*) FROM anon_upload_reservations WHERE state = 'cleanup'`)).toBe(1)
    expect(count('SELECT count(*) FROM files')).toBe(0)
    expect(calls.del).toHaveLength(0)

    // The single slot is free again once the worker recovers.
    mockWorker()
    await expect(upload(c)).resolves.toMatchObject({ size: PNG_BYTES })
    expect(count('SELECT count(*) FROM files')).toBe(1)
  })

  it('releases the claim when the ledger insert fails, keeping the object key for cleanup', async () => {
    const calls = mockWorker()
    getSqlite().exec(`
      CREATE TRIGGER fail_files_insert BEFORE INSERT ON files
      BEGIN SELECT RAISE(ABORT, 'forced ledger failure'); END;
    `)
    const c = caller('cccccccccccccccccccccccccccc')

    await expect(upload(c)).rejects.toThrow(/上传失败|图床/)
    expect(count('SELECT count(*) FROM files')).toBe(0)
    expect(count(`SELECT count(*) FROM anon_upload_reservations WHERE state = 'cleanup'`)).toBe(1)
    expect(calls.put).toHaveLength(1)
    // The stored object can be named by the cleanup row; it is not an orphan
    // whose key was thrown away.
    const row = getSqlite()
      .prepare(`SELECT objectKey FROM anon_upload_reservations WHERE state = 'cleanup'`)
      .get() as { objectKey: string }
    expect(row.objectKey).toBe(calls.put[0])

    getSqlite().exec('DROP TRIGGER fail_files_insert')
    await expect(upload(c)).resolves.toMatchObject({ size: PNG_BYTES })
  })

  it('aborts the worker request and releases the claim when the caller cancels', async () => {
    const controller = new AbortController()
    mockWorker({
      put: (_key, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        }),
    })
    const c = caller('dddddddddddddddddddddddddddd', { signal: controller.signal })

    const pending = upload(c)
    setTimeout(() => controller.abort(), 30)
    await expect(pending).rejects.toThrow(/上传已取消/)

    // The quota comes back even though the client is gone.
    await vi.waitFor(() =>
      expect(count(`SELECT count(*) FROM anon_upload_reservations WHERE state = 'pending'`)).toBe(0),
    )
    expect(count(`SELECT count(*) FROM anon_upload_reservations WHERE state = 'cleanup'`)).toBe(1)

    mockWorker()
    await expect(upload(c)).resolves.toMatchObject({ size: PNG_BYTES })
  })

  it('leaves owner uploads outside the anonymous budget', async () => {
    const calls = mockWorker()
    const anon = caller('eeeeeeeeeeeeeeeeeeeeeeeeeeee')
    const owner = caller('eeeeeeeeeeeeeeeeeeeeeeeeeeee', { owner: true })
    Object.assign(env, { anonDailyImages: 0 })

    await expect(upload(anon)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    await expect(upload(owner)).resolves.toMatchObject({ size: PNG_BYTES })

    const row = getSqlite().prepare('SELECT ownerId, visitor FROM files').get() as {
      ownerId: number
      visitor: string | null
    }
    expect(row).toMatchObject({ ownerId: 1, visitor: null })
    expect(count('SELECT count(*) FROM anon_upload_reservations')).toBe(0)
    expect(calls.put).toHaveLength(1)
  })
})
