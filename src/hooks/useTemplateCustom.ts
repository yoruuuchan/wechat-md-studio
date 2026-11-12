import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TemplateCustomizeRuntime } from '@/lib/cards'
import {
  currentTemplateCustomStore, resolveTemplateCustom, subscribeTemplateCustomStore, templateCustom,
  type ResolvedTemplateCustom, type TemplateCustomStore,
} from '@/lib/template-custom'
import {
  currentUserFonts, loadUserFonts, subscribeUserFonts, userFontFamilyIfLoaded, type UserFont,
} from '@/lib/user-fonts'

export function useTemplateCustomStore(): TemplateCustomStore {
  return useSyncExternalStore(subscribeTemplateCustomStore, currentTemplateCustomStore, currentTemplateCustomStore)
}

/** Fonts from the reader's computer; the first caller starts loading them. */
export function useUserFonts(): UserFont[] {
  useEffect(() => { void loadUserFonts() }, [])
  return useSyncExternalStore(subscribeUserFonts, currentUserFonts, currentUserFonts)
}

/**
 * The picks for one template + variant, reduced to what the engine applies.
 * The result is stable while the picks are, so it can sit in effect deps.
 */
export function useResolvedTemplateCustom(
  template: string,
  variant: string,
  slots: TemplateCustomizeRuntime,
): ResolvedTemplateCustom & { key: string } {
  const store = useTemplateCustomStore()
  const userFonts = useUserFonts()
  const resolved = resolveTemplateCustom(templateCustom(store, template), variant, slots, userFontFamilyIfLoaded)
  // userFonts is read through userFontFamilyIfLoaded; listing it here makes a
  // font that finishes loading after the first render apply without a reload.
  const key = JSON.stringify([resolved, userFonts.length])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ...resolved, key }), [key])
}
