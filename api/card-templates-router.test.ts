import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HttpBindings } from '@hono/node-server'

// The database path is read when the connection module loads, so set it before
// importing the router (which imports the connection).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-card-cloud-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'cards.db')}`

const { createCardTemplatesRouter } = await import('./card-templates-router')
const { signSessionToken } = await import('./session')
const { Session } = await import('../contracts/constants')

const bindings = { incoming: { socket: { remoteAddress: '127.0.0.1' } } } as unknown as HttpBindings

function archive(size = 512): Uint8Array {
  const bytes = new Uint8Array(Math.max(4, size))
  bytes.set([0x50, 0x4b, 0x03, 0x04])
  // Deliberately not a valid deflate stream: the server must not unpack it.
  for (let i = 4; i < bytes.length; i++) bytes[i] = i % 251
  return bytes
}

async function cookieFor(uid: number): Promise<string> {
  return `${Session.cookieName}=${await signSessionToken({ uid })}`
}

function request(
  router: ReturnType<typeof createCardTemplatesRouter>,
  pathname: string,
  init: RequestInit = {},
) {
  return router.request(pathname, init, bindings)
}

function upload(
  router: ReturnType<typeof createCardTemplatesRouter>,
  id: string,
  bytes = archive(),
  cookie?: string,
) {
  return request(router, `/?id=${id}&name=${encodeURIComponent('Template ' + id)}&version=1.0.0`, {
    method: 'POST',
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/zip' },
    body: bytes,
  })
}

describe('card template cloud auth', () => {
  it('answers every operation with 401 without a session', async () => {
    const router = createCardTemplatesRouter()
    expect((await request(router, '/')).status).toBe(401)
    expect((await upload(router, 'anon')).status).toBe(401)
    expect((await request(router, '/anon')).status).toBe(401)
    expect((await request(router, '/anon', { method: 'DELETE' })).status).toBe(401)
  })

  it('keeps each account’s rows private', async () => {
    const router = createCardTemplatesRouter()
    const owner = await cookieFor(1)
    const other = await cookieFor(2)
    expect((await upload(router, 'private-one', archive(), owner)).status).toBe(200)
    const taken = await upload(router, 'private-one', archive(96), other)
    expect(taken.status).toBe(409)
    expect(((await taken.json()) as { error: string }).error).toBe('id_taken')
    expect(((await (await request(router, '/', { headers: { cookie: other } })).json()) as { items: unknown[] }).items).toHaveLength(0)
    expect((await request(router, '/private-one', { headers: { cookie: other } })).status).toBe(404)
    const removed = (await (await request(router, '/private-one', { method: 'DELETE', headers: { cookie: other } })).json()) as { deleted: boolean }
    expect(removed.deleted).toBe(false)
  })
})

describe('card template cloud upload / list / download / delete', () => {
  it('stores metadata only in the list and returns the original zip as an attachment', async () => {
    const router = createCardTemplatesRouter()
    const cookie = await cookieFor(1)
    const bytes = archive(1024)
    const saved = (await (await upload(router, 'round-trip', bytes, cookie)).json()) as {
      id: string; name: string; version: string; sha256: string; size: number; uploadedAt: number
    }
    expect(saved).toMatchObject({ id: 'round-trip', name: 'Template round-trip', version: '1.0.0', size: 1024 })
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(saved.uploadedAt).toBeGreaterThan(0)

    const listed = (await (await request(router, '/', { headers: { cookie } })).json()) as {
      items: Record<string, unknown>[]
    }
    const row = listed.items.find((item) => item.id === 'round-trip')!
    expect(Object.keys(row).sort()).toEqual(['id', 'name', 'sha256', 'size', 'uploadedAt', 'version'])
    expect(row).not.toHaveProperty('zip')

    const download = await request(router, '/round-trip', { headers: { cookie } })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/octet-stream')
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="round-trip.reedcard"')
    expect(download.headers.get('x-content-type-options')).toBe('nosniff')
    expect(download.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)

    const removed = (await (await request(router, '/round-trip', { method: 'DELETE', headers: { cookie } })).json()) as { ok: boolean; deleted: boolean }
    expect(removed).toEqual({ ok: true, deleted: true })
    expect((await request(router, '/round-trip', { headers: { cookie } })).status).toBe(404)
  })

  it('rejects bytes that are not a zip by their header', async () => {
    const router = createCardTemplatesRouter()
    const cookie = await cookieFor(1)
    const res = await upload(router, 'not-zip', new TextEncoder().encode('hello world'), cookie)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('not_zip')
  })

  it('rejects a single archive past the file ceiling', async () => {
    const router = createCardTemplatesRouter({ limits: { fileBytes: 1024 } })
    const cookie = await cookieFor(1)
    const res = await upload(router, 'too-big', archive(2048), cookie)
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toBe('archive_too_large')
  })

  it('enforces the archive count and total byte quota with explicit errors', async () => {
    const countRouter = createCardTemplatesRouter({ limits: { count: 2 } })
    const countCookie = await cookieFor(100)
    expect((await upload(countRouter, 'count-a', archive(64), countCookie)).status).toBe(200)
    expect((await upload(countRouter, 'count-b', archive(64), countCookie)).status).toBe(200)
    const third = await upload(countRouter, 'count-c', archive(64), countCookie)
    expect(third.status).toBe(409)
    expect(((await third.json()) as { error: string }).error).toBe('too_many_templates')

    const totalRouter = createCardTemplatesRouter({ limits: { totalBytes: 1200 } })
    const totalCookie = await cookieFor(101)
    expect((await upload(totalRouter, 'total-a', archive(700), totalCookie)).status).toBe(200)
    const over = await upload(totalRouter, 'total-b', archive(700), totalCookie)
    expect(over.status).toBe(409)
    expect(((await over.json()) as { error: string }).error).toBe('quota_exceeded')
  })

  it('replaces an existing id without counting it twice', async () => {
    const router = createCardTemplatesRouter({ limits: { count: 2 } })
    const cookie = await cookieFor(102)
    expect((await upload(router, 'replace-me', archive(64), cookie)).status).toBe(200)
    const before = (await (await request(router, '/', { headers: { cookie } })).json()) as { items: { id: string }[] }
    const first = before.items.find((item) => item.id === 'replace-me')
    expect(first).toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await upload(router, 'replace-me', archive(96), cookie)).status).toBe(200)
    const after = (await (await request(router, '/', { headers: { cookie } })).json()) as {
      items: { id: string; size: number; uploadedAt: number }[]
    }
    const rows = after.items.filter((item) => item.id === 'replace-me')
    expect(rows).toHaveLength(1)
    expect(rows[0].size).toBe(96)
  })
})