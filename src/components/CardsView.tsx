// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { Doc, SignatureConfig } from '@/lib/types'
import type { MathSnapshot } from '@/lib/math'
import type { DiagramResolver } from '@/lib/render'
import type { MsgKey, MsgParams } from '@/lib/i18n'
import { resolveImgSrc } from '@/lib/image'
import { safeFilename } from '@/lib/import-export'
import { renderCardArticle } from '@/lib/cards-render'
import {
  CARD_RATIOS, CARD_WIDTH, cardAccent, cardMetrics, cardTemplateCustomize, cardTemplateFonts,
  coverTitleSize, isDarkVariant, paginateCards,
  type CardBackground, type CardOptions, type CardPage,
} from '@/lib/cards'
import { cardEndIsExtraPage, fragmentHtml, getLoadedCardTemplate, renderTemplatePage } from '@/lib/card-template'
import { useI18n } from '@/hooks/useI18n'
import { useResolvedTemplateCustom } from '@/hooks/useTemplateCustom'
import { BRAND_ACCENT, cardFrameStyle } from '@/lib/card-style'
import './cards.css'

const PREVIEW_WIDTH = 260
const PREVIEW_SCALE = PREVIEW_WIDTH / CARD_WIDTH
type Translate = (key: MsgKey, params?: MsgParams) => string
interface CoverProps {
  page: Extract<CardPage, { kind: 'cover' }>
  author: string
  height: number
  t: Translate
}

function Cover({ page, author, height, t }: CoverProps) {
  const titleSize = coverTitleSize(page.title, height)
  return (
    <div className="xhs-cover">
      <div className="xhs-cover-copy">
        <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
        {page.subtitle && <p>{page.subtitle}</p>}
      </div>
      <div className="xhs-cover-foot"><span>{author}</span><span>{t('cards.swipe')}</span></div>
    </div>
  )
}

interface BodyProps {
  page: Extract<CardPage, { kind: 'body' }>
  index: number
  articleTitle: string
  author: string
  total: number
}

function Body({ page, index, articleTitle, author, total }: BodyProps) {
  const pageNo = index + 1
  return (
    <>
      <div className="xhs-card-head"><span>{articleTitle}</span></div>
      <div className="xhs-card-content" dangerouslySetInnerHTML={{ __html: page.html }} />
      <div className="xhs-card-foot"><span>{author}</span><span>{String(pageNo).padStart(2, '0')} / {String(total).padStart(2, '0')}</span></div>
    </>
  )
}

interface Result {
  pages: CardPage[]
  failedImages: string[]
  scaledBlocks: number
  height: number
  dark: boolean
  template: string
  background: CardBackground
}
export interface CardsStatus {
  ready: boolean
  busy: boolean
  total: number
  failed: boolean
  error: boolean
  progress: { done: number; total: number }
}

export interface CardsViewHandle {
  exportAll: () => void
}

interface Props {
  doc: Doc
  source: string
  title: string
  accent?: string
  sig: SignatureConfig
  math: MathSnapshot
  resolveDiagram: DiagramResolver
  options: CardOptions
  /** Top bar owns the ZIP button; this keeps its disabled/progress state true. */
  onStatusChange?: (status: CardsStatus) => void
}

const CardsView = forwardRef<CardsViewHandle, Props>(function CardsView(
  { doc, source, title, accent: themeAccent, sig, math, resolveDiagram, options, onStatusChange },
  ref,
) {
  const { t, lang } = useI18n()
  const { ratio, template, background: bg } = options
  const [result, setResult] = useState<Result | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const cardsRef = useRef<(HTMLDivElement | null)[]>([])
  const height = CARD_RATIOS[ratio]
  const metrics = cardMetrics(template)
  const custom = getLoadedCardTemplate(template)
  const dark = isDarkVariant(template, bg)
  const accent = cardAccent(template, bg, themeAccent || BRAND_ACCENT)
  // Colour and font picks from the side panel; pagination measures with them.
  const picks = useResolvedTemplateCustom(template, bg, cardTemplateCustomize(template))
  const coverTitle = doc.blocks.find((block) => block.type === 'heading' && !block.numbered)
  const articleTitle = coverTitle?.type === 'heading' ? coverTitle.title : title
  const author = doc.meta.author || t('app.name')

  useEffect(() => {
    const controller = new AbortController()
    // An edit is measured behind the cards on screen, so typing neither blanks
    // the list nor scrolls back to the cover. A new ratio, template, variant or
    // night body needs a fresh layout; until it is ready, exports stay disabled.
    setResult((old) => (old && old.height === height && old.dark === dark &&
      old.template === template && old.background === bg ? old : null))
    setPending(true)
    setError(false)
    const timer = window.setTimeout(async () => {
      try {
        const { prepareCardImages } = await import('@/lib/cards-export')
        const article = renderCardArticle(doc, {
          source, height, template, renderTemplate: custom?.renderId, templateSource: custom?.template,
          background: bg, accent, dark, sig, resolveImage: resolveImgSrc,
          resolveMath: (tex, display) => math.get(tex, display), resolveDiagram,
          customVars: picks.vars,
        })
        const failedImages = await prepareCardImages(article, controller.signal)
        const layout = await paginateCards(article, {
          height, template, signal: controller.signal, extraFaces: picks.faces,
        })
        if (!controller.signal.aborted) {
          setResult({ ...layout, failedImages, height, dark, template, background: bg })
          setPending(false)
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(true)
          setPending(false)
        }
      }
    }, 160)
    return () => { controller.abort(); clearTimeout(timer) }
    // picks.key stands for picks.vars / picks.faces, which change together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, source, height, template, bg, accent, dark, sig, math, resolveDiagram, retry, lang, custom?.renderId, custom?.template, picks.key])

  useLayoutEffect(() => {
    // Ordinary titles keep each template's size ladder. Extremely long H1s are
    // fitted by real height too, rather than escaping the cover or covering its
    // footer. The reserve comes from the same metrics as pagination.
    for (const card of cardsRef.current) {
      const copy = card?.querySelector<HTMLElement>('.xhs-cover-copy')
      const h1 = card?.querySelector<HTMLElement>('[data-fit-cover-title]') ??
        copy?.querySelector<HTMLElement>('h1')
      const box = h1?.closest<HTMLElement>('[data-fit-box]') ?? copy
      if (!card || !box || !h1) continue
      // A constrained plate (position:absolute with top/bottom) has a fixed
      // box, so compare the content's scroll height with that box. Reed's copy
      // is in flow, so its own height is the content height.
      const constrained = box.hasAttribute('data-fit-constrained') ||
        getComputedStyle(box).position === 'absolute' ||
        box.classList.contains('xhs-cover-copy-constrained')
      const fits = () => constrained
        ? box.scrollHeight <= box.clientHeight + 0.5
        : box.offsetHeight <= height - metrics.coverReserve + 0.5
      let size = Number.parseFloat(h1.dataset.coverTitleSize ?? h1.style.fontSize)
      h1.style.fontSize = `${size}px`
      while (!fits() && size > 1) h1.style.fontSize = `${--size}px`
    }
  }, [result, height, metrics.coverReserve])

  // The article's pages, plus the template's closing page when it is a page
  // of its own (see cardEndIsExtraPage).
  const extraEnd = custom ? cardEndIsExtraPage(custom) : false
  const pages: (CardPage | { kind: 'end' })[] = result
    ? (extraEnd && result.pages.length ? [...result.pages, { kind: 'end' as const }] : result.pages)
    : []

  const exportCards = async (index?: number) => {
    if (!result || !pages.length || result.failedImages.length || busy || pending) return
    setBusy(true)
    setProgress({ done: 0, total: index === undefined ? pages.length : 1 })
    let exporter: Awaited<ReturnType<typeof import('@/lib/cards-export').createCardExporter>> | undefined
    try {
      const { createCardExporter, downloadCardBlob } = await import('@/lib/cards-export')
      const nodes = cardsRef.current.slice(0, pages.length).filter((node): node is HTMLDivElement => node !== null)
      if (nodes.length !== pages.length) throw new Error('card not mounted')
      const loaded = getLoadedCardTemplate(result.template)
      exporter = await createCardExporter(nodes, {
        faces: [...cardTemplateFonts(result.template), ...picks.faces],
        packageCss: loaded?.packageFontCss,
        userFonts: picks.userFonts,
      })
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

  const total = pages.length
  const failed = Boolean(result?.failedImages.length)
  const disabled = busy || pending || !total || failed

  useImperativeHandle(ref, () => ({ exportAll: () => void exportCards() }))

  useEffect(() => {
    onStatusChange?.({ ready: !disabled, busy, total, failed, error, progress })
  }, [onStatusChange, disabled, busy, total, failed, error, progress])

  return (
    <div data-onboarding="preview" data-xhs-view data-ready={!pending && !error && result !== null} className="flex h-full min-w-0 flex-col">
      {/* The preview keeps only the card summary; templates, ratios,
          backgrounds and the ZIP action live in the side panel and top bar. */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-1 px-4">
        <span className="ya-eyebrow whitespace-nowrap">{t('preview.cards')}</span>
        <span data-card-summary className="min-w-0 truncate text-[11px] text-ink-3" aria-live="polite">
          {pending ? t('cards.measuring') : error ? t('cards.layoutFailed') : t('cards.summary', { n: total, height: height * 2 })}
        </span>
      </div>
      <div className="ya-well min-h-0 flex-1 overflow-auto rounded-none p-4" data-card-scroller>
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
          {pages.map((page, i) => {
            const customHtml = custom
              ? fragmentHtml(renderTemplatePage(custom, {
                kind: page.kind === 'cover' ? 'cover'
                  : page.kind === 'end' || (custom.manifest.pages.end && !extraEnd && i === pages.length - 1) ? 'end' : 'body',
                pageIndex: i,
                total: pages.length,
                title: page.kind === 'cover' ? page.title : articleTitle,
                subtitle: page.kind === 'cover' ? page.subtitle : '',
                author,
                articleTitle,
                contentHtml: page.kind === 'body' ? page.html : '',
                height,
                lang,
              }, bg, dark))
              : null
            return (
            <div key={i} style={{ width: PREVIEW_WIDTH }}>
              <div className="xhs-slot" style={{ width: PREVIEW_WIDTH, height: height * PREVIEW_SCALE }}>
                <div className="xhs-scale" style={{ transform: `scale(${PREVIEW_SCALE})` }}>
                  <div className="xhs-card" data-card-index={i} data-card-kind={page.kind} data-template={custom?.renderId ?? template} data-variant={bg} data-night={dark} data-card-aspect={ratio}
                    {...(custom ? { 'data-card-template-source': custom.template } : {})}
                    ref={(el) => { cardsRef.current[i] = el }}
                    {...(customHtml !== null ? { dangerouslySetInnerHTML: { __html: customHtml } } : {})}
                    style={cardFrameStyle({
                      template, background: bg, accent, height, width: CARD_WIDTH, custom: Boolean(custom), vars: picks.vars,
                    })}>
                    {customHtml !== null ? null : page.kind === 'cover'
                      ? <Cover page={page} author={author} height={height} t={t} />
                      : page.kind === 'body'
                        ? <Body page={page} index={i} articleTitle={articleTitle} author={author} total={total} />
                        : null}
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
            )
          })}
        </div>
      </div>
    </div>
  )
})

export default CardsView
