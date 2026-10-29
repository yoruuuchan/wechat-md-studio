// 主题实现的按需加载接口。
//
// 首屏只需要当前主题的实现；主题库和顶栏切换器需要全部 219 套。把 pack 的
// dynamic import 集中在这里，调用点拿到的是缓存后的 Promise，重复请求不会
// 发起第二次下载。失败时从缓存里删掉该来源，重试会真正再请求一次，而不是
// 把 rejected Promise 一直留在缓存里。
import type { Theme } from './theme-kit'
import { CORE_THEMES, goldenTheme } from './themes-core'
import { EXTRA_THEMES } from './themes-extra'
import { IMPORTED_THEME_CATALOG } from './themes-imported/catalog'
import {
  IMPORTED_SOURCE_ORDER,
  THEME_SOURCE_LOADERS,
  type ImportedThemeSource,
} from './themes-imported/loaders'

const LOCAL_THEMES: Theme[] = [...CORE_THEMES, ...EXTRA_THEMES]
const LOCAL_BY_ID = new Map(LOCAL_THEMES.map((theme) => [theme.id, theme]))

const SOURCE_BY_ID = new Map<string, ImportedThemeSource>()
for (const entry of IMPORTED_THEME_CATALOG) {
  if (entry.source) SOURCE_BY_ID.set(entry.id, entry.source as ImportedThemeSource)
}

const loadedThemes = new Map<string, Theme>()
const sourcePromises = new Map<ImportedThemeSource, Promise<Theme[]>>()
const loadedSources = new Map<ImportedThemeSource, Theme[]>()

async function loadSource(source: ImportedThemeSource): Promise<Theme[]> {
  const done = loadedSources.get(source)
  if (done) return done

  const pending = sourcePromises.get(source)
  if (pending) return pending

  const promise = Promise.resolve()
    .then(() => THEME_SOURCE_LOADERS[source]())
    .then((themes) => {
      loadedSources.set(source, themes)
      for (const theme of themes) loadedThemes.set(theme.id, theme)
      return themes
    })
    .catch((error) => {
      // 失败不能被缓存成永久结论：调用方点重试时要真的重新请求。
      sourcePromises.delete(source)
      throw error
    })
  sourcePromises.set(source, promise)
  return promise
}

/** 已经加载过的主题实现；没加载过返回 null，调用方先用目录条目渲染。 */
export function getCachedTheme(id: string): Theme | null {
  return LOCAL_BY_ID.get(id) ?? loadedThemes.get(id) ?? null
}

/**
 * 取一套主题的实现：自研/手写主题同步命中，导入主题按所属 pack 懒加载。
 * 未知 id 回落到 golden，与旧 getTheme 的行为一致。
 */
export async function loadTheme(id: string): Promise<Theme> {
  const local = LOCAL_BY_ID.get(id)
  if (local) return local

  const cached = loadedThemes.get(id)
  if (cached) return cached

  const source = SOURCE_BY_ID.get(id)
  if (!source) return goldenTheme

  const themes = await loadSource(source)
  return themes.find((theme) => theme.id === id) ?? goldenTheme
}

let allThemesPromise: Promise<Theme[]> | null = null

/** 全部 219 套实现，顺序与完整注册表一致；供主题库和顶栏快速切换器使用。 */
export function loadAllThemes(): Promise<Theme[]> {
  allThemesPromise ??= Promise.all(IMPORTED_SOURCE_ORDER.map(loadSource))
    .then(() => [
      ...LOCAL_THEMES,
      ...IMPORTED_SOURCE_ORDER.flatMap((source) => loadedSources.get(source) ?? []),
    ])
    .catch((error) => {
      allThemesPromise = null
      throw error
    })
  return allThemesPromise
}