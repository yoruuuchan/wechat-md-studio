import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { WRITING_SKILL_URL } from '@contracts/remote-mcp'
import { aiWritingPrompt } from '@/lib/ai-writing'
import { copyPlain } from '@/lib/clipboard'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/hooks/useI18n'
import { t as translate } from '@/lib/i18n'

export async function copyAiText(text: string, label: string): Promise<void> {
  // `label` is the already-translated name of the thing being copied.
  if (await copyPlain(text)) toast.success(translate('ai.copyDone', { label }))
  else toast.error(translate('ai.copyFailed'))
}

export default function AiWritingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const prompt = aiWritingPrompt()
  const [skill, setSkill] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  useEffect(() => {
    if (!open || skill !== null) return
    const controller = new AbortController()
    void fetch('/skill.md', { signal: controller.signal }).then(async (response) => {
      if (!response.ok || !/^text\/(plain|markdown)\b/.test(response.headers.get('content-type') || '')) throw new Error(t('ai.skillLoadFailed'))
      setSkill(await response.text())
      setError(null)
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('ai.skillReadFailed')) })
    return () => controller.abort()
    // `t` intentionally omitted: the fetch should not restart on a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skill])

  const copyWithToast = (text: string, label: string) => {
    void copyAiText(text, label)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !bg-surface-base sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('ai.title')}</DialogTitle>
          <DialogDescription className="text-ink-3">{t('ai.desc')}</DialogDescription>
        </DialogHeader>
        <div className="ya-well space-y-3 p-4 text-[13px] leading-relaxed">
          <p>{t('ai.promptNote')}</p>
          <textarea aria-label={t('ai.promptAria')} readOnly value={prompt} className="ya-input !h-48 w-full resize-y !py-3 !text-[12px]" />
          <button data-ai-copy="prompt" onClick={() => copyWithToast(prompt, t('ai.label.prompt'))} className="ya-btn ya-btn-primary">{t('ai.copyPrompt')}</button>
        </div>
        <div className="space-y-3 text-[12px] text-ink-3">
          <p>{t('ai.skillNote')}</p>
          <p>{t('ai.skillLangNote')}</p>
          <a href={WRITING_SKILL_URL} target="_blank" rel="noreferrer" className="break-all text-brand underline underline-offset-2">{WRITING_SKILL_URL}</a>
          <div className="flex flex-wrap gap-2">
            <button data-ai-copy="url" onClick={() => copyWithToast(WRITING_SKILL_URL, t('ai.label.url'))} className="ya-btn ya-btn-secondary">{t('ai.copyUrl')}</button>
            <button data-ai-copy="skill" disabled={skill === null || copying} onClick={async () => {
              if (skill === null) return
              setCopying(true)
              try { copyWithToast(skill, t('ai.label.skill')) } finally { setCopying(false) }
            }} className="ya-btn ya-btn-secondary">{copying ? t('ai.copying') : t('ai.copySkill')}</button>
          </div>
          {error && <p role="alert" className="text-warn-700">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
