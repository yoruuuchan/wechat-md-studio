import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/hooks/useI18n'
import type { PreflightItem, PreflightLocation, PreflightReport } from '@/lib/preflight'

/** What the author was trying to do when the check opened. */
export type PublishAction = 'copy' | 'clean' | 'page'

interface Props {
  report: PreflightReport | null
  action: PublishAction
  onClose: () => void
  /** Run the action as-is. Only reachable once the panel allows it. */
  onConfirm: (options: { allowUnfinished: boolean }) => void
  /** Move the editor to whatever the item is about. */
  onJump: (location: PreflightLocation) => void
}

const SEVERITY_STYLE: Record<PreflightItem['severity'], string> = {
  blocker: 'bg-warn/12 text-warn-700',
  warning: 'bg-line-1 text-ink-2',
  note: 'bg-line-1 text-ink-3',
  unverifiable: 'bg-line-1 text-ink-3',
}

function severityLabel(severity: PreflightItem['severity']): 'preflight.blocker' | 'preflight.warning' | 'preflight.note' | 'preflight.unverifiable' {
  if (severity === 'blocker') return 'preflight.blocker'
  if (severity === 'warning') return 'preflight.warning'
  if (severity === 'note') return 'preflight.note'
  return 'preflight.unverifiable'
}

/**
 * The article's real publish state, shown where the author asks for the output.
 *
 * Everything the check knows is stated here rather than in a toast that slides
 * away: each finding names what it is about, most can be jumped to, and the
 * output button only runs once the author has seen all of it. Renderer warnings
 * arrive as finished sentences, so they are shown verbatim.
 */
export default function PublishPreflight({ report, action, onClose, onConfirm, onJump }: Props) {
  const { t } = useI18n()
  const [acknowledged, setAcknowledged] = useState(false)

  // A fresh check is a fresh decision: never carry a previous "I read it" over.
  useEffect(() => {
    if (report) setAcknowledged(false)
  }, [report])

  if (!report) return null

  const blocked = report.blockers.length > 0
  const needsAck = report.warnings.length > 0
  const canRun = !blocked && (!needsAck || acknowledged)

  const sections: { key: string; label: 'preflight.blockerSection' | 'preflight.warningSection' | 'preflight.noteSection' | 'preflight.unverifiableSection'; items: PreflightItem[] }[] = [
    { key: 'blocker', label: 'preflight.blockerSection', items: report.blockers },
    { key: 'warning', label: 'preflight.warningSection', items: report.warnings },
    { key: 'note', label: 'preflight.noteSection', items: report.notes },
    { key: 'unverifiable', label: 'preflight.unverifiableSection', items: report.unverifiable },
  ]

  const runLabel =
    action === 'copy'
      ? blocked
        ? t('preflight.overrideCopy')
        : t('preflight.goCopy')
      : blocked
        ? t('preflight.overrideExport')
        : action === 'clean'
          ? t('preflight.goClean')
          : t('preflight.goPage')

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent data-preflight className="max-h-[90vh] overflow-y-auto !bg-surface-base sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('preflight.title')}</DialogTitle>
          <DialogDescription className="text-ink-3">{t('preflight.intro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <section key={section.key} data-preflight-section={section.key} className="space-y-2">
                <h3 className="ya-eyebrow">
                  {t(section.label)} · {section.items.length}
                </h3>
                <ul className="space-y-2">
                  {section.items.map((item) => (
                    <li key={item.id} data-preflight-item={item.code} className="ya-well flex items-start gap-2 p-3 text-[12px] leading-relaxed">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLE[item.severity]}`}>
                        {t(severityLabel(item.severity))}
                      </span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold text-ink-1">{t(item.titleKey, item.titleParams)}</p>
                        <p className="text-ink-2">{item.text ?? t(item.detailKey, item.detailParams)}</p>
                        {item.location?.line !== undefined && (
                          <p className="text-ink-3">{t('preflight.atLine', { n: item.location.line + 1 })}</p>
                        )}
                      </div>
                      {item.location && (
                        <button
                          type="button"
                          data-preflight-jump={item.code}
                          onClick={() => onJump(item.location!)}
                          className="ya-btn ya-btn-secondary ya-btn-sm shrink-0"
                        >
                          {t('preflight.jump')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>

        {/* The acknowledgement is the "I chose this" record for warnings; a
            blocker has no such thing, only an explicit override below. */}
        {needsAck && (
          <label className="flex items-start gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              data-preflight-ack
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t('preflight.ack')}</span>
          </label>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="ya-btn ya-btn-secondary" data-preflight-cancel>
            {t('preflight.cancel')}
          </button>
          <button
            type="button"
            data-preflight-go
            data-preflight-state={blocked ? 'override' : canRun ? 'ready' : 'needs-ack'}
            disabled={!blocked && !canRun}
            onClick={() => onConfirm({ allowUnfinished: blocked })}
            className={`ya-btn ${blocked ? 'ya-btn-secondary' : 'ya-btn-primary'}`}
          >
            {runLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}