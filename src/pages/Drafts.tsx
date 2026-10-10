import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { loadActiveId, loadDocs, saveActiveId, saveDocs, type DocRecord } from '@/lib/store'
import { UNDO_DELETE_MS } from '@/hooks/useDocs'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/hooks/useI18n'

/**
 * 草稿箱列表由服务端派生：卡片的字数、图片数、轮播数、小标题都是在服务端
 * 从正文算好再发过来的，正文本身（content）不随列表下发——「复制 md」和
 * 打开稿件这两处真正需要全文的动作才去 docs.get 取。
 */

/** Rows per request; "加载更多" appends the next page. */
const PAGE_SIZE = 100

interface DraftCard {
  id: string
  name: string
  savedAt: number
  chars: number
  images: number
  carousels: number
  headings: string[]
  hasImages: boolean
  /** `agent:<token name>` when it arrived through /api/agent; null when written here. */
  source: string | null
}

function formatDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface BinRow {
  id: string
  name: string
  deletedAt: number
}

function BinSection({
  rows,
  onRestore,
  onPurge,
}: {
  rows: BinRow[]
  onRestore: (id: string) => void
  onPurge: (id: string, name: string) => void
}) {
  const { t } = useI18n()
  if (!rows.length) return null
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold tracking-wide text-[#0E1525]">{t('drafts.bin')}</h2>
        <span className="text-[11px] text-[#6B7793]">
          {t('drafts.binCount', { n: rows.length })}
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="ya-well flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#394560]">
                {row.name || t('common.unnamedDoc')}
              </p>
              <p className="text-[11px] text-[#6B7793]" style={{ fontFamily: 'var(--font-mono)' }}>
                {t('drafts.deletedAt', { time: formatDate(row.deletedAt) })}
              </p>
            </div>
            <button
              onClick={() => onRestore(row.id)}
              className="ya-btn-secondary ya-btn ya-btn-sm shrink-0"
            >
              {t('drafts.restore')}
            </button>
            <button onClick={() => onPurge(row.id, row.name)} className="ya-link-btn danger shrink-0">
              {t('drafts.purge')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Drafts() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const utils = trpc.useUtils()
  const [query, setQuery] = useState('')
  /** The debounced copy of `query`; the server does the matching. */
  const [serverQuery, setServerQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiesBusy, setCopiesBusy] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'savedAt' | 'chars' | 'images'>('savedAt')
  const [onlyWithImages, setOnlyWithImages] = useState(false)
  /** Pages fetched after the first one, oldest press of 加载更多 last. */
  const [more, setMore] = useState<DraftCard[]>([])
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setServerQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  // Any filter change starts a fresh first page.
  useEffect(() => {
    setMore([])
  }, [serverQuery, sortBy, onlyWithImages])

  const draftsQuery = trpc.docs.drafts.useQuery(
    { q: serverQuery, sort: sortBy, withImages: onlyWithImages, limit: PAGE_SIZE, offset: 0 },
    { enabled: isAuthenticated, retry: false },
  )
  const trashQuery = trpc.docs.trash.useQuery(undefined, { enabled: isAuthenticated, retry: false })
  const removeMutation = trpc.docs.remove.useMutation({
    onSuccess: async () => {
      await utils.docs.trash.invalidate()
      await utils.docs.drafts.invalidate()
      await utils.docs.list.invalidate()
    },
    onError: () => toast.error(t('drafts.deleteFailed')),
  })
  const restoreMutation = trpc.docs.restore.useMutation({
    onSuccess: async () => {
      await utils.docs.trash.invalidate()
      await utils.docs.drafts.invalidate()
      await utils.docs.list.invalidate()
    },
    onError: () => toast.error(t('drafts.restoreFailed')),
  })
  const purgeMutation = trpc.docs.purge.useMutation({
    onSuccess: async () => {
      await utils.docs.trash.invalidate()
    },
    onError: () => toast.error(t('drafts.purgeFailed')),
  })

  /** 移入回收站；撤销走 restore，10 秒窗口之外还能在回收站里找回。 */
  const deleteDraft = (card: DraftCard) => {
    removeMutation.mutate({ id: card.id })
    setMore((m) => m.filter((c) => c.id !== card.id))
    toast(t('drafts.deletedToast', { name: card.name || t('common.unnamedDoc') }), {
      description: t('drafts.deletedToastDesc'),
      duration: UNDO_DELETE_MS,
      action: {
        label: t('common.undo'),
        onClick: () => restoreMutation.mutate({ id: card.id }),
      },
    })
  }

  // Signed-out visitors keep their bin in localStorage; without this the only
  // way back from a delete there would be the 10-second toast.
  const [localBin, setLocalBin] = useState<BinRow[]>([])
  const [localDocs, setLocalDocs] = useState<DocRecord[] | null>(null)
  useEffect(() => {
    // StrictMode runs this twice; the load is idempotent, so both runs may land.
    void loadDocs().then(({ docs }) => {
      setLocalDocs(docs)
      setLocalBin(
        docs
          .filter((d) => d.deletedAt)
          .map((d) => ({ id: d.id, name: d.name, deletedAt: d.deletedAt as number })),
      )
    })
  }, [])
  const rewriteLocal = async (fn: (docs: DocRecord[]) => DocRecord[]) => {
    const current = localDocs ?? (await loadDocs()).docs
    const next = fn(current)
    setLocalDocs(next)
    setLocalBin(
      next
        .filter((d) => d.deletedAt)
        .map((d) => ({ id: d.id, name: d.name, deletedAt: d.deletedAt as number })),
    )
    await saveDocs(next, loadActiveId())
  }
  const restoreBin = (id: string) => {
    if (isAuthenticated) restoreMutation.mutate({ id })
    else void rewriteLocal((ds) => ds.map((d) => (d.id === id ? { ...d, deletedAt: null } : d)))
  }
  const purgeBin = (id: string, name: string) => {
    if (!window.confirm(t('drafts.purgeConfirm', { name: name || t('common.unnamedDoc') }))) return
    if (isAuthenticated) purgeMutation.mutate({ id })
    else void rewriteLocal((ds) => ds.filter((d) => d.id !== id))
  }
  const binRows: BinRow[] = isAuthenticated
    ? (trashQuery.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt ? row.deletedAt.getTime() : 0,
      }))
    : localBin

  const items = useMemo(() => {
    const seen = new Set<string>()
    const out: DraftCard[] = []
    for (const c of [...(draftsQuery.data?.items ?? []), ...more]) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }
    return out
  }, [draftsQuery.data, more])
  const total = draftsQuery.data?.total ?? 0

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return
    setLoadingMore(true)
    try {
      const res = await utils.docs.drafts.fetch({
        q: serverQuery,
        sort: sortBy,
        withImages: onlyWithImages,
        limit: PAGE_SIZE,
        offset: items.length,
      })
      setMore((m) => [...m, ...res.items])
    } catch {
      toast.error(t('drafts.loadMoreFailed'))
    } finally {
      setLoadingMore(false)
    }
  }

  /** 打开这篇：记住「上次看的那篇」，回到编辑器；正文由编辑器按需拉取。 */
  const openDraft = (card: DraftCard) => {
    saveActiveId(card.id)
    navigate('/')
  }

  const copyBody = async (card: DraftCard) => {
    setCopiesBusy(card.id)
    try {
      const res = await utils.docs.get.fetch({ id: card.id })
      if (!res.doc) {
        toast.error(t('drafts.copyGone'))
        return
      }
      await navigator.clipboard.writeText(res.doc.content)
      setCopiedId(card.id)
      setTimeout(() => setCopiedId(null), 1500)
      toast.success(t('drafts.copyDone'))
    } catch {
      toast.error(t('common.copyFailed'))
    } finally {
      setCopiesBusy(null)
    }
  }

  if (authLoading) {
    return (
      <Shell onBack={() => navigate('/')} count={null}>
        <p className="text-[13px] text-ink-3">{t('common.loading')}</p>
      </Shell>
    )
  }

  if (!isAuthenticated) {
    return (
      <Shell onBack={() => navigate('/')} count={null}>
        <div className="ya-well p-6">
          <p className="text-[13px] leading-relaxed text-ink-2">
            {t('drafts.loginNeeded')}
          </p>
          <button
            onClick={() => navigate('/login')}
            className="ya-btn ya-btn-primary mt-4"
          >
            {t('drafts.goLogin')}
          </button>
        </div>
        <BinSection rows={binRows} onRestore={restoreBin} onPurge={purgeBin} />
      </Shell>
    )
  }

  return (
    <Shell onBack={() => navigate('/')} count={total}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('drafts.search')}
          className="ya-input min-w-0 flex-1"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          title={t('drafts.sortTitle')}
          className="ya-input shrink-0 cursor-pointer appearance-none !w-auto pr-8"
        >
          <option value="savedAt">{t('drafts.sort.savedAt')}</option>
          <option value="chars">{t('drafts.sort.chars')}</option>
          <option value="images">{t('drafts.sort.images')}</option>
        </select>
        <label className="ya-btn-ghost ya-btn shrink-0 cursor-pointer !gap-1.5">
          <input
            type="checkbox"
            checked={onlyWithImages}
            onChange={(e) => setOnlyWithImages(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand"
          />
          {t('drafts.onlyWithImages')}
        </label>
        <button
          onClick={() => navigate('/')}
          className="ya-btn ya-btn-primary shrink-0"
        >
          {t('drafts.new')}
        </button>
      </div>

      {draftsQuery.isLoading ? (
        <p className="text-[13px] text-ink-3">{t('common.loading')}</p>
      ) : total === 0 ? (
        <div className="ya-well p-8 text-center">
          <p className="text-[13px] font-medium text-ink-2">
            {serverQuery || onlyWithImages ? t('drafts.emptyFiltered') : t('drafts.empty')}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            {t('drafts.emptyHint')}<br />
            {t('drafts.emptyHint2')}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {items.map((card) => (
              <li key={card.id} className="ya-well p-4">
                <div className="flex items-start gap-3">
                  <button onClick={() => openDraft(card)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[14px] font-semibold text-ink-1">{card.name || t('common.unnamedDoc')}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>
                      <span>{t('drafts.savedAt', { time: formatDate(card.savedAt) })}</span>
                      <span className="text-ink-4">·</span>
                      <span>{t('drafts.chars', { n: card.chars })}</span>
                      <span className="text-ink-4">·</span>
                      <span>{t('drafts.images', { n: card.images })}</span>
                      {card.carousels > 0 && (
                        <>
                          <span className="text-ink-4">·</span>
                          <span>{t('drafts.carousels', { n: card.carousels })}</span>
                        </>
                      )}
                      {card.source?.startsWith('agent:') && (
                        <>
                          <span className="text-black/15">·</span>
                          <span title={t('drafts.agentTitle')}>
                            {t('drafts.agent', { name: card.source.slice('agent:'.length) })}
                          </span>
                        </>
                      )}
                    </p>
                    {card.headings.length > 0 && (
                      <p className="mt-2 truncate text-[12px] text-ink-2">
                        {card.headings.join(' / ')}
                      </p>
                    )}
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      onClick={() => openDraft(card)}
                      className="ya-btn-secondary ya-btn ya-btn-sm"
                    >
                      {t('drafts.open')}
                    </button>
                    <button
                      onClick={() => void copyBody(card)}
                      className="ya-link-btn"
                    >
                      {copiesBusy === card.id ? t('common.loading') : copiedId === card.id ? t('common.copied') : t('drafts.copyMd')}
                    </button>
                    <button
                      onClick={() => deleteDraft(card)}
                      className="ya-link-btn danger"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="ya-btn ya-btn-secondary"
              >
                {loadingMore ? t('common.loading') : t('drafts.loadMore', { n: total - items.length })}
              </button>
            </div>
          )}
        </>
      )}

      <BinSection rows={binRows} onRestore={restoreBin} onPurge={purgeBin} />
      <Toaster position="bottom-center" />
    </Shell>
  )
}

function Shell({
  children,
  onBack,
  count,
}: {
  children: React.ReactNode
  onBack: () => void
  count: number | null
}) {
  const { t } = useI18n()
  return (
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <button
          onClick={onBack}
          className="ya-btn-secondary ya-btn ya-btn-sm !h-8 shrink-0"
        >
          ← {t('common.backToEditor')}
        </button>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="whitespace-nowrap text-[15px] font-bold tracking-wide text-ink-1">{t('drafts.title')}</span>
          <span className="ya-eyebrow hidden sm:inline">drafts</span>
          {count !== null && <span className="text-[12px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>{t('drafts.count', { n: count })}</span>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}
