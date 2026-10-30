// 完整主题注册表：测试、构建期校验与脚本用它拿到全部 219 套主题。
// 应用运行时不直接 import 本文件——首屏只需要当前主题与元数据目录，
// 走 ./theme-catalog.ts / ./theme-api.ts 的按需加载接口。
import type { Theme } from './theme-kit'
import { CORE_THEMES, goldenTheme } from './themes-core'
import { EXTRA_THEMES } from './themes-extra'
import { IMPORTED_THEMES } from './themes-imported'

export { CORE_THEMES, goldenTheme, minimalTheme, steadyTheme } from './themes-core'
export { BLANK, baseTableBlock, carouselFrame, esc, sanitizeStyle } from './theme-kit'
export type { CarouselFrame, Theme, ThemeCategory, ThemePalette, ThemeStyles } from './theme-kit'
export type { ColorFamily, Complexity, StyleTag, ThemeMeta, ThemeOrigin } from './theme-meta'
export { COMPLEXITY_LEVELS, COLOR_FAMILIES, STYLE_TAGS, complexityLabel } from './theme-meta'

export const THEMES: Theme[] = [...CORE_THEMES, ...EXTRA_THEMES, ...IMPORTED_THEMES]

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) || goldenTheme
}