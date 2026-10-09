/**
 * 主题收藏：一串主题 id，存在浏览器 localStorage 里。
 *
 * 存 id 而不是索引：主题库增删时已存的收藏不会被挤位。主题被移除后，
 * 它的 id 会留在存储里但在界面上不出现（读取时按当前 catalog 过滤），
 * 下一次写入时顺手清掉——界面上永远不会有幽灵条目。
 *
 * 页面之间的一致性靠模块内的快照 + 订阅：模板库和顶栏快速切换器读的是
 * 同一份 useSyncExternalStore 快照，同一次会话里两边同时改也会立刻互见。
 */

const FAVORITES_KEY = 'mopai.theme-favorites.v1'

/** 把存储里读到的任意值整理成干净的 id 列表；格式坏了就退化成空列表。 */
export function sanitizeFavoriteIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 只保留当前 catalog 里存在的 id，顺序不变。 */
export function keepKnownIds(ids: readonly string[], known: ReadonlySet<string>): string[] {
  return ids.filter((id) => known.has(id))
}

/** 加/减一个 id。收藏在前、后加的都排在后面，保持稳定顺序。 */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export function loadFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return raw ? sanitizeFavoriteIds(JSON.parse(raw)) : []
  } catch {
    // 读不出来的收藏不值得打断任何事，当空处理；下一次写入会覆盖它。
    return []
  }
}

let cache: string[] | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

/** 当前快照（useSyncExternalStore 的 getSnapshot）。同一个引用直到下次写入才变。 */
export function favoritesSnapshot(): string[] {
  cache ??= loadFavoriteIds()
  return cache
}

let storageBound = false
function bindStorage(): void {
  if (storageBound || typeof window === 'undefined') return
  storageBound = true
  // 另一个标签页改了收藏时让本页跟上（storage 事件只在别的标签页触发）。
  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== FAVORITES_KEY) return
    cache = null
    notify()
  })
}

export function subscribeFavorites(fn: () => void): () => void {
  bindStorage()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 整体替换并落盘。写失败时内存里的值仍然生效，只是这个浏览器记不住。 */
export function setFavoriteIds(ids: readonly string[]): void {
  cache = [...ids]
  notify()
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(cache))
  } catch {
    // 收藏只有几 KB，写不进去意味着整个 localStorage 满了——稿件存储
    // 那条线已经在顶栏把这件事说出来了，这里再弹一次只会吵。
  }
}

export function __resetFavoritesForTests(): void {
  cache = null
  listeners.clear()
}
