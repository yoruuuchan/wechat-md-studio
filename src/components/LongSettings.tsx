import type { LongOptions } from '@/lib/long-options'
import { longTemplateVariants } from '@/lib/cards'
import { LONG_EXPORT_WIDTHS, LONG_FORMATS } from '@/lib/long-image'
import type { CardTemplateUpload } from '@/hooks/useCardTemplates'
import type { CardTemplateSummary } from '@/lib/card-template-format'
import { useI18n } from '@/hooks/useI18n'
import MyTemplatesGroup from '@/components/MyTemplatesGroup'
import { PUBLIC_LONG_TEMPLATES, publicLongTemplateFor, publicLongTemplateRuntimeId } from '@/lib/public-card-templates'

interface Props {
  options: LongOptions
  onOptionsChange: (options: LongOptions) => void
  /** Export in progress: changing the template would abort the render. */
  busy: boolean
  templates: CardTemplateUpload
  onTemplateUploaded: (summary: CardTemplateSummary) => void
  onTemplateDeleted: (template: string) => void
}

/** Long-image template / variant / width / format controls. */
export default function LongSettings({
  options, onOptionsChange, busy, templates, onTemplateUploaded, onTemplateDeleted,
}: Props) {
  const { t } = useI18n()
  const variants = longTemplateVariants(options.template)
  const custom = templates.templates.find((item) => item.template === options.template)
  const publicMeta = publicLongTemplateFor(options.template)
  const variantName = (id: string) => custom?.variants.find((variant) => variant.id === id)?.name ??
    publicMeta?.variants.find((variant) => variant.id === id)?.name ?? id
  const loadedPublic = new Set(templates.publicTemplates.map((item) => item.template))
  const groupLabel = 'mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3'

  return (
    <div data-long-settings className="space-y-4">
      <div>
        <p className="ya-eyebrow mb-2">{t('long.template')}</p>
        <MyTemplatesGroup
          state={templates}
          selected={options.template}
          busy={busy}
          onSelect={(id) => onOptionsChange({ ...options, template: id, variant: longTemplateVariants(id)[0] ?? options.variant })}
          onUploaded={onTemplateUploaded}
          onDeleted={onTemplateDeleted}
        />
        <div data-long-template-group="public">
          <p className={groupLabel}>{t('cards.templatePublic')}</p>
          <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group"
            aria-label={`${t('long.template')} · ${t('cards.templatePublic')}`}>
            {PUBLIC_LONG_TEMPLATES.map((item) => {
              const runtime = publicLongTemplateRuntimeId(item.id)
              const ready = loadedPublic.has(runtime)
              return (
                <button key={runtime} data-long-template={runtime} data-long-template-public={item.id}
                  aria-pressed={options.template === runtime} disabled={busy || !ready}
                  title={ready ? item.reference : t('cards.publicTemplatesLoading')}
                  className={`ya-tool xhs-option ${options.template === runtime ? 'ya-selected' : ''}`}
                  onClick={() => onOptionsChange({
                    ...options,
                    template: runtime,
                    variant: longTemplateVariants(runtime)[0] ?? options.variant,
                  })}>
                  {item.name}
                </button>
              )
            })}
          </div>
        </div>
        {templates.publicLoading ? (
          <p data-long-public-loading className="mt-2 text-[11px] text-ink-3" role="status">
            {t('cards.publicTemplatesLoading')}
          </p>
        ) : null}
        {templates.publicError ? (
          <p data-long-public-error className="mt-2 text-[11px] text-error-700" role="status">
            {t('cards.publicTemplatesFailed')}
          </p>
        ) : null}
      </div>

      <div>
        <p className="ya-eyebrow mb-2">{t('long.variant')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('long.variant')}>
          {variants.map((id) => (
            <button key={id} data-long-variant={id} aria-pressed={options.variant === id} disabled={busy}
              className={`ya-tool xhs-option ${options.variant === id ? 'ya-selected' : ''}`}
              onClick={() => onOptionsChange({ ...options, variant: id })}>{variantName(id)}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="ya-eyebrow mb-2">{t('long.width')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('long.width')}>
          {LONG_EXPORT_WIDTHS.map((width) => (
            <button key={width} data-long-width={width} aria-pressed={options.width === width} disabled={busy}
              className={`ya-tool xhs-option ${options.width === width ? 'ya-selected' : ''}`}
              onClick={() => onOptionsChange({ ...options, width })}>{width}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="ya-eyebrow mb-2">{t('long.format')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('long.format')}>
          {LONG_FORMATS.map((format) => (
            <button key={format} data-long-format={format} aria-pressed={options.format === format} disabled={busy}
              className={`ya-tool xhs-option ${options.format === format ? 'ya-selected' : ''}`}
              onClick={() => onOptionsChange({ ...options, format })}>{format.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{t('long.templateHint')}</p>
    </div>
  )
}
