import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, forwardRef, type ClipboardEvent } from 'react'
import { toast } from 'sonner'
import type { RenderStats } from '@/lib/types'
import { fillBlockOffsets } from '@/lib/sync-scroll'
import { serializeWechatSelection } from '@/lib/selection-copy'
import type { PreviewScrollHandle } from '@/hooks/useSyncScroll'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  html: string
  stats: RenderStats
  width: 375 | 677
  onWidthChange: (w: 375 | 677) => void
  /** From renderDoc: which top-level child of the root section each block starts at. */
  blockOffsets: number[]
  /** Called on every scroll of the preview; the page forwards it to sync. */
  onScroll?: () => void
  /**
   * Called when the rendered article changed height on its own — a late image,
   * or the paper being switched between 375 and 677 so the text reflows. The
   * page re-anchors scroll sync on it.
   */
  onLayout?: () => void
}

// 预览 DOM 即复制 DOM：dangerouslySetInnerHTML 渲染的就是复制出去的同一字符串。
// 同步滚动因此不能往输出里塞 id/class 锚点（两者都是公众号红线），改成由
// renderDoc 给出「第 i 个 block 落在第几个顶层子元素」，在这里量像素位置。
const PreviewPane = forwardRef<PreviewScrollHandle, Props>(function PreviewPane(
  { html, stats, width, onWidthChange, blockOffsets, onScroll, onLayout },
  ref,
) {
  const { t } = useI18n()
  const article = useMemo(() => ({ __html: html }), [html])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  const onLayoutRef = useRef(onLayout)
  onLayoutRef.current = onLayout

  // Copying part of the preview is a normal Ctrl/Cmd+C away: the browser's own
  // serialization drops every ancestor above the range's common ancestor, so
  // deep selections lose their inline styling (see lib/selection-copy.ts).
  // This event only fires for selections made inside this box; when the
  // serializer declines the selection we return without touching the event and
  // the browser copies exactly as it always did.
  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const root = contentRef.current?.firstElementChild
    if (!root) return
    const payload = serializeWechatSelection(root, window.getSelection())
    if (!payload) return
    event.preventDefault()
    event.clipboardData.setData('text/html', payload.html)
    event.clipboardData.setData('text/plain', payload.plainText)
    toast.success(t('preview.copiedSelection'))
  }, [t])

  // Measuring every block on every scroll event would read layout hundreds of
  // times a second. Cache the offsets and drop the cache when anything that can
  // move them changes — new HTML, a different paper width, or a late-loading
  // image resizing the content (caught by the ResizeObserver below).
  const topsRef = useRef<number[] | null>(null)
  const offsetsRef = useRef(blockOffsets)
  offsetsRef.current = blockOffsets

  useEffect(() => {
    topsRef.current = null
  }, [html, width, blockOffsets])

  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The cached pixel tops are measured, so a content box that changed size
    // invalidates them — and the panes have to be put back in step, because an
    // image that arrived late moved everything below it.
    const ro = new ResizeObserver(() => {
      topsRef.current = null
      onLayoutRef.current?.()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const measure = useCallback((): number[] => {
    if (topsRef.current) return topsRef.current
    const scroller = scrollerRef.current
    const root = contentRef.current?.firstElementChild
    if (!scroller || !root || root.children.length === 0) return []
    const children = root.children
    // Distance from the top of the scrollable content, independent of where the
    // pane happens to be scrolled right now.
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop
    const last = children.length - 1
    topsRef.current = fillBlockOffsets(offsetsRef.current).map((o) => {
      const el = children[Math.min(Math.max(o, 0), last)]
      return el ? el.getBoundingClientRect().top - base : 0
    })
    return topsRef.current
  }, [])

  useImperativeHandle(ref, () => ({
    getTopBlock: () => {
      const scroller = scrollerRef.current
      if (!scroller) return null
      const tops = measure()
      if (!tops.length) return null
      const y = scroller.scrollTop
      let index = 0
      for (let i = 0; i < tops.length; i++) {
        // +1px so a block sitting exactly at the seam counts as the current one.
        if (tops[i] <= y + 1) index = i
        else break
      }
      const next = tops[index + 1]
      const span = next === undefined ? 0 : next - tops[index]
      const frac = span > 0 ? Math.min(1, Math.max(0, (y - tops[index]) / span)) : 0
      return { index, frac }
    },
    scrollToBlock: (index: number, frac: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const tops = measure()
      if (!tops.length) return
      const i = Math.min(Math.max(index, 0), tops.length - 1)
      const next = tops[i + 1]
      const span = next === undefined ? 0 : next - tops[i]
      const target = tops[i] + Math.min(1, Math.max(0, frac)) * span
      // Already there: writing would only bounce a scroll event back at the pane
      // this position was read from.
      if (Math.abs(scroller.scrollTop - target) < 1) return
      scroller.scrollTop = target
    },
    getScroll: () => {
      const scroller = scrollerRef.current
      if (!scroller) return null
      return {
        top: scroller.scrollTop,
        max: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      }
    },
    setScroll: (top: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      if (Math.abs(scroller.scrollTop - top) < 1) return
      scroller.scrollTop = top
    },
  }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line-1 px-4">
        <span className="ya-eyebrow">{t('preview.label')}</span>
        <div className="flex items-center gap-2">
          {/* 分段选择：凹陷轨道 + 选中项 1.5px primary 描边，不用实心底色 */}
          <div className="flex items-center rounded-xl bg-surface-sunken p-0.5" style={{ boxShadow: 'var(--shadow-inset)' }}>
            {([375, 677] as const).map((w) => (
              <button
                key={w}
                onClick={() => onWidthChange(w)}
                className={`rounded-[10px] px-2.5 py-0.5 text-[11px] tabular-nums transition-all ${
                  width === w ? 'bg-surface-surface text-ink-1' : 'text-ink-3 hover:text-ink-1'
                }`}
                style={width === w ? { boxShadow: 'inset 0 0 0 1.5px var(--primary-500)' } : undefined}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 预览区是一口凹陷的井：纸张浮在井里，页面本身是 carrier */}
      <div
        ref={scrollerRef}
        onScroll={() => onScrollRef.current?.()}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ background: 'var(--bg-sunken)', boxShadow: 'var(--shadow-inset)' }}
      >
        <div className="flex justify-center px-4 py-6">
          <div
            className="shrink-0 rounded-[4px] bg-white transition-all duration-300"
            style={{ width, boxShadow: 'var(--shadow-lifted)' }}
          >
            <div ref={contentRef} className="px-1 py-6" onCopy={handleCopy} dangerouslySetInnerHTML={article} />
          </div>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line-1 px-4 text-[11px] text-ink-3">
        <span className={stats.warnings.length ? 'text-warning-700' : ''}>
          {stats.warnings.length
            ? t('preview.warnings', { n: stats.warnings.length, first: stats.warnings[0] })
            : t('preview.clean')}
        </span>
        <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
          {t('preview.chars', { n: stats.chars })} · {t('preview.images', { n: stats.images })}
          {stats.carousels ? ` · ${t('preview.carousels', { n: stats.carousels })}` : ''}
          {stats.galleries ? ` · ${t('preview.galleries', { n: stats.galleries })}` : ''}
        </span>
      </div>
    </div>
  )
})

export default PreviewPane
