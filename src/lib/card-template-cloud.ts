/**
 * Browser side of the owner-only card template archive.
 *
 * Same session cookie as the cloud drafts box. Every fetch uses
 * `credentials: 'include'`; a 401 means "not signed in" and is reported as
 * `unauthorized`, which the hook treats as "local only", never as a retry loop.
 */
import type { CardTemplateSourceRecord } from './card-template'

export interface CloudCardTemplateMeta {
  id: string
  name: string
  version: string
  sha256: string
  size: number
  uploadedAt: number
}

export interface CloudCardTemplateTombstone {
  id: string
  /** Server time in milliseconds. */
  deletedAt: number
}

export interface CloudCardTemplateList {
  items: CloudCardTemplateMeta[]
  tombstones: CloudCardTemplateTombstone[]
}

export class CardTemplateCloudError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'CardTemplateCloudError'
    this.status = status
    this.code = code
  }

  get unauthorized(): boolean {
    return this.status === 401
  }
}

const BASE = '/api/card-templates'

async function failure(response: Response): Promise<CardTemplateCloudError> {
  let code = `http_${response.status}`
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') code = body.error
  } catch {
    /* non-JSON error body: the status is enough */
  }
  return new CardTemplateCloudError(response.status, code)
}

export async function listCloudCardTemplates(signal?: AbortSignal): Promise<CloudCardTemplateList> {
  const response = await fetch(BASE, { credentials: 'include', signal })
  if (!response.ok) throw await failure(response)
  const body = (await response.json()) as {
    items?: CloudCardTemplateMeta[]
    tombstones?: CloudCardTemplateTombstone[]
  }
  return {
    items: Array.isArray(body.items) ? body.items : [],
    tombstones: Array.isArray(body.tombstones) ? body.tombstones : [],
  }
}

export async function uploadCloudCardTemplate(record: CardTemplateSourceRecord, signal?: AbortSignal): Promise<CloudCardTemplateMeta> {
  const manifest = record.parsed.manifest
  const query = new URLSearchParams({ id: manifest.id, name: manifest.name, version: manifest.version })
  const response = await fetch(`${BASE}?${query}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/zip' },
    body: record.raw,
    signal,
  })
  if (!response.ok) throw await failure(response)
  return (await response.json()) as CloudCardTemplateMeta
}

export async function downloadCloudCardTemplate(id: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { credentials: 'include', signal })
  if (!response.ok) throw await failure(response)
  return response.arrayBuffer()
}

export async function deleteCloudCardTemplate(id: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'include', signal,
  })
  if (!response.ok) throw await failure(response)
  const body = (await response.json()) as { deleted?: boolean }
  return body.deleted === true
}

/** SHA-256 of the archive bytes, the token both sides compare. */
export async function cardTemplateSha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}