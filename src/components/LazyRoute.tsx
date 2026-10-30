import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { YoruMark } from '@/components/YoruMark'
import { useI18n } from '@/hooks/useI18n'

type PageModule = { default: ComponentType }
type PageLoader = () => Promise<PageModule>

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="ya-page flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <YoruMark height={22} />
      {children}
    </div>
  )
}

function PageFallback() {
  const { t } = useI18n()
  return (
    <PageShell>
      <p className="text-[13px] text-ink-3">{t('common.loading')}</p>
    </PageShell>
  )
}

/**
 * 分块加载失败的可见出口。文案只承诺实现兑现得了的事：正文与本地稿件
 * 在 IndexedDB / localStorage 里，不随一次页面分块失败消失。
 */
function PageLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <PageShell>
      <div className="max-w-md">
        <p className="text-[15px] font-semibold text-ink-1">{t('common.pageLoadFailed')}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{t('common.pageLoadFailedDesc')}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onRetry} className="ya-btn ya-btn-primary">
          {t('common.retry')}
        </button>
        <button type="button" onClick={() => window.location.reload()} className="ya-btn ya-btn-secondary">
          {t('common.refresh')}
        </button>
      </div>
    </PageShell>
  )
}

/**
 * 一次路由分块的加载器。
 *
 * 用显式的 state 而不是 React.lazy：lazy 会把 rejected Promise 记在实例上，
 * 重渲染不会重新请求；这里重试时由父组件换 key 重挂，dynamic import 真的
 * 再发一次。失败的 theme-api 同样不缓存 rejected Promise，两条链路口径一致。
 */
function ChunkPage({ loader, onRetry }: { loader: PageLoader; onRetry: () => void }) {
  const [Page, setPage] = useState<ComponentType | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let alive = true
    // 放进微任务再调用：分块被拦截时 Vite 的 preload 包装有可能同步抛错，
    // 直接调用会让 React 把整个根卸载（白屏）；统一收敛到 catch 里。
    Promise.resolve()
      .then(loader)
      .then((module) => {
        if (!alive) return
        // 被拦截的 preload 在某些浏览器路径上会 resolve 成 undefined，而不是
        // reject；把检查放在这里，才能落进下面的 catch 显示错误页。
        // 状态里存的是组件函数，必须用 updater 返回它：setPage(component)
        // 会被 React 当成 updater 调用，等于在 setState 里执行页面组件（hooks 崩）。
        if (!module) throw new Error('page chunk loaded without a module')
        const page = module.default
        if (typeof page !== 'function') {
          throw new Error('page chunk loaded without a component')
        }
        setPage(() => page)
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason : new Error(String(reason)))
      })
    return () => {
      alive = false
    }
  }, [loader])

  if (error) return <PageLoadError onRetry={onRetry} />
  if (!Page) return <PageFallback />
  return <Page />
}

export function LazyRoute({ loader }: { loader: PageLoader }) {
  const [attempt, setAttempt] = useState(0)
  return <ChunkPage key={attempt} loader={loader} onRetry={() => setAttempt((n) => n + 1)} />
}