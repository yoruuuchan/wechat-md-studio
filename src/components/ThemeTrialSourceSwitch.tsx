import type { ThemePreviewSource } from '@/lib/theme-library-state'
import { useI18n } from '@/hooks/useI18n'

/** The one source switch shared by the comparison tray and dialog. */
export function ThemeTrialSourceSwitch({
  source,
  onChange,
}: {
  source: ThemePreviewSource
  onChange: (source: ThemePreviewSource) => void
}) {
  const { t } = useI18n()
  return (
    <div
      role="group"
      aria-label={t('themes.trial.sourceLabel')}
      className="flex shrink-0 items-center rounded-xl p-0.5"
      style={{ background: 'var(--bg-sunken)', boxShadow: 'var(--shadow-inset)' }}
      data-trial-source-group
    >
      {(['sample', 'current'] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-trial-source={value}
          aria-pressed={source === value}
          onClick={() => onChange(value)}
          className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
            source === value ? 'ya-selected font-semibold text-ink-1' : 'text-ink-3 hover:text-ink-1'
          }`}
        >
          {value === 'sample' ? t('themes.trial.sample') : t('themes.trial.current')}
        </button>
      ))}
    </div>
  )
}