/**
 * Pure merge plan for local uploads and the owner's cloud archive.
 *
 * The manifest id is the identity shared by both devices. When the two sides
 * hold different bytes for one id, the later upload wins without a dialog:
 * compare the local record's upload time with the server's `uploadedAt`. A
 * local id missing from the cloud is pushed; a cloud id missing locally is
 * pulled.
 */
export interface LocalCardTemplateCandidate {
  /** Local record id (used to update the same IndexedDB record). */
  key: string
  /** manifest.id */
  id: string
  sha256: string
  updatedAt: number
}

export interface CloudCardTemplateCandidate {
  id: string
  sha256: string
  uploadedAt: number
}

export type CardTemplateSyncAction =
  | { kind: 'upload'; id: string; key: string }
  | { kind: 'download'; id: string }
  | { kind: 'keep'; id: string }

export function planCardTemplateSync(
  local: readonly LocalCardTemplateCandidate[],
  cloud: readonly CloudCardTemplateCandidate[],
): CardTemplateSyncAction[] {
  const localById = new Map<string, LocalCardTemplateCandidate>()
  for (const row of local) {
    const current = localById.get(row.id)
    if (!current || row.updatedAt > current.updatedAt) localById.set(row.id, row)
  }
  const cloudById = new Map(cloud.map((row) => [row.id, row]))
  const actions: CardTemplateSyncAction[] = []

  for (const [id, row] of localById) {
    const remote = cloudById.get(id)
    if (!remote) {
      actions.push({ kind: 'upload', id, key: row.key })
      continue
    }
    if (remote.sha256 === row.sha256) {
      actions.push({ kind: 'keep', id })
      continue
    }
    actions.push(remote.uploadedAt > row.updatedAt
      ? { kind: 'download', id }
      : { kind: 'upload', id, key: row.key })
  }

  for (const row of cloud) {
    if (!localById.has(row.id)) actions.push({ kind: 'download', id: row.id })
  }
  return actions
}