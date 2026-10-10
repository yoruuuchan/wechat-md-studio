import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { useRemoteMcp } from '@/hooks/useRemoteMcp'
import type { DocRecord } from '@/lib/store'
import { copyAiText } from './AiWritingDialog'
import { useI18n } from '@/hooks/useI18n'

export default function RemoteMcpDialog({ open, onOpenChange, doc, remote }: {
  open: boolean; onOpenChange: (open: boolean) => void; doc?: DocRecord | null; remote: ReturnType<typeof useRemoteMcp>
}) {
  const { t, lang } = useI18n()
  const PHASE = {
    off: t('mcp.phase.off'),
    synced: t('mcp.phase.synced'),
    saving: t('mcp.phase.saving'),
    error: t('mcp.phase.error'),
    conflict: t('mcp.phase.conflict'),
  }
  const credentials = remote.credentials
  const endpoint = credentials?.endpoint ?? `${window.location.origin}/api/mcp`
  const config = credentials ? JSON.stringify({ mcpServers: {
    'reed-current': { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${credentials.token}` } },
  } }, null, 2) : ''
  const connected = Boolean(doc?.remoteMcp)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !bg-surface-base sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('mcp.title')}</DialogTitle>
          <DialogDescription className="text-ink-3">
            {t('mcp.desc', { name: doc?.name || t('common.unnamedDoc') })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[13px] leading-relaxed text-ink-2">
          {t('mcp.intro')}
        </p>
        {!connected ? (
          <div className="ya-well space-y-3 p-4">
            <p className="text-[12px] text-ink-3">{t('mcp.createNote')}</p>
            <button data-mcp-create disabled={!doc || doc.contentLoaded === false || remote.busy} onClick={() => void remote.create()} className="ya-btn ya-btn-primary">
              {remote.busy ? t('mcp.creating') : t('mcp.create')}
            </button>
          </div>
        ) : (
          <div className="ya-well space-y-3 p-4 text-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span data-mcp-status className="text-ink-2">{PHASE[remote.phase]}</span>
              {remote.snapshot && (
                <span className="text-ink-3">
                  {t('mcp.expires', {
                    time: new Date(remote.snapshot.connection.expiresAt).toLocaleString(lang === 'en' ? 'en-CA' : 'zh-CN', { hour12: false }),
                  })}
                </span>
              )}
            </div>
            <p className="text-ink-3">{t('mcp.transport')}</p>
            <label className="block space-y-1 text-ink-3">
              <span>{t('mcp.endpoint')}</span>
              <input aria-label={t('mcp.aria.endpoint')} readOnly value={endpoint} className="ya-input w-full !text-[12px]" />
            </label>
            {credentials ? (
              <>
                <label className="block space-y-1 text-ink-3">
                  <span>{t('mcp.auth')}</span>
                  <input aria-label={t('mcp.aria.auth')} type="password" readOnly value={`Bearer ${credentials.token}`} className="ya-input w-full !text-[12px]" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button data-mcp-copy="config" onClick={() => void copyAiText(config, t('mcp.copyLabel.config'))} className="ya-btn ya-btn-primary">{t('mcp.copyConfig')}</button>
                  <button data-mcp-copy="url" onClick={() => void copyAiText(endpoint, t('mcp.copyLabel.url'))} className="ya-btn ya-btn-secondary">{t('mcp.copyUrl')}</button>
                  <button data-mcp-copy="auth" onClick={() => void copyAiText(`Bearer ${credentials.token}`, t('mcp.copyLabel.auth'))} className="ya-btn ya-btn-secondary">{t('mcp.copyAuth')}</button>
                </div>
              </>
            ) : (
              <p className="text-ink-3">{t('mcp.tokenOnce')}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button data-mcp-rotate disabled={remote.busy} onClick={() => void remote.rotate()} className="ya-btn ya-btn-secondary">{t('mcp.rotate')}</button>
              <button data-mcp-revoke disabled={remote.busy} onClick={() => void remote.revoke()} className="ya-link-btn danger">{t('mcp.revoke')}</button>
            </div>
          </div>
        )}
        {remote.conflict && (
          <div data-mcp-conflict className="ya-well space-y-3 p-4">
            <p className="text-[13px] font-medium text-warn-700">{t('mcp.conflict.title')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-[12px] text-ink-3">{t('mcp.conflict.local')}
                <textarea aria-label={t('mcp.aria.localConflict')} readOnly value={doc?.content.slice(0, 20_000) || ''} className="ya-input !h-40 w-full !py-3 !text-[12px]" />
              </label>
              <label className="space-y-1 text-[12px] text-ink-3">{t('mcp.conflict.remote')}
                <textarea aria-label={t('mcp.aria.remoteConflict')} readOnly value={remote.conflict.content.slice(0, 20_000)} className="ya-input !h-40 w-full !py-3 !text-[12px]" />
              </label>
            </div>
            <p className="text-[11px] text-ink-3">{t('mcp.conflict.note')}</p>
            <div className="flex flex-wrap gap-2">
              <button data-mcp-resolve="both" disabled={remote.busy} onClick={() => void remote.resolve('both')} className="ya-btn ya-btn-primary">{t('mcp.conflict.both')}</button>
              <button data-mcp-resolve="local" disabled={remote.busy} onClick={() => void remote.resolve('local')} className="ya-btn ya-btn-secondary">{t('mcp.conflict.keepLocal')}</button>
              <button data-mcp-resolve="remote" disabled={remote.busy} onClick={() => void remote.resolve('remote')} className="ya-btn ya-btn-secondary">{t('mcp.conflict.useRemote')}</button>
            </div>
          </div>
        )}
        {remote.error && <p role="alert" className="text-[12px] text-warn-700">{remote.error}</p>}
        <p className="text-[12px] leading-relaxed text-ink-3">
          {t('mcp.clients')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
