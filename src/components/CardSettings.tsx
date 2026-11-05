import type { CardOptions, CardRatio } from '@/lib/cards'
import {
  CARD_RATIOS,
  CARD_TEMPLATES,
  isBuiltinCardTemplate,
  templateRatios,
  templateVariants,
  withTemplate,
} from '@/lib/cards'
import type { CardTemplateUpload } from '@/hooks/useCardTemplates'
import type { CardTemplateSummary } from '@/lib/card-template-format'
import type { MsgKey } from '@/lib/i18n'
import { useI18n } from '@/hooks/useI18n'
import CardTemplatesSection from '@/components/CardTemplatesSection'
import { PUBLIC_CARD_TEMPLATES, publicCardTemplateFor, publicCardTemplateRuntimeId } from '@/lib/public-card-templates'

interface Props {
  options: CardOptions
  onOptionsChange: (options: CardOptions) => void
  /** Export in progress: option changes would abort the batch mid-way. */
  busy: boolean
  templates: CardTemplateUpload
  onTemplateUploaded: (summary: CardTemplateSummary) => void
  onTemplateDeleted: (template: string) => void
}

/**
 * Card template, ratio and background controls, moved out of the preview's
 * top strip and into the side panel's 模板 tab. The markup and data attributes
 * are the ones the preview used to render, so existing checks keep their hooks.
 */
export default function CardSettings({ options, onOptionsChange, busy, templates, onTemplateUploaded, onTemplateDeleted }: Props) {
  const { t } = useI18n()
  const { ratio, template, background: bg } = options
  const variants = templateVariants(template)
  const ratios = templateRatios(template)
  const custom = templates.templates.find((item) => item.template === template)
  const publicTemplate = templates.publicTemplates.find((item) => item.template === template)
  const publicMeta = publicCardTemplateFor(template)
  const variantName = (id: string) => publicTemplate?.variants.find((variant) => variant.id === id)?.name ??
    custom?.variants.find((variant) => variant.id === id)?.name ??
    (isBuiltinCardTemplate(template) ? t(`cards.bg.${id}` as MsgKey) : id)
  const templateName = publicTemplate?.name ?? publicMeta?.name ??
    custom?.name ?? (isBuiltinCardTemplate(template) ? t(`cards.template.${template}` as MsgKey) : template)
  const loadedPublic = new Set(templates.publicTemplates.map((item) => item.template))
  const groupLabel = 'mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3'

  return (
    <div data-card-settings className="space-y-4">
      <div>
        <p className="ya-eyebrow mb-2">{t('cards.template')}</p>
        {/* Uploaded templates and the shared ones sit in two labelled groups,
            the user's own first, so the two kinds never interleave. */}
        {templates.templates.length > 0 ? (
          <div data-card-template-group="mine" className="mb-3">
            <p className={groupLabel}>{t('cards.templateMine')}</p>
            <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group"
              aria-label={`${t('cards.template')} · ${t('cards.templateMine')}`}>
              {templates.templates.map((item) => (
                <button key={item.template} data-card-template={item.template} data-card-template-custom="true"
                  aria-pressed={template === item.template} disabled={busy}
                  className={`ya-tool xhs-option ${template === item.template ? 'ya-selected' : ''}`}
                  onClick={() => onOptionsChange(withTemplate(options, item.template))}>
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div data-card-template-group="public">
          <p className={groupLabel}>{t('cards.templatePublic')}</p>
          <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group"
            aria-label={`${t('cards.template')} · ${t('cards.templatePublic')}`}>
            {CARD_TEMPLATES.map((id) => (
              <button key={id} data-card-template={id} aria-pressed={template === id} disabled={busy}
                className={`ya-tool xhs-option ${template === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange(withTemplate(options, id))}>{t(`cards.template.${id}` as MsgKey)}</button>
            ))}
            {PUBLIC_CARD_TEMPLATES.map((item) => {
              const runtime = publicCardTemplateRuntimeId(item.id)
              const ready = loadedPublic.has(runtime)
              return (
                <button key={runtime} data-card-template={runtime} data-card-template-public={item.id}
                  aria-pressed={template === runtime} disabled={busy || !ready}
                  title={ready ? item.reference : t('cards.publicTemplatesLoading')}
                  className={`ya-tool xhs-option ${template === runtime ? 'ya-selected' : ''}`}
                  onClick={() => onOptionsChange(withTemplate(options, runtime))}>
                  {item.name}
                </button>
              )
            })}
          </div>
        </div>
        {templates.publicLoading ? (
          <p data-public-card-loading className="mt-2 text-[11px] text-ink-3" role="status">
            {t('cards.publicTemplatesLoading')}
          </p>
        ) : null}
        {templates.publicError ? (
          <p data-public-card-error className="mt-2 text-[11px] text-error-700" role="status">
            {t('cards.publicTemplatesFailed')}
          </p>
        ) : null}
      </div>

      <CardTemplatesSection state={templates} selected={template} onUploaded={onTemplateUploaded} onDeleted={onTemplateDeleted} />

      <div>
        <p className="ya-eyebrow mb-2">{t('cards.ratio')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.ratio')}>
          {(Object.keys(CARD_RATIOS) as CardRatio[]).map((id) => (
            <button key={id} data-card-ratio={id} aria-pressed={ratio === id} disabled={busy || !ratios.includes(id)}
              aria-disabled={!ratios.includes(id)}
              className={`ya-tool xhs-option ${ratio === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange({ ...options, ratio: id })}>{id}</button>
          ))}
        </div>
        {ratios.length < 3 && (
          <p data-card-ratio-hint className="mt-2 text-[11px] text-ink-2">
            {t('cards.templateRatioHint', { name: templateName, ratios: ratios.join(' / ') })}
          </p>
        )}
      </div>

      <div>
        <p className="ya-eyebrow mb-2">{t('cards.background')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.background')}>
          {variants.map((id) => (
            <button key={id} data-card-bg={id} aria-pressed={bg === id} disabled={busy}
              className={`ya-tool xhs-option ${bg === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange({ ...options, background: id })}>{variantName(id)}</button>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{t('cards.hint')}</p>
    </div>
  )
}