import { t } from './i18n'

/**
 * The external diagram Skill this entry points at.
 *
 * Reed only hands the address over: the Skill, its references, fonts and export
 * scripts stay in `patrick-xin/diagram-design-zh`, so nothing here proxies,
 * embeds or re-hosts them. The address is the GitHub blob page rather than the
 * raw file because github.com stays reachable from the mainland networks this
 * tool is used on, and the page shows the licence and authorship next to the text.
 */
export const DIAGRAM_SKILL_URL =
  'https://github.com/patrick-xin/diagram-design-zh/blob/main/skills/diagram-design-zh/SKILL.md'

/** The upstream repository, kept visible so authorship and MIT terms travel with the link. */
export const DIAGRAM_REPO_URL = 'https://github.com/patrick-xin/diagram-design-zh'

/** The English original whose typography rules this Skill replaces. */
export const DIAGRAM_UPSTREAM_URL = 'https://github.com/cathrynlavery/diagram-design'

/** The upstream install command, for agents that read Agent Skills from disk. */
export const DIAGRAM_SKILL_INSTALL = `npx skills add ${DIAGRAM_REPO_URL} --skill diagram-design-zh`

/** The copy-prompt template, written in the current UI language. */
export function aiDiagramPrompt(): string {
  return t('diagramSkill.promptBody', { url: DIAGRAM_SKILL_URL })
}
