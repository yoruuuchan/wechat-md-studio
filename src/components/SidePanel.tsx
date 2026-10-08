import { useMemo, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MaterialItem } from '@/lib/render'
import { CAROUSEL_RATIOS, DEFAULT_CAROUSEL_RATIO, type CarouselRatio, type SignatureConfig } from '@/lib/types'

interface Props {
  materials: MaterialItem[]
  titles: string[]
  cover: string
  sig: SignatureConfig
  onSig: (s: SignatureConfig) => void
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
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="ya-eyebrow mb-2">{children}</p>
}

export default function SidePanel(p: Props) {
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
              title="重新裁切这张图（用已上传的原图）"
              className="ya-btn-ghost ya-btn ya-btn-sm"
            >
              重裁
            </button>
            <button
              onClick={() => {
                // Anything inside a multi-image block keeps its placeholder: a
                // grid or a strip with a hole in it is still a layout, whereas
                // deleting the line would quietly change how many cells there are.
                const multi = m.kind !== '单图'
                const what = multi ? '清空这张图的引用？占位会留着，可以重新传。' : '删掉这张图？正文里对应的那一行会一起移除。'
                if (window.confirm(what)) (multi ? p.onClear : p.onRemove)(m)
              }}
              disabled={uploading}
              title={m.kind !== '单图' ? '清空引用，保留占位' : '删除这一行图片'}
              className="ya-link-btn danger !text-[12px] disabled:opacity-50"
            >
              删除
            </button>
          </>
        )}
        <button
          onClick={() => pick(m)}
          disabled={uploading}
          className="ya-btn-secondary ya-btn ya-btn-sm"
        >
          {uploading ? '上传中…' : m.hasSrc ? '替换' : '上传'}
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
          title="点击定位到编辑器对应行"
        >
          <span className="shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-brand">{m.no}</span>
          <span className="text-[12px] text-ink-3">{m.kind}</span>
          {m.hasSrc ? (
            <span className="ml-auto shrink-0 rounded-md bg-ok-100 px-1.5 text-[11px] text-ok-700">已传图</span>
          ) : (
            <span className="ml-auto shrink-0 rounded-md bg-warn-100 px-1.5 text-[11px] text-warn-700">待插图</span>
          )}
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-1">{m.desc}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-ink-3">{m.alt || '未命名'}</span>
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
            <TabsTrigger value="materials" className="flex-1 rounded-lg text-[12px]">素材</TabsTrigger>
            <TabsTrigger value="titles" className="flex-1 rounded-lg text-[12px]">标题</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 rounded-lg text-[12px]">设置</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="materials" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>素材清单 · 点击上传直接回填</Label>
          {p.materials.length === 0 ? (
            <p className="ya-well p-3 text-[13px] leading-relaxed text-ink-3">
              正文中还没有图片。用 <code className="rounded bg-surface-sunken px-1">![图注说明]()</code> 添加占位，或直接把图片拖进编辑器。
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.key}>
                  {g.ordinal && (
                    <div className="ya-well mb-1.5 flex items-center gap-2 !rounded-xl px-2 py-1.5">
                      <span className="text-[12px] text-ink-2">轮播 {g.ordinal}</span>
                      <select
                        value={g.ratio ?? DEFAULT_CAROUSEL_RATIO}
                        onChange={(e) => p.onCarouselRatio(g.ordinal!, e.target.value as CarouselRatio)}
                        title="整个轮播统一用这个比例，改完所有图需要重传"
                        className="rounded-md border-none bg-surface-elevated px-1.5 py-0.5 text-[12px] tabular-nums text-ink-1 outline-none"
                        style={{ boxShadow: 'var(--shadow-flat)' }}
                      >
                        {CAROUSEL_RATIOS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <span className="ml-auto text-[11px] text-ink-3">整组统一</span>
                    </div>
                  )}
                  <ul className="space-y-1.5">{g.items.map(materialRow)}</ul>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="titles" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>标题候选 · 不进正文</Label>
          {p.titles.filter(Boolean).length === 0 ? (
            <p className="ya-well p-3 text-[12px] leading-relaxed text-ink-3">
              在稿件开头的 front matter 里写 <code className="rounded bg-surface-sunken px-1">titles:</code> 列表，候选标题会出现在这里。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {p.titles.filter(Boolean).map((t, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2" style={{ boxShadow: 'var(--shadow-inset)' }}>
                  {i === 0 && <span className="mt-0.5 shrink-0 rounded-md bg-brand-100 px-1.5 text-[10px] text-brand">推荐</span>}
                  <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-1">{t}</p>
                  <button
                    onClick={() => p.onCopyTitle(t)}
                    className="ya-link-btn shrink-0"
                  >
                    复制
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.cover && (
            <>
              <div className="mt-4"><Label>封面说明</Label></div>
              <p className="ya-well p-3 text-[12px] leading-relaxed text-ink-2">{p.cover}</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="settings" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>署名 · @signature 展开内容</Label>
          <div className="space-y-2">
            {(
              [
                ['layout', '排版'],
                ['proof', '校对'],
                ['review', '审核'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[12px] text-ink-2">{label}</span>
                <input
                  value={p.sig[key]}
                  onChange={(e) => p.onSig({ ...p.sig, [key]: e.target.value })}
                  className="ya-input min-w-0 flex-1 !h-9"
                  placeholder="姓名"
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            署名跟着稿件走，保存在账号里。稿件存在云端，换设备也能打开。
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
