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
 */
async function localDraftKeys(): Promise<string[]> {
  const out = new Set<string>()
  try {
    for (const d of (await loadDocs()).docs) {
      for (const m of d.content.matchAll(/img:([^\s)\]]+)/g)) out.add(m[1])
    }
    // A diagram's PNG is referenced only here: the fence in the document holds
    // mermaid source, so the server-side scan of 稿件 content cannot see it.
    for (const ref of loadDiagramCache().values()) out.add(ref.replace(/^img:/, ''))
  } catch {
    // 本地读不出来时，孤儿判定退回只看云端稿件
  }
  return [...out]
}

export default function Materials() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const utils = trpc.useUtils()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 图片按「账号或这台浏览器」归属，未登录也能看自己的
  const enabled = !authLoading
  // 本地草稿引用的图也算“在用”，避免误判成可清理的旧图
  const [draftKeys, setDraftKeys] = useState<string[] | null>(null)
  useEffect(() => {
    // StrictMode runs this twice; reading the drafts twice is harmless.
    void localDraftKeys().then(setDraftKeys)
  }, [])
  const stats = trpc.storage.stats.useQuery(undefined, { enabled, retry: false })
  const orphans = trpc.storage.orphans.useQuery(
    { alsoKeep: draftKeys ?? [] },
    // Reading the local drafts can fail; it is not a reason to leave the page empty.
    { enabled: enabled && draftKeys !== null, retry: false },
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

  const usagePct = stats.data && stats.data.quotaBytes > 0
    ? Math.min(100, (stats.data.totalBytes / stats.data.quotaBytes) * 100)
    : 0

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
              <span className="text-[12px] text-ink-3">{t('materials.oldest', { date: formatDate(stats.data?.oldestAt ?? null, lang) })}</span>
            </div>
            <div className="mt-3 flex items-end gap-4">
              <div>
                <p className="text-[26px] font-bold tabular-nums leading-none text-ink-1" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatBytes(stats.data?.totalBytes ?? 0)}
                </p>
                <p className="mt-1 text-[12px] text-ink-3">
                  {t('materials.total', { n: stats.data?.count ?? 0, size: formatBytes(stats.data?.quotaBytes ?? 0) })}
                </p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken" style={{ boxShadow: 'var(--shadow-inset)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(usagePct, stats.data?.count ? 1.5 : 0)}%`, background: usagePct > 85 ? 'var(--error-500)' : 'var(--primary-500)' }}
              />
            </div>
            <p className="mt-2 text-[11px] text-ink-3">
              {t('materials.r2Note')}
            </p>
          </section>
        ) : (
          <section className="ya-well p-5">
            <h2 className="text-[14px] font-semibold text-ink-1">{t('materials.browserTitle')}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              {t('materials.browserNote', { n: stats.data?.count ?? 0, size: formatBytes(stats.data?.totalBytes ?? 0) })}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {t('materials.dailyNote', { n: stats.data?.dailyImages ?? 0, size: formatBytes(stats.data?.dailyBytes ?? 0) })}
            </p>
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
              disabled={selectedOrphans.length === 0 || removeMutation.isPending}
              onClick={() => {
                if (!window.confirm(t('materials.cleanConfirm', { n: selectedOrphans.length }))) return
                removeMutation.mutate({ keys: selectedOrphans })
              }}
              className="ya-btn ya-btn-danger shrink-0"
            >
              {removeMutation.isPending ? t('materials.cleaning') : t('materials.cleanSelected', { n: selectedOrphans.length })}
            </button>
          </div>

          {orphans.isLoading ? (
            <p className="mt-4 text-[13px] text-ink-3">{t('common.loading')}</p>
          ) : orphanKeys.length === 0 ? (
            <p className="mt-4 rounded-xl bg-ok-100 p-3 text-[13px] text-ok-700">
              {t('materials.cleanEmpty')}
            </p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-3">
                <button
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
              <ul className="mt-2 divide-y divide-line-2">
                {(orphans.data ?? []).map((o) => (
                  <li key={o.key} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.key)}
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
          )}
        </section>

        {/* 全部图片 */}
        <section className="ya-well p-5">
          <h2 className="text-[14px] font-semibold text-ink-1">
            {t('materials.allImages')} <span className="font-normal text-ink-3">{t('materials.recent200')}</span>
          </h2>
          {files.isLoading ? (
            <p className="mt-3 text-[13px] text-ink-3">{t('common.loading')}</p>
          ) : (files.data ?? []).length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-3">{t('materials.empty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2">
              {(files.data ?? []).map((f) => {
                const inUse = !orphanKeys.includes(f.key)
                return (
                  <li key={f.key} className="flex items-center gap-3 py-2">
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
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${
                        inUse ? 'bg-ok-100 text-ok-700' : 'bg-warn-100 text-warn-700'
                      }`}
                    >
                      {inUse ? t('materials.inUse') : t('materials.notInUse')}
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
