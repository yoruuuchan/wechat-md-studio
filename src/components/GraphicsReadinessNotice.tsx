import type { GraphicsReadiness } from '@/lib/graphics-readiness'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  /** Which preview owns the warning; the data attribute keeps acceptance scripts apart. */
  kind: 'cards' | 'long'
  graphics: GraphicsReadiness
  /** Retry paths the editor already owns; the hint points at those, not a new mechanism. */
  onRetryMath?: () => void
  onRetryDiagrams?: () => void
}

const shortTex = (tex: string) => (tex.length > 40 ? `${tex.slice(0, 40)}…` : tex)

/**
 * Says why a card or long-image download is disabled while formulas or Mermaid
 * diagrams are unfinished, and offers the retry the editor already owns.
 *
 * The gate itself lives in `graphicsReadiness`; this component only states the
 * reason so "still rendering", "broken TeX" and "diagram failed" never collapse
 * into one endless loading hint.
 */
export default function GraphicsReadinessNotice({ kind, graphics, onRetryMath, onRetryDiagrams }: Props) {
  const { t } = useI18n()
  const { math, diagrams, ready } = graphics
  if (ready) return null
  const blocked = math.state === 'failed' || diagrams.state === 'failed'
  const retryMath = math.engineUnavailable
  const diagramReason = diagrams.failed[0]?.detail || t('preflight.diagramFailed.detail')
  return (
    <div
      role={blocked ? 'alert' : 'status'}
      data-graphics-warning={kind}
      data-graphics-state={blocked ? 'failed' : 'pending'}
      className={`mb-4 rounded-xl bg-surface-base p-3 text-xs ${blocked ? 'text-error-700' : 'text-warning-700'}`}
    >
      {retryMath ? <p data-graphics-math="engine">{t('graphics.mathEngineFailed')}</p> : null}
      {!retryMath && math.failed.length ? (
        <p data-graphics-math="failed">{t('graphics.mathFailed', { tex: shortTex(math.failed[0]) })}</p>
      ) : null}
      {!retryMath && !math.failed.length && math.pending ? (
        <p data-graphics-math="pending">{t('graphics.mathPending', { n: math.pending })}</p>
      ) : null}
      {diagrams.failed.length ? (
        <p data-graphics-diagram="failed">
          {t('graphics.diagramFailed', { n: diagrams.failed.length, reason: diagramReason })}
        </p>
      ) : null}
      {!diagrams.failed.length && diagrams.pending ? (
        <p data-graphics-diagram="pending">{t('graphics.diagramPending', { n: diagrams.pending })}</p>
      ) : null}
      {blocked ? (
        <button
          className="ya-link-btn mt-1"
          onClick={() => {
            if (retryMath) onRetryMath?.()
            if (diagrams.failed.length) onRetryDiagrams?.()
          }}
        >
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}
