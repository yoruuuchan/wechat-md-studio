import { useEffect, useMemo, useState } from 'react'
import type { Theme } from '@/lib/theme-kit'
import { THEME_CATALOG, THEME_COUNT, catalogTheme } from '@/lib/theme-catalog'
import { loadAllThemes } from '@/lib/theme-api'
import type { ThemeCatalogEntry } from '@/lib/theme-meta'
import { useThemeFavorites } from '@/hooks/useThemeFavorites'
import { useI18n } from '@/hooks/useI18n'

const QUICK_PER_CAT = 6
const QUICK_FAVORITES = 6
const CATEGORIES = ['简约', '商务', '杂志', '活力'] as const

interface Props {
  themeId: string
  onTheme: (id: string) => void
  /** Render with the already-loaded theme implementation; no registry import. */
  renderPreview: (theme: Theme) => string
  onOpenThemes: () => void
}

/**
 * The theme quick-switcher that used to live in the top bar. It is now the body
 * of the side panel's 主题 tab, so it keeps the same tiles, favourites and
 * live previews while the top bar gives its width back to modes and actions.
 */
export default function ThemeQuickPicker({ themeId, onTheme, renderPreview, onOpenThemes }: Props) {
  const { t } = useI18n()
  const activeTheme = catalogTheme(themeId)
  const { favorites } = useThemeFavorites()

  // The panel reads metadata for the first paint. Implementations are loaded
  // only when a live thumbnail is actually needed; theme-api caches the result.
  const [quickThemes, setQuickThemes] = useState<Map<string, Theme> | null>(null)
  const [quickError, setQuickError] = useState(false)
  const [quickAttempt, setQuickAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    loadAllThemes()
      .then((themes) => {
        if (alive) setQuickThemes(new Map(themes.map((theme) => [theme.id, theme])))
      })
      .catch(() => {
        if (alive) setQuickError(true)
      })
    return () => {
      alive = false
    }
  }, [quickAttempt])

  const favoriteThemes = useMemo(
    () => THEME_CATALOG.filter((th) => favorites.has(th.id)),
    [favorites],
  )
  const favoriteShown = useMemo(() => favoriteThemes.slice(0, QUICK_FAVORITES), [favoriteThemes])

  // A favourite is shown once, at the top; the category groups skip it.
  const sections = useMemo(
    () =>
      CATEGORIES.map((cat) => {
        const list = THEME_CATALOG.filter(
          (th) => th.category === cat && !favorites.has(th.id),
        ).slice(0, QUICK_PER_CAT)
        if (
          activeTheme.category === cat &&
          !favorites.has(activeTheme.id) &&
          !list.some((th) => th.id === activeTheme.id)
        ) {
          list.unshift(activeTheme)
        }
        return { cat, list }
      }).filter((section) => section.list.length > 0),
    [favorites, activeTheme],
  )

  // Only render the thumbnails that are on screen, not all 227 themes.
  const displayedIds = useMemo(
    () =>
      new Set([
        ...favoriteShown.map((th) => th.id),
        ...sections.flatMap((section) => section.list.map((th) => th.id)),
      ]),
    [favoriteShown, sections],
  )

  const quickPreviews = useMemo(() => {
    const out: Record<string, string> = {}
    if (!quickThemes) return out
    for (const id of displayedIds) {
      const impl = quickThemes.get(id)
      if (impl) out[id] = renderPreview(impl)
    }
    return out
  }, [quickThemes, displayedIds, renderPreview])

  const quickTile = (th: ThemeCatalogEntry) => {
    const preview = quickPreviews[th.id]
    return (
      <button
        key={th.id}
        data-theme-quick={th.id}
        onClick={() => onTheme(th.id)}
        className={`group min-w-0 rounded-2xl p-2 text-left transition-all ${
          th.id === themeId ? 'ya-selected' : 'bg-surface-sunken hover:bg-surface-base'
        }`}
        style={th.id === themeId ? undefined : { boxShadow: 'var(--shadow-inset)' }}
      >
        <div className="relative h-20 overflow-hidden rounded-lg bg-white" style={{ boxShadow: 'var(--shadow-inset)' }}>
          {preview ? (
            <div
              className="pointer-events-none absolute left-0 top-0 origin-top-left"
              style={{ width: 677, transform: 'scale(0.19)' }}
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          ) : (
            <div className="absolute inset-0 animate-pulse bg-line-1" aria-hidden="true" />
          )}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 px-0.5">
          <span className="ya-dot shrink-0" style={{ background: th.ui.accent }} />
          <span className="truncate text-[12px] font-medium text-ink-1">{th.name}</span>
        </div>
      </button>
    )
  }

  const tileGrid = (list: ThemeCatalogEntry[]) => (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}
    >
      {list.map(quickTile)}
    </div>
  )

  return (
    <div data-theme-switcher data-theme-panel className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="ya-eyebrow">{t('topbar.themes.eyebrow')}</p>
        <span className="ya-dot shrink-0" style={{ background: activeTheme.ui.accent }} title={activeTheme.name} />
      </div>
      <p className="text-[11px] text-ink-3">
        {t('panel.theme.current')} · <span className="text-ink-1">{activeTheme.name}</span>
      </p>

      {!quickThemes && (
        <p className="text-[11px] text-ink-3">
          {quickError ? (
            <button
              type="button"
              className="ya-link-btn"
              onClick={() => {
                setQuickError(false)
                setQuickAttempt((n) => n + 1)
              }}
            >
              {t('topbar.themes.loadFailed')} · {t('common.retry')}
            </button>
          ) : (
            t('topbar.themes.loading')
          )}
        </p>
      )}

      {favoriteThemes.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-[0.12em] text-ink-4">
            <span style={{ color: 'var(--primary-500)' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3.2l2.6 5.3 5.9.85-4.25 4.14 1 5.86L12 16.7l-5.25 2.65 1-5.86L3.5 9.35l5.9-.85z" />
              </svg>
            </span>
            {t('topbar.themes.favorites')}
          </p>
          {tileGrid(favoriteShown)}
          {favoriteThemes.length > QUICK_FAVORITES && (
            <button
              onClick={onOpenThemes}
              className="mt-1.5 px-1 text-[11px] text-brand-600 hover:underline"
            >
              {t('topbar.themes.moreFavorites', { n: favoriteThemes.length - QUICK_FAVORITES })}
            </button>
          )}
        </div>
      )}

      {sections.map(({ cat, list }) => (
        <div key={cat}>
          <p className="mb-1.5 px-1 text-[10px] font-semibold tracking-[0.12em] text-ink-4">
            {t(`topbar.category.${cat}`)}
          </p>
          {tileGrid(list)}
        </div>
      ))}

      <button
        onClick={onOpenThemes}
        className="flex w-full items-center justify-center gap-1 rounded-xl py-2 text-[12px] text-brand-600 transition-colors hover:bg-surface-tint"
      >
        {t('topbar.themes.viewAll', { n: THEME_COUNT })}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  )
}