import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react'
import { toast } from 'sonner'
import type { Doc, SignatureConfig } from '@/lib/types'
import type { MathSnapshot } from '@/lib/math'
import type { DiagramResolver } from '@/lib/render'
import type { LongOptions } from '@/lib/long-options'
import { longTemplateCustomize, longTemplateFonts } from '@/lib/cards'
import { ensureFontSheets } from '@/lib/font-catalog'
import { LONG_WIDTH } from '@/lib/long-image'
import { renderLongArticle } from '@/lib/long-image-render'
import { exportLongImage, prepareLongImages, type LongExportProgress } from '@/lib/long-image-export'
import type { LoadedLongTemplate } from '@/lib/card-template'
import { resolveImgSrc } from '@/lib/image'
import { safeFilename } from '@/lib/import-export'
import { useI18n } from '@/hooks/useI18n'
import { useResolvedTemplateCustom } from '@/hooks/useTemplateCustom'
import './long-image.css'

export interface LongStatus {
  ready: boolean
  /** Layout finished even when some photos could not be read. */
  layoutReady: boolean
  busy: boolean
  /** True while images/fonts are being measured behind the visible preview. */
  pending: boolean
  failed: boolean
  error: boolean
  height: number
  sections: number
  /** Exported as more than one file because the browser canvas was too small. */
  split: number
  progress: LongExportProgress
}

export interface LongImageViewHandle {
  export: () => void
  cancel: () => void
}

interface Props {
  doc: Doc
  source: string
  title: string
  sig: SignatureConfig
  math: MathSnapshot
  resolveDiagram: DiagramResolver
  options: LongOptions
  /** The activated package; undefined until the public/uploaded zip is ready. */
  template: LoadedLongTemplate | undefined
  loadedVersion: number
  onStatusChange?: (status: LongStatus) => void
}

const IDLE_PROGRESS: LongExportProgress = { phase: 'measure', done: 0, total: 0 }

const LongImageView = forwardRef<LongImageViewHandle, Props>(function LongImageView(
  { doc, source, title, sig, math, resolveDiagram, options, template, loadedVersion, onStatusChange },
  ref,
) {
  const { t, lang } = useI18n()
  const [result, setResult] = useState<{
    height: number
    sections: number
    failedImages: string[]
    scale: number
  } | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [imageProgress, setImageProgress] = useState({ done: 0, total: 0 })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<LongExportProgress>(IDLE_PROGRESS)
  const [split, setSplit] = useState(0)
  const [exportCalls, setExportCalls] = useState(0)
  const [lastExport, setLastExport] = useState<{ filename: string; size: number; tiles: number } | null>(null)
  const [lastError, setLastError] = useState('')
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [previewWidth, setPreviewWidth] = useState(0)
  const scale = previewWidth > 0 ? Math.min(1, previewWidth / LONG_WIDTH) : 0
  const picks = useResolvedTemplateCustom(options.template, options.variant, longTemplateCustomize(options.template))
  const articleTitle = useMemo(() => {
    const heading = doc.blocks.find((block) => block.type === 'heading' && !block.numbered)
    return heading?.type === 'heading' ? heading.title : title
  }, [doc, title])


  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => {
      const style = getComputedStyle(scroller)
      const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
      setPreviewWidth(Math.max(0, scroller.clientWidth - padding))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!template) {
      setPending(true)
      return
    }
    const controller = new AbortController()
    setPending(true)
    setError(false)
    setSplit(0)
    const timer = window.setTimeout(async () => {
      const stage = document.createElement('div')
      stage.setAttribute('aria-hidden', 'true')
      stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${LONG_WIDTH}px;pointer-events:none`
      document.body.append(stage)
      try {
        const { root, model } = renderLongArticle(doc, {
          source,
          lang,
          template: options.template,
          renderTemplate: template.renderId,
          templateSource: template.template,
          variant: options.variant,
          dark: (template.manifest.variants.find((variant) => variant.id === options.variant)?.dark) ?? false,
          metrics: template.manifest.metrics,
          sig,
          resolveImage: resolveImgSrc,
          resolveMath: (tex, display) => math.get(tex, display),
          resolveDiagram,
          customVars: picks.vars,
        }, template)
        stage.append(root)
        // Load every face the text will use before anything is measured: the
        // preview height and the export both come from this layout.
        const faces = [...longTemplateFonts(options.template), ...picks.faces]
        await ensureFontSheets(faces.map((face) => face.family))
        if (document.fonts) {
          const text = root.textContent ?? ''
          await Promise.all(faces.flatMap(({ family, weights, styles }) =>
            weights.flatMap((weight) => (styles ?? ['normal']).map((style) =>
              document.fonts.load(`${style === 'italic' ? 'italic ' : ''}${weight} 18px "${family}"`, text).catch(() => []),
            )),
          ))
          await document.fonts.ready
        }
        controller.signal.throwIfAborted()
        const prepared = await prepareLongImages(root, template.manifest.metrics, {
          scale: options.width / LONG_WIDTH,
          signal: controller.signal,
          onProgress: (done, total) => setImageProgress({ done, total }),
        })
        controller.signal.throwIfAborted()
        const height = Math.ceil(root.getBoundingClientRect().height)
        if (!controller.signal.aborted) {
          const scroller = scrollerRef.current
          const keep = scroller?.scrollTop ?? 0
          const host = rootRef.current
          if (host) {
            host.replaceChildren(root)
            host.style.transform = `scale(${previewWidth / LONG_WIDTH})`
          }
          if (scroller) scroller.scrollTop = keep
          setResult({
            height,
            sections: model.sections.length,
            failedImages: prepared.failed,
            scale: previewWidth / LONG_WIDTH,
          })
          setPending(false)
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(true)
          setPending(false)
        }
      } finally {
        stage.remove()
      }
    }, 160)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // `previewWidth` is deliberately excluded from the rebuild trigger: the root
    // is laid out at 540px and only the wrapper scale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, source, lang, template, loadedVersion, options.template, options.variant, options.width, sig, math, resolveDiagram, retry, picks.key])

  useEffect(() => {
    const host = rootRef.current
    if (!host || !result) return
    host.style.transform = `scale(${scale})`
  }, [scale, result])

  const exportImage = useCallback(async () => {
    const root = rootRef.current?.firstElementChild as HTMLElement | null
    if (!root || !template || !result || result.failedImages.length || pending || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setProgress({ phase: 'measure', done: 0, total: 1 })
    try {
      const filename = safeFilename(articleTitle, t('long.template'), '')
      const output = await exportLongImage(root, {
        faces: [...longTemplateFonts(options.template), ...picks.faces],
        packageCss: template.packageFontCss,
        userFonts: picks.userFonts,
        scale: options.width / LONG_WIDTH,
        format: options.format,
        filename,
        signal: controller.signal,
        onProgress: setProgress,
      })
      // A cancel racing the last render step must not deliver a file or a
      // success toast. Re-check after the export settles and once more after the
      // lazy import, immediately before handing the blob to the browser.
      controller.signal.throwIfAborted()
      const { downloadCardBlob } = await import('@/lib/cards-export')
      controller.signal.throwIfAborted()
      downloadCardBlob(output.blob, output.filename)
      setLastExport({ filename: output.filename, size: output.blob.size, tiles: output.tiles })
      setLastError('')
      setSplit(output.split ? output.tiles : 0)
      if (output.split) toast.info(t('long.split', { n: output.tiles }))
      else toast.success(t('long.exported'))
    } catch (item) {
      if (controller.signal.aborted) toast(t('long.canceled'))
      else {
        setLastError(item instanceof Error ? item.message : String(item))
        toast.error(t('long.exportFailed'), { description: item instanceof Error ? item.message : undefined })
      }
    } finally {
      abortRef.current = null
      setBusy(false)
      setProgress(IDLE_PROGRESS)
    }
  }, [articleTitle, busy, options.format, options.template, options.width, pending, picks, result, t, template])

  useImperativeHandle(ref, () => ({
    export: () => { setExportCalls((value) => value + 1); void exportImage() },
    cancel: () => abortRef.current?.abort(),
  }), [exportImage])

  const failed = Boolean(result?.failedImages.length)
  const empty = result !== null && result.height <= 0
  const layoutReady = Boolean(result) && !pending && !error && !empty
  const ready = layoutReady && !failed

  useEffect(() => {
    onStatusChange?.({
      ready, layoutReady, busy, pending, failed, error, height: result?.height ?? 0,
      sections: result?.sections ?? 0, split, progress,
    })
  }, [onStatusChange, ready, layoutReady, busy, pending, failed, error, result, split, progress])

  // Clear a stale image warning as soon as a pixel-complete rebuild lands.
  useEffect(() => {
    if (result && !result.failedImages.length) setImageProgress({ done: 0, total: 0 })
  }, [result])

  return (
    <div data-long-view data-ready={ready && !busy ? 'true' : undefined}
      data-long-layout={layoutReady ? 'ready' : empty ? 'empty' : error ? 'error' : 'pending'}
      data-long-export-blocked={failed ? 'true' : undefined}
      data-long-pending={pending ? 'true' : undefined}
      data-long-error={error ? 'true' : undefined}
      data-long-height={result?.height ?? undefined}
      data-long-sections={result?.sections ?? undefined}
      data-long-split={split || undefined}
      data-long-export-calls={exportCalls || undefined}
      data-long-last-export={lastExport ? `${lastExport.filename}:${lastExport.size}` : undefined}
      data-long-last-error={lastError || undefined}
      className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-1 px-4">
        <span className="ya-eyebrow whitespace-nowrap">{t('preview.long')}</span>
        <span data-long-summary className="min-w-0 truncate text-[11px] text-ink-3" aria-live="polite">
          {pending
            ? t('long.measuring')
            : error ? t('long.layoutFailed')
              : empty ? t('long.empty')
                : t('long.summary', { n: result?.sections ?? 0, height: result?.height ?? 0 })}
        </span>
      </div>
      <div ref={scrollerRef} data-long-scroller className="ya-well min-h-0 flex-1 overflow-auto rounded-none p-4">
        {error && (
          <div className="mb-4 text-sm text-error-700" role="alert">
            {t('long.layoutFailed')}
            <button className="ya-link-btn ml-1" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</button>
          </div>
        )}
        {!template && !error && <p role="status" className="text-sm text-ink-2">{t('cards.publicTemplatesLoading')}</p>}
        {template && !result && !error && (
          <p role="status" className="text-sm text-ink-2">
            {t('long.measuring')}
            {imageProgress.total > 0 ? ` ${t('long.exportProgress', imageProgress)}` : ''}
          </p>
        )}
        {result?.failedImages.length ? (
          <div role="alert" data-long-image-warning className="mb-4 rounded-xl bg-surface-base p-3 text-xs text-error-700">
            <p>{t('long.imageFailed', { n: result.failedImages.length })}</p>
            <ul className="mt-1 list-inside list-disc break-all">
              {result.failedImages.map((src) => <li key={src}>{src}</li>)}
            </ul>
            <button className="ya-link-btn" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</button>
          </div>
        ) : null}
        {empty && <p className="text-sm text-ink-2">{t('long.empty')}</p>}
        <div className="flex justify-center" style={{ display: result ? undefined : 'none' }}>
          <div
            data-long-preview-frame
            style={{ width: result ? LONG_WIDTH * scale : 0, height: result ? result.height * scale : 0, position: 'relative', overflow: 'hidden' }}
          >
            <div
              className="reed-long-preview"
              style={{ width: LONG_WIDTH, transformOrigin: 'top left' }}
            >
              <div ref={rootRef} data-long-preview-root style={{ transformOrigin: 'top left' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export default LongImageView
