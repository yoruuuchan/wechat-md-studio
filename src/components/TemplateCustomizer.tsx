import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/hooks/useI18n'
import { useTemplateCustomStore, useUserFonts } from '@/hooks/useTemplateCustom'
import type { TemplateCustomizeRuntime } from '@/lib/cards'
import type { MsgKey } from '@/lib/i18n'
import { CHOOSABLE_FONTS, ensureFontSheets, type CatalogFont } from '@/lib/font-catalog'
import {
  dropUserFontPicks, resetTemplateCustom, setCustomColor, setCustomFont, templateCustom,
  updateTemplateCustomStore, type FontPick,
} from '@/lib/template-custom'
import {
  addUserFont, deleteUserFont, USER_FONT_EXTENSIONS, UserFontError, type UserFont,
} from '@/lib/user-fonts'

interface Props {
  kind: 'card' | 'long'
  /** Runtime template id (the key picks are stored under). */
  template: string
  /** `data-template` written on the page, for probing the template's colours. */
  renderId: string
  /** Set for uploaded / public packages: their CSS is scoped by this attribute. */
  templateSource?: string
  variant: string
  dark: boolean
  slots: TemplateCustomizeRuntime
  /** Built-in templates name their slots with i18n keys. */
  translateNames: boolean
  busy: boolean
}

interface Rgba { hex: string; alpha: number }

/** Any CSS colour → #rrggbb plus alpha, via the canvas parser. */
function parseColor(value: string): Rgba | null {
  if (!value) return null
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#010203'
  ctx.fillStyle = value
  const parsed = String(ctx.fillStyle)
  if (parsed === '#010203' && value.trim().toLowerCase() !== '#010203') return null
  if (parsed.startsWith('#')) return { hex: parsed.toLowerCase(), alpha: 1 }
  const match = parsed.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!match) return null
  const hex = '#' + match.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  return { hex, alpha: match[4] === undefined ? 1 : Number(match[4]) }
}

/** Keep the template's own transparency when the reader only changes the hue. */
function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number(alpha.toFixed(3))})`
}

/**
 * Read the template's own value of each colour slot from an off-screen copy of
 * the page root, which carries the same attributes but none of the picks.
 */
function probeColors(props: Props): Record<string, string> {
  const probe = document.createElement('div')
  probe.className = props.kind === 'long' ? 'reed-long-root' : 'xhs-card'
  probe.dataset.template = props.renderId
  if (props.templateSource) probe.dataset.cardTemplateSource = props.templateSource
  probe.dataset.variant = props.variant
  if (props.kind === 'long') probe.dataset.kind = 'long'
  else probe.dataset.night = String(props.dark)
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;visibility:hidden'
  document.body.append(probe)
  try {
    const style = getComputedStyle(probe)
    return Object.fromEntries(props.slots.colors.map((slot) => [slot.var, style.getPropertyValue(slot.var).trim()]))
  } finally {
    probe.remove()
  }
}

const UPLOAD = '__upload'

/** Each menu entry is written in its own face, at a weight the family has. */
function catalogStyle(font: CatalogFont): CSSProperties {
  return { fontFamily: `"${font.family}"`, fontWeight: font.weights.includes(400) ? 400 : font.weights[0] }
}

// The menu shows every family, so its sheets load when the reader reaches for it.
const loadMenuFonts = () => { void ensureFontSheets(CHOOSABLE_FONTS.map((font) => font.family)) }

function pickValue(pick: FontPick | undefined): string {
  if (!pick) return ''
  return pick.source === 'builtin' ? `builtin:${pick.family}` : `user:${pick.id}`
}

/** Colour swatches and font menus for the slots a template opens up. */
export default function TemplateCustomizer(props: Props) {
  const { kind, template, variant, slots, translateNames, busy } = props
  const { t, lang } = useI18n()
  const store = useTemplateCustomStore()
  const userFonts = useUserFonts()
  const custom = templateCustom(store, template)
  const picked = custom.colors[variant] ?? {}
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const commitTimer = useRef<number | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string | null>(null)
  const label = (name: string) => translateNames ? t(name as MsgKey) : name
  const pickStyle = (pick: FontPick | undefined): CSSProperties | undefined => {
    if (pick?.source === 'builtin') {
      const font = CHOOSABLE_FONTS.find((item) => item.family === pick.family)
      return font ? catalogStyle(font) : undefined
    }
    const font = pick ? userFonts.find((item) => item.id === pick.id) : undefined
    return font ? { fontFamily: `"${font.family}"` } : undefined
  }

  // The template's stylesheet is in the document once it is activated; read
  // its colours whenever the template or variant changes.
  useLayoutEffect(() => {
    setDefaults(probeColors(props))
    setDrafts({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, template, props.renderId, props.templateSource, variant, props.dark, slots])

  useEffect(() => () => window.clearTimeout(commitTimer.current), [])

  if (!slots.colors.length && !slots.fonts.length) return null

  const changed = Object.keys(picked).length > 0 || Object.keys(custom.fonts).length > 0

  // A colour input fires on every drag step; repaginating cards on each one
  // would stall the panel, so the store hears about it once the hand rests.
  const draftColor = (name: string, hex: string) => {
    const base = parseColor(defaults[name] ?? '')
    const value = withAlpha(hex, base?.alpha ?? 1)
    setDrafts((current) => ({ ...current, [name]: value }))
    window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => {
      updateTemplateCustomStore((current) => setCustomColor(current, template, variant, name, value))
      setDrafts((current) => {
        const next = { ...current }
        delete next[name]
        return next
      })
    }, 250)
  }

  const chooseFont = (name: string, value: string) => {
    if (value === UPLOAD) {
      uploadTarget.current = name
      fileRef.current?.click()
      return
    }
    const pick: FontPick | null = value.startsWith('builtin:')
      ? { source: 'builtin', family: value.slice('builtin:'.length) }
      : value.startsWith('user:') ? { source: 'user', id: value.slice('user:'.length) } : null
    updateTemplateCustomStore((current) => setCustomFont(current, template, name, pick))
  }

  const upload = async (file: File | undefined) => {
    const target = uploadTarget.current
    uploadTarget.current = null
    if (!file) return
    try {
      const font = await addUserFont(file)
      toast.success(t('customize.fontAdded', { name: font.name }))
      if (target) updateTemplateCustomStore((current) => setCustomFont(current, template, target, { source: 'user', id: font.id }))
    } catch (error) {
      const code = error instanceof UserFontError ? error.code : 'unreadable'
      toast.error(t(`customize.fontError.${code}` as MsgKey))
    }
  }

  const remove = async (font: UserFont) => {
    try {
      await deleteUserFont(font.id)
      updateTemplateCustomStore((current) => dropUserFontPicks(current, font.id))
      toast.success(t('customize.fontDeleted', { name: font.name }))
    } catch {
      toast.error(t('customize.fontError.storage'))
    }
  }

  return (
    <div data-template-customizer={kind} className="space-y-4">
      {slots.colors.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="ya-eyebrow">{t('customize.colors')}</p>
            {changed && (
              <button type="button" data-customize-reset className="ya-link-btn inline-flex items-center gap-1 text-[11px]"
                disabled={busy}
                onClick={() => updateTemplateCustomStore((current) => resetTemplateCustom(current, template, variant))}>
                <RotateCcw size={11} aria-hidden="true" />{t('customize.reset')}
              </button>
            )}
          </div>
          <div className="ya-well grid grid-cols-4 gap-2 rounded-xl p-2" role="group" aria-label={t('customize.colors')}>
            {slots.colors.map((slot) => {
              const value = drafts[slot.var] ?? picked[slot.var] ?? defaults[slot.var] ?? ''
              const parsed = parseColor(value)
              const name = label(slot.name)
              return (
                <label key={slot.var} data-customize-color={slot.var}
                  data-customize-changed={picked[slot.var] ? 'true' : undefined}
                  className="flex min-w-0 cursor-pointer flex-col items-center gap-1 text-center"
                  title={t('customize.colorLabel', { name, value: parsed ? value : t('customize.followTheme') })}>
                  <span className="relative block h-7 w-7 overflow-hidden rounded-lg border border-line-2"
                    style={parsed ? { background: value } : {
                      background: 'repeating-linear-gradient(45deg, var(--surface-base, #fff) 0 4px, var(--line-2, #ddd) 4px 5px)',
                    }}>
                    <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" disabled={busy}
                      value={parsed?.hex ?? '#000000'} aria-label={name}
                      onChange={(event) => draftColor(slot.var, event.target.value)} />
                  </span>
                  <span className="w-full truncate text-[10px] leading-tight text-ink-2">{name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {slots.fonts.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="ya-eyebrow">{t('customize.fonts')}</p>
            {changed && !slots.colors.length && (
              <button type="button" data-customize-reset className="ya-link-btn inline-flex items-center gap-1 text-[11px]"
                disabled={busy}
                onClick={() => updateTemplateCustomStore((current) => resetTemplateCustom(current, template, variant))}>
                <RotateCcw size={11} aria-hidden="true" />{t('customize.reset')}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {slots.fonts.map((slot) => (
              <label key={slot.var} className="flex items-center gap-2 text-[12px] text-ink-2">
                <span className="w-14 shrink-0 truncate">{label(slot.name)}</span>
                <select data-customize-font={slot.var} data-font-menu
                  className="ya-input !h-8 min-w-0 flex-1 !px-2 !text-[12px]" disabled={busy}
                  style={pickStyle(custom.fonts[slot.var])}
                  value={pickValue(custom.fonts[slot.var])}
                  onPointerDown={loadMenuFonts} onFocus={loadMenuFonts}
                  onChange={(event) => chooseFont(slot.var, event.target.value)}>
                  <option value="">{t('customize.fontDefault')}</option>
                  <optgroup label={t('customize.fontIncluded')}>
                    {CHOOSABLE_FONTS.map((font) => (
                      <option key={font.family} value={`builtin:${font.family}`} style={catalogStyle(font)}>{font.name[lang]}</option>
                    ))}
                  </optgroup>
                  {userFonts.length > 0 && (
                    <optgroup label={t('customize.fontMine')}>
                      {userFonts.map((font) => (
                        <option key={font.id} value={`user:${font.id}`} style={{ fontFamily: `"${font.family}"` }}>{font.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value={UPLOAD}>{t('customize.fontUpload')}</option>
                </select>
              </label>
            ))}
          </div>
          <input ref={fileRef} type="file" className="hidden" data-customize-font-file
            accept={USER_FONT_EXTENSIONS.join(',')}
            onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} />
          {userFonts.length > 0 && (
            <div data-customize-my-fonts className="mt-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">{t('customize.myFonts')}</p>
              <ul className="flex flex-wrap gap-1">
                {userFonts.map((font) => (
                  <li key={font.id} className="ya-well inline-flex items-center gap-1 rounded-lg py-0.5 pl-2 pr-1 text-[11px] text-ink-2">
                    <span className="max-w-[9rem] truncate" style={{ fontFamily: `"${font.family}"` }}>{font.name}</span>
                    <button type="button" className="rounded p-0.5 text-ink-3 hover:text-error-700" disabled={busy}
                      aria-label={t('customize.deleteFont', { name: font.name })}
                      onClick={() => void remove(font)}>
                      <X size={11} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{t('customize.myFontsHint')}</p>
        </div>
      )}
    </div>
  )
}
