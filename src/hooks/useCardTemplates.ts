import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import {
  activateCardTemplate, deactivateCardTemplate, loadedCardTemplateSummaries,
  parseCardTemplateSource, type CardTemplateSourceRecord,
} from '@/lib/card-template'
import {
  CardTemplateCloudError, cardTemplateSha256, deleteCloudCardTemplate,
  downloadCloudCardTemplate, listCloudCardTemplates, uploadCloudCardTemplate,
  type CloudCardTemplateMeta,
} from '@/lib/card-template-cloud'
import { CardTemplateError, type CardTemplateSummary, type TemplateKind } from '@/lib/card-template-format'
import { planCardTemplateSync, type LocalCardTemplateCandidate } from '@/lib/card-template-sync'
import {
  deleteCardTemplateRecord, listCardTemplateRecords, saveCardTemplateRecord,
} from '@/lib/card-template-store'
import {
  PUBLIC_CARD_TEMPLATES, PUBLIC_LONG_TEMPLATES, isPublicCardTemplateId, publicCardTemplateInstanceId,
} from '@/lib/public-card-templates'

export interface CardTemplateUploadFailure {
  file: string
  error: CardTemplateError
}

export interface CardTemplateUploadResult {
  added: CardTemplateSummary[]
  failed: CardTemplateUploadFailure[]
}

export interface CardTemplateRemoveResult {
  ok: boolean
  localOnly: boolean
}

export type CardTemplateSyncState = 'idle' | 'syncing' | 'synced' | 'failed'

export interface CardTemplateUpload {
  kind: TemplateKind
  templates: CardTemplateSummary[]
  /** Reed's own templates, loaded from `/card-templates/*.reedcard` in card mode. */
  publicTemplates: CardTemplateSummary[]
  loading: boolean
  publicLoading: boolean
  publicError: CardTemplateError | null
  uploading: boolean
  error: CardTemplateError | null
  /** Every file in the last batch that could not be added, in picker order. */
  failures: CardTemplateUploadFailure[]
  /** Only meaningful when `authenticated`; guests never see sync text. */
  authenticated: boolean
  sync: CardTemplateSyncState
  upload: (files: File[]) => Promise<CardTemplateUploadResult>
  remove: (id: string) => Promise<CardTemplateRemoveResult>
  retrySync: () => void
  clearError: () => void
}

interface PublicLoadResult {
  templates: CardTemplateSummary[]
  error: CardTemplateError | null
}

const publicLoadPromises = new Map<TemplateKind, Promise<PublicLoadResult>>()

/**
 * Fetch the nine public packages through the ordinary upload parser. The
 * promise is module-level so two mounts (or a dev remount) cannot install the
 * same stylesheet twice. A public instance gets a `public-*` record id, which
 * `customTemplateId` turns into a runtime id distinct from every user upload.
 */
function loadPublicTemplates(kind: TemplateKind): Promise<PublicLoadResult> {
  const existing = publicLoadPromises.get(kind)
  if (existing) return existing
  const promise = (async () => {
    const templates: CardTemplateSummary[] = []
    let firstError: CardTemplateError | null = null
   const items = kind === 'long' ? PUBLIC_LONG_TEMPLATES : PUBLIC_CARD_TEMPLATES
   for (const item of items) {
     try {
        const response = await fetch(item.pack, { cache: 'no-cache' })
        if (!response.ok) throw new CardTemplateError('missing-file', `${item.pack} (${response.status})`)
        const raw = await response.arrayBuffer()
        const record = await parseCardTemplateSource(raw, publicCardTemplateInstanceId(item.id))
   if (record.parsed.manifest.id !== item.id || record.parsed.manifest.kind !== kind) {
          throw new CardTemplateError('bad-manifest', `${item.pack}: ${record.parsed.manifest.id}`)
 }
        const loaded = await activateCardTemplate(record)
        templates.push(loaded.summary)
      } catch (itemError) {
        firstError ??= asError(itemError, 'unknown')
   }
 }
    return { templates, error: firstError }
  })()
  publicLoadPromises.set(kind, promise)
  return promise
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function asError(item: unknown, fallback: 'unknown' | 'storage' | 'cloud'): CardTemplateError {
  if (item instanceof CardTemplateError) return item
  if (item instanceof CardTemplateCloudError) return new CardTemplateError('cloud', item.message)
  return new CardTemplateError(fallback, item instanceof Error ? item.message : String(item))
}

export function useCardTemplates(options: { loadPublic?: boolean; kind?: TemplateKind } = {}): CardTemplateUpload {
  const { loadPublic = false, kind = 'card' } = options
  const [templates, setTemplates] = useState<CardTemplateSummary[]>([])
  const [publicTemplates, setPublicTemplates] = useState<CardTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [publicLoading, setPublicLoading] = useState(false)
  const [publicError, setPublicError] = useState<CardTemplateError | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<CardTemplateError | null>(null)
  const [failures, setFailures] = useState<CardTemplateUploadFailure[]>([])
  const [sync, setSync] = useState<CardTemplateSyncState>('idle')
  const { user, isLoading: authLoading, isFetching: authFetching } = useAuth()
  const { t } = useI18n()
  const authenticated = Boolean(user)
  const syncing = useRef(false)

  const refresh = useCallback(() => {
    // The runtime registry is shared, but "My templates" must stay limited to
    // the user's uploads; public packages have their own summary list.
    setTemplates(loadedCardTemplateSummaries().filter((item) => !isPublicCardTemplateId(item.template)))
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const records = await listCardTemplateRecords()
        for (const record of records) {
          try {
            await activateCardTemplate(record)
          } catch (item) {
            // One damaged record must not hide the rest. The list omits it and
            // the upload panel explains that it could not be restored.
            if (alive) setError(asError(item, 'unknown'))
          }
        }
      } catch (item) {
        if (alive) setError(asError(item, 'storage'))
      } finally {
        if (alive) {
          refresh()
          setLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [refresh])

  useEffect(() => {
    if (!loadPublic) return
    let alive = true
    setPublicLoading(true)
    setPublicTemplates([])
    void loadPublicTemplates(kind).then((result) => {
      if (!alive) return
      setPublicTemplates(result.templates)
      setPublicError(result.error)
      setPublicLoading(false)
    })
    return () => { alive = false }
  }, [loadPublic, kind])

  /** Upload one local record and remember the server version it now matches. */
  const pushLocal = useCallback(async (record: CardTemplateSourceRecord): Promise<void> => {
    const meta = await uploadCloudCardTemplate(record)
    if (Number.isFinite(meta.uploadedAt) && meta.uploadedAt > 0) {
      record.updatedAt = meta.uploadedAt
      record.cloudUploadedAt = meta.uploadedAt
      await saveCardTemplateRecord(record)
    }
  }, [])

  /** Download, re-validate through the upload path, activate and store. */
  const installCloudTemplate = useCallback(async (meta: CloudCardTemplateMeta): Promise<CardTemplateSourceRecord> => {
    const raw = await downloadCloudCardTemplate(meta.id)
    const digest = await cardTemplateSha256(raw)
    const current = await listCardTemplateRecords()
    const sameManifest = current
      .filter((record) => record.parsed.manifest.id === meta.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const record = await parseCardTemplateSource(raw, sameManifest?.id ?? newId())
    if (record.parsed.manifest.id !== meta.id) {
      throw new CardTemplateCloudError(0, 'manifest_mismatch', record.parsed.manifest.id)
    }
    // The server's metadata is the shared token; a corrupted transfer must not
    // silently replace a good local copy.
    if (meta.sha256 !== digest) {
      throw new CardTemplateCloudError(0, 'checksum_mismatch', meta.id)
    }
    record.cloudUploadedAt = meta.uploadedAt
    await activateCardTemplate(record)
    await saveCardTemplateRecord(record)
    refresh()
    return record
  }, [refresh])

  const runSync = useCallback(async (): Promise<void> => {
    if (!authenticated || syncing.current) return
    syncing.current = true
    setSync('syncing')
    try {
      const cloud = await listCloudCardTemplates()
      const local = await listCardTemplateRecords()
      const candidates: LocalCardTemplateCandidate[] = []
      for (const record of local) {
        candidates.push({
          key: record.id,
          id: record.parsed.manifest.id,
          sha256: await cardTemplateSha256(record.raw),
          updatedAt: record.updatedAt,
          cloudUploadedAt: record.cloudUploadedAt,
        })
      }
      const records = new Map(local.map((record) => [record.id, record]))
      const cloudById = new Map(cloud.items.map((item) => [item.id, item]))
      let removed = 0
      for (const action of planCardTemplateSync(candidates, cloud.items, cloud.tombstones)) {
        if (action.kind === 'upload') {
          const record = records.get(action.key)
          if (record) await pushLocal(record)
        } else if (action.kind === 'download') {
          const meta = cloudById.get(action.id)
          if (meta) await installCloudTemplate(meta)
        } else if (action.kind === 'keep') {
          // Bytes already match the server; remember which server version this
          // local copy is, so a later tombstone can tell it apart from a new one.
          const meta = cloudById.get(action.id)
          const record = local
            .filter((item) => item.parsed.manifest.id === action.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (meta && record) {
            record.cloudUploadedAt = meta.uploadedAt
            await saveCardTemplateRecord(record)
          }
        } else {
          // Another device deleted this id. Drop every local copy of that
          // manifest id; the cloud row is already gone, so do not call DELETE.
          for (const record of records.values()) {
            if (record.parsed.manifest.id !== action.id) continue
            deactivateCardTemplate(record.template)
            await deleteCardTemplateRecord(record.id)
          }
          removed += 1
        }
      }
      refresh()
      setSync('synced')
      if (removed > 0) toast(t('cards.templateRemovedByCloud', { n: removed }))
    } catch (item) {
      setSync(item instanceof CardTemplateCloudError && item.unauthorized ? 'idle' : 'failed')
    } finally {
      syncing.current = false
    }
  }, [authenticated, installCloudTemplate, pushLocal, refresh, t])

  useEffect(() => {
    if (!authenticated || authLoading || authFetching || loading) return
    void runSync()
  }, [authenticated, authLoading, authFetching, loading, runSync])

  const upload = useCallback(async (files: File[]): Promise<CardTemplateUploadResult> => {
    setUploading(true)
    setError(null)
    setFailures([])
    const added: CardTemplateSummary[] = []
    const failed: CardTemplateUploadFailure[] = []
    for (const file of files) {
      try {
        if (file.size > 8 * 1024 * 1024) throw new CardTemplateError('archive-too-large', String(file.size))
        const raw = await file.arrayBuffer()
        const record = await parseCardTemplateSource(raw, newId())
        const loaded = await activateCardTemplate(record)
        try {
          await saveCardTemplateRecord(record)
        } catch (item) {
          deactivateCardTemplate(record.template)
          throw item
        }
        added.push(loaded.summary)
        if (authenticated) {
          try {
            await pushLocal(record)
            setSync('synced')
          } catch (item) {
            setSync(item instanceof CardTemplateCloudError && item.unauthorized ? 'idle' : 'failed')
          }
        }
      } catch (item) {
        failed.push({ file: file.name, error: asError(item, 'unknown') })
      }
    }
    if (failed.length) {
      setFailures(failed)
      setError(failed[0].error)
    }
    refresh()
    setUploading(false)
    return { added, failed }
  }, [authenticated, pushLocal, refresh])

  const remove = useCallback(async (id: string): Promise<CardTemplateRemoveResult> => {
    setError(null)
    setFailures([])
    try {
      const record = await listCardTemplateRecords().then((rows) => rows.find((row) => row.id === id))
      if (record && authenticated) {
        try {
          await deleteCloudCardTemplate(record.parsed.manifest.id)
        } catch (item) {
          setError(asError(item, 'cloud'))
          return { ok: false, localOnly: false }
        }
      }
      if (record) deactivateCardTemplate(record.template)
      await deleteCardTemplateRecord(id)
      refresh()
      return { ok: true, localOnly: !authenticated }
    } catch (item) {
      setError(asError(item, 'storage'))
      return { ok: false, localOnly: false }
    }
  }, [authenticated, refresh])

  const retrySync = useCallback(() => {
    setSync('idle')
    void runSync()
  }, [runSync])

  return {
    kind,
    templates,
    publicTemplates,
    loading,
    publicLoading,
    publicError,
    uploading,
    error,
    failures,
    authenticated,
    sync,
    upload,
    remove,
    retrySync,
    clearError: () => { setError(null); setFailures([]) },
  }
}

/** Kept next to the hook so callers can name the record type in props. */
export type { CardTemplateSourceRecord }