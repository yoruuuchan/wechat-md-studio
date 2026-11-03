import { useRef } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/hooks/useI18n'
import type { CardTemplateUpload } from '@/hooks/useCardTemplates'
import type { CardTemplateErrorCode, CardTemplateSummary } from '@/lib/card-template-format'
import type { MsgKey } from '@/lib/i18n'

const ERROR_KEYS: Record<CardTemplateErrorCode, MsgKey> = {
  'archive-too-large': 'cards.templateError.archiveTooLarge',
  'archive-too-large-unpacked': 'cards.templateError.archiveTooLargeUnpacked',
  'too-many-files': 'cards.templateError.tooManyFiles',
  'path-traversal': 'cards.templateError.pathTraversal',
  'bad-extension': 'cards.templateError.badExtension',
  'bad-zip': 'cards.templateError.badZip',
  'bad-manifest': 'cards.templateError.badManifest',
  'missing-file': 'cards.templateError.missingFile',
  'font-not-builtin': 'cards.templateError.fontNotBuiltin',
  'unsafe-html': 'cards.templateError.unsafeHtml',
  'unsafe-css': 'cards.templateError.unsafeCss',
  'unsafe-url': 'cards.templateError.unsafeUrl',
  storage: 'cards.templateError.storage',
  unknown: 'cards.templateError.unknown',
}

interface Props {
  state: CardTemplateUpload
  selected: string
  onUploaded: (summary: CardTemplateSummary) => void
  onDeleted: (template: string) => void
}

/**
 * "My templates" in the side panel. The file input and list reuse the panel's
 * ya-* controls; uploads are validated before they ever reach this list.
 */
export default function CardTemplatesSection({ state, selected, onUploaded, onDeleted }: Props) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const errorReason = state.error ? t(ERROR_KEYS[state.error.code]) : null

  const pick = () => inputRef.current?.click()

  const upload = async (file: File) => {
    const summary = await state.upload(file)
    if (summary) {
      toast.success(t('cards.templateUploaded', { name: summary.name }))
      onUploaded(summary)
    }
  }

  const remove = (summary: CardTemplateSummary) => {
    if (!window.confirm(t('cards.templateDeleteConfirm', { name: summary.name }))) return
    void state.remove(summary.id).then((ok) => { if (ok) onDeleted(summary.template) })
  }

  return (
    <div data-card-templates className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="ya-eyebrow">{t('cards.myTemplates')}</p>
        <span className="text-[11px] text-ink-3">{state.templates.length || ''}</span>
      </div>
      <input
        ref={inputRef}
        data-card-template-file
        type="file"
        accept=".reedcard,.zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }}
      />
      <button
        data-card-template-upload
        className="ya-btn ya-btn-secondary ya-btn-sm w-full"
        onClick={pick}
        disabled={state.uploading}
      >
        {state.uploading ? t('cards.uploadingTemplate') : t('cards.uploadTemplate')}
      </button>
      {state.loading ? <p className="text-[11px] text-ink-3">{t('common.loading')}</p> : null}
      {state.error && errorReason ? (
        <div data-card-template-error role="alert" className="rounded-xl bg-surface-sunken p-2.5 text-[11px] leading-relaxed text-error-700">
          <p>{t('cards.templateError', { reason: errorReason })}</p>
          {state.error.detail ? <p className="mt-1 break-all text-ink-3">{state.error.detail}</p> : null}
          <button className="ya-link-btn mt-1" onClick={state.clearError}>{t('common.retry')}</button>
        </div>
      ) : null}
      {state.templates.length === 0 && !state.loading ? (
        <p className="ya-well p-2.5 text-[12px] leading-relaxed text-ink-3">{t('cards.templateEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {state.templates.map((summary) => (
            <li
              key={summary.id}
              data-card-template-item={summary.template}
              data-selected={selected === summary.template || undefined}
              className="flex items-center gap-2 rounded-xl bg-surface-sunken px-2.5 py-2"
              style={{ boxShadow: 'var(--shadow-inset)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-ink-1">{summary.name}</p>
                <p className="truncate text-[10px] text-ink-3">
                  {summary.author} · v{summary.version} · {summary.variants.length} {t('cards.background')}
                </p>
              </div>
              <button
                data-card-template-delete={summary.id}
                className="ya-link-btn danger shrink-0 !text-[11px]"
                title={t('cards.templateDeleteTitle', { name: summary.name })}
                onClick={() => remove(summary)}
              >
                {t('cards.templateDelete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}