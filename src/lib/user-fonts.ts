/**
 * Fonts the reader adds from their own computer.
 *
 * The file stays in this browser (IndexedDB) and is never uploaded: Reed only
 * registers it with the FontFace API for the preview, and on export embeds a
 * subset holding the glyphs of that export. Whether a font may be used in an
 * image is between the reader and the font's licence; nothing here
 * redistributes it.
 *
 * The database name follows docs/branding.md's `mopai.*` convention.
 */

const DB_NAME = 'mopai.user-fonts'
const DB_VERSION = 1
const STORE = 'fonts'

export const USER_FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const
/** Large CJK families with several hundred thousand glyph outlines fit. */
export const USER_FONT_MAX_BYTES = 40 * 1024 * 1024

export interface UserFont {
  id: string
  /** Shown in menus: the file name without its extension. */
  name: string
  /** The family it is registered under; never collides with a real font. */
  family: string
  size: number
  createdAt: number
}

interface UserFontRecord extends UserFont {
  bytes: ArrayBuffer
}

export type UserFontErrorCode = 'too-large' | 'bad-extension' | 'unreadable' | 'storage'

export class UserFontError extends Error {
  readonly code: UserFontErrorCode
  constructor(code: UserFontErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'UserFontError'
    this.code = code
  }
}

let database: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    return Promise.reject(new UserFontError('storage', 'IndexedDB unavailable'))
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
        reject(new UserFontError('storage', request.error?.message))
      }
      request.onblocked = () => {
        database = null
        reject(new UserFontError('storage', 'upgrade blocked'))
      }
    })
  }
  return database
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new UserFontError('storage', request.error?.message))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new UserFontError('storage', tx.error?.message))
    tx.onabort = () => reject(new UserFontError('storage', tx.error?.message))
  })
}

function meta(record: UserFontRecord): UserFont {
  return { id: record.id, name: record.name, family: record.family, size: record.size, createdAt: record.createdAt }
}

export function userFontFamily(id: string): string {
  return `Reed User Font ${id}`
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Registration with document.fonts

const registered = new Map<string, Promise<FontFace>>()
const bytesCache = new Map<string, ArrayBuffer>()

async function registerRecord(record: UserFontRecord): Promise<FontFace> {
  let pending = registered.get(record.id)
  if (!pending) {
    pending = (async () => {
      const face = new FontFace(record.family, record.bytes.slice(0), { display: 'swap' })
      await face.load()
      document.fonts.add(face)
      bytesCache.set(record.id, record.bytes)
      return face
    })()
    pending.catch(() => registered.delete(record.id))
    registered.set(record.id, pending)
  }
  return pending
}

function unregister(id: string): void {
  const pending = registered.get(id)
  registered.delete(id)
  bytesCache.delete(id)
  pending?.then((face) => document.fonts.delete(face)).catch(() => { /* never loaded */ })
}

// ---------------------------------------------------------------------------
// Shared list for the UI

let fonts: UserFont[] = []
let loaded: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: UserFont[]): void {
  fonts = next
  for (const listener of listeners) listener()
}

export function currentUserFonts(): UserFont[] {
  return fonts
}

export function subscribeUserFonts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Read the stored fonts and register each one; a broken entry is skipped. */
export function loadUserFonts(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const db = await open()
        const rows = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<UserFontRecord[]>)
        const ok: UserFont[] = []
        for (const row of rows.sort((a, b) => a.createdAt - b.createdAt)) {
          try {
            await registerRecord(row)
            ok.push(meta(row))
          } catch {
            /* a file the browser no longer accepts stays stored but is not offered */
          }
        }
        publish(ok)
      } catch {
        publish([])
      }
    })()
  }
  return loaded
}

export async function addUserFont(file: File): Promise<UserFont> {
  if (!(USER_FONT_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    throw new UserFontError('bad-extension', file.name)
  }
  if (file.size > USER_FONT_MAX_BYTES) throw new UserFontError('too-large', String(file.size))
  const bytes = await file.arrayBuffer()
  const id = newId()
  const record: UserFontRecord = {
    id,
    name: file.name.slice(0, file.name.length - extensionOf(file.name).length).trim().slice(0, 60) || file.name,
    family: userFontFamily(id),
    size: bytes.byteLength,
    createdAt: Date.now(),
    bytes,
  }
  // Load first: a file the browser cannot read never reaches storage.
  try {
    await registerRecord(record)
  } catch (error) {
    throw new UserFontError('unreadable', error instanceof Error ? error.message : String(error))
  }
  try {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    await done(tx)
  } catch (error) {
    unregister(id)
    throw error instanceof UserFontError ? error : new UserFontError('storage', String(error))
  }
  publish([...fonts, meta(record)])
  return meta(record)
}

export async function deleteUserFont(id: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await done(tx)
  unregister(id)
  publish(fonts.filter((font) => font.id !== id))
}

/** The registered family for a stored id, if that font is available here. */
export function userFontFamilyIfLoaded(id: string): string | undefined {
  return fonts.some((font) => font.id === id) ? userFontFamily(id) : undefined
}

// ---------------------------------------------------------------------------
// Export: embed only the glyphs that are drawn

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** woff / woff2 are compressed containers HarfBuzz does not open. */
function sfntKind(bytes: Uint8Array): 'ttf' | 'otf' | 'woff' | 'woff2' | 'unknown' {
  const tag = String.fromCharCode(...bytes.subarray(0, 4))
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'OTTO') return 'otf'
  if (tag === '\u0000\u0001\u0000\u0000' || tag === 'true') return 'ttf'
  return 'unknown'
}

/**
 * @font-face rules (data: URLs) for these user fonts, cut down to `text`.
 * A font HarfBuzz cannot cut (woff/woff2, or a subset failure) is embedded
 * whole: slower, but the export still shows the picked font.
 */
export async function userFontCss(ids: readonly string[], text: string): Promise<string> {
  if (!ids.length) return ''
  await loadUserFonts()
  const rules: string[] = []
  for (const id of ids) {
    const font = fonts.find((item) => item.id === id)
    const bytes = bytesCache.get(id)
    if (!font || !bytes) continue
    const view = new Uint8Array(bytes)
    const kind = sfntKind(view)
    let data: Uint8Array | null = null
    if (kind === 'ttf' || kind === 'otf') {
      const { subsetFont } = await import('./font-subset')
      data = await subsetFont(view, text).catch(() => null)
    }
    // A subset keeps the source's outline format, so the type is the same.
    const out = data ?? view
    const mime = kind === 'woff2' ? 'font/woff2' : kind === 'woff' ? 'font/woff' : kind === 'otf' ? 'font/otf' : 'font/ttf'
    const format = kind === 'woff2' ? 'woff2' : kind === 'woff' ? 'woff' : kind === 'otf' ? 'opentype' : 'truetype'
    const url = await blobDataUrl(new Blob([out as BlobPart], { type: mime }))
    rules.push(`@font-face { font-family: "${font.family}"; src: url("${url}") format("${format}"); font-display: block; }`)
  }
  return rules.join('\n')
}

/** Tests drop the cached connection and list between cases. */
export function resetUserFontsForTest(): void {
  database?.then((db) => db.close()).catch(() => { /* already unavailable */ })
  database = null
  loaded = null
  fonts = []
  registered.clear()
  bytesCache.clear()
}
