import type { MsgKey } from './i18n.zh'
import type { DocRecord } from './store'

/**
 * What the editor knows about the open article's body.
 *
 * `contentLoaded` and `bodyState` are the storage layer's facts; hydration and
 * session state explain why a body that is not here yet may still arrive. Every
 * editor surface that hands the article to the author — editing, rename, copy,
 * single-document Markdown / HTML export — reads this one value instead of
 * re-deriving "is `content` the article?" from a different subset of fields.
 */
export type BodyReadState =
  | 'ready'
  | 'loading'
  | 'load-failed'
  | 'read-failed'
  | 'missing'
  | 'unavailable'

export type BodyRetry = 'local' | 'cloud' | null

export interface BodyReadiness {
  state: BodyReadState
  /** True only when `doc.content` is the article itself. */
  readable: boolean
  /** Why the body cannot be edited, copied or exported; null when readable. */
  reasonKey: MsgKey | null
  /** Which retry actually re-reads the body; null when retrying would not help. */
  retry: BodyRetry
}

export interface BodyReadinessInput {
  doc: Pick<DocRecord, 'contentLoaded' | 'bodyState'> | null
  /** The account fetch for this article is in flight. */
  hydrating?: boolean
  /** The last account fetch for this article failed. */
  loadFailed?: boolean
  /** A session exists, so a cloud stub can still be fetched. */
  enabled?: boolean
  /** Authentication has not resolved yet; a stub is not "unavailable" until it does. */
  authPending?: boolean
}

const LOADING: BodyReadiness = {
  state: 'loading',
  readable: false,
  reasonKey: 'docs.bodyLoading',
  retry: null,
}

/**
 * Derive the one answer the UI needs. A stub is not an empty article:
 *
 *  - loaded records are the article, and `''` is an article the author emptied;
 *  - a stub is still on its way from the account — it is "loading" while the
 *    fetch is running or the session / merge has not settled, "load-failed"
 *    after a failed fetch (retry = cloud), and "unavailable" when there is no
 *    session left to fetch it after a logout;
 *  - `read-failed` / `missing` are local storage problems: retrying the local
 *    body store is the only thing that can bring the original back.
 */
export function bodyReadiness(input: BodyReadinessInput): BodyReadiness {
  const doc = input.doc
  if (!doc) return LOADING
  if (doc.contentLoaded !== false && doc.bodyState === undefined) {
    return { state: 'ready', readable: true, reasonKey: null, retry: null }
  }
  // Local storage failures can be retried without a session, so they keep
  // their own diagnosis even after a logout.
  if (doc.bodyState === 'read-failed') {
    return { state: 'read-failed', readable: false, reasonKey: 'docs.bodyReadFailed', retry: 'local' }
  }
  if (doc.bodyState === 'missing') {
    return { state: 'missing', readable: false, reasonKey: 'docs.bodyMissing', retry: 'local' }
  }
  if (input.hydrating) return LOADING
  // A stub (or a record that never said why it is unloaded) lives in the
  // account. Without a session it can no longer be fetched; while
  // authentication is still resolving that would be a premature verdict. This
  // deliberately outranks an earlier fetch failure: a retry needs the session.
  if (input.enabled === false && !input.authPending) {
    return { state: 'unavailable', readable: false, reasonKey: 'docs.bodyUnavailable', retry: null }
  }
  if (input.loadFailed) {
    return { state: 'load-failed', readable: false, reasonKey: 'docs.hydrateFailed', retry: 'cloud' }
  }
  return LOADING
}