/**
 * storage.ts — object storage client for the R2 image worker.
 *
 * The worker owns the R2 binding, so this process never holds S3 credentials.
 * Three operations map onto three worker routes:
 *
 *   uploadFile       PUT    /api/upload?key=<key>   (X-Admin-Key)
 *   deleteFile       DELETE /api/upload?key=<key>   (X-Admin-Key)
 *   getPresignedUrl  —      public URL under IMG_BASE_URL
 *
 * Keys never change while their ledger row lives, so the URL derived from a
 * key is safe to bake into copied WeChat HTML. Owner and agent rows live
 * forever; anonymous rows (ownerId = 0) can be recycled by api/lib/anon-gc.ts
 * once they age past ANON_GC_DAYS unreferenced — copied articles keep working
 * because WeChat re-hosts the image at publish time.
 */

import { env } from './env'

export interface UploadedFile {
  key: string
  fileName: string
  size: number
}

export class StorageError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StorageError'
    this.code = code
  }
}

function endpoint(path: string): string {
  if (!env.imgBaseUrl) {
    throw new StorageError('STORAGE_NOT_CONFIGURED', 'IMG_BASE_URL is not set')
  }
  return `${env.imgBaseUrl}${path}`
}

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  if (!env.imgAdminKey) {
    throw new StorageError('STORAGE_NOT_CONFIGURED', 'IMG_ADMIN_KEY is not set')
  }
  return { 'X-Admin-Key': env.imgAdminKey, ...extra }
}

/** Collapse anything awkward in a user-supplied filename into one path segment. */
function safeName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[^\w.\u4e00-\u9fff-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(-80)
  return cleaned || 'image'
}

/**
 * `deleteFile` never throws and never guesses. Every caller has to decide what
 * "not confirmed" means for its own ledger, and the one thing they must not do
 * is treat it as done.
 */
export interface DeleteResult {
  /**
   * True only when the worker answered 2xx, which for this worker means the
   * object is not in the bucket any more - its DELETE is idempotent and answers
   * 200 even for a key that was never there. Nothing else counts as gone: a 404
   * means the request did not reach that route (wrong IMG_BASE_URL, a proxy in
   * between, an older worker), so the object may well still exist.
   */
  gone: boolean
  reason: 'ok' | 'not-found' | 'refused' | 'unconfigured' | 'network'
  /** HTTP status when there was a response at all. */
  status: number | null
  detail: string
}

export const storage = {
  async uploadFile(opts: {
    fileContent: Uint8Array
    fileName: string
    contentType?: string
  }): Promise<UploadedFile> {
    const key = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}-${safeName(opts.fileName)}`

    const resp = await fetch(endpoint(`/api/upload?key=${encodeURIComponent(key)}`), {
      method: 'PUT',
      headers: adminHeaders({
        'Content-Type': opts.contentType || 'application/octet-stream',
      }),
      body: new Blob([new Uint8Array(opts.fileContent)], {
        type: opts.contentType || 'application/octet-stream',
      }),
    })

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      const code =
        resp.status === 413
          ? 'STORAGE_FILE_TOO_LARGE'
          : resp.status === 401 || resp.status === 403
            ? 'STORAGE_UNAUTHORIZED'
            : 'STORAGE_UPLOAD_FAILED'
      throw new StorageError(code, `Upload failed (${resp.status}): ${detail.slice(0, 200)}`)
    }

    const body = (await resp.json()) as { key: string; size: number }
    return { key: body.key, fileName: opts.fileName, size: body.size }
  },

  /**
   * Public URL for a key. Reads never touch this process — the browser and
   * WeChat fetch the image straight from the worker.
   */
  getPresignedUrl(opts: { key: string }): Promise<{ url: string }> {
    return Promise.resolve({ url: publicImageUrl(opts.key) })
  },

  async deleteFile(opts: { fileKey: string }): Promise<DeleteResult> {
    const key = opts.fileKey
    let resp: Response
    try {
      resp = await fetch(endpoint(`/api/upload?key=${encodeURIComponent(key)}`), {
        method: 'DELETE',
        headers: adminHeaders(),
      })
    } catch (e) {
      const err = e as { code?: string; message?: string }
      const code = err?.code === 'STORAGE_NOT_CONFIGURED' ? 'unconfigured' : 'network'
      return { gone: false, reason: code, status: null, detail: reasonOf(e) }
    }
    if (resp.ok) return { gone: true, reason: 'ok', status: resp.status, detail: '' }
    const detail = (await resp.text().catch(() => '')).slice(0, 200)
    if (resp.status === 404) {
      return { gone: false, reason: 'not-found', status: 404, detail: detail || 'worker route not reached' }
    }
    return { gone: false, reason: 'refused', status: resp.status, detail }
  },
}

function reasonOf(e: unknown): string {
  const err = e as { code?: string; message?: string; cause?: { code?: string } }
  return (err?.cause?.code || err?.code || err?.message || String(e)).replace(/\s+/g, ' ').slice(0, 160)
}

export function publicImageUrl(key: string): string {
  return `${env.imgBaseUrl}/img/${encodeURIComponent(key)}`
}
