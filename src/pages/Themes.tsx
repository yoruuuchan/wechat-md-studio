import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { THEMES, type Theme } from '@/lib/themes'
import {
  COLOR_FAMILIES,
  COMPLEXITY_LEVELS,
  STYLE_TAGS,
  complexityLabel,
  type ColorFamily,
  type Complexity,
  type StyleTag,
} from '@/lib/theme-meta'
import { parseMarkdown } from '@/lib/parse'
import { renderDoc } from '@/lib/render'
import { loadSettings, saveSettings } from '@/lib/store'
import { THEME_PREVIEW_DOC } from '@/lib/sample'
import { YoruMark } from '@/components/YoruMark'
import { APP_NAME, APP_BYLINE } from '@/lib/brand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useThemeFavorites } from '@/hooks/useThemeFavorites'

// 模板库：全部主题渲染同一份 THEME_PREVIEW_DOC，视觉差异才可比。
// 主题数量上百，所以预览 DOM 只在卡片滚进视口附近时才注入，
// 否则一次性挂几万个节点会把页面拖死。

/** 把 375px 宽的渲染结果等比缩进卡片宽度的容器。 */
function ScaledPreview({ html }: { html: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [visible, setVisible] = useState(false)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / 375)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 进视口前 400px 才开始渲染，滚动时不会看到空白卡
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

  return (
    <div
      ref={boxRef}
      data-theme-preview={visible ? 'rendered' : 'pending'}
      className="relative h-56 overflow-hidden rounded-xl bg-white"
      style={{ boxShadow: 'var(--shadow-inset)' }}
    >
      {visible && (
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ width: 375, transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
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

function OriginDetails({ theme }: { theme: Theme }) {
  const o = theme.meta.origin
  return (
    <div className="ya-well flex flex-col gap-1.5 rounded-xl p-3 text-[11px] leading-relaxed text-ink-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>
          来源项目 <span className="text-ink-2">{o.project}</span>
        </span>
        <span>
          原作者 <span className="text-ink-2">{o.author}</span>
        </span>
        <span>
          License <span className="text-ink-2">{o.license}</span>
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
          上游 / lineage <span className="text-ink-2">{o.upstream}</span>
        </span>
      )}
      {o.licenseFile && (
        <span>
          许可证留存 <span style={{ fontFamily: 'var(--font-mono)' }} className="text-ink-2">{o.licenseFile}</span>
        </span>
      )}
      <span className="text-ink-2">{o.attribution}</span>
      {o.adapted && <span>移植改动：{o.adapted}</span>}
    </div>
  )
}

function ThemeCard({
  theme,
  active,
  favorited,
  previewHtml,
  onUse,
  onToggleFavorite,
}: {
  theme: Theme
  active: boolean
  favorited: boolean
  previewHtml: string
  onUse: () => void
  onToggleFavorite: () => void
}) {
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
                使用中
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
          aria-label={favorited ? `取消收藏「${theme.name}」` : `收藏「${theme.name}」`}
          title={favorited ? '取消收藏' : '收藏：存到本浏览器，顶部快速切换器里置顶'}
          className="ya-link-btn -mr-1 -mt-0.5 shrink-0 !p-1.5"
          style={{ color: favorited ? 'var(--primary-600)' : 'var(--ink-4)' }}
        >
          <IconStar filled={favorited} />
        </button>
      </div>

      <ScaledPreview html={previewHtml} />

      <div className="flex flex-wrap items-center gap-1 px-0.5">
        {theme.meta.styles.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
        <Tag tone="accent">{complexityLabel(theme.meta.complexity)}</Tag>
        <Tag>{theme.meta.color}</Tag>
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
            原项目 ↗
          </a>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onUse}
          disabled={active}
          className={`ya-btn flex-1 ${active ? 'ya-btn-ghost' : 'ya-btn-primary'}`}
        >
          {active ? '当前模板' : '使用此模板'}
        </button>
        <button onClick={() => setShowOrigin((v) => !v)} className="ya-btn ya-btn-secondary !px-3">
          {showOrigin ? '收起' : '来源'}
        </button>
      </div>
      {showOrigin && <OriginDetails theme={theme} />}
    </div>
  )
}

export default function Themes() {
  const navigate = useNavigate()
  const [themeId, setThemeId] = useState(() => loadSettings().themeId)
  const sig = useMemo(() => loadSettings().sig, [])
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

  // 每个主题渲染一遍统一样例。上百套主题一次性算完约几百毫秒，
  // 之后筛选只在结果里挑，不重算。
  const previews = useMemo(() => {
    const doc = parseMarkdown(THEME_PREVIEW_DOC)
    const out: Record<string, string> = {}
    for (const t of THEMES) out[t.id] = renderDoc(doc, t, sig).html
    return out
  }, [sig])

  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of THEMES) {
      const p = t.meta.origin.project
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return THEMES.filter((t) => {
      if (favOnly && !favorites.has(t.id)) return false
      if (tags.size && !t.meta.styles.some((s) => tags.has(s))) return false
      if (levels.size && !levels.has(t.meta.complexity)) return false
      if (colors.size && !colors.has(t.meta.color)) return false
      if (sources.size && !sources.has(t.meta.origin.project)) return false
      if (q) {
        const hay = `${t.name} ${t.desc} ${t.id} ${t.meta.origin.project} ${t.meta.origin.author}`.toLowerCase()
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

  const applyTheme = (t: Theme) => {
    const s = loadSettings()
    saveSettings({ ...s, themeId: t.id })
    setThemeId(t.id)
    toast.success(`已换成「${t.name}」`, { description: '回到编辑器后正文会按新模板重新排版' })
    setTimeout(() => navigate('/'), 450)
  }

  return (
    <div className="ya-page min-h-screen text-ink-1">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-3 px-4">
        <button onClick={() => navigate('/')} className="ya-btn ya-btn-secondary ya-btn-sm !h-8">
          ← 回到编辑器
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <YoruMark height={15} />
          <span className="text-[15px] font-bold tracking-wide text-ink-1">模板库</span>
          <span className="ya-eyebrow truncate">
            {APP_NAME} · {APP_BYLINE}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="ya-eyebrow tabular-nums">
            {filtered.length}/{THEMES.length}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <div className="ya-well mb-5 flex flex-col gap-2.5 rounded-2xl p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索主题名、描述、来源或作者"
              className="ya-input flex-1"
            />
            <button
              type="button"
              data-fav-filter
              onClick={() => setFavOnly((v) => !v)}
              aria-pressed={favOnly}
              title="只看收藏过的模板（星标存本浏览器）"
              className={`ya-btn ya-btn-sm shrink-0 ${favOnly ? 'ya-selected text-ink-1' : 'ya-btn-ghost'}`}
            >
              <span style={{ color: favOnly ? 'var(--primary-600)' : 'var(--ink-4)' }}>
                <IconStar filled={favOnly} />
              </span>
              收藏
              <span className="tabular-nums" style={{ color: 'var(--ink-4)' }}>
                {favCount}
              </span>
            </button>
            {filtering && (
              <button onClick={clearAll} className="ya-btn ya-btn-ghost ya-btn-sm shrink-0">
                清空筛选
              </button>
            )}
          </div>
          <FilterRow
            label="风格"
            options={STYLE_TAGS}
            selected={tags}
            onToggle={(v) => toggle(tags, v, setTags)}
          />
          <FilterRow
            label="复杂度"
            options={COMPLEXITY_LEVELS.map((c) => c.level)}
            selected={levels}
            onToggle={(v) => toggle(levels, v, setLevels)}
            render={(v) => complexityLabel(v)}
          />
          <FilterRow label="色系" options={COLOR_FAMILIES} selected={colors} onToggle={(v) => toggle(colors, v, setColors)} />
          <FilterRow
            label="来源"
            options={sourceOptions.map(([name]) => name)}
            selected={sources}
            onToggle={(v) => toggle(sources, v, setSources)}
            render={(v) => `${v} ${sourceOptions.find(([n]) => n === v)?.[1] ?? ''}`}
          />
        </div>

        <p className="mb-4 px-0.5 text-[12px] leading-relaxed text-ink-3">
          全部模板渲染同一份样例，覆盖标题、正文、强调、引用、列表、表格、代码、图片与图注、轮播和署名。
          每套模板都标注了来源项目、原作者与许可证；点「来源」可看完整的署名与 lineage。
        </p>

        {filtered.length === 0 ? (
          <div className="ya-well rounded-2xl p-10 text-center text-[13px] text-ink-3">
            {favOnly && favCount === 0
              ? '还没有收藏的模板。点卡片右上角的星标收藏常用模板，之后就能一键筛出来，也会出现在编辑器顶部的快速切换器里。'
              : '没有符合当前筛选条件的模板，试试放宽一点。'}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <ThemeCard
                key={t.id}
                theme={t}
                active={t.id === themeId}
                favorited={favorites.has(t.id)}
                previewHtml={previews[t.id]}
                onUse={() => applyTheme(t)}
                onToggleFavorite={() => toggleFavorite(t.id)}
              />
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] leading-relaxed text-ink-3">
          主题库来自多个开源项目，各套模板的授权与署名以卡片内标注为准，许可证原文留存在仓库的 LICENSES/ 目录。
        </p>
      </main>
      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
