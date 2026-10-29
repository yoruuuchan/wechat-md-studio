import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Theme } from '@/lib/theme-kit'
import type { ThemeCatalogEntry } from '@/lib/theme-meta'
import { getCachedTheme, loadTheme } from '@/lib/theme-api'
import type { MathSnapshot } from '@/lib/math'
import type { DiagramCache } from '@/lib/diagram'
import { renderDoc } from '@/lib/render'
import { resolveImgSrc } from '@/lib/image'
import type { SignatureConfig } from '@/lib/types'
import type { ParsedTrialDoc } from '@/hooks/useTrialArticle'
import { useI18n } from '@/hooks/useI18n'

type Sig = SignatureConfig

/**
 * A full article rendered by the same `renderDoc` the editor preview uses.
 *
 * The HTML is not a lookalike: it goes through the same resolver for `img:`
 * references, the same MathJax snapshot and the same diagram cache, so a trial
 * can be compared byte-for-byte with the editor preview. Only the presentation
 * width is scaled here (375px phone width → the column).
 */
export function ThemeTrialPreview({
  theme,
  doc,
  sig,
  math,
  diagrams,
}: {
  theme: ThemeCatalogEntry
  doc: ParsedTrialDoc
  sig: Sig
  math: MathSnapshot
  diagrams: DiagramCache
}) {
  const { t } = useI18n()
  const boxRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [contentHeight, setContentHeight] = useState(0)
  const [loadedImpl, setLoadedImpl] = useState<Theme | null>(null)
  const impl = loadedImpl ?? getCachedTheme(theme.id)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / 375)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (impl) return
    let alive = true
    loadTheme(theme.id)
      .then((loaded) => {
        if (alive) setLoadedImpl(loaded)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [theme.id, attempt, impl])

  // The rendered HTML depends on the math cache identity: when a formula lands,
  // this re-renders with the real SVG, exactly like the editor does.
  const html = useMemo(() => {
    if (!impl) return null
    return renderDoc(
      doc,
      impl,
      sig,
      resolveImgSrc,
      (tex, display) => math.get(tex, display),
      (code) => diagrams.get(code) ?? null,
    ).html
  }, [impl, doc, sig, math, diagrams])

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const update = () => setContentHeight(el.scrollHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [html])

  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden"
      data-theme-trial={theme.id}
      data-theme-trial-state={html ? 'rendered' : error ? 'error' : 'loading'}
      style={{ height: html && contentHeight ? contentHeight * scale : 220 }}
    >
      {html ? (
        <div
          ref={innerRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: 375, transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] leading-relaxed text-ink-3">
          {error ? (
            <button
              type="button"
              className="ya-link-btn"
              onClick={() => {
                setError(false)
                setAttempt((n) => n + 1)
              }}
            >
              {t('themes.compare.previewFailed')} · {t('common.retry')}
            </button>
          ) : (
            t('themes.compare.loadingPreview')
          )}
        </div>
      )}
    </div>
  )
}