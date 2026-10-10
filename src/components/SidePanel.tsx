import { useMemo, useRef } from 'react'
import { Link } from 'react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MaterialItem } from '@/lib/render'
import { REPO_URL } from '@/lib/brand'
import { CREDITS } from '@/lib/credits'
import { ZOOM_STEPS } from '@/lib/store'
import { CAROUSEL_RATIOS, DEFAULT_CAROUSEL_RATIO, type CarouselRatio, type SignatureConfig } from '@/lib/types'
import { useI18n } from '@/hooks/useI18n'

interface Props {
  materials: MaterialItem[]
  titles: string[]
  cover: string
  sig: SignatureConfig
  onSig: (s: SignatureConfig) => void
  syncScroll: boolean
  onSyncScrollChange: (v: boolean) => void
  zoom: number
  onZoomChange: (z: number) => void
  onJump: (line: number) => void
  onCopyTitle: (t: string) => void
  onUpload: (files: File[], item: MaterialItem) => void
  /** Clear this image's src, leaving the placeholder (carousel slides). */
  onClear: (item: MaterialItem) => void
  /** Remove the whole image line (standalone images). */
  onRemove: (item: MaterialItem) => void
  /** Re-open the cropper for an already uploaded image. */
  onRecrop: (item: MaterialItem) => void
  /** Change the frame ratio of a whole carousel. */
  onCarouselRatio: (carouselOrdinal: number, ratio: CarouselRatio) => void
  uploadingKey: string | null
  onOpenRemoteMcp: () => void
  remoteConnected: boolean
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="ya-eyebrow mb-2">{children}</p>
}

export default function SidePanel(p: Props) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<MaterialItem | null>(null)

  const pick = (item: MaterialItem) => {
    pendingRef.current = item
    fileRef.current?.click()
  }

  // Group into carousels plus loose images, so each carousel gets one ratio control.
  const groups = useMemo(() => {
    const out: { key: string; ratio?: CarouselRatio; ordinal?: number; items: MaterialItem[] }[] = []
    let current: (typeof out)[number] | null = null
    for (const m of p.materials) {
      if (m.carouselOrdinal) {
        if (!current || current.ordinal !== m.carouselOrdinal) {
          current = { key: `carousel-${m.carouselOrdinal}`, ratio: m.ratio, ordinal: m.carouselOrdinal, items: [] }
          out.push(current)
        }
        current.items.push(m)
      } else {
        current = null
        out.push({ key: `image-${m.no}`, items: [m] })
      }
    }
    return out
  }, [p.materials])

  const rowButtons = (m: MaterialItem) => {
    const uploading = p.uploadingKey === `${m.no}-${m.alt}`
    return (
      <span className="flex shrink-0 items-center gap-1">
        {m.hasSrc && (
          <>
            <button
              onClick={() => p.onRecrop(m)}
              disabled={uploading}
              title={t('panel.row.recropTitle')}
              className="ya-btn-ghost ya-btn ya-btn-sm"
            >
              {t('panel.row.recrop')}
            </button>
            <button
              onClick={() => {
                // Anything inside a multi-image block keeps its placeholder: a
                // grid or a strip with a hole in it is still a layout, whereas
                // deleting the line would quietly change how many cells there are.
                const multi = m.kind !== '单图'
                const what = multi ? t('panel.row.deleteMultiConfirm') : t('panel.row.deleteSingleConfirm')
                if (window.confirm(what)) (multi ? p.onClear : p.onRemove)(m)
              }}
              disabled={uploading}
              title={m.kind !== '单图' ? t('panel.row.clearTitle') : t('panel.row.removeTitle')}
              className="ya-link-btn danger !text-[12px] disabled:opacity-50"
            >
              {t('common.delete')}
            </button>
          </>
        )}
        <button
          onClick={() => pick(m)}
          disabled={uploading}
          className="ya-btn-secondary ya-btn ya-btn-sm"
        >
          {uploading ? t('panel.row.uploading') : m.hasSrc ? t('panel.row.replace') : t('panel.row.upload')}
        </button>
      </span>
    )
  }

  const materialRow = (m: MaterialItem) => (
    <li key={m.no} className="rounded-xl bg-surface-sunken px-3 py-2" style={{ boxShadow: 'var(--shadow-inset)' }}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => p.onJump(m.line)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={t('panel.row.jumpTitle')}
        >
          <span className="shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-brand">{m.no}</span>
          <span className="text-[12px] text-ink-3">
            {t(m.kind === '单图' ? 'panel.kind.single' : m.kind === '轮播' ? 'panel.kind.carousel' : 'panel.kind.gallery')}
          </span>
          {m.hasSrc ? (
            <span className="ml-auto shrink-0 rounded-md bg-ok-100 px-1.5 text-[11px] text-ok-700">{t('panel.row.uploaded')}</span>
          ) : (
            <span className="ml-auto shrink-0 rounded-md bg-warn-100 px-1.5 text-[11px] text-warn-700">{t('panel.row.pending')}</span>
          )}
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-1">{m.desc}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-ink-3">{m.alt || t('common.unnamed')}</span>
        {rowButtons(m)}
      </div>
    </li>
  )

  return (
    <aside className="flex h-full w-full flex-col border-l border-line-2 bg-surface-base">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          if (files.length && pendingRef.current) p.onUpload(files, pendingRef.current)
          e.target.value = ''
        }}
      />
      <Tabs defaultValue="materials" className="flex h-full flex-col">
        <div className="border-b border-line-2 px-3 pt-3">
          <TabsList className="h-8 w-full rounded-xl bg-surface-sunken" style={{ boxShadow: 'var(--shadow-inset)' }}>
            <TabsTrigger value="materials" className="flex-1 rounded-lg text-[12px]">{t('panel.tab.materials')}</TabsTrigger>
            <TabsTrigger value="titles" className="flex-1 rounded-lg text-[12px]">{t('panel.tab.titles')}</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 rounded-lg text-[12px]">{t('panel.tab.settings')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="materials" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>{t('panel.materials.label')}</Label>
          <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-ink-3">
            {t('panel.materials.notice')}
            <Link
              to="/terms"
              className="ml-1 whitespace-nowrap text-brand underline decoration-brand/40 underline-offset-2"
            >
              {t('panel.materials.guideLink')}
            </Link>
          </p>
          {p.materials.length === 0 ? (
            <p className="ya-well p-3 text-[13px] leading-relaxed text-ink-3">
              {t('panel.materials.emptyA')}
              <code className="rounded bg-surface-sunken px-1">{t('panel.materials.emptyCode')}</code>
              {t('panel.materials.emptyB')}
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.key}>
                  {g.ordinal && (
                    <div className="ya-well mb-1.5 flex items-center gap-2 !rounded-xl px-2 py-1.5">
                      <span className="text-[12px] text-ink-2">{t('panel.carousel.n', { n: g.ordinal })}</span>
                      <select
                        value={g.ratio ?? DEFAULT_CAROUSEL_RATIO}
                        onChange={(e) => p.onCarouselRatio(g.ordinal!, e.target.value as CarouselRatio)}
                        title={t('panel.carousel.ratioTitle')}
                        className="rounded-md border-none bg-surface-elevated px-1.5 py-0.5 text-[12px] tabular-nums text-ink-1 outline-none"
                        style={{ boxShadow: 'var(--shadow-flat)' }}
                      >
                        {CAROUSEL_RATIOS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <span className="ml-auto text-[11px] text-ink-3">{t('panel.carousel.group')}</span>
                    </div>
                  )}
                  <ul className="space-y-1.5">{g.items.map(materialRow)}</ul>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="titles" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>{t('panel.titles.label')}</Label>
          {p.titles.filter(Boolean).length === 0 ? (
            <p className="ya-well p-3 text-[12px] leading-relaxed text-ink-3">
              {t('panel.titles.emptyA')}
              <code className="rounded bg-surface-sunken px-1">{t('panel.titles.emptyCode')}</code>
              {t('panel.titles.emptyB')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {p.titles.filter(Boolean).map((title, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2" style={{ boxShadow: 'var(--shadow-inset)' }}>
                  {i === 0 && <span className="mt-0.5 shrink-0 rounded-md bg-brand-100 px-1.5 text-[10px] text-brand">{t('panel.titles.recommended')}</span>}
                  <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-1">{title}</p>
                  <button
                    onClick={() => p.onCopyTitle(title)}
                    className="ya-link-btn shrink-0"
                  >
                    {t('common.copy')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.cover && (
            <>
              <div className="mt-4"><Label>{t('panel.cover.label')}</Label></div>
              <p className="ya-well p-3 text-[12px] leading-relaxed text-ink-2">{p.cover}</p>
            </>
          )}
          <div className="mt-4"><Label>{t('panel.sig.label')}</Label></div>
          <div className="space-y-2">
            {(
              [
                ['layout', t('panel.sig.layout')],
                ['proof', t('panel.sig.proof')],
                ['review', t('panel.sig.review')],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[12px] text-ink-2">{label}</span>
                <input
                  value={p.sig[key]}
                  onChange={(e) => p.onSig({ ...p.sig, [key]: e.target.value })}
                  className="ya-input min-w-0 flex-1 !h-9"
                  placeholder={t('panel.sig.placeholder')}
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            {t('panel.sig.note')}
          </p>
        </TabsContent>

        <TabsContent value="settings" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>{t('panel.settings.experience')}</Label>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2" style={{ boxShadow: 'var(--shadow-inset)' }}>
              <span className="text-[12px] text-ink-1">{t('panel.settings.syncScroll')}</span>
              <button
                onClick={() => p.onSyncScrollChange(!p.syncScroll)}
                aria-pressed={p.syncScroll}
                title={p.syncScroll ? t('panel.settings.syncScrollOnTitle') : t('panel.settings.syncScrollOffTitle')}
                className={`rounded-lg px-2.5 py-0.5 text-[12px] transition-colors ${
                  p.syncScroll ? 'text-ink-1' : 'text-ink-4 hover:text-ink-3'
                }`}
                style={p.syncScroll ? { boxShadow: 'inset 0 0 0 1.5px var(--primary-500)' } : { boxShadow: 'var(--shadow-inset)' }}
              >
                {p.syncScroll ? t('panel.settings.syncScrollOn') : t('panel.settings.syncScrollOff')}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2" style={{ boxShadow: 'var(--shadow-inset)' }}>
              <span className="text-[12px] text-ink-1">{t('panel.settings.zoom')}</span>
              <select
                value={p.zoom}
                onChange={(e) => p.onZoomChange(Number(e.target.value))}
                title={t('panel.settings.zoomTitle')}
                className="rounded-md border-none bg-surface-elevated px-1.5 py-0.5 text-[12px] tabular-nums text-ink-1 outline-none"
                style={{ boxShadow: 'var(--shadow-flat)' }}
              >
                {ZOOM_STEPS.map((z) => (
                  <option key={z} value={z}>{z}%</option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            {t('panel.settings.zoomNote')}
          </p>
          <details className="ya-well mt-4 p-3">
            <summary className="cursor-pointer text-[12px] font-medium text-ink-2">{t('panel.settings.advanced')}</summary>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t('panel.settings.advancedNote')}</p>
            <button data-open-remote-mcp onClick={p.onOpenRemoteMcp} className="ya-btn ya-btn-secondary mt-3">
              {p.remoteConnected ? t('panel.settings.advancedManage') : t('panel.settings.advancedCreate')}
            </button>
          </details>
          <div className="mt-4"><Label>{t('panel.feedback.label')}</Label></div>
          <div className="ya-well p-3">
            <p className="text-[12px] leading-relaxed text-ink-2">
              {t('panel.feedback.note')}
            </p>
            <Link data-open-feedback to="/feedback" className="ya-btn ya-btn-primary ya-btn-sm mt-2.5 inline-flex">
              {t('panel.feedback.open')}
            </Link>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {t('panel.feedback.starPrefix')}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="mx-0.5 text-brand underline decoration-brand/40 underline-offset-2"
              >
                {t('panel.feedback.star')}
              </a>
              {t('panel.feedback.issueMiddle')}
              <a
                href={`${REPO_URL}/issues`}
                target="_blank"
                rel="noreferrer"
                className="mx-0.5 text-brand underline decoration-brand/40 underline-offset-2"
              >
                {t('panel.feedback.issue')}
              </a>
              {t('panel.feedback.issueSuffix')}
            </p>
          </div>
          <div className="mt-4"><Label>{t('panel.credits.label')}</Label></div>
          <p className="ya-well p-3 text-[12px] leading-relaxed text-ink-2">
            {t('panel.credits.bodyLead')}
            {CREDITS.map((c) => c.name).join(t('common.listSep'))}
            {t('panel.credits.bodyTail', {
              n: CREDITS.length,
              licenses: [...new Set(CREDITS.map((c) => c.license))].join(' / '),
            })}
            <Link
              to="/references"
              className="ml-1 whitespace-nowrap text-brand underline decoration-brand/40 underline-offset-2"
            >
              {t('panel.credits.link')}
            </Link>
          </p>
          <div className="mt-4"><Label>{t('panel.terms.label')}</Label></div>
          <p className="ya-well p-3 text-[12px] leading-relaxed text-ink-2">
            {t('panel.terms.body')}
            <Link
              to="/terms"
              className="ml-1 whitespace-nowrap text-brand underline decoration-brand/40 underline-offset-2"
            >
              {t('panel.terms.link')}
            </Link>
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
