import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseMarkdown } from '@/lib/parse'
import { THEME_PREVIEW_DOC } from '@/lib/sample'
import { loadActiveId, loadDocs } from '@/lib/store'
import { pickTrialArticle, type TrialArticleReason, type TrialArticleResult } from '@/lib/theme-trial'
import type { ThemePreviewSource } from '@/lib/theme-library-state'

export type ParsedTrialDoc = ReturnType<typeof parseMarkdown>

export interface TrialArticleState {
  /** What the user asked for. */
  source: ThemePreviewSource
  /** What the preview can actually show right now. */
  effectiveSource: ThemePreviewSource
  status: 'sample' | 'loading' | 'ready' | 'empty' | 'unavailable'
  reason: TrialArticleReason | null
  name: string | null
  doc: ParsedTrialDoc
  retry: () => void
}

/**
 * Current-article body for the theme library, read only on demand.
 *
 * Reading uses the same local store the editor uses, so a failed body read stays
 * a failed read instead of becoming an empty article. While the read is in
 * flight the hook exposes the standard sample for layout, but `status` tells the
 * caller not to present that as the current article.
 */
export function useTrialArticle(source: ThemePreviewSource): TrialArticleState {
  const sampleDoc = useMemo(() => parseMarkdown(THEME_PREVIEW_DOC), [])
  const [result, setResult] = useState<TrialArticleResult | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (source !== 'current' || result) return
    let alive = true
    loadDocs({ trackBase: false })
      .then((loaded) => {
        if (!alive) return
        const activeId = loadActiveId() || loaded.activeId
        setResult(pickTrialArticle(loaded, activeId))
      })
      .catch(() => {
        if (!alive) return
        setResult({ status: 'unavailable', reason: 'failed', id: null, name: null, content: '' })
      })
    return () => {
      alive = false
    }
  }, [source, result, attempt])

  const retry = useCallback(() => {
    setResult(null)
    setAttempt((n) => n + 1)
  }, [])

  const ready = result?.status === 'ready'
  const currentDoc = useMemo(
    () => (ready && result ? parseMarkdown(result.content) : null),
    [ready, result],
  )

  if (source === 'sample') {
    return {
      source,
      effectiveSource: 'sample',
      status: 'sample',
      reason: null,
      name: null,
      doc: sampleDoc,
      retry,
    }
  }

  if (!result) {
    return {
      source,
      effectiveSource: 'sample',
      status: 'loading',
      reason: null,
      name: null,
      doc: sampleDoc,
      retry,
    }
  }

  return {
    source,
    effectiveSource: ready ? 'current' : 'sample',
    status: result.status,
    reason: result.reason,
    name: result.name,
    doc: currentDoc ?? sampleDoc,
    retry,
  }
}