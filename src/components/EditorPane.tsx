import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo, redoDepth, undoDepth } from '@codemirror/commands'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { EditorScrollHandle } from '@/hooks/useSyncScroll'
import { t } from '@/lib/i18n'
import type { MsgKey } from '@/lib/i18n.zh'

export interface EditorHandle extends EditorScrollHandle {
  jumpToLine: (line: number) => void
  insertText: (text: string) => void
  /** Insert at an explicit document position; null means the cursor. */
  insertAt: (pos: number | null, text: string) => void
  /** The live document and selection, for computing an edit. */
  getState: () => { text: string; from: number; to: number } | null
  /** Apply a computed edit; only the changed span is dispatched so undo stays one step. */
  applyEdit: (res: { doc: string; from: number; to: number }) => void
  /** Insert a whole block, optionally putting the caret (or a selection) inside it. */
  insertTemplate: (text: string, caret?: number, caretEnd?: number) => void
  undo: () => void
  redo: () => void
  focus: () => void
}

/** What the toolbar needs to know about the editor between transactions. */
export interface EditorViewState {
  /** 0-based line of the selection start. */
  line: number
  from: number
  to: number
  undoDepth: number
  redoDepth: number
}

// ---------- 公众号语法 snippets ----------
// "|" 标记插入后光标落点。模板刻意保持短小，插入后直接就能接着写。
// Detail text (and the two templates with words in them) come from the i18n
// dictionaries so the completion popup follows the interface language.

interface Snippet {
  id: string
  label: string
  detailKey: MsgKey
  template: string | (() => string)
}

const SNIPPETS: Snippet[] = [
  { id: 'quote', label: ':::quote', detailKey: 'snippet.quote', template: ':::quote\n|\n:::\n' },
  { id: 'center', label: ':::center', detailKey: 'snippet.center', template: ':::center\n|\n:::\n' },
  { id: 'carousel', label: ':::carousel', detailKey: 'snippet.carousel', template: ':::carousel 4:3 |\n![]()\n![]()\n:::\n' },
  { id: 'gallery', label: ':::gallery', detailKey: 'snippet.gallery', template: ':::gallery 3 1:1 |\n![]()\n![]()\n![]()\n:::\n' },
  { id: 'end', label: ':::', detailKey: 'snippet.end.detail', template: ':::\n|' },
  { id: 'kicker', label: '##KICKER', detailKey: 'snippet.kicker', template: '## KICKER | |\n' },
  { id: 'h3', label: '###', detailKey: 'snippet.h3', template: '### |\n' },
  { id: 'quoteCard', label: '>', detailKey: 'snippet.quoteCard', template: '> |\n' },
  { id: 'image', label: '![]()', detailKey: 'snippet.image', template: '![|]()\n' },
  { id: 'mark', label: '==', detailKey: 'snippet.mark', template: '==|==' },
  { id: 'signature', label: '@signature', detailKey: 'snippet.signature', template: '@signature\n' },
  { id: 'math', label: '$$', detailKey: 'snippet.math', template: '$$\n|\n$$\n' },
  { id: 'mermaid', label: 'mermaid', detailKey: 'snippet.mermaid', template: () => '```mermaid ' + t('md.mermaidCaption') + '\n|\n```\n' },
  { id: 'frontmatter', label: '---frontmatter', detailKey: 'snippet.frontmatter', template: '---\ntitles:\n  - |\ncover: \n---\n' },
  { id: 'comment', label: '<!--', detailKey: 'snippet.comment', template: '<!-- | -->' },
]

function snippetLabel(s: Snippet): string {
  return s.id === 'end' ? t('snippet.end.label') : s.label
}

function snippetTemplate(s: Snippet): string {
  return typeof s.template === 'function' ? s.template() : s.template
}

/** Split "a|b" into the text before and after the cursor. */
function splitTemplate(template: string): { before: string; after: string } {
  const i = template.indexOf('|')
  if (i < 0) return { before: template, after: '' }
  return { before: template.slice(0, i), after: template.slice(i + 1) }
}

function toCompletion(s: Snippet): Completion {
  const { before, after } = splitTemplate(snippetTemplate(s))
  return {
    label: snippetLabel(s),
    detail: t(s.detailKey),
    type: 'keyword',
    apply: (view, _completion, from, to) => {
      view.dispatch({
        changes: { from, to, insert: before + after },
        selection: { anchor: from + before.length },
      })
    },
  }
}

/**
 * 只在明显该出语法的时候给建议，避免打字时刷屏：
 * 行首、已经在 ::: / @ / # / > / ! 里、或者手动按了 Ctrl+Space。
 */
function gzhCompletions(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  // context.explicit 为真表示用户主动按了 Ctrl+Space
  const manual = context.explicit

  const trimmed = before.trimStart()
  const atLineStart = trimmed.length === 0
  const looksLikeSyntax = /^(:{1,3}|@|#{1,3}\s?|>\s?$|!\[?|==)/.test(trimmed)

  if (!atLineStart && !looksLikeSyntax && !manual) return null

  // 匹配光标前的语法前缀，替换掉已输入的部分
  const word = context.matchBefore(/[:@#!>=\-[\]\w]*/)
  if (!word) return null
  if (word.from === word.to && !manual) return null

  // 已经在 ::: 容器里时，把「闭合」排在最前
  const inContainer = /^\s*:::/.test(before)
  const options = inContainer
    ? [...SNIPPETS].sort((a, b) => (a.id === 'end' ? -1 : b.id === 'end' ? 1 : 0))
    : SNIPPETS

  return {
    from: word.from,
    options: options.map(toCompletion),
    validFor: /^[:@#!>=\-[\]\w]*$/,
  }
}

// ---------- 拖拽 / 粘贴 ----------

/**
 * Whether a drag is carrying files rather than text.
 *
 * `types` is a plain array in Chrome but a DOMStringList in Firefox, which has no
 * `includes`. Getting this wrong lets the drag fall through to CodeMirror's
 * built-in drop, which reads the file as text.
 */
function carriesFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes('Files')
}

// ---------- 快捷键 ----------
// 包一层选区：有选中就包住它，没有就放入占位文字并选中，方便直接打字覆盖。
function wrapSelection(view: EditorView, before: string, after: string, placeholder: string): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to) || placeholder
  view.dispatch({
    changes: { from, to, insert: before + text + after },
    selection: { anchor: from + before.length, head: from + before.length + text.length },
  })
  view.focus()
  return true
}

const gzhKeymap = keymap.of([
  { key: 'Mod-b', run: (v) => wrapSelection(v, '**', '**', t('md.bold')) },
  { key: 'Mod-i', run: (v) => wrapSelection(v, '*', '*', t('md.italic')) },
  {
    key: 'Mod-k',
    run: (v) => {
      const { from, to } = v.state.selection.main
      const selected = v.state.sliceDoc(from, to)
      if (selected) {
        // 选中文字变链接文字，光标落进括号里填地址
        v.dispatch({
          changes: { from, to, insert: `[${selected}]()` },
          selection: { anchor: from + selected.length + 3 },
        })
      } else {
        const placeholder = t('md.linkText')
        v.dispatch({
          changes: { from, insert: `[${placeholder}]()` },
          selection: { anchor: from + 1, head: from + 1 + placeholder.length },
        })
      }
      v.focus()
      return true
    },
  },
  {
    key: 'Mod-Shift-i',
    run: (v) => {
      const pos = v.state.selection.main.head
      const line = v.state.doc.lineAt(pos)
      const before = line.text.trim() ? '\n\n' : ''
      const caption = t('md.imageCaption')
      const mark = `![${caption}]()`
      v.dispatch({
        changes: { from: pos, insert: before + mark + '\n' },
        selection: { anchor: pos + before.length + 2, head: pos + before.length + 2 + caption.length },
      })
      v.focus()
      return true
    },
  },
])

// 公众号专用语法高亮（暗色编辑器内）
const syntaxDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDeco(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDeco(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

function buildDeco(view: EditorView): DecorationSet {
  const marks: { from: number; to: number; deco: Decoration }[] = []
  const doc = view.state.doc
  let inFrontMatter = false
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text
    if (i === 1 && text.trim() === '---') inFrontMatter = true
    else if (inFrontMatter && text.trim() === '---') {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-md-fm' }) })
      inFrontMatter = false
      continue
    }
    if (inFrontMatter) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-md-fm' }) })
      continue
    }
    if (/^\s*:::/.test(text)) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-md-directive' }) })
      continue
    }
    if (/^\s*@signature\s*$/.test(text)) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-md-signature' }) })
      continue
    }
    // kicker：## 之后 | 之前的部分
    const hm = text.match(/^(\s*##\s+)([^|]+)(\|)/)
    if (hm) {
      const start = line.from + hm[1].length
      marks.push({ from: start, to: start + hm[2].length, deco: Decoration.mark({ class: 'cm-md-kicker' }) })
    }
    // ==重点==
    for (const m of text.matchAll(/==[^=]+==/g)) {
      marks.push({ from: line.from + m.index!, to: line.from + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-mark' }) })
    }
    // ![图注](src)
    for (const m of text.matchAll(/!\[[^\]]*\]\([^)]*\)/g)) {
      marks.push({ from: line.from + m.index!, to: line.from + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-image' }) })
    }
  }
  marks.sort((a, b) => a.from - b.from)
  return Decoration.set(marks.map((m) => m.deco.range(m.from, m.to)))
}

// 编辑器井的配色全部走 token：明暗切换只换 <html> 上的 data-theme，
// CodeMirror 的样式是普通 CSS，var() 会自己跟着解析，不需要重建 view。
const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--bg-sunken)',
      color: 'var(--ink-1)',
      height: '100%',
      fontSize: '13.5px',
    },
    '.cm-content': {
      fontFamily: '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      padding: '16px 0',
      caretColor: 'var(--primary-500)',
      lineHeight: '1.75',
    },
    '.cm-cursor': { borderLeftColor: 'var(--primary-500)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--select-bg) !important',
    },
    '.cm-selectionMatch, .cm-matchingBracket': { backgroundColor: 'var(--select-bg)' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-sunken)',
      color: 'var(--ink-4)',
      border: 'none',
      paddingLeft: '8px',
    },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-3)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto' },
    // 自动补全弹层（跟随主题，不用 CodeMirror 默认的浅色）
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--line-2)',
      borderRadius: '12px',
      boxShadow: 'var(--shadow-pop)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul': { fontFamily: 'inherit', maxHeight: '260px' },
    '.cm-tooltip-autocomplete ul li': {
      padding: '4px 8px',
      color: 'var(--ink-1)',
      fontSize: '12.5px',
      lineHeight: '1.5',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--select-strong)',
      color: 'var(--ink-1)',
    },
    '.cm-completionLabel': { fontFamily: '"Geist Mono", ui-monospace, Menlo, Consolas, monospace' },
    '.cm-completionDetail': {
      color: 'var(--ink-3)',
      fontStyle: 'normal',
      marginLeft: '10px',
      fontSize: '11px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: 'var(--ink-2)' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--primary-600)', fontWeight: '700' },
  },
)

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--primary-600)', fontWeight: '700' },
  { tag: tags.strong, color: 'var(--ink-1)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--warning-500)' },
  { tag: tags.strikethrough, color: 'var(--ink-3)', textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--frost-500)' },
  { tag: tags.quote, color: 'var(--success-700)' },
  { tag: tags.link, color: 'var(--primary-600)' },
  { tag: tags.processingInstruction, color: 'var(--ink-4)' },
  { tag: tags.list, color: 'var(--ink-1)' },
])

/**
 * Insert text as a paragraph of its own at a document position.
 *
 * An image only parses as a block when it is alone in its paragraph, so the
 * surrounding blank lines are added here rather than left to each caller. A drop
 * reports an arbitrary mid-line position; snapping to the end of that line keeps
 * a sentence from being split in half by the inserted block.
 */
function insertBlock(view: EditorView, rawPos: number, text: string) {
  const clamped = Math.max(0, Math.min(rawPos, view.state.doc.length))
  const line = view.state.doc.lineAt(clamped)
  const pos = line.text.trim() ? line.to : clamped
  const before = line.text.trim() ? '\n\n' : line.from > 0 ? '\n' : ''
  const after = '\n'
  view.dispatch({
    changes: { from: pos, insert: before + text + after },
    selection: { anchor: pos + (before + text + after).length },
  })
  view.focus()
}

/**
 * `insertBlock`, but the caret (or a selection) can be placed inside the
 * inserted text — a table wants the caret in its first header cell, a fence
 * wants it on the empty line in the middle.
 */
function insertBlockTemplate(view: EditorView, rawPos: number, text: string, caret?: number, caretEnd?: number) {
  const clamped = Math.max(0, Math.min(rawPos, view.state.doc.length))
  const line = view.state.doc.lineAt(clamped)
  const pos = line.text.trim() ? line.to : clamped
  const before = line.text.trim() ? '\n\n' : line.from > 0 ? '\n' : ''
  const anchor = pos + before.length + (caret ?? text.length)
  view.dispatch({
    changes: { from: pos, insert: before + text + '\n' },
    selection: caretEnd != null ? { anchor, head: pos + before.length + caretEnd } : { anchor },
  })
  view.focus()
}

interface Props {
  value: string
  /**
   * Identifies which article is open. Switching articles must rebuild the view:
   * applying the new text as one big replacement dispatch would land in the undo
   * history, so Ctrl+Z on the new article restores the previous one's text - and
   * then saves it over the new article.
   */
  docKey: string
  onChange: (v: string) => void
  /** Called on every scroll of the editor viewport; the page forwards it to sync. */
  onScroll?: () => void
  /**
   * Called when the editor rewrapped itself — the pane was resized, so the same
   * source now occupies a different number of screen rows.
   */
  onLayout?: () => void
  /**
   * Image files from the clipboard or a drop. `at` is the document position the
   * drop landed on, or null when it came from a paste and belongs at the cursor.
   */
  onFiles?: (files: File[], at: number | null) => void
  /**
   * Clipboard HTML, offered to the page before it is pasted as plain text.
   * Returning true means the page converted it and the editor should stand down.
   */
  onHtml?: (html: string, plain: string) => boolean
  /** Fired whenever the selection or the document changes; feeds the toolbar. */
  onViewState?: (s: EditorViewState) => void
  /**
   * Fired on every mouseup in the editor. The page listens only while the
   * format brush is armed, and uses it as "paint onto what is now selected".
   */
  onPaint?: () => void
}

const EditorPane = forwardRef<EditorHandle, Props>(function EditorPane(
  { value, docKey, onChange, onScroll, onLayout, onFiles, onHtml, onViewState, onPaint },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  const onFilesRef = useRef(onFiles)
  onFilesRef.current = onFiles
  const onHtmlRef = useRef(onHtml)
  onHtmlRef.current = onHtml
  const onLayoutRef = useRef(onLayout)
  onLayoutRef.current = onLayout
  const onViewStateRef = useRef(onViewState)
  onViewStateRef.current = onViewState
  const onPaintRef = useRef(onPaint)
  onPaintRef.current = onPaint
  /** Last seen scroller size, so the update listener reports real layout changes only. */
  const lastSize = useRef({ w: 0, h: 0 })

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        gzhKeymap,
        keymap.of([...completionKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        closeBrackets(),
        autocompletion({
          override: [gzhCompletions],
          activateOnTyping: true,
          closeOnBlur: true,
          icons: false,
          maxRenderedOptions: 12,
        }),
        editorTheme,
        syntaxDecorations,
        // Claimed here rather than on a React handler up the tree: CodeMirror's
        // built-in drop runs first on the content DOM and reads dropped files with
        // readAsText, so dragging a .md file in dumps its whole source into the
        // article. Returning true is what stops that.
        EditorView.domEventHandlers({
          paste: (event) => {
            const dt = event.clipboardData
            if (!dt) return false
            const images = Array.from(dt.files || []).filter((f) => /^image\//.test(f.type))
            if (images.length) {
              onFilesRef.current?.(images, null)
              return true
            }
            const html = dt.getData('text/html')
            if (html && onHtmlRef.current?.(html, dt.getData('text/plain'))) return true
            // Plain text, or HTML nobody wanted: let CodeMirror insert it normally.
            return false
          },
          dragover: (event) => {
            if (!carriesFiles(event.dataTransfer)) return false
            event.preventDefault()
            event.dataTransfer!.dropEffect = 'copy'
            return true
          },
          drop: (event, view) => {
            const dt = event.dataTransfer
            if (!carriesFiles(dt)) return false
            event.preventDefault()
            const files = Array.from(dt!.files || [])
            if (!files.length) return false
            // Where the user let go, not where the cursor happened to be.
            const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
            onFilesRef.current?.(files, at)
            return true
          },
          // The brush paints on release: by then the drag has settled on the
          // passage the user meant, and a plain click has its collapsed cursor.
          mouseup: () => {
            onPaintRef.current?.()
            return false
          },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          if (u.docChanged || u.selectionSet) {
            const sel = u.state.selection.main
            onViewStateRef.current?.({
              line: u.state.doc.lineAt(sel.from).number - 1,
              from: sel.from,
              to: sel.to,
              undoDepth: undoDepth(u.state),
              redoDepth: redoDepth(u.state),
            })
          }
          // The scroller's own size is the one signal that means "the text just
          // wrapped differently": the pane got narrower or shorter. Scroll sync
          // has to re-anchor after that, and a wrapped line's height cannot be
          // predicted from the text alone, so it has to come from the view.
          const el = u.view.scrollDOM
          if (el.clientWidth !== lastSize.current.w || el.clientHeight !== lastSize.current.h) {
            lastSize.current = { w: el.clientWidth, h: el.clientHeight }
            onLayoutRef.current?.()
          }
        }),
        EditorView.lineWrapping,
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    lastSize.current = { w: view.scrollDOM.clientWidth, h: view.scrollDOM.clientHeight }
    // Seed the toolbar: a freshly built view (article switch) has a selection
    // and an empty history the page has not heard about yet.
    onViewStateRef.current?.({
      line: view.state.doc.lineAt(view.state.selection.main.from).number - 1,
      from: view.state.selection.main.from,
      to: view.state.selection.main.to,
      undoDepth: undoDepth(view.state),
      redoDepth: redoDepth(view.state),
    })
    // Exposed so the headless-browser check in scripts/cdp-verify-image-ops.mjs
    // can type into the real editor instead of guessing at the DOM.
    ;(window as unknown as { __mopaiCodemirror?: EditorView }).__mopaiCodemirror = view
    const onScroll = () => onScrollRef.current?.()
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll)
      ;(window as unknown as { __mopaiCodemirror?: EditorView }).__mopaiCodemirror = undefined
      view.destroy()
    }
    // Rebuilt when the article changes (see docKey); content edits within one
    // article are applied by the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // 外部内容切换（换稿/新建）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== value) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
    }
  }, [value])

  useImperativeHandle(ref, () => ({
    jumpToLine: (line: number) => {
      const view = viewRef.current
      if (!view) return
      const ln = Math.max(1, Math.min(view.state.doc.lines, line + 1))
      const pos = view.state.doc.line(ln).from
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
      view.focus()
    },
    getTopLine: () => {
      const view = viewRef.current
      if (!view) return null
      // lineBlockAtHeight understands wrapped lines, so a paragraph that spans
      // six screen rows still reports the source line its first row belongs to.
      const block = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.scrollTop))
      return view.state.doc.lineAt(block.from).number - 1
    },
    lineTop: (line: number) => {
      const view = viewRef.current
      if (!view) return null
      // Clamped like every other line lookup: sync asks for the line a block ends
      // on, which for the last block is one past the document.
      const ln = Math.max(1, Math.min(view.state.doc.lines, line + 1))
      return view.lineBlockAt(view.state.doc.line(ln).from).top
    },
    scrollToLine: (line: number) => {
      const view = viewRef.current
      if (!view) return
      const ln = Math.max(1, Math.min(view.state.doc.lines, line + 1))
      // Direct scrollTop, not scrollIntoView: that one centres and animates, so
      // calling it every frame while syncing makes the editor fight the preview.
      view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(ln).from).top
    },
    getScroll: () => {
      const view = viewRef.current
      if (!view) return null
      const sd = view.scrollDOM
      return { top: sd.scrollTop, max: Math.max(0, sd.scrollHeight - sd.clientHeight) }
    },
    setScroll: (top: number) => {
      const view = viewRef.current
      if (!view) return
      // Writing a position the pane is already at only bounces a scroll event
      // back at the pane we just read, which is how a sync starts to oscillate.
      if (Math.abs(view.scrollDOM.scrollTop - top) < 1) return
      view.scrollDOM.scrollTop = top
    },
    insertText: (text: string) => {
      const view = viewRef.current
      if (!view) return
      insertBlock(view, view.state.selection.main.head, text)
    },
    insertAt: (pos: number | null, text: string) => {
      const view = viewRef.current
      if (!view) return
      insertBlock(view, pos ?? view.state.selection.main.head, text)
    },
    getState: () => {
      const view = viewRef.current
      if (!view) return null
      const sel = view.state.selection.main
      return { text: view.state.doc.toString(), from: sel.from, to: sel.to }
    },
    applyEdit: (res) => {
      const view = viewRef.current
      if (!view) return
      const old = view.state.doc.toString()
      if (old === res.doc) {
        view.dispatch({ selection: { anchor: res.from, head: res.to } })
        view.focus()
        return
      }
      // Dispatch only the changed span: a whole-document replacement would be
      // recorded as one edit too, but this keeps unspecified extensions and
      // any in-flight selection sound, and the change set stays meaningful.
      let head = 0
      const min = Math.min(old.length, res.doc.length)
      while (head < min && old[head] === res.doc[head]) head++
      let tail = 0
      while (tail < min - head && old[old.length - 1 - tail] === res.doc[res.doc.length - 1 - tail]) tail++
      view.dispatch({
        changes: { from: head, to: old.length - tail, insert: res.doc.slice(head, res.doc.length - tail) },
        selection: { anchor: res.from, head: res.to },
      })
      view.focus()
    },
    insertTemplate: (text: string, caret?: number, caretEnd?: number) => {
      const view = viewRef.current
      if (!view) return
      insertBlockTemplate(view, view.state.selection.main.head, text, caret, caretEnd)
    },
    undo: () => {
      const view = viewRef.current
      if (!view) return
      undo(view)
      view.focus()
    },
    redo: () => {
      const view = viewRef.current
      if (!view) return
      redo(view)
      view.focus()
    },
    focus: () => viewRef.current?.focus(),
  }))

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
})

export default EditorPane
