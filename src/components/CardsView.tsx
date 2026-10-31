// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Download, FolderDown } from 'lucide-react'
import { toast } from 'sonner'
import type { Doc, SignatureConfig } from '@/lib/types'
import type { MathSnapshot } from '@/lib/math'
import type { DiagramResolver } from '@/lib/render'
import { resolveImgSrc } from '@/lib/image'
import { safeFilename } from '@/lib/import-export'
import { renderCardArticle } from '@/lib/cards-render'
import {
  CARD_BACKGROUNDS, CARD_RATIOS, CARD_WIDTH, coverTitleSize, paginateCards,
  type CardBackground, type CardOptions, type CardPage, type CardRatio,
} from '@/lib/cards'
import { useI18n } from '@/hooks/useI18n'
import './cards.css'

const PREVIEW_WIDTH = 260
const PREVIEW_SCALE = PREVIEW_WIDTH / CARD_WIDTH
// The brand accent stays the same when the application's UI theme changes.
const BRAND_ACCENT = '#4F6CE8'

function background(id: CardBackground, accent: string): CSSProperties {
  switch (id) {
    case 'white': return { background: '#ffffff' }
    case 'paper': return { background: '#fbf7ef' }
    case 'night': return { background: '#1c1d22' }
    case 'tint': return { background: `linear-gradient(color-mix(in srgb, ${accent} 9%, transparent), color-mix(in srgb, ${accent} 9%, transparent)), #ffffff` }
    case 'grid': return {
      backgroundColor: '#fcfcfa',
      backgroundImage: 'linear-gradient(rgba(0,0,0,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.05) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    }
  }
}

interface Result { pages: CardPage[]; failedImages: string[]; scaledBlocks: number }
interface Props {
  doc: Doc
  source: string
  title: string
  accent?: string
  sig: SignatureConfig
  math: MathSnapshot
  resolveDiagram: DiagramResolver
  viewSwitch: ReactNode
  options: CardOptions
  onOptionsChange: (options: CardOptions) => void
}

export default function CardsView({ doc, source, title, accent: themeAccent, sig, math, resolveDiagram, viewSwitch, options, onOptionsChange }: Props) {
  const { t, lang } = useI18n()
  const { ratio, background: bg } = options
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const cardsRef = useRef<(HTMLDivElement | null)[]>([])
  const height = CARD_RATIOS[ratio]
  const dark = bg === 'night'
  const accent = themeAccent || BRAND_ACCENT
  const coverTitle = doc.blocks.find((block) => block.type === 'heading' && !block.numbered)
  const articleTitle = coverTitle?.type === 'heading' ? coverTitle.title : title
  const author = doc.meta.author || t('app.name')

  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    setError(false)
    const timer = window.setTimeout(async () => {
      try {
        const { prepareCardImages } = await import('@/lib/cards-export')
        const article = renderCardArticle(doc, {
          source, height, accent, dark, sig, resolveImage: resolveImgSrc,
          resolveMath: (tex, display) => math.get(tex, display), resolveDiagram,
        })
        const failedImages = await prepareCardImages(article, controller.signal)
        const layout = await paginateCards(article, { height, signal: controller.signal })
        if (!controller.signal.aborted) setResult({ ...layout, failedImages })
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    }, 160)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [doc, source, height, accent, dark, sig, math, resolveDiagram, retry, lang])

  useLayoutEffect(() => {
    // Ordinary titles keep mopai's size ladder. Extremely long H1s are fitted
    // by real height too, rather than escaping the cover or covering its footer.
    for (const card of cardsRef.current) {
      const copy = card?.querySelector<HTMLElement>('.xhs-cover-copy')
      const h1 = copy?.querySelector('h1')
      if (!card || !copy || !h1) continue
      let size = Number.parseFloat(h1.style.fontSize)
      while (copy.offsetHeight > height - 156 && size > 1) h1.style.fontSize = `${--size}px`
    }
  }, [result, height])

  const exportCards = async (index?: number) => {
    if (!result?.pages.length || result.failedImages.length || busy) return
    setBusy(true)
    setProgress({ done: 0, total: index === undefined ? result.pages.length : 1 })
    let exporter: Awaited<ReturnType<typeof import('@/lib/cards-export').createCardExporter>> | undefined
    try {
      const { createCardExporter, downloadCardBlob } = await import('@/lib/cards-export')
      const nodes = cardsRef.current.slice(0, result.pages.length).filter((node): node is HTMLDivElement => node !== null)
      if (nodes.length !== result.pages.length) throw new Error('card not mounted')
      exporter = await createCardExporter(nodes)
      const name = safeFilename(articleTitle, t('cards.filename'), '')
      if (index !== undefined) {
        downloadCardBlob(await exporter.shoot(index), `${name}-${String(index + 1).padStart(2, '0')}.png`)
      } else {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        for (let i = 0; i < nodes.length; i++) {
          zip.file(`${String(i + 1).padStart(2, '0')}.png`, await (await exporter.shoot(i)).arrayBuffer())
          setProgress({ done: i + 1, total: nodes.length })
        }
        downloadCardBlob(await zip.generateAsync({ type: 'blob' }), `${name}.zip`)
      }
      toast.success(t('cards.exported', { n: index === undefined ? nodes.length : 1 }))
    } catch (error) {
      toast.error(t('cards.exportFailed'), { description: error instanceof Error ? error.message : undefined })
    } finally {
      exporter?.dispose()
      setBusy(false)
    }
  }

  const total = result?.pages.length ?? 0
  const disabled = busy || !total || !!result?.failedImages.length
  return (
    <div data-onboarding="preview" data-xhs-view data-ready={result !== null} className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-line-1 px-4">{viewSwitch}</div>
      <div className="shrink-0 space-y-2 border-b border-line-1 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.ratio')}>
            {(Object.keys(CARD_RATIOS) as CardRatio[]).map((id) => (
              <button key={id} data-card-ratio={id} aria-pressed={ratio === id} disabled={busy}
                className={`ya-tool xhs-option ${ratio === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange({ ...options, ratio: id })}>{id}</button>
            ))}
          </div>
          <button data-card-export-all className="ya-btn ya-btn-primary ya-btn-sm" disabled={disabled} onClick={() => void exportCards()}>
            <FolderDown size={14} aria-hidden="true" />{busy ? t('cards.exporting', { n: progress.done, total: progress.total }) : t('cards.exportAll')}
          </button>
        </div>
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.background')}>
          {CARD_BACKGROUNDS.map((id) => (
            <button key={id} data-card-bg={id} aria-pressed={bg === id} disabled={busy}
              className={`ya-tool xhs-option ${bg === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange({ ...options, background: id })}>{t(`cards.bg.${id}`)}</button>
          ))}
        </div>
        <p className="text-[11px] text-ink-2" aria-live="polite">{t('cards.summary', { n: total, height: height * 2 })}</p>
      </div>
      <div className="ya-well min-h-0 flex-1 overflow-auto rounded-none p-4" data-card-scroller>
        <p className="mb-4 text-xs text-ink-2">{t('cards.hint')}</p>
        {error && <div className="mb-4 text-sm text-error-700" role="alert">{t('cards.layoutFailed')} <button className="ya-link-btn" onClick={() => setRetry((n) => n + 1)}>{t('common.retry')}</button></div>}
        {!result && !error && <p role="status" className="text-sm text-ink-2">{t('cards.measuring')}</p>}
        {result?.failedImages.length ? <div role="alert" data-card-image-warning className="mb-4 rounded-xl bg-surface-base p-3 text-xs text-error-700">
          <p>{t('cards.imageFailed', { n: result.failedImages.length })}</p>
          <ul className="mt-1 list-inside list-disc break-all">{result.failedImages.map((src) => <li key={src}>{src}</li>)}</ul>
          <button className="ya-link-btn" onClick={() => setRetry((n) => n + 1)}>{t('common.retry')}</button>
        </div> : null}
        {result?.scaledBlocks ? <p role="status" className="mb-4 text-xs text-warning-700">{t('cards.scaled', { n: result.scaledBlocks })}</p> : null}
        {result && !total && <p className="text-sm text-ink-2">{t('cards.empty')}</p>}
        <div className="flex flex-wrap justify-center gap-5">
          {result?.pages.map((page, i) => (
            <div key={i} style={{ width: PREVIEW_WIDTH }}>
              <div className="xhs-slot" style={{ width: PREVIEW_WIDTH, height: height * PREVIEW_SCALE }}>
                <div className="xhs-scale" style={{ transform: `scale(${PREVIEW_SCALE})` }}>
                  <div className="xhs-card" data-card-index={i} data-card-kind={page.kind} data-night={dark}
                    ref={(el) => { cardsRef.current[i] = el }}
                    style={{ width: CARD_WIDTH, height, '--xhs-accent': accent, ...background(bg, accent) } as CSSProperties}>
                    {page.kind === 'cover' ? <div className="xhs-cover">
                      <div className="xhs-cover-copy">
                        <i className="xhs-cover-bar" />
                        <h1 style={{ fontSize: coverTitleSize(page.title, height) }}>{page.title}</h1>
                        {page.subtitle && <p>{page.subtitle}</p>}
                      </div>
                      <div className="xhs-cover-foot"><span>{author}</span><span>{t('cards.swipe')}</span></div>
                    </div> : <>
                      <div className="xhs-card-head"><i /><span>{articleTitle}</span></div>
                      <div className="xhs-card-content" dangerouslySetInnerHTML={{ __html: page.html }} />
                      <div className="xhs-card-foot"><span>{author}</span><span>{String(i + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span></div>
                    </>}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-2">
                <span>{t(page.kind === 'cover' ? 'cards.coverPage' : 'cards.page', { n: i + 1 })}</span>
                <button data-card-export={i} className="ya-btn ya-btn-ghost ya-btn-sm" disabled={disabled}
                  aria-label={t('cards.downloadPage', { n: i + 1 })} onClick={() => void exportCards(i)}>
                  <Download size={13} aria-hidden="true" /> PNG
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
