import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PanelRightOpen } from 'lucide-react'
import type { DocRecord } from '@/lib/store'
import { REPO_URL } from '@/lib/brand'
import { YoruMark } from '@/components/YoruMark'
import { useI18n } from '@/hooks/useI18n'
import { SaveStatus } from '@/components/SaveStatus'
import type { ArticleSaveStatus } from '@/lib/save-status'

export type EditorMode = 'wechat' | 'cards'

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
  saveStatus: ArticleSaveStatus | null
  readable: boolean
  retryingLocal: boolean
  onRetryLocal: () => void
  onRetryCloud: () => void
  onOpenConflict: () => void
  /** Put the open article into the drafts box. Nothing else does that. */
  onSaveDraft: () => void
  saving: boolean
  /** Edited since the last explicit save, or never saved at all. */
  unsaved: boolean
  onOpenDrafts: () => void
  onOpenMaterials: () => void
  copying: boolean
  onCopy: () => void
  onExport: (kind: 'clean' | 'page' | 'markdown' | 'bundle') => void
  onImport: (kind: 'markdown' | 'docx' | 'bundle') => void
  importing: boolean
  onOpenReferences: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  /** Open the right panel on its 设置 tab (wide column, drawer or phone pane). */
  onOpenSettings: () => void
  /** Medium layout: images/settings live in a drawer, so the bar opens it. */
  onOpenSidePanel?: () => void
  userName: string
  signedIn: boolean
  onLogin: () => void
  onLogout: () => void
  remoteConnected?: boolean

  /** Article preview or card preview. The other two modes are placeholders. */
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  /** Cards have finished layout and can be exported as one ZIP. */
  cardsReady: boolean
  cardsExporting: boolean
  cardsProgress: { done: number; total: number }
  onExportAll: () => void

  /** Phone merges the mode navigation into the top bar as a pill menu. */
  phone: boolean
  /** Wide shows the full mode labels; medium uses the shorter ones. */
  wide: boolean
}

type ModeItem = { id: EditorMode | 'long' | 'motion'; label: string; soon?: boolean }
type Translate = ReturnType<typeof useI18n>['t']

/** The four entries share their labels and order with the wide navigation. */
function modeItems(t: Translate, compact: boolean): ModeItem[] {
  return [
    { id: 'wechat', label: compact ? t('topbar.mode.wechatShort') : t('topbar.mode.wechat') },
    { id: 'cards', label: compact ? t('topbar.mode.cardsShort') : t('topbar.mode.cards') },
    // Placeholders are visible and focusable so their "coming soon" hint is
    // reachable by keyboard, but choosing them changes nothing.
    { id: 'long', label: compact ? t('topbar.mode.longShort') : t('topbar.mode.long'), soon: true },
    { id: 'motion', label: compact ? t('topbar.mode.motionShort') : t('topbar.mode.motion'), soon: true },
  ]
}

function ModeNav({
  mode,
  onModeChange,
  compact,
  fullWidth,
}: {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  compact: boolean
  fullWidth?: boolean
}) {
  const { t } = useI18n()
  const items = modeItems(t, compact)

  return (
    <div
      data-topbar-modes
      role="group"
      aria-label={t('topbar.mode.label')}
      className={`ya-well flex items-center gap-0.5 rounded-xl p-0.5 ${fullWidth ? 'w-full' : ''}`}
    >
      {items.map((item) => {
        const selected = !item.soon && mode === item.id
        const button = (
          <button
            key={item.id}
            type="button"
            data-preview-mode={item.id}
            data-mode-placeholder={item.soon ? 'true' : undefined}
            aria-pressed={item.soon ? undefined : selected}
            aria-disabled={item.soon ? 'true' : undefined}
            aria-label={item.soon ? `${item.label} · ${t('topbar.mode.soon')}` : item.label}
            onClick={() => {
              if (item.soon) return
              onModeChange(item.id as EditorMode)
            }}
            className={`ya-tool !h-9 whitespace-nowrap rounded-xl ${compact ? '!px-2' : '!px-3'} !text-[12px] font-medium transition-all ${
              fullWidth ? 'flex-1' : ''
            } ${selected ? 'ya-selected text-ink-1' : ''} ${
              item.soon ? 'cursor-not-allowed text-ink-4 opacity-50 hover:bg-transparent' : 'text-ink-2'
            }`}
          >
            {item.label}
          </button>
        )
        // A placeholder is still focusable, so keyboard users hear why it does
        // nothing through its aria-label; the tooltip is the pointer hint.
        if (!item.soon) return button
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{t('topbar.mode.soon')}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/**
 * Phone-only mode switch: the current mode and a chevron in one pill. The
 * menu keeps the same four entries and the same disabled placeholders as the
 * wide navigation, so the mode row under the bar is no longer needed.
 */
function PhoneModePicker({
  mode,
  onModeChange,
}: {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}) {
  const { t } = useI18n()
  const items = modeItems(t, true)
  const current = items.find((item) => !item.soon && item.id === mode) ?? items[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-topbar-mode-pill
          data-mode={mode}
          aria-label={`${t('topbar.mode.label')} · ${current.label}`}
          title={t('topbar.mode.label')}
          className="ya-tool ya-selected !h-9 shrink-0 whitespace-nowrap rounded-xl !px-2 !text-[12px] font-medium text-ink-1"
        >
          <span>{current.label}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true" className="text-ink-3">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="ya-pop w-48 border-none">
        {items.map((item) => {
          const selected = !item.soon && mode === item.id
          return (
            <DropdownMenuItem
              key={item.id}
              data-preview-mode={item.id}
              data-mode-placeholder={item.soon ? 'true' : undefined}
              data-mode-selected={selected ? 'true' : undefined}
              aria-disabled={item.soon ? 'true' : undefined}
              disabled={item.soon}
              onSelect={() => {
                if (item.soon) return
                onModeChange(item.id as EditorMode)
              }}
              className={`rounded-lg ${selected ? 'ya-selected text-ink-1' : ''} ${item.soon ? 'opacity-50' : ''}`}
            >
              <span>{item.label}</span>
              {item.soon && <span className="ml-auto text-[11px] font-normal text-ink-3">{t('topbar.mode.soon')}</span>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function TopBar(p: Props) {
  const { t } = useI18n()

  const copyButton = (
    <button
      data-onboarding="copy"
      data-topbar-primary
      onClick={p.onCopy}
      title={t('topbar.copy')}
      className={`ya-btn ya-btn-primary whitespace-nowrap ${p.phone ? '!px-2.5 !text-[12px]' : 'px-4'}`}
    >
      {p.copying ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('common.copied')}
        </>
      ) : p.wide ? (
        t('topbar.copy')
      ) : (
        t('topbar.copyShort')
      )}
    </button>
  )

  const cardsButton = (
    <button
      data-topbar-primary
      data-card-export-all
      onClick={p.onExportAll}
      disabled={!p.cardsReady || p.cardsExporting}
      title={t('cards.exportAll')}
      className={`ya-btn ya-btn-primary whitespace-nowrap ${p.phone ? '!px-2.5 !text-[12px]' : 'px-4'}`}
    >
      {p.cardsExporting ? (
        t('topbar.exportingShort', { done: p.cardsProgress.done, total: p.cardsProgress.total })
      ) : p.wide ? (
        t('cards.exportAll')
      ) : (
        t('topbar.exportAllShort')
      )}
    </button>
  )

  const primaryAction: ReactNode = p.mode === 'cards' ? cardsButton : copyButton

  return (
    <header data-topbar className="ya-glass flex shrink-0 flex-col">
      <div data-topbar-main className={`flex h-14 items-center ${p.phone ? 'gap-1.5 px-2' : 'gap-2 px-3'}`}>
        {/* Left: brand, article name and the save state. At 640px the longer
            English labels do not fit beside a fixed-width name column, so below
            768px the name yields space and truncates instead of pushing the mode
            navigation over its neighbours. */}
        <div className={`flex min-w-0 items-center ${p.phone ? 'flex-1 gap-1.5' : 'flex-1 gap-2 min-[768px]:flex-none'}`}>
          <div className="flex shrink-0 items-center gap-2">
            {p.wide && <YoruMark height={17} />}
            <span className="whitespace-nowrap text-[14px] font-bold tracking-wide text-ink-1">{t('app.name')}</span>
          </div>
          <span className={`h-4 w-px shrink-0 bg-line-2 ${p.phone ? 'hidden' : ''}`} />
          <div
            data-doc-name-group
            className={`flex min-w-0 items-center rounded-lg transition-colors hover:bg-line-1 ${
              p.phone ? 'flex-1' : 'flex-1 min-[768px]:w-[8rem] min-[960px]:w-[9rem] min-[768px]:shrink-0'
            }`}
          >
            <input
              data-doc-name
              value={p.docName}
              onChange={(e) => p.onRename(e.target.value)}
              placeholder={t('common.unnamedDoc')}
              className={`w-full min-w-0 bg-transparent py-1 text-[13px] text-ink-1 text-ellipsis outline-none placeholder:text-ink-4 ${p.phone ? '!px-0' : 'px-1.5'}`}
              title={t('topbar.docNameTitle')}
            />
            <DropdownMenu>
              <DropdownMenuTrigger className="shrink-0 rounded-r-lg px-1.5 py-1 outline-none" title={t('topbar.switchDoc')}>
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
          <div className={`${p.phone ? 'w-[66px]' : p.wide ? 'w-[88px]' : 'w-[72px]'} shrink-0`}>
            <SaveStatus
              status={p.saveStatus}
              docName={p.docName}
              readable={p.readable}
              retryingLocal={p.retryingLocal}
              onRetryLocal={p.onRetryLocal}
              onRetryCloud={p.onRetryCloud}
              onOpenConflict={p.onOpenConflict}
              onSaveDraft={p.onSaveDraft}
              onLogin={p.onLogin}
              onExport={(kind) => p.onExport(kind)}
              remoteConnected={p.remoteConnected}
              compact
              signedIn={p.signedIn}
              saving={p.saving}
              unsaved={p.unsaved}
              quickCompact={!p.wide}
            />
          </div>
        </div>

        {/* One navigation for the whole editor; this is the widest, most
            prominent control in the bar, not a pair of small preview toggles.
            A phone has no room for a second row, so it gets the pill instead. */}
        {!p.phone && (
          <div className={`flex min-w-0 justify-center ${p.wide ? 'flex-1' : 'shrink-0 min-[768px]:flex-1'}`}>
            <ModeNav mode={p.mode} onModeChange={p.onModeChange} compact={!p.wide} />
          </div>
        )}

        {/* Right: the current mode's main action, then everything else. */}
        <div className={`flex shrink-0 items-center gap-1.5 ${p.phone ? '' : 'ml-auto'}`}>
          {p.phone && <PhoneModePicker mode={p.mode} onModeChange={p.onModeChange} />}
          {p.onOpenSidePanel && (
            <button
              data-open-side-panel
              onClick={p.onOpenSidePanel}
              title={t('topbar.sidePanelTitle')}
              aria-label={t('editor.pane.side')}
              className="ya-btn ya-btn-secondary ya-btn-sm !h-9 !w-9 !p-0"
            >
              <PanelRightOpen size={15} aria-hidden="true" />
            </button>
          )}
          {primaryAction}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-topbar-more
                className={`ya-btn ya-btn-secondary whitespace-nowrap ${p.phone ? '!px-2 !text-[12px]' : '!px-2.5 !text-[12px]'}`}
                title={t('topbar.moreTitle')}
              >
                {t('topbar.more')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ya-pop max-h-[min(72vh,560px)] w-64 overflow-y-auto border-none">
              {!p.signedIn && (
                <DropdownMenuItem data-more-item="save-draft" onSelect={p.onSaveDraft} disabled={p.saving} className="rounded-lg">
                  {t('topbar.save')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem data-more-item="drafts" onSelect={p.onOpenDrafts} className="rounded-lg">
                {t('topbar.drafts')}
              </DropdownMenuItem>
              <DropdownMenuItem data-more-item="materials" onSelect={p.onOpenMaterials} className="rounded-lg">
                {t('topbar.materials')}
              </DropdownMenuItem>
              {p.wide && (
                <DropdownMenuItem data-more-item="panel" onSelect={p.onTogglePanel} className="rounded-lg">
                  {p.panelOpen ? t('topbar.panelCollapse') : t('topbar.panelExpand')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <p className="ya-eyebrow px-2 pb-1 pt-1.5">{t('topbar.import')}</p>
              <DropdownMenuItem data-more-item="import-markdown" data-import="markdown" onSelect={() => p.onImport('markdown')} className="rounded-lg">
                {t('topbar.import.markdown')}
              </DropdownMenuItem>
              <DropdownMenuItem data-more-item="import-docx" data-import="docx" onSelect={() => p.onImport('docx')} className="rounded-lg">
                {t('topbar.import.docx')}
              </DropdownMenuItem>
              <DropdownMenuItem data-more-item="import-bundle" data-import="bundle" onSelect={() => p.onImport('bundle')} className="rounded-lg">
                {t('topbar.import.bundle')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <p className="ya-eyebrow px-2 pb-1 pt-1.5">{t('topbar.export')}</p>
              <DropdownMenuItem data-more-item="export-markdown" data-export="markdown" onSelect={() => p.onExport('markdown')} className="rounded-lg">
                {t('topbar.export.markdown')}
              </DropdownMenuItem>
              <DropdownMenuItem data-more-item="export-clean" data-export="clean" onSelect={() => p.onExport('clean')} className="rounded-lg">
                {t('topbar.export.clean')}
              </DropdownMenuItem>
              <DropdownMenuItem data-more-item="export-page" data-export="page" onSelect={() => p.onExport('page')} className="rounded-lg">
                {t('topbar.export.page')}
              </DropdownMenuItem>
              <DropdownMenuItem data-more-item="export-bundle" data-export="bundle" onSelect={() => p.onExport('bundle')} className="rounded-lg">
                {t('topbar.export.bundle')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-more-item="appearance-language" onSelect={p.onOpenSettings} className="rounded-lg">
                {t('topbar.moreLook')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-more-item="references" onSelect={p.onOpenReferences} className="rounded-lg">
                {t('topbar.references')}
              </DropdownMenuItem>
              {REPO_URL && (
                <DropdownMenuItem asChild className="rounded-lg">
                  <a data-more-item="github" href={REPO_URL} target="_blank" rel="noreferrer">{t('topbar.github')}</a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {p.signedIn ? (
                <DropdownMenuItem data-more-item="logout" onSelect={p.onLogout} className="rounded-lg">
                  {t('topbar.logout')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem data-more-item="login" onSelect={p.onLogin} className="rounded-lg">
                  {t('topbar.login')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}