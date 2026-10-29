import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '@/providers/trpc'
import {
  createDoc,
  createSampleDoc,
  hasCloudCopy,
  loadActiveId,
  loadDocs,
  persistenceStatus,
  reconcileObservedLocalDocs,
  saveActiveId,
  saveLocalDocs,
  subscribeLocalDocChanges,
  subscribePersistence,
  uid,
  type DocRecord,
  type PersistenceStatus,
} from '@/lib/store'
import { conflictCopyName, planMerge, type RemoteDocMeta } from '@/lib/docs-merge'
import { BUNDLE_IMPORT_BATCH_SIZE } from '@/lib/import-export'
import { mergeLocalCommit, type LocalDocRecord } from '@/lib/local-docs'
import { articleSaveStatus, sameLocalReceipt, type LocalSaveReceipt } from '@/lib/save-status'
import { useI18n } from '@/hooks/useI18n'

export type SyncState = 'loading' | 'synced' | 'saving' | 'local' | 'error'

/** How long a delete stays reversible. */
export const UNDO_DELETE_MS = 10_000

/**
 * Metadata page size. The list ships no article bodies, so paging through the
 * whole archive at login costs a few hundred bytes per article — the merge
 * needs the complete id set to tell "local-only" from "diverged", and the
 * editor then fetches bodies on demand.
 */
const PAGE_SIZE = 200

type SyncedDocument = Pick<DocRecord, 'name' | 'content'>
const sameSyncedDocument = (saved: SyncedDocument | undefined, doc: SyncedDocument): boolean =>
  saved?.name === doc.name && saved.content === doc.content
const syncedSnapshot = (doc: SyncedDocument): SyncedDocument => ({ name: doc.name, content: doc.content })

/** The cloud's copy of an article this browser disagreed with. */
export interface ConflictCurrent {
  id: string
  name: string
  content: string
  updatedAt: number
  savedAt: number | null
  deletedAt: number | null
  source: string | null
  hash: string
}

interface Options {
  /** Server sync needs a session; anonymous visitors stay on localStorage. */
  enabled: boolean
  /**
   * Article to open, from a `?doc=<id>` link — that is how an agent hands its
   * pushed draft to the owner. Applied once the merge has landed, then
   * reported back through `onDeepLinkSettled` so the caller can drop the
   * parameter from the URL.
   */
  deepLinkId?: string | null
  onDeepLinkSettled?: (found: boolean) => void
}

/**
 * 稿件真相源是服务器数据库，localStorage 是离线缓存，两者在登录时做一次合并。
 *
 * 写盘分两条路，刻意分开：
 *   - 浏览器本地：每次改动都写，纯本地、即时，用来防丢
 *   - 云端：只在该稿件已经被保存过（savedAt 有值）时随改动更新；
 *     没保存过的稿件要等用户点「保存到草稿箱」才会出现在云端和草稿箱里
 *
 * 并发靠稿件 hash：每篇稿子带着最后一次同步的 baseHash，保存时服务端比对，
 * 对不上就回一个 conflict（不会被覆盖），由这里弹窗让用户决定保留哪边。
 *
 * 正文按需加载：列表只给元数据，打开哪篇才拉哪篇的正文（contentLoaded=false
 * 的 stub 不参与编辑和自动保存，也不会写进本地缓存）。
 */
export function useDocs({ enabled, deepLinkId, onDeepLinkSettled }: Options) {
  const { t } = useI18n()
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [activeId, setActiveId] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  /** 内容变过但还没写进数据库的稿件 id，用来点亮保存按钮。 */
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  /**
   * Trashed docs whose body this browser still holds. A purely local article
   * (never pushed, never saved) is deleted and restored here whether or not a
   * session is active; a cloud article also leaves a copy here until the server
   * confirms it trashed the row, so a failed delete or a row purged on another
   * device cannot take the only local text with it.
   */
  const [localTrash, setLocalTrash] = useState<DocRecord[]>([])
  /**
   * Whether the browser is actually holding what the editor thinks it is. A
   * failed write used to be invisible: the screen kept the text, the reload did
   * not. Everything that fails to persist lands here.
   */
  const [localFault, setLocalFault] = useState<PersistenceStatus>(() => persistenceStatus())
  const reportedFault = useRef<string | null>(null)
  /** Articles whose cloud copy moved on under a stale save; keyed by id. */
  const [conflicts, setConflicts] = useState<Map<string, ConflictCurrent>>(new Map())
  /** Id of the article whose body is being fetched, if any. */
  const [hydrating, setHydrating] = useState<string | null>(null)
  const [hydrateError, setHydrateError] = useState<{ id: string; message: string } | null>(null)
  /** A manual retry of the local body store is in flight. */
  const [retryingLocal, setRetryingLocal] = useState(false)
  /** Bumped after a successful local retry so a paused cloud merge runs again. */
  const [localRetryVersion, setLocalRetryVersion] = useState(0)
  const [localSaveRetry, setLocalSaveRetry] = useState(0)
  const [localReceipts, setLocalReceipts] = useState<Map<string, LocalSaveReceipt>>(new Map())
  const [cloudWrites, setCloudWrites] = useState<Map<string, number>>(new Map())
  const [cloudFailures, setCloudFailures] = useState<Set<string>>(new Set())
  /**
   * True once we know where we stand relative to the cloud: after the merge
   * completes, or right away when there is no account to merge with. Autosave
   * stays off until then so no pre-merge base ever races the merge itself.
   */
  // Authentication resolves after the editor mounts. Starting "settled" for
  // the anonymous first render would hide a later cloud-list failure forever.
  const [settled, setSettled] = useState(false)

  const utils = trpc.useUtils()
  const bootedRef = useRef(false)
  const reconciledRef = useRef(false)
  const reconcilingRef = useRef(false)
  /** A `?doc=<id>` link is applied once, then forgotten. */
  const deepLinkRef = useRef<string | null>(deepLinkId ?? null)
  const deepLinkDone = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const pendingRef = useRef<Set<string>>(new Set())
  // 最近一次已落库的内容，用来判断是否真的需要再写一次
  const lastSavedRef = useRef<Map<string, SyncedDocument>>(new Map())
  const docsRef = useRef<DocRecord[]>([])
  docsRef.current = docs
  /** The local versions this page last knew were committed. */
  const localBaseRef = useRef<Map<string, LocalDocRecord>>(new Map())
  const localRefreshRef = useRef<{ running: boolean; again: boolean }>({ running: false, again: false })
  /** The trash as of now, for callbacks a toast captured before the delete. */
  const localTrashRef = useRef<DocRecord[]>([])
  localTrashRef.current = localTrash
  /**
   * Cloud deletes still in flight, so an undo never races the remove that is
   * about to land on the server.
   */
  const pendingRemoves = useRef(new Map<string, Promise<void>>())
  const activeIdRef = useRef('')
  activeIdRef.current = activeId

  const listQuery = trpc.docs.list.useQuery(
    { limit: PAGE_SIZE, offset: 0 },
    { enabled, retry: false },
  )
  const trashQuery = trpc.docs.trash.useQuery(undefined, { enabled, retry: false })
  const importMutation = trpc.docs.importLocal.useMutation()
  const saveMutation = trpc.docs.save.useMutation()
  const saveToDraftsMutation = trpc.docs.saveToDrafts.useMutation()
  const removeMutation = trpc.docs.remove.useMutation()
  const restoreMutation = trpc.docs.restore.useMutation()
  const purgeMutation = trpc.docs.purge.useMutation()

  const observeLocalReceipts = useCallback((records: DocRecord[]) => {
    const alive = new Set([...docsRef.current, ...localTrashRef.current].map((doc) => doc.id))
    setLocalReceipts((previous) => {
      let next = previous
      for (const doc of records) {
        // A newly created in-memory article is not a successful disk read.
        if (!alive.has(doc.id) || doc.contentLoaded === false || doc.localRevision === undefined) continue
        const at = doc.localSavedAt ?? null
        const known = previous.get(doc.id)
        if (sameLocalReceipt(known, doc) && known?.at === at) continue
        if (next === previous) next = new Map(previous)
        next.set(doc.id, { ...doc, at })
      }
      return next
    })
  }, [])

  const markCloudWrites = useCallback((ids: string[], delta: 1 | -1) => {
    setCloudWrites((previous) => {
      const next = new Map(previous)
      for (const id of ids) {
        const count = Math.max(0, (next.get(id) ?? 0) + delta)
        if (count) next.set(id, count)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const markCloudResult = useCallback((ids: string[], failed: boolean) => {
    const alive = new Set([...docsRef.current, ...localTrashRef.current].map((doc) => doc.id))
    setCloudFailures((previous) => {
      const next = new Set(previous)
      for (const id of ids) {
        if (failed && alive.has(id)) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  useEffect(() => {
    const alive = new Set([...docs, ...localTrash].map((doc) => doc.id))
    const retain = <T,>(entries: Map<string, T>): Map<string, T> =>
      [...entries.keys()].every((id) => alive.has(id)) ? entries : new Map([...entries].filter(([id]) => alive.has(id)))
    setLocalReceipts(retain)
    setCloudWrites(retain)
    setCloudFailures((previous) => [...previous].every((id) => alive.has(id)) ? previous : new Set([...previous].filter((id) => alive.has(id))))
    for (const id of lastSavedRef.current.keys()) if (!alive.has(id)) lastSavedRef.current.delete(id)
  }, [docs, localTrash])

  // 1. 首次加载：先显示本地缓存（匿名时它就是全部真相）
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    // No cancellation guard on purpose: StrictMode mounts effects twice in
    // development, and dropping the result of the first run - the only one that
    // loads - would leave the editor empty.
    void loadDocs().then((local) => {
      observeLocalReceipts(local.docs)
      localBaseRef.current = new Map(local.docs.map((d) => [d.id, d as LocalDocRecord]))
      setLocalTrash(local.docs.filter((d) => d.deletedAt))
      const live = local.docs.filter((d) => !d.deletedAt)
      const shown = live.length ? live : [createDoc()]
      setDocs(shown)
      setActiveId(shown.some((d) => d.id === local.activeId) ? local.activeId : shown[0].id)
    })
    if (!enabled) setSyncState('local')
  }, [enabled, observeLocalReceipts])

  // A failed local read leaves the affected articles unloaded, with their
  // original bodies still on disk. Retrying opens the store again and fills
  // only the bodies we do not hold; text being edited in another article is
  // left alone.
  const retryLocalBodies = useCallback(async () => {
    if (retryingLocal) return
    setRetryingLocal(true)
    try {
      const loaded = await loadDocs()
      observeLocalReceipts(loaded.docs)
      localBaseRef.current = new Map(loaded.docs.map((d) => [d.id, d as LocalDocRecord]))
      const byId = new Map(loaded.docs.map((d) => [d.id, d]))
      setDocs((current) => {
        const next = current.map((d) => {
          if (d.contentLoaded !== false || d.bodyState === 'stub') return d
          const fresh = byId.get(d.id)
          if (!fresh) return d
          if (fresh.contentLoaded === false) return { ...d, bodyState: fresh.bodyState }
          return { ...d, content: fresh.content, contentLoaded: true, bodyState: undefined }
        })
        // A body whose index entry is gone is recovered the same way the next
        // page load would show it.
        const ids = new Set(next.map((d) => d.id))
        for (const d of loaded.docs) {
          if (!ids.has(d.id) && d.contentLoaded !== false && !d.deletedAt) {
            next.push(d)
            ids.add(d.id)
          }
        }
        return next
      })
      // A merge paused by the read failure may run again now.
      if (!loaded.bodyReadFailed) setLocalRetryVersion((n) => n + 1)
      setLocalSaveRetry((n) => n + 1)
    } catch {
      // loadDocs reports its own failures; a retry that still cannot open the
      // store leaves the same diagnostic in place.
    } finally {
      setRetryingLocal(false)
    }
  }, [retryingLocal, observeLocalReceipts])

  const refreshLocalDocs = useCallback(async () => {
    if (localRefreshRef.current.running) {
      localRefreshRef.current.again = true
      return
    }
    localRefreshRef.current.running = true
    try {
      do {
        localRefreshRef.current.again = false
        const observed = await loadDocs({ trackBase: false })
        observeLocalReceipts(observed.docs)
        const current = [...docsRef.current, ...localTrashRef.current]
        const merged = reconcileObservedLocalDocs(current, observed.docs)
        const live = merged.docs.filter((d) => !d.deletedAt)
        const trash = merged.docs.filter((d) => Boolean(d.deletedAt))
        const shown = live.length ? live : [createDoc()]
        docsRef.current = shown
        localTrashRef.current = trash
        localBaseRef.current = new Map(merged.base.map((d) => [d.id, d]))
        setDocs(shown)
        setLocalTrash(trash)
        if (!live.some((d) => d.id === activeIdRef.current)) setActiveId(shown[0].id)
        if (merged.changed) setNotice(t('docs.localTabChanged'))
      } while (localRefreshRef.current.again)
    } catch {
      setNotice(t('docs.localRefreshFailed'))
    } finally {
      localRefreshRef.current.running = false
    }
  }, [t, observeLocalReceipts])

  useEffect(
    () =>
      subscribeLocalDocChanges(() => {
        void refreshLocalDocs()
      }),
    [refreshLocalDocs],
  )

  // 本地持久化的健康状况：失败一次提示一次，失败状态本身留在顶部状态位上
  useEffect(
    () =>
      subscribePersistence((s) => {
        setLocalFault(s)
        if (s.healthy || !s.failure) {
          reportedFault.current = null
          return
        }
        const signature = `${s.failure.kind}:${s.failure.message}`
        if (reportedFault.current === signature) return
        reportedFault.current = signature
        setNotice(s.failure.message)
      }),
    [],
  )

  // 2a. 读不到云端列表：留在本地编辑，本地内容一个不丢；刷新页面会重试
  useEffect(() => {
    if (!enabled || settled || reconciledRef.current) return
    if (!listQuery.isError) return
    setSettled(true)
    setSyncState('error')
    setNotice(t('docs.loadCloudFailed'))
  }, [enabled, settled, listQuery.isError, t])

  // 2b. 云端元数据到达 → 合并（local-only 上传、diverged 另存、其余按 id 对齐）
  useEffect(() => {
    if (!enabled || !listQuery.isSuccess || reconciledRef.current || reconcilingRef.current) return
    // The bin query decides whether an article absent from the live list is
    // gone or merely trashed; wait for it to settle (success or failure).
    if (trashQuery.isLoading) return
    reconcilingRef.current = true

    const run = async () => {
      // Page through the rest of the metadata so the merge sees every id.
      const first = listQuery.data
      const remote: RemoteDocMeta[] = (first?.items ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        updatedAt: d.updatedAt.getTime(),
        savedAt: d.savedAt ? d.savedAt.getTime() : null,
        source: d.source ?? null,
        hash: d.hash ?? null,
      }))
      let hasMore = first?.hasMore ?? false
      while (hasMore) {
        const page = await utils.docs.list.fetch({ limit: PAGE_SIZE, offset: remote.length })
        remote.push(
          ...page.items.map((d) => ({
            id: d.id,
            name: d.name,
            updatedAt: d.updatedAt.getTime(),
            savedAt: d.savedAt ? d.savedAt.getTime() : null,
            source: d.source ?? null,
            hash: d.hash ?? null,
          })),
        )
        if (page.items.length === 0) break
        hasMore = page.hasMore
      }

      const local = await loadDocs()
      localBaseRef.current = new Map(local.docs.map((d) => [d.id, d as LocalDocRecord]))
      if (local.bodyReadFailed) {
        // The local articles are unreadable, so they cannot be compared with
        // the cloud without risking an empty overwrite. Keep the cloud list out
        // of the merge and try again after the author's retry succeeds.
        setSyncState('error')
        setNotice(t('docs.localReadBlocked'))
        return
      }
      const trashedIds = new Set((trashQuery.data ?? []).map((t) => t.id))
      const plan = await planMerge({
        local: local.docs.filter((d) => !d.deletedAt),
        remote,
        trashedIds,
      })

      const shown = plan.docs.length ? plan.docs : [createDoc()]
      // The plan was built from the cache a moment ago; whatever is in state
      // right now is at least as new (the cache is written *from* state), and a
      // keystroke typed during the page fetches must not be rolled back. Keep
      // the state's body/name for anything we already hold, and keep anything
      // the plan never saw.
      setDocs((current) => {
        const byId = new Map(current.map((d) => [d.id, d]))
        const out = shown.map((p) => {
          const c = byId.get(p.id)
          if (!c || c.contentLoaded === false) return p
          return {
            ...p,
            content: c.content,
            name: c.name,
            updatedAt: Math.max(p.updatedAt, c.updatedAt),
            baseHash: c.baseHash ?? p.baseHash,
            remoteMcp: c.remoteMcp,
          }
        })
        const planIds = new Set(shown.map((d) => d.id))
        for (const d of current) {
          if (!planIds.has(d.id) && d.contentLoaded !== false) out.unshift(d)
        }
        return out
      })
      const stored = loadActiveId()
      // Resolve against everything that survived — including the brand-new
      // local work the union above kept, which the user may be typing in.
      const alive = new Set(shown.map((d) => d.id))
      for (const d of docsRef.current) {
        if (d.contentLoaded !== false) alive.add(d.id)
      }
      const prevActive = activeIdRef.current
      setActiveId(
        alive.has(prevActive) ? prevActive : alive.has(stored) ? stored : shown[0].id,
      )

      // Bodies we hold are "saved" as of this merge — except the ones the plan
      // flagged as a local edit ahead of the cloud, whose autosave base is the
      // cloud hash that is already stamped on them.
      const unsynced = new Set(plan.unsynced)
      for (const d of shown) {
        if (d.contentLoaded === false) continue
        if (unsynced.has(d.id)) continue
        lastSavedRef.current.set(d.id, syncedSnapshot(d))
      }

      const notices: string[] = [...plan.notices]

      if (plan.toImport.length) {
        try {
          let imported = 0
          for (let i = 0; i < plan.toImport.length; i += BUNDLE_IMPORT_BATCH_SIZE) {
            const chunk = plan.toImport.slice(i, i + BUNDLE_IMPORT_BATCH_SIZE)
            const res = await importMutation.mutateAsync({
              docs: chunk.map((d) => ({
                id: d.id,
                name: d.name,
                content: d.content,
                updatedAt: d.updatedAt,
                baseHash: null,
              })),
            })
            imported += res.imported
            for (const [id, hash] of Object.entries(res.hashes)) {
              setDocs((ds) => ds.map((x) => (x.id === id ? { ...x, baseHash: hash } : x)))
            }
          }
          if (imported > 0) notices.push(t('docs.importedCount', { n: imported }))
        } catch {
          // 本地副本仍在（state + 缓存），刷新后会重试
          notices.push(t('docs.importSomeFailed'))
        }
      }

      for (const copy of plan.toArchive) {
        try {
          const res = await saveToDraftsMutation.mutateAsync({
            id: copy.id,
            name: copy.name,
            content: copy.content,
            updatedAt: copy.updatedAt,
            baseHash: null,
          })
          if (res.ok && res.hash) {
            setDocs((ds) =>
              ds.map((x) =>
                x.id === copy.id ? { ...x, savedAt: res.savedAt ?? x.savedAt, baseHash: res.hash } : x,
              ),
            )
          }
        } catch {
          // The copy stays a local working copy; nothing is lost.
        }
      }

      setNotice(notices.length ? notices.join('\n') : null)
      setSyncState('synced')
      reconciledRef.current = true
      setSettled(true)
    }

    void run()
      .catch(() => {
        reconcilingRef.current = false
        setSettled(true)
        setSyncState('error')
        setNotice(t('docs.mergeFailed'))
      })
      .finally(() => {
        reconcilingRef.current = false
      })
  }, [enabled, listQuery.isSuccess, listQuery.data, trashQuery.isLoading, trashQuery.data, importMutation, saveToDraftsMutation, utils, t, localRetryVersion])

  // 3. 本地缓存始终跟着写一份（每次改动都写，纯本地，不碰网络）；
  //    只有真正拿到正文的稿件会进缓存，纯元数据的 stub 不写。
  useEffect(() => {
    if (!docs.length && !localTrash.length) return
    const requested = [...docs, ...localTrash]
    const requestedTrash = requested.filter((d) => d.deletedAt)
    const pageBase = [...localBaseRef.current.values()]
    void saveLocalDocs(requested, activeId, pageBase).then((result) => {
      if (result.ok) observeLocalReceipts(result.persisted)
      const { commit } = result
      if (!commit.changedIds.length && !commit.removed.length && !commit.copies.length) return

      const nextBase = new Map(localBaseRef.current)
      for (const doc of commit.docs) nextBase.set(doc.id, doc)
      for (const id of commit.removed) {
        if (!commit.docs.some((doc) => doc.id === id)) nextBase.delete(id)
      }
      localBaseRef.current = nextBase

      setDocs((current) =>
        mergeLocalCommit(current, requested.filter((d) => !d.deletedAt), commit)
          .filter((d) => !d.deletedAt),
      )
      setLocalTrash((current) =>
        mergeLocalCommit(current, requestedTrash, commit)
          .filter((d) => Boolean(d.deletedAt)),
      )

      const activeCopy = commit.copies.find((copy) => copy.originalId === activeIdRef.current)
      if (activeCopy) setActiveId(activeCopy.copyId)
      if (commit.conflicted) {
        const copyName =
          commit.docs.find((doc) => doc.id === (activeCopy?.copyId ?? commit.copies[0]?.copyId))?.name ??
          t('docs.localConflictCopy')
        setNotice(t('docs.localConflict', { name: copyName }))
      }
    })
  }, [docs, localTrash, activeId, t, localSaveRetry, observeLocalReceipts])

  useEffect(() => {
    if (activeId) saveActiveId(activeId)
  }, [activeId])

  // 4. 打开一篇还没取正文的稿件 → 拉正文。失败时不退回空编辑器，给出重试。
  const hydrateDoc = useCallback(
    async (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      // Only a cloud stub may be hydrated here. A failed local read or a
      // missing local body must never turn into a cloud lookup: the doc might
      // be local-only, and an empty result would delete it from the list.
      if (!doc || doc.contentLoaded !== false) return
      if (doc.bodyState === 'read-failed' || doc.bodyState === 'missing') return
      setHydrating(id)
      setHydrateError(null)
      try {
        const res = await utils.docs.get.fetch({ id })
        if (!res.doc) {
          // Purged from another device between the list arriving and now.
          setDocs((ds) => {
            const next = ds.filter((d) => d.id !== id)
            return next.length ? next : [createDoc()]
          })
          setNotice(t('docs.cloudGone'))
          return
        }
        const row = res.doc
        lastSavedRef.current.set(id, syncedSnapshot(row))
        setDocs((ds) =>
          ds.map((d) =>
            d.id === id && d.contentLoaded === false
              ? {
                  ...d,
                  name: row.name,
                  content: row.content,
                  updatedAt: row.updatedAt,
                  savedAt: row.savedAt,
                  source: row.source ?? null,
                  baseHash: row.hash,
                  contentLoaded: true,
                  bodyState: undefined,
                }
              : d,
          ),
        )
      } catch {
        setHydrateError({ id, message: t('docs.hydrateFailed') })
      } finally {
        setHydrating(null)
      }
    },
    [utils, t],
  )

  useEffect(() => {
    if (!enabled || !settled) return
    const doc = docs.find((d) => d.id === activeId)
    if (!doc || doc.contentLoaded !== false) return
    // Local read failures and missing bodies have their own retry, not a
    // cloud fetch.
    if (doc.bodyState !== undefined && doc.bodyState !== 'stub') return
    if (hydrating === doc.id || hydrateError?.id === doc.id) return
    void hydrateDoc(doc.id)
  }, [enabled, settled, docs, activeId, hydrating, hydrateError, hydrateDoc])

  /** Safety net: an open article that is no longer in the list falls back to one that is. */
  useEffect(() => {
    if (!settled || !docs.length) return
    if (!docs.some((d) => d.id === activeId)) setActiveId(docs[0].id)
  }, [docs, activeId, settled])

  // 5. Agent 推来的链接（?doc=<id>）优先于「上次看的那篇」，但要等合并落地。
  //    未登录时不消费它 —— 匿名根本看不到服务端的稿件，EditorPage 会先带她去
  //    登录，登录后再回到这个链接。
  useEffect(() => {
    const id = deepLinkRef.current
    if (!id || deepLinkDone.current || !enabled || !settled) return
    deepLinkDone.current = true
    deepLinkRef.current = null
    if (docs.some((d) => d.id === id)) {
      setActiveId(id)
      onDeepLinkSettled?.(true)
      return
    }
    void (async () => {
      try {
        const res = await utils.docs.get.fetch({ id })
        if (res.doc) {
          const row = res.doc
          const doc: DocRecord = {
            id: row.id,
            name: row.name,
            content: row.content,
            updatedAt: row.updatedAt,
            savedAt: row.savedAt,
            deletedAt: null,
            source: row.source ?? null,
            baseHash: row.hash,
            contentLoaded: true,
            bodyState: undefined,
          }
          lastSavedRef.current.set(doc.id, syncedSnapshot(doc))
          setDocs((ds) => (ds.some((x) => x.id === doc.id) ? ds : [doc, ...ds]))
          setActiveId(doc.id)
          onDeepLinkSettled?.(true)
        } else {
          setNotice(t('docs.linkMissing'))
          onDeepLinkSettled?.(false)
        }
      } catch {
        setNotice(t('docs.linkReadFailed'))
        onDeepLinkSettled?.(false)
      }
    })()
  }, [docs, settled, enabled, onDeepLinkSettled, utils, t])

  const flush = useCallback(
    async (ids: string[]) => {
      if (!enabled) return
      // 只把已经进过草稿箱的、且真的握着正文的稿件同步上去
      const targets = docs.filter(
        (d) =>
          ids.includes(d.id) &&
          d.savedAt !== null &&
          d.contentLoaded !== false &&
          !conflicts.has(d.id),
      )
      if (!targets.length) return
      setSyncState('saving')
      markCloudWrites(targets.map((d) => d.id), 1)
      const found: [string, ConflictCurrent][] = []
      try {
        for (const d of targets) {
          const res = await saveMutation.mutateAsync({
            id: d.id,
            name: d.name,
            content: d.content,
            updatedAt: d.updatedAt,
            baseHash: d.baseHash ?? null,
          })
          if (res.ok && res.missing) {
            // The row is gone server-side (deleted on another device). Keep
            // the article as a local, unarchived draft instead of retrying
            // forever or reviving it — re-archiving is the owner's call.
            setDocs((ds) => ds.map((x) => (x.id === d.id ? { ...x, savedAt: null } : x)))
            setNotice(t('docs.deletedInCloud', { name: d.name || t('common.unnamedDoc') }))
          } else if (!res.ok) {
            found.push([d.id, { ...res.current }])
          } else {
            lastSavedRef.current.set(d.id, syncedSnapshot(d))
            markCloudResult([d.id], false)
            setDocs((ds) =>
              ds.map((x) => (x.id === d.id ? { ...x, baseHash: res.hash, savedAt: res.savedAt ?? x.savedAt } : x)),
            )
          }
        }
        if (found.length) {
          setConflicts((prev) => {
            const next = new Map(prev)
            for (const [id, c] of found) next.set(id, c)
            return next
          })
          setSyncState('error')
        } else {
          setDirtyIds((prev) => {
            const next = new Set(prev)
            for (const d of targets) if (sameSyncedDocument(lastSavedRef.current.get(d.id), d)) next.delete(d.id)
            return next
          })
          setSyncState('synced')
        }
      } catch {
        markCloudResult(targets.filter((d) => !sameSyncedDocument(lastSavedRef.current.get(d.id), d)).map((d) => d.id), true)
        setSyncState('error')
        setNotice(t('docs.syncFailed'))
      } finally {
        markCloudWrites(targets.map((d) => d.id), -1)
      }
    },
    [enabled, docs, saveMutation, conflicts, t, markCloudWrites, markCloudResult],
  )

  // 6. 编辑后防抖同步（只针对已保存过、且正文在手、且没卡在冲突里的稿件）
  useEffect(() => {
    if (!enabled || !settled || !reconciledRef.current || syncState === 'loading') return
    const dirty = docs.filter(
      (d) =>
        d.contentLoaded !== false &&
        !conflicts.has(d.id) &&
        !sameSyncedDocument(lastSavedRef.current.get(d.id), d),
    )
    setDirtyIds((prev) => {
      const next = new Set<string>()
      for (const d of dirty) next.add(d.id)
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })

    const syncable = dirty.filter((d) => d.savedAt !== null)
    if (!syncable.length) {
      pendingRef.current.clear()
      return
    }
    for (const d of syncable) pendingRef.current.add(d.id)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const ids = [...pendingRef.current]
      pendingRef.current.clear()
      void flush(ids)
    }, 900)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [docs, enabled, settled, syncState, flush, conflicts])

  const addDoc = useCallback(() => {
    const d = createDoc()
    setDocs((ds) => [d, ...ds])
    setActiveId(d.id)
    return d
  }, [])

  const addSampleDoc = useCallback(() => {
    const d = createSampleDoc()
    setDocs((ds) => [d, ...ds])
    setActiveId(d.id)
    return d
  }, [])

  /** 保存到草稿箱：这是唯一让文章进入归档的动作。 */
  const saveCurrentToDrafts = useCallback(async () => {
    const doc = docs.find((d) => d.id === activeId)
    if (!doc) return { ok: false as const, message: t('docs.saveNoDoc') }
    if (!enabled) {
      return { ok: false as const, message: t('docs.saveNeedLogin') }
    }
    if (doc.contentLoaded === false) {
      return {
        ok: false as const,
        message:
          doc.bodyState === 'read-failed' || doc.bodyState === 'missing'
            ? t('docs.saveBodyUnavailable')
            : t('docs.saveLoading'),
      }
    }
    if (conflicts.has(doc.id)) {
      return { ok: false as const, message: t('docs.saveConflictFirst') }
    }
    setSyncState('saving')
    markCloudWrites([doc.id], 1)
    try {
      const res = await saveToDraftsMutation.mutateAsync({
        id: doc.id,
        name: doc.name,
        content: doc.content,
        updatedAt: doc.updatedAt,
        baseHash: doc.baseHash ?? null,
      })
      if (!res.ok) {
        setConflicts((prev) => new Map(prev).set(doc.id, { ...res.current }))
        setSyncState('error')
        return {
          ok: false as const,
          message: t('docs.saveConflictToast'),
        }
      }
      lastSavedRef.current.set(doc.id, syncedSnapshot(doc))
      markCloudResult([doc.id], false)
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
      setDocs((ds) =>
        ds.map((d) =>
          d.id === doc.id
            ? { ...d, savedAt: res.savedAt ?? d.savedAt, baseHash: res.hash ?? d.baseHash }
            : d,
        ),
      )
      await utils.docs.drafts.invalidate()
      setSyncState('synced')
      return { ok: true as const, savedAt: res.savedAt }
    } catch {
      markCloudResult([doc.id], true)
      setSyncState('error')
      return { ok: false as const, message: t('docs.saveFailed') }
    } finally {
      markCloudWrites([doc.id], -1)
    }
  }, [docs, activeId, enabled, conflicts, saveToDraftsMutation, utils, t, markCloudWrites, markCloudResult])

  /**
   * 移入回收站：列表里立刻消失。云端只做软删除，所以云端回收站能原样请回来；
   * 还没进云端的稿件（登录后新建、两次登录合并之间写的）则在任何登录状态下都
   * 进本机回收站。
   *
   * The body is copied into the local bin *before* the server answers. That copy
   * is the only thing that can bring back an article the account never had, and
   * it also covers a delete that fails or a row that was purged on another
   * device. Once the account confirms it trashed that row the local copy is
   * dropped again: from then on the account's bin is the truth, and a purge
   * there stays final.
   */
  const removeDoc = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id)
      if (!doc) return
      const holdsBody = doc.contentLoaded !== false
      // Written first: a request that hangs, or a tab closed mid-delete, must
      // never leave the body behind only in memory.
      if (holdsBody) {
        setLocalTrash((tr) => [{ ...doc, deletedAt: Date.now() }, ...tr.filter((d) => d.id !== id)])
      }
      const rest = docs.filter((d) => d.id !== id)
      const next = rest.length ? rest : [createDoc()]
      setDocs(next)
      if (activeId === id) setActiveId(next[0].id)
      lastSavedRef.current.delete(id)
      pendingRef.current.delete(id)
      setConflicts((prev) => {
        if (!prev.has(id)) return prev
        const map = new Map(prev)
        map.delete(id)
        return map
      })
      if (!enabled) return

      const pending = (async () => {
        try {
          const res = await removeMutation.mutateAsync({ id })
          if (res.removed) {
            // The account owns the only other copy now.
            setLocalTrash((tr) => tr.filter((d) => d.id !== id))
          }
          await utils.docs.trash.invalidate()
        } catch {
          setNotice(t(holdsBody ? 'docs.deleteSyncKeptLocal' : 'docs.deleteSyncFailed'))
          if (!holdsBody) {
            // Nothing local to fall back on: keep the article visible instead
            // of letting stale metadata erase the only pointer to its row.
            setDocs((ds) => (ds.some((d) => d.id === id) ? ds : [{ ...doc, deletedAt: null }, ...ds]))
          }
        }
      })()
      pendingRemoves.current.set(id, pending)
      void pending.finally(() => {
        if (pendingRemoves.current.get(id) === pending) pendingRemoves.current.delete(id)
      })
    },
    [docs, activeId, enabled, removeMutation, utils, t],
  )

  /**
   * 从回收站请回来。只有正文真的回到列表才返回 true。
   *
   * Where the article lives decides the path: a local-only article comes back
   * from this browser without touching the network; an article the account may
   * hold is restored by the server, with the local copy as the fallback when the
   * account has no row left. A cloud failure is reported and keeps the recovery
   * copy — never a success for a body that did not come back.
   */
  const restoreDoc = useCallback(
    async (id: string): Promise<boolean> => {
      const bringBack = (doc: DocRecord): boolean => {
        setLocalTrash((tr) => tr.filter((d) => d.id !== doc.id))
        setDocs((ds) => (ds.some((d) => d.id === doc.id) ? ds : [{ ...doc, deletedAt: null, recovery: { kind: 'restored', at: Date.now() } }, ...ds]))
        // Undo puts the article back on screen, not just in the list: a
        // success toast over a still-hidden article reads like it failed.
        setActiveId(doc.id)
        return true
      }
      // Already live: a failed delete put it back, or a second undo click.
      if (docsRef.current.some((d) => d.id === id)) return true
      const local = localTrashRef.current.find((d) => d.id === id) ?? null
      if (!enabled) return local ? bringBack(local) : false
      // An article that never reached the account is restored from its local
      // copy, network or not.
      if (local && !hasCloudCopy(local)) return bringBack(local)
      // A remove still in flight could land after the restore and trash the row
      // again; wait for it to settle first.
      const pendingRemove = pendingRemoves.current.get(id)
      if (pendingRemove) await pendingRemove
      if (docsRef.current.some((d) => d.id === id)) return true
      try {
        const { doc: row } = await restoreMutation.mutateAsync({ id })
        if (row) {
          // Prefer the body this browser last held (it may include edits the
          // account never saw), but never claim it is based on a version it is
          // not: a mismatched base turns the next save into a conflict instead
          // of a silent overwrite.
          const content = local?.content ?? row.content
          const name = local?.name ?? row.name
          const sameDocument = content === row.content && name === row.name
          const baseHash = sameDocument
            ? row.hash ?? local?.baseHash ?? null
            : local?.baseHash && local.baseHash === row.hash
              ? row.hash
              : null
          lastSavedRef.current.set(row.id, { name: local?.name ?? row.name, content })
          setDocs((ds) => {
            if (ds.some((d) => d.id === row.id)) return ds
            const restored: DocRecord = {
              id: row.id,
              name,
              content,
              updatedAt: Math.max(row.updatedAt.getTime(), local?.updatedAt ?? 0),
              savedAt: row.savedAt ? row.savedAt.getTime() : null,
              deletedAt: null,
              source: row.source ?? local?.source ?? null,
              baseHash,
              contentLoaded: true,
              bodyState: undefined,
              recovery: { kind: 'restored', at: Date.now() },
            }
            return [restored, ...ds]
          })
          setLocalTrash((tr) => tr.filter((d) => d.id !== id))
          setActiveId(row.id)
          await utils.docs.trash.invalidate()
          return true
        }
        // No row in the account: the local copy is the only copy left.
        if (local) return bringBack(local)
        setNotice(t('docs.restoreFailed'))
        return false
      } catch {
        // Keep the recovery copy: a restore that did not happen must not
        // consume it.
        setNotice(t('docs.restoreFailed'))
        return false
      }
    },
    [enabled, restoreMutation, utils, t],
  )

  /** The 10-second toast action; the bin page calls restoreDoc directly. */
  const undoRemove = useCallback((id: string) => restoreDoc(id), [restoreDoc])

  /** 彻底删除。图不会被连带删，它们会进素材库的「没在用的旧图」。 */
  const purgeDoc = useCallback(
    async (id: string): Promise<boolean> => {
      const local = localTrashRef.current.find((d) => d.id === id) ?? null
      if (!enabled) {
        if (!local) return false
        setLocalTrash((tr) => tr.filter((d) => d.id !== id))
        return true
      }
      // An account row may still exist (archived, imported, or a delete that
      // failed); it has to go too, or the next merge brings the article back. A
      // failed purge keeps the local copy for another attempt.
      if (!local || hasCloudCopy(local)) {
        try {
          await purgeMutation.mutateAsync({ id })
          await utils.docs.trash.invalidate()
        } catch {
          setNotice(t('docs.purgeFailed'))
          return false
        }
      }
      if (local) setLocalTrash((tr) => tr.filter((d) => d.id !== id))
      return true
    },
    [enabled, purgeMutation, utils, t],
  )

  /* ---- conflict resolution: nothing is discarded without this choice ---- */

  const clearConflict = useCallback((id: string) => {
    setConflicts((prev) => {
      if (!prev.has(id)) return prev
      const map = new Map(prev)
      map.delete(id)
      return map
    })
  }, [])

  /** 「保留我的版本」：拿云端最新的 hash 当 base，把本机内容显式写上去。 */
  const resolveConflictKeepLocal = useCallback(
    async (id: string) => {
      const current = conflicts.get(id)
      const doc = docs.find((d) => d.id === id)
      if (!current || !doc) return
      setSyncState('saving')
      markCloudWrites([id], 1)
      try {
        const res = await saveMutation.mutateAsync({
          id,
          name: doc.name,
          content: doc.content,
          updatedAt: Date.now(),
          baseHash: current.hash,
        })
        if (!res.ok) {
          // Somebody wrote again in the meantime; show the newest state.
          setConflicts((prev) => new Map(prev).set(id, { ...res.current }))
          setSyncState('error')
          return
        }
        lastSavedRef.current.set(id, syncedSnapshot(doc))
        markCloudResult([id], false)
        setDocs((ds) =>
          ds.map((x) => (x.id === id ? { ...x, baseHash: res.hash, savedAt: res.savedAt ?? x.savedAt } : x)),
        )
        clearConflict(id)
        setSyncState('synced')
        setNotice(t('docs.keptLocalOverCloud'))
      } catch {
        markCloudResult([id], true)
        setSyncState('error')
        setNotice(t('docs.conflictNetwork'))
      } finally {
        markCloudWrites([id], -1)
      }
    },
    [conflicts, docs, saveMutation, clearConflict, t, markCloudWrites, markCloudResult],
  )

  /** 「用云端版本」：本机内容被明确放弃（云端的正文在这里才第一次展示给用户）。 */
  const resolveConflictUseRemote = useCallback(
    (id: string) => {
      const current = conflicts.get(id)
      if (!current) return
      lastSavedRef.current.set(id, syncedSnapshot(current))
      setDocs((ds) =>
        ds.map((x) =>
          x.id === id
            ? {
                ...x,
                name: current.name,
                content: current.content,
                updatedAt: current.updatedAt,
                savedAt: current.savedAt,
                source: current.source,
                baseHash: current.hash,
                contentLoaded: true,
                bodyState: undefined,
              }
            : x,
        ),
      )
      clearConflict(id)
      setNotice(t('docs.switchedToCloud'))
    },
    [conflicts, clearConflict, t],
  )

  /** 「两边都留」：本机版本另存为一篇新稿件，云端版本回到原位。 */
  const resolveConflictKeepBoth = useCallback(
    async (id: string) => {
      const current = conflicts.get(id)
      const doc = docs.find((d) => d.id === id)
      if (!current || !doc) return
      setSyncState('saving')
      markCloudWrites([id], 1)
      const copyId = uid()
      const copy: DocRecord = {
        id: copyId,
        name: conflictCopyName(doc.name),
        content: doc.content,
        updatedAt: Date.now(),
        savedAt: null,
        deletedAt: null,
        source: doc.source ?? null,
        baseHash: null,
        contentLoaded: true,
        recovery: { kind: 'conflict', at: Date.now() },
      }
      try {
        const res = await saveToDraftsMutation.mutateAsync({
          id: copyId,
          name: copy.name,
          content: copy.content,
          updatedAt: copy.updatedAt,
          baseHash: null,
        })
        if (!res.ok || res.savedAt === null) {
          setSyncState('error')
          setNotice(t('docs.copySaveFailed'))
          return
        }
        const saved: DocRecord = { ...copy, savedAt: res.savedAt, baseHash: res.hash ?? null }
        lastSavedRef.current.set(copyId, syncedSnapshot(saved))
        markCloudResult([id, copyId], false)
        lastSavedRef.current.set(id, syncedSnapshot(current))
        setDocs((ds) => {
          const next = ds.map((x) =>
            x.id === id
              ? {
                  ...x,
                  name: current.name,
                  content: current.content,
                  updatedAt: current.updatedAt,
                  savedAt: current.savedAt,
                  source: current.source,
                  baseHash: current.hash,
                  contentLoaded: true,
                  bodyState: undefined,
                }
              : x,
          )
          const at = next.findIndex((x) => x.id === id)
          next.splice(at < 0 ? 0 : at + 1, 0, saved)
          return next
        })
        clearConflict(id)
        await utils.docs.drafts.invalidate()
        setSyncState('synced')
        setNotice(t('docs.copySavedAs', { name: saved.name }))
      } catch {
        markCloudResult([id], true)
        setSyncState('error')
        setNotice(t('docs.copySaveFailed'))
      } finally {
        markCloudWrites([id], -1)
      }
    },
    [conflicts, docs, saveToDraftsMutation, clearConflict, utils, t, markCloudWrites, markCloudResult],
  )

  /* ---- bulk hydration, for the whole-library backup export ---- */

  /**
   * Fetch bodies for every metadata-only stub, so a bundle export can never
   * silently contain an empty article. Hydrates only stubs, so concurrent
   * typing is never overwritten.
   */
  const hydrateAllForExport = useCallback(async (): Promise<
    { ok: true; docs: DocRecord[] } | { ok: false; message: string }
  > => {
    const current = docsRef.current
    // A backup must never turn an unknown body into an empty article. Only
    // cloud stubs can be fetched; anything else already went wrong locally.
    if (current.some((d) => d.contentLoaded === false && d.bodyState !== 'stub')) {
      return { ok: false, message: t('docs.exportLocalUnreadable') }
    }
    if (!enabled) return { ok: true, docs: current }
    const missing = current.filter((d) => d.contentLoaded === false)
    if (!missing.length) return { ok: true, docs: current }

    const fetched = new Map<
      string,
      { name: string; content: string; updatedAt: Date; savedAt: Date | null; source: string | null; hash: string | null }
    >()
    try {
      for (let i = 0; i < missing.length; i += 100) {
        const ids = missing.slice(i, i + 100).map((d) => d.id)
        const res = await utils.docs.getMany.fetch({ ids })
        for (const row of res.docs) fetched.set(row.id, row)
      }
    } catch {
      return { ok: false, message: t('docs.exportNetwork') }
    }
    if (missing.some((d) => !fetched.has(d.id))) {
      return { ok: false, message: t('docs.exportNetwork') }
    }

    const full = current.map((d) => {
      const row = fetched.get(d.id)
      if (!row) return d
      return {
        ...d,
        name: row.name,
        content: row.content,
        updatedAt: row.updatedAt.getTime(),
        savedAt: row.savedAt ? row.savedAt.getTime() : null,
        source: row.source ?? null,
        baseHash: row.hash,
        contentLoaded: true,
        bodyState: undefined,
      }
    })
    for (const [id, row] of fetched) lastSavedRef.current.set(id, syncedSnapshot(row))
    setDocs((ds) =>
      ds.map((d) => {
        const row = fetched.get(d.id)
        if (!row || d.contentLoaded !== false) return d
        return {
          ...d,
          name: row.name,
          content: row.content,
          updatedAt: row.updatedAt.getTime(),
          savedAt: row.savedAt ? row.savedAt.getTime() : null,
          source: row.source ?? null,
          baseHash: row.hash,
          contentLoaded: true,
          bodyState: undefined,
        }
      }),
    )
    return { ok: true, docs: full }
  }, [enabled, utils, t])

  const retryHydrate = useCallback(() => {
    const doc = docsRef.current.find((d) => d.id === activeIdRef.current)
    setHydrateError(null)
    if (doc && doc.contentLoaded === false) void hydrateDoc(doc.id)
  }, [hydrateDoc])

  const trashDocs = useMemo(() => {
    if (!enabled) return localTrash
    const cloud = (trashQuery.data ?? []).map(
      (t): DocRecord => ({
        id: t.id,
        name: t.name,
        content: '',
        updatedAt: 0,
        savedAt: t.savedAt ? t.savedAt.getTime() : null,
        deletedAt: t.deletedAt ? t.deletedAt.getTime() : null,
        contentLoaded: false,
      }),
    )
    const inCloud = new Set(cloud.map((d) => d.id))
    // Local-only deletions live here even with a session: the account's bin
    // cannot know about an article that was never pushed.
    return [...cloud, ...localTrash.filter((d) => !inCloud.has(d.id))]
  }, [enabled, trashQuery.data, localTrash])

  const refresh = useCallback(() => {
    void utils.docs.list.invalidate()
    void utils.docs.drafts.invalidate()
    void utils.docs.trash.invalidate()
  }, [utils])

  const activeDoc = docs.find((d) => d.id === activeId) || null
  // 保存过、但之后又改过内容 -> 提示需要再存一次
  const hasUnsavedChanges = Boolean(activeDoc && dirtyIds.has(activeDoc.id))
  const neverSaved = Boolean(activeDoc && activeDoc.savedAt === null)
  const activeConflict = activeDoc ? conflicts.get(activeDoc.id) ?? null : null
  // A body that failed to read, or is really absent, must not be edited as if
  // it were an empty article: the editor shows this instead of the text.
  const activeBodyError =
    activeDoc &&
    activeDoc.contentLoaded === false &&
    (activeDoc.bodyState === 'read-failed' || activeDoc.bodyState === 'missing')
      ? t(activeDoc.bodyState === 'read-failed' ? 'docs.bodyReadFailed' : 'docs.bodyMissing')
      : null

  const saveStatus = activeDoc ? articleSaveStatus({
    doc: activeDoc,
    enabled,
    settled: settled && reconciledRef.current,
    localReceipt: localReceipts.get(activeDoc.id),
    localFailed: !localFault.healthy,
    cloudVersion: lastSavedRef.current.get(activeDoc.id),
    cloudSaving: (cloudWrites.get(activeDoc.id) ?? 0) > 0,
    cloudFailed: cloudFailures.has(activeDoc.id),
    cloudLoadFailed: syncState === 'error' && !reconciledRef.current,
    conflict: Boolean(activeConflict),
  }) : null

  const retryCloudSave = async () => {
    const current = docsRef.current.find((doc) => doc.id === activeIdRef.current)
    if (!current || conflicts.has(current.id)) return
    if (!reconciledRef.current) {
      if (reconcilingRef.current) return
      setSyncState('loading')
      setSettled(false)
      await Promise.all([utils.docs.list.invalidate(), utils.docs.trash.invalidate()])
      // A failed merge may have kept an otherwise unchanged list in the query
      // cache. Retry reconciliation even when structural sharing reuses it.
      setLocalRetryVersion((version) => version + 1)
      return
    }
    if (current.savedAt === null) await saveCurrentToDrafts()
    else await flush([current.id])
  }

  return {
    docs,
    setDocs,
    activeId,
    setActiveId,
    activeDoc,
    activeLoading: Boolean(activeDoc && activeDoc.contentLoaded === false && hydrating === activeDoc.id),
    activeError:
      activeDoc && hydrateError?.id === activeDoc.id && activeDoc.contentLoaded === false
        ? hydrateError.message
        : null,
    activeBodyError,
    retryLocalBodies,
    retryingLocal,
    retryHydrate,
    activeConflict,
    resolveConflictKeepLocal,
    resolveConflictUseRemote,
    resolveConflictKeepBoth,
    hydrateAllForExport,
    trashDocs,
    // A failed local write is the one state the author must not have to guess
    // about, so it replaces whatever the cloud is doing.
    syncState: localFault.healthy ? syncState : ('local-error' as const),
    localFault,
    saveStatus,
    retryCloudSave,
    notice,
    clearNotice: () => setNotice(null),
    hasUnsavedChanges,
    neverSaved,
    dirtyCount: dirtyIds.size,
    addDoc,
    addSampleDoc,
    removeDoc,
    undoRemove,
    restoreDoc,
    purgeDoc,
    saveCurrentToDrafts,
    refresh,
  }
}
