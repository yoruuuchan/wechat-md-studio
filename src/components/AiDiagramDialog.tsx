import {
  DIAGRAM_EXAMPLES,
  DIAGRAM_GALLERY_URL,
  DIAGRAM_REPO_URL,
  DIAGRAM_SKILL_URL,
  DIAGRAM_UPSTREAM_URL,
  aiDiagramPrompt,
} from '@/lib/ai-diagram'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/hooks/useI18n'
// copyAiText is the shared clipboard helper of the AI entries (also used by RemoteMcpDialog).
import { copyAiText } from './AiWritingDialog'

const smallLinkClass = 'mx-0.5 text-brand underline decoration-brand/40 underline-offset-2'

/**
 * Entry for the external diagram-design-zh Skill.
 *
 * Three finished examples carry the explanation, so the copy stays down to one
 * sentence, one prompt box and a credit line: what the Skill makes is easier to
 * show than to describe. Same single-well shape as 「AI 帮我写」 — the prompt is
 * the only action. Nothing here calls a model, draws a chart or hosts the Skill.
 */
export default function AiDiagramDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const prompt = aiDiagramPrompt()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !bg-surface-base sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('diagramSkill.title')}</DialogTitle>
          <DialogDescription className="text-ink-3">{t('diagramSkill.desc')}</DialogDescription>
        </DialogHeader>

        {/* What you get, before any reading. White tiles because the Skill always draws on white. */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {DIAGRAM_EXAMPLES.map((example) => (
              <a
                key={example.src}
                data-diagram-example={example.src}
                href={`${DIAGRAM_GALLERY_URL}${example.anchor}`}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-lg border border-line-2 bg-white transition-colors hover:border-brand/40"
              >
                <img src={example.src} alt={t(example.labelKey)} loading="lazy" className="h-[92px] w-full object-contain" />
                <span className="block border-t border-line-2 px-2 py-1 text-[10px] text-ink-3">{t(example.labelKey)}</span>
              </a>
            ))}
          </div>
          <a data-diagram-gallery href={DIAGRAM_GALLERY_URL} target="_blank" rel="noreferrer" className="text-[11px] text-brand underline underline-offset-2">
            {t('diagramSkill.examplesLink')}
          </a>
        </div>

        <div className="ya-well space-y-3 p-4">
          <textarea aria-label={t('diagramSkill.promptAria')} readOnly value={prompt} className="ya-input !h-36 w-full resize-y !py-3 !text-[12px]" />
          <button data-ai-copy="diagram-prompt" onClick={() => void copyAiText(prompt, t('ai.label.prompt'))} className="ya-btn ya-btn-primary">{t('ai.copyPrompt')}</button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <a data-diagram-skill-link href={DIAGRAM_SKILL_URL} target="_blank" rel="noreferrer" className="text-[12px] text-brand underline underline-offset-2">{t('diagramSkill.skillLink')}</a>
          <button data-ai-copy="diagram-url" onClick={() => void copyAiText(DIAGRAM_SKILL_URL, t('ai.label.url'))} className="ya-btn ya-btn-secondary ya-btn-sm">{t('ai.copyUrl')}</button>
        </div>

        <p data-diagram-credit className="text-[11px] leading-relaxed text-ink-3">
          {t('diagramSkill.sourcePrefix')}
          <a data-diagram-repo-link href={DIAGRAM_REPO_URL} target="_blank" rel="noreferrer" className={smallLinkClass}>{t('diagramSkill.source')}</a>
          {t('diagramSkill.sourceMiddle')}
          <a data-diagram-upstream-link href={DIAGRAM_UPSTREAM_URL} target="_blank" rel="noreferrer" className={smallLinkClass}>{t('diagramSkill.sourceUpstream')}</a>
          {t('diagramSkill.sourceTail')}
        </p>
      </DialogContent>
    </Dialog>
  )
}