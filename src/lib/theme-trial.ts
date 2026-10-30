/**
 * Pick the article the theme library may trial without weakening the editor's
 * body rules: a stub, a failed read, a missing body and an intentionally empty
 * article are four different states, and none of them may be rendered as if it
 * were the author's text.
 */
import type { Loaded } from './store'

export type TrialArticleReason =
  | 'none'
  | 'deleted'
  | 'read-failed'
  | 'stub'
  | 'missing'
  | 'empty'
  | 'failed'

export interface TrialArticleResult {
  status: 'ready' | 'empty' | 'unavailable'
  reason: TrialArticleReason
  id: string | null
  name: string | null
  /** Only present when status is ready. */
  content: string
}

const UNAVAILABLE = (reason: TrialArticleReason, id: string | null = null, name: string | null = null): TrialArticleResult => ({
  status: 'unavailable',
  reason,
  id,
  name,
  content: '',
})

/**
 * The active article wins. If the index has no active id, the first live article
 * is a reasonable fallback: the editor would open it next anyway. A deleted
 * record is reported as deleted, not silently skipped to another article.
 */
export function pickTrialArticle(loaded: Loaded, activeId: string): TrialArticleResult {
  if (loaded.bodyReadFailed) return UNAVAILABLE('read-failed')

  const byActive = activeId ? loaded.docs.find((doc) => doc.id === activeId) : undefined
  const doc = byActive ?? loaded.docs.find((candidate) => !candidate.deletedAt)
  if (!doc) return UNAVAILABLE('none')
  if (doc.deletedAt) return UNAVAILABLE('deleted', doc.id, doc.name)

  if (doc.contentLoaded === false) {
    const reason: TrialArticleReason =
      doc.bodyState === 'stub' ? 'stub' : doc.bodyState === 'missing' ? 'missing' : 'read-failed'
    return UNAVAILABLE(reason, doc.id, doc.name)
  }

  if (!doc.content.trim()) {
    return { status: 'empty', reason: 'empty', id: doc.id, name: doc.name, content: '' }
  }

  return { status: 'ready', reason: 'none', id: doc.id, name: doc.name, content: doc.content }
}