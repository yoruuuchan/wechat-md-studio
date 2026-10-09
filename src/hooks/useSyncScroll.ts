import { useCallback, useEffect, useRef } from 'react'
import {
  blockIndexAtLine,
  fractionInSpan,
  lineAtProgress,
  pointInSpan,
  progressInBlock,
  rangeOf,
} from '@/lib/sync-scroll'

/** One pane's scroll position and how far it can still go. */
export interface ScrollExtent {
  top: number
  max: number
}

/** What the editor pane must offer for scroll sync to drive it. */
export interface EditorScrollHandle {
  /** 0-based source line at the top of the viewport. Null before the view exists. */
  getTopLine(): number | null
  /** Pixel offset, from the top of the document, where a source line starts. */
  lineTop(line: number): number | null
  /** Put a source line at the top of the viewport, for a pane with no pixels yet. */
  scrollToLine(line: number): void
  getScroll(): ScrollExtent | null
  setScroll(top: number): void
}

/** What the preview pane must offer for scroll sync to drive it. */
export interface PreviewScrollHandle {
  /** Index of the block at the top of the viewport, and how far through it. */
  getTopBlock(): { index: number; frac: number } | null
  scrollToBlock(index: number, frac: number): void
  getScroll(): ScrollExtent | null
  setScroll(top: number): void
}

/** Which pane a translation reads from. */
export type SyncSource = 'editor' | 'preview'

interface Options {
  enabled: boolean
  blocks: { line: number; lineEnd?: number }[]
  editorRef: React.RefObject<EditorScrollHandle | null>
  previewRef: React.RefObject<PreviewScrollHandle | null>
}

/**
 * A scroll ends once neither pane has moved for this long, and the pane that
 * started it stops owning the sync. Short enough that deliberately grabbing the
 * other pane right afterwards still works, long enough to swallow the echo of our
 * own programmatic scroll.
 */
const IDLE_MS = 110

/**
 * A layout change arrives as a burst: a window drag re-wraps the editor every
 * frame, the paper's 300ms width animation reflows the preview continuously, and
 * a keystroke re-renders the preview. Waiting for the burst to stop before
 * re-anchoring keeps the panes from being chased frame by frame, and keeps each
 * keystroke from re-measuring every block of a long article. Scrolling still
 * syncs every frame; this is only the safety net under it.
 */
const LAYOUT_SETTLE_MS = 180

/**
 * Two-way scroll sync.
 *
 * The panes own their scroll listeners and call the returned handlers; this hook
 * only decides which direction is active and does the translation. Ownership
 * matters because scrolling one pane scrolls the other, which fires its scroll
 * event, which would scroll the first one back — an oscillation that shows up as
 * the preview jittering and refusing to settle.
 *
 * A block is located by *position*, not by line number: the editor measures how
 * far the viewport top sits between the pixel tops of the block's first and last
 * line, the preview measures the same thing between its element tops, and the
 * preview is placed at the fraction it is handed. Counting source lines instead
 * mixed two rulers that disagree by however much the editor wrapped, and a
 * narrow window changes exactly that.
 *
 * `onLayoutChange` re-runs the translation when something moved the furniture
 * without anyone scrolling: a pane was resized and the text rewrapped, or the
 * preview's content changed height under a late image. The source is the pane
 * that did *not* reflow — the preview's paper width is fixed, so after a resize
 * it is the one still pointing at the same content.
 */
export function useSyncScroll({ enabled, blocks, editorRef, previewRef }: Options) {
  const owner = useRef<SyncSource | null>(null)
  const idleTimer = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  const layoutTimer = useRef<number | null>(null)
  // Read inside the rAF callback, so the mapping is always the one that matches
  // the document currently on screen rather than the one captured on subscribe.
  const blocksRef = useRef(blocks)
  useEffect(() => {
    blocksRef.current = blocks
  }, [blocks])

  useEffect(() => {
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      if (layoutTimer.current) window.clearTimeout(layoutTimer.current)
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [])

  const take = useCallback(
    (from: SyncSource, run: () => void) => {
      if (!enabled) return
      // An event from the other pane is our own scroll coming back; drop it.
      if (owner.current && owner.current !== from) return
      owner.current = from
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => {
        owner.current = null
      }, IDLE_MS)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        run()
      })
    },
    [enabled],
  )

  /** Editor → preview: the block under the editor's viewport top leads. */
  const editorToPreview = useCallback(() => {
    const editor = editorRef.current
    const preview = previewRef.current
    if (!editor || !preview) return
    const from = editor.getScroll()
    const to = preview.getScroll()
    if (!from || !to) return
    // The whitespace above the first block and below the last belongs to no
    // block, so block mapping alone never reaches either end of the preview.
    if (from.top <= 0) return preview.setScroll(0)
    if (from.max - from.top <= 1) return preview.setScroll(to.max)
    const line = editor.getTopLine()
    if (line === null) return
    const blocks = blocksRef.current
    const index = blockIndexAtLine(blocks, line)
    // -1 means the top line is above the first block: front matter, or the note
    // the editor keeps at the top of the file. That region is not rendered, and
    // the pane showing it is by definition showing the top of the article.
    if (index < 0) return preview.setScroll(0)
    const { start, end } = rangeOf(blocks, index)
    const startPx = editor.lineTop(start)
    const endPx = editor.lineTop(end)
    // Line-based progress is the fallback for a pane that cannot report pixels
    // (no view yet); it is coarser, but it still lands inside the right block.
    const frac =
      startPx === null || endPx === null
        ? progressInBlock(blocks, index, line)
        : fractionInSpan(from.top, startPx, endPx)
    preview.scrollToBlock(index, frac)
  }, [editorRef, previewRef])

  /** Preview → editor: the block under the preview's viewport top leads. */
  const previewToEditor = useCallback(() => {
    const editor = editorRef.current
    const preview = previewRef.current
    if (!editor || !preview) return
    const from = preview.getScroll()
    const to = editor.getScroll()
    if (!from || !to) return
    if (from.top <= 0) return editor.setScroll(0)
    if (from.max - from.top <= 1) return editor.setScroll(to.max)
    const top = preview.getTopBlock()
    if (!top) return
    const blocks = blocksRef.current
    const { start, end } = rangeOf(blocks, top.index)
    const startPx = editor.lineTop(start)
    const endPx = editor.lineTop(end)
    if (startPx === null || endPx === null) {
      return editor.scrollToLine(lineAtProgress(blocks, top.index, top.frac))
    }
    // The exact pixel, not the line it falls on: quantising here made the editor
    // snap to line tops, which the preview then echoed back as a jump.
    editor.setScroll(pointInSpan(top.frac, startPx, endPx))
  }, [editorRef, previewRef])

  const onEditorScroll = useCallback(() => {
    take('editor', editorToPreview)
  }, [take, editorToPreview])

  const onPreviewScroll = useCallback(() => {
    take('preview', previewToEditor)
  }, [take, previewToEditor])

  /**
   * Re-align after a layout change. `source` is the pane whose position is still
   * meaningful — pass 'preview' when the editor rewrapped, 'editor' when the
   * preview's own content changed height.
   */
  const onLayoutChange = useCallback(
    (source: SyncSource) => {
      if (!enabled) return
      if (layoutTimer.current) window.clearTimeout(layoutTimer.current)
      layoutTimer.current = window.setTimeout(() => {
        layoutTimer.current = null
        take(source, source === 'editor' ? editorToPreview : previewToEditor)
      }, LAYOUT_SETTLE_MS)
    },
    [enabled, take, editorToPreview, previewToEditor],
  )

  return { onEditorScroll, onPreviewScroll, onLayoutChange }
}
