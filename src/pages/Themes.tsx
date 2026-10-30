import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import type { Theme } from '@/lib/theme-kit'
import { THEME_CATALOG, THEME_COUNT } from '@/lib/theme-catalog'
import { getCachedTheme, loadTheme } from '@/lib/theme-api'
import {
  COLOR_FAMILIES,
  COMPLEXITY_LEVELS,
  STYLE_TAGS,
  complexityLabel,
  type ColorFamily,
  type Complexity,
  type StyleTag,
  type ThemeCatalogEntry,
} from '@/lib/theme-meta'
import { parseMarkdown } from '@/lib/parse'
import { renderDoc } from '@/lib/render'
import { loadSettings, saveSettings } from '@/lib/store'
import { THEME_PREVIEW_DOC } from '@/lib/sample'
import type { SignatureConfig } from '@/lib/types'
import { YoruMark } from '@/components/YoruMark'
import { APP_BYLINE } from '@/lib/brand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useThemeFavorites } from '@/hooks/useThemeFavorites'
import { useI18n } from '@/hooks/useI18n'

// 模板库：全部主题渲染同一份 THEME_PREVIEW_DOC，视觉差异才可比。
//
// 卡片与筛选只读 metadata 目录，进入页面不下载任何主题实现；卡片滚进视口附近
// 才开始按来源加载实现并渲染预览，所以首屏与一次访问的下载量都跟实际看到的
// 卡片数量挂钩。预览 HTML 按「主题 + 署名设置」缓存，来回滚动不重算。

type ParsedPreview = ReturnType<typeof parseMarkdown>
type Sig = SignatureConfig

const previewCache = new Map<string, string>()

function previewKey(themeId: string, sig: Sig): string {
  return `${themeId}\u0000${JSON.stringify(sig)}`
}

/** 把 375px 宽的渲染结果等比缩进卡片宽度的容器。 */
function ThemePreview({ theme, doc, sig }: { theme: ThemeCatalogEntry; doc: ParsedPreview; sig: Sig }) {
  const { t } = useI18n()
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [visible, setVisible] = useState(false)
  const [loadedImpl, setLoadedImpl] = useState<Theme | null>(null)
  const impl = loadedImpl ?? getCachedTheme(theme.id)
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null)
  const html = renderedHtml ?? previewCache.get(previewKey(theme.id, sig)) ?? null
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / 375)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 进视口前 400px 才开始准备，滚动时不会看到空白卡
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  // 只加载这一套主题所属的来源 pack；同一个 pack 的其他主题共用缓存。
  useEffect(() => {
    if (!visible || impl) return
    let alive = true
    loadTheme(theme.id)
      .then((loaded) => {
        if (alive) setLoadedImpl(loaded)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [visible, theme.id, attempt, impl])

  // 渲染本身是同步 CPU 工作；让出一帧，避免滚动时和布局挤在一起。
  useEffect(() => {
    if (!impl || html) return
    const key = previewKey(theme.id, sig)
    let alive = true
    const timer = window.setTimeout(() => {
      if (!alive) return
      const out = renderDoc(doc, impl, sig).html
      previewCache.set(key, out)
      setRenderedHtml(out)
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [impl, doc, sig, theme.id, html])

  return (
    <div
      ref={boxRef}
      data-theme-preview={html ? 'rendered' : visible ? 'loading' : 'pending'}
      className="relative h-56 overflow-hidden rounded-xl bg-white"
      style={{ boxShadow: 'var(--shadow-inset)' }}
    >
      {html ? (
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ width: 375, transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : visible ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] leading-relaxed text-ink-3">
          {error ? (
            <button
              type="button"
              className="ya-link-btn"
              onClick={() => {
                setError(false)
                setAttempt((n) => n + 1)
              }}
            >
              {t('themes.previewFailed')} · {t('common.retry')}
            </button>
          ) : (
            t('themes.previewLoading')
          )}
        </div>
      ) : null}
      {/* 底部渐隐，示意「内容未完」 */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
        style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.92))' }}
      />
    </div>
  )
}

/** 多选筛选条：凹陷轨道上的胶囊，选中态沿用 ya-selected 铁律。 */
function FilterRow<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  render: renderOption,
}: {
  label: string
  options: readonly T[]
  selected: Set<T>
  onToggle(v: T): void
  render?(v: T): string
}) {
  if (!options.length) return null
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="ya-eyebrow shrink-0 pt-1.5 sm:w-14">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = selected.has(opt)
          return (
            <button
              key={String(opt)}
              onClick={() => onToggle(opt)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-all ${
                on ? 'ya-selected font-semibold text-ink-1' : 'text-ink-3 hover:text-ink-1'
              }`}
              style={on ? undefined : { boxShadow: 'var(--shadow-inset)' }}
            >
              {renderOption ? renderOption(opt) : String(opt)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' }) {
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] leading-none"
      style={{
        background: tone === 'accent' ? 'var(--primary-100)' : 'rgba(14,21,37,0.05)',
        color: tone === 'accent' ? 'var(--primary-700)' : 'var(--ink-3)',
      }}
    >
      {children}
    </span>
  )
}

function IconStar({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="M12 3.2l2.6 5.3 5.9.85-4.25 4.14 1 5.86L12 16.7l-5.25 2.65 1-5.86L3.5 9.35l5.9-.85z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function OriginDetails({ theme }: { theme: ThemeCatalogEntry }) {
  const { t } = useI18n()
  const o = theme.meta.origin
  return (
    <div className="ya-well flex flex-col gap-1.5 rounded-xl p-3 text-[11px] leading-relaxed text-ink-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>
          {t('themes.card.originProject')} <span className="text-ink-2">{o.project}</span>
        </span>
        <span>
          {t('themes.card.author')} <span className="text-ink-2">{o.author}</span>
        </span>
        <span>
          {t('themes.card.license')} <span className="text-ink-2">{o.license}</span>
        </span>
      </div>
      {o.repo && (
        <a
          href={o.repo}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all underline decoration-dotted underline-offset-2 hover:text-ink-1"
        >
          {o.repo}
        </a>
      )}
      {o.upstream && (
        <span>
          {t('themes.card.upstream')} <span className="text-ink-2">{o.upstream}</span>
        </span>
      )}
      {o.licenseFile && (
        <span>
          {t('themes.card.licenseFile')} <span style={{ fontFamily: 'var(--font-mono)' }} className="text-ink-2">{o.licenseFile}</span>
        </span>
      )}
      <span className="text-ink-2">{o.attribution}</span>
      {o.adapted && <span>{t('themes.card.adapted', { note: o.adapted })}</span>}
    </div>
  )
}

function ThemeCard({
  theme,
  doc,
  sig,
  active,
  favorited,
  onUse,
  onToggleFavorite,
}: {
  theme: ThemeCatalogEntry
  doc: ParsedPreview
  sig: Sig
  active: boolean
  favorited: boolean
  onUse: () => void
  onToggleFavorite: () => void
}) {
  const { t } = useI18n()
  const [showOrigin, setShowOrigin] = useState(false)
  const o = theme.meta.origin
  return (
    <div
      data-theme-card={theme.id}
      className={`ya-well flex flex-col gap-3 p-3.5 transition-all ${active ? 'ya-selected' : ''}`}
    >
      <div className="flex items-start gap-2 px-0.5">
        <span className="ya-dot mt-1.5 shrink-0" style={{ background: theme.ui.accent }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold text-ink-1">{theme.name}</span>
            {active && (
              <span
                className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--primary-500)', color: '#fff' }}
              >
                {t('themes.card.inUse')}
              </span>
            )}
          </div>
          {theme.desc !== theme.name && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{theme.desc}</p>
          )}
        </div>
        <button
          type="button"
          data-theme-fav={theme.id}
          onClick={onToggleFavorite}
          aria-pressed={favorited}
          aria-label={favorited ? t('themes.card.favOn', { name: theme.name }) : t('themes.card.favOff', { name: theme.name })}
          title={favorited ? t('themes.card.favTitleOn') : t('themes.card.favTitleOff')}
          className="ya-link-btn -mr-1 -mt-0.5 shrink-0 !p-1.5"
          style={{ color: favorited ? 'var(--primary-600)' : 'var(--ink-4)' }}
        >
          <IconStar filled={favorited} />
        </button>
      </div>

      <ThemePreview theme={theme} doc={doc} sig={sig} />

      <div className="flex flex-wrap items-center gap-1 px-0.5">
        {theme.meta.styles.map((style) => (
          <Tag key={style}>{t(`meta.style.${style}`)}</Tag>
        ))}
        <Tag tone="accent">{complexityLabel(theme.meta.complexity)}</Tag>
        <Tag>{t(`meta.color.${theme.meta.color}`)}</Tag>
      </div>

      <div className="flex items-center gap-1.5 px-0.5 text-[10px] text-ink-3">
        <span className="truncate">{o.project}</span>
        <span className="shrink-0 opacity-50">·</span>
        <span className="shrink-0">{o.license}</span>
        {o.repo && (
          <a
            href={o.repo}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto shrink-0 underline decoration-dotted underline-offset-2 hover:text-ink-1"
          >
            {t('themes.card.projectLink')}
          </a>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onUse}
          disabled={active}
          className={`ya-btn flex-1 ${active ? 'ya-btn-ghost' : 'ya-btn-primary'}`}
        >
          {active ? t('themes.card.current') : t('themes.card.use')}
        </button>
        <button onClick={() => setShowOrigin((v) => !v)} className="ya-btn ya-btn-secondary !px-3">
          {showOrigin ? t('themes.card.collapse') : t('themes.card.source')}
        </button>
      </div>
      {showOrigin && <OriginDetails theme={theme} />}
    </div>
  )
}

export default function Themes() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [themeId, setThemeId] = useState(() => loadSettings().themeId)
  const sig = useMemo(() => loadSettings().sig, [])
  const doc = useMemo(() => parseMarkdown(THEME_PREVIEW_DOC), [])
  const { favorites, count: favCount, toggle: toggleFavorite } = useThemeFavorites()

  const [tags, setTags] = useState<Set<StyleTag>>(new Set())
  const [levels, setLevels] = useState<Set<Complexity>>(new Set())
  const [colors, setColors] = useState<Set<ColorFamily>>(new Set())
  const [sources, setSources] = useState<Set<string>>(new Set())
  const [favOnly, setFavOnly] = useState(false)
  const [query, setQuery] = useState('')

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    apply(next)
  }

  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const theme of THEME_CATALOG) {
      const p = theme.meta.origin.project
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return THEME_CATALOG.filter((theme) => {
      if (favOnly && !favorites.has(theme.id)) return false
      if (tags.size && !theme.meta.styles.some((s) => tags.has(s))) return false
      if (levels.size && !levels.has(theme.meta.complexity)) return false
      if (colors.size && !colors.has(theme.meta.color)) return false
      if (sources.size && !sources.has(theme.meta.origin.project)) return false
      if (q) {
        const hay = `${theme.name} ${theme.desc} ${theme.id} ${theme.meta.origin.project} ${theme.meta.origin.author}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    }).sort(
      (a, b) =>
        a.meta.complexity - b.meta.complexity ||
        a.meta.origin.project.localeCompare(b.meta.origin.project) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN'),
    )
  }, [tags, levels, colors, sources, favOnly, favorites, query])

  const clearAll = () => {
    setTags(new Set())
    setLevels(new Set())
    setColors(new Set())
    setSources(new Set())
    setFavOnly(false)
    setQuery('')
  }
  const filtering =
    tags.size + levels.size + colors.size + sources.size > 0 || favOnly || query.trim() !== ''

  const applyTheme = (theme: ThemeCatalogEntry) => {
    const s = loadSettings()
    saveSettings({ ...s, themeId: theme.id })
    setThemeId(theme.id)
    toast.success(t('themes.applied', { name: theme.name }), { description: t('themes.appliedDesc') })
    setTimeout(() => navigate('/'), 450)
  }

  return (
    <div className="ya-page min-h-screen text-ink-1">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <button onClick={() => navigate('/')} className="ya-btn ya-btn-secondary ya-btn-sm !h-8 shrink-0">
          ← {t('common.backToEditor')}
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <YoruMark height={15} />
          <span className="whitespace-nowrap text-[15px] font-bold tracking-wide text-ink-1">{t('themes.title')}</span>
          <span className="ya-eyebrow hidden truncate sm:inline">
            {t('app.name')} · {APP_BYLINE}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="ya-eyebrow tabular-nums hidden sm:inline">
            {t('themes.countRatio', { shown: filtered.length, total: THEME_COUNT })}
          </span>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <div className="ya-well mb-5 flex flex-col gap-2.5 rounded-2xl p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('themes.search')}
              className="ya-input flex-1"
            />
            <button
              type="button"
              data-fav-filter
              onClick={() => setFavOnly((v) => !v)}
              aria-pressed={favOnly}
              title={t('themes.favOnlyTitle')}
              className={`ya-btn ya-btn-sm shrink-0 ${favOnly ? 'ya-selected text-ink-1' : 'ya-btn-ghost'}`}
            >
              <span style={{ color: favOnly ? 'var(--primary-600)' : 'var(--ink-4)' }}>
                <IconStar filled={favOnly} />
              </span>
              {t('themes.favOnly')}
              <span className="tabular-nums" style={{ color: 'var(--ink-4)' }}>
                {favCount}
              </span>
            </button>
            {filtering && (
              <button onClick={clearAll} className="ya-btn ya-btn-ghost ya-btn-sm shrink-0">
                {t('themes.clearFilters')}
              </button>
            )}
          </div>
          <FilterRow
            label={t('themes.filter.style')}
            options={STYLE_TAGS}
            selected={tags}
            onToggle={(v) => toggle(tags, v, setTags)}
            render={(v) => t(`meta.style.${v}`)}
          />
          <FilterRow
            label={t('themes.filter.complexity')}
            options={COMPLEXITY_LEVELS.map((c) => c.level)}
            selected={levels}
            onToggle={(v) => toggle(levels, v, setLevels)}
            render={(v) => complexityLabel(v)}
          />
          <FilterRow
            label={t('themes.filter.color')}
            options={COLOR_FAMILIES}
            selected={colors}
            onToggle={(v) => toggle(colors, v, setColors)}
            render={(v) => t(`meta.color.${v}`)}
          />
          <FilterRow
            label={t('themes.filter.source')}
            options={sourceOptions.map(([name]) => name)}
            selected={sources}
            onToggle={(v) => toggle(sources, v, setSources)}
            render={(v) => `${v} ${sourceOptions.find(([n]) => n === v)?.[1] ?? ''}`}
          />
        </div>

        <p className="mb-4 px-0.5 text-[12px] leading-relaxed text-ink-3">
          {t('themes.intro')}
        </p>

        {filtered.length === 0 ? (
          <div className="ya-well rounded-2xl p-10 text-center text-[13px] text-ink-3">
            {favOnly && favCount === 0 ? t('themes.emptyFav') : t('themes.emptyFiltered')}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                doc={doc}
                sig={sig}
                active={theme.id === themeId}
                favorited={favorites.has(theme.id)}
                onUse={() => applyTheme(theme)}
                onToggleFavorite={() => toggleFavorite(theme.id)}
              />
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] leading-relaxed text-ink-3">
          {t('themes.footer')}
        </p>
      </main>
      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}