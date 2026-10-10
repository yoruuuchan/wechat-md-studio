import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { readChoice, setThemeChoice, type ThemeChoice } from '@/lib/ui-theme'
import { useI18n } from '@/hooks/useI18n'

/** 明 / 跟随系统 / 暗 三态。默认跟随系统，点了才记住选择。 */
export function ThemeToggle() {
  const { t } = useI18n()
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice())
  const OPTIONS: { value: ThemeChoice; icon: typeof Sun; label: string }[] = [
    { value: 'akari', icon: Sun, label: t('theme.akari') },
    { value: 'system', icon: Monitor, label: t('theme.system') },
    { value: 'yoru', icon: Moon, label: t('theme.yoru') },
  ]

  useEffect(() => {
    // 别处（或系统偏好）改了也要跟着亮
    const sync = () => setChoice(readChoice())
    window.addEventListener('mopai-theme-change', sync)
    return () => window.removeEventListener('mopai-theme-change', sync)
  }, [])

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.group')}
      className="flex shrink-0 items-center gap-0.5 rounded-xl p-0.5"
      style={{ background: 'var(--bg-sunken)', boxShadow: 'var(--shadow-inset)' }}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = choice === value
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => {
              setThemeChoice(value)
              setChoice(value)
              window.dispatchEvent(new Event('mopai-theme-change'))
            }}
            className={`flex h-6 w-7 items-center justify-center rounded-lg transition-colors ${
              active ? 'text-ink-1' : 'text-ink-4 hover:text-ink-2'
            }`}
            style={active ? { background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-flat)' } : undefined}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
}
