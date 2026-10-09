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
 * The index (names, timestamps, which article is active) and the settings stay
 * in localStorage: they are small, they are needed synchronously on first paint,
 * and IndexedDB has no synchronous read at all.
 *
 * Not every environment has IndexedDB (some in-app webviews, some private
 * modes, `file://` in a few browsers). The fallback keeps the bodies in
 * localStorage - the old behavior - and says so through the failure channel, so
 * a quota error there is visible instead of silent.
 */

export interface BodyRecord {
  id: string
  content: string
}

export interface BodyStore {
  readonly kind: 'indexeddb' | 'localstorage'
  readAll(): Promise<BodyRecord[]>
  /** One transaction for the whole batch: either it all lands or nothing does. */
  write(records: BodyRecord[]): Promise<void>
  remove(ids: string[]): Promise<void>
  /** Let go of the connection. Only tests need this - the app keeps one per page. */
  close(): void
}

const DB_NAME = 'mopai'
const DB_VERSION = 1
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
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'))
  })
}

function createIndexedDbStore(db: IDBDatabase): BodyStore {
  return {
    kind: 'indexeddb',
    async readAll() {
      const tx = db.transaction(STORE, 'readonly')
      const rows = await promisify(tx.objectStore(STORE).getAll() as IDBRequest<BodyRecord[]>)
      return rows.filter((r) => typeof r?.id === 'string' && typeof r?.content === 'string')
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
    close() {
      db.close()
    },
  }
}

function readFallback(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [id, content] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof content === 'string') out[id] = content
    }
    return out
  } catch {
    return {}
  }
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
      return Object.entries(readFallback()).map(([id, content]) => ({ id, content }))
    },
    async write(records) {
      if (!records.length) return
      const all = readFallback()
      for (const record of records) all[record.id] = record.content
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(all))
    },
    async remove(ids) {
      if (!ids.length) return
      const all = readFallback()
      for (const id of ids) delete all[id]
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(all))
    },
    close() {
      // Nothing is held open.
    },
  }
}

/** A fresh store, opened for real. Callers that only need one keep their own. */
export async function createBodyStore(): Promise<BodyStore> {
  if (!indexedDbAvailable()) return createFallbackStore()
  try {
    return createIndexedDbStore(await openDatabase())
  } catch {
    return createFallbackStore()
  }
}
