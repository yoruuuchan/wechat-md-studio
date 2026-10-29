import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/hooks/useI18n'
import type { ArticleSaveStatus } from '@/lib/save-status'

const LOCAL_KEYS = {
  loading: 'saveStatus.local.loading',
  saving: 'saveStatus.local.saving',
  saved: 'saveStatus.local.saved',
  error: 'saveStatus.local.error',
} as const
const CLOUD_KEYS = {
  'signed-out': 'saveStatus.cloud.signedOut',
  unarchived: 'saveStatus.cloud.unarchived',
  loading: 'saveStatus.cloud.loading',
  pending: 'saveStatus.cloud.pending',
  saving: 'saveStatus.cloud.saving',
  synced: 'saveStatus.cloud.synced',
  conflict: 'saveStatus.cloud.conflict',
  error: 'saveStatus.cloud.error',
} as const
const CLOUD_DESCRIPTION_KEYS = {
  'signed-out': 'saveStatus.cloud.signedOutDescription',
  unarchived: 'saveStatus.cloud.unarchivedDescription',
  loading: 'saveStatus.cloud.loadingDescription',
  pending: 'saveStatus.cloud.pendingDescription',
  saving: 'saveStatus.cloud.savingDescription',
  synced: 'saveStatus.cloud.syncedDescription',
  conflict: 'saveStatus.cloud.conflictDescription',
  error: 'saveStatus.cloud.errorDescription',
} as const

interface Props {
  status: ArticleSaveStatus | null
  docName: string
  readable: boolean
  retryingLocal: boolean
  onRetryLocal: () => void
  onRetryCloud: () => void
  onOpenConflict: () => void
  onSaveDraft: () => void
  onLogin: () => void
  onExport: (kind: 'markdown' | 'bundle') => void
  remoteConnected?: boolean
  /**
   * Narrow layout: the trigger shares a crowded bar, so it takes the width its
   * container hands it instead of its own intrinsic width. Without this the
   * button keeps its full label width inside a shrunken wrapper and pushes the
   * right edge of the bar past the viewport.
   */
  compact?: boolean
}

/** Existing top-bar styling, with independently proven local and cloud states. */
export function SaveStatus(p: Props) {
  const { lang, t } = useI18n()
  const status = p.status
  const spoken = status ? t('saveStatus.announcement', { local: t(LOCAL_KEYS[status.local]), cloud: t(CLOUD_KEYS[status.cloud]) }) : ''
  const urgent = status?.local === 'error' || status?.cloud === 'error' || status?.cloud === 'conflict'
  const [open, setOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(spoken), urgent ? 0 : 800)
    return () => window.clearTimeout(timer)
  }, [spoken, urgent])
  if (!status) return null
  const locale = lang === 'en' ? 'en-GB' : 'zh-CN'
  const localLabel = t(LOCAL_KEYS[status.local])
  const cloudLabel = t(CLOUD_KEYS[status.cloud])
  const time = status.localSavedAt === null ? null : new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(status.localSavedAt)
  const localColor = status.local === 'error' ? 'var(--error-500)' : status.local === 'saved' ? 'var(--success-500)' : 'var(--ink-3)'
  const cloudColor = status.cloud === 'error' || status.cloud === 'conflict'
    ? 'var(--error-500)' : status.cloud === 'synced' ? 'var(--success-500)' : 'var(--ink-3)'
  const recoveryLabel = status.recovery?.kind === 'conflict' ? t('saveStatus.recovery.conflict') : t('saveStatus.recovery.restored')
  const runAndClose = (action: () => void) => {
    restoreFocusRef.current = true
    setOpen(false)
    action()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) restoreFocusRef.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          data-save-status
          data-local-state={status.local}
          data-cloud-state={status.cloud}
          data-save-doc={status.id}
          className={`min-w-0 rounded-lg px-1.5 py-1 text-left text-[10px] leading-4 transition-colors hover:bg-line-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${p.compact ? 'w-full max-w-full' : 'max-w-[170px]'}`}
          title={t('saveStatus.details')}
          aria-label={`${t('saveStatus.open', { name: p.docName, local: localLabel, cloud: cloudLabel })}${status.recovery ? ` · ${recoveryLabel}` : ''}`}
        >
          <span className="block truncate tabular-nums" style={{ color: localColor }}>{localLabel}{time ? ` · ${time}` : ''}</span>
          <span className="block truncate" style={{ color: cloudColor }}>{cloudLabel}{status.recovery ? ` · ${t('saveStatus.recovery.short')}` : ''}</span>
        </button>
      </PopoverTrigger>
      {/* Announce state transitions, not a changing timestamp on every save. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <PopoverContent
        data-save-details
        align="start"
        aria-label={t('saveStatus.details')}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef.current) return
          restoreFocusRef.current = false
          event.preventDefault()
          triggerRef.current?.focus()
        }}
        className="ya-pop w-[min(340px,calc(100vw-24px))] border-none p-4 text-[12px] leading-relaxed"
      >
        <h2 className="mb-3 truncate text-[13px] font-semibold text-ink-1">{t('saveStatus.details')} · {p.docName}</h2>
        <dl className="space-y-3">
          <div>
            <dt className="font-medium" style={{ color: localColor }}>{localLabel}</dt>
            <dd className="mt-0.5 text-ink-3">
              {status.local === 'saved'
                ? status.localSavedAt === null ? t('saveStatus.local.timeUnknown') : t('saveStatus.local.savedDescription')
                : status.local === 'error' ? t('saveStatus.local.errorDescription') : status.local === 'loading' ? t('saveStatus.local.loadingDescription') : t('saveStatus.local.savingDescription')}
              {status.localSavedAt !== null && <time className="mt-1 block tabular-nums" dateTime={new Date(status.localSavedAt).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(status.localSavedAt)}</time>}
            </dd>
          </div>
          <div>
            <dt className="font-medium" style={{ color: cloudColor }}>{cloudLabel}</dt>
            <dd className="mt-0.5 text-ink-3">{t(CLOUD_DESCRIPTION_KEYS[status.cloud])}</dd>
          </div>
          {status.cloud === 'signed-out' && (
            <div data-guest-local-guide className="rounded-lg bg-surface-sunken p-2.5">
              <dt className="font-medium text-ink-1">{t('saveStatus.guest.title')}</dt>
              <dd className="mt-0.5 text-ink-3">{t('saveStatus.guest.body')}</dd>
            </div>
          )}
          {status.recovery && (
            <div data-recovery-status className="rounded-lg bg-surface-sunken p-2.5">
              <dt className="font-medium text-ink-1">{recoveryLabel}</dt>
              <dd className="mt-0.5 text-ink-3">{t('saveStatus.recovery.description')}</dd>
              <dd className="mt-1 tabular-nums text-ink-3"><time dateTime={new Date(status.recovery.at).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(status.recovery.at)}</time></dd>
            </div>
          )}
        </dl>
        {p.remoteConnected && <p className="mt-3 text-ink-3">{t('topbar.sync.localMcpTitle')}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {status.local === 'error' && <button data-save-retry-local onClick={() => runAndClose(p.onRetryLocal)} disabled={p.retryingLocal} className="ya-btn ya-btn-secondary ya-btn-sm">{t('saveStatus.retryLocal')}</button>}
          {status.cloud === 'error' && <button data-save-retry-cloud onClick={() => runAndClose(p.onRetryCloud)} className="ya-btn ya-btn-secondary ya-btn-sm">{t('saveStatus.retryCloud')}</button>}
          {status.cloud === 'conflict' && <button data-save-review-conflict onClick={() => runAndClose(p.onOpenConflict)} className="ya-btn ya-btn-secondary ya-btn-sm">{t('saveStatus.reviewConflict')}</button>}
          {status.cloud === 'unarchived' && <button onClick={p.onSaveDraft} disabled={!p.readable} className="ya-btn ya-btn-secondary ya-btn-sm">{t('topbar.save')}</button>}
          {status.cloud === 'signed-out' && <button onClick={p.onLogin} className="ya-btn ya-btn-secondary ya-btn-sm">{t('topbar.login')}</button>}
          <button data-save-export onClick={() => p.onExport('markdown')} disabled={!p.readable} className="ya-btn ya-btn-secondary ya-btn-sm">{t('saveStatus.exportMarkdown')}</button>
          <button data-save-export-bundle onClick={() => p.onExport('bundle')} className="ya-btn ya-btn-secondary ya-btn-sm">{t('saveStatus.exportBundle')}</button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
