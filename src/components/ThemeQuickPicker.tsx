import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Theme } from '@/lib/theme-kit'
import { THEME_CATALOG, THEME_COUNT, catalogTheme } from '@/lib/theme-catalog'
import { loadTheme } from '@/lib/theme-api'
import type { ThemeCatalogEntry } from '@/lib/theme-meta'
import { useThemeFavorites } from '@/hooks/useThemeFavorites'
import { useI18n } from '@/hooks/useI18n'
import { ensureFontSheetsFor } from '@/lib/font-catalog'
import {
  QUICK_LOAD_BATCH,
  QUICK_PREVIEW_BATCH,
  QUICK_PREVIEW_DEBOUNCE_MS,
  QUICK_PREVIEW_ROOT_MARGIN,
  chunkQuickIds,
  planQuickPreviews,
} from '@/lib/quick-preview'

const QUICK_PER_CAT = 6
const QUICK_FAVORITES = 6
const CATEGORIES = ['简约', '商务', '杂志', '活力'] as const

interface Props {
  themeId: string
  onTheme: (id: string) => void
  /** Render with the already-loaded theme implementation; no registry import. */
  renderPreview: (theme: Theme) => string
  onOpenThemes: () => void
  /**
   * The pane is actually on screen. On a phone the side pane stays mounted but
   * invisible, and IntersectionObserver cannot see the difference; without this
   * the hidden panel would still fetch packs and compute thumbnails.
   */
  visible?: boolean
}

interface QuickTileProps {
  id: string
  name: string
  accent: string
  selected: boolean
  preview: string | undefined
  failed: boolean
  onSelect: (id: string) => void
  onRetry: () => void
}

/**
 * One metadata tile. Memoised because the page re-renders on every keystroke
 * while the thumbnail HTML only changes after the debounced preview round;
 * without this the whole grid would re-commit on each keystroke.
 */
const QuickTile = memo(function QuickTile({
  id,
  name,
  accent,
  selected,
  preview,
  failed,
  onSelect,
  onRetry,
}: QuickTileProps) {
  const { t } = useI18n()
  const state = preview ? 'rendered' : failed ? 'failed' : 'pending'
  return (
    <button
      data-theme-quick={id}
      data-quick-state={state}
      onClick={() => {
        if (state === 'failed') onRetry()
        else onSelect(id)
      }}
      className={`group min-w-0 rounded-2xl p-2 text-left transition-all ${
        selected ? 'ya-selected' : 'bg-surface-sunken hover:bg-surface-base'
      }`}
      style={selected ? undefined : { boxShadow: 'var(--shadow-inset)' }}
    >
      <div
        data-quick-preview={state}
        className="relative h-20 overflow-hidden rounded-lg bg-white"
        style={{ boxShadow: 'var(--shadow-inset)' }}
      >
        {preview ? (
          <div
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{ width: 677, transform: 'scale(0.19)' }}
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        ) : state === 'failed' ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] leading-tight text-ink-3">
            <span>{t('topbar.themes.loadFailed')}</span>
            <span className="text-brand-600 underline decoration-brand/40 underline-offset-2">{t('common.retry')}</span>
          </span>
        ) : (
          <div className="absolute inset-0 animate-pulse bg-line-1" aria-hidden="true" />
        )}
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 px-0.5">
        <span className="ya-dot shrink-0" style={{ background: accent }} />
        <span className="truncate text-[12px] font-medium text-ink-1">{name}</span>
      </div>
    </button>
  )
})

/**
 * The theme quick-switcher that used to live in the top bar. It is now the body
 * of the side panel's 主题 tab, so it keeps the same tiles, favourites and live
 * previews while the top bar gives its width back to modes and actions.
 *
 * Only the current theme and the tiles that are (or are about to be) on screen
 * load their implementation and render a thumbnail. The rest keep their
 * metadata tile and a skeleton until the scroll reaches them. Typing in the
 * editor re-renders the panel after a short trailing debounce and in small
 * batches, so a fast typist does not pay for the whole grid on every keystroke.
 */
export default function ThemeQuickPicker({ themeId, onTheme, renderPreview, onOpenThemes, visible = true }: Props) {
  const { t } = useI18n()
  const activeTheme = catalogTheme(themeId)
  const { favorites } = useThemeFavorites()

  const rootRef = useRef<HTMLDivElement>(null)
  const renderRef = useRef(renderPreview)
  renderRef.current = renderPreview
  const onThemeRef = useRef(onTheme)
  onThemeRef.current = onTheme
  /** 主题 id ->已加载的实现；来源缓存与失败重试都在 theme-api里。 */
  const [implementations, setImplementations] = useState<ReadonlyMap<string, Theme>>(() => new Map())
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  /** 已经进入/接近视口、允许加载与渲染的 tile。 */
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(() => new Set())
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({})
  const [retryNonce, setRetryNonce] = useState(0)
  /** 每轮 debounce结束后 +1，渲染计划在 effect里分批执行。 */
  const [previewEpoch, setPreviewEpoch] = useState(0)
  /** 同一来源的多个 tile可能同时被观察到，避免重复发起 loadTheme。 */
  const loadingRef = useRef(new Set<string>())

  const favoriteThemes = useMemo(() => THEME_CATALOG.filter((th) => favorites.has(th.id)), [favorites])
  const favoriteShown = useMemo(() => favoriteThemes.slice(0, QUICK_FAVORITES), [favoriteThemes])

  // A favourite is shown once, at the top; the category groups skip it.
  const sections = useMemo(
    () =>
      CATEGORIES.map((cat) => {
        const list = THEME_CATALOG.filter((th) => th.category === cat && !favorites.has(th.id)).slice(0, QUICK_PER_CAT)
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

  // UI 顺序，收藏在前；同一个主题只出现一次。
  const tiles = useMemo(() => {
    const seen = new Set<string>()
    const out: ThemeCatalogEntry[] = []
    for (const th of [...favoriteShown, ...sections.flatMap((section) => section.list)]) {
      if (seen.has(th.id)) continue
      seen.add(th.id)
      out.push(th)
    }
    return out
  }, [favoriteShown, sections])
  const displayedKey = useMemo(() => tiles.map((th) => th.id).join('|'), [tiles])
  const displayedIds = useMemo(() => new Set(tiles.map((th) => th.id)), [tiles])

  // Observe every rendered tile against the scrolling theme list. `rootMargin`
  // adds roughly one row below/above the fold so a scroll does not wait on a
  // fresh network round-trip per row.
  useEffect(() => {
    if (!visible) return
    const root = rootRef.current
    if (!root) return
    const scrollRoot = root.closest('[data-theme-scroll]')
    const observer = new IntersectionObserver(
      (entries) => {
        const entered: string[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = (entry.target as HTMLElement).dataset.themeQuick
          if (id) entered.push(id)
        }
        if (!entered.length) return
        setVisibleIds((previous) => {
          const next = new Set(previous)
          let changed = false
          for (const id of entered) {
            if (next.has(id)) continue
            next.add(id)
            changed = true
          }
          return changed ? next : previous
        })
      },
      { root: scrollRoot, rootMargin: QUICK_PREVIEW_ROOT_MARGIN, threshold: 0 },
    )
    for (const element of root.querySelectorAll<HTMLElement>('[data-theme-quick]')) observer.observe(element)
    return () => observer.disconnect()
  }, [visible, displayedKey])

  // Load implementations for the current theme and the tiles that entered the
  // viewport, in small batches so a fast scroll does not start every request in
  // the same task. loadTheme keeps the per-source cache and retries failed ones.
  useEffect(() => {
    if (!visible) return
    const wanted: string[] = []
    const seen = new Set<string>()
    for (const id of [themeId, ...visibleIds]) {
      if (seen.has(id) || !displayedIds.has(id)) continue
      seen.add(id)
      if (implementations.has(id) || failed.has(id) || loadingRef.current.has(id)) continue
      wanted.push(id)
    }
    if (!wanted.length) return
    let cancelled = false
    void (async () => {
      for (const batch of chunkQuickIds(wanted, QUICK_LOAD_BATCH)) {
        if (cancelled) return
        await Promise.all(
          batch.map(async (id) => {
            loadingRef.current.add(id)
            try {
              const theme = await loadTheme(id)
              if (cancelled) return
              setImplementations((previous) => {
                if (previous.has(id)) return previous
                const next = new Map(previous)
                next.set(id, theme)
                return next
              })
            } catch {
              if (!cancelled) setFailed((previous) => (previous.has(id) ? previous : new Set(previous).add(id)))
            } finally {
              loadingRef.current.delete(id)
            }
          }),
        )
        if (cancelled) return
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible, themeId, visibleIds, displayedIds, implementations, failed, retryNonce])

  // Typing changes `renderPreview` on every keystroke; wait for a quiet moment
  // before recomputing thumbnails. Loading new implementations and intersections
  // also go through the same debounce.
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => setPreviewEpoch((epoch) => epoch + 1), QUICK_PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [visible, renderPreview, implementations, visibleIds, displayedKey, themeId])

  // Render only the planned tiles, a few per task, so the main preview and the
  // editor keep the main thread in between batches.
  const latest = useRef({ implementations, visibleIds, tiles, themeId })
  latest.current = { implementations, visibleIds, tiles, themeId }
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void (async () => {
      const plan = planQuickPreviews({
        displayed: latest.current.tiles.map((th) => th.id),
        visible: latest.current.visibleIds,
        loaded: new Set(latest.current.implementations.keys()),
        currentId: themeId,
      })
      for (const batch of chunkQuickIds(plan, QUICK_PREVIEW_BATCH)) {
        if (cancelled) return
        const snapshot = latest.current
        setPreviews((previous) => {
          let next: Record<string, string> | null = null
          for (const id of batch) {
            const implementation = snapshot.implementations.get(id)
            if (!implementation) continue
            const html = renderRef.current(implementation)
            if (previous[id] === html) continue
            next ??= { ...previous }
            next[id] = html
          }
          return next ?? previous
        })
        if (cancelled) return
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible, previewEpoch, themeId, displayedKey])

  const previewMarkup = useMemo(() => Object.values(previews).join(''), [previews])
  // Themes may name a family from a sheet that is not on the first paint.
  useEffect(() => {
    if (previewMarkup) void ensureFontSheetsFor(previewMarkup)
  }, [previewMarkup])

  const selectTheme = useCallback((id: string) => onThemeRef.current(id), [])
  const retryFailed = useCallback(() => {
    setFailed((previous) => (previous.size ? new Set() : previous))
    setRetryNonce((nonce) => nonce + 1)
  }, [])

  if (!visible) return null

  const quickTile = (th: ThemeCatalogEntry) => (
    <QuickTile
      key={th.id}
      id={th.id}
      name={th.name}
      accent={th.ui.accent}
      selected={th.id === themeId}
      preview={previews[th.id]}
      failed={failed.has(th.id)}
      onSelect={selectTheme}
      onRetry={retryFailed}
    />
  )

  const tileGrid = (list: ThemeCatalogEntry[]) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px,1fr))' }}>
      {list.map(quickTile)}
    </div>
  )

  return (
    <div ref={rootRef} data-theme-switcher data-theme-panel className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="ya-eyebrow">{t('topbar.themes.eyebrow')}</p>
        <span className="ya-dot shrink-0" style={{ background: activeTheme.ui.accent }} title={activeTheme.name} />
      </div>
      <p className="text-[11px] text-ink-3">
        {t('panel.theme.current')} · <span className="text-ink-1">{activeTheme.name}</span>
      </p>

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
            <button onClick={onOpenThemes} className="mt-1.5 px-1 text-[11px] text-brand-600 hover:underline">
              {t('topbar.themes.moreFavorites', {
                n: favoriteThemes.length - QUICK_FAVORITES,
              })}
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
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12h14M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
