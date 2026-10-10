import { useI18n } from '@/hooks/useI18n'

/**
 * 中文 / English 切换。中文是默认；选择写进 localStorage（mopai.lang.v1），
 * 刷新后保持。data-lang 是无头浏览器验收的锚点。
 */
export function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div
      role="radiogroup"
      aria-label={t('lang.group')}
      className="flex shrink-0 items-center gap-0.5 rounded-xl p-0.5"
      style={{ background: 'var(--bg-sunken)', boxShadow: 'var(--shadow-inset)' }}
    >
      {(['zh', 'en'] as const).map((value) => {
        const active = lang === value
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            data-lang={value}
            title={value === 'zh' ? t('lang.zh') : t('lang.en')}
            onClick={() => setLang(value)}
            className={`flex h-6 items-center justify-center rounded-lg px-1.5 text-[11px] transition-colors ${
              active ? 'text-ink-1' : 'text-ink-4 hover:text-ink-2'
            }`}
            style={active ? { background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-flat)' } : undefined}
          >
            {value === 'zh' ? t('lang.zh') : t('lang.en')}
          </button>
        )
      })}
    </div>
  )
}
