import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Every module here reads its environment once, when it loads, so the
// database path and the quotas have to be in place before the imports.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-anon-upload-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'upload.db')}`
process.env.IMG_BASE_URL = 'https://img.example.test'
process.env.IMG_ADMIN_KEY = 'test-admin-key'
process.env.ANON_DAILY_IMAGES = '2'
process.env.ANON_DAILY_BYTES = '104857600'
process.env.ANON_TOTAL_BYTES = '104857600'
process.env.ANON_BURST_PER_MINUTE = '1000'
process.env.ANON_IP_DAILY_IMAGES = '1000'

const {
  reserveAnonUpload,
  settleAnonUpload,
  releaseAnonUpload,
  sweepAbandonedUploads,
  CLEANUP_GRACE_MS,
} = await import('./anon-upload')
const { env } = await import('./env')
const { getSqlite } = await import('../queries/connection')

const DEFAULTS = {
  anonDailyImages: 2,
  anonDailyBytes: 104857600,
  anonTotalBytes: 104857600,
}

function setLimits(patch: Partial<typeof DEFAULTS>) {
  Object.assign(env, patch)
}

function resetRows() {
  getSqlite().exec('DELETE FROM files; DELETE FROM anon_upload_reservations;')
}

function countReservations(where = '1 = 1', ...params: (string | number)[]) {
  const row = getSqlite()
    .prepare(`SELECT count(*) AS n FROM anon_upload_reservations WHERE ${where}`)
    .get(...params) as { n: number }
  return Number(row.n)
}

function countFiles() {
  const row = getSqlite().prepare('SELECT count(*) AS n FROM files').get() as { n: number }
  return Number(row.n)
}

function insertExpiredReservation(objectKey: string, visitor = 'visitor-a', now = Date.now()) {
  getSqlite()
    .prepare(
      `INSERT INTO anon_upload_reservations
         (token, visitor, objectKey, bytes, state, createdAt, expiresAt)
       VALUES (?, ?, ?, 100, 'pending', ?, ?)`,
    )
    .run(`token-${objectKey}`, visitor, objectKey, now - 60_000, now - 1)
}

/** Remove a claim a test only created to prove that quota was available. */
function dropReservation(token: string) {
  getSqlite().prepare('DELETE FROM anon_upload_reservations WHERE token = ?').run(token)
}

/** The worker is stubbed; every DELETE answer is decided per test. */
function mockWorker(deleteStatus = 200) {
  const calls: { method: string; key: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ method: String(init?.method), key: url.searchParams.get('key') ?? '' })
      return new Response('{"deleted":true}', { status: deleteStatus })
    }),
  )
  return calls
}

beforeEach(() => {
  Object.assign(env, DEFAULTS)
  resetRows()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  // The connection stays open for the process lifetime; Windows will not unlink
  // an open file, so a leftover temp file is not a test failure.
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('reserving the anonymous budget', () => {
  it('never hands out more than the daily image count, even when eight claims race', async () => {
    mockWorker()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => reserveAnonUpload('visitor-a', 10, `key-${i}`)),
    )

    const granted = results.filter((r) => r.ok)
    const denied = results.filter((r) => !r.ok)
    expect(granted).toHaveLength(2)
    expect(denied).toHaveLength(6)
    expect(denied.every((r) => !r.ok && r.message.includes('2 张'))).toBe(true)
    expect(countReservations()).toBe(2)
    expect(countFiles()).toBe(0)
  })

  it('counts the visitor byte allowance against live claims', async () => {
    setLimits({ anonDailyImages: 100, anonDailyBytes: 250 })
    mockWorker()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => reserveAnonUpload('visitor-b', 100, `key-${i}`)),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(2)
    const denied = results.filter((r) => !r.ok)
    expect(denied).toHaveLength(6)
    expect(denied.every((r) => !r.ok && r.message.includes('24 小时'))).toBe(true)
  })

  it('counts the global anonymous byte cap across different visitors', async () => {
    setLimits({ anonDailyImages: 100, anonDailyBytes: 10_000, anonTotalBytes: 250 })
    mockWorker()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => reserveAnonUpload(`visitor-${i}`, 100, `key-${i}`)),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(2)
    const denied = results.filter((r) => !r.ok)
    expect(denied).toHaveLength(6)
    expect(denied.every((r) => !r.ok && r.message.includes('存满'))).toBe(true)
  })

  it('counts settled rows in the same budget as live claims', async () => {
    const first = await reserveAnonUpload('visitor-c', 100, 'key-first')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    settleAnonUpload(first.token, 'visitor-c', {
      key: 'key-first',
      fileName: 'mopai/v/visitor-c/a.png',
      size: 100,
    })

    // One settled row + one live claim = the two-image allowance.
    const second = await reserveAnonUpload('visitor-c', 100, 'key-second')
    expect(second.ok).toBe(true)
    const third = await reserveAnonUpload('visitor-c', 100, 'key-third')
    expect(third.ok).toBe(false)
  })
})

describe('settling and releasing a claim', () => {
  it('turns a confirmed upload into a ledger row and drops the claim atomically', async () => {
    mockWorker()
    const claimed = await reserveAnonUpload('visitor-d', 70, 'key-settled')
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return

    settleAnonUpload(claimed.token, 'visitor-d', {
      key: 'key-settled',
      fileName: 'mopai/v/visitor-d/a.png',
      size: 70,
    })

    const row = getSqlite()
      .prepare('SELECT key, ownerId, visitor, name, size, createdAt FROM files WHERE key = ?')
      .get('key-settled') as {
      key: string
      ownerId: number
      visitor: string
      name: string
      size: number
      createdAt: number
    }
    expect(row).toMatchObject({
      key: 'key-settled',
      ownerId: 0,
      visitor: 'visitor-d',
      name: 'mopai/v/visitor-d/a.png',
      size: 70,
    })
    // files.createdAt is unix seconds, not milliseconds.
    expect(row.createdAt).toBeCloseTo(Math.floor(Date.now() / 1000), -1)
    expect(countReservations()).toBe(0)
  })

  it('refuses to settle a claim that no longer exists, without writing a ledger row', async () => {
    mockWorker()
    expect(() =>
      settleAnonUpload('missing-token', 'visitor-d', {
        key: 'key-gone',
        fileName: 'mopai/v/visitor-d/a.png',
        size: 70,
      }),
    ).toThrow(/reservation is gone/)
    expect(countFiles()).toBe(0)
  })

  it('frees the quota immediately on release and deletes the object after the grace period', async () => {
    setLimits({ anonDailyImages: 1 })
    const calls = mockWorker(200)
    const claimed = await reserveAnonUpload('visitor-e', 70, 'key-failed')
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return

    await releaseAnonUpload({ token: claimed.token, objectKey: 'key-failed' })

    // Release is local: the claim becomes cleanup, stops counting, and the
    // object is left for the sweep.
    expect(countReservations(`state = 'cleanup'`)).toBe(1)
    expect(calls).toEqual([])
    const retry = await reserveAnonUpload('visitor-e', 70, 'key-retry')
    expect(retry.ok).toBe(true)
    if (retry.ok) dropReservation(retry.token)

    // Too early: the worker may still be finishing the write we gave up on.
    const early = await sweepAbandonedUploads(Date.now() + 1000)
    expect(early).toMatchObject({ requeued: 0, dropped: 0, failed: 0 })
    expect(calls).toEqual([])

    const later = await sweepAbandonedUploads(Date.now() + CLEANUP_GRACE_MS + 1000)
    expect(later).toMatchObject({ requeued: 0, dropped: 1, failed: 0 })
    expect(calls).toEqual([{ method: 'DELETE', key: 'key-failed' }])
    expect(countReservations()).toBe(0)
  })

  it('keeps retrying a cleanup delete until the worker confirms, without holding quota', async () => {
    setLimits({ anonDailyImages: 1 })
    const calls = mockWorker(503)
    const claimed = await reserveAnonUpload('visitor-f', 70, 'key-unconfirmed')
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return

    await releaseAnonUpload({ token: claimed.token, objectKey: 'key-unconfirmed' })

    expect(countReservations(`state = 'cleanup'`)).toBe(1)
    // The quota is free even though the object may still exist.
    const retry = await reserveAnonUpload('visitor-f', 70, 'key-next')
    expect(retry.ok).toBe(true)
    if (retry.ok) dropReservation(retry.token)

    const due = Date.now() + CLEANUP_GRACE_MS + 1000
    expect(await sweepAbandonedUploads(due)).toMatchObject({ dropped: 0, failed: 1 })
    expect(calls).toEqual([{ method: 'DELETE', key: 'key-unconfirmed' }])
    expect(countReservations(`objectKey = 'key-unconfirmed'`)).toBe(1)

    mockWorker(200)
    expect(await sweepAbandonedUploads(due + 60_000)).toMatchObject({ dropped: 1, failed: 0 })
    expect(countReservations(`objectKey = 'key-unconfirmed'`)).toBe(0)
  })

  it('drops a claim without touching the worker when the upload never left the process', async () => {
    mockWorker()
    const claimed = await reserveAnonUpload('visitor-g', 70, 'key-unconfigured')
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return

    await releaseAnonUpload({ token: claimed.token, objectKey: 'key-unconfigured', objectMayExist: false })

    expect(countReservations()).toBe(0)
  })
})

describe('sweeping abandoned reservations', () => {
  it('requeues an expired claim at once (freeing quota) and deletes its object after the grace period', async () => {
    setLimits({ anonDailyImages: 1 })
    insertExpiredReservation('key-crashed')
    const calls = mockWorker(200)
    const now = Date.now()

    const first = await sweepAbandonedUploads(now)
    expect(first).toMatchObject({ requeued: 1, dropped: 0, failed: 0 })
    expect(calls).toEqual([])
    // The slot the crashed process held is usable immediately, before any
    // network cleanup has happened.
    const retry = await reserveAnonUpload('visitor-h', 70, 'key-after-restart')
    expect(retry.ok).toBe(true)
    if (retry.ok) dropReservation(retry.token)

    const second = await sweepAbandonedUploads(now + CLEANUP_GRACE_MS + 1)
    expect(second).toMatchObject({ requeued: 0, dropped: 1, failed: 0 })
    expect(calls).toEqual([{ method: 'DELETE', key: 'key-crashed' }])
  })

  it('keeps a crashed claim’s key while the worker cannot confirm the delete', async () => {
    insertExpiredReservation('key-stuck', 'visitor-i')
    const calls = mockWorker(503)
    const now = Date.now()

    expect(await sweepAbandonedUploads(now)).toMatchObject({ requeued: 1 })
    const due = now + CLEANUP_GRACE_MS + 1
    expect(await sweepAbandonedUploads(due)).toMatchObject({ dropped: 0, failed: 1 })
    expect(countReservations(`objectKey = 'key-stuck'`)).toBe(1)
    expect(calls).toEqual([{ method: 'DELETE', key: 'key-stuck' }])

    mockWorker(200)
    expect(await sweepAbandonedUploads(due + 60_000)).toMatchObject({ dropped: 1, failed: 0 })
    expect(countReservations(`objectKey = 'key-stuck'`)).toBe(0)
  })

  it('does not reap a claim that has not expired', async () => {
    mockWorker(200)
    const claimed = await reserveAnonUpload('visitor-j', 70, 'key-live')
    expect(claimed.ok).toBe(true)

    const result = await sweepAbandonedUploads()

    expect(result).toMatchObject({ requeued: 0, dropped: 0, failed: 0 })
    expect(countReservations()).toBe(1)
  })
})
