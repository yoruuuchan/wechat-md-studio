import { contentHash } from './content-hash'
import { SAMPLE_DOC } from './sample'
import { uid, type DocRecord } from './store'
import { t } from './i18n'

/**
 * The login merge: local cache ⨝ cloud metadata, planned as pure data.
 *
 * This is the piece that used to be missing — cloud data arriving used to
 * simply replace the local set, so an article written before logging in
 * vanished the moment the account had anything in it. The rules here are the
 * data-safety contract:
 *
 *   - a local-only article is kept and queued for upload (working copy);
 *   - a cloud-only article is kept as a metadata stub, fetched when opened;
 *   - same id, same content merges silently;
 *   - same id, different content is a divergence: the cloud version keeps the
 *     id and the local version is re-homed under a new id and archived, so
 *     neither side is ever dropped without trace;
 *   - an article trashed in the cloud is "present, just not live" and is left
 *     exactly as the browser had it.
 *
 * Nothing here touches the network or React: useDocs feeds it the cache and
 * the (complete) cloud metadata, then performs the plan.
 */

/** Per-article metadata from `docs.list` — no `content` by design. */
export interface RemoteDocMeta {
  id: string
  name: string
  updatedAt: number
  savedAt: number | null
  source: string | null
  /** Concurrency token; null only on rows older than the column (pre-migration). */
  hash: string | null
}

export interface MergeInput {
  /** Live articles from the local cache; each carries a real body. */
  local: DocRecord[]
  /** The complete cloud metadata, all pages, as fetched for this merge. */
  remote: RemoteDocMeta[]
  /** Ids sitting in the cloud recycle bin (present remotely, just not live). */
  trashedIds?: Set<string>
}

export interface MergePlan {
  /** The merged working set, ready to become `docs` state. */
  docs: DocRecord[]
  /** Local-only articles to push into the cloud as working copies. */
  toImport: DocRecord[]
  /** Diverged local versions, re-homed and to be archived so they are findable. */
  toArchive: DocRecord[]
  /**
   * Ids whose cached body is a local edit on top of the current cloud version.
   * Their content must be left unmarked as "saved" so the autosave pushes it;
   * everything else in `docs` is clean as of this merge.
   */
  unsynced: string[]
  /** Lines for the notice toast; empty when the merge was uneventful. */
  notices: string[]
}

const COPY_SUFFIX_KEY = 'mcp.version.local'

/** Name for a kept local divergence, within the server's 200-char limit. */
export function conflictCopyName(name: string): string {
  const suffix = t(COPY_SUFFIX_KEY)
  return t('merge.copyName', { name: (name || t('common.unnamedDoc')).slice(0, 200 - suffix.length) })
}

function stubOf(meta: RemoteDocMeta): DocRecord {
  return {
    id: meta.id,
    name: meta.name,
    content: '',
    updatedAt: meta.updatedAt,
    savedAt: meta.savedAt,
    deletedAt: null,
    source: meta.source,
    baseHash: meta.hash,
    contentLoaded: false,
  }
}

function metaFields(meta: RemoteDocMeta) {
  return {
    name: meta.name,
    updatedAt: meta.updatedAt,
    savedAt: meta.savedAt,
    source: meta.source,
  }
}

export async function planMerge(input: MergeInput): Promise<MergePlan> {
  const remoteById = new Map(input.remote.map((r) => [r.id, r]))
  const trashed = input.trashedIds ?? new Set<string>()
  const toImport: DocRecord[] = []
  const toArchive: DocRecord[] = []
  const unsynced: string[] = []
  const notices: string[] = []
  const localOnly: DocRecord[] = []
  const remoteDocs: DocRecord[] = []

  for (const meta of input.remote) {
    const cached = input.local.find((d) => d.id === meta.id)
    if (!cached) {
      remoteDocs.push(stubOf(meta))
      continue
    }

    const sameContent = meta.hash !== null && (await contentHash(cached.content)) === meta.hash
    if (sameContent) {
      // Same text on both sides — adopt the cache (no fetch needed) and take
      // the cloud's metadata as truth.
      remoteDocs.push({ ...cached, ...metaFields(meta), contentLoaded: true, baseHash: meta.hash })
      continue
    }

    if (cached.baseHash && cached.baseHash === meta.hash) {
      // The cloud still holds the version this browser last synced with, so
      // the cache is one local (unsaved) edit ahead — not a divergence. Keep
      // the edit; the autosave will push it against this base.
      remoteDocs.push({ ...cached, ...metaFields(meta), contentLoaded: true, baseHash: meta.hash })
      unsynced.push(meta.id)
      continue
    }

    // Diverged: both sides changed on their own. The cloud version keeps the
    // id; the local version is preserved under a fresh id and archived, and
    // the owner is told — nothing is dropped quietly.
    remoteDocs.push(stubOf(meta))
    const copy: DocRecord = {
      id: uid(),
      name: conflictCopyName(cached.name),
      content: cached.content,
      updatedAt: cached.updatedAt,
      savedAt: null,
      deletedAt: null,
      source: cached.source ?? null,
      baseHash: null,
      contentLoaded: true,
    }
    toArchive.push(copy)
    remoteDocs.push(copy)
    notices.push(t('merge.diverged', { name: cached.name || t('common.unnamedDoc'), copy: copy.name }))
  }

  for (const d of input.local) {
    if (remoteById.has(d.id)) continue
    if (trashed.has(d.id)) {
      // Alive here, in the cloud's bin there: leave the browser's copy exactly
      // as it is — neither resurrected into the live list nor dropped.
      localOnly.push(d)
      continue
    }
    // The pristine sample is app-seeded, re-creatable with one click, and would
    // only be noise in the account; anything the owner actually wrote — even an
    // edited sample — is their work and gets synced.
    if (d.content === SAMPLE_DOC) {
      localOnly.push(d)
      continue
    }
    toImport.push(d)
    localOnly.push(d)
    if (d.savedAt !== null) {
      // It was archived once, yet the cloud no longer has it (purged on another
      // device). Coming back as an unarchived working copy keeps the text alive
      // without pretending it is still in the drafts box.
      notices.push(t('merge.cloudGone', { name: d.name || t('common.unnamedDoc') }))
    }
  }

  return {
    docs: [...localOnly, ...remoteDocs],
    toImport,
    toArchive,
    unsynced,
    notices,
  }
}
