import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpBindings } from '@hono/node-server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * R07 — one first-contact visitor per HTTP request, not one per procedure.
 *
 * tRPC batches the procedures of `?batch=1` into a single HTTP request with a
 * single cookie. Before the fix each batched upload re-read the cookie-less
 * request, minted its own visitor id and appended its own Set-Cookie; the
 * browser kept the last cookie only, so the other uploads were visible to
 * nobody. These tests drive the real Hono app (the same object boot.ts serves)
 * so the batch, the middleware and the response headers are all real; only the
 * image worker is stubbed.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-visitor-batch-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'batch.db')}`
process.env.IMG_BASE_URL = 'https://img.example.test'
process.env.IMG_ADMIN_KEY = 'test-admin-key'
process.env.ANON_DAILY_IMAGES = '10'
process.env.ANON_DAILY_BYTES = '104857600'
process.env.ANON_TOTAL_BYTES = '104857600'
process.env.ANON_BURST_PER_MINUTE = '1000'
process.env.ANON_IP_DAILY_IMAGES = '1000'
process.env.ANON_GC_ENABLED = 'false'

const { default: app } = await import('./boot')
const { env } = await import('./lib/env')
const { getSqlite } = await import('./queries/connection')

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64').byteLength
const NODE_ENV = {
  incoming: { socket: { remoteAddress: '127.0.0.1' } },
} as unknown as HttpBindings

const DEFAULTS = {
  anonDailyImages: 10,
  anonDailyBytes: 104857600,
  anonTotalBytes: 104857600,
  anonBurstPerMinute: 1000,
  anonIpDailyImages: 1000,
}

const VISITOR_COOKIE = /mopai_vid=([0-9a-f]{32})/

/** A POST that matches what httpBatchLink puts on the wire for N mutations. */
function batchedUpload(count: number, cookie?: string) {
  const input = { name: 'first-visit.png', contentBase64: PNG_BASE64, contentType: 'image/png' }
  const body: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) body[String(i)] = { json: input }
  const paths = Array.from({ length: count }, () => 'storage.upload').join(',')
  return app.request(`/api/trpc/${paths}?batch=1`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      // Loopback Host, so the cookie is the plain-HTTP shape the local suite sees.
      host: '127.0.0.1:4107',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }, NODE_ENV)
}

function list(cookie?: string) {
  return app.request('/api/trpc/storage.list', {
    headers: {
      'cf-connecting-ip': '203.0.113.7',
      host: '127.0.0.1:4107',
      ...(cookie ? { cookie } : {}),
    },
  }, NODE_ENV)
}

async function listKeys(cookie?: string): Promise<string[]> {
  const res = await list(cookie)
  const body = (await res.json()) as {
    result?: { data?: { json?: { key: string }[] } }
    error?: { json?: { data?: { code?: string } } }
  }
  return (body.result?.data?.json ?? []).map((row) => row.key)
}

type BatchBody = {
  result?: { data?: { json?: { key: string } } }
  error?: { json?: { data?: { code?: string } } }
}[]

async function batchResults(count: number, cookie?: string): Promise<{
  res: Response
  setCookies: string[]
  ids: string[]
  body: BatchBody
}> {
  const res = await batchedUpload(count, cookie)
  const body = (await res.json()) as BatchBody
  const setCookies = res.headers.getSetCookie()
  const ids = setCookies.map((c) => (c.match(VISITOR_COOKIE) || [])[1]).filter(Boolean)
  return { res, setCookies, ids, body }
}

function fileRows() {
  return getSqlite()
    .prepare('SELECT key, ownerId, visitor FROM files ORDER BY key')
    .all() as { key: string; ownerId: number; visitor: string | null }[]
}

function resetDb() {
  getSqlite().exec('DELETE FROM files; DELETE FROM anon_upload_reservations;')
}

beforeEach(() => {
  Object.assign(env, DEFAULTS)
  resetDb()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const key = new URL(String(input)).searchParams.get('key') ?? ''
      return new Response(JSON.stringify({ key, size: PNG_BYTES }), { status: 200 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // The open SQLite handle blocks unlink on Windows; a leftover temp file is fine.
  }
})

describe('first-contact visitor identity across a tRPC batch', () => {
  it('uploads the whole batch under one minted visitor and one Set-Cookie', async () => {
    const { res, setCookies, ids, body } = await batchResults(3)

    expect(res.status).toBe(200)
    expect(body.filter((entry) => entry.result).length).toBe(3)
    expect(setCookies).toHaveLength(1)
    expect(ids).toHaveLength(1)

    // The uploads all landed under that one identity, so the cookie the browser
    // actually keeps can list every one of them.
    expect(await listKeys(`mopai_vid=${ids[0]}`)).toHaveLength(3)
    const rows = fileRows()
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.ownerId === 0 && typeof row.visitor === 'string')).toBe(true)
    expect(new Set(rows.map((row) => row.visitor)).size).toBe(1)

    // Cookie attributes stay the anonymous visitor's: one year, first-party,
    // HttpOnly, Lax, no Secure on plain HTTP.
    expect(setCookies[0]).toContain('Max-Age=31536000')
    expect(setCookies[0]).toContain('Path=/')
    expect(setCookies[0]).toContain('HttpOnly')
    expect(setCookies[0]).toContain('SameSite=Lax')
    expect(setCookies[0]).not.toContain('Secure')
    expect(setCookies[0]).not.toContain('Domain=')
  })

  it('keeps an existing cookie through a later batch without replacing it', async () => {
    const first = await batchResults(1)
    const cookie = `mopai_vid=${first.ids[0]}`

    const second = await batchResults(3, cookie)
    expect(second.res.status).toBe(200)
    expect(second.setCookies).toHaveLength(0)
    expect(second.ids).toHaveLength(0)
    expect(await listKeys(cookie)).toHaveLength(4)
  })

  it('charges the whole batch to one visitor so it cannot split past the quota', async () => {
    Object.assign(env, { anonDailyImages: 2 })

    const { res, setCookies, ids, body } = await batchResults(3)

    // A batch with one failed procedure answers 207; the two uploads that did
    // fit share the batch's single identity.
    expect(res.status).toBe(207)
    expect(body.filter((entry) => entry.result).length).toBe(2)
    expect(body.filter((entry) => entry.error?.json?.data?.code === 'TOO_MANY_REQUESTS')).toHaveLength(1)
    expect(setCookies).toHaveLength(1)
    expect(await listKeys(`mopai_vid=${ids[0]}`)).toHaveLength(2)
    expect(fileRows()).toHaveLength(2)
    expect(new Set(fileRows().map((row) => row.visitor)).size).toBe(1)
  })

  it('never lets one visitor list or delete another visitor’s picture', async () => {
    const owner = await batchResults(1)
    const ownerCookie = `mopai_vid=${owner.ids[0]}`
    const [key] = await listKeys(ownerCookie)

    const intruder = await batchResults(1)
    const intruderCookie = `mopai_vid=${intruder.ids[0]}`
    expect(intruder.ids[0]).not.toBe(owner.ids[0])
    const intruderKeys = await listKeys(intruderCookie)
    expect(intruderKeys).toHaveLength(1)
    expect(intruderKeys).not.toContain(key)

    const removed = await app.request('/api/trpc/storage.remove', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: '127.0.0.1:4107',
        cookie: intruderCookie,
      },
      body: JSON.stringify({ json: { key } }),
    }, NODE_ENV)
    expect(removed.status).toBe(403)
    expect(await listKeys(intruderCookie)).toHaveLength(1)
    expect(await listKeys(ownerCookie)).toHaveLength(1)
  })

  it('does not let forged forwarding headers split a direct upload bucket', async () => {
    Object.assign(env, { anonBurstPerMinute: 1 })
    const body = {
      json: { name: 'direct.png', contentBase64: PNG_BASE64, contentType: 'image/png' },
    }
    const request = (ip: string) => app.request('/api/trpc/storage.upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': ip,
        host: '127.0.0.1:4107',
      },
      body: JSON.stringify(body),
    }, {
      incoming: { socket: { remoteAddress: '198.51.100.201' } },
    } as unknown as HttpBindings)

    expect((await request('203.0.113.41')).status).toBe(200)
    expect((await request('203.0.113.42')).status).toBe(429)
  })
})
