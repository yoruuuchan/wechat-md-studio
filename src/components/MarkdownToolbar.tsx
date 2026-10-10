/**
 * The left column's toolbar: the Markdown editing commands that used to be
 * keyboard-only, plus the semantic format brush.
 *
 * The component is deliberately dumb about Markdown — every action is handed to
 * the page, which owns the document, the parser's blocks and the CodeMirror
 * handle. What lives here is the surface: which buttons exist, what they light
 * up, and how they fold away when the column gets narrow.
 *
 * Folding is measured, not guessed: a hidden row always renders every item at
 * its natural width, and the visible row keeps the highest-value items until
 * the next one would overflow. Lowest value (images, links) goes into ··· first;
 * undo/redo, the block menu, bold, the highlight and the brush are the last
 * survivors. A language switch changes every label's width, so `lang` is part
 * of the measuring pass.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bold,
  BookOpen,
  ChevronDown,
  Code,
  Ellipsis,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  Minus,
  Paintbrush,
  PenLine,
  Redo2,
  RemoveFormatting,
  Sigma,
  SquareCode,
  Strikethrough,
  Table2,
  Undo2,
  Images,
  LayoutGrid,
  Workflow,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CAROUSEL_RATIOS, GALLERY_COLS, type CarouselRatio } from '@/lib/types'
import { CHEATSHEET } from '@/lib/sample'
import type { InlineFormat, InlineState } from '@/lib/md-format'
import { useI18n } from '@/hooks/useI18n'
import type { MsgKey } from '@/lib/i18n'

export type TableAlign = 'none' | 'left' | 'center' | 'right'

export type ToolbarAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'inline'; format: InlineFormat }
  | { type: 'link' }
  | { type: 'clear' }
  | { type: 'block'; kind: 'heading' | 'subheading' | 'paragraph' }
  | { type: 'quote'; kind: 'quoteCard' | 'quoteBox' | 'center' }
  | { type: 'list'; ordered: boolean }
  | { type: 'image' }
  | { type: 'imagePlaceholder' }
  | { type: 'table'; cols: number; rows: number; align: TableAlign }
  | { type: 'carousel'; ratio: CarouselRatio }
  | { type: 'gallery'; cols: number; ratio: CarouselRatio }
  | { type: 'math'; tex: string }
  | { type: 'code'; lang: string }
  | { type: 'mermaid' }
  | { type: 'hr' }
  | { type: 'signature' }

export type BrushMode = 'off' | 'single' | 'locked'

export interface ToolbarState {
  inline: InlineState
  /** The block the cursor sits in; only the six convertible kinds light a menu. */
  block: string
  ordered: boolean
  canUndo: boolean
  canRedo: boolean
}

interface Props {
  state: ToolbarState
  brush: BrushMode
  onAction: (a: ToolbarAction) => void
  onBrush: (b: BrushMode) => void
}

// ---------- layout model ----------

interface Group {
  key: string
  items: string[]
}

const GROUPS: Group[] = [
  { key: 'history', items: ['undo', 'redo'] },
  { key: 'heading', items: ['heading'] },
  { key: 'inline', items: ['bold', 'mark', 'italic', 'strike', 'code', 'brush', 'clear'] },
  { key: 'block', items: ['quote', 'list', 'link', 'image'] },
]

/**
 * Who folds into ··· first. The always-visible names (undo, redo, the heading
 * menu, B, the highlight, the brush) are simply absent — they never fold.
 */
const FOLD_ORDER = ['image', 'link', 'list', 'quote', 'strike', 'code', 'clear', 'italic', 'label', 'helpText']

const GAP = 3
/** Fallback separator width until the measuring row has rendered one. */
const SEP_FALLBACK = 9

type PanelKind = 'table' | 'carousel' | 'gallery' | 'math' | 'code'

const RATIO_KEYS: Record<CarouselRatio, MsgKey> = {
  '4:3': 'toolbar.ratio.4:3',
  '3:4': 'toolbar.ratio.3:4',
  '16:9': 'toolbar.ratio.16:9',
  '9:16': 'toolbar.ratio.9:16',
  '1:1': 'toolbar.ratio.1:1',
}

/** Common fences offered by the code-block panel. '' means no language. */
const LANGUAGES = ['', 'bash', 'js', 'ts', 'python', 'json', 'html', 'css']

// ---------- small pieces ----------

function ToolButton({
  id,
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  id: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick?: (e: React.MouseEvent) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-tool={id}
      data-active={active ? 'true' : undefined}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="ya-tool"
      // Keep the editor's focus — and with it the selection the command needs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-active={active ? 'true' : undefined}
      className="ya-tool px-2"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ---------- panels shown inside the ··· menu ----------

function TablePanel({ onInsert, onClose }: { onInsert: (cols: number, rows: number, align: TableAlign) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [align, setAlign] = useState<TableAlign>('none')
  const [hover, setHover] = useState({ cols: 2, rows: 2 })
  const aligns: { value: TableAlign; label: string }[] = [
    { value: 'none', label: t('toolbar.table.alignDefault') },
    { value: 'left', label: t('toolbar.table.alignLeft') },
    { value: 'center', label: t('toolbar.table.alignCenter') },
    { value: 'right', label: t('toolbar.table.alignRight') },
  ]
  return (
    <div className="p-1">
      <p className="ya-eyebrow px-1 pb-1.5">{t('toolbar.table.title', { cols: hover.cols, rows: hover.rows })}</p>
      <div className="mb-2 flex gap-1 px-1">
        {aligns.map((a) => (
          <Chip key={a.value} active={align === a.value} onClick={() => setAlign(a.value)}>
            {a.label}
          </Chip>
        ))}
      </div>
      <div className="px-1" onMouseLeave={() => setHover({ cols: 2, rows: 2 })}>
        {[0, 1, 2].map((r) => (
          <div key={r} className="flex gap-1 pb-1">
            {[0, 1, 2].map((c) => {
              const cols = c + 2
              const rows = r + 2
              const on = cols <= hover.cols && rows <= hover.rows
              return (
                <button
                  key={c}
                  type="button"
                  title={`${cols} × ${rows}`}
                  className={`h-6 w-9 rounded-md border text-[10px] transition-colors ${on ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-line-2 text-ink-4'}`}
                  onMouseEnter={() => setHover({ cols, rows })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onInsert(cols, rows, align)
                    onClose()
                  }}
                >
                  {cols}×{rows}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function CarouselPanel({ onInsert, onClose }: { onInsert: (ratio: CarouselRatio) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [ratio, setRatio] = useState<CarouselRatio>('4:3')
  return (
    <div className="p-1">
      <p className="ya-eyebrow px-1 pb-1.5">{t('toolbar.carousel.title')}</p>
      <div className="flex flex-wrap gap-1 px-1 pb-2">
        {CAROUSEL_RATIOS.map((r) => (
          <Chip key={r} active={ratio === r} onClick={() => setRatio(r)}>
            {t(RATIO_KEYS[r])}
          </Chip>
        ))}
      </div>
      <button
        type="button"
        className="ya-btn ya-btn-primary ya-btn-sm w-full"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onInsert(ratio)
          onClose()
        }}
      >
        {t('toolbar.carousel.insert')}
      </button>
    </div>
  )
}

function GalleryPanel({
  onInsert,
  onClose,
}: {
  onInsert: (cols: number, ratio: CarouselRatio) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [cols, setCols] = useState<number>(3)
  const [ratio, setRatio] = useState<CarouselRatio>('1:1')
  return (
    <div className="p-1">
      <p className="ya-eyebrow px-1 pb-1.5">{t('toolbar.gallery.title')}</p>
      <div className="flex items-center gap-1 px-1 pb-1.5">
        <span className="w-8 text-[11px] text-ink-3">{t('toolbar.gallery.cols')}</span>
        {GALLERY_COLS.map((c) => (
          <Chip key={c} active={cols === c} onClick={() => setCols(c)}>
            {t('toolbar.gallery.col', { n: c })}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 pb-2">
        <span className="w-8 text-[11px] text-ink-3">{t('toolbar.gallery.ratio')}</span>
        {CAROUSEL_RATIOS.map((r) => (
          <Chip key={r} active={ratio === r} onClick={() => setRatio(r)}>
            {t(RATIO_KEYS[r])}
          </Chip>
        ))}
      </div>
      <button
        type="button"
        className="ya-btn ya-btn-primary ya-btn-sm w-full"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onInsert(cols, ratio)
          onClose()
        }}
      >
        {t('toolbar.gallery.insert')}
      </button>
    </div>
  )
}

function MathPanel({ onInsert, onClose }: { onInsert: (tex: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [tex, setTex] = useState('')
  const insert = () => {
    onInsert(tex)
    onClose()
  }
  return (
    <div className="p-1">
      <p className="ya-eyebrow px-1 pb-1.5">{t('toolbar.math.title')}</p>
      <textarea
        className="ya-input mb-2 h-16 w-full resize-none py-1.5 text-[12px]"
        placeholder="E = mc^2"
        value={tex}
        autoFocus
        onChange={(e) => setTex(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) insert()
        }}
      />
      <button
        type="button"
        className="ya-btn ya-btn-primary ya-btn-sm w-full"
        onMouseDown={(e) => e.preventDefault()}
        onClick={insert}
      >
        {t('toolbar.math.insert')}
      </button>
    </div>
  )
}

function CodePanel({ onInsert, onClose }: { onInsert: (lang: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className="p-1">
      <p className="ya-eyebrow px-1 pb-1.5">{t('toolbar.codeBlock.title')}</p>
      <div className="flex flex-wrap gap-1 px-1">
        {LANGUAGES.map((l) => (
          <Chip
            key={l || 'none'}
            onClick={() => {
              onInsert(l)
              onClose()
            }}
          >
            {l || t('toolbar.codeBlock.none')}
          </Chip>
        ))}
      </div>
    </div>
  )
}

// ---------- the toolbar ----------

export default function MarkdownToolbar({ state, brush, onAction, onBrush }: Props) {
  const { t, lang } = useI18n()
  const frameRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [folded, setFolded] = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [panel, setPanel] = useState<PanelKind | null>(null)

  const foldedSet = new Set(folded)
  const has = (id: string) => !foldedSet.has(id)

  /**
   * Close the ··· menu and drop any panel it was showing.
   *
   * Both halves have to happen together: closing by writing the `open` prop
   * ourselves never fires Radix's onOpenChange, so a panel left behind would
   * be there again the next time the menu opens.
   */
  const closeMore = () => {
    setMoreOpen(false)
    setPanel(null)
  }

  const widthOf = (id: string): number => {
    const el = measureRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`)
    return el ? el.offsetWidth : 0
  }

  /**
   * Fold items until the row fits. The hidden measuring row is the source of
   * every width, so a label that grows ("正文" -> "章节标题", or a language
   * switch) is re-measured with everything else.
   */
  const recompute = useCallback(() => {
    const frame = frameRef.current
    if (!frame || !measureRef.current) return

    const helpW = (set: Set<string>) => (set.has('helpText') ? widthOf('helpIcon') : widthOf('helpFull'))
    const total = (set: Set<string>): number => {
      const widths: number[] = []
      const sep = widthOf('sep') || SEP_FALLBACK
      if (!set.has('label')) widths.push(widthOf('label'))
      for (const g of GROUPS) {
        const items = g.items.filter((id) => !set.has(id))
        if (!items.length) continue
        widths.push(sep)
        for (const id of items) widths.push(widthOf(id))
      }
      // The ··· button is a permanent entry to the structural inserts, not just
      // an overflow bin, so its width is always part of the budget.
      widths.push(sep, widthOf('more'))
      return widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, widths.length - 1)
    }

    // The row also carries a flexible spacer before the help button; the extra
    // gap allowance keeps the last item from landing right on the edge.
    const budget = frame.clientWidth - helpW(new Set()) - GAP * 3
    let set = new Set<string>()
    for (let guard = 0; guard < FOLD_ORDER.length + 1; guard++) {
      if (total(set) <= budget) break
      const next = FOLD_ORDER.find((id) => !set.has(id))
      if (!next) break
      set.add(next)
    }
    // Once the help button shrank, re-check with its smaller width.
    if (total(set) <= budget && set.has('helpText')) {
      const relaxed = new Set(set)
      relaxed.delete('helpText')
      if (total(relaxed) <= budget) set = relaxed
    }
    const next = [...set].sort()
    setFolded((prev) => (prev.join(',') === next.join(',') ? prev : next))
  }, [])

  // The fold decision can only be made once the row is in the DOM, and it has
  // to land before the first paint — otherwise the toolbar shows every item for
  // a frame and then folds. Widths change with the block label, the brush badge
  // and the language, so all three drive the pass; pane resizes come in through
  // the ResizeObserver below.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured layout: this reads the real widths of the hidden row and only writes state when the set actually changed.
    recompute()
  }, [recompute, folded, state.block, brush, lang])

  useEffect(() => {
    const frame = frameRef.current
    const row = measureRef.current
    if (!frame) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(frame)
    if (row) ro.observe(row)
    return () => ro.disconnect()
  }, [recompute])

  // Esc leaves the format brush, wherever the focus happens to be.
  useEffect(() => {
    if (brush === 'off') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBrush('off')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [brush, onBrush])

  const act = (a: ToolbarAction) => () => onAction(a)

  const brushClick = (e: React.MouseEvent) => {
    // Double click locks the brush; a later single click switches it off.
    if (e.detail >= 2) {
      onBrush('locked')
      return
    }
    onBrush(brush === 'off' ? 'single' : 'off')
  }

  const blockLabel = state.block === 'heading' ? t('toolbar.block.heading') : state.block === 'subheading' ? t('toolbar.block.subheading') : t('toolbar.block.paragraph')
  const quoteLabel = state.block === 'quoteCard' ? t('toolbar.quoteFallback') : state.block === 'quoteBox' ? t('toolbar.quoteBox') : state.block === 'center' ? t('toolbar.center') : t('toolbar.quoteFallback')
  const headingValue = ['heading', 'subheading', 'paragraph'].includes(state.block) ? state.block : ''
  const quoteValue = ['quoteCard', 'quoteBox', 'center'].includes(state.block) ? state.block : ''
  const marker = { size: 13, strokeWidth: 2 } as const

  const menuItem = (label: string, hint: string, icon: ReactNode, run: () => void) => (
    <DropdownMenuItem key={label} className="rounded-lg" onSelect={run}>
      {icon}
      {label}
      <span className="ml-auto pl-3 text-[10px] text-ink-3">{hint}</span>
    </DropdownMenuItem>
  )

  const renderItem = (id: string): ReactNode => {
    switch (id) {
      case 'undo':
        return (
          <ToolButton key={id} id={id} title={t('toolbar.undo')} disabled={!state.canUndo} onClick={act({ type: 'undo' })}>
            <Undo2 {...marker} />
          </ToolButton>
        )
      case 'redo':
        return (
          <ToolButton key={id} id={id} title={t('toolbar.redo')} disabled={!state.canRedo} onClick={act({ type: 'redo' })}>
            <Redo2 {...marker} />
          </ToolButton>
        )
      case 'heading':
        return (
          <DropdownMenu key={id}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-tool="heading"
                data-active={state.block === 'heading' || state.block === 'subheading' ? 'true' : undefined}
                className="ya-tool"
                title={t('toolbar.headingTitle')}
                onMouseDown={(e) => e.preventDefault()}
              >
                {blockLabel}
                <ChevronDown size={10} strokeWidth={2.4} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-menu="heading" align="start" className="ya-pop w-56 border-none" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuRadioGroup
                value={headingValue}
                onValueChange={(v) => onAction({ type: 'block', kind: v as 'heading' | 'subheading' | 'paragraph' })}
              >
                <DropdownMenuRadioItem value="heading" className="rounded-lg">
                  {t('toolbar.block.heading')}
                  <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">## KICKER | 标题</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="subheading" className="rounded-lg">
                  {t('toolbar.block.subheading')}
                  <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">### 标题</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="paragraph" className="rounded-lg">
                  {t('toolbar.block.paragraphMenu')}
                  <span className="ml-auto pl-3 text-[10px] text-ink-3">{t('toolbar.block.removeMark')}</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      case 'bold':
      case 'italic':
      case 'strike':
      case 'code': {
        const icon = {
          bold: <Bold {...marker} />,
          italic: <Italic {...marker} />,
          strike: <Strikethrough {...marker} />,
          code: <Code {...marker} />,
        }[id]
        const title = { bold: t('toolbar.bold'), italic: t('toolbar.italic'), strike: t('toolbar.strike'), code: t('toolbar.code') }[id]
        return (
          <ToolButton key={id} id={id} title={title} active={state.inline[id as InlineFormat]} onClick={act({ type: 'inline', format: id as InlineFormat })}>
            {icon}
          </ToolButton>
        )
      }
      case 'mark':
        return (
          <ToolButton key={id} id={id} title={t('toolbar.mark')} active={state.inline.mark} onClick={act({ type: 'inline', format: 'mark' })}>
            <span className="px-0.5 text-[11px] font-semibold">{t('toolbar.markLabel')}</span>
          </ToolButton>
        )
      case 'brush':
        return (
          <ToolButton key={id} id={id} title={t('toolbar.brush')} active={brush !== 'off'} onClick={brushClick}>
            <Paintbrush {...marker} />
            {brush === 'locked' && <Lock size={9} strokeWidth={2.6} />}
          </ToolButton>
        )
      case 'clear':
        return (
          <ToolButton key={id} id={id} title={t('toolbar.clear')} onClick={act({ type: 'clear' })}>
            <RemoveFormatting {...marker} />
          </ToolButton>
        )
      case 'quote':
        return (
          <DropdownMenu key={id}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-tool="quote"
                data-active={quoteValue ? 'true' : undefined}
                className="ya-tool"
                title={t('toolbar.quoteTitle')}
                onMouseDown={(e) => e.preventDefault()}
              >
                {quoteLabel}
                <ChevronDown size={10} strokeWidth={2.4} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-menu="quote" align="start" className="ya-pop w-56 border-none" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuRadioGroup
                value={quoteValue}
                onValueChange={(v) => onAction({ type: 'quote', kind: v as 'quoteCard' | 'quoteBox' | 'center' })}
              >
                <DropdownMenuRadioItem value="quoteCard" className="rounded-lg">
                  {t('toolbar.quoteCard')}
                  <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">&gt; 内容</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="quoteBox" className="rounded-lg">
                  {t('toolbar.quoteBox')}
                  <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">:::quote</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="center" className="rounded-lg">
                  {t('toolbar.center')}
                  <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">:::center</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      case 'list':
        return (
          <DropdownMenu key={id}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-tool="list"
                data-active={state.block === 'list' ? 'true' : undefined}
                className="ya-tool"
                title={t('toolbar.list')}
                onMouseDown={(e) => e.preventDefault()}
              >
                {t('toolbar.list')}
                <ChevronDown size={10} strokeWidth={2.4} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-menu="list" align="start" className="ya-pop w-52 border-none" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'list', ordered: false })}>
                <List size={13} strokeWidth={2} />
                {t('toolbar.unordered')}
                <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">- 内容</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'list', ordered: true })}>
                <ListOrdered size={13} strokeWidth={2} />
                {t('toolbar.ordered')}
                <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">1. 内容</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      case 'link':
        return (
          <ToolButton key={id} id={id} title={t('toolbar.link')} active={state.inline.link} onClick={act({ type: 'link' })}>
            <Link2 {...marker} />
          </ToolButton>
        )
      case 'image':
        return (
          <div key={id} className="flex items-center">
            <ToolButton id="image" title={t('toolbar.image')} onClick={act({ type: 'image' })}>
              <ImagePlus {...marker} />
            </ToolButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-tool="image-menu"
                  className="ya-tool -ml-1 px-0"
                  title={t('toolbar.imageMenu')}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <ChevronDown size={9} strokeWidth={2.6} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent data-menu="image" align="start" className="ya-pop w-52 border-none" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'image' })}>
                  {t('toolbar.imageUpload')}
                  <span className="ml-auto pl-3 text-[10px] text-ink-3">{t('toolbar.imageUploadHint')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'imagePlaceholder' })}>
                  {t('toolbar.imagePlaceholder')}
                  <span className="ml-auto pl-3 font-mono text-[10px] text-ink-3">![图注]()</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      default:
        return null
    }
  }

  const foldedInline = (['italic', 'strike', 'code', 'clear'] as const).filter((id) => foldedSet.has(id))
  const foldedLink = foldedSet.has('link')
  const foldedImage = foldedSet.has('image')
  const foldedQuote = foldedSet.has('quote')
  const foldedList = foldedSet.has('list')

  return (
    <div className="h-11 shrink-0 border-b border-line-1 px-3">
      <div ref={frameRef} className="relative flex h-full w-full min-w-0 items-center gap-[3px]">
        {/* Hidden measuring row: every item at its natural width, always. */}
        <div
          ref={measureRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 flex w-max items-center gap-[3px] whitespace-nowrap opacity-0"
        >
          <span data-mid="label" className="px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
            {t('toolbar.label')}
          </span>
          {['undo', 'redo', 'heading', 'bold', 'mark', 'italic', 'strike', 'code', 'brush', 'clear', 'quote', 'list', 'link', 'image'].map((id) => (
            <span key={id} data-mid={id} className="inline-flex">
              {renderItem(id)}
            </span>
          ))}
          <span data-mid="sep" className="mx-1 h-3.5 w-px shrink-0 bg-line-2" />
          <span data-mid="more" className="ya-tool w-6">
            <Ellipsis size={13} />
          </span>
          <span data-mid="helpFull" className="ya-tool px-2">
            {t('toolbar.help')}
          </span>
          <span data-mid="helpIcon" className="ya-tool w-6">
            <BookOpen size={13} />
          </span>
        </div>

        {has('label') && (
          <span className="shrink-0 whitespace-nowrap px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
            {t('toolbar.label')}
          </span>
        )}

        {GROUPS.map((g, gi) => {
          const items = g.items.filter((id) => has(id))
          if (!items.length) return null
          // No leading separator when the label is folded away: the first
          // visible group starts the row.
          const first = gi === 0 && !has('label')
          return (
            <div key={g.key} className="flex items-center gap-[3px]">
              {!first && <span className="mx-1 h-3.5 w-px shrink-0 bg-line-2" />}
              {items.map(renderItem)}
            </div>
          )
        })}

        <DropdownMenu
          open={moreOpen}
          onOpenChange={(o) => {
            setMoreOpen(o)
            if (!o) setPanel(null)
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-tool="more"
              data-active={moreOpen ? 'true' : undefined}
              className="ya-tool"
              title={t('toolbar.more')}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Ellipsis {...marker} />
            </button>
          </DropdownMenuTrigger>
            <DropdownMenuContent
              data-menu="more"
              align="end"
              className="ya-pop w-60 border-none"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {panel === null ? (
                <>
                  {foldedInline.length > 0 || foldedLink || foldedImage || foldedQuote || foldedList ? (
                    <>
                      {foldedInline.map((id) => {
                        const label = { italic: t('toolbar.italic'), strike: t('toolbar.strike'), code: t('toolbar.code'), clear: t('toolbar.clear') }[id]
                        const icon = {
                          italic: <Italic size={13} strokeWidth={2} />,
                          strike: <Strikethrough size={13} strokeWidth={2} />,
                          code: <Code size={13} strokeWidth={2} />,
                          clear: <RemoveFormatting size={13} strokeWidth={2} />,
                        }[id]
                        return (
                          <DropdownMenuItem
                            key={id}
                            className="rounded-lg"
                            onSelect={id === 'clear' ? () => onAction({ type: 'clear' }) : () => onAction({ type: 'inline', format: id })}
                          >
                            {icon}
                            {label}
                          </DropdownMenuItem>
                        )
                      })}
                      {foldedLink && (
                        <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'link' })}>
                          <Link2 size={13} strokeWidth={2} />
                          {t('toolbar.linkMenu')}
                        </DropdownMenuItem>
                      )}
                      {foldedQuote && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="rounded-lg">{t('toolbar.quoteMenu')}</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="ya-pop w-44 border-none">
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'quote', kind: 'quoteCard' })}>
                              {t('toolbar.quoteCard')}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'quote', kind: 'quoteBox' })}>
                              {t('toolbar.quoteBox')}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'quote', kind: 'center' })}>
                              {t('toolbar.center')}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      {foldedList && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="rounded-lg">{t('toolbar.list')}</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="ya-pop w-44 border-none">
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'list', ordered: false })}>
                              {t('toolbar.unordered')}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'list', ordered: true })}>
                              {t('toolbar.ordered')}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      {foldedImage && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="rounded-lg">{t('toolbar.imageMenu')}</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="ya-pop w-48 border-none">
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'image' })}>
                              {t('toolbar.imageUpload')}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="rounded-lg" onSelect={() => onAction({ type: 'imagePlaceholder' })}>
                              {t('toolbar.imagePlaceholder')}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuItem className="rounded-lg" onSelect={(e) => { e.preventDefault(); setPanel('table') }}>
                    <Table2 size={13} strokeWidth={2} />
                    {t('toolbar.table')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-lg" onSelect={(e) => { e.preventDefault(); setPanel('carousel') }}>
                    <Images size={13} strokeWidth={2} />
                    {t('toolbar.carousel')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-lg" onSelect={(e) => { e.preventDefault(); setPanel('gallery') }}>
                    <LayoutGrid size={13} strokeWidth={2} />
                    {t('toolbar.gallery')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-lg" onSelect={(e) => { e.preventDefault(); setPanel('math') }}>
                    <Sigma size={13} strokeWidth={2} />
                    {t('toolbar.math')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-lg" onSelect={(e) => { e.preventDefault(); setPanel('code') }}>
                    <SquareCode size={13} strokeWidth={2} />
                    {t('toolbar.codeBlock')}
                  </DropdownMenuItem>
                  {menuItem(t('toolbar.mermaid'), '```mermaid', <Workflow size={13} strokeWidth={2} />, () => onAction({ type: 'mermaid' }))}
                  {menuItem(t('toolbar.hr'), '---', <Minus size={13} strokeWidth={2} />, () => onAction({ type: 'hr' }))}
                  {menuItem(t('toolbar.signature'), '@signature', <PenLine size={13} strokeWidth={2} />, () => onAction({ type: 'signature' }))}
                </>
              ) : (
                <div onKeyDown={(e) => e.stopPropagation()}>
                  {panel === 'table' && <TablePanel onClose={closeMore} onInsert={(cols, rows, align) => onAction({ type: 'table', cols, rows, align })} />}
                  {panel === 'carousel' && <CarouselPanel onClose={closeMore} onInsert={(ratio) => onAction({ type: 'carousel', ratio })} />}
                  {panel === 'gallery' && (
                    <GalleryPanel onClose={closeMore} onInsert={(cols, ratio) => onAction({ type: 'gallery', cols, ratio })} />
                  )}
                  {panel === 'math' && <MathPanel onClose={closeMore} onInsert={(tex) => onAction({ type: 'math', tex })} />}
                  {panel === 'code' && <CodePanel onClose={closeMore} onInsert={(lang) => onAction({ type: 'code', lang })} />}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

        <span className="flex-1" />

        <Popover>
          <PopoverTrigger asChild>
            <button type="button" data-tool="help" className="ya-tool shrink-0 px-2" title={t('toolbar.help')} onMouseDown={(e) => e.preventDefault()}>
              {foldedSet.has('helpText') ? <BookOpen size={13} /> : t('toolbar.help')}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="ya-pop w-80 border-none p-0">
            <p className="ya-eyebrow border-b border-line-2 px-3 py-2">{t('toolbar.helpTitle')}</p>
            <ul className="max-h-80 overflow-y-auto p-2">
              {CHEATSHEET.map((c) => (
                <li key={c.syntax} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-tint">
                  <code className="shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 font-mono text-[11px] text-brand-600">{c.syntax}</code>
                  <span className="text-[12px] text-ink-2">{t(c.desc)}</span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        {brush !== 'off' && (
          <span className="pointer-events-none absolute inset-x-0 -bottom-[1px] h-[1.5px] bg-brand-500/70" />
        )}
      </div>
    </div>
  )
}
