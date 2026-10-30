import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ThemeCatalogEntry } from '@/lib/theme-meta'
import type { MathSnapshot } from '@/lib/math'
import type { DiagramCache } from '@/lib/diagram'
import type { SignatureConfig } from '@/lib/types'
import type { ThemePreviewSource } from '@/lib/theme-library-state'
import type { TrialArticleState } from '@/hooks/useTrialArticle'
import { ThemeTrialPreview } from '@/components/ThemeTrialPreview'
import { ThemeTrialSourceSwitch } from '@/components/ThemeTrialSourceSwitch'
import { useI18n } from '@/hooks/useI18n'

type Sig = SignatureConfig

function reasonText(t: ReturnType<typeof useI18n>['t'], article: TrialArticleState): string | null {
  switch (article.reason) {
    case 'read-failed':
      return t('themes.trial.readFailed')
    case 'stub':
      return t('themes.trial.stub')
    case 'missing':
      return t('themes.trial.missing')
    case 'empty':
      return t('themes.trial.empty')
    case 'none':
      return t('themes.trial.none')
    case 'deleted':
      return t('themes.trial.deleted')
    case 'failed':
      return t('themes.trial.failed')
    default:
      return null
  }
}

/**
 * Side-by-side trial of up to three themes on the same article.
 *
 * Applying is the only action in this dialog that writes anything: previewing,
 * switching the source and closing never call saveSettings or touch the body.
 */
export function ThemeCompareDialog({
  open,
  onOpenChange,
  themes,
  activeThemeId,
  article,
  source,
  onSourceChange,
  math,
  diagrams,
  mathPending,
  sig,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  themes: ThemeCatalogEntry[]
  activeThemeId: string
  article: TrialArticleState
  source: ThemePreviewSource
  onSourceChange: (source: ThemePreviewSource) => void
  math: MathSnapshot
  diagrams: DiagramCache
  mathPending: boolean
  sig: Sig
  onApply: (theme: ThemeCatalogEntry) => void
}) {
  const { t } = useI18n()
  const reason = article.status === 'ready' ? null : reasonText(t, article)
  const loading = source === 'current' && article.status === 'loading'

  const sourceSwitch = <ThemeTrialSourceSwitch source={source} onChange={onSourceChange} />

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92vh,920px)] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        style={{ background: 'var(--bg-base)' }}
      >
        <div className="flex flex-col gap-2.5 border-b px-4 py-3.5 sm:px-5" style={{ borderColor: 'var(--line-2)' }}>
          <div className="flex flex-wrap items-start gap-2.5">
            <div className="min-w-0 flex-1 basis-full sm:basis-0">
              <DialogTitle className="text-[15px] leading-tight">{t('themes.compare.title')}</DialogTitle>
              <DialogDescription className="mt-1 text-[11.5px] leading-relaxed">
                {t('themes.compare.subtitle', { max: 3 })}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {sourceSwitch}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="ya-btn ya-btn-ghost ya-btn-sm !px-2.5"
              >
                {t('themes.compare.cancel')}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t('themes.compare.close')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:text-ink-1"
                style={{ boxShadow: 'var(--shadow-inset)' }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {reason && (
            <div
              role="status"
              data-trial-reason={article.reason}
              className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--bg-tint)', color: 'var(--ink-2)' }}
            >
              <span className="min-w-0 flex-1">{reason}</span>
              {source === 'current' && (article.reason === 'failed' || article.reason === 'read-failed') && (
                <button type="button" onClick={article.retry} className="ya-link-btn shrink-0">
                  {t('themes.trial.retry')}
                </button>
              )}
              {source === 'current' && article.status !== 'ready' && (
                <button type="button" onClick={() => onSourceChange('sample')} className="ya-link-btn shrink-0">
                  {t('themes.trial.useSample')}
                </button>
              )}
            </div>
          )}

          {source === 'current' && article.status === 'ready' && (
            <p className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3" data-trial-status="ready">
              <span className="truncate">{t('themes.trial.ready', { name: article.name ?? '' })}</span>
              {mathPending && (
                <span className="rounded-md px-1.5 py-0.5" style={{ background: 'var(--warning-100)', color: 'var(--warning-700)' }}>
                  {t('themes.trial.mathPending')}
                </span>
              )}
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-ink-3">
            <p data-trial-status="loading">{t('themes.trial.loading')}</p>
          </div>
        ) : themes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-ink-3">
            {t('themes.compare.empty', { max: 3 })}
          </div>
        ) : (
          <div
            className="flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto p-3 sm:p-4 md:grid md:overflow-visible"
            style={{ gridTemplateColumns: `repeat(${themes.length}, minmax(0, 1fr))` }}
            data-compare-grid
          >
            {themes.map((theme) => (
              <section
                key={theme.id}
                data-compare-panel={theme.id}
                className="flex min-h-0 min-w-[85vw] snap-center flex-col overflow-hidden rounded-2xl sm:min-w-[420px] md:min-w-0"
                style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-pop)' }}
              >
                <header className="flex items-start gap-2 border-b px-3 py-2.5" style={{ borderColor: 'var(--line-2)' }}>
                  <span className="ya-dot mt-1.5 shrink-0" style={{ background: theme.ui.accent }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-1">{theme.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-ink-2">
                      {theme.meta.origin.project} · {theme.meta.origin.license}
                    </p>
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto bg-white p-2.5" data-compare-scroll>
                  <ThemeTrialPreview
                    theme={theme}
                    doc={article.doc}
                    sig={sig}
                    math={math}
                    diagrams={diagrams}
                  />
                </div>
                <footer className="border-t px-3 py-2.5" style={{ borderColor: 'var(--line-2)' }}>
                  <button
                    type="button"
                    data-compare-apply={theme.id}
                    disabled={theme.id === activeThemeId}
                    onClick={() => {
                      onApply(theme)
                      onOpenChange(false)
                    }}
                    className={`ya-btn w-full ${theme.id === activeThemeId ? 'ya-btn-ghost' : 'ya-btn-primary'}`}
                  >
                    {theme.id === activeThemeId ? t('themes.compare.current') : t('themes.compare.apply')}
                  </button>
                </footer>
              </section>
            ))}
          </div>
        )}

        <p className="shrink-0 px-4 pb-3 text-center text-[10.5px] text-ink-4 sm:px-5">
          {t('themes.compare.trialNote')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
