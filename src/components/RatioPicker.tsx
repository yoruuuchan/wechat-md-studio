import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MaxImageBytes } from '@contracts/constants'
import { carouselFrame } from '@/lib/theme-kit'
import { UPLOAD_SIZE_CHOICES, type UploadSizeChoice } from '@/lib/image-compress'
import { formatBytes } from '@/lib/image'
import { CAROUSEL_RATIOS, type CarouselRatio } from '@/lib/types'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  open: boolean
  /** Which slot is being filled, shown so the user knows what they are cropping. */
  label: string
  alt: string
  /** Ratio already written into the block's opener — locks the choice when set. */
  current?: CarouselRatio
  /**
   * Every image in a multi-image block (carousel or gallery) must share one
   * frame, so the choice is mandatory there. A standalone image may keep its own
   * proportions, so offer that too.
   */
  mode: 'carousel' | 'loose'
  /** The opener line to edit when the ratio needs changing; named in the copy. */
  fence?: string
  /** Remembered upload-size choice; the picker starts from it on every open. */
  size: UploadSizeChoice
  /**
   * Loose uploads: the largest of the picked files that exceed the server's
   * per-image cap, when any does. The original tier would be rejected, so
   * picking it is warned about and the confirm stays disabled.
   */
  oversize?: { maxBytes: number } | null
  busy: boolean
  onCancel: () => void
  onConfirm: (ratio: CarouselRatio | null, size: UploadSizeChoice) => void
  /** Hand the image over to the interactive cropper instead. */
  onManual: () => void
}

/**
 * Every image in one multi-image block is cropped to a single shared frame, so
 * the published slides or cells line up instead of jumping in height. A
 * standalone image is left alone unless the user asks otherwise.
 */
export default function RatioPicker({
  open,
  label,
  alt,
  current,
  mode,
  fence = ':::carousel',
  size,
  oversize,
  busy,
  onCancel,
  onConfirm,
  onManual,
}: Props) {
  const { t } = useI18n()
  const [ratio, setRatio] = useState<CarouselRatio | null>(mode === 'loose' ? null : current ?? '4:3')
  const [uploadSize, setUploadSize] = useState<UploadSizeChoice>(size)
  const locked = mode === 'carousel' && Boolean(current)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the dialog stays mounted while closed, so its state has to be re-seeded from the props on every open (and re-open on a different slot). The alternative — keying the dialog — would remount and lose the open/close transition.
    setRatio(mode === 'loose' ? null : current ?? '4:3')
    setUploadSize(size)
  }, [open, current, mode, size])

  const preview = ratio ? carouselFrame(ratio) : null
  const showSizeTiers = mode === 'loose' && ratio === null
  const originalBlocked = showSizeTiers && uploadSize === 'original' && Boolean(oversize)

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !busy ? onCancel() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {mode === 'loose' ? t('ratio.looseTitle') : t('ratio.carouselTitle')}
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            {mode === 'loose' ? (
              <>{t('ratio.looseDesc')}</>
            ) : locked ? (
              <>
                {t('ratio.lockedDescA', { ratio: ratio ?? '' })}
                <code className="rounded bg-surface-sunken px-1">{fence}</code>
                {t('ratio.lockedDescB')}
              </>
            ) : (
              <>{t('ratio.freeDesc')}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1">
          <p className="mb-2 text-[11px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>
            {label} · {alt || t('common.unnamed')}
          </p>

          {mode === 'loose' && (
            <button
              type="button"
              onClick={() => setRatio(null)}
              className={`mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-all ${
                ratio === null ? 'ya-selected' : 'bg-surface-sunken hover:bg-surface-surface'
              }`}
              style={ratio === null ? undefined : { boxShadow: 'var(--shadow-inset)' }}
            >
              <span className={`text-[12px] ${ratio === null ? 'font-semibold text-brand' : 'text-ink-2'}`}>
                {t('ratio.keepOriginal')}
              </span>
              <span className="ml-auto text-[11px] text-ink-3">{t('ratio.recommended')}</span>
            </button>
          )}

          <div className="grid grid-cols-5 gap-2">
            {CAROUSEL_RATIOS.map((r) => {
              const f = carouselFrame(r)
              const active = r === ratio
              return (
                <button
                  key={r}
                  type="button"
                  disabled={locked}
                  onClick={() => setRatio(r)}
                  title={t('ratio.cropTitle', { r, w: f.cropWidth, h: f.cropHeight })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-all ${
                    active ? 'ya-selected' : 'bg-surface-sunken hover:bg-surface-surface'
                  } ${locked && !active ? 'opacity-40' : ''} disabled:cursor-not-allowed`}
                  style={active ? undefined : { boxShadow: 'var(--shadow-inset)' }}
                >
                  <span
                    className={`block rounded-sm border ${active ? 'border-brand bg-brand-100' : 'border-line-strong bg-surface-sunken'}`}
                    style={{ width: `${(f.width / 240) * 26}px`, height: `${(f.height / 240) * 26}px` }}
                  />
                  <span className={`text-[11px] tabular-nums ${active ? 'font-semibold text-brand' : 'text-ink-2'}`}>
                    {r}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            {preview
              ? t('ratio.cropTip', { w: preview.cropWidth, h: preview.cropHeight })
              : t('ratio.keepTip')}
          </p>

          {/* Only where it takes effect: a crop re-encodes at the frame's own
              resolution, so the size tiers are hidden for every cropping path. */}
          {showSizeTiers && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>
                {t('ratio.uploadSize')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {UPLOAD_SIZE_CHOICES.map((s) => {
                  const active = s === uploadSize
                  return (
                    <button
                      key={s}
                      type="button"
                      data-upload-size={s}
                      aria-pressed={active}
                      onClick={() => setUploadSize(s)}
                      className={`inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1.5 text-[12px] tabular-nums transition-all ${
                        active ? 'ya-selected font-semibold text-brand' : 'bg-surface-sunken text-ink-2 hover:bg-surface-surface'
                      }`}
                      style={active ? undefined : { boxShadow: 'var(--shadow-inset)' }}
                    >
                      {s === 'auto' ? t('ratio.sizeAuto') : s === 'original' ? t('ratio.sizeOriginal') : t('ratio.sizeMb', { n: s })}
                      {s === 'auto' && (
                        <span className="text-[10px] font-normal text-ink-3">{t('ratio.recommended')}</span>
                      )}
                    </button>
                  )
                })}
              </div>
              {originalBlocked && oversize ? (
                <p
                  data-upload-size-warning
                  className="mt-2 text-[11px] leading-relaxed text-warn-700"
                >
                  {t('ratio.originalTooBig', {
                    size: formatBytes(oversize.maxBytes),
                    limit: formatBytes(MaxImageBytes),
                  })}
                </p>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{t('ratio.sizeTip')}</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onManual}
            className="mt-2 flex w-full items-center justify-between rounded-xl border border-dashed border-line-strong px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-surface-tint"
          >
            <span className="text-[12px] text-ink-1">{t('ratio.manual')}</span>
            <span className="text-[11px] text-ink-3">
              {locked ? t('ratio.manualLocked', { ratio: ratio ?? '' }) : t('ratio.manualFree')}
            </span>
          </button>
        </div>

        {/* Sticky so the actions stay reachable when the dialog scrolls on a short window. */}
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex justify-end gap-2 border-t border-line-2 bg-surface-elevated px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="ya-btn ya-btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(ratio, uploadSize)}
            disabled={busy || originalBlocked}
            className="ya-btn ya-btn-primary"
          >
            {busy ? t('ratio.processing') : ratio ? t('ratio.uploadCropped') : t('ratio.uploadOriginal')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
