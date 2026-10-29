import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Toaster, toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import TopBar from '@/components/TopBar'
import EditorPane, { type EditorHandle, type EditorViewState } from '@/components/EditorPane'
import MarkdownToolbar, { type BrushMode, type ToolbarAction, type ToolbarState } from '@/components/MarkdownToolbar'
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
  applyBrush,
  blockAtLine,
  blockCharRange,
  buildCarousel,
  buildCodeFence,
  buildGallery,
  buildImagePlaceholder,
  buildMath,
  buildMermaid,
  buildTable,
  clearInline,
  convertBlocksTo,
  inlineStateAt,
  lineOfOffset,
  lineStarts,
  snapshotAt,
  toBlockInfo,
  toggleInline,
  toggleLink,
  toggleList,
  type BrushSnapshot,
  type EditResult,
} from '@/lib/md-format'
import {
  renderDoc,
  collectMaterials,
  clearImageSrc,
  removeImageLine,
  setCarouselRatio,
  type MaterialItem,
} from '@/lib/render'
import { getTheme } from '@/lib/themes'
import { cleanHtml, copyPlain, copyRichText, downloadFile, previewPage } from '@/lib/clipboard'
import { applyZoom, createDoc, loadSettings, saveSettings, type DocRecord } from '@/lib/store'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useDocs, UNDO_DELETE_MS } from '@/hooks/useDocs'
import { useRemoteMcp } from '@/hooks/useRemoteMcp'
import AiWritingDialog from '@/components/AiWritingDialog'
import RemoteMcpDialog from '@/components/RemoteMcpDialog'
import OnboardingTour from '@/components/OnboardingTour'
import { useAuth } from '@/hooks/useAuth'
import { trpc } from '@/providers/trpc'
import { MaxImageBytes } from '@contracts/constants'
import {
  blobToBase64,
  formatBytes,
  prepareForUpload,
  cropToRatio,
  fileFromImageUrl,
  filenameForMime,
} from '@/lib/image'
import type { UploadSizeChoice } from '@/lib/image-compress'
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
import { hasSeenOnboarding } from '@/lib/onboarding'
import {
  applyImageWriteTarget,
  applyInsertWriteTarget,
  captureImageWriteTarget,
  captureInsertWriteTarget,
  mapWriteTarget,
  type WriteTarget,
} from '@/lib/upload-writeback'
import { useI18n } from '@/hooks/useI18n'
import { useIsMobile } from '@/hooks/use-mobile'

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

/** When the cloud version of a conflicted article was last written. */
function formatMoment(ts: number, unknownLabel: string): string {
  if (!ts) return unknownLabel
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
  /** The article that was open when the upload started; write-back must target it. */
  docId: string
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
   * Upload-size choice confirmed in the picker. Only the no-crop path consumes
   * it — a cropped image is re-encoded at its frame's own resolution.
   */
  uploadSize?: UploadSizeChoice
  /**
   * Document position a drop landed on, so the image goes where it was dropped
   * rather than wherever the cursor last was. Null for a clipboard paste.
   */
  at?: number | null
}

export default function EditorPage() {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const [settings, setSettings] = useState(loadSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  /**
   * First-run tour: 0 = not running, a bump starts it. Auto-starts once per
   * browser (localStorage flag, skipped on narrow screens); the settings tab
   * can start it again at any time.
   */
  const [tourRun, setTourRun] = useState(0)
  const startTour = useCallback(() => setTourRun((n) => n + 1), [])
  const endTour = useCallback(() => setTourRun(0), [])
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
  const [aiWritingOpen, setAiWritingOpen] = useState(false)
  const [remoteMcpOpen, setRemoteMcpOpen] = useState(false)
  const importKindRef = useRef<'markdown' | 'docx' | 'bundle'>('markdown')
  const importRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewScrollHandle>(null)
  /**
   * Live editor state for the toolbar: the selection, and how deep the undo
   * history is. Reported by EditorPane on every transaction.
   */
  const [viewState, setViewState] = useState<EditorViewState | null>(null)
  /** Format brush: off, one painting, or locked for a run of paintings. */
  const [brush, setBrush] = useState<BrushMode>('off')
  /** What the brush captured when it was armed; read again on every painting. */
  const brushRef = useRef<BrushSnapshot | null>(null)
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
    activeBodyError,
    retryLocalBodies,
    retryingLocal,
    retryHydrate,
    activeConflict,
    resolveConflictKeepLocal,
    resolveConflictUseRemote,
    resolveConflictKeepBoth,
    hydrateAllForExport,
    syncState,
    localFault,
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

  const remoteMcp = useRemoteMcp({ docs, activeId, setDocs })
  const remoteConflictKey = remoteMcp.conflict ? `${activeId}:${remoteMcp.conflict.hash}` : null
  useEffect(() => {
    if (remoteConflictKey) setRemoteMcpOpen(true)
  }, [remoteConflictKey])

  const uploadMutation = trpc.storage.upload.useMutation()

  // Loose uploads that the original tier cannot send: the server rejects any
  // single image over the shared cap, so the framing dialog warns and blocks it
  // instead of letting the upload fail. Only files that would skip cropping are
  // considered — a crop re-encodes below the cap either way.
  const oversizeUpload = useMemo(() => {
    if (!frameTask || frameTask.mode !== 'loose') return null
    const over = frameTask.files.filter((f) => f.size > MaxImageBytes)
    return over.length ? { maxBytes: Math.max(...over.map((f) => f.size)) } : null
  }, [frameTask])

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => applyZoom(settings.zoom), [settings.zoom])

  // First visit only: let the panes settle, then auto-start the tour. Narrow
  // screens never auto-start; the settings entry can still open it by hand.
  useEffect(() => {
    if (isMobile || hasSeenOnboarding()) return
    const timer = window.setTimeout(() => setTourRun((n) => (n === 0 ? 1 : n)), 700)
    return () => window.clearTimeout(timer)
  }, [isMobile])

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

  // The toolbar reads block semantics off the parser's own blocks — the same
  // structure the renderer consumes, so "what the menu says" cannot drift from
  // "what the preview shows".
  const blockInfos = useMemo(() => toBlockInfo(parsed.blocks), [parsed.blocks])

  const toolbarState = useMemo<ToolbarState>(() => {
    const text = activeDoc?.content ?? ''
    if (!viewState) {
      return {
        inline: { bold: false, mark: false, italic: false, strike: false, code: false, link: false },
        block: 'paragraph',
        ordered: false,
        canUndo: false,
        canRedo: false,
      }
    }
    const from = Math.max(0, Math.min(viewState.from, text.length))
    const to = Math.max(from, Math.min(viewState.to, text.length))
    const starts = lineStarts(text)
    const line = lineOfOffset(starts, from)
    const block = blockAtLine(blockInfos, line)
    const range = block ? blockCharRange(text, block, starts) : undefined
    return {
      inline: inlineStateAt(text, { from, to }, range),
      block: block?.kind ?? 'paragraph',
      ordered: block?.ordered ?? false,
      canUndo: viewState.undoDepth > 0,
      canRedo: viewState.redoDepth > 0,
    }
  }, [activeDoc?.content, viewState, blockInfos])

  const { onEditorScroll, onPreviewScroll, onLayoutChange } = useSyncScroll({
    enabled: settings.syncScroll,
    blocks: parsed.blocks,
    editorRef,
    previewRef,
  })
  // A rewrap or a resize invalidates the *other* pane's anchor: the editor's own
  // position survives being resized, the preview's survives an image arriving
  // late, and each re-anchor keeps whichever one did not move.
  const onEditorLayout = useCallback(() => onLayoutChange('preview'), [onLayoutChange])
  const onPreviewLayout = useCallback(() => onLayoutChange('editor'), [onLayoutChange])

  const updateActive = (patch: Partial<DocRecord>) => {
    setDocs((ds) => ds.map((d) => (d.id === activeId ? { ...d, ...patch, updatedAt: Date.now() } : d)))
  }

  /**
   * Async uploads finish long after they start. They must not write back the
   * whole article captured at the start: the author may have typed, renamed or
   * switched articles in the meantime. Every upload therefore carries the id
   * of the article that started it and a source span, and the span is folded
   * through each edit made while the request was in flight. If the article or
   * the span is gone, the upload refuses to write and tells the author.
   */
  const docsRef = useRef(docs)
  docsRef.current = docs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const pendingWrites = useRef<Map<string, { content: string; targets: Map<number, WriteTarget> }>>(
    new Map(),
  )
  const pendingWriteId = useRef(0)

  const syncPendingWrites = useCallback((docId: string, content: string) => {
    const rec = pendingWrites.current.get(docId)
    if (!rec || rec.content === content) return
    for (const target of rec.targets.values()) mapWriteTarget(target, rec.content, content)
    rec.content = content
  }, [])

  // Most edits flow through updateActive, but sync, MCP and merge can replace a
  // body too. Keeping the pending spans current on every render covers both.
  useEffect(() => {
    for (const doc of docs) {
      if (pendingWrites.current.has(doc.id)) syncPendingWrites(doc.id, doc.content)
    }
  }, [docs, syncPendingWrites])

  /** The body as the latest commit has it; the editor reports every change here. */
  const latestContent = (docId: string): string | null =>
    docsRef.current.find((d) => d.id === docId)?.content ?? null

  const trackWrite = (
    docId: string,
    content: string,
    target: WriteTarget | null,
  ): number | null => {
    if (!target) return null
    syncPendingWrites(docId, content)
    let rec = pendingWrites.current.get(docId)
    if (!rec) {
      rec = { content, targets: new Map() }
      pendingWrites.current.set(docId, rec)
    }
    const id = ++pendingWriteId.current
    rec.targets.set(id, target)
    return id
  }

  const dropWrite = (docId: string, id: number) => {
    const rec = pendingWrites.current.get(docId)
    if (!rec) return
    rec.targets.delete(id)
    if (!rec.targets.size) pendingWrites.current.delete(docId)
  }

  const trackImage = (docId: string, alt: string, occurrence: number): number | null => {
    const content = latestContent(docId)
    if (content === null) return null
    return trackWrite(docId, content, captureImageWriteTarget(content, alt, occurrence))
  }

  const trackInsert = (docId: string, at: number | null): number | null => {
    const content = latestContent(docId)
    if (content === null) return null
    const pos = at ?? editorRef.current?.getState()?.to ?? content.length
    return trackWrite(docId, content, captureInsertWriteTarget(content, pos))
  }

  /** Commit an edit to one article on top of its body as it is right now. */
  const commitDocContent = (
    docId: string,
    stateBase: string,
    base: string,
    next: string,
  ): boolean => {
    if (next === base) return true
    if (!docsRef.current.some((d) => d.id === docId)) return false
    const accepted = (d: DocRecord) =>
      d.content === stateBase || d.content === base || d.content === next
    docsRef.current = docsRef.current.map((d) =>
      d.id === docId && accepted(d) ? { ...d, content: next, updatedAt: Date.now() } : d,
    )
    setDocs((ds) =>
      ds.map((d) =>
        d.id === docId && accepted(d) ? { ...d, content: next, updatedAt: Date.now() } : d,
      ),
    )
    syncPendingWrites(docId, next)
    return true
  }

  /** Write a carousel's frame into the article that started the upload. */
  const changeTrackedRatio = (docId: string, ordinal: number, ratio: CarouselRatio): boolean => {
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!doc) return false
    const base = latestContent(docId) ?? doc.content
    syncPendingWrites(docId, base)
    const next = setCarouselRatio(base, ordinal, ratio)
    if (next === base) return true
    return commitDocContent(docId, doc.content, base, next)
  }

  const writeTrackedImage = (docId: string, id: number, ref: string, label: string): boolean => {
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!doc) {
      dropWrite(docId, id)
      toast.error(t('editor.toast.docGoneDuringUpload', { name: label }))
      return false
    }
    const base = latestContent(docId) ?? doc.content
    syncPendingWrites(docId, base)
    const target = pendingWrites.current.get(docId)?.targets.get(id)
    if (!target || target.kind !== 'image') return false
    const result = applyImageWriteTarget(base, target, ref)
    dropWrite(docId, id)
    if (!result.ok) {
      toast.error(t('editor.toast.locateFailed', { no: label }), {
        description: t('editor.toast.locateFailedDesc'),
      })
      return false
    }
    return commitDocContent(docId, doc.content, base, result.content)
  }

  const writeTrackedInsert = (
    docId: string,
    id: number,
    markdown: string,
    label: string,
  ): boolean => {
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!doc) {
      dropWrite(docId, id)
      toast.error(t('editor.toast.docGoneDuringUpload', { name: label }))
      return false
    }
    const base = latestContent(docId) ?? doc.content
    syncPendingWrites(docId, base)
    const target = pendingWrites.current.get(docId)?.targets.get(id)
    if (!target || target.kind !== 'insert') return false
    const result = applyInsertWriteTarget(base, target, markdown)
    dropWrite(docId, id)
    if (!result.ok) {
      toast.error(t('editor.toast.insertPositionLost', { name: label }))
      return false
    }
    const focused = Boolean(document.activeElement?.closest('.cm-editor'))
    if (activeIdRef.current === docId && focused && editorRef.current?.getState()?.text === base) {
      // Keep the editor's own insert command for the open article: cursor and
      // undo history stay intact. The commit below records the same text if
      // the change listener has not run yet.
      editorRef.current.insertAt(target.pos, markdown)
    }
    return commitDocContent(docId, doc.content, base, result.content)
  }

  /** Tell the author when a late upload landed in an article other than the open one. */
  const placementNote = (docId: string): string | undefined => {
    if (docId === activeIdRef.current) return undefined
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!doc) return undefined
    return t('editor.toast.filledInOtherDoc', {
      name: doc.name || t('common.unnamedDoc'),
    })
  }

  /** Report why an upload target could not be registered. */
  const reportMissingTarget = (docId: string, label: string) => {
    if (!docsRef.current.some((d) => d.id === docId)) {
      toast.error(t('editor.toast.docGoneDuringUpload', { name: label }))
    } else {
      toast.error(t('editor.toast.locateFailed', { no: label }), {
        description: t('editor.toast.locateFailedDesc'),
      })
    }
  }

  const handleCopy = async () => {
    if (activeBodyError) {
      toast.error(activeBodyError)
      return
    }
    if (diagramPending > 0) {
      toast.info(t('editor.toast.diagramPending'), {
        description: t('editor.toast.diagramPendingDesc'),
      })
      return
    }
    const ok = await copyRichText(cleanHtml(rendered.html), plainTextOf(rendered.html))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(t('editor.toast.copied', { chars: rendered.stats.chars, imgs: rendered.stats.images }), {
        description: t('editor.toast.copiedDesc'),
      })
    } else {
      toast.error(t('editor.toast.copyFailed'), { description: t('editor.toast.copyFailedDesc') })
    }
  }

  const handleExport = (kind: 'clean' | 'page' | 'markdown' | 'bundle') => {
    const name = activeDoc?.name || t('io.fallbackArticle')
    // Copying or exporting the placeholder would hand the author an empty
    // article. The bundle path has its own check in hydrateAllForExport.
    if (kind !== 'bundle' && activeBodyError) {
      toast.error(activeBodyError)
      return
    }
    if (kind === 'markdown') {
      const f = toMarkdownFile(name, activeDoc?.content || '')
      downloadFile(f.filename, f.content, f.mime)
      toast.success(t('editor.toast.exportedMarkdown'), { description: t('editor.toast.exportedMarkdownDesc') })
      return
    }
    if (kind === 'bundle') {
      // The list holds metadata only, so most articles' bodies are not in
      // memory. Fetch every missing one first — a backup that silently
      // contained empty articles would be worse than no backup at all.
      void (async () => {
        const res = await hydrateAllForExport()
        if (!res.ok) {
          toast.error(t('editor.toast.bundleFailed'), { description: res.message, duration: 9000 })
          return
        }
        downloadFile(bundleFilename(res.docs.length), toBundle(res.docs, settings), 'application/json')
        toast.success(t('editor.toast.bundleDone', { n: res.docs.length }), { description: t('editor.toast.bundleDoneDesc') })
      })()
      return
    }
    const safe = safeFilename(name, t('io.fallbackArticle'), 'html')
    if (kind === 'clean') downloadFile(safe.replace(/\.html$/, `_${t('io.suffixClean')}.html`), cleanHtml(rendered.html))
    else downloadFile(safe.replace(/\.html$/, `_${t('io.suffixPage')}.html`), previewPage(rendered.html, name))
    toast.success(kind === 'clean' ? t('editor.toast.exportedClean') : t('editor.toast.exportedPage'))
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
      if (failed) toast.warning(t('editor.toast.docxImagesFailed', { n: failed }))
    }
    const doc = createDoc()
    doc.name = safeFilename(file.name.replace(/\.[^.]+$/, ''), t('io.importFallback'), '') || t('io.importFallback')
    doc.content = markdown
    setDocs((ds) => [doc, ...ds])
    setActiveId(doc.id)
    toast.success(t('editor.toast.imported', { name: doc.name }), {
      description: imported.images.length ? t('editor.toast.importedImages', { n: imported.images.length }) : undefined,
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
        toast.success(t('editor.toast.imported', { name: doc.name }))
        return
      }
      const result = parseBundle(text)
      if (!result.ok) {
        toast.error(t('editor.toast.bundleUnreadable'), { description: result.reason, duration: 9000 })
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
      toast.success(t('editor.toast.importedCount', { n: incoming.length }), {
        description: skipped ? t('editor.toast.importedSkipped', { n: skipped }) : undefined,
      })
    } catch (e) {
      toast.error(t('editor.toast.importFailed'), { description: e instanceof Error ? e.message : t('editor.toast.importUnknown') })
    } finally {
      setImporting(false)
    }
  }

  /** Upload one file, optionally auto-cropping to a carousel frame first. */
  const uploadOne = async (
    file: File,
    ratio?: CarouselRatio,
    size: UploadSizeChoice = 'auto',
  ): Promise<{ ref: string; saved: string | null }> => {
    const payload = ratio ? await cropToRatio(file, ratio) : null
    // A loose image is the one that needs shrinking: a 12MP phone photo used to go
    // up at full size for an article that is at most 677px wide. The picked size
    // only drives this path; a cropped image was already re-encoded at its frame's
    // resolution and must not take a second lossy pass.
    const loose = payload ? null : await prepareForUpload(file, size)
    const blob = payload ? payload.blob : loose!.blob
    const mime = payload ? payload.mime : loose!.mime
    const contentBase64 = await blobToBase64(blob)
    const uploadName = filenameForMime(file.name.replace(/[^\w.一-鿿-]+/g, '_'), mime)
    const res = await uploadMutation.mutateAsync({ name: uploadName, contentBase64, contentType: mime })
    const saved =
      loose && !loose.untouched
        ? `${formatBytes(loose.sourceBytes)} → ${formatBytes(loose.bytes)}${loose.grew ? t('editor.compressedLarger') : ''}`
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
          park(code, t('editor.diagram.uploadFailed'), e)
        }
      } catch (e) {
        park(code, t('editor.diagram.syntaxError'), e)
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
    toast.info(t('editor.toast.oldUnreferenced'), {
      description: t('editor.toast.oldUnreferencedDesc'),
      duration: 8000,
      action: { label: t('editor.toast.oldUnreferencedAction'), onClick: () => navigate('/materials') },
    })
  }

  /**
   * Loose images: editor drops, pastes and the toolbar insert them where they
   * started. A sidebar row is different — it names one exact image slot, so it
   * fills that slot wherever the cursor happens to be.
   */
  const uploadLoose = async (files: File[], ratio?: CarouselRatio | null, task?: FrameTask | null) => {
    const docId = task?.docId ?? activeIdRef.current
    const item = task?.item
    const recrop = Boolean(item && task.replacedKey)
    // Capture every drop point before the first request. Registering the next
    // one after an earlier image has landed would point at the old offset and
    // put a multi-file drop in reverse order; pre-captured positions are folded
    // through each insertion instead.
    const planned = files.map((file) => {
      if (!/^image\//.test(file.type)) return { file, image: false, targetId: null }
      return {
        file,
        image: true,
        targetId: item
          ? trackImage(docId, item.alt, item.occurrence)
          : trackInsert(docId, task?.at ?? null),
      }
    })
    for (const { file, image, targetId } of planned) {
      if (!image) {
        toast.error(t('editor.toast.notImage', { name: file.name }))
        continue
      }
      setUploadingKey(`drop-${file.name}`)
      const label = item ? item.no : file.name
      if (targetId === null) {
        reportMissingTarget(docId, label)
        setUploadingKey(null)
        continue
      }
      try {
        const { ref, saved } = await uploadOne(file, ratio ?? undefined, task?.uploadSize)
        if (item) {
          // Write into the clicked slot: a placeholder stops being one, and a
          // replaced image keeps its alt and position. Never insert a second
          // image at the cursor for a row the author explicitly targeted.
          if (writeTrackedImage(docId, targetId, ref, item.no)) {
            if (recrop) {
              // Re-crop of a standalone image via the ratio picker: replace in place.
              toast.success(t('editor.toast.replaced', { no: item.no }))
              announceReplacedImage()
            } else {
              toast.success(t('editor.toast.slotFilled', { no: item.no }), {
                description: placementNote(docId) ?? saved ?? undefined,
              })
            }
          }
          continue
        }
        const alt = file.name.replace(/\.[^.]+$/, '')
        if (writeTrackedInsert(docId, targetId, `![${alt}](${ref})`, file.name)) {
          toast.success(
            files.length > 1
              ? t('editor.toast.imageFileInserted', { name: file.name })
              : t('editor.toast.imageInserted'),
            { description: placementNote(docId) ?? saved ?? undefined },
          )
        }
      } catch (e) {
        dropWrite(docId, targetId)
        toast.error(t('editor.toast.uploadFailed', { name: file.name }), {
          description: e instanceof Error ? e.message : t('editor.toast.uploadRetry'),
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
      toast.error(t('editor.toast.locateFailed', { no: item.no }), { description: t('editor.toast.locateManual') })
      return
    }
    updateActive({ content: next })
    toast.success(t('editor.toast.cleared', { no: item.no }))
  }

  /** Remove a standalone image line entirely. */
  const removeImage = (item: MaterialItem) => {
    if (!activeDoc) return
    const next = removeImageLine(activeDoc.content, item.alt, item.occurrence)
    if (next === activeDoc.content) {
      toast.error(t('editor.toast.locateFailed', { no: item.no }), { description: t('editor.toast.locateManual') })
      return
    }
    updateActive({ content: next })
    toast.success(t('editor.toast.removed', { no: item.no }))
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
      toast.info(t('editor.toast.ratioChanged', { n: ordinal, ratio }), {
        description: t('editor.toast.ratioChangedStale', { n: stale.length }),
      })
    } else {
      toast.success(t('editor.toast.ratioChanged', { n: ordinal, ratio }))
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
      toast.error(t('editor.toast.notOwnImage'))
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
        docId: activeId,
        item,
        // Both multi-image kinds have one frame contract for every image. A
        // standalone image remains free-form.
        mode: item.kind === '单图' ? 'loose' : 'carousel',
        locked: item.kind === '单图' ? undefined : item.ratio,
        ratio: item.kind === '单图' ? undefined : item.ratio,
        replacedKey: key,
      })
      setManualOpen(true)
    } catch (e) {
      toast.error(t('editor.toast.fetchOriginalFailed'), { description: e instanceof Error ? e.message : t('editor.toast.uploadRetry') })
    } finally {
      setUploadingKey(null)
    }
  }

  /** Result of the manual cropper: a blob instead of the original file. */
  const uploadCroppedBlob = async (blob: Blob, mime: string, task: FrameTask) => {
    const file = task.files[0]
    if (!file) return
    const docId = task.docId
    const label = task.item?.no ?? file.name
    const isRecrop = Boolean(task.item && task.replacedKey)
    setUploadingKey(task.item ? `${task.item.no}-${task.item.alt}` : `drop-${file.name}`)
    // The frame change is part of the same upload: write it first, on top of the
    // latest body, and then register the slot against that version.
    if (task.mode === 'carousel' && task.item && task.ratio && task.item.ratio !== task.ratio) {
      changeTrackedRatio(docId, task.item.carouselOrdinal!, task.ratio)
    }
    // A sidebar row names its slot, so a hand crop lands there too. Drops and
    // pastes have no slot and still go to the point they started at.
    const targetId = task.item
      ? trackImage(docId, task.item.alt, task.item.occurrence)
      : trackInsert(docId, task.at ?? null)
    if (targetId === null) {
      reportMissingTarget(docId, label)
      setUploadingKey(null)
      return
    }
    try {
      const ref = await uploadBlob(blob, mime, file.name)
      if (task.mode === 'carousel' && task.item) {
        if (writeTrackedImage(docId, targetId, ref, label)) {
          toast.success(t('editor.toast.croppedFilled', { label }))
          if (isRecrop) announceReplacedImage()
        }
      } else if (task.item) {
        if (writeTrackedImage(docId, targetId, ref, task.item.no)) {
          if (isRecrop) {
            toast.success(t('editor.toast.replaced', { no: task.item.no }))
            announceReplacedImage()
          } else {
            toast.success(t('editor.toast.croppedFilled', { label }), {
              description: placementNote(docId),
            })
          }
        }
      } else {
        const alt = file.name.replace(/\.[^.]+$/, '')
        if (writeTrackedInsert(docId, targetId, `![${alt}](${ref})`, label)) {
          toast.success(t('editor.toast.croppedInserted'), {
            description: placementNote(docId),
          })
        }
      }
    } catch (e) {
      dropWrite(docId, targetId)
      toast.error(t('editor.toast.uploadFailedPlain'), { description: e instanceof Error ? e.message : t('editor.toast.uploadRetry') })
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
  const uploadToGroup = async (
    files: File[],
    item: MaterialItem,
    ratio: CarouselRatio,
    docId: string,
  ) => {
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!doc) {
      toast.error(t('editor.toast.docGoneDuringUpload', { name: item.no }))
      return
    }
    if (item.carouselOrdinal && item.ratio !== ratio) {
      changeTrackedRatio(docId, item.carouselOrdinal, ratio)
    }
    const source = latestContent(docId) ?? doc.content
    const sourceMaterials = collectMaterials(parseMarkdown(source))
    const where = item.kind === '画廊' ? t('editor.toast.slotWhereGallery') : t('editor.toast.slotWhereCarousel')
    // Capture every slot before the first request. Later edits shift occurrence
    // numbers and can insert same-caption lookalikes; the captured spans are
    // folded through those edits one by one instead of being looked up again.
    const planned = files.map((file, i) => {
      const occurrence = item.occurrence + i
      const slot = sourceMaterials.find((m) => m.occurrence === occurrence)
      const sameGroup =
        slot?.kind === item.kind &&
        (item.carouselOrdinal ? slot.carouselOrdinal === item.carouselOrdinal : slot.line === item.line)
      if (!slot || !sameGroup) return { file, slot: null, targetId: null }
      return { file, slot, targetId: trackImage(docId, slot.alt, occurrence) }
    })
    let okCount = 0
    for (const { file, slot, targetId } of planned) {
      if (!slot) {
        toast.warning(t('editor.toast.slotMissed', { name: file.name }), {
          description: t('editor.toast.slotMissedDesc', { where }),
        })
        continue
      }
      if (targetId === null) {
        reportMissingTarget(docId, slot.no)
        continue
      }
      setUploadingKey(`${item.no}-${item.alt}`)
      try {
        const { ref } = await uploadOne(file, ratio)
        if (writeTrackedImage(docId, targetId, ref, slot.no)) okCount++
      } catch (e) {
        dropWrite(docId, targetId)
        toast.error(t('editor.toast.uploadFailed', { name: file.name }), {
          description: e instanceof Error ? e.message : t('editor.toast.uploadRetry'),
        })
      } finally {
        setUploadingKey(null)
      }
      if (!docsRef.current.some((d) => d.id === docId)) break
    }
    // Only claim success for slides that actually uploaded; every failure has
    // already raised its own error toast, so an all-failed batch stays quiet
    // instead of congratulating itself.
    if (files.length > 1) {
      if (okCount > 0) {
        toast.success(
          okCount === files.length
            ? t('editor.toast.batchCroppedAll', { n: okCount, ratio })
            : t('editor.toast.batchCroppedPart', { ok: okCount, total: files.length, ratio }),
          { description: placementNote(docId) ?? t('editor.toast.batchCroppedDesc') },
        )
      }
    } else if (okCount > 0) {
      toast.success(t('editor.toast.slotCropped', { no: item.no, ratio }), {
        description: placementNote(docId),
      })
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
      toast.error(t('editor.toast.notImage', { name: bad.name }))
    }
    if (!images.length) return
    setFrameTask({ files: images, docId: activeId, mode: 'loose', at })
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
      toast.error(t('editor.toast.noImageFromClipboard'), { description: d.reason, duration: 9000 })
      return true
    }
    if (d.kind === 'ide-code' || d.kind === 'code-block') {
      editorRef.current?.insertAt(null, '```' + d.lang + '\n' + plain.replace(/\s+$/, '') + '\n```')
      toast.success(t('editor.toast.insertedCode'), { description: d.reason })
      return true
    }
    if (!d.convert) return false
    const md = rp.htmlToDialect(html)
    if (!md.trim()) return false
    editorRef.current?.insertAt(null, md)
    toast.success(t('editor.toast.converted'), {
      description: t('editor.toast.convertedDesc'),
    })
    return true
  }

  /** Entry point from the sidebar: decide whether a ratio has to be chosen first. */
  const startUpload = (files: File[], item: MaterialItem) => {
    const bad = files.find((f) => !/^image\//.test(f.type))
    if (bad) {
      toast.error(t('editor.toast.notImageShort', { name: bad.name }))
      return
    }
    const docId = activeId
    if (item.kind === '单图') {
      // One sidebar row is one slot. Limit the task before either crop dialog,
      // so manual crops and original / auto-cropped uploads handle extras alike.
      if (files.length > 1) {
        toast.warning(t('editor.toast.slotSingleExtra', { n: files.length - 1 }), {
          description: t('editor.toast.slotSingleExtraDesc'),
        })
      }
      setFrameTask({
        files: files.slice(0, 1),
        docId,
        item,
        mode: 'loose',
        at: editorRef.current?.getState()?.to ?? null,
      })
      return
    }
    if (item.kind === '画廊') {
      // A gallery's frame is written in its fence line, so there is nothing to
      // pick here — lock the ratio and leave only how to frame the shot. Without
      // the crop the cells keep their own shapes and the grid rows go ragged.
      setFrameTask({ files, docId, item, mode: 'carousel', locked: item.ratio })
      return
    }
    // Carousel slides always get the dialog. When the carousel ratio is already
    // fixed the picker locks it, so the choice left is how to frame the shot -
    // auto centre-crop or manual. Uploading straight through would silently skip
    // cropping and break the uniform frame.
    const carouselHasImage = materials.some((m) => m.carouselOrdinal === item.carouselOrdinal && m.hasSrc)
    setFrameTask({
      files,
      docId,
      item,
      mode: 'carousel',
      locked: carouselHasImage ? item.ratio : undefined,
    })
  }

  /** Character range of the block around a position, for scoping inline scans. */
  const rangeAt = (text: string, pos: number) => {
    const starts = lineStarts(text)
    const block = blockAtLine(blockInfos, lineOfOffset(starts, pos))
    return block ? blockCharRange(text, block, starts) : undefined
  }

  /** Every toolbar command funnels through here: compute an edit, apply it. */
  const runAction = (a: ToolbarAction) => {
    const ed = editorRef.current
    if (!ed) return
    if (a.type === 'undo') {
      ed.undo()
      return
    }
    if (a.type === 'redo') {
      ed.redo()
      return
    }
    const st = ed.getState()
    if (!st) return
    const sel = { from: st.from, to: st.to }
    const apply = (res: EditResult | null) => {
      if (res) ed.applyEdit(res)
    }
    switch (a.type) {
      case 'inline':
        apply(toggleInline(st.text, sel, a.format, rangeAt(st.text, sel.from)))
        return
      case 'link':
        apply(toggleLink(st.text, sel, rangeAt(st.text, sel.from)))
        return
      case 'clear': {
        // Inline first: it never adds or removes a line, so the block pass can
        // keep working from the parsed spans afterwards.
        const inlined = clearInline(st.text, sel, rangeAt(st.text, sel.from))
        const doc = inlined?.doc ?? st.text
        const at = inlined ?? sel
        const blocked = convertBlocksTo(doc, { from: at.from, to: at.to }, blockInfos, { kind: 'paragraph' })
        apply(blocked ?? inlined)
        return
      }
      case 'block':
      case 'quote':
        apply(convertBlocksTo(st.text, sel, blockInfos, { kind: a.kind }))
        return
      case 'list':
        apply(toggleList(st.text, sel, a.ordered))
        return
      case 'image':
        imageInputRef.current?.click()
        return
      case 'imagePlaceholder': {
        const t = buildImagePlaceholder()
        ed.insertTemplate(t.text, t.caret, t.caretEnd)
        return
      }
      case 'table': {
        const t = buildTable(a.cols, a.rows, a.align)
        ed.insertTemplate(t.text, t.caret)
        return
      }
      case 'carousel': {
        const t = buildCarousel(a.ratio)
        ed.insertTemplate(t.text, t.caret)
        return
      }
      case 'gallery': {
        const t = buildGallery(a.cols, a.ratio)
        ed.insertTemplate(t.text, t.caret)
        return
      }
      case 'math': {
        const t = buildMath(a.tex)
        ed.insertTemplate(t.text, t.caret)
        return
      }
      case 'code': {
        const t = buildCodeFence(a.lang)
        ed.insertTemplate(t.text, t.caret)
        return
      }
      case 'mermaid': {
        const t = buildMermaid()
        ed.insertTemplate(t.text, t.caret)
        return
      }
      case 'hr':
        ed.insertTemplate('---')
        return
      case 'signature':
        ed.insertTemplate('@signature')
        return
    }
  }

  /** Arm or disarm the format brush; arming captures the source's semantics. */
  const handleBrush = (mode: BrushMode) => {
    if (mode === 'off') {
      brushRef.current = null
      setBrush('off')
      return
    }
    const st = editorRef.current?.getState()
    if (!st) return
    brushRef.current = snapshotAt(st.text, { from: st.from, to: st.to }, blockInfos)
    setBrush(mode)
  }

  /**
   * Paint the captured format onto whatever the mouse just selected. A single
   * brush disarms only after a painting that actually changed something.
   */
  const handlePaint = () => {
    const ed = editorRef.current
    const snap = brushRef.current
    if (brush === 'off' || !ed || !snap) return
    const st = ed.getState()
    if (!st) return
    const res = applyBrush(st.text, { from: st.from, to: st.to }, snap, blockInfos)
    if (!res) return
    ed.applyEdit(res)
    if (brush === 'single') {
      brushRef.current = null
      setBrush('off')
    }
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
          const name = docs.find((d) => d.id === id)?.name || t('common.unnamedDoc')
          removeDoc(id)
          toast(t('editor.toast.docDeleted', { name }), {
            description: t('editor.toast.docDeletedDesc'),
            duration: UNDO_DELETE_MS,
            action: {
              label: t('common.undo'),
              onClick: () => {
                void undoRemove(id).then((ok) => {
                  if (ok) toast.success(t('editor.toast.restored'))
                })
              },
            },
          })
        }}
        syncState={syncState}
        onSaveDraft={() => {
          void saveCurrentToDrafts().then((res) => {
            if (res.ok) toast.success(t('editor.toast.savedDraft'))
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
        remoteConnected={Boolean(activeDoc?.remoteMcp)}
      />

      {/* 本机存储失败不是一次性提示：原因留在页面上，读不出来时可以重试 */}
      {!localFault.healthy &&
        (localFault.failure?.kind === 'read-failed' ||
          localFault.failure?.kind === 'migration-failed' ||
          localFault.failure?.kind === 'write-failed') && (
          <div
            data-local-storage-banner
            role="status"
            className="flex shrink-0 items-center justify-between gap-3 border-b border-line-2 bg-surface-sunken px-4 py-1.5 text-[12px] leading-relaxed text-ink-2"
          >
            <span className="min-w-0">{localFault.failure?.message}</span>
            <button
              data-local-retry
              onClick={() => void retryLocalBodies()}
              disabled={retryingLocal}
              className="ya-btn ya-btn-secondary ya-btn-sm shrink-0"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

      {/* 窄屏（手机）访客的第一条说明：排版界面是为电脑浏览器设计的 */}
      <div className="flex items-center justify-center border-b border-line-2 bg-surface-sunken px-3 py-1.5 text-center text-[11px] leading-relaxed text-ink-3 md:hidden">
        {t('editor.narrowNote')}
      </div>

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
            data-onboarding="editor"
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
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-2 px-3 py-1.5">
              <span className="ya-eyebrow">Markdown</span>
              <div className="flex items-center gap-2">
                {activeDoc?.remoteMcp && <button data-mcp-editor-status onClick={() => setRemoteMcpOpen(true)} className="ya-link-btn !text-[11px]">
                  {remoteMcp.phase === 'conflict' ? t('editor.mcp.conflict') : remoteMcp.phase === 'error' ? t('editor.mcp.error') : remoteMcp.phase === 'saving' ? t('editor.mcp.saving') : t('editor.mcp.synced')}
                </button>}
                <button data-open-ai-writing onClick={() => setAiWritingOpen(true)} className="ya-btn ya-btn-secondary ya-btn-sm">{t('editor.aiWriting')}</button>
              </div>
            </div>
            <MarkdownToolbar state={toolbarState} brush={brush} onAction={runAction} onBrush={handleBrush} />
            <div className="min-h-0 flex-1">
              {activeBodyError ? (
                <div
                  data-local-body-error
                  className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
                >
                  <p className="text-[13px] text-ink-2">{activeBodyError}</p>
                  <button
                    data-local-retry
                    onClick={() => void retryLocalBodies()}
                    disabled={retryingLocal}
                    className="ya-btn ya-btn-secondary"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              ) : activeLoading || activeError ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  {activeLoading ? (
                    <p className="text-[13px] text-ink-3">{t('editor.loadingDoc')}</p>
                  ) : (
                    <>
                      <p className="text-[13px] text-ink-2">{activeError}</p>
                      <button onClick={retryHydrate} className="ya-btn ya-btn-secondary">
                        {t('common.retry')}
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
                  onLayout={onEditorLayout}
                  onFiles={handleEditorFiles}
                  onHtml={handleHtml}
                  onViewState={setViewState}
                  onPaint={brush !== 'off' ? handlePaint : undefined}
                />
              )}
            </div>
            {activeConflict && !conflictOpen && (
              <button
                onClick={() => setConflictOpen(true)}
                className="flex shrink-0 items-center gap-2 border-t border-warn/40 bg-warn/10 px-4 py-2 text-left text-[12px] text-warn-700 transition-colors hover:bg-warn/20"
              >
                <span className="ya-unsaved-dot" />
                {t('editor.conflictBar')}
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
            onLayout={onPreviewLayout}
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
                onCopyTitle={(title) => {
                  copyPlain(title)
                  toast.success(t('editor.toast.titleCopied'))
                }}
                onUpload={(files, item) => startUpload(files, item)}
                onClear={clearImage}
                onRemove={removeImage}
                onRecrop={(item) => void recropImage(item)}
                onCarouselRatio={changeCarouselRatio}
                uploadingKey={uploadingKey}
                onOpenRemoteMcp={() => setRemoteMcpOpen(true)}
                remoteConnected={Boolean(activeDoc?.remoteMcp)}
                onStartOnboarding={startTour}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <AiWritingDialog open={aiWritingOpen} onOpenChange={setAiWritingOpen} />
      <RemoteMcpDialog open={remoteMcpOpen} onOpenChange={setRemoteMcpOpen} doc={activeDoc} remote={remoteMcp} />
      <OnboardingTour run={tourRun} onEnd={endTour} />

      <RatioPicker
        open={frameTask !== null && manualOpen === false}
        label={frameTask?.item?.no ?? ''}
        alt={frameTask?.item?.alt || frameTask?.files[0]?.name || ''}
        current={frameTask?.locked}
        mode={frameTask?.mode ?? 'loose'}
        fence={frameTask?.item?.kind === '画廊' ? ':::gallery' : ':::carousel'}
        size={settings.uploadSize}
        oversize={oversizeUpload}
        busy={uploadingKey !== null}
        onCancel={() => setFrameTask(null)}
        onManual={() => {
          if (!frameTask) return
          const lockedOrCurrent = frameTask.locked ?? null
          setFrameTask({ ...frameTask, ratio: lockedOrCurrent })
          setManualOpen(true)
        }}
        onConfirm={(ratio, size) => {
          const task = frameTask
          setFrameTask(null)
          if (!task) return
          // The confirmed pick becomes the remembered default for the next
          // upload. Carousel confirmations never change it, so this stays quiet
          // for the cropping paths where the tiers are not offered.
          if (size !== settings.uploadSize) setSettings((s) => ({ ...s, uploadSize: size }))
          const next = { ...task, uploadSize: size }
          if (task.mode === 'carousel' && task.item && ratio) {
            void uploadToGroup(next.files, task.item, ratio, next.docId)
          } else {
            // Sidebar tasks fill their image slot; editor tasks insert at their
            // captured position. Keep that distinction through the picker.
            void uploadLoose(next.files, ratio, next)
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
            <DialogTitle>{t('editor.conflict.title', { name: activeDoc?.name || t('common.unnamedDoc') })}</DialogTitle>
            <DialogDescription>
              {t('editor.conflict.desc', { time: formatMoment(activeConflict?.updatedAt ?? 0, t('editor.unknownTime')) })}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0">
            <p className="ya-eyebrow mb-1.5">{t('editor.conflict.cloudVersion')}</p>
            <pre
              className="max-h-[32vh] overflow-auto whitespace-pre-wrap rounded-xl bg-surface-sunken p-3 text-[12px] leading-relaxed text-ink-2"
              style={{ fontFamily: 'var(--font-mono)', boxShadow: 'var(--shadow-inset)' }}
            >
              {(activeConflict?.content ?? '').slice(0, CONFLICT_PREVIEW_CHARS)}
              {(activeConflict?.content.length ?? 0) > CONFLICT_PREVIEW_CHARS
                ? t('editor.conflict.truncated', { n: (activeConflict?.content.length ?? 0).toLocaleString() })
                : ''}
            </pre>
            <p className="mt-2 text-[11px] text-ink-3">
              {t('editor.conflict.note')}
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
              {t('editor.conflict.keepLocal')}
            </button>
            <button
              onClick={() => {
                if (!activeDoc) return
                setConflictOpen(false)
                resolveConflictUseRemote(activeDoc.id)
              }}
              className="ya-btn ya-btn-secondary"
            >
              {t('editor.conflict.useRemote')}
            </button>
            <button
              onClick={() => {
                if (!activeDoc) return
                setConflictOpen(false)
                void resolveConflictKeepBoth(activeDoc.id)
              }}
              className="ya-btn ya-btn-secondary"
            >
              {t('editor.conflict.keepBoth')}
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

      {/* 工具栏「图片」：走和拖拽完全相同的上传 / 裁切 / 回填链路，插到光标处 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length) handleEditorFiles(files, null)
        }}
      />

      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
