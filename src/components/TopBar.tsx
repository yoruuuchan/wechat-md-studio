import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { THEMES, type Theme } from '@/lib/themes'
import { useThemeFavorites } from '@/hooks/useThemeFavorites'
import type { DocRecord } from '@/lib/store'
import { APP_BYLINE, REPO_URL } from '@/lib/brand'
import { YoruMark } from '@/components/YoruMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  docs: DocRecord[]
  activeId: string
  docName: string
  onRename: (name: string) => void
  onSelectDoc: (id: string) => void
  onCreateDoc: () => void
  /** Open a fresh copy of the syntax-showcase article. */
  onCreateSample: () => void
  onDeleteDoc: (id: string) => void
  syncState: 'loading' | 'synced' | 'saving' | 'local' | 'error' | 'local-error'
  /** Put the open article into the drafts box. Nothing else does that. */
  onSaveDraft: () => void
  saving: boolean
  /** Edited since the last explicit save, or never saved at all. */
  unsaved: boolean
  onOpenDrafts: () => void
  onOpenMaterials: () => void
  themeId: string
  onTheme: (id: string) => void
  miniPreview: (themeId: string) => string
  onOpenThemes: () => void
  copying: boolean
  onCopy: () => void
  onExport: (kind: 'clean' | 'page' | 'markdown' | 'bundle') => void
  onImport: (kind: 'markdown' | 'docx' | 'bundle') => void
  importing: boolean
  onOpenReferences: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  userName: string
  onLogin: () => void
  onLogout: () => void
  remoteConnected?: boolean
}

const THEME_DOT: Record<string, string> = {
  golden: '#4F6CE8',
  minimal: '#0E1525',
  steady: '#1EA8A0',
}

export default function TopBar(p: Props) {
  const { t } = useI18n()
  const syncLabel =
    p.remoteConnected && p.syncState === 'local'
      ? { text: t('topbar.sync.localMcp'), color: 'var(--primary-500)', title: t('topbar.sync.localMcpTitle') }
      : {
          loading: { text: t('topbar.sync.loading'), color: 'var(--ink-3)', title: t('topbar.sync.loadingTitle') },
          saving: { text: t('topbar.sync.saving'), color: 'var(--primary-500)', title: t('topbar.sync.savingTitle') },
          synced: { text: t('topbar.sync.synced'), color: 'var(--success-500)', title: t('topbar.sync.syncedTitle') },
          local: { text: t('topbar.sync.local'), color: 'var(--warning-700)', title: t('topbar.sync.localTitle') },
          error: { text: t('topbar.sync.error'), color: 'var(--error-500)', title: t('topbar.sync.errorTitle') },
          'local-error': {
            text: t('topbar.sync.localError'),
            color: 'var(--error-500)',
            title: t('topbar.sync.localErrorTitle'),
          },
        }[p.syncState]
  const [themeOpen, setThemeOpen] = useState(false)
  const activeTheme = THEMES.find((th) => th.id === p.themeId) || THEMES[0]
  const { favorites } = useThemeFavorites()
  const favoriteThemes = useMemo(() => THEMES.filter((th) => favorites.has(th.id)), [favorites])

  // 快速切换器只放每类前几套：219 套每套都要实时渲染缩略图，
  // 全塞进来既慢也没法扫；完整浏览在下面的「查看全部模板」。
  // 收藏单独一组置顶、且不再进分类组，同一个主题只出现一次。
  const QUICK_PER_CAT = 6
  const QUICK_FAVORITES = 6
  const CATEGORIES = ['简约', '商务', '杂志', '活力'] as const

  const quickTile = (th: Theme) => (
    <button
      key={th.id}
      data-theme-quick={th.id}
      onClick={() => {
        p.onTheme(th.id)
        setThemeOpen(false)
      }}
      className={`group rounded-2xl p-2 text-left transition-all ${
        th.id === p.themeId ? 'ya-selected' : 'bg-surface-sunken hover:bg-surface-base'
      }`}
      style={th.id === p.themeId ? undefined : { boxShadow: 'var(--shadow-inset)' }}
    >
      <div className="relative h-20 overflow-hidden rounded-lg bg-white" style={{ boxShadow: 'var(--shadow-inset)' }}>
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ width: 677, transform: 'scale(0.26)' }}
          dangerouslySetInnerHTML={{ __html: p.miniPreview(th.id) }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
        <span className="ya-dot" style={{ background: th.ui.accent }} />
        <span className="text-[12px] font-medium text-ink-1">{th.name}</span>
      </div>
    </button>
  )

  return (
    <header className="ya-glass flex h-14 shrink-0 items-center gap-3 px-4">
      {/* 左：标识 + 稿件 */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-2.5">
          <YoruMark height={17} />
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap text-[14px] font-bold tracking-wide text-ink-1">{t('app.name')}</span>
            <span className="ya-eyebrow hidden whitespace-nowrap lg:inline">{APP_BYLINE}</span>
          </div>
        </div>
        <span className="h-4 w-px bg-line-2" />
        <div className="flex items-center rounded-lg transition-colors hover:bg-line-1">
          <input
            value={p.docName}
            onChange={(e) => p.onRename(e.target.value)}
            placeholder={t('common.unnamedDoc')}
            className="w-36 bg-transparent px-1.5 py-1 text-[13px] text-ink-1 outline-none placeholder:text-ink-4"
            title={t('topbar.docNameTitle')}
          />
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-r-lg px-1.5 py-1 outline-none" title={t('topbar.switchDoc')}>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-ink-3">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="ya-pop w-64 border-none">
              {p.docs.map((d) => (
                <DropdownMenuItem key={d.id} onSelect={() => p.onSelectDoc(d.id)} className="flex items-center justify-between gap-2 rounded-lg">
                  <span className="truncate">{d.name || t('common.unnamedDoc')}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {d.id === p.activeId && <span className="ya-dot" style={{ background: 'var(--primary-500)' }} />}
                    {p.docs.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // No confirm here: the delete is reversible via the undo toast.
                          p.onDeleteDoc(d.id)
                        }}
                        className="ya-link-btn danger"
                        title={t('topbar.deleteDoc')}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onCreateDoc} className="rounded-lg">{t('topbar.newDoc')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={p.onCreateSample} className="rounded-lg">
                {t('topbar.newSample')}
                <span className="ml-auto text-[11px] text-ink-3">{t('topbar.newSampleHint')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: syncLabel.color, fontFamily: 'var(--font-mono)' }}
          title={syncLabel.title}
        >
          {syncLabel.text}
        </span>
      </div>

      <div className="flex-1" />

      {/* 中：主题切换（实时缩略预览） */}
      <Popover open={themeOpen} onOpenChange={setThemeOpen}>
        <PopoverTrigger asChild>
          <button data-theme-switcher className="ya-btn-secondary ya-btn">
            <span className="h-2 w-2 rounded-full" style={{ background: THEME_DOT[activeTheme.id] || 'var(--primary-500)' }} />
            {activeTheme.name}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-ink-3">
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="ya-pop w-[600px] border-none p-3">
          <p className="ya-eyebrow mb-2 px-1">{t('topbar.themes.eyebrow')}</p>
          <div className="max-h-[62vh] overflow-y-auto pr-0.5">
            {favoriteThemes.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold tracking-[0.12em] text-ink-4">
                  <span style={{ color: 'var(--primary-500)' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 3.2l2.6 5.3 5.9.85-4.25 4.14 1 5.86L12 16.7l-5.25 2.65 1-5.86L3.5 9.35l5.9-.85z" />
                    </svg>
                  </span>
                  {t('topbar.themes.favorites')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {favoriteThemes.slice(0, QUICK_FAVORITES).map(quickTile)}
                </div>
                {favoriteThemes.length > QUICK_FAVORITES && (
                  <button
                    onClick={() => {
                      setThemeOpen(false)
                      p.onOpenThemes()
                    }}
                    className="mt-1.5 px-1 text-[11px] text-brand-600 hover:underline"
                  >
                    {t('topbar.themes.moreFavorites', { n: favoriteThemes.length - QUICK_FAVORITES })}
                  </button>
                )}
              </div>
            )}
            {CATEGORIES.map((cat) => {
              const all = THEMES.filter((th) => th.category === cat && !favorites.has(th.id))
              const list = all.slice(0, QUICK_PER_CAT)
              if (
                activeTheme.category === cat &&
                !favorites.has(activeTheme.id) &&
                !list.some((th) => th.id === activeTheme.id)
              ) {
                list.unshift(activeTheme)
              }
              if (!list.length) return null
              return (
                <div key={cat} className="mb-3">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold tracking-[0.12em] text-ink-4">
                    {t(`topbar.category.${cat}`)}
                  </p>
                  <div className="grid grid-cols-3 gap-2">{list.map(quickTile)}</div>
                </div>
              )
            })}
          </div>
          <button
            onClick={() => {
              setThemeOpen(false)
              p.onOpenThemes()
            }}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-[12px] text-brand-600 transition-colors hover:bg-surface-tint"
          >
            {t('topbar.themes.viewAll', { n: THEMES.length })}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </PopoverContent>
      </Popover>

      {/* 右：动作区 */}
      <div className="flex items-center gap-2">
        <button
          onClick={p.onOpenDrafts}
          className="ya-btn-secondary ya-btn"
          title={t('topbar.draftsTitle')}
        >
          {t('topbar.drafts')}
        </button>

        <button
          onClick={p.onOpenMaterials}
          className="ya-btn-secondary ya-btn"
          title={t('topbar.materialsTitle')}
        >
          {t('topbar.materials')}
        </button>

        <button
          onClick={p.onSaveDraft}
          disabled={p.saving}
          title={p.unsaved ? t('topbar.saveTitleUnsaved') : t('topbar.saveTitleSaved')}
          className={`ya-btn ${p.unsaved ? 'ya-btn-primary' : 'ya-btn-secondary'}`}
        >
          {/* warning 小黄点是唯一的未保存指示 */}
          {p.unsaved && <span className="ya-unsaved-dot" />}
          {p.saving ? t('topbar.saving') : p.unsaved ? t('topbar.save') : t('topbar.saved')}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ya-btn-secondary ya-btn" disabled={p.importing}>
              {p.importing ? t('topbar.importing') : t('topbar.import')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ya-pop w-56 border-none">
            <DropdownMenuItem onSelect={() => p.onImport('markdown')} className="rounded-lg">
              {t('topbar.import.markdown')}
              <span className="ml-auto text-[11px] text-ink-3">.md</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onImport('docx')} className="rounded-lg">
              {t('topbar.import.docx')}
              <span className="ml-auto text-[11px] text-ink-3">.docx</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onImport('bundle')} className="rounded-lg">
              {t('topbar.import.bundle')}
              <span className="ml-auto text-[11px] text-ink-3">.json</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ya-btn-secondary ya-btn">
              {t('topbar.export')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ya-pop w-56 border-none">
            <DropdownMenuItem onSelect={() => p.onExport('markdown')} className="rounded-lg">
              {t('topbar.export.markdown')}
              <span className="ml-auto text-[11px] text-ink-3">{t('topbar.export.markdownHint')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onExport('clean')} className="rounded-lg">
              {t('topbar.export.clean')}
              <span className="ml-auto text-[11px] text-ink-3">{t('topbar.export.cleanHint')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onExport('page')} className="rounded-lg">
              {t('topbar.export.page')}
              <span className="ml-auto text-[11px] text-ink-3">{t('topbar.export.pageHint')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => p.onExport('bundle')} className="rounded-lg">
              {t('topbar.export.bundle')}
              <span className="ml-auto text-[11px] text-ink-3">{t('topbar.export.bundleHint')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={p.onCopy}
          className="ya-btn ya-btn-primary px-4"
        >
          {p.copying ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('common.copied')}
            </>
          ) : (
            t('topbar.copy')
          )}
        </button>

        <button
          onClick={p.onTogglePanel}
          title={p.panelOpen ? t('topbar.panelCollapse') : t('topbar.panelExpand')}
          className={`ya-btn ya-btn-sm !h-9 !w-9 !p-0 ${p.panelOpen ? 'ya-btn-ghost text-ink-1' : 'ya-btn-secondary'}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M15 4v16" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>

        <LanguageToggle />
        <ThemeToggle />

        <span className="h-4 w-px bg-line-2" />
        {REPO_URL && (
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            title={t('topbar.github')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-1 transition-colors hover:bg-line-1"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.66.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/>
            </svg>
          </a>
        )}
        {p.userName ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-1 outline-none transition-colors hover:bg-line-1">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 10.5 12 3l9 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 9.5V21h14V9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="max-w-[80px] truncate">{p.userName}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ya-pop border-none">
              <DropdownMenuItem onSelect={p.onOpenReferences} className="rounded-lg">{t('topbar.references')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onLogout} className="rounded-lg">{t('topbar.logout')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={p.onLogin}
            className="ya-link-btn whitespace-nowrap !px-2.5 !py-1.5 !text-[12px]"
            title={t('topbar.loginTitle')}
          >
            {t('topbar.login')}
          </button>
        )}
      </div>
    </header>
  )
}
