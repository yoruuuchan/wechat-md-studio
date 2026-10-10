import { useMemo, useSyncExternalStore } from 'react'
import { currentLang, setLanguage, subscribeLanguage, t, type Lang } from '@/lib/i18n'

/**
 * Current UI language, a setter, and the translator bound to whatever the
 * module-level language is at render time. Components re-render when the
 * language changes because they subscribe through this hook.
 */
export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t } {
  const lang = useSyncExternalStore(subscribeLanguage, currentLang, currentLang)
  return useMemo(() => ({ lang, setLang: setLanguage, t }), [lang])
}
