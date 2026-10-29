import type { SignatureConfig } from './types'
import type { UploadSizeChoice } from './image-compress'
import { SAMPLE_DOC } from './sample'
import { createBodyStore, type BodyRecord, type BodyStore } from './body-store'
import {
  bodyFromDocument,
  documentFromBody,
  mergeLocalCommit,
  planLocalCommit,
  sameLocalDoc,
  type LocalCommit,
  type LocalDocChange,
  type LocalDocRecord,
} from './local-docs'
import type { RemoteMcpBinding } from '@contracts/remote-mcp'
import { t } from './i18n'

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
   * false = we do not hold the article: `content` is a placeholder, not the
   * text. The editor must not show that placeholder as the article, and
   * autosave must not write it back.
   */
  contentLoaded?: boolean
  /**
   * Why `content` is not the article. Only meaningful with `contentLoaded:false`:
   *  - `stub`: the body is on the server and is fetched when the article opens;
   *  - `read-failed`: the local store could not be read; the original may still
   *    be on disk, so the doc stays unloaded until a retry succeeds;
   *  - `missing`: the index knows this id but the body store does not have it.
   * An unloaded body is never an empty article, and never overwrites one.
   */
  bodyState?: BodyState
  /** Separate collaboration base; never mix it with the owner's cloud baseHash. */
  remoteMcp?: RemoteMcpBinding | null
  /** Local IndexedDB revision; it protects tabs, not cloud writes. */
  localRevision?: number
}

/** Why a record has no trustworthy body in memory. See `DocRecord.bodyState`. */
export type BodyState = 'stub' | 'read-failed' | 'missing'

/**
 * True when this browser's record points at a row in the account: it was
 * archived (`savedAt`), or a login merge / save stamped it with the cloud hash
 * of a working copy. A record that is neither has only ever existed here — its
 * body is the only copy, so deleting it must not depend on the cloud.
 */
export function hasCloudCopy(doc: Pick<DocRecord, 'savedAt' | 'baseHash'>): boolean {
  return doc.savedAt !== null || Boolean(doc.baseHash)
}

/** Everything about a document except its body. Small enough for localStorage. */
type DocIndexEntry = Omit<DocRecord, 'content' | 'localRevision'>

export interface AppSettings {
  themeId: string
  sig: SignatureConfig
  /** Editor and preview scroll together. Defaults to on; persisted per browser. */
  syncScroll: boolean
  /** Whole-UI zoom in percent (90/100/110/125); 100 is the design size. */
  zoom: number
  /**
   * Target size for loose image uploads (see image-compress.ts). 'auto' is the
   * shipped WeChat-tuned default; the last confirmed pick is remembered here so
   * the next upload starts from it.
   */
  uploadSize: UploadSizeChoice
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

const LOCAL_CHANGE_KEY = 'mopai.local-change.v1'
const LOCAL_CHANNEL = 'mopai.local-docs.v1'
const LOCAL_TAB_ID = uid()
let localChannel: BroadcastChannel | null = null
const localChangeListeners = new Set<() => void>()

function dispatchLocalChange(): void {
  for (const listener of localChangeListeners) listener()
}

function handleRemoteLocalChange(source: unknown): void {
  if (typeof source === 'string' && source !== LOCAL_TAB_ID) dispatchLocalChange()
}

function onLocalChangeStorage(event: StorageEvent): void {
  if (event.key !== LOCAL_CHANGE_KEY || !event.newValue) return
  try {
    const value = JSON.parse(event.newValue) as { source?: unknown }
    handleRemoteLocalChange(value.source)
  } catch {
    // Another tab wrote an incompatible notification. A delayed save still
    // protects the data through the IndexedDB revision check.
  }
}

/**
 * Wake other tabs after a local commit. The notification is only an accelerator:
 * every write independently verifies the persisted revision in its transaction.
 */
export function subscribeLocalDocChanges(listener: () => void): () => void {
  localChangeListeners.add(listener)
  if (!localChannel && typeof BroadcastChannel !== 'undefined') {
    localChannel = new BroadcastChannel(LOCAL_CHANNEL)
    localChannel.onmessage = (event) => {
      const source = (event.data as { source?: unknown } | null)?.source
      handleRemoteLocalChange(source)
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onLocalChangeStorage)
  return () => {
    localChangeListeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onLocalChangeStorage)
  }
}

function notifyLocalDocChange(): void {
  localChannel?.postMessage({ source: LOCAL_TAB_ID })
  safeSet(LOCAL_CHANGE_KEY, JSON.stringify({ source: LOCAL_TAB_ID, at: Date.now() }))
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
/**
 * A failed body read is not repaired by a successful write: the articles still
 * in memory are incomplete, so a write must not report the store healthy.
 * Cleared only by a successful `readBodies`.
 */
let bodiesReadFailed = false

/**
 * The last local version this page knew was committed. Saves compare against
 * this, while the IndexedDB transaction compares again against the persisted
 * revision so a missed BroadcastChannel event cannot turn into an overwrite.
 */
let confirmed = new Map<string, LocalDocRecord>()
const conflictIds = new Map<string, { baseRevision: number; id: string }>()
let saveQueue: Promise<void> = Promise.resolve()

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
  // A write that lands while the last read failed does not make the store
  // healthy: the open articles are still incomplete. Keep the failure until a
  // read succeeds.
  if (bodiesReadFailed) {
    status = { ...status, backend }
    return
  }
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
  confirmed = new Map()
  conflictIds.clear()
  saveQueue = Promise.resolve()
  bodiesReadFailed = false
  status = HEALTHY
  listeners.clear()
  localChannel?.close()
  localChannel = null
  localChangeListeners.clear()
}

let storePromise: Promise<BodyStore> | null = null
let openStore: BodyStore | null = null

function bodyStore(): Promise<BodyStore> {
  if (!storePromise) {
    const pending = createBodyStore().then((store) => {
      openStore = store
      if (store.kind === 'localstorage') {
        reportFailure('unsupported', t('store.idbUnsupported'))
      }
      return store
    })
    storePromise = pending
    // Opening can fail for a transient reason (another tab blocking an upgrade,
    // a locked profile). Do not cache the rejection: a retry must try again.
    pending.catch(() => {
      if (storePromise === pending) storePromise = null
    })
  }
  return storePromise
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Empty means "nothing but the front-matter skeleton": the old blank default. */
function bodyIsEmpty(content: string): boolean {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim() === ''
}

function readBodyState(value: unknown): BodyState | undefined {
  return value === 'stub' || value === 'read-failed' || value === 'missing' ? value : undefined
}

function readIndex(): DocIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DocIndex>
    if (!parsed || !Array.isArray(parsed.docs)) return null
    return {
      docs: parsed.docs.map((d) => {
        const bodyState = readBodyState(d.bodyState)
        return {
          ...d,
          savedAt: d.savedAt ?? null,
          deletedAt: d.deletedAt ?? null,
          source: d.source ?? null,
          // Tolerate entries written before the sync fields existed.
          baseHash: d.baseHash ?? null,
          // An unloaded body is never "loaded" just because an older index said
          // so; keep the reason and let the next read decide what it can fill.
          contentLoaded: d.contentLoaded !== false && !bodyState,
          bodyState,
        }
      }),
      removed: Array.isArray(parsed.removed) ? parsed.removed.filter((id) => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

/** What localStorage keeps about a document: everything except the body. */
function indexEntryOf(doc: DocRecord): DocIndexEntry {
  // A body is loadable only when we hold the text and know it is complete.
  const loaded = doc.contentLoaded !== false && doc.bodyState === undefined
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
    // the body again instead of trusting the placeholder it was shown. The same
    // goes for a body the local store could not read: remember why it is absent
    // so the next load retries instead of treating it as a cloud stub.
    contentLoaded: loaded,
    bodyState: loaded ? undefined : (doc.bodyState ?? 'stub'),
  }
}

function writeIndex(index: DocIndex): boolean {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    return true
  } catch (e) {
    reportFailure('quota', t('store.quotaIndex', { err: describe(e) }))
    return false
  }
}

function describe(e: unknown): string {
  const err = e as { name?: string; message?: string }
  if (err?.name === 'QuotaExceededError') return t('store.errQuota')
  const detail = err?.message?.slice(0, 60)
  return [err?.name, detail].filter(Boolean).join(': ') || t('store.errUnknown')
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
    reportFailure('parse-failed', t('store.parseFailed'))
    return null
  }
}

interface BodiesRead {
  bodies: Map<string, BodyRecord>
  failed: boolean
}

async function readBodies(): Promise<BodiesRead> {
  try {
    const rows = await (await bodyStore()).readAll()
    const map = new Map(rows.map((row) => [row.id, row]))
    bodiesReadFailed = false
    return { bodies: map, failed: false }
  } catch (e) {
    // An empty Map is not "nothing stored": it is "we do not know". Keep every
    // index entry unloaded so nothing writes the placeholder over the original.
    bodiesReadFailed = true
    reportFailure('read-failed', t('store.readFailed', { err: describe(e) }))
    return { bodies: new Map(), failed: true }
  }
}

export interface Loaded {
  docs: DocRecord[]
  activeId: string
  /** True when the local body store could not be read during this load. */
  bodyReadFailed: boolean
}

/**
 * Attach bodies to index entries, without ever inventing an empty article.
 *
 *  - a cloud stub (`contentLoaded:false`, bodyState `stub`) keeps its body on
 *    the server and is fetched when opened;
 *  - a failed body-store read marks every entry that expects a local body as
 *    `read-failed`: the original is presumably still on disk, so it must not be
 *    replaced by an empty string;
 *  - an index entry whose id is absent from the body store is `missing`. An
 *    entry *present* with `content: ''` is an article the author really emptied,
 *    and loads as loaded.
 */
function hydrate(entries: DocIndexEntry[], bodies: Map<string, BodyRecord>, bodiesFailed: boolean): DocRecord[] {
  const out: DocRecord[] = []
  for (const entry of entries) {
    const body = bodies.get(entry.id)
    // A durable tombstone wins over every stale index row.
    if (body?.removed) continue
    const declared = entry.bodyState
    // A stub is not a missing local body: it is a body that lives on the server.
    if (entry.contentLoaded === false && (declared === 'stub' || declared === undefined)) {
      out.push({ ...entry, content: '', contentLoaded: false, bodyState: 'stub' })
      continue
    }
    if (bodiesFailed) {
      out.push({ ...entry, content: '', contentLoaded: false, bodyState: 'read-failed' })
      continue
    }
    if (!body) {
      out.push({ ...entry, content: '', contentLoaded: false, bodyState: 'missing' })
      continue
    }
    const stored = documentFromBody(body, entry as LocalDocRecord)
    out.push(stored ?? {
      ...entry,
      content: body.content,
      contentLoaded: true,
      bodyState: undefined,
      localRevision: body.revision ?? 0,
    })
  }
  return out
}

function bodyMissingReport(docs: DocRecord[]): void {
  const missing = docs.find((d) => d.bodyState === 'missing')
  if (missing) {
    reportFailure('read-failed', t('store.bodyMissing', { name: missing.name || t('common.unnamedDoc') }))
  }
}

/**
 * First paint of the article list: the small index from localStorage, the bodies
 * from IndexedDB, and - on the first run after this upgrade - a migration of the
 * old localStorage documents.
 */
export async function loadDocs(options: { trackBase?: boolean } = {}): Promise<Loaded> {
  const trackBase = options.trackBase !== false
  const legacy = readLegacyDocs()
  const index = readIndex()
  const { bodies, failed: bodiesFailed } = await readBodies()
  const migrated = safeGet(MIGRATED_KEY) === '1'

  let docs: DocRecord[]
  let removed: string[]

  if (legacy && !migrated) {
    // Migration. The legacy copy is the truth until the new stores have proven
    // they hold it: bodies first, then the index, then read back - and only a
    // verified result drops the old key.
    docs = mergeLegacy(legacy, index, bodies, bodiesFailed)
    removed = index?.removed ?? []
    // Without a successful body read the index entries cannot be compared with
    // what is on disk, so a migration would "verify" unreadable documents as
    // empty. Keep the legacy copy and retry on the next load instead.
    if (bodiesFailed || !(await migrate(docs, removed))) {
      // Keep working on the legacy data in memory, keep the legacy key on disk,
      // and try again next load. Nothing is lost; the user is told.
      if (trackBase) rememberLocalDocs(docs)
      return { docs, activeId: pickActive(docs, safeGet(ACTIVE_KEY)), bodyReadFailed: bodiesFailed }
    }
  } else if (index) {
    docs = hydrate(index.docs, bodies, bodiesFailed)
    removed = index.removed
  } else if (!bodiesFailed && bodies.size) {
    // The localStorage index is only a cache. A committed body row still carries
    // its metadata, so it can come back even when that cache failed to write.
    docs = []
    removed = []
  } else {
    // Nothing on this browser yet: the sample article is the front page.
    const first = createSampleDoc()
    safeSet(SAMPLE_SEEDED_KEY, '1')
    if (trackBase) rememberLocalDocs([first])
    return { docs: [first], activeId: first.id, bodyReadFailed: bodiesFailed }
  }

  // `missing` is a real gap, not an empty article. A failed read already reports
  // itself and covers every entry, so it is not repeated per document.
  if (!bodiesFailed) bodyMissingReport(docs)

  // A body whose index entry is gone is an article that would otherwise become
  // invisible - the crash-or-quota case. Show it again unless the user deleted it.
  const known = new Set(docs.map((d) => d.id))
  const tombstones = new Set([
    ...removed,
    ...[...bodies.values()].filter((row) => row.removed).map((row) => row.id),
  ])
  for (const [id, row] of bodies) {
    if (known.has(id) || tombstones.has(id)) continue
    const stored = documentFromBody(row)
    docs.push(stored ?? {
      id,
      name: t('store.recoveredName'),
      content: row.content,
      updatedAt: Date.now(),
      savedAt: null,
      deletedAt: null,
      contentLoaded: true,
      localRevision: row.revision ?? 0,
    })
  }

  if (trackBase) rememberLocalDocs(docs)
  const seeded = await applySampleSeed(docs, pickActive(docs, safeGet(ACTIVE_KEY)))
  if (trackBase) rememberLocalDocs(seeded.docs)
  return { ...seeded, bodyReadFailed: bodiesFailed }
}

/**
 * Browsers that stored docs before the sample existed keep their old blank
 * default forever otherwise - and a blank active article also makes every theme
 * thumbnail in the picker render as empty paper. Awaited, not fire-and-forget:
 * a write still in flight while the caller renders is a write that can land
 * after the next load has already read the old state.
 */
async function applySampleSeed(docs: DocRecord[], activeId: string): Promise<{ docs: DocRecord[]; activeId: string }> {
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

function rememberLocalDocs(docs: DocRecord[]): void {
  confirmed = new Map(docs.map((doc) => [doc.id, doc as LocalDocRecord]))
}

/** Legacy documents win on content, the index wins on order. */
function mergeLegacy(
  legacy: DocRecord[],
  index: DocIndex | null,
  bodies: Map<string, BodyRecord>,
  bodiesFailed: boolean,
): DocRecord[] {
  const byId = new Map<string, DocRecord>()
  for (const entry of index?.docs ?? []) {
    const stored = hydrate([entry], bodies, bodiesFailed)[0]
    if (stored) byId.set(entry.id, stored)
  }
  for (const doc of legacy) {
    const existing = byId.get(doc.id)
    // The legacy format always carried the body inline.
    if (!existing || doc.updatedAt >= existing.updatedAt) {
      byId.set(doc.id, { ...doc, contentLoaded: true, bodyState: undefined })
    }
  }
  const order = (index?.docs ?? []).map((d) => d.id)
  const out = order.map((id) => byId.get(id)).filter((d): d is DocRecord => Boolean(d))
  for (const doc of legacy) if (!order.includes(doc.id) && byId.has(doc.id)) out.push(byId.get(doc.id) as DocRecord)
  return out
}

/** Write the whole set to the new stores and verify the bodies came back. */
async function migrate(docs: DocRecord[], removed: string[]): Promise<boolean> {
  const store = await bodyStore().catch((e) => {
    reportFailure('migration-failed', t('store.migrationFailedError', { err: describe(e) }))
    return null
  })
  if (!store) return false

  // Only bodies we actually hold may be written or verified: a stub or an
  // unreadable body would be "verified" as an empty article.
  const cacheable = docs.filter((d) => d.contentLoaded !== false && d.bodyState === undefined)
  try {
    await store.write(cacheable.map((d) => bodyFromDocument({ ...d, localRevision: 1 }, 1)))
    if (!writeIndex({ docs: docs.map(indexEntryOf), removed })) return false
    const back = await store.readAll()
    const read = new Map(back.map((r) => [r.id, r.content]))
    for (const doc of cacheable) {
      if (!read.has(doc.id) || read.get(doc.id) !== doc.content) {
        reportFailure('migration-failed', t('store.migrationFailed'))
        return false
      }
    }
  } catch (e) {
    reportFailure('migration-failed', t('store.migrationFailedError', { err: describe(e) }))
    return false
  }
  const migratedIds = new Set(cacheable.map((doc) => doc.id))
  rememberLocalDocs(docs.map((doc) =>
    migratedIds.has(doc.id) ? { ...doc, localRevision: 1 } : doc,
  ))
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

export interface LocalSaveResult {
  ok: boolean
  request: LocalDocRecord[]
  commit: LocalCommit
}

const EMPTY_COMMIT: LocalCommit = {
  docs: [],
  removed: [],
  copies: [],
  conflicted: false,
  changedIds: [],
}

function localConflictCopyName(name: string): string {
  const suffix = t('mcp.version.local')
  return t('merge.copyName', {
    name: (name || t('common.unnamedDoc')).slice(0, 200 - suffix.length),
  })
}

function conflictIdFor(id: string, before?: LocalDocRecord): string {
  const baseRevision = before?.localRevision ?? -1
  const existing = conflictIds.get(id)
  if (existing?.baseRevision === baseRevision) return existing.id
  const next = { baseRevision, id: uid() }
  conflictIds.set(id, next)
  return next.id
}

function uniqueDocs(docs: DocRecord[]): LocalDocRecord[] {
  const byId = new Map<string, LocalDocRecord>()
  for (const doc of docs) byId.set(doc.id, doc as LocalDocRecord)
  return [...byId.values()]
}

function plannedChanges(
  request: LocalDocRecord[],
  pageBase: LocalDocRecord[],
): LocalDocChange[] {
  const next = new Map(request.map((doc) => [doc.id, doc]))
  const page = new Map(pageBase.map((doc) => [doc.id, doc]))
  const changes: LocalDocChange[] = []

  for (const doc of request) {
    const before = confirmed.get(doc.id) ?? page.get(doc.id)
    if (before && sameLocalDoc(before, doc)) continue
    changes.push({
      id: doc.id,
      before,
      after: doc,
      conflictId: conflictIdFor(doc.id, before),
    })
  }

  // Only documents this page previously knew can be intentional removals. A
  // conflict copy created by an earlier queued save is not in this page base,
  // so another snapshot cannot purge it merely because it has not reached React
  // state yet.
  for (const id of page.keys()) {
    if (next.has(id)) continue
    const before = confirmed.get(id) ?? page.get(id)
    if (!before) continue
    changes.push({
      id,
      before,
      after: undefined,
      conflictId: conflictIdFor(id, before),
    })
  }
  return changes
}

async function performLocalSave(
  docs: DocRecord[],
  activeId: string,
  pageBase: DocRecord[],
): Promise<LocalSaveResult> {
  const request = uniqueDocs(docs)
  const changes = plannedChanges(request, uniqueDocs(pageBase))
  let store: BodyStore
  try {
    store = await bodyStore()
  } catch (e) {
    reportFailure('write-failed', t('store.writeOpenFailed', { err: describe(e) }))
    return { ok: false, request, commit: EMPTY_COMMIT }
  }

  let commit = EMPTY_COMMIT
  if (changes.length) {
    const ids = new Set<string>()
    for (const change of changes) {
      ids.add(change.id)
      ids.add(change.conflictId)
    }
    try {
      commit = await store.transact(
        (rows) => planLocalCommit(rows, changes, localConflictCopyName),
        [...ids],
      )
      for (const doc of commit.docs) confirmed.set(doc.id, doc)
      for (const id of commit.removed) {
        if (!commit.docs.some((doc) => doc.id === id)) confirmed.delete(id)
      }
      for (const change of changes) {
        if (!commit.conflicted) conflictIds.delete(change.id)
      }
      notifyLocalDocChange()
    } catch (e) {
      const migrating = safeGet(LEGACY_DOCS_KEY) !== null && safeGet(MIGRATED_KEY) !== '1'
      reportFailure(
        migrating ? 'migration-failed' : 'quota',
        migrating
          ? t('store.migrationFailedError', { err: describe(e) })
          : t('store.quotaWrite', { err: describe(e) }),
      )
      return { ok: false, request, commit: EMPTY_COMMIT }
    }
  }

  const canonical = changes.length
    ? mergeLocalCommit(request, request, commit)
    : request
  let ok = true
  const previous = readIndex()
  const tombstones = [
    ...new Set([...(previous?.removed ?? []), ...commit.removed]),
  ].slice(-TOMBSTONE_LIMIT)
  if (!writeIndex({ docs: canonical.map(indexEntryOf), removed: tombstones })) ok = false
  if (!safeSetBool(ACTIVE_KEY, activeId)) ok = false

  // The body transaction is already durable when the compatibility index fails;
  // keep that warning visible, but never rewrite a good body with an empty one.
  if (ok) {
    reportHealthy(store.kind)
    if (safeGet(LEGACY_DOCS_KEY) !== null && safeGet(MIGRATED_KEY) === '1') {
      safeRemove(LEGACY_DOCS_KEY)
    }
  }
  return { ok, request, commit }
}

/**
 * Persist one page snapshot. Calls are serialized so two keystrokes from this
 * tab advance the same revision instead of mistaking each other for a conflict.
 */
export function saveLocalDocs(
  docs: DocRecord[],
  activeId: string,
  pageBase: DocRecord[] = [...confirmed.values()],
): Promise<LocalSaveResult> {
  const request = docs.map((doc) => ({ ...doc }))
  const base = pageBase.map((doc) => ({ ...doc }))
  const pending = saveQueue.then(() => performLocalSave(request, activeId, base))
  saveQueue = pending.then(() => undefined, () => undefined)
  return pending
}

/**
 * Compatibility wrapper for callers that only need success/failure. Failures
 * never throw; they land in `persistenceStatus()` and wake subscribers.
 */
export async function saveDocs(docs: DocRecord[], activeId: string): Promise<boolean> {
  return (await saveLocalDocs(docs, activeId)).ok
}

/**
 * Merge a local notification into page state without rolling back text this tab
 * is still editing. Documents that still match their confirmed base adopt the
 * new persisted copy; newer local edits stay in memory and will create a
 * recoverable conflict copy if another tab also changed them.
 */
export function reconcileObservedLocalDocs(
  currentDocs: DocRecord[],
  observedDocs: DocRecord[],
): { docs: LocalDocRecord[]; base: LocalDocRecord[]; changed: boolean } {
  const current = new Map(uniqueDocs(currentDocs).map((doc) => [doc.id, doc]))
  const observed = new Map(uniqueDocs(observedDocs).map((doc) => [doc.id, doc]))
  const nextBase = new Map(confirmed)
  const out: LocalDocRecord[] = []
  const included = new Set<string>()
  let changed = false

  for (const doc of current.values()) {
    const base = confirmed.get(doc.id)
    const seen = observed.get(doc.id)
    if (!base || !sameLocalDoc(doc, base)) {
      out.push(doc)
      included.add(doc.id)
      continue
    }
    if (seen) {
      out.push(seen)
      included.add(doc.id)
      if (!sameLocalDoc(doc, seen)) changed = true
      nextBase.set(doc.id, seen)
    } else {
      changed = true
      nextBase.delete(doc.id)
    }
  }

  for (const doc of observed.values()) {
    if (included.has(doc.id) || confirmed.has(doc.id)) continue
    out.push(doc)
    included.add(doc.id)
    nextBase.set(doc.id, doc)
    changed = true
  }

  // An observed tombstone with a page copy still at its old base is removed
  // above. A locally pending deletion has no current copy and keeps its old
  // base until its own transaction commits.
  confirmed = nextBase
  return { docs: out, base: [...nextBase.values()], changed }
}

function safeSetBool(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    reportFailure('quota', t('store.quotaIndex', { err: describe(e) }))
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
    uploadSize: 'auto',
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
    reportFailure('quota', t('store.quotaSettings', { err: describe(e) }))
  }
}

export function createDoc(): DocRecord {
  return {
    id: uid(),
    name: t('common.unnamedDoc'),
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
