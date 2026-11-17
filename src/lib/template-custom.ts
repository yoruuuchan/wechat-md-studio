/**
 * A reader's colour and font picks for a template, kept per device.
 *
 * Picks are stored per runtime template id. Colours are also keyed by variant,
 * because a dark variant's palette is a different design; fonts apply to every
 * variant of the template. Only slots the template declares in `customize` are
 * ever applied, so a pick for a slot a later template version dropped is
 * ignored rather than leaking into unrelated CSS.
 *
 * The key follows docs/branding.md's `mopai.*` convention.
 */
import { isSafeColor } from './card-template-format'
import { catalogFont } from './font-catalog'
import type { CardFontFace, TemplateCustomizeRuntime } from './cards'

export const TEMPLATE_CUSTOM_KEY = 'mopai.template-custom.v1'

export type FontPick =
  | { source: 'builtin'; family: string }
  | { source: 'user'; id: string }

export interface TemplateCustom {
  /** variant id → custom property → colour */
  colors: Record<string, Record<string, string>>
  /** custom property → font */
  fonts: Record<string, FontPick>
}

export type TemplateCustomStore = Record<string, TemplateCustom>

const EMPTY: TemplateCustom = { colors: {}, fonts: {} }

function isFontPick(value: unknown): value is FontPick {
  if (!value || typeof value !== 'object') return false
  const pick = value as Record<string, unknown>
  return (pick.source === 'builtin' && typeof pick.family === 'string') ||
    (pick.source === 'user' && typeof pick.id === 'string')
}

/** Drop anything malformed instead of refusing the whole store. */
export function normalizeTemplateCustomStore(value: unknown): TemplateCustomStore {
  const out: TemplateCustomStore = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [template, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const colors: TemplateCustom['colors'] = {}
    if (entry.colors && typeof entry.colors === 'object') {
      for (const [variant, map] of Object.entries(entry.colors as Record<string, unknown>)) {
        if (!map || typeof map !== 'object') continue
        const kept = Object.fromEntries(Object.entries(map as Record<string, unknown>)
          .filter((pair): pair is [string, string] => typeof pair[1] === 'string' && isSafeColor(pair[1])))
        if (Object.keys(kept).length) colors[variant] = kept
      }
    }
    const fonts: TemplateCustom['fonts'] = {}
    if (entry.fonts && typeof entry.fonts === 'object') {
      for (const [name, pick] of Object.entries(entry.fonts as Record<string, unknown>)) {
        if (isFontPick(pick)) fonts[name] = pick
      }
    }
    if (Object.keys(colors).length || Object.keys(fonts).length) out[template] = { colors, fonts }
  }
  return out
}

export function loadTemplateCustomStore(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): TemplateCustomStore {
  if (!storage) return {}
  try {
    const raw = storage.getItem(TEMPLATE_CUSTOM_KEY)
    return raw ? normalizeTemplateCustomStore(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function saveTemplateCustomStore(
  store: TemplateCustomStore,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  if (!storage) return
  try {
    storage.setItem(TEMPLATE_CUSTOM_KEY, JSON.stringify(store))
  } catch {
    /* private mode / quota: the picks still apply for this session */
  }
}

export function templateCustom(store: TemplateCustomStore, template: string): TemplateCustom {
  return store[template] ?? EMPTY
}

function withEntry(store: TemplateCustomStore, template: string, entry: TemplateCustom): TemplateCustomStore {
  const next = { ...store }
  const empty = !Object.keys(entry.colors).length && !Object.keys(entry.fonts).length
  if (empty) delete next[template]
  else next[template] = entry
  return next
}

/** `null` clears the pick and returns that slot to the template's own value. */
export function setCustomColor(
  store: TemplateCustomStore, template: string, variant: string, name: string, color: string | null,
): TemplateCustomStore {
  const entry = templateCustom(store, template)
  const variantColors = { ...(entry.colors[variant] ?? {}) }
  if (color === null) delete variantColors[name]
  else if (isSafeColor(color)) variantColors[name] = color
  else return store
  const colors = { ...entry.colors }
  if (Object.keys(variantColors).length) colors[variant] = variantColors
  else delete colors[variant]
  return withEntry(store, template, { ...entry, colors })
}

export function setCustomFont(
  store: TemplateCustomStore, template: string, name: string, pick: FontPick | null,
): TemplateCustomStore {
  const entry = templateCustom(store, template)
  const fonts = { ...entry.fonts }
  if (pick === null) delete fonts[name]
  else fonts[name] = pick
  return withEntry(store, template, { ...entry, fonts })
}

/** Reset every colour of one variant and every font of the template. */
export function resetTemplateCustom(store: TemplateCustomStore, template: string, variant: string): TemplateCustomStore {
  const entry = templateCustom(store, template)
  const colors = { ...entry.colors }
  delete colors[variant]
  return withEntry(store, template, { colors, fonts: {} })
}

/** Forget a user font everywhere, e.g. after it was deleted. */
export function dropUserFontPicks(store: TemplateCustomStore, id: string): TemplateCustomStore {
  let next = store
  for (const [template, entry] of Object.entries(store)) {
    for (const [name, pick] of Object.entries(entry.fonts)) {
      if (pick.source === 'user' && pick.id === id) next = setCustomFont(next, template, name, null)
    }
  }
  return next
}

/** A quoted family followed by fallbacks that cover CJK and Latin. */
export function fontStack(family: string): string {
  return `"${family.replace(/["\\]/g, '')}", "Noto Sans SC", sans-serif`
}

/** What the engine needs from the picks of one template + variant. */
export interface ResolvedTemplateCustom {
  /** Custom property → value, written inline on the card page / long root. */
  vars: Record<string, string>
  /** Catalog faces that must be loaded before measuring and embedded on export. */
  faces: CardFontFace[]
  /** User fonts in use, by id. */
  userFonts: string[]
}

export const NO_TEMPLATE_CUSTOM: ResolvedTemplateCustom = { vars: {}, faces: [], userFonts: [] }

/**
 * `userFamily` maps a stored user font id to its registered family, or
 * undefined when that font is gone (deleted, or not on this device).
 */
export function resolveTemplateCustom(
  custom: TemplateCustom,
  variant: string,
  slots: TemplateCustomizeRuntime,
  userFamily: (id: string) => string | undefined,
): ResolvedTemplateCustom {
  const vars: Record<string, string> = {}
  const faces: CardFontFace[] = []
  const userFonts: string[] = []
  const colors = custom.colors[variant] ?? {}
  for (const slot of slots.colors) {
    const value = colors[slot.var]
    if (value && isSafeColor(value)) vars[slot.var] = value
  }
  for (const slot of slots.fonts) {
    const pick = custom.fonts[slot.var]
    if (!pick) continue
    if (pick.source === 'builtin') {
      const font = catalogFont(pick.family)
      if (!font) continue
      vars[slot.var] = fontStack(font.family)
      if (!faces.some((face) => face.family === font.family)) faces.push({ family: font.family, weights: font.weights })
    } else {
      const family = userFamily(pick.id)
      if (!family) continue
      vars[slot.var] = fontStack(family)
      if (!userFonts.includes(pick.id)) userFonts.push(pick.id)
    }
  }
  return { vars, faces, userFonts }
}

/** Write resolved values onto an element as inline custom properties. */
export function applyTemplateCustomVars(element: HTMLElement, vars: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value)
}

// ---------------------------------------------------------------------------
// A tiny shared store so the settings panel and both previews see one value.

let current: TemplateCustomStore | null = null
const listeners = new Set<() => void>()

export function currentTemplateCustomStore(): TemplateCustomStore {
  if (current === null) current = loadTemplateCustomStore()
  return current
}

export function updateTemplateCustomStore(update: (store: TemplateCustomStore) => TemplateCustomStore): void {
  const next = update(currentTemplateCustomStore())
  if (next === current) return
  current = next
  saveTemplateCustomStore(next)
  for (const listener of listeners) listener()
}

export function subscribeTemplateCustomStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
