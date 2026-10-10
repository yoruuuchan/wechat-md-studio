import { WRITING_SKILL_URL } from '@contracts/remote-mcp'
import { t } from './i18n'

/** The copy-prompt template, written in the current UI language. */
export function aiWritingPrompt(): string {
  return t('ai.promptBody', { url: WRITING_SKILL_URL })
}
