import type { CardOptions, CardRatio, CardTemplate } from '@/lib/cards'
import {
  CARD_RATIOS,
  CARD_TEMPLATES,
  templateRatios,
  templateVariants,
  withTemplate,
} from '@/lib/cards'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  options: CardOptions
  onOptionsChange: (options: CardOptions) => void
  /** Export in progress: option changes would abort the batch mid-way. */
  busy: boolean
}

/**
 * Card template, ratio and background controls, moved out of the preview's
 * top strip and into the side panel's 模板 tab. The markup and data attributes
 * are the ones the preview used to render, so existing checks keep their hooks.
 */
export default function CardSettings({ options, onOptionsChange, busy }: Props) {
  const { t } = useI18n()
  const { ratio, template, background: bg } = options
  const variants = templateVariants(template)
  const ratios = templateRatios(template)

  return (
    <div data-card-settings className="space-y-4">
      <div>
        <p className="ya-eyebrow mb-2">{t('cards.template')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.template')}>
          {CARD_TEMPLATES.map((id: CardTemplate) => (
            <button key={id} data-card-template={id} aria-pressed={template === id} disabled={busy}
              className={`ya-tool xhs-option ${template === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange(withTemplate(options, id))}>{t(`cards.template.${id}`)}</button>
          ))}
        </div>
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
        {template === 'kihon' && <p data-card-ratio-hint className="mt-2 text-[11px] text-ink-2">{t('cards.kihonRatio')}</p>}
      </div>

      <div>
        <p className="ya-eyebrow mb-2">{t('cards.background')}</p>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.background')}>
          {variants.map((id) => (
            <button key={id} data-card-bg={id} aria-pressed={bg === id} disabled={busy}
              className={`ya-tool xhs-option ${bg === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange({ ...options, background: id })}>{t(`cards.bg.${id}`)}</button>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{t('cards.hint')}</p>
    </div>
  )
}