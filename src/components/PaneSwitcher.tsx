import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/hooks/useI18n'
import type { MsgKey } from '@/lib/i18n'

export type EditorPaneId = 'editor' | 'preview' | 'side'

const PANES: { id: EditorPaneId; label: MsgKey }[] = [
  { id: 'editor', label: 'editor.pane.editor' },
  { id: 'preview', label: 'editor.pane.preview' },
  { id: 'side', label: 'editor.pane.side' },
]

interface Props {
  pane: EditorPaneId
  onPaneChange: (pane: EditorPaneId) => void
  children: ReactNode
}

/**
 * Narrow-screen shell: one pane at a time, chosen from this row.
 *
 * The panes are not unmounted and not `display:none`d — they are stacked and
 * made invisible. Display:none would give the element no layout box, and a
 * scroll container without a box drops its scroll position, so the editor would
 * silently jump back to the top every time someone looked at the preview.
 * Radix supplies the tab semantics (roving tab index, arrow keys), which is
 * what keeps the row reachable without a pointer.
 */
export default function PaneSwitcher({ pane, onPaneChange, children }: Props) {
  const { t } = useI18n()
  return (
    <Tabs
      value={pane}
      onValueChange={(value) => onPaneChange(value as EditorPaneId)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList
        data-pane-switcher
        aria-label={t('editor.pane.group')}
        className="mx-2 mt-2 h-10 w-[calc(100%-1rem)] shrink-0 gap-1 rounded-xl bg-surface-sunken"
        style={{ boxShadow: 'var(--shadow-inset)' }}
      >
        {PANES.map(({ id, label }) => (
          <TabsTrigger
            key={id}
            id={`pane-tab-${id}`}
            aria-controls={`pane-${id}`}
            data-pane-tab={id}
            value={id}
            className="h-8 flex-1 rounded-lg text-[13px]"
          >
            {t(label)}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}