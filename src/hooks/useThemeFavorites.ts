import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { THEMES } from '@/lib/themes'
import {
  favoritesSnapshot,
  keepKnownIds,
  setFavoriteIds,
  subscribeFavorites,
  toggleId,
} from '@/lib/favorites'

/** 当前 catalog 的真实 id 集合；存储里的旧 id 用它过滤。 */
const KNOWN_THEME_IDS = new Set(THEMES.map((t) => t.id))

/**
 * 收藏状态 + 切换函数。模板库卡片和顶栏快速切换器共用它：
 * 两边订阅同一份快照，任何一边的改动立即反映到另一边。
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
