import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
// The cropper's own stylesheet: without it the overlay and grid do not render.
import 'react-easy-crop/react-easy-crop.css'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cropToArea, type CropArea } from '@/lib/image'
import { carouselFrame } from '@/lib/themes'
import { ratioValue, type CarouselRatio } from '@/lib/types'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  open: boolean
  file: File | null
  label: string
  alt: string
  /** Fixed aspect ratio for carousel slides; null means free-form. */
  ratio: CarouselRatio | null
  busy: boolean
  onCancel: () => void
  onConfirm: (blob: Blob, mime: string) => void
}

/**
 * Drag-and-zoom cropper. The chosen rectangle is exported through the same
 * canvas path as the automatic crop, so what lands in R2 is already the final
 * frame — WeChat drops object-fit, so faking it in CSS is not an option.
 */
export default function ManualCropper({ open, file, label, alt, ratio, busy, onCancel, onConfirm }: Props) {
  const { t } = useI18n()
  const [src, setSrc] = useState<string>('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<CropArea | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Object URL for the preview; revoked when the file changes or we close.
  useEffect(() => {
    if (!file) {
      setSrc('')
      return
    }
    const url = URL.createObjectURL(file)
    setSrc(url)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setError(null)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setArea({ x: areaPixels.x, y: areaPixels.y, width: areaPixels.width, height: areaPixels.height })
  }, [])

  const confirm = async () => {
    if (!file || !area) return
    setWorking(true)
    setError(null)
    try {
      const out = await cropToArea(file, area, {
        ratio,
        targetWidth: ratio ? carouselFrame(ratio).cropWidth : undefined,
      })
      onConfirm(out.blob, out.mime)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('crop.failed'))
    } finally {
      setWorking(false)
    }
  }

  const aspect = ratio ? ratioValue(ratio) : 4 / 3
  const disabled = busy || working

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !disabled ? onCancel() : undefined)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t('crop.title')}</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            {ratio ? <>{t('crop.lockedDesc', { ratio })}</> : <>{t('crop.freeDesc')}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1">
          <p className="mb-2 text-[11px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>
            {label ? `${label} · ` : ''}{alt || t('common.unnamed')}
          </p>

          <div className="relative h-[min(380px,52vh)] w-full overflow-hidden rounded-xl bg-surface-sunken">
            {src ? (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                showGrid
                restrictPosition
                objectFit="contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-ink-3">{t('crop.loading')}</div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span className="shrink-0 text-[11px] text-ink-3">{t('crop.zoom')}</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1 w-full accent-brand"
            />
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
              {zoom.toFixed(1)}×
            </span>
            <button
              type="button"
              onClick={() => {
                setCrop({ x: 0, y: 0 })
                setZoom(1)
              }}
              className="ya-btn-ghost ya-btn ya-btn-sm shrink-0"
            >
              {t('crop.reset')}
            </button>
          </div>

          {area && (
            <p className="mt-2 text-[11px] text-ink-3">
              {t('crop.area', { w: Math.round(area.width), h: Math.round(area.height) })}
            </p>
          )}
          {error && <p className="mt-2 text-[11px] text-bad-700">{error}</p>}
        </div>

        {/* Sticky so the actions stay reachable when the dialog scrolls on a short window. */}
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-3 flex justify-end gap-2 border-t border-line-2 bg-surface-elevated px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="ya-btn ya-btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={disabled || !area}
            className="ya-btn ya-btn-primary"
          >
            {working ? t('crop.working') : t('crop.confirm')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
