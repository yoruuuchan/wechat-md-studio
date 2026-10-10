import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { WRITING_SKILL_URL } from '@contracts/remote-mcp'
import { AI_WRITING_PROMPT } from '@/lib/ai-writing'
import { copyPlain } from '@/lib/clipboard'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export async function copyAiText(text: string, label: string): Promise<void> {
  if (await copyPlain(text)) toast.success(`${label}已复制`)
  else toast.error('复制失败，请选中文字手动复制')
}

export default function AiWritingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [skill, setSkill] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  useEffect(() => {
    if (!open || skill !== null) return
    const controller = new AbortController()
    void fetch('/skill.md', { signal: controller.signal }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('text/markdown')) throw new Error('写作规则暂时没读下来，请稍后重新打开')
      setSkill(await response.text())
      setError(null)
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '写作规则读取失败') })
    return () => controller.abort()
  }, [open, skill])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !bg-surface-base sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AI 帮我写</DialogTitle>
          <DialogDescription className="text-ink-3">把规则、主题和资料交给你常用的 AI，写完后粘回左侧编辑器。</DialogDescription>
        </DialogHeader>
        <div className="ya-well space-y-3 p-4 text-[13px] leading-relaxed">
          <p>复制提示词，补上自己的主题和资料，再发给 AI。</p>
          <textarea aria-label="写作提示词" readOnly value={AI_WRITING_PROMPT} className="ya-input !h-48 w-full resize-y !py-3 !text-[12px]" />
          <button data-ai-copy="prompt" onClick={() => void copyAiText(AI_WRITING_PROMPT, '提示词')} className="ya-btn ya-btn-primary">复制提示词</button>
        </div>
        <div className="space-y-3 text-[12px] text-ink-3">
          <p>AI 能打开链接时，发 Skill 地址就够了；读不了链接时，粘贴完整 Skill。</p>
          <a href={WRITING_SKILL_URL} target="_blank" rel="noreferrer" className="break-all text-brand underline underline-offset-2">{WRITING_SKILL_URL}</a>
          <div className="flex flex-wrap gap-2">
            <button data-ai-copy="url" onClick={() => void copyAiText(WRITING_SKILL_URL, 'Skill 地址')} className="ya-btn ya-btn-secondary">复制 Skill 地址</button>
            <button data-ai-copy="skill" disabled={skill === null || copying} onClick={async () => {
              if (skill === null) return
              setCopying(true)
              try { await copyAiText(skill, '完整 Skill') } finally { setCopying(false) }
            }} className="ya-btn ya-btn-secondary">{copying ? '复制中…' : '复制完整 Skill'}</button>
          </div>
          {error && <p role="alert" className="text-warn-700">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
