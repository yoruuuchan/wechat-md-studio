import { useCallback, useEffect, useState } from 'react'
import {
  activateCardTemplate, loadedCardTemplateSummaries, parseCardTemplateSource, type CardTemplateSourceRecord,
} from '@/lib/card-template'
import { CardTemplateError, type CardTemplateSummary } from '@/lib/card-template-format'
import {
  deleteCardTemplateRecord, listCardTemplateRecords, saveCardTemplateRecord,
} from '@/lib/card-template-store'

export interface CardTemplateUpload {
  templates: CardTemplateSummary[]
  loading: boolean
  uploading: boolean
  error: CardTemplateError | null
  upload: (file: File) => Promise<CardTemplateSummary | null>
  remove: (id: string) => Promise<boolean>
  clearError: () => void
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function useCardTemplates(): CardTemplateUpload {
  const [templates, setTemplates] = useState<CardTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<CardTemplateError | null>(null)

  const refresh = useCallback(() => {
    setTemplates(loadedCardTemplateSummaries())
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
            if (alive) setError(item instanceof CardTemplateError ? item : new CardTemplateError('unknown', String(item)))
          }
        }
      } catch (item) {
        if (alive) setError(item instanceof CardTemplateError ? item : new CardTemplateError('storage', String(item)))
      } finally {
        if (alive) {
          refresh()
          setLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [refresh])

  const upload = useCallback(async (file: File): Promise<CardTemplateSummary | null> => {
    setUploading(true)
    setError(null)
    try {
      if (file.size > 8 * 1024 * 1024) throw new CardTemplateError('archive-too-large', String(file.size))
      const raw = await file.arrayBuffer()
      const record = await parseCardTemplateSource(raw, newId())
      const loaded = await activateCardTemplate(record)
      try {
        await saveCardTemplateRecord(record)
      } catch (item) {
        const { deactivateCardTemplate } = await import('@/lib/card-template')
        deactivateCardTemplate(record.template)
        throw item
      }
      refresh()
      return loaded.summary
    } catch (item) {
      const next = item instanceof CardTemplateError ? item : new CardTemplateError('unknown', String(item))
      setError(next)
      return null
    } finally {
      setUploading(false)
    }
  }, [refresh])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    setError(null)
    try {
      const record = await listCardTemplateRecords().then((rows) => rows.find((row) => row.id === id))
      if (record) {
        // Import lazily to keep the hook independent from the engine's DOM work.
        const { deactivateCardTemplate } = await import('@/lib/card-template')
        deactivateCardTemplate(record.template)
      }
      await deleteCardTemplateRecord(id)
      refresh()
      return true
    } catch (item) {
      setError(item instanceof CardTemplateError ? item : new CardTemplateError('storage', String(item)))
      return false
    }
  }, [refresh])

  return {
    templates,
    loading,
    uploading,
    error,
    upload,
    remove,
    clearError: () => setError(null),
  }
}

/** Kept next to the hook so callers can name the record type in props. */
export type { CardTemplateSourceRecord }