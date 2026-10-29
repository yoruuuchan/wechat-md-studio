import type { DocRecord } from './store'

export type SavedVersion = Pick<DocRecord, 'name' | 'content'>
export interface LocalSaveReceipt extends DocRecord {
  at: number | null
}

export interface ArticleSaveStatus {
  id: string
  local: 'loading' | 'saving' | 'saved' | 'error'
  localSavedAt: number | null
  cloud: 'signed-out' | 'unarchived' | 'loading' | 'pending' | 'saving' | 'synced' | 'conflict' | 'error'
  recovery?: DocRecord['recovery']
}

export function sameSavedVersion(a: SavedVersion | undefined, b: SavedVersion): boolean {
  return a?.name === b.name && a.content === b.content
}

export function sameLocalReceipt(a: LocalSaveReceipt | undefined, b: DocRecord): boolean {
  return Boolean(a && a.id === b.id && sameSavedVersion(a, b) &&
    a.updatedAt === b.updatedAt && a.localRevision === b.localRevision &&
    a.savedAt === b.savedAt && a.deletedAt === b.deletedAt &&
    (a.baseHash ?? null) === (b.baseHash ?? null) && (a.source ?? null) === (b.source ?? null) &&
    (a.contentLoaded !== false) === (b.contentLoaded !== false) && a.bodyState === b.bodyState &&
    a.recovery?.kind === b.recovery?.kind && a.recovery?.at === b.recovery?.at &&
    JSON.stringify(a.remoteMcp ?? null) === JSON.stringify(b.remoteMcp ?? null))
}

/** Derive status for one article; a different article's request is never proof. */
export function articleSaveStatus(input: {
  doc: DocRecord
  enabled: boolean
  settled: boolean
  localReceipt?: LocalSaveReceipt
  localFailed: boolean
  cloudVersion?: SavedVersion
  cloudSaving: boolean
  cloudFailed: boolean
  cloudLoadFailed: boolean
  conflict: boolean
}): ArticleSaveStatus {
  const { doc } = input
  const readable = doc.contentLoaded !== false
  const stored = readable && sameLocalReceipt(input.localReceipt, doc)
  const local = !readable
    ? doc.bodyState === 'read-failed' || doc.bodyState === 'missing' ? 'error' : 'loading'
    : stored ? 'saved' : input.localFailed ? 'error' : 'saving'
  let cloud: ArticleSaveStatus['cloud']
  if (!input.enabled) cloud = 'signed-out'
  else if (input.conflict) cloud = 'conflict'
  else if (input.cloudSaving) cloud = 'saving'
  else if (doc.savedAt !== null && sameSavedVersion(input.cloudVersion, doc)) cloud = 'synced'
  else if (input.cloudFailed) cloud = 'error'
  else if (doc.savedAt === null) cloud = 'unarchived'
  else if (input.cloudLoadFailed) cloud = 'error'
  else if (!input.settled || !readable) cloud = 'loading'
  else cloud = 'pending'
  return {
    id: doc.id,
    local,
    localSavedAt: stored ? input.localReceipt?.at ?? null : null,
    cloud,
    recovery: doc.recovery,
  }
}
