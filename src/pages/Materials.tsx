import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { loadDocs } from '@/lib/store'
import { ThemeToggle } from '@/components/ThemeToggle'
import { loadDiagramCache } from '@/lib/diagram'

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
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
      const freed = `腾出 ${formatBytes(res.freedBytes)}`
      // 没删掉的连账目一起留着，说清楚它们还在，别让人以为清干净了
      if (res.failed.length) {
        toast.warning(`已清理 ${res.deleted} 张，${res.failed.length} 张没删掉`, {
          description: `${freed}；没删掉的图还在素材库里，可以重试`,
        })
        return
      }
      toast.success(`已清理 ${res.deleted} 张图`, {
        description: res.skipped.length
          ? `${freed}；${res.skipped.length} 张仍被稿件引用，已跳过`
          : freed,
      })
    },
    onError: () => toast.error('清理失败，稍后再试'),
  })

  const removeOneMutation = trpc.storage.remove.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.storage.stats.invalidate(),
        utils.storage.orphans.invalidate(),
        utils.storage.list.invalidate(),
      ])
      toast.success('已删除')
    },
    // 服务端只在图床确认删掉之后才销账；失败时这张图仍在列表里，原因也带回来
    onError: (e) => toast.error('删除失败', { description: e.message }),
  })

  const orphanKeys = useMemo(() => (orphans.data ?? []).map((o) => o.key), [orphans.data])
  const selectedOrphans = orphanKeys.filter((k) => selected.has(k))

  const usagePct = stats.data && stats.data.quotaBytes > 0
    ? Math.min(100, (stats.data.totalBytes / stats.data.quotaBytes) * 100)
    : 0

  if (authLoading) {
    return <Shell onBack={() => navigate('/')}><p className="text-[13px] text-ink-4">读取中…</p></Shell>
  }

  return (
    <Shell onBack={() => navigate('/')}>
      <div className="space-y-4">
        {/* 用量 */}
        {isAuthenticated ? (
          <section className="ya-well p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[14px] font-semibold text-ink-1">存储用量</h2>
              <span className="text-[12px] text-ink-3">最近一张 {formatDate(stats.data?.oldestAt ?? null)} 之前</span>
            </div>
            <div className="mt-3 flex items-end gap-4">
              <div>
                <p className="text-[26px] font-bold tabular-nums leading-none text-ink-1" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatBytes(stats.data?.totalBytes ?? 0)}
                </p>
                <p className="mt-1 text-[12px] text-ink-3">
                  共 {stats.data?.count ?? 0} 张 · 上限 {formatBytes(stats.data?.quotaBytes ?? 0)}
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
              图片存在 Cloudflare R2，按整个桶计量。这里显示的是本工具自己记的账。
            </p>
          </section>
        ) : (
          <section className="ya-well p-5">
            <h2 className="text-[14px] font-semibold text-ink-1">这台浏览器上传的图</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              共 {stats.data?.count ?? 0} 张 · {formatBytes(stats.data?.totalBytes ?? 0)}。
              上传不用登录，图片按浏览器归属；换设备或清掉站点数据就看不到了。
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              每 24 小时最多 {stats.data?.dailyImages ?? 0} 张 / {formatBytes(stats.data?.dailyBytes ?? 0)}——
              图床是共享的免费额度，用完明天自动恢复。
            </p>
          </section>
        )}

        {/* 没在用的旧图 */}
        <section className="ya-well p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-ink-1">没在用的旧图</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                已经存进云端稿件里的图不在此列。删掉后公众号里已粘贴的文章不受影响——微信发布时已经把图转存到它自己的服务器了。
              </p>
            </div>
            <button
              disabled={selectedOrphans.length === 0 || removeMutation.isPending}
              onClick={() => {
                if (!window.confirm(`删掉选中的 ${selectedOrphans.length} 张图？这一步不能撤销。`)) return
                removeMutation.mutate({ keys: selectedOrphans })
              }}
              className="ya-btn ya-btn-danger shrink-0"
            >
              {removeMutation.isPending ? '清理中…' : `清理选中 (${selectedOrphans.length})`}
            </button>
          </div>

          {orphans.isLoading ? (
            <p className="mt-4 text-[13px] text-ink-3">读取中…</p>
          ) : orphanKeys.length === 0 ? (
            <p className="mt-4 rounded-xl bg-ok-100 p-3 text-[13px] text-ok-700">
              干净，没有多余的图。
            </p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => setSelected(new Set(orphanKeys))}
                  className="ya-link-btn !text-[12px] !text-brand"
                >
                  全选 {orphanKeys.length} 张
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="ya-link-btn !text-[12px]"
                >
                  清空选择
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
                        {formatBytes(o.size)} · {formatDate(o.createdAt.getTime())}
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
          <h2 className="text-[14px] font-semibold text-ink-1">全部图片 <span className="font-normal text-ink-3">（最近 200 张）</span></h2>
          {files.isLoading ? (
            <p className="mt-3 text-[13px] text-ink-3">读取中…</p>
          ) : (files.data ?? []).length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-3">还没有上传过图片。</p>
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
                      {inUse ? '在用' : '没在用'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-ink-1" title={f.key}>{f.name || f.key}</p>
                      <p className="text-[11px] text-ink-3">
                        {formatBytes(f.size)} · {formatDate(f.createdAt.getTime())}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (!window.confirm('删掉这张图？引用了它的稿件会显示裂图。')) return
                        removeOneMutation.mutate({ key: f.key })
                      }}
                      className="ya-link-btn danger shrink-0"
                    >
                      删除
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
  return (
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-3 px-4">
        <button
          onClick={onBack}
          className="ya-btn-secondary ya-btn ya-btn-sm !h-8"
        >
          ← 回到编辑器
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-wide text-ink-1">素材库</span>
          <span className="ya-eyebrow">materials</span>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}
