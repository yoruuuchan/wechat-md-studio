// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
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
  CARD_RATIOS, CARD_WIDTH, cardAccent, cardMetrics, chinesePageNumber,
  coverTitleSize, isDarkVariant, paginateCards,
  type CardBackground, type CardOptions, type CardPage, type CardTemplate,
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

function background(template: CardTemplate, id: CardBackground, accent: string, kind: CardPage['kind'] = 'body'): CSSProperties {
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
  if (template === 'console') {
    // Console: flat porcelain/midnight with the system's page-level radial wash.
    return id === 'yoru'
      ? { background: 'radial-gradient(120% 80% at 80% -10%, rgba(122,149,250,.10), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(240,120,48,.06), transparent 55%), #0B1020' }
      : { background: 'radial-gradient(120% 80% at 80% -10%, rgba(79,108,232,.07), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(240,106,32,.05), transparent 55%), #E8ECF3' }
  }
  if (template === 'kunlun') {
    const light = id === 'snowline'
    return {
      backgroundColor: light ? '#E2E9F2' : '#06080D',
      backgroundImage: [
        light ? 'radial-gradient(120% 90% at 50% -10%, rgba(0,152,212,.10), transparent 58%)' : 'radial-gradient(120% 90% at 50% -10%, rgba(0,184,255,.14), transparent 56%)',
        'linear-gradient(rgba(120,180,255,.06) 1px, transparent 1px)',
        'linear-gradient(90deg, rgba(120,180,255,.06) 1px, transparent 1px)',
      ].join(', '),
      backgroundSize: 'auto, 18px 18px, 18px 18px',
    }
  }
  if (template === 'rift') {
    const light = id === 'light'
    return {
      backgroundColor: light ? '#EAF1FC' : '#050A18',
      backgroundImage: [
        light
          ? 'radial-gradient(125% 90% at 50% -10%, #FFFFFF 0%, #E8F0FD 46%, #D2E0F6 100%)'
          : 'radial-gradient(125% 90% at 50% -10%, #1A2F58 0%, #0A1633 46%, #050A1C 100%)',
        'linear-gradient(rgba(34,64,128,.07) 1px, transparent 1px)',
        'linear-gradient(90deg, rgba(34,64,128,.07) 1px, transparent 1px)',
      ].join(', '),
      backgroundSize: 'auto, 32px 32px, 32px 32px',
    }
  }
  if (template === 'core') {
    const light = id === 'frost'
    return {
      backgroundColor: light ? '#EAF4F8' : '#071820',
      backgroundImage: [
        light ? 'linear-gradient(rgba(12,26,38,.055) 1px, transparent 1px)' : 'linear-gradient(rgba(65,96,122,.10) 1px, transparent 1px)',
        light ? 'linear-gradient(90deg, rgba(12,26,38,.055) 1px, transparent 1px)' : 'linear-gradient(90deg, rgba(65,96,122,.10) 1px, transparent 1px)',
      ].join(', '),
      backgroundSize: '16px 16px, 16px 16px',
    }
  }
  if (template === 'aozora') {
    if (id === 'yozora') {
      return {
        backgroundColor: '#040B18',
        backgroundImage: 'radial-gradient(circle at 72% 16%, rgba(244,249,255,.22) 0%, rgba(216,232,248,.10) 9%, transparent 26%), linear-gradient(180deg, #071426 0%, #040B18 60%, #01040C 100%)',
      }
    }
    return { background: 'linear-gradient(180deg, #EAF5FF 0%, #CFE8FF 35%, #9DD2FF 70%, #FFE980 100%)' }
  }
  if (template === 'kihon') {
    const light = id === 'gin'
    return {
      backgroundColor: light ? '#E7E9EB' : '#111417',
      backgroundImage: `radial-gradient(125% 105% at 50% 30%, transparent 42%, ${light ? 'rgba(10,12,14,.065)' : 'rgba(0,0,0,.36)'} 100%), ${paperGrain(light ? .05 : .07)}`,
      backgroundSize: 'auto, 160px 160px',
      backgroundRepeat: 'no-repeat, repeat',
    }
  }
  // Mayonaka: midnight for every body page; sunset is the cover-only variant.
  if (template === 'mayonaka') {
    if (id === 'sunset' && kind === 'cover') {
      return { background: 'linear-gradient(180deg, #0A1654 0%, #3A1A8A 30%, #FF2BD6 70%, #FF71CE 100%)' }
    }
    return {
      background: 'repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,.25) 3px, rgba(0,0,0,.25) 4px), linear-gradient(180deg, #07000F 0%, #0A1654 60%, #100225 100%)',
    }
  }
  return { background: '#fbf7ef' }
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

const pad2 = (n: number) => String(n).padStart(2, '0')

/** core's Windows title bar: 1px ink frame, lowercase chrome, no fake buttons. */
function CoreBar({ label }: { label?: string }) {
  return (
    <div className="xhs-core-bar">
      {label ? <span className="xhs-core-bar-label">{label.toLowerCase()}</span> : null}
    </div>
  )
}

function KihonFolio({ page, total }: { page: number; total: number }) {
  return <div className="xhs-kihon-folio">{pad2(page)} / {pad2(total)}</div>
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
  if (template === 'kunlun') {
    return (
      <div className="xhs-cover xhs-kunlun-cover">
        <div className="xhs-cover-copy xhs-kunlun-plate">
          <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-kunlun-standfirst">{page.subtitle}</p>}
        </div>
        <div className="xhs-cover-foot xhs-kunlun-cover-foot">
          <span>{author}</span>
          <span>[ {pad2(1)} / {pad2(total)} ]</span>
        </div>
      </div>
    )
  }
  if (template === 'rift') {
    return (
      <div className="xhs-cover xhs-rift-cover">
        <div className="xhs-cover-copy xhs-rift-plate">
          <h1 className="xhs-rift-title" style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-rift-standfirst">{page.subtitle}</p>}
        </div>
        <div className="xhs-cover-foot xhs-rift-cover-foot">
          <span>{author}</span>
          <span>{pad2(1)} / {pad2(total)}</span>
        </div>
      </div>
    )
  }
  if (template === 'core') {
    return (
      <div className="xhs-cover xhs-core-cover">
        <div className="xhs-core-window xhs-core-cover-window">
          <CoreBar />
          <div className="xhs-cover-copy xhs-core-plate xhs-cover-copy-constrained">
            <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
            {page.subtitle && <p className="xhs-core-standfirst">{page.subtitle}</p>}
          </div>
          <div className="xhs-core-status">
            <span>{author}</span>
            <span>{pad2(1)} / {pad2(total)}</span>
          </div>
        </div>
      </div>
    )
  }
  if (template === 'aozora') {
    return (
      <div className="xhs-cover xhs-aozora-cover">
        <div className="xhs-cover-copy xhs-aozora-plate">
          <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-aozora-standfirst">{page.subtitle}</p>}
        </div>
        <div className="xhs-cover-foot xhs-aozora-cover-foot">
          <span>{author}</span>
          <span>{pad2(1)} / {pad2(total)}</span>
        </div>
      </div>
    )
  }
  if (template === 'kihon') {
    return (
      <div className="xhs-cover xhs-kihon-cover">
        <div className="xhs-cover-copy xhs-kihon-plate">
          <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-kihon-standfirst">{page.subtitle}</p>}
          <i className="xhs-kihon-rule" />
        </div>
        <KihonFolio page={1} total={total} />
      </div>
    )
  }
  if (template === 'mayonaka') {
    return (
      <div className="xhs-cover xhs-mayonaka-cover">
        <div className="xhs-mnk-grid" aria-hidden="true" />
        {variant === 'sunset' && <div className="xhs-mnk-sun" aria-hidden="true" />}
        <div className="xhs-cover-copy xhs-mnk-plate">
          <h1 style={{ fontSize: titleSize }} data-cover-title-size={titleSize}>{page.title}</h1>
          {page.subtitle && <p className="xhs-mnk-standfirst">{page.subtitle}</p>}
        </div>
        <div className="xhs-cover-foot xhs-mnk-cover-foot">
          <span>{author}</span>
          <span>{pad2(1)} / {pad2(total)}</span>
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
  if (template === 'kunlun') {
    return (
      <>
        <div className="xhs-kunlun-head"><span>{articleTitle}</span></div>
        <div className="xhs-card-content xhs-kunlun-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-kunlun-foot">
          <span>{author}</span>
          <span>[ {pad2(pageNo)} / {pad2(total)} ]</span>
        </div>
      </>
    )
  }
  if (template === 'rift') {
    return (
      <>
        <div className="xhs-rift-head"><span>{articleTitle}</span></div>
        <div className="xhs-card-content xhs-rift-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-rift-foot">
          <span>{author}</span>
          <span>{pad2(pageNo)} / {pad2(total)}</span>
        </div>
      </>
    )
  }
  if (template === 'core') {
    return (
      <>
        <div className="xhs-core-head"><CoreBar label={articleTitle} /></div>
        <div className="xhs-card-content xhs-core-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-core-foot"><span>{author}</span><span>{pad2(pageNo)} / {pad2(total)}</span></div>
      </>
    )
  }
  if (template === 'aozora') {
    return (
      <>
        <div className="xhs-card-content xhs-aozora-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-aozora-foot">
          <span>{author}</span>
          <span>{pad2(pageNo)} / {pad2(total)}</span>
        </div>
      </>
    )
  }
  if (template === 'kihon') {
    return (
      <>
        <div className="xhs-card-content xhs-kihon-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <KihonFolio page={pageNo} total={total} />
      </>
    )
  }
  if (template === 'mayonaka') {
    return (
      <>
        <div className="xhs-mnk-head"><span>{articleTitle}</span></div>
        <div className="xhs-card-content xhs-mnk-content" dangerouslySetInnerHTML={{ __html: page.html }} />
        <div className="xhs-card-foot xhs-mnk-foot">
          <span>{author}</span>
          <span>{pad2(pageNo)} / {pad2(total)}</span>
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
  const dark = isDarkVariant(template, bg)
  const accent = cardAccent(template, bg, themeAccent || BRAND_ACCENT)
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
      const constrained = getComputedStyle(copy).position === 'absolute' ||
        copy.classList.contains('xhs-cover-copy-constrained')
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
                      ...background(template, bg, accent, page.kind),
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
})

export default CardsView