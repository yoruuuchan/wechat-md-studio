import type { CardOptions, CardRatio } from '@/lib/cards'
import {
  CARD_RATIOS,
  CARD_TEMPLATES,
  cardTemplateCustomize,
  isBuiltinCardTemplate,
  isDarkVariant,
  templateRatios,
  templateVariants,
  withTemplate,
} from '@/lib/cards'
import type { CardTemplateUpload } from '@/hooks/useCardTemplates'
import type { CardTemplateSummary } from '@/lib/card-template-format'
import type { MsgKey } from '@/lib/i18n'
import { useI18n } from '@/hooks/useI18n'
import MyTemplatesGroup from '@/components/MyTemplatesGroup'
import TemplateTile, { TEMPLATE_GRID } from '@/components/TemplateTile'
import TemplateCustomizer from '@/components/TemplateCustomizer'
import { getLoadedCardTemplate } from '@/lib/card-template'
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
  const loaded = getLoadedCardTemplate(template)
  const builtin = isBuiltinCardTemplate(template)
  const groupLabel = 'mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3'
  // Thumbnails show the current variant for the selected template, else its first.
  const variantFor = (id: string) => id === template ? bg : (templateVariants(id)[0] ?? bg)

  return (
    <div data-card-settings className="space-y-4">
      <div>
        <p className="ya-eyebrow mb-2">{t('cards.template')}</p>
        {/* Uploaded templates and the shared ones sit in two labelled groups,
            the user's own first, so the two kinds never interleave. Upload,
            delete, sync state and errors belong to the own group itself. */}
        <MyTemplatesGroup
          state={templates}
          selected={template}
          busy={busy}
          onSelect={(id) => onOptionsChange(withTemplate(options, id))}
          onUploaded={onTemplateUploaded}
          onDeleted={onTemplateDeleted}
          variantFor={variantFor}
        />
        <div data-card-template-group="public">
          <p className={groupLabel}>{t('cards.templatePublic')}</p>
          <div className={TEMPLATE_GRID} role="group"
            aria-label={`${t('cards.template')} · ${t('cards.templatePublic')}`}>
            {CARD_TEMPLATES.map((id) => (
              <TemplateTile key={id} kind="card" template={id} variant={variantFor(id)}
                name={t(`cards.template.${id}` as MsgKey)} selected={template === id} disabled={busy}
                buttonData={{ 'data-card-template': id }}
                onClick={() => onOptionsChange(withTemplate(options, id))} />
            ))}
            {PUBLIC_CARD_TEMPLATES.map((item) => {
              const runtime = publicCardTemplateRuntimeId(item.id)
              const ready = loadedPublic.has(runtime)
              return (
                <TemplateTile key={runtime} kind="card" template={runtime} variant={variantFor(runtime)}
                  name={item.name} selected={template === runtime} disabled={busy || !ready}
                  title={ready ? item.reference : t('cards.publicTemplatesLoading')}
                  buttonData={{ 'data-card-template': runtime, 'data-card-template-public': item.id }}
                  onClick={() => onOptionsChange(withTemplate(options, runtime))} />
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

      {(loaded || builtin) && (
        <TemplateCustomizer
          kind="card"
          template={template}
          renderId={loaded?.renderId ?? template}
          templateSource={loaded?.template}
          variant={bg}
          dark={isDarkVariant(template, bg)}
          slots={cardTemplateCustomize(template)}
          translateNames={builtin}
          busy={busy}
        />
      )}

      <p className="text-[11px] leading-relaxed text-ink-3">{t('cards.hint')}</p>
    </div>
  )
}