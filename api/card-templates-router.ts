import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { HttpBindings } from '@hono/node-server'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from './queries/connection'
import { cardTemplates, cardTemplateTombstones } from '../db/schema'
import { authenticateRequest } from './session'

/**
 * Owner-only cloud archive for uploaded card templates.
 *
 * Same session as the cloud drafts box (api/docs-router.ts): anonymous visitors
 * and missing sessions get 401 and never see or touch a row. The server does not
 * unpack the zip — it records metadata and enforces size / count / total limits,
 * and the browser repeats the full upload validation on download. Downloads are
 * always an attachment with `nosniff`, because an archive is data, never a page.
 */

export interface CardTemplateCloudLimits {
  /** One archive, matching CARD_TEMPLATE_LIMITS.archiveBytes. */
  fileBytes: number
  /** Archives per owner. */
  count: number
  /** All archives for one owner. */
  totalBytes: number
}

export const CARD_TEMPLATE_CLOUD_LIMITS: CardTemplateCloudLimits = {
  fileBytes: 8 * 1024 * 1024,
  count: 30,
  totalBytes: 100 * 1024 * 1024,
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION_RE = /^[0-9]+(?:\.[0-9A-Za-z-]+){0,3}$/
/** Keep enough history for a long-lived device without growing without bound. */
export const CARD_TEMPLATE_TOMBSTONE_LIMIT = 200

export interface CardTemplateCloudMeta {
  id: string
  name: string
  version: string
  sha256: string
  size: number
  uploadedAt: number
}

export interface CardTemplateCloudDeps {
  limits?: Partial<CardTemplateCloudLimits>
}

function isZip(bytes: Uint8Array): boolean {
  // Local file header, empty archive, or a spanned marker. The header is enough
  // to tell an archive from arbitrary bytes; validation stays in the browser.
  return bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
}

function clean(value: string | undefined, max: number): string | null {
  const text = (value ?? '').trim()
  return text && text.length <= max ? text : null
}

export function createCardTemplatesRouter(deps: CardTemplateCloudDeps = {}) {
  const limits = { ...CARD_TEMPLATE_CLOUD_LIMITS, ...deps.limits }
  const router = new Hono<{ Bindings: HttpBindings }>()

  /**
   * Each owner keeps only the newest tombstones. The table is owned by a single
   * account in practice, but the query stays owner-scoped so the cap cannot be
   * consumed by another account. Insert order breaks same-millisecond ties.
   */
  function pruneTombstones(ownerId: number): void {
    getSqlite().prepare(`
      DELETE FROM card_template_tombstones
      WHERE ownerId = ?
        AND id NOT IN (
          SELECT id FROM card_template_tombstones
          WHERE ownerId = ?
          ORDER BY deletedAt DESC, rowid DESC
          LIMIT ?
        )
    `).run(ownerId, ownerId, CARD_TEMPLATE_TOMBSTONE_LIMIT)
  }

  async function requireOwner(c: Context<{ Bindings: HttpBindings }>) {
    const user = await authenticateRequest(c.req.raw.headers)
    if (!user) {
      return { user: null, response: c.json({ error: 'unauthorized' }, 401) } as const
    }
    return { user, response: null } as const
  }

  router.get('/', async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    pruneTombstones(owner.user.id)
    const rows = await getDb()
      .select({
        id: cardTemplates.id,
        name: cardTemplates.name,
        version: cardTemplates.version,
        sha256: cardTemplates.sha256,
        size: cardTemplates.size,
        uploadedAt: cardTemplates.uploadedAt,
      })
      .from(cardTemplates)
      .where(eq(cardTemplates.ownerId, owner.user.id))
      .orderBy(desc(cardTemplates.uploadedAt))
    const tombstones = await getDb()
      .select({ id: cardTemplateTombstones.id, deletedAt: cardTemplateTombstones.deletedAt })
      .from(cardTemplateTombstones)
      .where(eq(cardTemplateTombstones.ownerId, owner.user.id))
      .orderBy(desc(cardTemplateTombstones.deletedAt))
    return c.json({ items: rows, tombstones })
  })

  router.post(
    '/',
    bodyLimit({
      maxSize: limits.fileBytes,
      onError: (c) => c.json({ error: 'archive_too_large' }, 413),
    }),
    async (c) => {
      const owner = await requireOwner(c)
      if (!owner.user) return owner.response

      const id = clean(c.req.query('id'), 64)
      const name = clean(c.req.query('name'), 80)
      const version = clean(c.req.query('version'), 40)
      if (!id || !ID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400)
      if (!name) return c.json({ error: 'invalid_name' }, 400)
      if (!version || !VERSION_RE.test(version)) return c.json({ error: 'invalid_version' }, 400)

      const bytes = new Uint8Array(await c.req.arrayBuffer())
      if (!bytes.byteLength) return c.json({ error: 'empty_archive' }, 400)
      if (bytes.byteLength > limits.fileBytes) return c.json({ error: 'archive_too_large' }, 413)
      if (!isZip(bytes)) return c.json({ error: 'not_zip' }, 400)

      // The table is keyed by the manifest id across the deployment. A second
      // account must not be able to overwrite the owner's row by choosing that
      // id, even though this deployment normally has one account.
      const ownerOfId = await getDb()
        .select({ ownerId: cardTemplates.ownerId })
        .from(cardTemplates)
        .where(eq(cardTemplates.id, id))
        .limit(1)
      if (ownerOfId.at(0) && ownerOfId[0].ownerId !== owner.user.id) {
        return c.json({ error: 'id_taken' }, 409)
      }

      const existing = await getDb()
        .select({ id: cardTemplates.id, ownerId: cardTemplates.ownerId, size: cardTemplates.size })
        .from(cardTemplates)
        .where(eq(cardTemplates.ownerId, owner.user.id))
      const replacing = existing.find((row) => row.id === id)
      if (!replacing && existing.length >= limits.count) {
        return c.json({ error: 'too_many_templates', limit: limits.count }, 409)
      }
      const total = existing.reduce((sum, row) => sum + (row.id === id ? 0 : row.size), bytes.byteLength)
      if (total > limits.totalBytes) {
        return c.json({ error: 'quota_exceeded', limitBytes: limits.totalBytes }, 409)
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const uploadedAt = Date.now()
      if (replacing) {
        await getDb()
          .update(cardTemplates)
          .set({ name, version, sha256, size: bytes.byteLength, uploadedAt, zip: Buffer.from(bytes) })
          .where(and(eq(cardTemplates.id, id), eq(cardTemplates.ownerId, owner.user.id)))
      } else {
        await getDb().insert(cardTemplates).values({
          id,
          ownerId: owner.user.id,
          name,
          version,
          sha256,
          size: bytes.byteLength,
          uploadedAt,
          zip: Buffer.from(bytes),
        })
      }

      // A successful upload is the user adding the template back. The tombstone
      // must go, or the device that uploaded it would delete its own copy on the
      // next sync.
      await getDb()
        .delete(cardTemplateTombstones)
        .where(and(
          eq(cardTemplateTombstones.ownerId, owner.user.id),
          eq(cardTemplateTombstones.id, id),
        ))

      const meta: CardTemplateCloudMeta = { id, name, version, sha256, size: bytes.byteLength, uploadedAt }
      return c.json(meta)
    },
  )

  router.get('/:id', async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404)
    const rows = await getDb()
      .select({ name: cardTemplates.name, version: cardTemplates.version, zip: cardTemplates.zip })
      .from(cardTemplates)
      .where(and(eq(cardTemplates.id, id), eq(cardTemplates.ownerId, owner.user.id)))
      .limit(1)
    const row = rows.at(0)
    if (!row) return c.json({ error: 'not_found' }, 404)

    const zip = row.zip
    const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
    const filename = `${id}.reedcard`
    return c.body(body, 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
  })

  router.delete('/:id', async (c) => {
    const owner = await requireOwner(c)
    if (!owner.user) return owner.response
    const id = c.req.param('id')
    if (!ID_RE.test(id)) return c.json({ ok: true, deleted: false })
    const res = (await getDb()
      .delete(cardTemplates)
      .where(and(eq(cardTemplates.id, id), eq(cardTemplates.ownerId, owner.user.id)))) as unknown as {
      rows?: { changes?: number | bigint }[]
    }
    // Record the delete even when this account has no row: it may be a stale
    // device deleting a template that another device already removed. Updating
    // an existing tombstone makes the newest delete win.
    const deletedAt = Date.now()
    await getDb()
      .insert(cardTemplateTombstones)
      .values({ ownerId: owner.user.id, id, deletedAt })
      .onConflictDoUpdate({
        target: [cardTemplateTombstones.ownerId, cardTemplateTombstones.id],
        set: { deletedAt },
      })
    pruneTombstones(owner.user.id)
    return c.json({ ok: true, deleted: Number(res?.rows?.[0]?.changes ?? 0) > 0 })
  })

  return router
}

export const cardTemplatesRouter = createCardTemplatesRouter()