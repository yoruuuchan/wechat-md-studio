/**
 * Uploaded templates live in their own IndexedDB database so their version can
 * move independently of article bodies. The record keeps the original zip plus
 * the parsed manifest/pages/CSS/assets, which is what makes a reload show the
 * same template without a network request.
 *
 * Key names keep the historic `mopai.` prefix from docs/branding.md.
 */
import { CardTemplateError } from './card-template-format'
import type { CardTemplateSourceRecord } from './card-template'

const DB_NAME = 'mopai.card-templates'
const DB_VERSION = 1
const STORE = 'templates'

let database: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    return Promise.reject(new CardTemplateError('storage', 'IndexedDB 不可用'))
  }
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          database = null
        }
        resolve(db)
      }
      request.onerror = () => {
        database = null
        reject(new CardTemplateError('storage', request.error?.message ?? 'IndexedDB open failed'))
      }
      request.onblocked = () => {
        database = null
        reject(new CardTemplateError('storage', 'IndexedDB upgrade blocked'))
      }
    })
  }
  return database
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new CardTemplateError('storage', tx.error?.message ?? 'IndexedDB write failed'))
    tx.onabort = () => reject(new CardTemplateError('storage', tx.error?.message ?? 'IndexedDB transaction aborted'))
  })
}

export async function listCardTemplateRecords(): Promise<CardTemplateSourceRecord[]> {
  const db = await open()
  const tx = db.transaction(STORE, 'readonly')
  const request = tx.objectStore(STORE).getAll() as IDBRequest<CardTemplateSourceRecord[]>
  const rows = await new Promise<CardTemplateSourceRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new CardTemplateError('storage', request.error?.message ?? 'IndexedDB read failed'))
  })
  return rows
    .filter((row) => typeof row?.id === 'string' && typeof row?.template === 'string')
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function saveCardTemplateRecord(record: CardTemplateSourceRecord): Promise<void> {
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(record)
  await done(tx)
}

export async function deleteCardTemplateRecord(id: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await done(tx)
}

/** Tests need to drop the cached connection after deleting the database. */
export function closeCardTemplateStore(): void {
  database?.then((db) => db.close()).catch(() => { /* already unavailable */ })
  database = null
}