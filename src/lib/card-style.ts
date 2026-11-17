// Adapted from https://github.com/woodti/mopai (MIT); see LICENSES/woodti-mopai-LICENSE.txt.
import type { CSSProperties } from 'react'
import { cardMetrics, type CardBackground, type CardTemplateId } from './cards'

// The brand accent stays the same when the application's UI theme changes.
export const BRAND_ACCENT = '#4F6CE8'

/** Reed's five paint jobs; uploaded templates carry their own background in CSS. */
export function cardBackground(id: CardBackground, accent: string): CSSProperties {
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

/** The inline style of one `.xhs-card`: size, accent, metrics and (built-in) paint. */
export function cardFrameStyle(options: {
  template: CardTemplateId
  background: CardBackground
  accent: string
  height: number
  width: number
  /** Uploaded and public templates paint their own background. */
  custom: boolean
  vars?: Readonly<Record<string, string>>
}): CSSProperties {
  const metrics = cardMetrics(options.template)
  return {
    width: options.width, height: options.height, '--xhs-accent': options.accent,
    '--xhs-pad-x': `${metrics.padX}px`,
    '--xhs-pad-top': `${metrics.padTop}px`,
    '--xhs-pad-bottom': `${metrics.padBottom}px`,
    '--xhs-content-w': `${metrics.contentWidth}px`,
    '--xhs-header-top': `${metrics.headerTop}px`,
    '--xhs-footer-bottom': `${metrics.footerBottom}px`,
    '--xhs-cover-inset-x': `${metrics.coverInsetX}px`,
    '--xhs-cover-inset-y': `${metrics.coverInsetY}px`,
    '--xhs-cover-foot-bottom': `${metrics.coverFootBottom}px`,
    ...(options.custom ? {} : cardBackground(options.background, options.accent)),
    ...options.vars,
  } as CSSProperties
}
