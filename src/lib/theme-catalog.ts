// 应用侧的主题目录：首屏只带 metadata，不 import 任何渲染实现。
//
// - THEME_CATALOG：219 套主题的 id / 名称 / 分类 / 标签 / 来源；
// - THEME_BY_ID：按 id 取目录条目（顶栏、收藏、来源信息用）；
// - theme implementation 走 theme-api.ts 的 loadTheme / loadAllThemes。
//
// 自研与手写主题的目录条目从主题对象即时派生；导入主题的目录由
// scripts/themes/import.ts 与 pack 一起生成到 themes-imported/catalog.ts，
// 两边共用 theme-meta 的 catalogEntryOf，字段口径不会分叉。
import type { ThemeCatalogEntry } from './theme-meta'
import { catalogEntryOf } from './theme-meta'
import { CORE_THEMES } from './themes-core'
import { EXTRA_THEMES } from './themes-extra'
import { IMPORTED_THEME_COUNT, IMPORTED_THEME_CATALOG } from './themes-imported/catalog'

const LOCAL_CATALOG: ThemeCatalogEntry[] = [...CORE_THEMES, ...EXTRA_THEMES].map(catalogEntryOf)

/** 顺序与完整注册表一致：自研 → 手写 → 导入 pack 顺序。 */
export const THEME_CATALOG: ThemeCatalogEntry[] = [...LOCAL_CATALOG, ...IMPORTED_THEME_CATALOG]

/** 主题总数，由目录复算；与 `THEMES.length` 的一致性由 theme-catalog.test.ts 钉住。 */
export const THEME_COUNT = LOCAL_CATALOG.length + IMPORTED_THEME_COUNT

const CATALOG_BY_ID = new Map(THEME_CATALOG.map((theme) => [theme.id, theme]))

/** 存储里的旧收藏 id 用它过滤：目录就是已知主题的事实来源。 */
export const KNOWN_THEME_IDS: ReadonlySet<string> = new Set(CATALOG_BY_ID.keys())

/** 目录查询；未知 id 回落到第一套自研主题，与旧 getTheme 的兜底一致。 */
export function catalogTheme(id: string): ThemeCatalogEntry {
  return CATALOG_BY_ID.get(id) ?? THEME_CATALOG[0]
}