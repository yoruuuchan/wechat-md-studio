import { useRef, useState } from 'react'
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
  cloud: 'cards.templateError.cloud',
  storage: 'cards.templateError.storage',
  unknown: 'cards.templateError.unknown',
}

interface Props {
  state: CardTemplateUpload
  selected: string
  /** Export in progress: switching templates would abort the batch mid-way. */
  busy: boolean
  onSelect: (template: string) => void
  onUploaded: (summary: CardTemplateSummary) => void
  onDeleted: (template: string) => void
}

/**
 * The "我的" group in the card template picker. Uploading, deleting, sync
 * state and upload errors all live on this one group now; there is no second
 * "My templates" list further down the panel. Deleting is a mode: the header's
 * 管理 button reveals a 删除 next to each own template, so a normal click on a
 * template still selects it.
 */
export default function MyTemplatesGroup({ state, selected, busy, onSelect, onUploaded, onDeleted }: Props) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [manageRequested, setManageRequested] = useState(false)
  // An empty group has nothing to manage, even if the request outlived the last
  // deletion; deriving this avoids a state-sync effect on every list change.
  const managing = manageRequested && state.templates.length > 0
  const errorReason = state.error ? t(ERROR_KEYS[state.error.code]) : null
  const groupLabel = 'mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3'

  const pick = () => inputRef.current?.click()

  const upload = async (files: File[]) => {
    // A fresh upload is a normal-state operation: leaving management on would
    // make the new tile unselectable until 完成 is pressed.
    setManageRequested(false)
    const result = await state.upload(files)
    if (result.added.length) onUploaded(result.added[result.added.length - 1])
    if (result.failed.length) {
      toast.error(t('cards.templateBatchSummary', { added: result.added.length, failed: result.failed.length }))
    } else if (result.added.length === 1) {
      toast.success(t('cards.templateUploaded', { name: result.added[0].name }))
    } else if (result.added.length > 1) {
      toast.success(t('cards.templateAddedSummary', { added: result.added.length }))
    }
  }

  const remove = (summary: CardTemplateSummary) => {
    const confirmKey: MsgKey = state.authenticated ? 'cards.templateDeleteConfirmCloud' : 'cards.templateDeleteConfirm'
    if (!window.confirm(t(confirmKey, { name: summary.name }))) return
    void state.remove(summary.id).then((result) => {
      if (!result.ok) {
        toast.error(t('cards.templateError.cloud'))
        return
      }
      onDeleted(summary.template)
      if (result.localOnly) toast(t('cards.templateDeleteLocal'))
    })
  }

  return (
    <div data-card-templates data-card-template-group="mine" className="mb-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <p className={groupLabel}>{t('cards.templateMine')}</p>
        <span className="flex shrink-0 items-center gap-1">
          <input
            ref={inputRef}
            data-card-template-file
            type="file"
            accept=".reedcard,.zip,application/zip"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length) void upload(files)
              event.target.value = ''
            }}
          />
          <button
            data-card-template-upload
            className="ya-btn ya-btn-secondary ya-btn-sm"
            onClick={pick}
            title={t('cards.uploadTemplate')}
            disabled={state.uploading}
          >
            {state.uploading ? t('cards.uploadingTemplate') : t('cards.templateUploadShort')}
          </button>
          <button
            data-card-template-manage
            aria-pressed={managing}
            className="ya-btn ya-btn-secondary ya-btn-sm"
            title={managing ? t('cards.templateManageDone') : t('cards.templateManage')}
            onClick={() => setManageRequested((value) => !value)}
            disabled={state.templates.length === 0}
          >
            {managing ? t('cards.templateManageDone') : t('cards.templateManage')}
          </button>
        </span>
      </div>

      {state.authenticated ? (
        <div
          data-card-template-sync={state.sync}
          className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-ink-3"
          role="status"
          aria-live="polite"
        >
          <span>{state.sync === 'syncing'
            ? t('cards.templateSyncing')
            : state.sync === 'failed' ? t('cards.templateSyncFailed')
              : state.sync === 'synced' ? t('cards.templateSync') : ''}</span>
          {state.sync === 'failed' ? (
            <>
              <span className="min-w-0 flex-1 truncate text-error-700">{t('cards.templateSyncFailedHint')}</span>
              <button data-card-template-sync-retry className="ya-link-btn shrink-0" onClick={state.retrySync}>
                {t('common.retry')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {state.loading ? <p className="mb-1.5 text-[11px] text-ink-3">{t('common.loading')}</p> : null}
      {state.error && errorReason ? (
        <div data-card-template-error role="alert" className="mb-1.5 rounded-xl bg-surface-sunken p-2.5 text-[11px] leading-relaxed text-error-700">
          {state.failures.length > 0 ? (
            <ul className="space-y-1">
              {state.failures.map((failure) => (
                <li key={failure.file} className="break-all">
                  {t('cards.templateFailureFile', {
                    name: failure.file,
                    reason: t(ERROR_KEYS[failure.error.code]),
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('cards.templateError', { reason: errorReason })}</p>
          )}
          {state.error.detail ? <p className="mt-1 break-all text-ink-3">{state.error.detail}</p> : null}
          <button className="ya-link-btn mt-1" onClick={state.clearError}>{t('common.retry')}</button>
        </div>
      ) : null}

      {state.templates.length === 0 ? (
        // Until the saved templates are restored the list is only empty because
        // it has not loaded yet; the loading line above already says so.
        state.loading ? null : (
          <p className="ya-well p-2.5 text-[12px] leading-relaxed text-ink-3">{t('cards.templateEmpty')}</p>
        )
      ) : (
        <div
          className="ya-well flex flex-wrap gap-0.5 rounded-xl p-1"
          role="group"
          aria-label={`${t('cards.template')} · ${t('cards.templateMine')}`}
        >
          {state.templates.map((item) => (
            <div
              key={item.id}
              data-card-template-item={item.template}
              data-selected={selected === item.template || undefined}
              className="inline-flex min-w-0 items-center gap-0.5"
            >
              <button
                data-card-template={item.template}
                data-card-template-custom="true"
                aria-pressed={selected === item.template}
                disabled={busy}
                className={`ya-tool xhs-option ${selected === item.template ? 'ya-selected' : ''}`}
                onClick={() => {
                  if (managing) return
                  onSelect(item.template)
                }}
              >
                {item.name}
              </button>
              {managing && (
                <button
                  data-card-template-delete={item.id}
                  className="ya-link-btn danger shrink-0 !text-[11px]"
                  title={t('cards.templateDeleteTitle', { name: item.name })}
                  onClick={() => remove(item)}
                >
                  {t('cards.templateDelete')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}