import { useCallback, useEffect, useState } from 'react'
import type { Theme } from '@/lib/theme-kit'
import { goldenTheme } from '@/lib/themes-core'
import { getCachedTheme, loadTheme } from '@/lib/theme-api'

export interface ActiveThemeState {
  /** 当前可用实现：导入主题的 pack 还没到时先用 golden 兜底，编辑与保存不受影响。 */
  theme: Theme
  loading: boolean
  error: Error | null
  retry: () => void
}

/**
 * 当前主题的实现。自研/手写主题同步命中；导入主题只加载它所属的那个 pack，
 * 不把 219 套主题的样式代码塞进首屏。
 *
 * 加载失败时保留 golden 兜底并暴露 error，调用方给出可重试的提示；重试会重新
 * 发起 dynamic import（theme-api 不会缓存 rejected Promise）。
 */
export function useActiveTheme(themeId: string): ActiveThemeState {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ id: string; theme: Theme } | null>(null)
  const [failure, setFailure] = useState<{ id: string; error: Error } | null>(null)

  // 缓存命中在渲染期直接读取，不走 effect 里的同步 setState：切换主题时
  // 已加载过的实现立即显示，新来源才需要进入异步加载。
  const cached = getCachedTheme(themeId)
  const loadedNow = loaded?.id === themeId ? loaded.theme : null
  const theme = cached ?? loadedNow ?? goldenTheme
  const error = failure?.id === themeId ? failure.error : null
  const loading = !cached && !loadedNow && !error

  useEffect(() => {
    if (getCachedTheme(themeId)) return
    let alive = true
    loadTheme(themeId)
      .then((next) => {
        if (!alive) return
        setLoaded({ id: themeId, theme: next })
        setFailure(null)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setFailure({
          id: themeId,
          error: reason instanceof Error ? reason : new Error(String(reason)),
        })
      })
    return () => {
      alive = false
    }
  }, [themeId, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { theme, loading, error, retry }
}