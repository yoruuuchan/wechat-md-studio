// 主题实现的按需加载接口。
//
// 首屏只需要当前主题的实现；主题库和顶栏切换器需要全部 227 套。把 pack 的
// dynamic import 集中在这里，调用点拿到的是缓存后的 Promise，重复请求不会
// 发起第二次下载。失败时从缓存里删掉该来源，重试会真正再请求一次，而不是
// 把 rejected Promise 一直留在缓存里。
//
// 自研主题（golden 兜底在其中）随首屏同步可用；手写与设计主题和导入 pack
// 一样按模块懒加载，模块归属来自生成的 themes-local-catalog.ts。
import type { Theme } from './theme-kit'
import { CORE_THEMES, goldenTheme } from './themes-core'
import { LOCAL_THEME_MODULE } from './themes-local-catalog'
import { IMPORTED_THEME_CATALOG } from './themes-imported/catalog'
import {
  IMPORTED_SOURCE_ORDER,
  THEME_SOURCE_LOADERS,
  type ImportedThemeSource,
} from './themes-imported/loaders'

const CORE_BY_ID = new Map(CORE_THEMES.map((theme) => [theme.id, theme]))

type LazyLocalModule = 'extra' | 'design'
const LAZY_LOCAL_ORDER: readonly LazyLocalModule[] = ['extra', 'design']
const LAZY_LOCAL_LOADERS: Record<LazyLocalModule, () => Promise<Theme[]>> = {
  extra: () => import('./themes-extra').then((module) => module.EXTRA_THEMES),
  design: () => import('./themes-design').then((module) => module.DESIGN_THEMES),
}

const SOURCE_BY_ID = new Map<string, ImportedThemeSource>()
for (const entry of IMPORTED_THEME_CATALOG) {
  if (entry.source) SOURCE_BY_ID.set(entry.id, entry.source as ImportedThemeSource)
}

type ThemeModule = ImportedThemeSource | LazyLocalModule

const loadedThemes = new Map<string, Theme>()
const sourcePromises = new Map<ThemeModule, Promise<Theme[]>>()
const loadedSources = new Map<ThemeModule, Theme[]>()

function loaderOf(source: ThemeModule): () => Promise<Theme[]> {
  return source === 'extra' || source === 'design'
    ? LAZY_LOCAL_LOADERS[source]
    : THEME_SOURCE_LOADERS[source]
}

function moduleOf(id: string): ThemeModule | undefined {
  const local = LOCAL_THEME_MODULE[id]
  if (local === 'extra' || local === 'design') return local
  return SOURCE_BY_ID.get(id)
}

async function loadSource(source: ThemeModule): Promise<Theme[]> {
  const done = loadedSources.get(source)
  if (done) return done

  const pending = sourcePromises.get(source)
  if (pending) return pending

  const promise = Promise.resolve()
    .then(() => loaderOf(source)())
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
  return CORE_BY_ID.get(id) ?? loadedThemes.get(id) ?? null
}

/**
 * 取一套主题的实现：自研主题同步命中，手写 / 设计主题与导入主题按所属模块懒加载。
 * 未知 id 回落到 golden，与旧 getTheme 的行为一致。
 */
export async function loadTheme(id: string): Promise<Theme> {
  const core = CORE_BY_ID.get(id)
  if (core) return core

  const cached = loadedThemes.get(id)
  if (cached) return cached

  const source = moduleOf(id)
  if (!source) return goldenTheme

  const themes = await loadSource(source)
  return themes.find((theme) => theme.id === id) ?? goldenTheme
}

let allThemesPromise: Promise<Theme[]> | null = null

/** 全部 227 套实现，顺序与完整注册表一致；供主题库和顶栏快速切换器使用。 */
export function loadAllThemes(): Promise<Theme[]> {
  const order: ThemeModule[] = [...LAZY_LOCAL_ORDER, ...IMPORTED_SOURCE_ORDER]
  allThemesPromise ??= Promise.all(order.map(loadSource))
    .then(() => [
      ...CORE_THEMES,
      ...order.flatMap((source) => loadedSources.get(source) ?? []),
    ])
    .catch((error) => {
      allThemesPromise = null
      throw error
    })
  return allThemesPromise
}