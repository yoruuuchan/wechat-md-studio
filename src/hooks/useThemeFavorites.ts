import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { KNOWN_THEME_IDS } from '@/lib/theme-catalog'
import {
  favoritesSnapshot,
  keepKnownIds,
  setFavoriteIds,
  subscribeFavorites,
  toggleId,
} from '@/lib/favorites'

/**
 * 收藏状态 + 切换函数。模板库卡片和顶栏快速切换器共用它：
 * 两边订阅同一份快照，任何一边的改动立即反映到另一边。
 *
 * 已知 id 来自 metadata 目录而不是完整主题注册表，所以首屏不必为了过滤
 * 幽灵收藏去下载 219 套主题实现。
 */
export function useThemeFavorites() {
  const stored = useSyncExternalStore(subscribeFavorites, favoritesSnapshot, favoritesSnapshot)
  const ids = useMemo(() => keepKnownIds(stored, KNOWN_THEME_IDS), [stored])
  const favorites = useMemo(() => new Set(ids), [ids])
  const toggle = useCallback((id: string) => {
    // 写入时顺手把已失效的 id 清掉，存储里不会无限积攒幽灵条目。
    setFavoriteIds(toggleId(keepKnownIds(favoritesSnapshot(), KNOWN_THEME_IDS), id))
  }, [])
  return { favorites, ids, count: ids.length, toggle }
}
