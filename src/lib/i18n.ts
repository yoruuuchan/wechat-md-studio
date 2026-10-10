/**
 * UI language: 中文 (default) or English.
 *
 * Flat message keys in `i18n.zh.ts` are the source of truth; `i18n.en.ts` is
 * typed against them, so a missing or extra key is a compile error and
 * `i18n.test.ts` re-checks parity at runtime.
 *
 * Deliberately framework-free lookup: `t()` reads a module-level language, so
 * non-component code (toasts in hooks, editor snippets, document templates)
 * translates too. React re-renders are driven by `useI18n`. Deliberately no
 * i18n dependency: two languages, one app, no runtime key parsing.
 *
 * The stored choice is per browser under `mopai.lang.v1`; the default is 中文
 * regardless of the browser's own language, matching the product's home market.
 */

import { zh, type MsgKey, type MsgParams } from './i18n.zh'
import { en } from './i18n.en'

export type { MsgKey, MsgParams }

export type Lang = 'zh' | 'en'

const KEY = 'mopai.lang.v1'

const listeners = new Set<() => void>()

function readStored(): Lang {
  try {
    if (localStorage.getItem(KEY) === 'en') return 'en'
  } catch {
    // Private mode: fall through to the default.
  }
  return 'zh'
}

let lang: Lang = readStored()

export function currentLang(): Lang {
  return lang
}

/** Swap the interface language; persisted, applied to <html lang> and notified. */
export function setLanguage(next: Lang): void {
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // The choice not sticking only costs a switch next visit.
  }
  applyLanguage()
  for (const fn of listeners) fn()
}

export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Apply language-dependent document metadata. Called once before the first
 * paint (main.tsx) and again on every change. The narrow structural type keeps
 * this file compilable in the server tsconfig too, which has no DOM lib.
 */
export function applyLanguage(): void {
  const doc = (globalThis as { document?: { documentElement: { lang: string }; title: string } }).document
  if (!doc) return
  doc.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  doc.title = t('doc.title')
}

function interpolate(text: string, params?: MsgParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (raw, name: string) =>
    name in params ? String(params[name]) : raw,
  )
}

/** Look up one message in the current language, with `{name}` interpolation. */
export function t(key: MsgKey, params?: MsgParams): string {
  const value = (lang === 'en' ? en : zh)[key]
  return typeof value === 'function' ? value(params ?? {}) : interpolate(value, params)
}
