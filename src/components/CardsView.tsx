// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Download, FolderDown } from 'lucide-react'
import { toast } from 'sonner'
import type { Doc, SignatureConfig } from '@/lib/types'
import type { MathSnapshot } from '@/lib/math'
import type { DiagramResolver } from '@/lib/render'
import type { MsgKey, MsgParams } from '@/lib/i18n'
import { resolveImgSrc } from '@/lib/image'
import { safeFilename } from '@/lib/import-export'
import { renderCardArticle } from '@/lib/cards-render'
import {
  CARD_RATIOS, CARD_TEMPLATES, CARD_WIDTH, cardAccent, cardMetrics, chinesePageNumber,
  coverTitleSize, isDarkVariant, paginateCards, templateVariants, withTemplate,
  type CardBackground, type CardOptions, type CardPage, type CardRatio, type CardTemplate,
} from '@/lib/cards'
import { useI18n } from '@/hooks/useI18n'
import './cards.css'

const PREVIEW_WIDTH = 260
const PREVIEW_SCALE = PREVIEW_WIDTH / CARD_WIDTH
// The brand accent stays the same when the application's UI theme changes.
const BRAND_ACCENT = '#4F6CE8'

/** PAPER's procedural grain: an SVG turbulence tile, baked into the PNG. */
function paperGrain(opacity: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='${opacity}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function background(template: CardTemplate, id: CardBackground, accent: string): CSSProperties {
  if (template === 'reed') {
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
      default: return { background: '#fbf7ef' }
    }
  }
  if (template === 'yoru') return { background: '#F2F5F5' }
  if (template === 'paper') {
    const color = id === 'analog' ? '#EDE6D7' : id === 'midnight' ? '#1A2130' : '#F4F1EA'
    const grain = id === 'analog' ? paperGrain(.075) : id === 'editorial' ? paperGrain(.035) : undefined
    return {
      backgroundColor: color,
      ...(grain ? { backgroundImage: grain, backgroundRepeat: 'repeat', backgroundSize: '160px 160px' } : {}),
    }
  }
  // Console: flat porcelain/midnight with the system's page-level radial wash.
  return id === 'yoru'
    ? { background: 'radial-gradient(120% 80% at 80% -10%, rgba(122,149,250,.10), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(240,120,48,.06), transparent 55%), #0B1020' }
    : { background: 'radial-gradient(120% 80% at 80% -10%, rgba(79,108,232,.07), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(240,106,32,.05), transparent 55%), #E8ECF3' }
}

function MoonPhases() {
  return (
    <svg className="xhs-moons" viewBox="0 0 96 26" aria-hidden="true">
      <circle cx="12" cy="13" r="10" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M36 3a10 10 0 0 1 0 20Z" fill="currentColor" />
      <circle cx="36" cy="13" r="10" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="60" cy="13" r="10" fill="var(--xhs-accent)" />
      <path d="M84 3a10 10 0 0 1 0 20 5.5 10 0 0 0 0-20Z" fill="currentColor" />
    </svg>
  )
}

function YoruMasthead({ page, total }: { page: number; total: number }) {
  return (
    <div className="xhs-yoru-masthead" aria-hidden="true">
      <div className="xhs-yoru-mast-row">
        <MoonPhases />
        <span className="xhs-yoru-folio">{chinesePageNumber(page)} / {chinesePageNumber(total)}</span>
      </div>
      <i className="xhs-yoru-wu" />
      <i className="xhs-yoru-wen" />
    </div>
  )
}

function YoruSpine({ title }: { title: string }) {
  return <div className="xhs-yoru-spine" aria-hidden="true"><span>{title}</span></div>
}

function paperDate(lang: string): string {
  const now = new Date()
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

type Translate = (key: MsgKey, params?: MsgParams) => string
interface CoverProps {
  page: Extract<CardPage, { kind: 'cover' }>
  template: CardTemplate
  variant: CardBackground
  articleTitle: string
  author: string
  total: number
  height: number
  lang: string
  t: Translate
}

function Cover({ page, template, variant, articleTitle, author, total, height, lang, t }: CoverProps) {
  const titleSize = coverTitleSize(page.title, height, template)
  if (template === 'yoru') {
    return (
      <div className="xhs-cover xhs-yoru-cover">
        <YoruMasthead page={1} total={total} />
        <div className="xhs-cover-copy xhs-yoru-plate">
          <div className="xhs-yoru-title" style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>
            <span className="xhs-yoru-ghost" aria-hidden="true">{page.title}</span>
            <span className="xhs-yoru-ink">{page.title}</span>
          </div>
          {page.subtitle && <p className="xhs-yoru-subtitle">{page.subtitle}</p>}
        </div>
        <div className="xhs-cover-foot xhs-yoru-cover-foot">
          <span>{author}</span>
          <span>{t('cards.pageCount', { n: chinesePageNumber(total) })}</span>
        </div>
        <YoruSpine title={articleTitle} />
      </div>
    )
  }
  if (template === 'paper') {
    const date = paperDate(lang)
    return (
      <div className="xhs-cover xhs-paper-cover" data-mode={variant}>
        <div className="xhs-paper-cover-rule" aria-hidden="true"><i /><i /></div>
        <div className="xhs-cover-copy xhs-paper-plate">
          <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-paper-standfirst">{page.subtitle}</p>}
        </div>
        {variant === 'analog' && <div className="xhs-paper-stamp" aria-hidden="true">{date}</div>}
        <div className="xhs-cover-foot xhs-paper-cover-foot">
          <span>{author}</span>
          <span>{date}</span>
        </div>
      </div>
    )
  }
  if (template === 'console') {
    return (
      <div className="xhs-cover xhs-console-cover">
        <div className="xhs-cover-copy xhs-console-plate">
          <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-console-standfirst">{page.subtitle}</p>}
        </div>
        <div className="xhs-cover-foot xhs-console-cover-foot">
          <span>{author}</span>
          <span className="xhs-console-pill">{chinesePageNumber(1)} / {chinesePageNumber(total)}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="xhs-cover">
      <div className="xhs-cover-copy">
        <i className="xhs-cover-bar" />
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
  template: CardTemplate
  variant: CardBackground
  articleTitle: string
  author: string
  total: number
  t: Translate
}

function Body({ page, index, template, variant, articleTitle, author, total, t }: BodyProps) {
  const pageNo = index + 1
  if (template === 'yoru') {
    return (
      <>
        <YoruMasthead page={pageNo} total={total} />
        <YoruSpine title={articleTitle} />
        <div className="xhs-card-content xhs-yoru-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-yoru-foot">
          <span>{author}</span>
          <span className="xhs-yoru-seal">{t('app.name')}</span>
        </div>
      </>
    )
  }
  if (template === 'paper') {
    return (
      <>
        <div className="xhs-paper-head" data-mode={variant}><span>{articleTitle}</span></div>
        <div className="xhs-card-content xhs-paper-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-paper-foot">
          <span>{author}</span>
          <span>{String(pageNo).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        </div>
      </>
    )
  }
  if (template === 'console') {
    return (
      <>
        <div className="xhs-console-head"><span>{articleTitle}</span></div>
        <div className="xhs-card-content xhs-console-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-console-foot">
          <span>{author}</span>
          <span className="xhs-console-pill">{String(pageNo).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        </div>
      </>
    )
  }
  return (
    <>
      <div className="xhs-card-head"><i /><span>{articleTitle}</span></div>
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
  template: CardTemplate
  background: CardBackground
}
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
  const dark = isDarkVariant(template, bg)
  const accent = cardAccent(template, bg, themeAccent || BRAND_ACCENT)
  const coverTitle = doc.blocks.find((block) => block.type === 'heading' && !block.numbered)
  const articleTitle = coverTitle?.type === 'heading' ? coverTitle.title : title
  const author = doc.meta.author || t('app.name')
  const variants = templateVariants(template)

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
          source, height, template, background: bg, accent, dark, sig, resolveImage: resolveImgSrc,
          resolveMath: (tex, display) => math.get(tex, display), resolveDiagram,
        })
        const failedImages = await prepareCardImages(article, controller.signal)
        const layout = await paginateCards(article, { height, template, signal: controller.signal })
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
  }, [doc, source, height, template, bg, accent, dark, sig, math, resolveDiagram, retry, lang])

  useLayoutEffect(() => {
    // Ordinary titles keep each template's size ladder. Extremely long H1s are
    // fitted by real height too, rather than escaping the cover or covering its
    // footer. The reserve comes from the same metrics as pagination.
    for (const card of cardsRef.current) {
      const copy = card?.querySelector<HTMLElement>('.xhs-cover-copy')
      const h1 = copy?.querySelector<HTMLElement>('h1, .xhs-yoru-title')
      if (!card || !copy || !h1) continue
      // A constrained plate (position:absolute with top/bottom) has a fixed
      // box, so compare the content's scroll height with that box. Reed's copy
      // is in flow, so its own height is the content height.
      const constrained = getComputedStyle(copy).position === 'absolute'
      const fits = () => constrained
        ? copy.scrollHeight <= copy.clientHeight + 0.5
        : copy.offsetHeight <= height - metrics.coverReserve + 0.5
      let size = Number.parseFloat(h1.dataset.coverTitleSize ?? h1.style.fontSize)
      h1.style.fontSize = `${size}px`
      while (!fits() && size > 1) h1.style.fontSize = `${--size}px`
    }
  }, [result, height, metrics.coverReserve])

  const exportCards = async (index?: number) => {
    if (!result?.pages.length || result.failedImages.length || busy || pending) return
    setBusy(true)
    setProgress({ done: 0, total: index === undefined ? result.pages.length : 1 })
    let exporter: Awaited<ReturnType<typeof import('@/lib/cards-export').createCardExporter>> | undefined
    try {
      const { createCardExporter, downloadCardBlob } = await import('@/lib/cards-export')
      const nodes = cardsRef.current.slice(0, result.pages.length).filter((node): node is HTMLDivElement => node !== null)
      if (nodes.length !== result.pages.length) throw new Error('card not mounted')
      exporter = await createCardExporter(nodes, result.template)
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
  const disabled = busy || pending || !total || !!result?.failedImages.length
  return (
    <div data-onboarding="preview" data-xhs-view data-ready={!pending && !error && result !== null} className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-line-1 px-4">{viewSwitch}</div>
      <div className="shrink-0 space-y-2 border-b border-line-1 p-3">
        <div className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label={t('cards.template')}>
          {CARD_TEMPLATES.map((id) => (
            <button key={id} data-card-template={id} aria-pressed={template === id} disabled={busy}
              className={`ya-tool xhs-option ${template === id ? 'ya-selected' : ''}`} onClick={() => onOptionsChange(withTemplate(options, id))}>{t(`cards.template.${id}`)}</button>
          ))}
        </div>
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
          {variants.map((id) => (
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
                  <div className="xhs-card" data-card-index={i} data-card-kind={page.kind} data-template={template} data-variant={bg} data-night={dark}
                    ref={(el) => { cardsRef.current[i] = el }}
                    style={{
                      width: CARD_WIDTH, height, '--xhs-accent': accent,
                      '--xhs-pad-x': `${metrics.padX}px`,
                      '--xhs-pad-top': `${metrics.padTop}px`,
                      '--xhs-pad-bottom': `${metrics.padBottom}px`,
                      '--xhs-content-w': `${metrics.contentWidth}px`,
                      '--xhs-header-top': `${metrics.headerTop}px`,
                      '--xhs-footer-bottom': `${metrics.footerBottom}px`,
                      '--xhs-cover-inset-x': `${metrics.coverInsetX}px`,
                      '--xhs-cover-inset-y': `${metrics.coverInsetY}px`,
                      '--xhs-cover-foot-bottom': `${metrics.coverFootBottom}px`,
                      ...background(template, bg, accent),
                    } as CSSProperties}>
                    {page.kind === 'cover'
                      ? <Cover page={page} template={template} variant={bg} articleTitle={articleTitle} author={author} total={total} height={height} lang={lang} t={t} />
                      : <Body page={page} index={i} template={template} variant={bg} articleTitle={articleTitle} author={author} total={total} t={t} />}
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