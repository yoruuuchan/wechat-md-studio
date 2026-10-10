import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '@/providers/trpc'
import {
  createDoc,
  createSampleDoc,
  loadActiveId,
  loadDocs,
  persistenceStatus,
  saveActiveId,
  saveDocs,
  subscribePersistence,
  uid,
  type DocRecord,
  type PersistenceStatus,
} from '@/lib/store'
import { conflictCopyName, planMerge, type RemoteDocMeta } from '@/lib/docs-merge'

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
 * 并发靠内容 hash：每篇稿子带着最后一次同步的 baseHash，保存时服务端比对，
 * 对不上就回一个 conflict（不会被覆盖），由这里弹窗让用户决定保留哪边。
 *
 * 正文按需加载：列表只给元数据，打开哪篇才拉哪篇的正文（contentLoaded=false
 * 的 stub 不参与编辑和自动保存，也不会写进本地缓存）。
 */
export function useDocs({ enabled, deepLinkId, onDeepLinkSettled }: Options) {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [activeId, setActiveId] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  /** 内容变过但还没写进数据库的稿件 id，用来点亮保存按钮。 */
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  /**
   * Trashed docs this browser holds while anonymous. Once signed in the server's
   * bin is the truth and this stays empty; purely local trashed drafts (never
   * saved) live here so they survive a reload.
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
  /**
   * True once we know where we stand relative to the cloud: after the merge
   * completes, or right away when there is no account to merge with. Autosave
   * stays off until then so no pre-merge base ever races the merge itself.
   */
  const [settled, setSettled] = useState(!enabled)

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
  const lastSavedRef = useRef<Map<string, string>>(new Map())
  const docsRef = useRef<DocRecord[]>([])
  docsRef.current = docs
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

  // 1. 首次加载：先显示本地缓存（匿名时它就是全部真相）
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    // No cancellation guard on purpose: StrictMode mounts effects twice in
    // development, and dropping the result of the first run - the only one that
    // loads - would leave the editor empty.
    void loadDocs().then((local) => {
      setLocalTrash(local.docs.filter((d) => d.deletedAt))
      const live = local.docs.filter((d) => !d.deletedAt)
      const shown = live.length ? live : [createDoc()]
      setDocs(shown)
      setActiveId(shown.some((d) => d.id === local.activeId) ? local.activeId : shown[0].id)
    })
    if (!enabled) setSyncState('local')
  }, [enabled])

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
    setNotice('读取云端稿件失败，当前在本地编辑；浏览器里的稿件都还在')
  }, [enabled, settled, listQuery.isError])

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
        lastSavedRef.current.set(d.id, d.content)
      }

      const notices: string[] = [...plan.notices]

      if (plan.toImport.length) {
        try {
          let imported = 0
          for (let i = 0; i < plan.toImport.length; i += 100) {
            const chunk = plan.toImport.slice(i, i + 100)
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
          if (imported > 0) notices.push(`已把浏览器里的 ${imported} 篇稿件同步到账号`)
        } catch {
          // 本地副本仍在（state + 缓存），刷新后会重试
          notices.push('有几篇本地稿件没同步上，内容都还在浏览器里，稍后刷新会自动重试')
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
        setNotice('云端稿件合并失败，当前在本地编辑；浏览器里的稿件都还在')
      })
      .finally(() => {
        reconcilingRef.current = false
      })
  }, [enabled, listQuery.isSuccess, listQuery.data, trashQuery.isLoading, trashQuery.data, importMutation, saveToDraftsMutation, utils])

  // 3. 本地缓存始终跟着写一份（每次改动都写，纯本地，不碰网络）；
  //    只有真正拿到正文的稿件会进缓存，纯元数据的 stub 不写。
  useEffect(() => {
    if (!docs.length && !localTrash.length) return
    void saveDocs([...docs, ...localTrash], activeId)
  }, [docs, localTrash, activeId])

  useEffect(() => {
    if (activeId) saveActiveId(activeId)
  }, [activeId])

  // 4. 打开一篇还没取正文的稿件 → 拉正文。失败时不退回空编辑器，给出重试。
  const hydrateDoc = useCallback(
    async (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (!doc || doc.contentLoaded !== false) return
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
          setNotice('这篇稿件在云端已经不在了，已从列表里移除')
          return
        }
        const row = res.doc
        lastSavedRef.current.set(id, row.content)
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
                }
              : d,
          ),
        )
      } catch {
        setHydrateError({ id, message: '这篇稿件的正文没读下来，检查一下网络' })
      } finally {
        setHydrating(null)
      }
    },
    [utils],
  )

  useEffect(() => {
    if (!enabled || !settled) return
    const doc = docs.find((d) => d.id === activeId)
    if (!doc || doc.contentLoaded !== false) return
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
          }
          lastSavedRef.current.set(doc.id, doc.content)
          setDocs((ds) => (ds.some((x) => x.id === doc.id) ? ds : [doc, ...ds]))
          setActiveId(doc.id)
          onDeepLinkSettled?.(true)
        } else {
          setNotice('链接指向的稿件不在这个账号里，可能已经被删掉了')
          onDeepLinkSettled?.(false)
        }
      } catch {
        setNotice('链接指向的稿件没读下来，检查网络后再点一次')
        onDeepLinkSettled?.(false)
      }
    })()
  }, [docs, settled, enabled, onDeepLinkSettled, utils])

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
            setNotice(`「${d.name || '未命名稿件'}」在云端已被删除，已转为本地稿；需要时点「保存到草稿箱」重新归档`)
          } else if (!res.ok) {
            found.push([d.id, { ...res.current }])
          } else {
            lastSavedRef.current.set(d.id, d.content)
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
            for (const d of targets) if (lastSavedRef.current.get(d.id) === d.content) next.delete(d.id)
            return next
          })
          setSyncState('synced')
        }
      } catch {
        setSyncState('error')
        setNotice('有一处改动没同步上，稍后会自动重试')
      }
    },
    [enabled, docs, saveMutation, conflicts],
  )

  // 6. 编辑后防抖同步（只针对已保存过、且正文在手、且没卡在冲突里的稿件）
  useEffect(() => {
    if (!enabled || !settled || syncState === 'loading') return
    const dirty = docs.filter(
      (d) =>
        d.contentLoaded !== false &&
        !conflicts.has(d.id) &&
        lastSavedRef.current.get(d.id) !== d.content,
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
    if (!doc) return { ok: false as const, message: '没有打开的稿件' }
    if (!enabled) {
      return { ok: false as const, message: '未登录：草稿箱需要登录后才能用，当前内容已存在浏览器里' }
    }
    if (doc.contentLoaded === false) {
      return { ok: false as const, message: '这篇还在从云端读取，等它读出来再存' }
    }
    if (conflicts.has(doc.id)) {
      return { ok: false as const, message: '这篇在别处被改过：先在弹窗里选一个处理方式' }
    }
    setSyncState('saving')
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
          message: '这篇在别处被改过：云端的版本没有被覆盖，弹窗里选一下保留哪边',
        }
      }
      lastSavedRef.current.set(doc.id, doc.content)
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
      setSyncState('error')
      return { ok: false as const, message: '保存失败，检查一下网络' }
    }
  }, [docs, activeId, enabled, conflicts, saveToDraftsMutation, utils])

  /**
   * 移入回收站：列表里立刻消失，但服务端只做软删除，所以回收站能原样请回来。
   * 未登录时回收站只存在这个浏览器里。
   */
  const removeDoc = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id)
      if (!doc) return
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
      if (enabled) {
        removeMutation
          .mutateAsync({ id })
          .then(() => utils.docs.trash.invalidate())
          .catch(() => setNotice('删除没同步到云端，回收站里可能还看不到'))
      } else {
        setLocalTrash((t) => [{ ...doc, deletedAt: Date.now() }, ...t])
      }
    },
    [docs, activeId, enabled, removeMutation, utils],
  )

  /** 从回收站请回来。匿名时是纯本地操作。 */
  const restoreDoc = useCallback(
    async (id: string): Promise<boolean> => {
      const local = localTrash.find((d) => d.id === id)
      if (local) {
        setLocalTrash((t) => t.filter((d) => d.id !== id))
        setDocs((ds) => (ds.some((d) => d.id === id) ? ds : [{ ...local, deletedAt: null }, ...ds]))
        return true
      }
      if (!enabled) return false
      try {
        const row = (await restoreMutation.mutateAsync({ id })).doc
        if (row) {
          lastSavedRef.current.set(row.id, row.content)
          setDocs((ds) =>
            ds.some((d) => d.id === row.id)
              ? ds
              : [
                  {
                    id: row.id,
                    name: row.name,
                    content: row.content,
                    updatedAt: row.updatedAt.getTime(),
                    savedAt: row.savedAt ? row.savedAt.getTime() : null,
                    deletedAt: null,
                    source: row.source ?? null,
                    baseHash: row.hash ?? null,
                    contentLoaded: true,
                  },
                  ...ds,
                ],
          )
        }
        await utils.docs.trash.invalidate()
        return true
      } catch {
        setNotice('恢复失败，稍后再试')
        return false
      }
    },
    [localTrash, enabled, restoreMutation, utils],
  )

  /** The 10-second toast action; the bin page calls restoreDoc directly. */
  const undoRemove = useCallback((id: string) => restoreDoc(id), [restoreDoc])

  /** 彻底删除。图不会被连带删，它们会进素材库的「没在用的旧图」。 */
  const purgeDoc = useCallback(
    async (id: string): Promise<boolean> => {
      if (localTrash.some((d) => d.id === id)) {
        setLocalTrash((t) => t.filter((d) => d.id !== id))
        return true
      }
      if (!enabled) return false
      try {
        await purgeMutation.mutateAsync({ id })
        await utils.docs.trash.invalidate()
        return true
      } catch {
        setNotice('彻底删除失败，稍后再试')
        return false
      }
    },
    [localTrash, enabled, purgeMutation, utils],
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
        lastSavedRef.current.set(id, doc.content)
        setDocs((ds) =>
          ds.map((x) => (x.id === id ? { ...x, baseHash: res.hash, savedAt: res.savedAt ?? x.savedAt } : x)),
        )
        clearConflict(id)
        setSyncState('synced')
        setNotice('已用你这一版覆盖云端')
      } catch {
        setSyncState('error')
        setNotice('处理冲突时网络出错了，这一版还在编辑器和本地缓存里')
      }
    },
    [conflicts, docs, saveMutation, clearConflict],
  )

  /** 「用云端版本」：本机内容被明确放弃（云端的正文在这里才第一次展示给用户）。 */
  const resolveConflictUseRemote = useCallback(
    (id: string) => {
      const current = conflicts.get(id)
      if (!current) return
      lastSavedRef.current.set(id, current.content)
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
              }
            : x,
        ),
      )
      clearConflict(id)
      setNotice('已换成云端的版本')
    },
    [conflicts, clearConflict],
  )

  /** 「两边都留」：本机版本另存为一篇新稿件，云端版本回到原位。 */
  const resolveConflictKeepBoth = useCallback(
    async (id: string) => {
      const current = conflicts.get(id)
      const doc = docs.find((d) => d.id === id)
      if (!current || !doc) return
      setSyncState('saving')
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
          setNotice('另存失败，本机这一版还在编辑器和本地缓存里，稍后再试一次')
          return
        }
        const saved: DocRecord = { ...copy, savedAt: res.savedAt, baseHash: res.hash ?? null }
        lastSavedRef.current.set(id, current.content)
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
        setNotice(`本机那一版已经另存为「${saved.name}」，云端版本保持原样`)
      } catch {
        setSyncState('error')
        setNotice('另存失败，本机这一版还在编辑器和本地缓存里，稍后再试一次')
      }
    },
    [conflicts, docs, saveToDraftsMutation, clearConflict, utils],
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
    if (!enabled) return { ok: true, docs: docsRef.current }
    const current = docsRef.current
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
      return { ok: false, message: '有几篇稿件的正文没读下来，检查网络后再导出' }
    }
    if (missing.some((d) => !fetched.has(d.id))) {
      return { ok: false, message: '有几篇稿件的正文没读下来，检查网络后再导出' }
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
      }
    })
    for (const [id, row] of fetched) lastSavedRef.current.set(id, row.content)
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
        }
      }),
    )
    return { ok: true, docs: full }
  }, [enabled, utils])

  const retryHydrate = useCallback(() => {
    const doc = docsRef.current.find((d) => d.id === activeIdRef.current)
    setHydrateError(null)
    if (doc && doc.contentLoaded === false) void hydrateDoc(doc.id)
  }, [hydrateDoc])

  const trashDocs = useMemo(
    () =>
      enabled
        ? (trashQuery.data ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            content: '',
            updatedAt: 0,
            savedAt: t.savedAt ? t.savedAt.getTime() : null,
            deletedAt: t.deletedAt ? t.deletedAt.getTime() : null,
          }))
        : localTrash,
    [enabled, trashQuery.data, localTrash],
  )

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
