import type { BodyRecord, BodyTransaction } from './body-store'
import type { DocRecord } from './store'

export type LocalDocRecord = DocRecord & { localRevision?: number }

export interface LocalDocChange {
  id: string
  before?: LocalDocRecord
  after?: LocalDocRecord
  /** Kept stable while the same pending edit is retried. */
  conflictId: string
}

export interface LocalCommit {
  docs: LocalDocRecord[]
  removed: string[]
  copies: { originalId: string; copyId: string }[]
  conflicted: boolean
  changedIds: string[]
}

const FIELDS = ['name', 'content', 'savedAt', 'deletedAt', 'source', 'baseHash', 'remoteMcp', 'contentLoaded', 'bodyState', 'recovery'] as const

/** A stable representation of the fields a document writer actually owns. */
export function localDocValue(doc: LocalDocRecord): DocRecord {
  const loaded = doc.contentLoaded !== false && doc.bodyState === undefined
  const recovery = doc.recovery && (doc.recovery.kind === 'conflict' || doc.recovery.kind === 'restored') &&
    Number.isFinite(doc.recovery.at) ? doc.recovery : undefined
  return {
    id: doc.id,
    name: doc.name,
    content: doc.content,
    updatedAt: doc.updatedAt,
    savedAt: doc.savedAt ?? null,
    deletedAt: doc.deletedAt ?? null,
    source: doc.source ?? null,
    baseHash: doc.baseHash ?? null,
    remoteMcp: doc.remoteMcp ?? null,
    ...(recovery ? { recovery } : {}),
    contentLoaded: loaded,
    bodyState: loaded ? undefined : (doc.bodyState ?? 'stub'),
  }
}

export function sameLocalDoc(a: LocalDocRecord, b: LocalDocRecord): boolean {
  return JSON.stringify(localDocValue(a)) === JSON.stringify(localDocValue(b))
}

/**
 * True when two records describe the same article text.
 *
 * Saved timestamps, cloud base hashes and recovery markers are bookkeeping: a
 * cloud save updates them in page state a moment before the local body row is
 * rewritten. Treating that window as a "another tab edited it" conflict made a
 * plain delete-after-save produce a `（本机版本）` copy and hand undo the copy
 * instead of the article. Only a different name or body is a competing version.
 */
export function sameArticleText(a: LocalDocRecord, b: LocalDocRecord): boolean {
  return a.name === b.name && a.content === b.content
}

/** Rebase only this page's later changes onto a completed earlier save. */
export function applyLocalDelta(base: LocalDocRecord, next: LocalDocRecord, committed: LocalDocRecord): LocalDocRecord {
  const from = localDocValue(base)
  const to = localDocValue(next)
  const out = { ...committed }
  for (const field of [...FIELDS, 'updatedAt'] as const) {
    if (JSON.stringify(from[field]) !== JSON.stringify(to[field])) Object.assign(out, { [field]: to[field] })
  }
  return out
}

/** A save acknowledgement never rolls the editor back to its request snapshot. */
export function mergeLocalCommit(current: LocalDocRecord[], requested: LocalDocRecord[], commit: LocalCommit): LocalDocRecord[] {
  const request = new Map(requested.map((doc) => [doc.id, doc]))
  const canonical = new Map(commit.docs.map((doc) => [doc.id, doc]))
  const copies = new Map(commit.copies.map((copy) => [copy.originalId, copy.copyId]))
  const removed = new Set(commit.removed)
  const out: LocalDocRecord[] = []
  const included = new Set<string>()
  const append = (doc: LocalDocRecord) => {
    if (!included.has(doc.id)) { out.push(doc); included.add(doc.id) }
  }
  for (const doc of current) {
    const sent = request.get(doc.id)
    // Failed reads stay paused until the explicit read-retry path succeeds.
    if (doc.contentLoaded === false) { append(doc); continue }
    const copyId = copies.get(doc.id)
    const copy = copyId && canonical.get(copyId)
    if (sent && copy) {
      const latestCopy = applyLocalDelta(sent, doc, copy)
      append({ ...latestCopy, id: copy.id, savedAt: null, deletedAt: null, baseHash: null, remoteMcp: null })
      const original = canonical.get(doc.id)
      if (original) append(original)
      continue
    }
    const saved = canonical.get(doc.id)
    if (sent && saved) {
      const next = applyLocalDelta(sent, doc, saved)
      append(sameLocalDoc(next, doc) && next.localRevision === doc.localRevision ? doc : next)
    } else if (!removed.has(doc.id) || !sent || !sameLocalDoc(sent, doc)) append(doc)
  }
  for (const doc of commit.docs) {
    // A user may already have deleted a requested article while it was saving.
    if (!request.has(doc.id) || included.has(doc.id)) append(doc)
  }
  return out.length === current.length && out.every((doc, index) => doc === current[index]) ? current : out
}

export function documentFromBody(row: BodyRecord, fallback?: LocalDocRecord): LocalDocRecord | undefined {
  if (row.removed) return undefined
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Partial<DocRecord> : fallback
  if (!metadata || typeof metadata.name !== 'string' || typeof metadata.updatedAt !== 'number') return undefined
  return {
    ...localDocValue({
      ...metadata,
      id: row.id,
      content: row.content,
      savedAt: metadata.savedAt ?? null,
      deletedAt: metadata.deletedAt ?? null,
      // The row itself is the proof that the body was read: a fallback index
      // entry may still carry a placeholder state from the load that failed
      // before this row was read, and it must not hide the readable content.
      contentLoaded: true,
      bodyState: undefined,
    } as DocRecord),
    localRevision: row.revision ?? 0,
    ...(typeof row.storedAt === 'number' && Number.isFinite(row.storedAt) ? { localSavedAt: row.storedAt } : {}),
  }
}

export function bodyFromDocument(doc: LocalDocRecord, revision: number): BodyRecord {
  const { content, ...metadata } = localDocValue(doc)
  return { id: doc.id, content, revision, metadata, storedAt: Date.now() }
}

/**
 * Runs synchronously inside BodyStore.transact, against the currently persisted
 * versions. Broadcasts and the localStorage index are deliberately not inputs.
 */
export function planLocalCommit(
  rows: BodyRecord[],
  changes: LocalDocChange[],
  copyName: (name: string) => string,
): BodyTransaction<LocalCommit> {
  const currentRows = new Map(rows.map((row) => [row.id, row]))
  const puts = new Map<string, BodyRecord>()
  const result: LocalCommit = { docs: [], removed: [], copies: [], conflicted: false, changedIds: [] }

  const keep = (doc: LocalDocRecord) => {
    if (!result.docs.some((existing) => existing.id === doc.id)) result.docs.push(doc)
  }
  const put = (doc: LocalDocRecord, previous?: BodyRecord) => {
    const revision = (previous?.revision ?? 0) + 1
    const row = bodyFromDocument(doc, revision)
    puts.set(row.id, row)
    currentRows.set(row.id, row)
    keep({ ...localDocValue(doc), localRevision: revision, localSavedAt: row.storedAt })
  }
  const preserveConflict = (change: LocalDocChange, current?: LocalDocRecord) => {
    result.conflicted = true
    if (current) keep(current)
    else result.removed.push(change.id)
    const after = change.after
    if (!after || after.contentLoaded === false || after.bodyState !== undefined) return
    const existing = currentRows.get(change.conflictId)
    const copy = existing && documentFromBody(existing)
    if (copy) keep(copy)
    else put({
      ...localDocValue(after),
      id: change.conflictId,
      name: copyName(after.name),
      savedAt: null,
      deletedAt: null,
      baseHash: null,
      remoteMcp: null,
      recovery: { kind: 'conflict', at: Date.now() },
    }, existing)
    result.copies.push({ originalId: change.id, copyId: change.conflictId })
  }

  for (const change of changes) {
    const row = currentRows.get(change.id)
    const before = change.before && localDocValue(change.before)
    const after = change.after && localDocValue(change.after)
    const current = row && documentFromBody(row, change.before ?? change.after)

    if (after?.contentLoaded === false) {
      // Read failures and lazy placeholders describe this page, not a new
      // persisted article version. They cannot globally unload another tab's
      // good body, store an empty placeholder, or advance its cloud base hash.
      if (current) keep(current)
      continue
    }

    if (!after) {
      if (!row || row.removed) {
        result.removed.push(change.id)
      } else if (!before || !current || !sameArticleText(current, before)) {
        // A purge from an old list must not erase article text another tab
        // edited. Bookkeeping-only differences (savedAt/baseHash/recovery) are
        // not another version, so a delete-after-save does not make a copy.
        preserveConflict(change, current)
      } else {
        puts.set(change.id, { id: change.id, content: '', revision: (row.revision ?? 0) + 1, removed: true })
        result.removed.push(change.id)
      }
      continue
    }

    if (before && sameLocalDoc(before, after)) {
      // An unchanged stale snapshot is not a request to overwrite or restore.
      if (current) keep(current)
      else if (row?.removed) result.removed.push(change.id)
      continue
    }
    if (row?.removed || (!row && before && (change.before?.localRevision ?? 0) > 0)) {
      // A user-initiated restore (undo / bin) or an account-archived row may revive
      // a tombstoned id; a stale live view with no archive still gets a copy.
      if (after.recovery?.kind === 'restored' || after.savedAt !== null) {
        put(after, row)
        continue
      }
      preserveConflict(change)
      continue
    }
    if (!current) {
      put(after, row)
      continue
    }
    if (sameLocalDoc(current, after)) {
      keep(current)
      continue
    }
    if (!before) {
      preserveConflict(change, current)
      continue
    }
    if ((row?.revision ?? 0) === (change.before?.localRevision ?? 0) && sameLocalDoc(current, before)) {
      // The exact base is still current. Body and metadata advance together.
      put(after, row)
      continue
    }
    // Text or a rename in a stale live view cannot silently revive a deleted id.
    if (current.deletedAt !== null && before.deletedAt === null &&
      (after.content !== before.content || after.name !== before.name)) {
      preserveConflict(change, current)
      continue
    }

    // Deleting text this page already knows is not a competing version just
    // because a cloud save moved bookkeeping in the same tick. Without this,
    // delete-after-save produced a （本机版本） copy and handed undo the copy.
    if (after.deletedAt !== null && sameArticleText(current, before)) {
      put({ ...after, updatedAt: Math.max(current.updatedAt, after.updatedAt) }, row)
      continue
    }

    const merged = localDocValue(current)
    let conflict = false
    for (const field of FIELDS) {
      const intended = JSON.stringify(after[field])
      const base = JSON.stringify(before[field])
      if (intended === base) continue
      const persisted = JSON.stringify(current[field])
      if (persisted !== base && persisted !== intended) {
        if (field === 'recovery') {
          // Recovery labels are provenance, not competing article contents.
          if ((after.recovery?.at ?? 0) > (current.recovery?.at ?? 0)) merged.recovery = after.recovery
          continue
        }
        // Archive timestamps are bookkeeping, not competing article versions.
        if (field === 'savedAt' && after.savedAt !== null && current.savedAt !== null) {
          merged.savedAt = Math.max(after.savedAt, current.savedAt)
          continue
        }
        conflict = true
        break
      }
      Object.assign(merged, { [field]: after[field] })
    }
    if (conflict) preserveConflict(change, current)
    else {
      merged.updatedAt = Math.max(current.updatedAt, after.updatedAt)
      if (sameLocalDoc(merged, current)) keep(current)
      else put(merged, row)
    }
  }
  result.changedIds = [...puts.keys()]
  return { put: [...puts.values()], result }
}
