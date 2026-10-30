/**
 * Theme-library UI state that must survive leaving the page for the editor and
 * coming back: filters, the chosen trial source, and the scroll position.
 *
 * It is in-memory page state, not a preference: a full reload starts clean, while
 * an in-app detour (apply a theme, go back to the editor, return) keeps the user
 * where they were. Article content and the persisted theme are never part of it.
 */
import { COLOR_FAMILIES, COMPLEXITY_LEVELS, STYLE_TAGS, type ColorFamily, type Complexity, type StyleTag } from './theme-meta'

/** Two candidates plus the current theme is the useful comparison ceiling. */
export const MAX_COMPARE_THEMES = 3

export type ThemePreviewSource = 'sample' | 'current'

export interface ThemeLibraryUiState {
  query: string
  tags: StyleTag[]
  levels: Complexity[]
  colors: ColorFamily[]
  sources: string[]
  favOnly: boolean
  source: ThemePreviewSource
  /** Last window.scrollY while the library was open. */
  scrollY: number
}

const EMPTY: ThemeLibraryUiState = {
  query: '',
  tags: [],
  levels: [],
  colors: [],
  sources: [],
  favOnly: false,
  source: 'sample',
  scrollY: 0,
}

/** Per-document memory: survives SPA route changes, not a full reload. */
let memory: ThemeLibraryUiState | null = null

function uniqueStrings(values: readonly unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/** Tolerate old/corrupt values: keep only fields the filters can actually use. */
export function sanitizeThemeLibraryState(raw: unknown): ThemeLibraryUiState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const value = raw as Partial<Record<keyof ThemeLibraryUiState, unknown>>

  const tags = uniqueStrings(Array.isArray(value.tags) ? value.tags : []).filter((tag): tag is StyleTag =>
    (STYLE_TAGS as readonly string[]).includes(tag),
  )
  const levels = (Array.isArray(value.levels) ? value.levels : []).filter(
    (level): level is Complexity =>
      typeof level === 'number' && COMPLEXITY_LEVELS.some((item) => item.level === level),
  )
  const colors = uniqueStrings(Array.isArray(value.colors) ? value.colors : []).filter(
    (color): color is ColorFamily => (COLOR_FAMILIES as readonly string[]).includes(color),
  )
  const scrollY =
    typeof value.scrollY === 'number' && Number.isFinite(value.scrollY) && value.scrollY > 0
      ? Math.round(value.scrollY)
      : 0

  return {
    query: typeof value.query === 'string' ? value.query : '',
    tags: [...new Set(tags)],
    levels: [...new Set(levels)],
    colors: [...new Set(colors)],
    sources: uniqueStrings(Array.isArray(value.sources) ? value.sources : []),
    favOnly: value.favOnly === true,
    source: value.source === 'current' ? 'current' : 'sample',
    scrollY,
  }
}

export function loadThemeLibraryState(): ThemeLibraryUiState {
  return memory ? { ...memory } : { ...EMPTY }
}

export function saveThemeLibraryState(state: ThemeLibraryUiState): void {
  memory = { ...state }
}

/** Tests only: the module is a singleton per document. */
export function __resetThemeLibraryStateForTests(): void {
  memory = null
}

/**
 * Toggle one theme in the comparison set. The order is the order the user picked;
 * removing a theme keeps the remaining order. A fourth pick is rejected instead
 * of silently dropping an earlier one.
 */
export function toggleCompareTheme(
  ids: readonly string[],
  id: string,
  max = MAX_COMPARE_THEMES,
): { ids: string[]; added: boolean; limitReached: boolean } {
  if (ids.includes(id)) return { ids: ids.filter((item) => item !== id), added: false, limitReached: false }
  if (ids.length >= max) return { ids: [...ids], added: false, limitReached: true }
  return { ids: [...ids, id], added: true, limitReached: false }
}