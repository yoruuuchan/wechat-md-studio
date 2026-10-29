import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { loadDocs } from '@/lib/store'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { loadDiagramCache } from '@/lib/diagram'
import { useI18n } from '@/hooks/useI18n'

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(ts: number | null, lang: 'zh' | 'en'): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(lang === 'en' ? 'en-CA' : 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/**
 * Image keys referenced by drafts that only exist in this browser. The server
 * cannot see them, so without this an image someone is still working on would
 * be offered up as an orphan.
 *
 * Bodies live in IndexedDB now, so this is a promise: the orphan query waits for
 * it rather than running with an empty keep-list and calling live images dead.
 * `ok: false` means the local side could not be fully read (a failed body-store
 * read or a throwing loader), so "not referenced locally" is unknown rather
 * than false: the caller must not offer batch deletion on that answer.
 */
async function localDraftKeys(): Promise<{ keys: string[]; ok: boolean }> {
  const out = new Set<string>()
  try {
    const loaded = await loadDocs()
    for (const d of loaded.docs) {
      for (const m of d.content.matchAll(/img:([^\s)\]]+)/g)) out.add(m[1])
    }
    // A diagram's PNG is referenced only here: the fence in the document holds
    // mermaid source, so the server-side scan of 稿件 content cannot see it.
    for (const ref of loadDiagramCache().values()) out.add(ref.replace(/^img:/, ''))
    return { keys: [...out], ok: !loaded.bodyReadFailed }
  } catch {
    return { keys: [], ok: false }
  }
}

/** A browser network failure is already explained by the section copy. */
function errorDetail(error: { message?: string } | null | undefined): string | null {
  const message = error?.message?.trim()
  if (!message) return null
  if (/^(failed to fetch|networkerror|load failed|fetch failed)$/i.test(message)) return null
  return message
}

function SectionError({
  scope,
  title,
  hint,
  error,
  retrying,
  onRetry,
}: {
  scope: string
  title: string
  hint: string
  error?: { message?: string } | null
  retrying: boolean
  onRetry: () => void
}) {
  const { t } = useI18n()
  const detail = errorDetail(error)
  return (
    <div data-materials-error={scope} role="alert" className="mt-4 rounded-xl bg-bad-100 p-3 text-bad-700">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed">{hint}</p>
      {detail ? <p className="mt-1 break-words text-[11px] opacity-80">{detail}</p> : null}
      <button
        type="button"
        data-materials-retry={scope}
        disabled={retrying}
        onClick={onRetry}
        className="ya-btn ya-btn-secondary ya-btn-sm mt-2"
      >
        {retrying ? t('materials.retrying') : t('materials.retry')}
      </button>
    </div>
  )
}

/** Loaded data is still worth showing, but it must not look current. */
function StaleNote({ scope, text }: { scope: string; text: string }) {
  return (
    <p
      data-materials-stale={scope}
      className="mt-3 rounded-lg bg-warn-100 px-3 py-2 text-[12px] leading-relaxed text-warn-700"
    >
      {text}
    </p>
  )
}

export default function Materials() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const utils = trpc.useUtils()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 图片按「账号或这台浏览器」归属，未登录也能看自己的
  const enabled = !authLoading
  // 本地草稿引用的图也算“在用”，避免误判成可清理的旧图。
  // `null` = 本机草稿还在扫描，引用状态尚未确定。
  const [draftScan, setDraftScan] = useState<{ keys: string[]; ok: boolean } | null>(null)
  useEffect(() => {
    // StrictMode runs this twice; reading the drafts twice is harmless.
    let alive = true
    void localDraftKeys().then((next) => {
      if (alive) setDraftScan(next)
    })
    return () => {
      alive = false
    }
  }, [])
  const rescanDraftKeys = () => {
    setDraftScan(null)
    void localDraftKeys().then(setDraftScan)
  }

  const stats = trpc.storage.stats.useQuery(undefined, { enabled, retry: false })
  const orphans = trpc.storage.orphans.useQuery(
    { alsoKeep: draftScan?.keys ?? [] },
    // Waiting for the local scan is what keeps it from calling a local-only
    // reference dead. A failed scan still asks the server, so cloud references
    // stay visible, but the page marks the answer incomplete.
    { enabled: enabled && draftScan !== null, retry: false },
  )
  const files = trpc.storage.list.useQuery(undefined, { enabled, retry: false })

  const removeMutation = trpc.storage.removeOrphans.useMutation({
    onSuccess: async (res) => {
      setSelected(new Set())
      await Promise.all([
        utils.storage.stats.invalidate(),
        utils.storage.orphans.invalidate(),
        utils.storage.list.invalidate(),
      ])
      const freed = t('materials.freed', { size: formatBytes(res.freedBytes) })
      // 没删掉的连账目一起留着，说清楚它们还在，别让人以为清干净了
      if (res.failed.length) {
        toast.warning(t('materials.cleanPartial', { n: res.deleted, m: res.failed.length }), {
          description: t('materials.cleanPartialDesc', { freed }),
        })
        return
      }
      toast.success(t('materials.cleanDone', { n: res.deleted }), {
        description: res.skipped.length
          ? t('materials.cleanSkipped', { freed, n: res.skipped.length })
          : freed,
      })
    },
    onError: () => toast.error(t('materials.cleanFailed')),
  })

  const removeOneMutation = trpc.storage.remove.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.storage.stats.invalidate(),
        utils.storage.orphans.invalidate(),
        utils.storage.list.invalidate(),
      ])
      toast.success(t('materials.deleted'))
    },
    // 服务端只在图床确认删掉之后才销账；失败时这张图仍在列表里，原因也带回来
    onError: (e) => toast.error(t('materials.deleteFailed'), { description: e.message }),
  })

  const orphanKeys = useMemo(() => (orphans.data ?? []).map((o) => o.key), [orphans.data])
  const selectedOrphans = orphanKeys.filter((k) => selected.has(k))

  const statsData = stats.data
  const usagePct = statsData && statsData.quotaBytes > 0
    ? Math.min(100, (statsData.totalBytes / statsData.quotaBytes) * 100)
    : 0

  const statsNumbers = statsData ? (
    <>
      <div className="mt-3 flex items-end gap-4">
        <div>
          <p className="text-[26px] font-bold tabular-nums leading-none text-ink-1" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatBytes(statsData.totalBytes)}
          </p>
          <p className="mt-1 text-[12px] text-ink-3">
            {t('materials.total', { n: statsData.count, size: formatBytes(statsData.quotaBytes) })}
          </p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken" style={{ boxShadow: 'var(--shadow-inset)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(usagePct, statsData.count ? 1.5 : 0)}%`, background: usagePct > 85 ? 'var(--error-500)' : 'var(--primary-500)' }}
        />
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        {t('materials.r2Note')}
      </p>
    </>
  ) : null

  const draftScanFailed = draftScan?.ok === false
  // Only a finished local scan plus a finished server check knows which images
  // are free to delete. Every other combination is "unknown", never "unused".
  const referenceReady = draftScan?.ok === true && orphans.isSuccess
  const referenceState: 'ready' | 'checking' | 'unknown' = referenceReady
    ? 'ready'
    : draftScan === null || orphans.isLoading
      ? 'checking'
      : 'unknown'
  const referenceLoading = draftScan === null || orphans.isLoading

  if (authLoading) {
    return (
      <Shell onBack={() => navigate('/')}>
        <p className="text-[13px] text-ink-4">{t('common.loading')}</p>
      </Shell>
    )
  }

  return (
    <Shell onBack={() => navigate('/')}>
      <div className="space-y-4">
        {/* 用量 */}
        {isAuthenticated ? (
          <section className="ya-well p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[14px] font-semibold text-ink-1">{t('materials.usage')}</h2>
              {statsData ? (
                <span className="text-[12px] text-ink-3">{t('materials.oldest', { date: formatDate(statsData.oldestAt, lang) })}</span>
              ) : null}
            </div>
            {stats.isLoading ? (
              <p data-materials-loading="stats" className="mt-3 text-[13px] text-ink-3">{t('common.loading')}</p>
            ) : null}
            {stats.isError ? (
              <SectionError
                scope="stats"
                title={t('materials.statsFailed')}
                hint={t('materials.statsFailedHint')}
                error={stats.error}
                retrying={stats.isFetching}
                onRetry={() => { void stats.refetch() }}
              />
            ) : null}
            {stats.isError && statsData ? <StaleNote scope="stats" text={t('materials.staleNote')} /> : null}
            {!stats.isLoading ? statsNumbers : null}
          </section>
        ) : (
          <section className="ya-well p-5">
            <h2 className="text-[14px] font-semibold text-ink-1">{t('materials.browserTitle')}</h2>
            {stats.isLoading ? (
              <p data-materials-loading="stats" className="mt-3 text-[13px] text-ink-3">{t('common.loading')}</p>
            ) : null}
            {stats.isError ? (
              <SectionError
                scope="stats"
                title={t('materials.statsFailed')}
                hint={t('materials.statsFailedHint')}
                error={stats.error}
                retrying={stats.isFetching}
                onRetry={() => { void stats.refetch() }}
              />
            ) : null}
            {stats.isError && statsData ? <StaleNote scope="stats" text={t('materials.staleNote')} /> : null}
            {statsData ? (
              <>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                  {t('materials.browserNote', { n: statsData.count, size: formatBytes(statsData.totalBytes) })}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  {t('materials.dailyNote', { n: statsData.dailyImages ?? 0, size: formatBytes(statsData.dailyBytes ?? 0) })}
                </p>
              </>
            ) : null}
          </section>
        )}

        {/* 没在用的旧图 */}
        <section className="ya-well p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-ink-1">{t('materials.orphans')}</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                {t('materials.orphansNote')}
              </p>
            </div>
            <button
              data-materials-clean
              disabled={!referenceReady || selectedOrphans.length === 0 || removeMutation.isPending}
              onClick={() => {
                if (!referenceReady) return
                if (!window.confirm(t('materials.cleanConfirm', { n: selectedOrphans.length }))) return
                removeMutation.mutate({ keys: selectedOrphans })
              }}
              className="ya-btn ya-btn-danger shrink-0"
            >
              {removeMutation.isPending ? t('materials.cleaning') : t('materials.cleanSelected', { n: selectedOrphans.length })}
            </button>
          </div>

          {referenceLoading ? (
            <p data-materials-loading="orphans" className="mt-4 text-[13px] text-ink-3">{t('common.loading')}</p>
          ) : null}

          {!referenceLoading && draftScanFailed ? (
            <SectionError
              scope="drafts"
              title={t('materials.draftScanFailed')}
              hint={t('materials.draftScanFailedHint')}
              retrying={false}
              onRetry={rescanDraftKeys}
            />
          ) : null}

          {!referenceLoading && orphans.isError ? (
            <SectionError
              scope="orphans"
              title={t('materials.orphansFailed')}
              hint={t('materials.orphansFailedHint')}
              error={orphans.error}
              retrying={orphans.isFetching}
              onRetry={() => { void orphans.refetch() }}
            />
          ) : null}

          {!referenceLoading && orphans.isError && orphans.data ? (
            <StaleNote scope="orphans" text={t('materials.staleNote')} />
          ) : null}

          {!referenceLoading && !orphans.isError && draftScanFailed && orphans.isSuccess ? (
            <StaleNote scope="drafts" text={t('materials.draftScanIncomplete')} />
          ) : null}

          {!referenceLoading && referenceReady && orphanKeys.length === 0 ? (
            <p data-materials-clean-empty className="mt-4 rounded-xl bg-ok-100 p-3 text-[13px] text-ok-700">
              {t('materials.cleanEmpty')}
            </p>
          ) : null}

          {!referenceLoading && orphanKeys.length > 0 ? (
            <>
              {referenceReady ? (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    data-materials-select-all
                    onClick={() => setSelected(new Set(orphanKeys))}
                    className="ya-link-btn !text-[12px] !text-brand"
                  >
                    {t('materials.selectAll', { n: orphanKeys.length })}
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="ya-link-btn !text-[12px]"
                  >
                    {t('materials.clearSelection')}
                  </button>
                </div>
              ) : (
                <p data-materials-readonly className="mt-3 text-[12px] leading-relaxed text-warn-700">
                  {t('materials.cleanBlocked')}
                </p>
              )}
              <ul className="mt-2 divide-y divide-line-2">
                {(orphans.data ?? []).map((o) => (
                  <li key={o.key} data-materials-orphan-item={o.key} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.key)}
                      disabled={!referenceReady}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(o.key)
                          else next.delete(o.key)
                          return next
                        })
                      }}
                      className="h-3.5 w-3.5 shrink-0 accent-brand"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-ink-1" title={o.key}>{o.name || o.key}</p>
                      <p className="text-[11px] text-ink-3">
                        {formatBytes(o.size)} · {formatDate(o.createdAt.getTime(), lang)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {/* 全部图片 */}
        <section className="ya-well p-5">
          <h2 className="text-[14px] font-semibold text-ink-1">
            {t('materials.allImages')} <span className="font-normal text-ink-3">{t('materials.recent200')}</span>
          </h2>

          {files.isError ? (
            <SectionError
              scope="files"
              title={t('materials.filesFailed')}
              hint={t('materials.filesFailedHint')}
              error={files.error}
              retrying={files.isFetching}
              onRetry={() => { void files.refetch() }}
            />
          ) : null}
          {files.isError && files.data ? <StaleNote scope="files" text={t('materials.staleNote')} /> : null}

          {files.isLoading ? (
            <p data-materials-loading="files" className="mt-3 text-[13px] text-ink-3">{t('common.loading')}</p>
          ) : (files.data ?? []).length === 0 ? (
            files.isSuccess ? (
              <p data-materials-files-empty className="mt-3 text-[13px] text-ink-3">{t('materials.empty')}</p>
            ) : null
          ) : (
            <ul className="mt-2 divide-y divide-line-2">
              {(files.data ?? []).map((f) => {
                const inUse = referenceReady ? !orphanKeys.includes(f.key) : null
                return (
                  <li key={f.key} data-materials-file-item={f.key} className="flex items-center gap-3 py-2">
                    <img
                      src={`/api/img/${encodeURIComponent(f.key)}`}
                      alt={f.name || f.key}
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                      style={{ boxShadow: 'var(--shadow-flat)' }}
                      onError={(e) => {
                        // 已经被微信转存的图、或刚被删的图，这里显示一个淡占位
                        ;(e.target as HTMLImageElement).style.visibility = 'hidden'
                      }}
                    />
                    <span
                      data-materials-reference={f.key}
                      title={inUse === null && referenceState === 'unknown' ? t('materials.referenceUnknownHint') : undefined}
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${
                        inUse === null
                          ? referenceState === 'unknown'
                            ? 'bg-warn-100 text-warn-700'
                            : 'bg-surface-sunken text-ink-3'
                          : inUse
                            ? 'bg-ok-100 text-ok-700'
                            : 'bg-warn-100 text-warn-700'
                      }`}
                    >
                      {inUse === null
                        ? referenceState === 'unknown'
                          ? t('materials.referenceUnknown')
                          : t('materials.referenceChecking')
                        : inUse
                          ? t('materials.inUse')
                          : t('materials.notInUse')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-ink-1" title={f.key}>{f.name || f.key}</p>
                      <p className="text-[11px] text-ink-3">
                        {formatBytes(f.size)} · {formatDate(f.createdAt.getTime(), lang)}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (!window.confirm(t('materials.deleteConfirm'))) return
                        removeOneMutation.mutate({ key: f.key })
                      }}
                      className="ya-link-btn danger shrink-0"
                    >
                      {t('common.delete')}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      <Toaster position="bottom-center" />
    </Shell>
  )
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
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
          <span className="whitespace-nowrap text-[15px] font-bold tracking-wide text-ink-1">{t('materials.title')}</span>
          <span className="ya-eyebrow hidden sm:inline">materials</span>
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
