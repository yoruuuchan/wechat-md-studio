/**
 * Remember the card template / ratio / background across reloads and new
 * articles. The key keeps the historic `mopai.` prefix (docs/branding.md).
 *
 * A saved uploaded template is only trusted once it is registered again. If
 * that package was deleted or has not synced to this device yet, the selection
 * falls back to Reed instead of rendering an unknown template id.
 */
import {
  CARD_RATIOS, CARD_TEMPLATES, defaultVariant, templateRatios, templateVariants,
  type CardOptions, type CardRatio,
} from './cards'

export const CARD_OPTIONS_KEY = 'mopai.card-options.v1'

export const DEFAULT_CARD_OPTIONS: CardOptions = {
  ratio: '3:4',
  template: 'reed',
  background: 'paper',
}

function isBuiltin(template: string): boolean {
  return (CARD_TEMPLATES as readonly string[]).includes(template)
}

/**
 * Clamp a saved selection to what is actually available.
 *
 * `availableCustom` is the set of uploaded runtime template ids (`custom.*`)
 * registered at this point. Call this after the local templates finish loading:
 * an id that is no longer present drops the selection back to Reed.
 */
export function reconcileCardOptions(
  options: Partial<CardOptions> | null | undefined,
  availableCustom: ReadonlySet<string>,
): CardOptions {
  const candidate = typeof options?.template === 'string' ? options.template : ''
  const template = isBuiltin(candidate) || availableCustom.has(candidate) ? candidate : 'reed'
  const ratios = templateRatios(template)
  const ratio = ratios.includes(options?.ratio as CardRatio) ? options!.ratio as CardRatio : ratios[0]
  const variants = templateVariants(template)
  const background = variants.includes(options?.background ?? '')
    ? options!.background!
    : defaultVariant(template)
  return { ratio, template, background }
}

/** Read the last selection; unreadable or malformed data means "no preference". */
export function loadCardOptions(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): CardOptions | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CARD_OPTIONS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CardOptions>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.template !== 'string' || typeof parsed.background !== 'string') return null
    if (!(Object.keys(CARD_RATIOS) as string[]).includes(parsed.ratio ?? '')) return null
    return { ratio: parsed.ratio as CardRatio, template: parsed.template, background: parsed.background }
  } catch {
    return null
  }
}

/** Persist the selection; storage failures are non-fatal (settings already warns). */
export function saveCardOptions(
  options: CardOptions,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  if (!storage) return
  try {
    storage.setItem(CARD_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    /* private mode / quota: the session still works, it just will not remember */
  }
}