import {
  DIAGRAM_REPO_URL,
  DIAGRAM_SKILL_INSTALL,
  DIAGRAM_SKILL_URL,
  DIAGRAM_UPSTREAM_URL,
  aiDiagramPrompt,
} from '@/lib/ai-diagram'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/hooks/useI18n'
// copyAiText is the shared clipboard helper of the AI entries (also used by RemoteMcpDialog).
import { copyAiText } from './AiWritingDialog'

const linkClass = 'break-all text-brand underline underline-offset-2'

/**
 * Entry for the external diagram-design-zh Skill: same shape as 「AI 帮我写」,
 * because the workflow is the same — hand a prompt plus a Skill address to the
 * AI you already use, then bring the result back. Nothing here calls a model,
 * draws a chart or hosts the Skill.
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
        <div className="ya-well space-y-3 p-4 text-[13px] leading-relaxed">
          <p>{t('diagramSkill.promptNote')}</p>
          <textarea aria-label={t('diagramSkill.promptAria')} readOnly value={prompt} className="ya-input !h-48 w-full resize-y !py-3 !text-[12px]" />
          <button data-ai-copy="diagram-prompt" onClick={() => void copyAiText(prompt, t('ai.label.prompt'))} className="ya-btn ya-btn-primary">{t('ai.copyPrompt')}</button>
        </div>
        <div className="space-y-3 text-[12px] text-ink-3">
          <p>{t('diagramSkill.skillNote')}</p>
          <p>{t('diagramSkill.langNote')}</p>
          <a data-diagram-skill-link href={DIAGRAM_SKILL_URL} target="_blank" rel="noreferrer" className={linkClass}>{DIAGRAM_SKILL_URL}</a>
          <button data-ai-copy="diagram-url" onClick={() => void copyAiText(DIAGRAM_SKILL_URL, t('ai.label.url'))} className="ya-btn ya-btn-secondary">{t('ai.copyUrl')}</button>
          <p>{t('diagramSkill.installNote')}</p>
          <code className="block break-all select-all rounded bg-surface-sunken px-2 py-1.5 text-[11px] text-ink-2" style={{ fontFamily: 'var(--font-mono)' }}>{DIAGRAM_SKILL_INSTALL}</code>
        </div>
        <div className="ya-well space-y-2 p-4 text-[12px] leading-relaxed text-ink-2">
          <p>{t('diagramSkill.uploadNote')}</p>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          {t('diagramSkill.sourcePrefix')}
          <a data-diagram-repo-link href={DIAGRAM_REPO_URL} target="_blank" rel="noreferrer" className="mx-0.5 text-brand underline decoration-brand/40 underline-offset-2">
            {t('diagramSkill.source')}
          </a>
          {t('diagramSkill.sourceMiddle')}
          <a data-diagram-upstream-link href={DIAGRAM_UPSTREAM_URL} target="_blank" rel="noreferrer" className="mx-0.5 text-brand underline decoration-brand/40 underline-offset-2">
            {t('diagramSkill.sourceUpstream')}
          </a>
          {t('diagramSkill.sourceTail')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
