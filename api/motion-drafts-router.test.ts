import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HttpBindings } from '@hono/node-server'

// The database path is read when the connection module loads, so set it before
// importing the router (which imports the connection).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-motion-drafts-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'motion.db')}`

const { createMotionDraftsRouter, MOTION_DRAFT_FORMAT } = await import('./motion-drafts-router')
const { signSessionToken } = await import('./session')
const { Session } = await import('../contracts/constants')

type Router = ReturnType<typeof createMotionDraftsRouter>
interface Meta { id: string; name: string; scenes: number; size: number; updatedAt: number }

const bindings = { incoming: { socket: { remoteAddress: '127.0.0.1' } } } as unknown as HttpBindings

/** A composer draft with `scenes` scenes; `pad` grows it to test the size limits. */
function draft(scenes = 2, pad = ''): string {
  return JSON.stringify({
    format: MOTION_DRAFT_FORMAT,
    version: 1,
    name: 'draft',
    savedAt: '2026-11-11T00:00:00.000Z',
    doc: { scenes: Array.from({ length: scenes }, (_, i) => ({ name: `画面 ${i + 1}`, text: pad, scene: {} })), colors: [] },
  })
}

async function cookieFor(uid: number): Promise<string> {
  return `${Session.cookieName}=${await signSessionToken({ uid })}`
}

function request(router: Router, pathname: string, init: RequestInit = {}) {
  return router.request(pathname, init, bindings)
}

function save(router: Router, cookie: string | undefined, body: unknown, pathname = '/', method = 'POST') {
  return request(router, pathname, {
    method,
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function list(router: Router, cookie: string): Promise<Meta[]> {
  return ((await (await request(router, '/', { headers: { cookie } })).json()) as { items: Meta[] }).items
}

const MISSING = '00000000-0000-4000-8000-000000000000'

describe('motion drafts auth', () => {
  it('tells anyone whether they are the signed-in owner', async () => {
    const router = createMotionDraftsRouter()
    const anon = await request(router, '/session')
    expect(anon.status).toBe(200)
    expect(await anon.json()).toEqual({ owner: false })
    expect(anon.headers.get('cache-control')).toBe('no-store')
    const owner = await request(router, '/session', { headers: { cookie: await cookieFor(1) } })
    expect(await owner.json()).toEqual({ owner: true })
    const forged = await request(router, '/session', { headers: { cookie: `${Session.cookieName}=not-a-token` } })
    expect(await forged.json()).toEqual({ owner: false })
  })

  it('answers every draft operation with 401 without a session', async () => {
    const router = createMotionDraftsRouter()
    expect((await request(router, '/')).status).toBe(401)
    expect((await save(router, undefined, { name: 'a', body: draft() })).status).toBe(401)
    expect((await request(router, `/${MISSING}`)).status).toBe(401)
    expect((await save(router, undefined, { name: 'a', body: draft() }, `/${MISSING}`, 'PUT')).status).toBe(401)
    expect((await request(router, `/${MISSING}`, { method: 'DELETE' })).status).toBe(401)
  })

  it('keeps each account’s drafts private', async () => {
    const router = createMotionDraftsRouter()
    const owner = await cookieFor(11)
    const other = await cookieFor(12)
    const saved = (await (await save(router, owner, { name: 'mine', body: draft() })).json()) as Meta
    expect(await list(router, other)).toHaveLength(0)
    expect((await request(router, `/${saved.id}`, { headers: { cookie: other } })).status).toBe(404)
    expect((await save(router, other, { name: 'theirs', body: draft(1) }, `/${saved.id}`, 'PUT')).status).toBe(404)
    expect((await request(router, `/${saved.id}`, { method: 'DELETE', headers: { cookie: other } })).status).toBe(404)
    const kept = (await (await request(router, `/${saved.id}`, { headers: { cookie: owner } })).json()) as Meta
    expect(kept.name).toBe('mine')
  })
})

describe('motion drafts save / list / open / overwrite / delete', () => {
  it('round-trips a draft and lists metadata only', async () => {
    const router = createMotionDraftsRouter()
    const cookie = await cookieFor(21)
    const body = draft(3)
    const res = await save(router, cookie, { name: '  芦苇介绍  ', body })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const saved = (await res.json()) as Meta
    expect(saved).toMatchObject({ name: '芦苇介绍', scenes: 3, size: Buffer.byteLength(body, 'utf8') })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)

    const items = await list(router, cookie)
    expect(Object.keys(items[0]).sort()).toEqual(['id', 'name', 'scenes', 'size', 'updatedAt'])

    const opened = (await (await request(router, `/${saved.id}`, { headers: { cookie } })).json()) as Meta & { body: string }
    expect(opened.body).toBe(body)
  })

  it('saves over the chosen draft and keeps its id', async () => {
    const router = createMotionDraftsRouter()
    const cookie = await cookieFor(22)
    const first = (await (await save(router, cookie, { name: 'a', body: draft(1) })).json()) as Meta
    const next = draft(4)
    const over = await save(router, cookie, { name: 'a', body: next }, `/${first.id}`, 'PUT')
    expect(over.status).toBe(200)
    const meta = (await over.json()) as Meta
    expect(meta).toMatchObject({ id: first.id, scenes: 4 })
    expect(meta.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
    expect(await list(router, cookie)).toHaveLength(1)
    const opened = (await (await request(router, `/${first.id}`, { headers: { cookie } })).json()) as { body: string }
    expect(opened.body).toBe(next)
    expect((await save(router, cookie, { name: 'a', body: next }, `/${MISSING}`, 'PUT')).status).toBe(404)
  })

  it('deletes one draft and says so when it is already gone', async () => {
    const router = createMotionDraftsRouter()
    const cookie = await cookieFor(23)
    const saved = (await (await save(router, cookie, { name: 'a', body: draft() })).json()) as Meta
    const removed = await request(router, `/${saved.id}`, { method: 'DELETE', headers: { cookie } })
    expect(await removed.json()).toEqual({ ok: true })
    expect(await list(router, cookie)).toHaveLength(0)
    expect((await request(router, `/${saved.id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(404)
    expect((await request(router, '/not-an-id', { headers: { cookie } })).status).toBe(404)
  })
})

describe('motion drafts validation and limits', () => {
  it('turns away what is not a composer draft', async () => {
    const router = createMotionDraftsRouter()
    const cookie = await cookieFor(31)
    const error = async (body: unknown) => {
      const res = await save(router, cookie, body)
      return [res.status, ((await res.json()) as { error: string }).error]
    }
    expect(await error({ name: '', body: draft() })).toEqual([400, 'invalid_name'])
    expect(await error({ name: 'x'.repeat(81), body: draft() })).toEqual([400, 'invalid_name'])
    expect(await error({ name: 'a' })).toEqual([400, 'invalid_draft'])
    expect(await error({ name: 'a', body: 'not json' })).toEqual([400, 'invalid_draft'])
    expect(await error({ name: 'a', body: JSON.stringify({ doc: { scenes: [{}] } }) })).toEqual([400, 'invalid_draft'])
    expect(await error({ name: 'a', body: draft(0) })).toEqual([400, 'invalid_draft'])
    // A form post cannot set this content type, so it never reaches the parser.
    const form = await request(router, '/', {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: JSON.stringify({ name: 'a', body: draft() }),
    })
    expect(form.status).toBe(400)
    expect(await list(router, cookie)).toHaveLength(0)
  })

  it('rejects a draft past the size ceiling', async () => {
    const router = createMotionDraftsRouter({ limits: { bodyBytes: 1024 } })
    const cookie = await cookieFor(32)
    const res = await save(router, cookie, { name: 'big', body: draft(1, '字'.repeat(600)) })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toBe('draft_too_large')
  })

  it('enforces the draft count and the total quota with explicit errors', async () => {
    const countRouter = createMotionDraftsRouter({ limits: { count: 2 } })
    const countCookie = await cookieFor(33)
    const first = (await (await save(countRouter, countCookie, { name: 'a', body: draft() })).json()) as Meta
    expect((await save(countRouter, countCookie, { name: 'b', body: draft() })).status).toBe(200)
    const third = await save(countRouter, countCookie, { name: 'c', body: draft() })
    expect(third.status).toBe(409)
    expect(((await third.json()) as { error: string }).error).toBe('too_many_drafts')
    // Saving over an existing one is not a new draft.
    expect((await save(countRouter, countCookie, { name: 'a', body: draft(3) }, `/${first.id}`, 'PUT')).status).toBe(200)

    const totalRouter = createMotionDraftsRouter({ limits: { totalBytes: 1500 } })
    const totalCookie = await cookieFor(34)
    const small = (await (await save(totalRouter, totalCookie, { name: 'a', body: draft(1, 'x'.repeat(600)) })).json()) as Meta
    const over = await save(totalRouter, totalCookie, { name: 'b', body: draft(1, 'x'.repeat(800)) })
    expect(over.status).toBe(409)
    expect(((await over.json()) as { error: string }).error).toBe('quota_exceeded')
    // Its own old size does not count against a draft saved over itself.
    expect((await save(totalRouter, totalCookie, { name: 'a', body: draft(1, 'x'.repeat(1200)) }, `/${small.id}`, 'PUT')).status).toBe(200)
    const grown = await save(totalRouter, totalCookie, { name: 'a', body: draft(1, 'x'.repeat(1600)) }, `/${small.id}`, 'PUT')
    expect(grown.status).toBe(409)
  })
})
