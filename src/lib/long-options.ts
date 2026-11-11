/**
 * Remember the long-image template, variant, export width and format. The key
 * follows docs/branding.md's `mopai.*` convention.
 */
import {
 LONG_EXPORT_WIDTHS, LONG_FORMATS, type LongExportWidth, type LongFormat,
} from './long-image'
import { longTemplateVariants } from './cards'
import { publicLongTemplateRuntimeId } from './public-card-templates'

export const LONG_OPTIONS_KEY = 'mopai.long-options.v1'

export interface LongOptions {
 template: string
 variant: string
 width: LongExportWidth
 format: LongFormat
}

export const DEFAULT_LONG_OPTIONS: LongOptions = {
 template: publicLongTemplateRuntimeId('blue-tech-recap'),
 variant: 'blue',
 width:1080,
 format: 'jpg',
}

/** Clamp a remembered selection to the templates that are actually loaded. */
export function reconcileLongOptions(
 options: Partial<LongOptions> | null | undefined,
 available: ReadonlySet<string>,
): LongOptions {
 const remembered = typeof options?.template === 'string' && available.has(options.template)
 const template: string = remembered && options?.template ? options.template : DEFAULT_LONG_OPTIONS.template
 const variants = longTemplateVariants(template)
 // When the saved template is gone its variant means nothing; use the
 // fallback's first variant. While a kept package is merely not activated yet,
 // keep the remembered id instead of switching it silently.
 const variant = !remembered
 ? variants[0] ?? DEFAULT_LONG_OPTIONS.variant
 : variants.length ===0
 ? (options?.variant || DEFAULT_LONG_OPTIONS.variant)
 : variants.includes(options?.variant ?? '')
 ? options!.variant!
 : variants[0] ?? DEFAULT_LONG_OPTIONS.variant
 const width = (LONG_EXPORT_WIDTHS as readonly number[]).includes(options?.width ?? -1)
 ? options!.width as LongExportWidth
 : DEFAULT_LONG_OPTIONS.width
 const format = (LONG_FORMATS as readonly string[]).includes(options?.format ?? '')
 ? options!.format as LongFormat
 : DEFAULT_LONG_OPTIONS.format
 return { template, variant, width, format }
}

export function loadLongOptions(
 storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): LongOptions | null {
 if (!storage) return null
 try {
 const raw = storage.getItem(LONG_OPTIONS_KEY)
 if (!raw) return null
 const parsed = JSON.parse(raw) as Partial<LongOptions>
 if (!parsed || typeof parsed !== 'object') return null
 if (typeof parsed.template !== 'string' || typeof parsed.variant !== 'string') return null
 if (!(LONG_EXPORT_WIDTHS as readonly number[]).includes(parsed.width ?? -1)) return null
 if (!(LONG_FORMATS as readonly string[]).includes(parsed.format ?? '')) return null
 return {
 template: parsed.template,
 variant: parsed.variant,
 width: parsed.width as LongExportWidth,
 format: parsed.format as LongFormat,
 }
 } catch {
 return null
 }
}

export function saveLongOptions(
 options: LongOptions,
 storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
 if (!storage) return
 try {
 storage.setItem(LONG_OPTIONS_KEY, JSON.stringify(options))
 } catch {
 /* private mode / quota: the session still works, it just will not remember */
 }
}
