import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Toaster, toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import TopBar from '@/components/TopBar'
import EditorPane, { type EditorHandle } from '@/components/EditorPane'
import PreviewPane from '@/components/PreviewPane'
import SidePanel from '@/components/SidePanel'
import RatioPicker from '@/components/RatioPicker'
import ManualCropper from '@/components/ManualCropper'
import { useSyncScroll, type PreviewScrollHandle } from '@/hooks/useSyncScroll'
import { createMathRenderer, type MathSnapshot } from '@/lib/math'
import {
  diagramOf,
  loadDiagramCache,
  rememberDiagram,
  saveDiagramCache,
  type DiagramCache,
} from '@/lib/diagram'
import { renderDiagramPng } from '@/lib/diagram-raster'
import { parseMarkdown } from '@/lib/parse'
import {
  renderDoc,
  collectMaterials,
  fillImageSrc,
  clearImageSrc,
  removeImageLine,
  setCarouselRatio,
  canLocateImage,
  type MaterialItem,
} from '@/lib/render'
import { getTheme } from '@/lib/themes'
import { cleanHtml, copyPlain, copyRichText, downloadFile, previewPage } from '@/lib/clipboard'
import { applyZoom, createDoc, loadSettings, saveSettings, type DocRecord } from '@/lib/store'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useDocs, UNDO_DELETE_MS } from '@/hooks/useDocs'
import { CHEATSHEET } from '@/lib/sample'
import { useAuth } from '@/hooks/useAuth'
import { trpc } from '@/providers/trpc'
import { blobToBase64, compressForUpload, cropToRatio, fileFromImageUrl, filenameForMime } from '@/lib/image'
import { DEFAULT_CAROUSEL_RATIO, type CarouselRatio } from '@/lib/types'
import {
  bundleFilename,
  docxToDocxImport,
  parseBundle,
  parseMarkdownFile,
  safeFilename,
  toBundle,
  toMarkdownFile,
} from '@/lib/import-export'

function plainTextOf(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

// 三栏各自的拖拽宽度，跨刷新记住。布局以 panel id 为键；侧栏折叠时它的记录
// 留着，下次打开先按 defaultSize 恢复。
const LAYOUT_KEY = 'mopai.layout.v1'
function loadLayout(): Record<string, number> | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : undefined
  } catch {
    return undefined
  }
}

// img:key → 本站稳定图片地址（复制进公众号后由微信转存）
function resolveImg(src: string): string {
  if (src.startsWith('img:')) return `${window.location.origin}/api/img/${src.slice(4)}`
  return src
}

/** Human-readable size, for reporting what compression saved. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** When the cloud version of a conflicted article was last written. */
function formatMoment(ts: number): string {
  if (!ts) return '未知时间'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The cloud side of a conflict can be megabytes; a long look, not a full one. */
const CONFLICT_PREVIEW_CHARS = 20_000

/** One pending upload: the files, where they go, and whether a ratio is required. */
interface FrameTask {
  files: File[]
  mode: 'carousel' | 'loose'
  /** Which sidebar slot was clicked; absent for a plain drag-and-drop. */
  item?: MaterialItem
  /** Ratio already fixed by the carousel, if it has one. */
  locked?: CarouselRatio
  /** Ratio chosen in the picker, carried over to the manual cropper. */
  ratio?: CarouselRatio | null
  /**
   * Set when re-cropping an existing image. The stored object keeps its old key
   * after the new one is uploaded, so this is what lets us tell the owner that
   * the previous copy is now unreferenced.
   */
  replacedKey?: string
  /**
   * Document position a drop landed on, so the image goes where it was dropped
   * rather than wherever the cursor last was. Null for a clipboard paste.
   */
  at?: number | null
}

export default function EditorPage() {
  const [settings, setSettings] = useState(loadSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  // Read once at mount: the group is uncontrolled, later drags come back
  // through onLayoutChange.
  const [initialLayout] = useState(loadLayout)
  const layoutRef = useRef<Record<string, number>>(initialLayout ?? {})
  const [previewWidth, setPreviewWidth] = useState<375 | 677>(375)
  const [copied, setCopied] = useState(false)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [frameTask, setFrameTask] = useState<FrameTask | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  // The conflict dialog opens by itself when a save comes back conflicting, and
  // can be postponed (the pending conflict stays visible as a bar over the
  // editor) — deciding is required before that article syncs again.
  const [conflictOpen, setConflictOpen] = useState(false)
  const importKindRef = useRef<'markdown' | 'docx' | 'bundle'>('markdown')
  const importRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewScrollHandle>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, isAuthenticated, isLoading: authLoading, isFetching: authFetching, logout } = useAuth()

  // An agent hands the owner `<origin>/?doc=<id>`; this is where that lands.
  const deepLinkId = searchParams.get('doc')
  const clearDeepLink = useCallback(() => {
    // Drop the parameter once it has been applied, so the address bar does not
    // keep naming an article she has since switched away from.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('doc')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const {
    docs,
    setDocs,
    activeId,
    setActiveId,
    activeDoc,
    activeLoading,
    activeError,
    retryHydrate,
    activeConflict,
    resolveConflictKeepLocal,
    resolveConflictUseRemote,
    resolveConflictKeepBoth,
    hydrateAllForExport,
    syncState,
    notice,
    clearNotice,
    hasUnsavedChanges,
    neverSaved,
    addDoc,
    addSampleDoc,
    removeDoc,
    undoRemove,
    saveCurrentToDrafts,
  } = useDocs({ enabled: isAuthenticated, deepLinkId, onDeepLinkSettled: clearDeepLink })

  const uploadMutation = trpc.storage.upload.useMutation()

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => applyZoom(settings.zoom), [settings.zoom])

  // The article behind an agent's link only exists on the server, so it needs a
  // session. Hand the id to the login page in the URL and let it come back.
  //
  // isFetching matters as much as isLoading here: auth.me caches `null` for a
  // signed-out visitor, so isLoading is already false while the refetch that
  // follows a successful login is still in flight. Redirecting on that stale
  // answer throws a freshly signed-in owner straight back to /login.
  useEffect(() => {
    if (!deepLinkId || authLoading || authFetching || isAuthenticated) return
    navigate(`/login?doc=${encodeURIComponent(deepLinkId)}`, { replace: true })
  }, [deepLinkId, authLoading, authFetching, isAuthenticated, navigate])

  useEffect(() => {
    if (!notice) return
    toast.info(notice, { duration: 6000 })
    clearNotice()
  }, [notice, clearNotice])

  // A conflict on the open article pulls the dialog up on its own; a postponed
  // one leaves the bar above the editor until it is resolved.
  const conflictKey = activeConflict ? `${activeId}:${activeConflict.hash}` : null
  useEffect(() => {
    if (conflictKey) setConflictOpen(true)
  }, [conflictKey])

  const theme = getTheme(settings.themeId)

  // Parsing, rendering and the materials list are all O(document) and used to run
  // on every keystroke. Deferring the content keeps the keystroke itself on the
  // urgent path; the preview simply catches up a frame later. Reads that write
  // back into the source deliberately use activeDoc.content, never this.
  const deferredContent = useDeferredValue(activeDoc?.content || '')
  const parsed = useMemo(() => parseMarkdown(deferredContent), [deferredContent])

  // MathJax is tens of megabytes of dependencies, so it loads on the first
  // article that actually contains a formula and every result is cached after.
  const mathRenderer = useMemo(() => createMathRenderer(), [])
  // Turndown and its DOM parser cost about a hundred kilobytes of first-load
  // bundle for an interaction most sessions never perform, so the converter is
  // warmed a moment after mount instead of being imported statically.
  const richPasteRef = useRef<typeof import('@/lib/rich-paste') | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => {
      void import('@/lib/rich-paste').then((m) => {
        richPasteRef.current = m
      })
    }, 1200)
    return () => window.clearTimeout(t)
  }, [])
  // The cache lives outside React, so the page holds an immutable view of it and
  // swaps that view whenever a formula lands. Depending on the view - rather than
  // on a counter the linter would call unnecessary - is what makes the re-render
  // below actually happen.
  const [mathSvgs, setMathSvgs] = useState<MathSnapshot>(() => mathRenderer.snapshot())
  useEffect(() => {
    setMathSvgs(mathRenderer.snapshot())
    return mathRenderer.subscribe(() => setMathSvgs(mathRenderer.snapshot()))
  }, [mathRenderer])
  useEffect(() => {
    const have = mathRenderer.snapshot()
    for (const b of parsed.blocks) {
      if (b.type === 'math' && have.get(b.tex, b.display) === null) {
        void mathRenderer.warm(b.tex, b.display)
      }
    }
  }, [parsed, mathRenderer])

  // A mermaid fence stays a fence in the author's Markdown; the uploaded PNG is a
  // derived cache keyed by the exact source, so editing the diagram invalidates
  // it and an exported .md still renders on GitHub.
  const [diagramRefs, setDiagramRefs] = useState<DiagramCache>(loadDiagramCache)
  const resolveDiagram = useCallback((code: string) => diagramRefs.get(code) ?? null, [diagramRefs])
  const diagramBusy = useRef(new Set<string>())
  const diagramFailed = useRef(new Set<string>())
  const [diagramPending, setDiagramPending] = useState(0)

  const rendered = useMemo(
    () =>
      renderDoc(
        parsed,
        theme,
        settings.sig,
        resolveImg,
        (tex, display) => mathSvgs.get(tex, display),
        resolveDiagram,
      ),
    [parsed, theme, settings.sig, mathSvgs, resolveDiagram],
  )
  const materials = useMemo(() => collectMaterials(parsed, resolveDiagram), [parsed, resolveDiagram])

  const { onEditorScroll, onPreviewScroll } = useSyncScroll({
    enabled: settings.syncScroll,
    blocks: parsed.blocks,
    editorRef,
    previewRef,
  })

  const updateActive = (patch: Partial<DocRecord>) => {
    setDocs((ds) => ds.map((d) => (d.id === activeId ? { ...d, ...patch, updatedAt: Date.now() } : d)))
  }

  const handleCopy = async () => {
    if (diagramPending > 0) {
      toast.info('图表还在生成图片', {
        description: '等它变成插图再复制，否则粘进公众号的是 mermaid 源码',
      })
      return
    }
    const ok = await copyRichText(cleanHtml(rendered.html), plainTextOf(rendered.html))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(`已复制 ${rendered.stats.chars} 字 · ${rendered.stats.images} 图`, {
        description: '直接粘贴进公众号后台正文即可',
      })
    } else {
      toast.error('复制失败', { description: '浏览器拒绝了剪贴板权限，请改用「导出」' })
    }
  }

  const handleExport = (kind: 'clean' | 'page' | 'markdown' | 'bundle') => {
    const name = activeDoc?.name || '推文'
    if (kind === 'markdown') {
      const f = toMarkdownFile(name, activeDoc?.content || '')
      downloadFile(f.filename, f.content, f.mime)
      toast.success('已导出 Markdown 源稿', { description: '方言标记原样保留，可以再导回来' })
      return
    }
    if (kind === 'bundle') {
      // The list holds metadata only, so most articles' bodies are not in
      // memory. Fetch every missing one first — a backup that silently
      // contained empty articles would be worse than no backup at all.
      void (async () => {
        const res = await hydrateAllForExport()
        if (!res.ok) {
          toast.error('整包备份没有导出', { description: res.message, duration: 9000 })
          return
        }
        downloadFile(bundleFilename(res.docs.length), toBundle(res.docs, settings), 'application/json')
        toast.success(`已导出 ${res.docs.length} 篇稿件`, { description: '含主题与署名设置，可在另一台设备导回' })
      })()
      return
    }
    const safe = safeFilename(name, '推文', 'html')
    if (kind === 'clean') downloadFile(safe.replace(/\.html$/, '_正文.html'), cleanHtml(rendered.html))
    else downloadFile(safe.replace(/\.html$/, '_预览页.html'), previewPage(rendered.html, name))
    toast.success(kind === 'clean' ? '已导出干净正文 HTML' : '已导出预览页 HTML')
  }

  /** Upload the images a Word document carried and fill them back into the placeholders. */
  const importDocx = async (file: File) => {
    const { htmlToDialect } = await import('@/lib/rich-paste')
    const imported = await docxToDocxImport(await file.arrayBuffer(), htmlToDialect)
    let markdown = imported.markdown
    if (imported.images.length) {
      const refs = await Promise.all(
        imported.images.map(async (img) => {
          try {
            const res = await uploadMutation.mutateAsync({
              name: `docx-${Date.now()}.png`,
              contentBase64: img.dataUri.split(',')[1] || '',
              contentType: img.contentType,
            })
            return `img:${res.key}`
          } catch {
            return null
          }
        }),
      )
      markdown = (await import('@/lib/rich-paste')).fillImageSlots(markdown, refs.map((r) => r ?? ''))
      const failed = refs.filter((r) => r === null).length
      if (failed) toast.warning(`${failed} 张图片没传上去，正文里留了占位`)
    }
    const doc = createDoc()
    doc.name = safeFilename(file.name.replace(/\.[^.]+$/, ''), '导入的稿件', '') || '导入的稿件'
    doc.content = markdown
    setDocs((ds) => [doc, ...ds])
    setActiveId(doc.id)
    toast.success(`已导入「${doc.name}」`, {
      description: imported.images.length ? `含 ${imported.images.length} 张图片` : undefined,
    })
  }

  const handleImportFile = async (file: File, kind: 'markdown' | 'docx' | 'bundle') => {
    setImporting(true)
    try {
      if (kind === 'docx') {
        await importDocx(file)
        return
      }
      const text = await file.text()
      if (kind === 'markdown') {
        const parsedFile = parseMarkdownFile(text, file.name)
        const doc = createDoc()
        doc.name = parsedFile.name
        doc.content = parsedFile.content
        setDocs((ds) => [doc, ...ds])
        setActiveId(doc.id)
        toast.success(`已导入「${doc.name}」`)
        return
      }
      const result = parseBundle(text)
      if (!result.ok) {
        toast.error('这个备份文件读不了', { description: result.reason, duration: 9000 })
        return
      }
      // Ids are kept as they are: the server's own importLocal already resolves a
      // collision by keeping the stored copy, and inventing new ids here would
      // silently duplicate every article instead.
      const known = new Set(docs.map((d) => d.id))
      const incoming = result.docs.filter((d) => !known.has(d.id))
      const skipped = result.docs.length - incoming.length
      setDocs((ds) => [...incoming, ...ds])
      if (result.settings) setSettings((s) => ({ ...s, ...result.settings! }))
      toast.success(`已导入 ${incoming.length} 篇稿件`, {
        description: skipped ? `另有 ${skipped} 篇和本机重名，已跳过` : undefined,
      })
    } catch (e) {
      toast.error('导入失败', { description: e instanceof Error ? e.message : '文件格式不认识' })
    } finally {
      setImporting(false)
    }
  }

  /** Upload one file, optionally auto-cropping to a carousel frame first. */
  const uploadOne = async (file: File, ratio?: CarouselRatio): Promise<{ ref: string; saved: string | null }> => {
    const payload = ratio ? await cropToRatio(file, ratio) : null
    // A loose image is the one that needs shrinking: a 12MP phone photo used to go
    // up at full size for an article that is at most 677px wide.
    const loose = payload ? null : await compressForUpload(file)
    const blob = payload ? payload.blob : loose!.blob
    const mime = payload ? payload.mime : loose!.mime
    const contentBase64 = await blobToBase64(blob)
    const uploadName = filenameForMime(file.name.replace(/[^\w.一-鿿-]+/g, '_'), mime)
    const res = await uploadMutation.mutateAsync({ name: uploadName, contentBase64, contentType: mime })
    const saved =
      loose && !loose.untouched
        ? `${formatBytes(loose.sourceBytes)} → ${formatBytes(loose.bytes)}${loose.grew ? '（压完更大，用了原图）' : ''}`
        : null
    return { ref: `img:${res.key}`, saved }
  }

  /** Upload an already-cropped blob produced by the manual cropper. */
  const uploadBlob = async (blob: Blob, mime: string, originalName: string) => {
    const contentBase64 = await blobToBase64(blob)
    const res = await uploadMutation.mutateAsync({
      name: filenameForMime(originalName, mime),
      contentBase64,
      contentType: mime,
    })
    return `img:${res.key}`
  }

  // Reached through a ref so the diagram pass below can depend on the document
  // alone. Depending on uploadBlob directly would re-run that effect on every
  // render and keep resetting its debounce.
  const uploadDiagram = useRef<(blob: Blob) => Promise<string>>(() =>
    Promise.reject(new Error('not ready')),
  )
  useEffect(() => {
    uploadDiagram.current = (blob) =>
      uploadBlob(blob, 'image/png', `diagram-${Date.now().toString(36)}.png`)
  })

  /**
   * Rasterize every mermaid fence that has no PNG yet, then upload it.
   *
   * A diagram that cannot be built - bad syntax, no account, no network - leaves
   * the fence rendering as source code, which is the useful thing to show. The
   * source is parked after one failure instead of being retried, because the next
   * keystroke would fail identically and toast identically.
   */
  useEffect(() => {
    // A set: the same diagram pasted twice must not be uploaded twice.
    const wanted = new Set<string>()
    for (const b of parsed.blocks) {
      // A fence the author has just opened holds no diagram yet; rasterizing it
      // would only produce a syntax error.
      if (b.type === 'code' && b.code.trim() && diagramOf(b.lang)) wanted.add(b.code)
    }
    if (!wanted.size) return
    const todo = [...wanted].filter(
      (code) =>
        !diagramRefs.has(code) && !diagramBusy.current.has(code) && !diagramFailed.current.has(code),
    )
    if (!todo.length) return

    const park = (code: string, title: string, e: unknown) => {
      diagramFailed.current.add(code)
      toast.error(title, {
        description: e instanceof Error ? e.message.slice(0, 140) : String(e),
        duration: 8000,
      })
    }
    const rasterize = async (code: string) => {
      diagramBusy.current.add(code)
      setDiagramPending((n) => n + 1)
      try {
        const png = await renderDiagramPng(code)
        try {
          const ref = await uploadDiagram.current(png.blob)
          setDiagramRefs((prev) => {
            const next = new Map(prev)
            rememberDiagram(next, code, ref)
            saveDiagramCache(next)
            return next
          })
        } catch (e) {
          park(code, '图表上传失败，正文里先保留源码', e)
        }
      } catch (e) {
        park(code, '图表语法有误，正文里保留源码', e)
      } finally {
        diagramBusy.current.delete(code)
        setDiagramPending((n) => n - 1)
      }
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        for (const code of todo) {
          if (!diagramBusy.current.has(code)) await rasterize(code)
        }
      })()
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [parsed, diagramRefs])

  /**
   * Tell the owner their previous upload is now unreferenced.
   *
   * Uploading always mints a fresh key, so a re-crop leaves the old object in R2
   * with nothing pointing at it. We deliberately do not delete it here: another
   * device may hold a local (unsynced) draft that still references it, and the
   * server cannot see those. The materials page can, so point there.
   */
  const announceReplacedImage = () => {
    toast.info('旧的那张图已经不再引用', {
      description: '它还在素材库里，可以去「素材库 → 没在用的旧图」清理',
      duration: 8000,
      action: { label: '去清理', onClick: () => navigate('/materials') },
    })
  }

  /**
   * Put a re-cropped image back into the slot it came from. Distinct from the
   * insert path: the line already exists, so it must be overwritten rather than
   * added alongside.
   */
  const replaceRecropped = (ref: string, task: FrameTask) => {
    if (!task.item || !activeDoc) return
    const next = fillImageSrc(activeDoc.content, task.item.alt, task.item.occurrence, ref)
    if (next === activeDoc.content) {
      toast.error(`${task.item.no} 定位失败`, { description: '正文里找不到这张图，新图没有回填' })
      return
    }
    updateActive({ content: next })
    toast.success(`${task.item.no} 已按新裁切替换`)
    announceReplacedImage()
  }

  /** Loose images: dropped into the editor at the cursor. Cropping is optional. */
  const uploadLoose = async (files: File[], ratio?: CarouselRatio | null, task?: FrameTask | null) => {
    for (const file of files) {
      if (!/^image\//.test(file.type)) {
        toast.error(`${file.name} 不是图片，已跳过`)
        continue
      }
      setUploadingKey(`drop-${file.name}`)
      try {
        const { ref, saved } = await uploadOne(file, ratio ?? undefined)
        if (task?.item && task.replacedKey) {
          // Re-crop of a standalone image via the ratio picker: replace in place.
          replaceRecropped(ref, task)
          continue
        }
        const alt = file.name.replace(/\.[^.]+$/, '')
        editorRef.current?.insertAt(task?.at ?? null, `![${alt}](${ref})`)
        toast.success(files.length > 1 ? `${file.name} 已插入` : '图片已插入', {
          description: saved ?? undefined,
        })
      } catch (e) {
        toast.error(`${file.name} 上传失败`, {
          description: e instanceof Error ? e.message : '请稍后重试',
        })
      } finally {
        setUploadingKey(null)
      }
    }
  }

  /** Clear one carousel slide back to a placeholder, keeping the slide line. */
  const clearImage = (item: MaterialItem) => {
    if (!activeDoc) return
    const next = clearImageSrc(activeDoc.content, item.alt, item.occurrence)
    if (next === activeDoc.content) {
      toast.error(`${item.no} 定位失败`, { description: '正文里找不到这张图，请手动修改' })
      return
    }
    updateActive({ content: next })
    toast.success(`${item.no} 已清空，占位保留`)
  }

  /** Remove a standalone image line entirely. */
  const removeImage = (item: MaterialItem) => {
    if (!activeDoc) return
    const next = removeImageLine(activeDoc.content, item.alt, item.occurrence)
    if (next === activeDoc.content) {
      toast.error(`${item.no} 定位失败`, { description: '正文里找不到这张图，请手动修改' })
      return
    }
    updateActive({ content: next })
    toast.success(`${item.no} 已从正文移除`)
  }

  /**
   * Change the frame of a whole carousel. Existing images keep their old frame,
   * so they are flagged for re-upload rather than pretending they still fit.
   */
  const changeCarouselRatio = (ordinal: number, ratio: CarouselRatio) => {
    if (!activeDoc) return
    updateActive({ content: setCarouselRatio(activeDoc.content, ordinal, ratio) })
    const stale = materials.filter((m) => m.carouselOrdinal === ordinal && m.hasSrc && m.ratio !== ratio)
    if (stale.length) {
      toast.info(`轮播 ${ordinal} 已改成 ${ratio}`, {
        description: `已有 ${stale.length} 张图还是旧比例，点每张的「重裁」或「替换」重做一次`,
      })
    } else {
      toast.success(`轮播 ${ordinal} 已改成 ${ratio}`)
    }
  }

  /**
   * Re-crop an image that is already uploaded. The stored image is fetched back
   * and re-uploaded under a new key, so the old one can be cleaned up later.
   */
  const recropImage = async (item: MaterialItem) => {
    if (!activeDoc) return
    const key = item.src.startsWith('img:') ? item.src.slice(4) : ''
    if (!key) {
      toast.error('这张图不是本工具上传的，无法重裁')
      return
    }
    setUploadingKey(`${item.no}-${item.alt}`)
    try {
      const file = await fileFromImageUrl(`${window.location.origin}/api/img/${key}`, item.alt || 'image')
      // Hand it to the same manual cropper, which keeps the carousel ratio.
      // Remember the old key so the owner can be told the previous copy is now
      // unused; uploading always mints a new key, so the old object stays behind.
      setFrameTask({
        files: [file],
        item,
        mode: item.kind === '轮播' ? 'carousel' : 'loose',
        replacedKey: key,
      })
      setManualOpen(true)
    } catch (e) {
      toast.error('取回原图失败', { description: e instanceof Error ? e.message : '请稍后重试' })
    } finally {
      setUploadingKey(null)
    }
  }

  /** Result of the manual cropper: a blob instead of the original file. */
  const uploadCroppedBlob = async (blob: Blob, mime: string, task: FrameTask) => {
    const file = task.files[0]
    if (!file) return
    const label = task.item?.no ?? file.name
    const isRecrop = Boolean(task.item && task.replacedKey)
    setUploadingKey(task.item ? `${task.item.no}-${task.item.alt}` : `drop-${file.name}`)
    try {
      const ref = await uploadBlob(blob, mime, file.name)
      if (task.mode === 'carousel' && task.item && activeDoc) {
        let content = activeDoc.content
        if (task.item.ratio !== task.ratio && task.ratio) {
          content = setCarouselRatio(content, task.item.carouselOrdinal!, task.ratio)
        }
        updateActive({ content: fillImageSrc(content, task.item.alt, task.item.occurrence, ref) })
        toast.success(`${label} 已按手动裁切上传并回填`)
        if (isRecrop) announceReplacedImage()
      } else if (isRecrop) {
        replaceRecropped(ref, task)
      } else {
        const alt = file.name.replace(/\.[^.]+$/, '')
        editorRef.current?.insertAt(task.at ?? null, `![${alt}](${ref})`)
        toast.success('已按手动裁切插入')
      }
    } catch (e) {
      toast.error('上传失败', { description: e instanceof Error ? e.message : '请稍后重试' })
    } finally {
      setUploadingKey(null)
    }
  }

  /**
   * Fill consecutive slots of one multi-image block (carousel or gallery).
   *
   * Both kinds address their images by occurrence, so the filling logic is
   * shared. What differs is where the frame ratio lives: a carousel's is chosen
   * in the side panel and written back into its opener, a gallery's is written in
   * its fence line by hand — so only a carousel has an ordinal, and only a
   * carousel needs the source rewritten here.
   */
  const uploadToGroup = async (files: File[], item: MaterialItem, ratio: CarouselRatio) => {
    if (!activeDoc) return
    let content = activeDoc.content
    if (item.carouselOrdinal && item.ratio !== ratio) {
      content = setCarouselRatio(content, item.carouselOrdinal, ratio)
    }
    const where = item.kind === '画廊' ? '网格' : '轮播'
    let okCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // A block's images are consecutive `![` slots in the source. Fill from the
      // clicked slot onward by index, so a multi-file drop lands in order.
      // (The old code substituted the file name as the caption, which never
      // matched the placeholder text and made every file after the first fail
      // silently.)
      const occurrence = item.occurrence + i
      // Each slot is addressed by its own caption, not the clicked one:
      // captions may differ between slots, and checking them all against the
      // clicked caption refused every file after the first.
      const slot = materials.find((m) => m.occurrence === occurrence)
      const sameGroup =
        slot?.kind === item.kind &&
        (item.carouselOrdinal ? slot.carouselOrdinal === item.carouselOrdinal : slot.line === item.line)
      if (!slot || !sameGroup || !canLocateImage(content, slot.alt, occurrence)) {
        toast.warning(`${file.name} 没有对应的空位`, {
          description: `这个${where}里已经没有更多占位行，多出的图请手动插入`,
        })
        continue
      }
      setUploadingKey(`${item.no}-${item.alt}`)
      try {
        const { ref } = await uploadOne(file, ratio)
        content = fillImageSrc(content, slot.alt, occurrence, ref)
        okCount++
      } catch (e) {
        toast.error(`${file.name} 上传失败`, {
          description: e instanceof Error ? e.message : '请稍后重试',
        })
      } finally {
        setUploadingKey(null)
      }
    }
    updateActive({ content })
    // Only claim success for slides that actually uploaded; every failure has
    // already raised its own error toast, so an all-failed batch stays quiet
    // instead of congratulating itself.
    if (files.length > 1) {
      if (okCount > 0) {
        toast.success(
          okCount === files.length
            ? `${okCount} 张已按 ${ratio} 裁切上传`
            : `${okCount}/${files.length} 张已按 ${ratio} 裁切上传`,
          { description: '这个轮播里剩下的占位请逐张点上传，会自动沿用同一比例' },
        )
      }
    } else if (okCount > 0) {
      toast.success(`${item.no} 已按 ${ratio} 裁切上传并回填`)
    }
  }

  /**
   * Images that arrived through the editor itself: a clipboard paste or a drop.
   * Distinct from startUpload, which comes from a sidebar slot that already knows
   * which image it is filling.
   */
  const handleEditorFiles = (files: File[], at: number | null) => {
    const images = files.filter((f) => /^image\//.test(f.type))
    if (images.length < files.length) {
      const bad = files.find((f) => !/^image\//.test(f.type))!
      toast.error(`${bad.name} 不是图片，已跳过`)
    }
    if (!images.length) return
    setFrameTask({ files: images, mode: 'loose', at })
  }

  /**
   * Clipboard HTML from Word / Feishu / Notion. Returning false hands the event
   * back to CodeMirror, which pastes the plain text - the right outcome when the
   * clipboard already holds Markdown or ordinary prose, and also the fallback for
   * the first instants of a session before the converter module has loaded.
   */
  const handleHtml = (html: string, plain: string): boolean => {
    const rp = richPasteRef.current
    if (!rp) return false
    const d = rp.classifyPaste(html, plain)
    if (d.kind === 'image-placeholder') {
      // Claim the event: inserting "[Image #1]" into the article helps nobody.
      toast.error('拿不到真实图片', { description: d.reason, duration: 9000 })
      return true
    }
    if (d.kind === 'ide-code' || d.kind === 'code-block') {
      editorRef.current?.insertAt(null, '```' + d.lang + '\n' + plain.replace(/\s+$/, '') + '\n```')
      toast.success('已作为代码块插入', { description: d.reason })
      return true
    }
    if (!d.convert) return false
    const md = rp.htmlToDialect(html)
    if (!md.trim()) return false
    editorRef.current?.insertAt(null, md)
    toast.success('已按公众号语法转换', {
      description: '粘贴进来的图片不会自动上传，需要单独插入',
    })
    return true
  }

  /** Entry point from the sidebar: decide whether a ratio has to be chosen first. */
  const startUpload = (files: File[], item: MaterialItem) => {
    const bad = files.find((f) => !/^image\//.test(f.type))
    if (bad) {
      toast.error(`${bad.name} 不是图片`)
      return
    }
    if (item.kind === '单图') {
      // 单图不强制裁切，但给一个选项，省得想统一高度时还得重传
      setFrameTask({ files, item, mode: 'loose' })
      return
    }
    if (item.kind === '画廊') {
      // A gallery's frame is written in its fence line, so there is nothing to
      // pick here — lock the ratio and leave only how to frame the shot. Without
      // the crop the cells keep their own shapes and the grid rows go ragged.
      setFrameTask({ files, item, mode: 'carousel', locked: item.ratio })
      return
    }
    // Carousel slides always get the dialog. When the carousel ratio is already
    // fixed the picker locks it, so the choice left is how to frame the shot -
    // auto centre-crop or manual. Uploading straight through would silently skip
    // cropping and break the uniform frame.
    const carouselHasImage = materials.some((m) => m.carouselOrdinal === item.carouselOrdinal && m.hasSrc)
    setFrameTask({
      files,
      item,
      mode: 'carousel',
      locked: carouselHasImage ? item.ratio : undefined,
    })
  }

  return (
    <div className="ya-page flex h-screen flex-col overflow-hidden">
      <TopBar
        docs={docs}
        activeId={activeId}
        docName={activeDoc?.name || ''}
        onRename={(name) => updateActive({ name })}
        onSelectDoc={setActiveId}
        onCreateDoc={() => addDoc()}
        onCreateSample={() => addSampleDoc()}
        onDeleteDoc={(id) => {
          const name = docs.find((d) => d.id === id)?.name || '未命名稿件'
          removeDoc(id)
          toast(`「${name}」已移入回收站`, {
            description: '10 秒内可以撤销，之后去草稿箱的回收站找回',
            duration: UNDO_DELETE_MS,
            action: {
              label: '撤销',
              onClick: () => {
                void undoRemove(id).then((ok) => {
                  if (ok) toast.success('已恢复')
                })
              },
            },
          })
        }}
        syncState={syncState}
        onSaveDraft={() => {
          void saveCurrentToDrafts().then((res) => {
            if (res.ok) toast.success('已保存到草稿箱')
            else toast.error(res.message)
          })
        }}
        saving={syncState === 'saving'}
        unsaved={hasUnsavedChanges || neverSaved}
        onOpenDrafts={() => navigate('/drafts')}
        onOpenMaterials={() => navigate('/materials')}
        themeId={settings.themeId}
        onTheme={(id) => setSettings((s) => ({ ...s, themeId: id }))}
        miniPreview={(id) => renderDoc(parsed, getTheme(id), settings.sig, resolveImg).html}
        onOpenThemes={() => navigate('/themes')}
        copying={copied}
        onCopy={handleCopy}
        onExport={handleExport}
        onImport={(kind) => {
          importKindRef.current = kind
          importRef.current?.click()
        }}
        importing={importing}
        onOpenReferences={() => navigate('/references')}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        userName={user?.name || ''}
        onLogin={() => navigate('/login')}
        onLogout={logout}
      />

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={initialLayout}
        onLayoutChange={(layout) => {
          layoutRef.current = { ...layoutRef.current, ...layout }
          try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutRef.current))
          } catch {
            // 宽度记不住也不碍事
          }
        }}
      >
        {/* 左：Markdown 编辑（支持拖图上传） */}
        <ResizablePanel id="editor" defaultSize="55%" minSize="320px" className="min-w-0">
          <div
            className="flex h-full min-w-0 flex-col bg-surface-sunken"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              // CodeMirror claims drops inside the editor and preventDefaults
              // them; handling those here too would open a second picker. This
              // only stops the browser navigating away from a file dropped on the
              // surrounding chrome.
              if (e.defaultPrevented) return
              e.preventDefault()
            }}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line-1 px-4">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                markdown · 语义源稿
                <span className="ml-2 normal-case tracking-normal text-ink-4">可拖拽图片上传 · ctrl/⌘+space 补全 · ⌘B 加粗 · ⌘K 链接</span>
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="rounded-lg px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-line-1 hover:text-ink-1">
                    语法速查
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="ya-pop w-80 border-none p-0">
                  <p className="ya-eyebrow border-b border-line-2 px-3 py-2">
                    公众号专用语法
                  </p>
                  <ul className="max-h-80 overflow-y-auto p-2">
                    {CHEATSHEET.map((c) => (
                      <li key={c.syntax} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-tint">
                        <code className="shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 font-mono text-[11px] text-brand-600">{c.syntax}</code>
                        <span className="text-[12px] text-ink-2">{c.desc}</span>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
            <div className="min-h-0 flex-1">
              {activeLoading || activeError ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  {activeLoading ? (
                    <p className="text-[13px] text-ink-3">正在从云端读取这篇稿件…</p>
                  ) : (
                    <>
                      <p className="text-[13px] text-ink-2">{activeError}</p>
                      <button onClick={retryHydrate} className="ya-btn ya-btn-secondary">
                        重试
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <EditorPane
                  ref={editorRef}
                  value={activeDoc?.content || ''}
                  docKey={activeId}
                  onChange={(content) => updateActive({ content })}
                  onScroll={onEditorScroll}
                  onFiles={handleEditorFiles}
                  onHtml={handleHtml}
                />
              )}
            </div>
            {activeConflict && !conflictOpen && (
              <button
                onClick={() => setConflictOpen(true)}
                className="flex shrink-0 items-center gap-2 border-t border-warn/40 bg-warn/10 px-4 py-2 text-left text-[12px] text-warn-700 transition-colors hover:bg-warn/20"
              >
                <span className="ya-unsaved-dot" />
                这篇稿件在别处也被改过，两边的文字都还在——点这里选保留哪一版
              </button>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 中：预览（375/677 是里面手机框的宽度，栏宽随便拖） */}
        <ResizablePanel id="preview" defaultSize="500px" minSize="380px" maxSize="820px" className="min-w-0 border-l border-line-2">
          <PreviewPane
            ref={previewRef}
            html={rendered.html}
            stats={rendered.stats}
            blockOffsets={rendered.blockOffsets}
            width={previewWidth}
            onWidthChange={setPreviewWidth}
            onScroll={onPreviewScroll}
          />
        </ResizablePanel>

        {/* 右：折叠侧栏 */}
        {panelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="sidebar" defaultSize="300px" minSize="240px" maxSize="520px" className="min-w-0">
              <SidePanel
                materials={materials}
                titles={parsed.meta.titles}
                cover={parsed.meta.cover}
                sig={settings.sig}
                onSig={(sig) => setSettings((s) => ({ ...s, sig }))}
                syncScroll={settings.syncScroll}
                onSyncScrollChange={(v) => setSettings((s) => ({ ...s, syncScroll: v }))}
                zoom={settings.zoom}
                onZoomChange={(z) => setSettings((s) => ({ ...s, zoom: z }))}
                onJump={(line) => editorRef.current?.jumpToLine(line)}
                onCopyTitle={(t) => {
                  copyPlain(t)
                  toast.success('标题已复制')
                }}
                onUpload={(files, item) => startUpload(files, item)}
                onClear={clearImage}
                onRemove={removeImage}
                onRecrop={(item) => void recropImage(item)}
                onCarouselRatio={changeCarouselRatio}
                uploadingKey={uploadingKey}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <RatioPicker
        open={frameTask !== null && manualOpen === false}
        label={frameTask?.item?.no ?? ''}
        alt={frameTask?.item?.alt || frameTask?.files[0]?.name || ''}
        current={frameTask?.locked}
        mode={frameTask?.mode ?? 'loose'}
        fence={frameTask?.item?.kind === '画廊' ? ':::gallery' : ':::carousel'}
        busy={uploadingKey !== null}
        onCancel={() => setFrameTask(null)}
        onManual={() => {
          if (!frameTask) return
          const lockedOrCurrent = frameTask.locked ?? null
          setFrameTask({ ...frameTask, ratio: lockedOrCurrent })
          setManualOpen(true)
        }}
        onConfirm={(ratio) => {
          const task = frameTask
          setFrameTask(null)
          if (!task) return
          if (task.mode === 'carousel' && task.item && ratio) {
            void uploadToGroup(task.files, task.item, ratio)
          } else {
            // Pass the task so a re-crop replaces the image instead of inserting
            // a second copy at the cursor.
            void uploadLoose(task.files, ratio, task)
          }
        }}
      />

      <ManualCropper
        open={manualOpen && frameTask !== null}
        file={frameTask?.files[0] ?? null}
        label={frameTask?.item?.no ?? ''}
        alt={frameTask?.item?.alt || frameTask?.files[0]?.name || ''}
        ratio={
          // Carousel slides must keep one frame: a locked carousel keeps its
          // ratio, a fresh one starts at the default. Standalone images are free.
          frameTask?.mode === 'carousel'
            ? frameTask?.locked ?? frameTask?.ratio ?? DEFAULT_CAROUSEL_RATIO
            : null
        }
        busy={uploadingKey !== null}
        onCancel={() => {
          setManualOpen(false)
          setFrameTask(null)
        }}
        onConfirm={(blob, mime) => {
          const task = frameTask
          setManualOpen(false)
          setFrameTask(null)
          if (task) void uploadCroppedBlob(blob, mime, task)
        }}
      />

      <Dialog open={conflictOpen && activeConflict !== null} onOpenChange={setConflictOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>「{activeDoc?.name || '未命名稿件'}」在别处也被改过</DialogTitle>
            <DialogDescription>
              你这边改着的时候，云端这篇（{formatMoment(activeConflict?.updatedAt ?? 0)} 更新）也变了。
              两边都不会被自动覆盖——选一个处理方式，没选之前这篇不会继续同步。
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0">
            <p className="ya-eyebrow mb-1.5">云端现在的版本（开头预览）</p>
            <pre
              className="max-h-[32vh] overflow-auto whitespace-pre-wrap rounded-xl bg-surface-sunken p-3 text-[12px] leading-relaxed text-ink-2"
              style={{ fontFamily: 'var(--font-mono)', boxShadow: 'var(--shadow-inset)' }}
            >
              {(activeConflict?.content ?? '').slice(0, CONFLICT_PREVIEW_CHARS)}
              {(activeConflict?.content.length ?? 0) > CONFLICT_PREVIEW_CHARS
                ? `\n\n……（云端正文更长，共 ${activeConflict?.content.length.toLocaleString()} 字符，这里只显示开头）`
                : ''}
            </pre>
            <p className="mt-2 text-[11px] text-ink-3">
              「你这一版」就是编辑器里和本地缓存里的内容，不会因为选错就消失——除非你选「用云端那一版」。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                if (!activeDoc) return
                setConflictOpen(false)
                void resolveConflictKeepLocal(activeDoc.id)
              }}
              className="ya-btn ya-btn-primary"
            >
              保留我这一版（云端会更新成我这边的内容）
            </button>
            <button
              onClick={() => {
                if (!activeDoc) return
                setConflictOpen(false)
                resolveConflictUseRemote(activeDoc.id)
              }}
              className="ya-btn ya-btn-secondary"
            >
              用云端那一版（放弃我这边的改动）
            </button>
            <button
              onClick={() => {
                if (!activeDoc) return
                setConflictOpen(false)
                void resolveConflictKeepBoth(activeDoc.id)
              }}
              className="ya-btn ya-btn-secondary"
            >
              两边都留（我这一版另存为新稿件，进草稿箱）
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <input
        ref={importRef}
        type="file"
        className="hidden"
        accept={importKindRef.current === 'docx' ? '.docx' : importKindRef.current === 'bundle' ? '.json' : '.md,.markdown,.txt'}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleImportFile(f, importKindRef.current)
          e.target.value = ''
        }}
      />

      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
