/**
 * Pure merge plan for local uploads and the owner's cloud archive.
 *
 * The manifest id is the identity shared by both devices. When the two sides
 * hold different bytes for one id, the later upload wins without a dialog. A
 * local copy the server has confirmed carries that server time
 * (`cloudUploadedAt`) and is compared with the server's `uploadedAt` only, so
 * a fast or slow device clock cannot make an old copy look newer. A copy that
 * was never confirmed has only its device time; that is the one comparison
 * where the two clocks meet, and it only decides between two uploads made
 * within the skew of each other.
 *
 * A tombstone changes only the "local id missing from the cloud" case. If this
 * device holds a version the server had confirmed at or before the delete, the
 * delete came from another device and this copy is removed. A copy that was
 * never uploaded has no server timestamp and is genuinely new on this device,
 * so it is uploaded and the server clears the tombstone. All tombstone
 * comparisons use server timestamps (`cloudUploadedAt` vs `deletedAt`); the
 * device clock is never compared with the server's.
 */
export interface LocalCardTemplateCandidate {
  /** Local record id (used to update the same IndexedDB record). */
  key: string
  /** manifest.id */
  id: string
  sha256: string
  updatedAt: number
  /** Server `uploadedAt` of the version this record holds, once confirmed. */
  cloudUploadedAt?: number
}

export interface CloudCardTemplateCandidate {
  id: string
  sha256: string
  uploadedAt: number
}

export interface CardTemplateTombstoneCandidate {
  id: string
  /** Server time in milliseconds. */
  deletedAt: number
}

export type CardTemplateSyncAction =
  | { kind: 'upload'; id: string; key: string }
  | { kind: 'download'; id: string }
  | { kind: 'keep'; id: string }
  | { kind: 'delete-local'; id: string; key: string }

export function planCardTemplateSync(
  local: readonly LocalCardTemplateCandidate[],
  cloud: readonly CloudCardTemplateCandidate[],
  tombstones: readonly CardTemplateTombstoneCandidate[] = [],
): CardTemplateSyncAction[] {
  const localById = new Map<string, LocalCardTemplateCandidate>()
  for (const row of local) {
    const current = localById.get(row.id)
    if (!current || row.updatedAt > current.updatedAt) localById.set(row.id, row)
  }
  const cloudById = new Map(cloud.map((row) => [row.id, row]))
  const tombstoneById = new Map(tombstones.map((row) => [row.id, row]))
  const actions: CardTemplateSyncAction[] = []

  for (const [id, row] of localById) {
    const remote = cloudById.get(id)
    if (!remote) {
      const tombstone = tombstoneById.get(id)
      if (tombstone && row.cloudUploadedAt !== undefined && row.cloudUploadedAt <= tombstone.deletedAt) {
        actions.push({ kind: 'delete-local', id, key: row.key })
        continue
      }
      actions.push({ kind: 'upload', id, key: row.key })
      continue
    }
    if (remote.sha256 === row.sha256) {
      actions.push({ kind: 'keep', id })
      continue
    }
    const cloudIsNewer = row.cloudUploadedAt !== undefined
      ? remote.uploadedAt > row.cloudUploadedAt
      : remote.uploadedAt > row.updatedAt
    actions.push(cloudIsNewer
      ? { kind: 'download', id }
      : { kind: 'upload', id, key: row.key })
  }

  for (const row of cloud) {
    if (!localById.has(row.id)) actions.push({ kind: 'download', id: row.id })
  }
  return actions
}