/**
 * anon-upload.ts — the atomic half of the anonymous upload budget.
 *
 * `anon-quota.ts` answers "would this fit?" against the ledger, but a check and
 * the upload that follows are separated by a network await. Eight concurrent
 * requests all read the same empty ledger and all pass, which is exactly how the
 * anonymous ceilings used to be bypassed. This module turns the check into a
 * claim on the budget:
 *
 *   1. reserve — one synchronous SQLite transaction reads the ledger plus the
 *                live reservations, applies the same ceilings, and writes the
 *                reservation row. `BEGIN IMMEDIATE` serialises writers, so two
 *                service processes sharing the database also see each other's
 *                claims.
 *   2. upload  — the network call; no transaction is held across it.
 *   3. settle  — one more transaction: ledger row in, reservation out.
 *
 * Failures never strand budget. The object key is minted *before* the upload and
 * stored on the reservation, so a process that dies mid-request leaves a row
 * naming the object a sweep must delete. Any handled failure flips the row to
 * `cleanup` in one local statement — the quota is free again immediately, and the
 * key stays on record. A `cleanup` row is deleted (and its object removed) only
 * after `CLEANUP_GRACE_MS`, which is longer than any worker request can still be
 * running: a delete that raced an in-flight PUT can never be the last word, so
 * the object cannot be stored after its record is gone.
 */
import { randomUUID } from 'node:crypto'
import { getSqlite } from '../queries/connection'
import { ANON_OWNER_ID, ANON_WINDOW_MS, checkAnonQuota, type AnonUsage } from './anon-quota'
import { storage, type UploadedFile } from './storage'

/**
 * How long an in-flight upload may hold its claim. Three times the worker
 * request timeout in storage.ts (30 s): long enough that a live upload is never
 * mistaken for an abandoned one, short enough that a crashed process gives the
 * budget back within a minute and a half. The boot and periodic sweeps only
 * reclaim rows past this point, so they cannot touch a sibling process's live
 * upload when two services share the database.
 */
export const RESERVATION_TTL_MS = 90 * 1000

/**
 * How long a released claim waits before its object is deleted for good. The
 * worker may still be finishing a write that our aborted request gave up on;
 * deleting once immediately could be followed by that write, leaving an object
 * with no row. Waiting past any possible in-flight write, then deleting, makes
 * the last delete the final word.
 */
export const CLEANUP_GRACE_MS = 2 * 60 * 1000

/** Rows per sweep: one sweep never walks an unbounded backlog. */
const SWEEP_BATCH = 50

type ReservationState = 'pending' | 'cleanup'

interface ReservationRow {
  token: string
  visitor: string
  objectKey: string
  bytes: number
  state: ReservationState
  createdAt: number
  expiresAt: number
}

export type ReserveResult = { ok: true; token: string } | { ok: false; message: string }

export interface SweepResult {
  /** Expired in-flight claims moved to `cleanup`; their quota is free again. */
  requeued: number
  /** `cleanup` rows whose object was confirmed gone and whose row was dropped. */
  dropped: number
  /** Due rows kept because the worker did not confirm the delete. */
  failed: number
}

/**
 * The single connection is synchronous, so a block that never awaits is atomic
 * with respect to other requests in this process. Across processes the
 * `BEGIN IMMEDIATE` lock is what does the work; `busy_timeout` in connection.ts
 * makes a second process wait for the lock instead of failing with SQLITE_BUSY.
 */
function transaction<T>(action: () => T): T {
  const db = getSqlite()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Usage as the reservation transaction sees it: settled ledger rows plus every
 * pending claim, so an upload that has been reserved but not yet recorded still
 * occupies its budget.
 *
 * `files.createdAt` is unix **seconds** (the column is `mode: 'timestamp'`);
 * reservation timestamps are milliseconds, like the Remote MCP leases. The two
 * cut-offs are computed separately on purpose — comparing one against the other
 * would make either every row or no row fall inside the window.
 */
function readUsage(visitor: string, now: number): AnonUsage {
  const sinceSeconds = Math.floor((now - ANON_WINDOW_MS) / 1000)
  const sinceMs = now - ANON_WINDOW_MS
  const row = getSqlite()
    .prepare(
      `SELECT
         (SELECT count(*) FROM files
            WHERE ownerId = ? AND visitor = ? AND createdAt >= ?) AS windowCount,
         (SELECT coalesce(sum(size), 0) FROM files
            WHERE ownerId = ? AND visitor = ? AND createdAt >= ?) AS windowBytes,
         (SELECT coalesce(sum(size), 0) FROM files
            WHERE ownerId = ?) AS totalBytes,
         (SELECT count(*) FROM anon_upload_reservations
            WHERE visitor = ? AND state = 'pending' AND createdAt >= ?) AS heldCount,
         (SELECT coalesce(sum(bytes), 0) FROM anon_upload_reservations
            WHERE visitor = ? AND state = 'pending' AND createdAt >= ?) AS heldBytes,
         (SELECT coalesce(sum(bytes), 0) FROM anon_upload_reservations
            WHERE state = 'pending') AS heldTotal`,
    )
    .get(
      ANON_OWNER_ID,
      visitor,
      sinceSeconds,
      ANON_OWNER_ID,
      visitor,
      sinceSeconds,
      ANON_OWNER_ID,
      visitor,
      sinceMs,
      visitor,
      sinceMs,
    ) as Record<string, number> | undefined

  return {
    windowCount: Number(row?.windowCount ?? 0) + Number(row?.heldCount ?? 0),
    windowBytes: Number(row?.windowBytes ?? 0) + Number(row?.heldBytes ?? 0),
    totalBytes: Number(row?.totalBytes ?? 0) + Number(row?.heldTotal ?? 0),
  }
}

/**
 * Claim budget for one anonymous upload. Returns the token to settle or release.
 *
 * The sweep runs first and outside the transaction: it may call the image worker
 * (network), and a SQLite write lock must never be held across that.
 */
export async function reserveAnonUpload(
  visitor: string,
  bytes: number,
  objectKey: string,
): Promise<ReserveResult> {
  await sweepAbandonedUploads()

  const now = Date.now()
  const token = randomUUID()
  return transaction(() => {
    const verdict = checkAnonQuota(readUsage(visitor, now), bytes)
    if (!verdict.ok) return { ok: false, message: verdict.message ?? '上传额度用完了' }
    getSqlite()
      .prepare(
        `INSERT INTO anon_upload_reservations
           (token, visitor, objectKey, bytes, state, createdAt, expiresAt)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(token, visitor, objectKey, bytes, now, now + RESERVATION_TTL_MS)
    return { ok: true, token }
  })
}

/**
 * Turn a confirmed upload into a ledger row and drop its claim, in one
 * transaction. If the insert fails the claim survives, and the caller's release
 * path keeps the key for cleanup — the alternative (ledger row without a claim,
 * or claim without a row) is what used to leak budget or objects.
 */
export function settleAnonUpload(token: string, visitor: string, saved: UploadedFile): void {
  transaction(() => {
    const row = getSqlite()
      .prepare(
        `SELECT visitor, objectKey, state FROM anon_upload_reservations WHERE token = ?`,
      )
      .get(token) as Pick<ReservationRow, 'visitor' | 'objectKey' | 'state'> | undefined
    if (!row || row.state !== 'pending' || row.visitor !== visitor || row.objectKey !== saved.key) {
      throw new Error('anonymous upload reservation is gone')
    }
    getSqlite().prepare('DELETE FROM anon_upload_reservations WHERE token = ?').run(token)
    getSqlite()
      .prepare(
        `INSERT INTO files (key, ownerId, visitor, name, size, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saved.key,
        ANON_OWNER_ID,
        visitor,
        saved.fileName,
        saved.size,
        Math.floor(Date.now() / 1000),
      )
  })
}

/**
 * Release a claim after a failed upload, a failed settle, or a cancelled
 * request. This is a local state change only: the quota is free the moment the
 * row is `cleanup` again, and the object (which may or may not exist) is removed
 * by a later sweep. `objectMayExist: false` is for failures that happen before
 * anything could reach the worker — there is no object, so the row can go.
 */
export async function releaseAnonUpload(input: {
  token: string
  objectKey: string
  objectMayExist?: boolean
}): Promise<void> {
  const { token, objectKey, objectMayExist = true } = input
  try {
    if (!objectMayExist) {
      getSqlite().prepare('DELETE FROM anon_upload_reservations WHERE token = ?').run(token)
      return
    }
    const now = Date.now()
    getSqlite()
      .prepare(
        `UPDATE anon_upload_reservations
            SET state = 'cleanup',
                expiresAt = CASE WHEN state = 'cleanup' THEN expiresAt ELSE ? END
          WHERE token = ?`,
      )
      .run(now + CLEANUP_GRACE_MS, token)
  } catch (error) {
    // Never mask the upload failure the caller is about to report. The row (and
    // its objectKey) remains, so the next sweep can still finish the job.
    console.warn(`[anon-upload] release-failed key=${objectKey} reason=${reasonOf(error)}`)
  }
}

/**
 * Reclaim what dead requests and dead processes left behind:
 *
 *   1. every expired `pending` claim becomes `cleanup` — that alone releases the
 *      quota, so a restart never keeps budget held;
 *   2. every `cleanup` row past its grace period has its object deleted; only a
 *      confirmed delete removes the row, so a key can never be forgotten.
 *
 * Both steps are outside any transaction except their own single statement.
 */
export async function sweepAbandonedUploads(now = Date.now()): Promise<SweepResult> {
  const requeued = Number(
    getSqlite()
      .prepare(
        `UPDATE anon_upload_reservations
            SET state = 'cleanup', expiresAt = ?
          WHERE state = 'pending' AND expiresAt <= ?`,
      )
      .run(now + CLEANUP_GRACE_MS, now).changes,
  )

  const rows = getSqlite()
    .prepare(
      `SELECT token, objectKey FROM anon_upload_reservations
        WHERE state = 'cleanup' AND expiresAt <= ?
        ORDER BY expiresAt ASC
        LIMIT ?`,
    )
    .all(now, SWEEP_BATCH) as { token: string; objectKey: string }[]

  let dropped = 0
  let failed = 0
  for (const row of rows) {
    const result = await storage.deleteFile({ fileKey: row.objectKey })
    if (!result.gone) {
      failed += 1
      console.warn(
        `[anon-upload] sweep-failed key=${row.objectKey} reason=${result.reason} status=${result.status ?? '-'}`,
      )
      continue
    }
    // Re-check the predicate: the row may have been settled/released while the
    // delete was in flight. A `pending` row is never dropped here.
    const removed = getSqlite()
      .prepare(
        `DELETE FROM anon_upload_reservations
          WHERE token = ? AND state = 'cleanup' AND expiresAt <= ?`,
      )
      .run(row.token, now)
    if (Number(removed.changes) > 0) dropped += 1
  }

  if (requeued > 0 || rows.length > 0) {
    console.warn(`[anon-upload] sweep requeued=${requeued} dropped=${dropped} failed=${failed}`)
  }
  return { requeued, dropped, failed }
}

/** Boot hook: reclaim what the previous process left behind, then keep watching. */
export function startAnonUploadRecovery(): void {
  const run = () => {
    sweepAbandonedUploads().catch((error: unknown) =>
      console.warn(`[anon-upload] sweep-failed reason=${reasonOf(error)}`),
    )
  }
  run()
  setInterval(run, 60_000).unref()
}

function reasonOf(error: unknown): string {
  const err = error as { code?: string; message?: string }
  return (err?.code || err?.message || String(error)).replace(/\s+/g, ' ').slice(0, 160)
}
