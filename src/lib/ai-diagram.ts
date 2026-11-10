import { t, type MsgKey } from './i18n'

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

/** The upstream gallery; every example tile links into its own section of it. */
export const DIAGRAM_GALLERY_URL = 'https://patrick-xin.github.io/diagram-design-zh/'

/**
 * Three finished charts shipped with the app, so the dialog can show what the
 * Skill produces before the reader commits to copying anything. They are
 * checked-in copies of the upstream `screenshots/` (see LICENSES/NOTICE.md):
 * local files rather than hotlinks, because the upstream image host is not
 * reachable from where this tool is used and a preview must not depend on it.
 */
export const DIAGRAM_EXAMPLES: { src: string; anchor: string; labelKey: MsgKey }[] = [
  { src: '/diagram-examples/architecture.png', anchor: '#architecture', labelKey: 'diagramSkill.exampleArchitecture' },
  { src: '/diagram-examples/flowchart.png', anchor: '#flowchart', labelKey: 'diagramSkill.exampleFlowchart' },
  { src: '/diagram-examples/bar.png', anchor: '#bar', labelKey: 'diagramSkill.exampleBar' },
]

/** The copy-prompt template, written in the current UI language. */
export function aiDiagramPrompt(): string {
  return t('diagramSkill.promptBody', { url: DIAGRAM_SKILL_URL })
}