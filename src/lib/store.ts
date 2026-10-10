import type { SignatureConfig } from './types'
import { SAMPLE_DOC } from './sample'
import { createBodyStore, type BodyStore } from './body-store'
import type { RemoteMcpBinding } from '@contracts/remote-mcp'

export interface DocRecord {
  id: string
  name: string
  content: string
  updatedAt: number
  /** When this article was last put into 草稿箱; null = never explicitly saved. */
  savedAt: number | null
  /** In the recycle bin since this timestamp; null = live. */
  deletedAt: number | null
  /** `agent:<token name>` when an agent pushed it through /api/agent; null = written here. */
  source?: string | null
  /**
   * The server hash of the last version this browser synced against (what the
   * server calls `baseHash`). Every save carries it, which is how a stale save
   * becomes a conflict instead of an overwrite. null/undefined = never synced.
   */
  baseHash?: string | null
  /**
   * false = metadata-only stub: `content` is a placeholder, not the article.
   * The editor fetches the body before showing or saving it, and the stub is
   * never written to the local cache.
   */
  contentLoaded?: boolean
  /** Separate collaboration base; never mix it with the owner's cloud baseHash. */
  remoteMcp?: RemoteMcpBinding | null
}

/** Everything about a document except its body. Small enough for localStorage. */
type DocIndexEntry = Omit<DocRecord, 'content'>

export interface AppSettings {
  themeId: string
  sig: SignatureConfig
  /** Editor and preview scroll together. Defaults to on; persisted per browser. */
  syncScroll: boolean
  /** Whole-UI zoom in percent (90/100/110/125); 100 is the design size. */
  zoom: number
}

/** Bodies used to live here in full; kept as the migration source. */
const LEGACY_DOCS_KEY = 'mopai.docs.v1'
const INDEX_KEY = 'mopai.index.v2'
const MIGRATED_KEY = 'mopai.migrated.v2'
const ACTIVE_KEY = 'mopai.active.v1'
const SETTINGS_KEY = 'mopai.settings.v1'
/** One-time migration marker: browsers whose storage predates the sample. */
const SAMPLE_SEEDED_KEY = 'mopai.sample.v1'
// Recognize both sample generations without rewriting a user's saved article.
const SAMPLE_MARKERS = ['欢迎使用芦苇', '欢迎使用公众号排版助手']

/** How many recently removed ids the index remembers, to keep a stale body from coming back. */
const TOMBSTONE_LIMIT = 200

interface DocIndex {
  docs: DocIndexEntry[]
  /** Ids the user deleted. A body that outlives its delete (store down) must not resurrect. */
  removed: string[]
}

export type PersistenceFailureKind =
  | 'unsupported'
  | 'quota'
  | 'write-failed'
  | 'read-failed'
  | 'migration-failed'
  | 'parse-failed'

export interface PersistenceStatus {
  /** True when nothing has failed so far. */
  healthy: boolean
  /** Where the bodies are kept right now. */
  backend: BodyStore['kind'] | 'unknown'
  failure: { kind: PersistenceFailureKind; message: string } | null
  /** When the current failure was first seen; null while healthy. */
  at: number | null
}

const HEALTHY: PersistenceStatus = { healthy: true, backend: 'unknown', failure: null, at: null }

let status: PersistenceStatus = HEALTHY
const listeners = new Set<(s: PersistenceStatus) => void>()

export function persistenceStatus(): PersistenceStatus {
  return status
}

/** Observe local-persistence failures. Returns the unsubscribe function. */
export function subscribePersistence(fn: (s: PersistenceStatus) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function reportFailure(kind: PersistenceFailureKind, message: string): void {
  // Repeat failures keep the original timestamp: the UI should be able to say
  // "since when", and a write that keeps failing is not a new incident.
  const at = status.failure?.kind === kind ? status.at : Date.now()
  status = { healthy: false, backend: status.backend, failure: { kind, message }, at }
  listeners.forEach((fn) => fn(status))
}

function reportHealthy(backend: BodyStore['kind']): void {
  // `unsupported` describes the browser, not the write: with the bodies in
  // localStorage a successful save is still a save into the store that will run
  // out of room first, and the author should keep hearing about it.
  if (status.failure?.kind === 'unsupported') {
    status = { ...status, backend }
    return
  }
  if (status.healthy && status.backend === backend) return
  status = { healthy: true, backend, failure: null, at: null }
  listeners.forEach((fn) => fn(status))
}

/** Clear the cached store and status. Tests only - the module is a singleton. */
export function __resetLocalStoreForTests(): void {
  // Closing synchronously is what lets a test delete the database afterwards
  // without racing an open connection.
  openStore?.close()
  openStore = null
  storePromise = null
  written.clear()
  status = HEALTHY
  listeners.clear()
}

let storePromise: Promise<BodyStore> | null = null
let openStore: BodyStore | null = null
/** What is already in the body store, so a keystroke does not rewrite the article twice. */
const written = new Map<string, string>()

function bodyStore(): Promise<BodyStore> {
  storePromise ??= createBodyStore().then((store) => {
    openStore = store
    if (store.kind === 'localstorage') {
      reportFailure('unsupported', '这个浏览器不支持 IndexedDB，正文暂存在 localStorage 里，容量小、可能写不进去')
    }
    return store
  })
  return storePromise
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Empty means "nothing but the front-matter skeleton": the old blank default. */
function bodyIsEmpty(content: string): boolean {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim() === ''
}

function readIndex(): DocIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DocIndex>
    if (!parsed || !Array.isArray(parsed.docs)) return null
    return {
      docs: parsed.docs.map((d) => ({
        ...d,
        savedAt: d.savedAt ?? null,
        deletedAt: d.deletedAt ?? null,
        source: d.source ?? null,
        // Tolerate entries written before the sync fields existed.
        baseHash: d.baseHash ?? null,
        contentLoaded: d.contentLoaded !== false,
      })),
      removed: Array.isArray(parsed.removed) ? parsed.removed.filter((id) => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

/** What localStorage keeps about a document: everything except the body. */
function indexEntryOf(doc: DocRecord): DocIndexEntry {
  return {
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updatedAt,
    savedAt: doc.savedAt,
    deletedAt: doc.deletedAt,
    source: doc.source ?? null,
    baseHash: doc.baseHash ?? null,
    remoteMcp: doc.remoteMcp ?? null,
    // Stubs are remembered as stubs: on the next load the editor has to fetch
    // the body again instead of trusting the placeholder it was shown.
    contentLoaded: doc.contentLoaded !== false,
  }
}

function writeIndex(index: DocIndex): boolean {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    return true
  } catch (e) {
    reportFailure('quota', `本地索引写不进去（${describe(e)}）：浏览器存储可能已满`)
    return false
  }
}

function describe(e: unknown): string {
  const err = e as { name?: string; message?: string }
  if (err?.name === 'QuotaExceededError') return '超出配额'
  return err?.name || err?.message?.slice(0, 60) || '未知错误'
}

/**
 * The pre-IndexedDB format: every document, bodies included, in one localStorage
 * key. Read but never deleted until a migration has been verified.
 */
function readLegacyDocs(): DocRecord[] | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LEGACY_DOCS_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DocRecord[]
    if (!Array.isArray(parsed)) return null
    return parsed.map((d) => ({
      ...d,
      savedAt: d.savedAt ?? null,
      deletedAt: d.deletedAt ?? null,
      source: d.source ?? null,
    }))
  } catch {
    // Unreadable, and possibly the last copy of something. Leave the key alone
    // and say so - overwriting it would destroy what the user cannot see either.
    reportFailure('parse-failed', '浏览器里旧的稿件数据读不出来了，已跳过；原始数据仍在本地，没有被覆盖')
    return null
  }
}

async function readBodies(): Promise<Map<string, string>> {
  try {
    const rows = await (await bodyStore()).readAll()
    const map = new Map(rows.map((r) => [r.id, r.content]))
    written.clear()
    for (const [id, content] of map) written.set(id, content)
    return map
  } catch (e) {
    reportFailure('read-failed', `本地正文读取失败（${describe(e)}）`)
    return new Map()
  }
}

interface Loaded {
  docs: DocRecord[]
  activeId: string
}

/**
 * Attach bodies to index entries.
 *
 * An entry marked `contentLoaded: false` is a metadata-only stub from the last
 * sync: its body is on the server, and whatever `content` it carries is a
 * placeholder, so it must not be filled from the body store either - the editor
 * fetches the real text before it shows or saves it.
 */
function hydrate(entries: DocIndexEntry[], bodies: Map<string, string>): DocRecord[] {
  return entries.map((entry) =>
    entry.contentLoaded === false
      ? { ...entry, content: '' }
      : { ...entry, content: bodies.get(entry.id) ?? '', contentLoaded: true },
  )
}

/**
 * First paint of the article list: the small index from localStorage, the bodies
 * from IndexedDB, and - on the first run after this upgrade - a migration of the
 * old localStorage documents.
 */
export async function loadDocs(): Promise<Loaded> {
  const legacy = readLegacyDocs()
  const index = readIndex()
  const bodies = await readBodies()
  const migrated = safeGet(MIGRATED_KEY) === '1'

  let docs: DocRecord[]
  let removed: string[]

  if (legacy && !migrated) {
    // Migration. The legacy copy is the truth until the new stores have proven
    // they hold it: bodies first, then the index, then read back - and only a
    // verified result drops the old key.
    docs = mergeLegacy(legacy, index, bodies)
    removed = index?.removed ?? []
    if (!(await migrate(docs, removed))) {
      // Keep working on the legacy data in memory, keep the legacy key on disk,
      // and try again next load. Nothing is lost; the user is told.
      return { docs, activeId: pickActive(docs, safeGet(ACTIVE_KEY)) }
    }
  } else if (index) {
    docs = hydrate(index.docs, bodies)
    removed = index.removed
  } else {
    // Nothing on this browser yet: the sample article is the front page.
    const first = createSampleDoc()
    safeSet(SAMPLE_SEEDED_KEY, '1')
    return { docs: [first], activeId: first.id }
  }

  for (const doc of docs) {
    if (!doc.content && doc.contentLoaded !== false) {
      reportFailure('read-failed', `「${doc.name || '未命名稿件'}」的正文没有读到，可能没有同步完成`)
    }
  }

  // A body whose index entry is gone is an article that would otherwise become
  // invisible - the crash-or-quota case. Show it again unless the user deleted it.
  const known = new Set(docs.map((d) => d.id))
  const tombstones = new Set(removed)
  for (const [id, content] of bodies) {
    if (known.has(id) || tombstones.has(id)) continue
    docs.push({
      id,
      name: '未命名稿件 · 本地恢复',
      content,
      updatedAt: Date.now(),
      savedAt: null,
      deletedAt: null,
    })
  }

  return applySampleSeed(docs, pickActive(docs, safeGet(ACTIVE_KEY)))
}

/**
 * Browsers that stored docs before the sample existed keep their old blank
 * default forever otherwise - and a blank active article also makes every theme
 * thumbnail in the picker render as empty paper. Awaited, not fire-and-forget:
 * a write still in flight while the caller renders is a write that can land
 * after the next load has already read the old state.
 */
async function applySampleSeed(docs: DocRecord[], activeId: string): Promise<Loaded> {
  if (!docs.length || safeGet(SAMPLE_SEEDED_KEY)) return { docs, activeId }
  safeSet(SAMPLE_SEEDED_KEY, '1')
  let out = docs
  let sample = out.find((d) => SAMPLE_MARKERS.some((marker) => d.content.includes(marker)))
  if (!sample) {
    sample = createSampleDoc()
    out = [sample, ...out]
  }
  let active = activeId
  const current = out.find((d) => d.id === active)
  // A stub's empty `content` is not an empty article, so it must not lose its
  // place to the sample.
  if (!current || (current.contentLoaded !== false && bodyIsEmpty(current.content))) active = sample.id
  await saveDocs(out, active)
  return { docs: out, activeId: active }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function pickActive(docs: DocRecord[], stored: string | null): string {
  const live = docs.filter((d) => !d.deletedAt)
  if (!live.length) return ''
  return live.some((d) => d.id === stored) ? (stored as string) : live[0].id
}

/** Legacy documents win on content, the index wins on order. */
function mergeLegacy(legacy: DocRecord[], index: DocIndex | null, bodies: Map<string, string>): DocRecord[] {
  const byId = new Map<string, DocRecord>()
  for (const entry of index?.docs ?? []) {
    byId.set(entry.id, { ...entry, content: bodies.get(entry.id) ?? '' })
  }
  for (const doc of legacy) {
    const existing = byId.get(doc.id)
    if (!existing || doc.updatedAt >= existing.updatedAt) byId.set(doc.id, doc)
  }
  const order = (index?.docs ?? []).map((d) => d.id)
  const out = order.map((id) => byId.get(id)).filter((d): d is DocRecord => Boolean(d))
  for (const doc of legacy) if (!order.includes(doc.id) && byId.has(doc.id)) out.push(byId.get(doc.id) as DocRecord)
  return out
}

/** Write the whole set to the new stores and verify the bodies came back. */
async function migrate(docs: DocRecord[], removed: string[]): Promise<boolean> {
  const store = await bodyStore()
  try {
    await store.write(docs.map((d) => ({ id: d.id, content: d.content })))
    if (!writeIndex({ docs: docs.map(indexEntryOf), removed })) return false
    const back = await store.readAll()
    const read = new Map(back.map((r) => [r.id, r.content]))
    for (const doc of docs) {
      if (read.get(doc.id) !== doc.content) {
        reportFailure('migration-failed', '本地稿件迁移后校验没通过，已保留原数据，下次打开再试')
        return false
      }
    }
  } catch (e) {
    reportFailure('migration-failed', `本地稿件迁移失败（${describe(e)}），已保留原数据，下次打开再试`)
    return false
  }
  for (const doc of docs) written.set(doc.id, doc.content)
  safeSet(MIGRATED_KEY, '1')
  // Verified: the legacy copy can go, and with it the quota it was holding.
  safeRemove(LEGACY_DOCS_KEY)
  reportHealthy(store.kind)
  return true
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A marker that does not stick only costs one extra migration attempt.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do: the key is gone from this browser's perspective anyway.
  }
}

/**
 * Persist the whole set. Bodies go first: a body with no index entry is
 * recoverable (it comes back as 本地恢复 above), an index entry with no body is a
 * blank article - so a partial write must fail in the first direction.
 *
 * Failures never throw; they land in `persistenceStatus()` and wake subscribers.
 * Resolves true when everything landed.
 */
export async function saveDocs(docs: DocRecord[], activeId: string): Promise<boolean> {
  let store: BodyStore
  try {
    store = await bodyStore()
  } catch (e) {
    reportFailure('write-failed', `本地正文存储打不开（${describe(e)}）`)
    return false
  }

  const ids = new Set(docs.map((d) => d.id))
  // A metadata-only stub carries a placeholder in `content`. Writing that as the
  // article would make the next session open an empty document and believe it,
  // so stubs never reach the body store - only the index, marked as stubs.
  const cacheable = docs.filter((d) => d.contentLoaded !== false)
  const changed = cacheable.filter((d) => written.get(d.id) !== d.content)
  const stale = [...written.keys()].filter((id) => !ids.has(id))
  let ok = true

  if (changed.length) {
    try {
      await store.write(changed.map((d) => ({ id: d.id, content: d.content })))
      for (const doc of changed) written.set(doc.id, doc.content)
    } catch (e) {
      reportFailure('quota', `正文没能写进本地存储（${describe(e)}）：空间可能不够，请先导出 Markdown 备份`)
      ok = false
    }
  }

  const removed = new Set<string>()
  if (stale.length) {
    try {
      await store.remove(stale)
      for (const id of stale) written.delete(id)
    } catch (e) {
      // The body is still there; the tombstone in the index keeps it from
      // coming back as a 本地恢复 article.
      reportFailure('write-failed', `本地正文删除没完成（${describe(e)}）`)
      ok = false
    }
  }
  for (const id of stale) removed.add(id)

  const previous = readIndex()
  const tombstones = [...new Set([...(previous?.removed ?? []), ...removed])].slice(-TOMBSTONE_LIMIT)
  if (!writeIndex({ docs: docs.map(indexEntryOf), removed: tombstones })) ok = false
  if (!safeSetBool(ACTIVE_KEY, activeId)) ok = false

  // The legacy key only still exists while a migration was failing; a later
  // successful save is what finally frees the space it was holding.
  if (ok) {
    if (safeGet(LEGACY_DOCS_KEY) !== null && safeGet(MIGRATED_KEY) === '1') safeRemove(LEGACY_DOCS_KEY)
    reportHealthy(store.kind)
  }
  return ok
}

function safeSetBool(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    reportFailure('quota', `本地索引写不进去（${describe(e)}）`)
    return false
  }
}

/** 当前选中的稿件 id。服务器接管后它只用来记住「上次看的是哪篇」。 */
export function loadActiveId(): string {
  return safeGet(ACTIVE_KEY) ?? ''
}

export function saveActiveId(id: string) {
  safeSetBool(ACTIVE_KEY, id)
}

export function loadSettings(): AppSettings {
  const def: AppSettings = {
    themeId: 'golden',
    sig: { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' },
    syncScroll: true,
    zoom: 100,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...def, ...(JSON.parse(raw) as AppSettings) }
  } catch {
    // Unreadable settings fall back to the defaults; the next save rewrites them.
  }
  return def
}

export const ZOOM_STEPS = [90, 100, 110, 125] as const

export function applyZoom(percent: number): void {
  const step = ZOOM_STEPS.includes(percent as (typeof ZOOM_STEPS)[number]) ? percent : 100
  document.documentElement.style.zoom = String(step / 100)
}

export function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch (e) {
    // Settings are small; a failure here means the whole store is full, which
    // the user should hear about before it starts costing them an article.
    reportFailure('quota', `设置没能存下来（${describe(e)}）：浏览器存储可能已满`)
  }
}

export function createDoc(): DocRecord {
  return {
    id: uid(),
    name: '未命名稿件',
    content: '---\ntitles:\n  - \n---\n\n',
    updatedAt: Date.now(),
    savedAt: null,
    deletedAt: null,
    baseHash: null,
    contentLoaded: true,
  }
}

export function createSampleDoc(): DocRecord {
  return {
    id: uid(),
    name: '示例稿 · 语法速览',
    content: SAMPLE_DOC,
    updatedAt: Date.now(),
    savedAt: null,
    deletedAt: null,
    baseHash: null,
    contentLoaded: true,
  }
}
