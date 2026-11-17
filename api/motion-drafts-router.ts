import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { HttpBindings } from '@hono/node-server'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from './queries/connection'
import { motionDrafts } from '../db/schema'
import { authenticateRequest } from './session'

/**
 * Owner-only cloud drafts for the motion composer (the page served at /motion/).
 *
 * Same session as the cloud drafts box (api/docs-router.ts): everything but
 * `/session` answers 401 without one, and never shows or touches a row. A draft
 * is the composer's own JSON, kept as text. The server checks that it parses,
 * that it carries the composer's format tag and how many scenes it holds, and
 * enforces size / count / total limits; what the scenes mean is the composer's
 * business, and the composer normalizes a draft again when it opens one.
 */

export interface MotionDraftLimits {
  /** One draft's JSON, in UTF-8 bytes. */
  bodyBytes: number
  /** Drafts per owner. */
  count: number
  /** All drafts for one owner. */
  totalBytes: number
}

export const MOTION_DRAFT_LIMITS: MotionDraftLimits = {
  bodyBytes: 8 * 1024 * 1024,
  count: 50,
  totalBytes: 100 * 1024 * 1024,
}

/** The tag the composer writes into every file and cloud draft it saves. */
export const MOTION_DRAFT_FORMAT = 'reed-motion-draft'

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NAME_MAX = 80

export interface MotionDraftMeta {
  id: string
  name: string
  scenes: number
  size: number
  updatedAt: number
}

export interface MotionDraftDeps {
  limits?: Partial<MotionDraftLimits>
}

type Ctx = Context<{ Bindings: HttpBindings }>

/** The scene count of a composer draft, or null when the text is not one. */
function sceneCount(body: string): number | null {
  try {
    const draft = JSON.parse(body) as { format?: unknown; doc?: { scenes?: unknown } } | null
    if (!draft || draft.format !== MOTION_DRAFT_FORMAT) return null
    const scenes = draft.doc?.scenes
    return Array.isArray(scenes) && scenes.length > 0 ? scenes.length : null
  } catch {
    return null
  }
}

export function createMotionDraftsRouter(deps: MotionDraftDeps = {}) {
  const limits = { ...MOTION_DRAFT_LIMITS, ...deps.limits }
  const router = new Hono<{ Bindings: HttpBindings }>()

  // A draft arrives as a string inside a JSON request, so its quotes are
  // escaped on the wire: allow for that here and measure the draft itself below.
  const requestLimit = bodyLimit({
    maxSize: limits.bodyBytes * 2 + 4096,
    onError: (c) => c.json({ error: 'draft_too_large' }, 413),
  })

  // Every answer is the owner's data or says whether she is signed in.
  router.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  async function requireOwner(c: Ctx) {
    const user = await authenticateRequest(c.req.raw.headers)
    if (!user) {
      return { user: null, response: c.json({ error: 'unauthorized' }, 401) } as const
    }
    return { user, response: null } as const
  }

  /** The `{ name, body }` of a save, or the response that turns it away. */
  async function readDraft(c: Ctx) {
    if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return { draft: null, response: c.json({ error: 'invalid_draft' }, 400) } as const
    }
    const input = (await c.req.json().catch(() => null)) as { name?: unknown; body?: unknown } | null
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > NAME_MAX) return { draft: null, response: c.json({ error: 'invalid_name' }, 400) } as const
    if (typeof input?.body !== 'string') return { draft: null, response: c.json({ error: 'invalid_draft' }, 400) } as const
    const size = Buffer.byteLength(input.body, 'utf8')
    if (size > limits.bodyBytes) return { draft: null, response: c.json({ error: 'draft_too_large' }, 413) } as const
    const scenes = sceneCount(input.body)
    if (scenes === null) return { draft: null, response: c.json({ error: 'invalid_draft' }, 400) } as const
    return { draft: { name, body: input.body, size, scenes }, response: null } as const
  }

  /** Whether the visitor is the signed-in owner. Open to everyone: the composer asks before it shows the cloud drafts. */
  router.get('/session', async (c) => {
    const user = await authenticateRequest(c.req.raw.headers)
    return c.json({ owner: Boolean(user) })
  })

  router.get('/', async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const items: MotionDraftMeta[] = await getDb()
      .select({
        id: motionDrafts.id,
        name: motionDrafts.name,
        scenes: motionDrafts.scenes,
        size: motionDrafts.size,
        updatedAt: motionDrafts.updatedAt,
      })
      .from(motionDrafts)
      .where(eq(motionDrafts.ownerId, owner.user.id))
      .orderBy(desc(motionDrafts.updatedAt))
    return c.json({ items })
  })

  router.post('/', requestLimit, async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const read = await readDraft(c)
    if (!read.draft) return read.response

    const existing = await getDb()
      .select({ size: motionDrafts.size })
      .from(motionDrafts)
      .where(eq(motionDrafts.ownerId, owner.user.id))
    if (existing.length >= limits.count) {
      return c.json({ error: 'too_many_drafts', limit: limits.count }, 409)
    }
    if (existing.reduce((sum, row) => sum + row.size, read.draft.size) > limits.totalBytes) {
      return c.json({ error: 'quota_exceeded', limitBytes: limits.totalBytes }, 409)
    }

    const meta: MotionDraftMeta = {
      id: randomUUID(),
      name: read.draft.name,
      scenes: read.draft.scenes,
      size: read.draft.size,
      updatedAt: Date.now(),
    }
    await getDb().insert(motionDrafts).values({ ...meta, ownerId: owner.user.id, body: read.draft.body })
    return c.json(meta)
  })

  router.get('/:id', async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
    const rows = await getDb()
      .select({
        id: motionDrafts.id,
        name: motionDrafts.name,
        scenes: motionDrafts.scenes,
        size: motionDrafts.size,
        updatedAt: motionDrafts.updatedAt,
        body: motionDrafts.body,
      })
      .from(motionDrafts)
      .where(and(eq(motionDrafts.id, id), eq(motionDrafts.ownerId, owner.user.id)))
      .limit(1)
    const row = rows.at(0)
    return row ? c.json(row) : c.json({ error: 'not_found' }, 404)
  })

  /** Saves over one draft: the owner picked that row and confirmed, so the newest save wins. */
  router.put('/:id', requestLimit, async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
    const read = await readDraft(c)
    if (!read.draft) return read.response

    const existing = await getDb()
      .select({ id: motionDrafts.id, size: motionDrafts.size })
      .from(motionDrafts)
      .where(eq(motionDrafts.ownerId, owner.user.id))
    if (!existing.some((row) => row.id === id)) return c.json({ error: 'not_found' }, 404)
    const total = existing.reduce((sum, row) => sum + (row.id === id ? 0 : row.size), read.draft.size)
    if (total > limits.totalBytes) {
      return c.json({ error: 'quota_exceeded', limitBytes: limits.totalBytes }, 409)
    }

    const meta: MotionDraftMeta = {
      id,
      name: read.draft.name,
      scenes: read.draft.scenes,
      size: read.draft.size,
      updatedAt: Date.now(),
    }
    await getDb()
      .update(motionDrafts)
      .set({ name: meta.name, scenes: meta.scenes, size: meta.size, updatedAt: meta.updatedAt, body: read.draft.body })
      .where(and(eq(motionDrafts.id, id), eq(motionDrafts.ownerId, owner.user.id)))
    return c.json(meta)
  })

  router.delete('/:id', async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
    const mine = and(eq(motionDrafts.id, id), eq(motionDrafts.ownerId, owner.user.id))
    const rows = await getDb().select({ id: motionDrafts.id }).from(motionDrafts).where(mine).limit(1)
    if (!rows.at(0)) return c.json({ error: 'not_found' }, 404)
    await getDb().delete(motionDrafts).where(mine)
    return c.json({ ok: true })
  })

  return router
}

export const motionDraftsRouter = createMotionDraftsRouter()
