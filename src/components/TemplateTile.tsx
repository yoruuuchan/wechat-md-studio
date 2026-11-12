import type { ReactNode } from 'react'
import TemplateThumb from '@/components/TemplateThumb'

interface Props {
  kind: 'card' | 'long'
  /** Runtime template id the thumbnail draws. */
  template: string
  variant: string
  name: string
  selected: boolean
  disabled?: boolean
  title?: string
  /** data-* hooks the existing checks and handlers look for, on the button. */
  buttonData: Record<string, string>
  /** data-* hooks for the tile itself (e.g. the own group's item marker). */
  tileData?: Record<string, string | true | undefined>
  onClick: () => void
  /** Extra controls under the name, such as 删除 in management mode. */
  extra?: ReactNode
}

/** Grid layout shared by every template group in the side panel. */
export const TEMPLATE_GRID = 'ya-well grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5 rounded-xl p-1.5'

/**
 * One template in the picker: a drawn thumbnail with the name under it. The
 * button stretches over the whole tile, so a click anywhere selects, while its
 * text stays just the name.
 */
export default function TemplateTile({
  kind, template, variant, name, selected, disabled, title, buttonData, tileData, onClick, extra,
}: Props) {
  return (
    <div
      {...tileData}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface-base"
      style={{ boxShadow: selected ? '0 0 0 2px var(--primary-500)' : '0 0 0 1px var(--line-2, rgba(0,0,0,.08))' }}
    >
      <TemplateThumb kind={kind} template={template} variant={variant} />
      <button
        {...buttonData}
        aria-pressed={selected}
        disabled={disabled}
        title={title ?? name}
        className={`ya-tool xhs-option !w-full !justify-start !rounded-none truncate text-left after:absolute after:inset-0 after:content-[''] ${selected ? 'ya-selected' : ''}`}
        onClick={onClick}
      >
        {name}
      </button>
      {extra ? <div className="relative z-10 flex justify-end px-1 pb-1">{extra}</div> : null}
    </div>
  )
}
