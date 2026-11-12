import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  CARD_RATIOS, CARD_WIDTH, cardAccent, cardTemplateCustomize, cardTemplateFonts, coverTitleSize,
  isDarkVariant, longTemplateCustomize, longTemplateFonts, longTemplateRuntime, type CardBackground,
} from '@/lib/cards'
import { fragmentHtml, getLoadedCardTemplate, getLoadedLongTemplate, renderTemplatePage } from '@/lib/card-template'
import { BRAND_ACCENT, cardFrameStyle } from '@/lib/card-style'
import { ensureFontSheets } from '@/lib/font-catalog'
import { renderLongArticle } from '@/lib/long-image-render'
import { parseMarkdown } from '@/lib/parse'
import { esc } from '@/lib/theme-kit'
import { useI18n } from '@/hooks/useI18n'
import { useResolvedTemplateCustom } from '@/hooks/useTemplateCustom'
import './cards.css'
import './long-image.css'

// A soft sky-and-hills picture so headers built around a cover image read
// as they would in use; data: images are allowed by the CSP.
const SAMPLE_COVER = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='600' viewBox='0 0 1080 600'>" +
  "<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#9ec5ef'/><stop offset='1' stop-color='#eaf2fb'/></linearGradient></defs>" +
  "<rect width='1080' height='600' fill='url(#s)'/>" +
  "<path d='M0 420Q270 330 540 400T1080 380V600H0Z' fill='#86b394'/>" +
  "<path d='M0 480Q300 420 600 470T1080 460V600H0Z' fill='#5f9270'/></svg>",
)}`

// The Markdown names a placeholder; the resolver swaps in the picture.
const COVER_REF = 'https://reed.invalid/sample-cover.svg'
const SIG = { layout: '', proof: '', review: '' }
const CARD_HEIGHT = CARD_RATIOS['3:4']

interface Props {
  kind: 'card' | 'long'
  template: string
  variant: string
}

function applyStyle(element: HTMLElement, style: CSSProperties): void {
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue
    if (key.startsWith('--')) element.style.setProperty(key, String(value))
    else (element.style as unknown as Record<string, string>)[key] = typeof value === 'number' ? `${value}px` : String(value)
  }
}

/**
 * Draw `node` inside a shadow root of the thumbnail box, scaled from 540px to
 * the box width. The shadow root keeps thumbnail cards and long roots out of
 * page-level queries (the preview and its checks look up `.xhs-card` and
 * `.reed-long-root`), and it gets copies of the page's stylesheets so the
 * template CSS and the app's base styles apply exactly as in the preview.
 * Webfonts declared on the page are usable inside it.
 */
function useShadowDrawing(draw: () => HTMLElement | null, deps: readonly unknown[]) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => setWidth(box.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const box = boxRef.current
    const node = draw()
    if (!box || !node || width <= 0) return
    const shadow = box.shadowRoot ?? box.attachShadow({ mode: 'open' })
    const sheets = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'), (sheet) => sheet.cloneNode(true))
    const stage = document.createElement('div')
    stage.style.cssText = `position:absolute;left:0;top:0;width:${CARD_WIDTH}px;transform-origin:0 0;transform:scale(${width / CARD_WIDTH})`
    stage.append(node)
    shadow.replaceChildren(...sheets, stage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, ...deps])
  return boxRef
}

/**
 * The top of a template, drawn by the real renderer with the same sample copy
 * for every template, so the picker compares looks rather than names. It
 * follows the reader's colour and font picks for that template.
 */
export default function TemplateThumb(props: Props) {
  return props.kind === 'long' ? <LongThumb {...props} /> : <CardThumb {...props} />
}

const BOX_CLASS = 'relative w-full overflow-hidden'
const BOX_STYLE: CSSProperties = { aspectRatio: '3 / 4' }

function CardThumb({ template, variant }: Props) {
  const { t, lang } = useI18n()
  const loaded = getLoadedCardTemplate(template)
  const background = variant as CardBackground
  const dark = isDarkVariant(template, background)
  const picks = useResolvedTemplateCustom(template, background, cardTemplateCustomize(template))
  const accent = cardAccent(template, background, BRAND_ACCENT)

  useEffect(() => {
    void ensureFontSheets([...cardTemplateFonts(template), ...picks.faces].map((face) => face.family))
  }, [template, picks.faces])

  const boxRef = useShadowDrawing(() => {
    const title = t('thumb.title')
    const subtitle = t('thumb.subtitle')
    const author = t('thumb.author')
    const card = document.createElement('div')
    card.className = 'xhs-card'
    card.dataset.template = loaded?.renderId ?? template
    card.dataset.variant = background
    card.dataset.night = String(dark)
    card.dataset.cardAspect = '3:4'
    card.dataset.cardKind = 'cover'
    if (loaded) card.dataset.cardTemplateSource = loaded.template
    applyStyle(card, cardFrameStyle({
      template, background, accent, height: CARD_HEIGHT, width: CARD_WIDTH, custom: Boolean(loaded), vars: picks.vars,
    }))
    if (loaded) {
      card.innerHTML = fragmentHtml(renderTemplatePage(loaded, {
        kind: 'cover', pageIndex: 0, total: 1, title, subtitle, author, articleTitle: title,
        contentHtml: '', height: CARD_HEIGHT, lang,
      }, background, dark))
    } else {
      // Reed's own cover, the same markup CardsView draws.
      const size = coverTitleSize(title, CARD_HEIGHT)
      card.innerHTML = `<div class="xhs-cover"><div class="xhs-cover-copy"><h1 style="font-size:${size}px" data-cover-title-size="${size}">${esc(title)}</h1><p>${esc(subtitle)}</p></div>` +
        `<div class="xhs-cover-foot"><span>${esc(author)}</span><span>${esc(t('cards.swipe'))}</span></div></div>`
    }
    return card
  }, [loaded, template, background, dark, accent, picks.key, lang, t])

  return <div ref={boxRef} className={BOX_CLASS} style={BOX_STYLE} aria-hidden="true" data-template-thumb={template} />
}

function LongThumb({ template, variant }: Props) {
  const { t, lang } = useI18n()
  const loaded = getLoadedLongTemplate(template)
  const dark = longTemplateRuntime(template)?.variants.find((item) => item.id === variant)?.dark ?? false
  const picks = useResolvedTemplateCustom(template, variant, longTemplateCustomize(template))
  const source = useMemo(() => [
    '---', `author: ${t('thumb.author')}`, '---', '',
    `# ${t('thumb.title')}`, '', t('thumb.subtitle'), '', `![](${COVER_REF})`, '',
    `## ${t('thumb.section')}`, '', `**${t('thumb.lead')}** ${t('thumb.body')}`, '', t('thumb.body2'), '', t('thumb.body'), '', t('thumb.body2'), '',
  ].join('\n'), [t])

  useEffect(() => {
    void ensureFontSheets([...longTemplateFonts(template), ...picks.faces].map((face) => face.family))
  }, [template, picks.faces])

  const boxRef = useShadowDrawing(() => {
    if (!loaded) return null
    return renderLongArticle(parseMarkdown(source), {
      source, lang, template,
      renderTemplate: loaded.renderId,
      templateSource: loaded.template,
      variant, dark,
      metrics: loaded.manifest.metrics,
      sig: SIG,
      resolveImage: (src) => (src === COVER_REF ? SAMPLE_COVER : src),
      resolveMath: () => null,
      resolveDiagram: () => null,
      customVars: picks.vars,
    }, loaded).root
  }, [loaded, source, lang, template, variant, dark, picks.key])

  return <div ref={boxRef} className={BOX_CLASS} style={BOX_STYLE} aria-hidden="true" data-template-thumb={template} />
}
