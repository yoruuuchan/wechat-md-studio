/**
 * anon-gc.ts — the drain that makes the anonymous image pool circular.
 *
 * The quotas in anon-quota.ts and burst.ts bound how much a stranger can put
 * into R2, but until this module nothing ever took anything back out: an
 * anonymous image stayed until its uploader deleted it from 素材库, and most
 * uploaders never come back. The pool therefore filled exactly once, at which
 * point `ANON_TOTAL_BYTES` refused every visitor forever.
 *
 * A ledger row is reclaimed when all three hold:
 *
 *   1. it belongs to the anonymous pool (`ownerId = 0`) — the owner's own
 *      images are never touched, whatever their age;
 *   2. it is older than `ANON_GC_DAYS`;
 *   3. no cloud 稿件 references it, i.e. no `docs.content` contains `img:<key>`.
 *      Rows in the recycle bin count as references: a trashed article can be
 *      restored, and restoring it must not show broken images.
 *
 * Known hole, accepted on purpose: an anonymous visitor's article lives in
 * their own browser's localStorage, so the server cannot see it. An image that
 * only a local draft still references gets deleted once it passes the age
 * limit. That is the same trade `scripts/server-anon-purge.sh` makes —
 * anonymous images are ephemeral by design, and a full pool blocks real
 * visitors. Anything meant to last goes into the cloud drafts box behind
 * `ACCESS_KEY`, where `ownerId != 0` puts it out of reach.
 *
 * Deletion order matters: the worker confirms the object is gone *before* the
 * ledger row is dropped. The other way round leaks objects with no row left to
 * point at them, and the pool would keep counting bytes that are not there.
 */
import { and, eq } from 'drizzle-orm'
import { docs, files } from '../../db/schema'
import { getDb } from '../queries/connection'
import { ANON_OWNER_ID } from './anon-quota'
import { env } from './env'
import { storage } from './storage'

export const SECONDS_PER_DAY = 24 * 60 * 60

/** One sweep a day, matching the window the anonymous quotas are counted in. */
const GC_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * The first sweep waits a minute. `node:sqlite` behind drizzle's proxy driver is
 * *synchronous*, so reading the ledger and every cloud article blocks the event
 * loop for its duration — and boot is exactly when the tunnel health check and
 * the first visitors of the day arrive.
 */
const FIRST_SWEEP_DELAY_MS = 60 * 1000

export interface GcFileRow {
  key: string
  ownerId: number
  size: number
  /**
   * Unix **seconds**, the way the column is stored. Drizzle maps the
   * `mode: 'timestamp'` column back to a `Date`, so the caller converts —
   * comparing a `Date` (or milliseconds) against a seconds cut-off would make
   * every row look ancient and empty the pool.
   */
  createdAt: number
}

/**
 * Which keys should go. Pure so the age rule and the reference rule can be
 * tested without a database, a worker, or a bucket.
 *
 * Reference matching is a plain `img:<key>` substring search, which is
 * deliberately conservative: a key that is a prefix of a referenced key
 * (`k1` vs `img:k10`) reads as referenced and survives. Losing an image still
 * in use costs far more than keeping one that is not.
 */
export function selectGcCandidates(
  rows: readonly GcFileRow[],
  docContents: readonly string[],
  nowSeconds: number,
  days: number,
): string[] {
  const cutoff = nowSeconds - days * SECONDS_PER_DAY
  const candidates: string[] = []
  for (const row of rows) {
    if (row.ownerId !== ANON_OWNER_ID) continue
    if (row.createdAt >= cutoff) continue
    if (docContents.some((content) => content.includes(`img:${row.key}`))) continue
    candidates.push(row.key)
  }
  return candidates
}

export interface GcRunResult {
  deleted: number
  freedBytes: number
  /** Candidates whose object could not be deleted. Their rows are kept. */
  failed: number
  days: number
}

function reason(e: unknown): string {
  const err = e as { code?: string; message?: string }
  return (err?.code || err?.message || String(e)).replace(/\s+/g, ' ').slice(0, 160)
}

/**
 * One sweep. Reads the ledger and the cloud articles, then deletes the
 * candidates one object at a time — the same order `server-anon-purge.sh` uses,
 * so a sweep never hammers the worker in parallel.
 */
export async function runAnonGc(nowSeconds = Math.floor(Date.now() / 1000)): Promise<GcRunResult> {
  const days = env.anonGcDays
  if (!env.anonGcEnabled) {
    console.warn('[anon-gc] disabled by ANON_GC_ENABLED=false')
    return { deleted: 0, freedBytes: 0, failed: 0, days }
  }

  const db = getDb()
  const ledger = await db
    .select({ key: files.key, ownerId: files.ownerId, size: files.size, createdAt: files.createdAt })
    .from(files)
    .where(eq(files.ownerId, ANON_OWNER_ID))
  const rows: GcFileRow[] = ledger.map((r) => ({
    key: r.key,
    ownerId: r.ownerId,
    size: r.size,
    createdAt: Math.floor(r.createdAt.getTime() / 1000),
  }))

  // Every cloud article, whichever owner or agent wrote it and including the
  // ones in the recycle bin. Bounded by the size of `docs`: the same read
  // already happens on each `storage.orphans` call.
  const docRows = await db.select({ content: docs.content }).from(docs)
  const candidates = selectGcCandidates(
    rows,
    docRows.map((d) => d.content),
    nowSeconds,
    days,
  )

  const sizeOf = new Map(rows.map((r) => [r.key, r.size]))
  let deleted = 0
  let freedBytes = 0
  let failed = 0

  for (const key of candidates) {
    let gone = false
    try {
      gone = await storage.deleteFile({ fileKey: key })
      // `deleteFile` answers with the worker's `resp.ok`, so a refusal (bad key,
      // wrong admin key, worker down at the edge) arrives here rather than as a
      // throw. Either way the object may still be there, so the row stays.
      if (!gone) console.warn(`[anon-gc] delete-failed key=${key} reason=worker-refused`)
    } catch (e) {
      // Worker unreachable, or IMG_BASE_URL / IMG_ADMIN_KEY unset. The next
      // sweep retries.
      console.warn(`[anon-gc] delete-failed key=${key} reason=${reason(e)}`)
    }
    if (!gone) {
      failed++
      continue
    }
    // `ownerId` in the predicate as well as the key: the ledger row is only ever
    // dropped for the pool this sweep selected from, never for an owner's image.
    await db.delete(files).where(and(eq(files.key, key), eq(files.ownerId, ANON_OWNER_ID)))
    deleted++
    freedBytes += sizeOf.get(key) ?? 0
  }

  // Stable format on purpose: the morning report greps service logs for it.
  console.warn(`[anon-gc] deleted=${deleted} bytes=${freedBytes} failed=${failed} days=${days}`)
  return { deleted, freedBytes, failed, days }
}

/**
 * Wiring, called from boot.ts once the server is listening. Both handles are
 * unref'd so a sweep is never the thing keeping the process alive.
 */
export function startAnonGc(): void {
  const sweep = () => {
    runAnonGc().catch((e: unknown) => console.warn(`[anon-gc] sweep-failed reason=${reason(e)}`))
  }
  setTimeout(sweep, FIRST_SWEEP_DELAY_MS).unref()
  setInterval(sweep, GC_INTERVAL_MS).unref()
}
