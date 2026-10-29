/**
 * Where article bodies live.
 *
 * localStorage is a synchronous, ~5 MB string store whose `setItem` throws once
 * it is full. Article bodies are the one thing here that grows without a ceiling
 * (a long piece with pasted tables hits megabytes), and a quota error used to be
 * swallowed - the editor kept working, the reload showed yesterday's text. So
 * bodies moved to IndexedDB:
 *
 *   - it has its own, much larger quota, shared with no other key;
 *   - a write is a transaction, so a body never lands half-written;
 *   - `getAll()` gives the reader a single, cheap snapshot.
 *
 * Guarded document writes also keep metadata, revisions and removal markers in
 * the same records. That atomic snapshot is authoritative; the small index in
 * localStorage is a compatibility cache. The active article and settings remain
 * page preferences rather than part of a document's concurrency version.
 *
 * Not every environment has IndexedDB (some in-app webviews, some private
 * modes, `file://` in a few browsers). The fallback keeps the bodies in
 * localStorage under a Web Lock. Without either serialization primitive, guarded
 * saves reject and the editor keeps a visible failure rather than pretending
 * the text is safely stored. An IndexedDB that exists
 * but cannot be opened is a different case: it rejects instead of pretending
 * the browser has no bodies, so a transient failure never reads as "empty".
 */

export interface BodyRecord {
  id: string
  content: string
  /** Time this record was written; callers expose it only after commit succeeds. */
  storedAt?: number
  /** Persisted with the body, so another tab can compare its editing base. */
  revision?: number
  /** The document index entry; committed atomically with the corresponding body. */
  metadata?: unknown
  /** A durable tombstone prevents a stale tab from recreating a removed id. */
  removed?: boolean
}

export interface BodyTransaction<T> {
  put?: BodyRecord[]
  remove?: string[]
  result: T
}

export interface BodyStore {
  readonly kind: 'indexeddb' | 'localstorage'
  readAll(): Promise<BodyRecord[]>
  read(ids: readonly string[]): Promise<BodyRecord[]>
  /** One transaction for the whole batch: either it all lands or nothing does. */
  write(records: BodyRecord[]): Promise<void>
  remove(ids: string[]): Promise<void>
  /** The synchronous planner sees the latest rows inside the write transaction. */
  transact<T>(plan: (records: BodyRecord[]) => BodyTransaction<T>, ids?: readonly string[]): Promise<T>
  /** Let go of the connection. Only tests need this - the app keeps one per page. */
  close(): void
}

const DB_NAME = 'mopai'
// Version 2 is a write-protocol barrier: version-1 pages must release their
// connection before guarded writes start, and cannot reopen with the old API.
const DB_VERSION = 2
const STORE = 'bodies'
const FALLBACK_KEY = 'mopai.bodies.v1'

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let abandoned = false
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      // An onblocked rejection may be followed by a successful upgrade after
      // an old tab closes. Release that late connection so retries can reopen.
      if (abandoned) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => {
      abandoned = true
      reject(new Error('IndexedDB upgrade blocked; close or reload older tabs'))
    }
  })
}

function createIndexedDbStore(db: IDBDatabase): BodyStore {
  db.onversionchange = () => db.close()
  return {
    kind: 'indexeddb',
    async readAll() {
      const tx = db.transaction(STORE, 'readonly')
      const rows = await promisify(tx.objectStore(STORE).getAll() as IDBRequest<BodyRecord[]>)
      return rows.filter((r) => typeof r?.id === 'string' && typeof r?.content === 'string')
    },
    read(ids) {
      const tx = db.transaction(STORE, 'readonly')
      return readRecords(tx.objectStore(STORE), ids)
    },
    async write(records) {
      if (!records.length) return
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const record of records) store.put(record)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
      })
    },
    async remove(ids) {
      if (!ids.length) return
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const id of ids) store.delete(id)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
      })
    },
    transact<T>(plan: (records: BodyRecord[]) => BodyTransaction<T>, ids?: readonly string[]): Promise<T> {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        let result: T
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
        // Resolve the requests while this transaction is still active. No
        // unrelated async work may run between the read and the guarded puts.
        void readRecords(store, ids).then((records) => {
          try {
            const next = plan(records)
            for (const record of next.put ?? []) store.put(record)
            for (const id of next.remove ?? []) store.delete(id)
            result = next.result
          } catch (error) {
            tx.abort()
            reject(error)
          }
        }, reject)
      })
    },
    close() {
      db.close()
    },
  }
}

function readRecords(store: IDBObjectStore, ids?: readonly string[]): Promise<BodyRecord[]> {
  if (ids === undefined) {
    return promisify(store.getAll() as IDBRequest<BodyRecord[]>).then((rows) => rows.filter(validRecord))
  }
  return Promise.all([...new Set(ids)].map((id) => promisify(store.get(id) as IDBRequest<BodyRecord | undefined>)))
    .then((rows) => rows.filter((row): row is BodyRecord => row !== undefined && validRecord(row)))
}

function validRecord(value: BodyRecord): boolean {
  return typeof value?.id === 'string' && typeof value?.content === 'string'
}

function readFallback(): Record<string, BodyRecord> {
  // An unreadable store is unknown, not empty. Propagate the failure so an
  // autosave cannot replace the only remaining copy with a fresh object.
  const raw = localStorage.getItem(FALLBACK_KEY)
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid localStorage body store')
  }
  const out: Record<string, BodyRecord> = Object.create(null)
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[id] = { id, content: value }
    else if (value && typeof value === 'object' && validRecord(value as BodyRecord)) {
      out[id] = { ...(value as BodyRecord), id }
    } else {
      throw new Error('Invalid localStorage body record')
    }
  }
  return out
}

function writeFallback(records: Record<string, BodyRecord>): void {
  const serialized = Object.fromEntries(
    Object.entries(records).map(([id, record]) => [
      id,
      record.revision === undefined && record.metadata === undefined && !record.removed
        ? record.content
        : record,
    ]),
  )
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(serialized))
}

/**
 * Bodies in localStorage, one JSON object under one key. Written whole each
 * time, which is exactly the quota hazard this file exists to move away from -
 * it is the fallback, and every one of its failures is reported.
 */
function createFallbackStore(): BodyStore {
  return {
    kind: 'localstorage',
    async readAll() {
      return Object.values(readFallback())
    },
    async read(ids) {
      const records = readFallback()
      return [...new Set(ids)].map((id) => records[id]).filter((row): row is BodyRecord => row !== undefined)
    },
    async write(records) {
      if (!records.length) return
      const all = readFallback()
      for (const record of records) all[record.id] = record
      writeFallback(all)
    },
    async remove(ids) {
      if (!ids.length) return
      const all = readFallback()
      for (const id of ids) delete all[id]
      writeFallback(all)
    },
    async transact<T>(plan: (records: BodyRecord[]) => BodyTransaction<T>, ids?: readonly string[]): Promise<T> {
      const commit = () => {
        const all = readFallback()
        const next = plan(ids === undefined ? Object.values(all) : [...new Set(ids)].flatMap((id) => all[id] ? [all[id]] : []))
        for (const record of next.put ?? []) all[record.id] = record
        for (const id of next.remove ?? []) delete all[id]
        if (next.put?.length || next.remove?.length) writeFallback(all)
        return next.result
      }
      // Refuse an unsafe read/modify/write when neither browser primitive can
      // serialize it. The caller reports a visible persistence failure while
      // the author keeps the text in memory and can export it.
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return navigator.locks.request(FALLBACK_KEY, commit)
      }
      throw new Error('Safe local saves require IndexedDB or Web Locks')
    },
    close() {
      // Nothing is held open.
    },
  }
}

/**
 * A fresh store, opened for real. Callers that only need one keep their own.
 *
 * A browser without the IndexedDB API keeps the old localStorage behavior. An
 * IndexedDB that exists but fails to open is *not* the same thing: falling back
 * to an empty localStorage store would make every article look empty and let
 * the next autosave write those empties over the real ones. The rejection goes
 * to the read/write failure channel instead, so the original bodies stay put
 * and the UI can offer a retry.
 */
export async function createBodyStore(): Promise<BodyStore> {
  if (!indexedDbAvailable()) return createFallbackStore()
  return createIndexedDbStore(await openDatabase())
}
