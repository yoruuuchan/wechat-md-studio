import type { Block } from './types'
import type { MaterialItem } from './render'
import type { MsgKey, MsgParams } from './i18n.zh'

/**
 * What one publish-blocking or publish-warning finding is about.
 *
 * The code is what tests assert on and what decides the wording; the message
 * itself is looked up through i18n so both languages stay in one place.
 */
export type PreflightCode =
  | 'math-failed'
  | 'math-pending'
  | 'math-engine'
  | 'diagram-failed'
  | 'diagram-pending'
  | 'image-placeholder'
  | 'image-local'
  | 'image-unverifiable'
  | 'renderer-warning'

/**
 * `blocker`     the output is provably incomplete — the author has to decide
 * `warning`     readable, but the author should see it and may accept it
 * `note`        the renderer's own observation. Worth stating, never a reason
 *               to stop: a link that gets collected into 参考链接, or a diagram
 *               without a caption, is normal.
 * `unverifiable` this tool cannot answer the question; say so instead of
 *                implying the image is fine
 */
export type PreflightSeverity = 'blocker' | 'warning' | 'note' | 'unverifiable'

/** Where a finding sits in the article, so the panel can jump to it. */
export interface PreflightLocation {
  /** 0-based source line of the block or image. */
  line?: number
  /** Figure label as the article numbers it, e.g. 图3 / 图3-2. */
  figure?: string
  /** Caption and index of the image, for a jump that survives repeated captions. */
  alt?: string
  occurrence?: number
}

export interface PreflightItem {
  id: string
  code: PreflightCode
  severity: PreflightSeverity
  titleKey: MsgKey
  titleParams?: MsgParams
  detailKey: MsgKey
  detailParams?: MsgParams
  /** Already-translated prose, for renderer warnings that are built as sentences. */
  text?: string
  location?: PreflightLocation
  /** True when the author may consciously accept this one and carry on. */
  ignorable: boolean
}

/** One diagram fence and how far its rasterization has got. */
export interface DiagramState {
  code: string
  line: number
  state: 'ready' | 'pending' | 'failed'
}

export interface PreflightInput {
  blocks: readonly Block[]
  materials: readonly MaterialItem[]
  /** Formula status from the shared math renderer. */
  mathStatus: (tex: string, display: boolean) => 'pending' | 'rendered' | 'failed'
  mathEngineUnavailable: boolean
  diagrams: readonly DiagramState[]
  /** `stats.warnings` from `renderDoc`, already localized. */
  rendererWarnings: readonly string[]
}

export interface PreflightReport {
  items: PreflightItem[]
  blockers: PreflightItem[]
  warnings: PreflightItem[]
  notes: PreflightItem[]
  unverifiable: PreflightItem[]
  /**
   * True when the author has to be asked before the output runs. Notes and
   * unverifiable addresses are reported, in the panel if one opens and in the
   * success toast if one does not, but they never hold a copy up: an article
   * with a link in it is not an unfinished article.
   */
  gates: boolean
}

/** How an image address will behave once it reaches the WeChat editor. */
export type ImageAddressKind =
  /** Our own uploaded object (`img:<key>`). */
  | 'ready'
  /** An empty slot the author has not filled yet. */
  | 'placeholder'
  /** Loopback, LAN or a relative path: WeChat can never fetch it. */
  | 'local'
  /** A public absolute URL. Reachable in principle, unverifiable from here. */
  | 'external'
  /** Inlined image bytes; WeChat does not re-host these. */
  | 'embedded'

const PRIVATE_V4 = /^172\.(\d{1,3})\./

/** Strip scheme, credentials, port and path; leave a bare lowercase host. */
export function hostOf(src: string): string {
  const withoutScheme = src.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '')
  const authority = withoutScheme.split(/[/?#]/, 1)[0] ?? ''
  const afterCredentials = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  const host = afterCredentials.replace(/:\d+$/, '')
  return host.replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * Addresses only reachable from this machine or this network.
 *
 * These are worth naming rather than silently allowing: WeChat fetches the
 * image from its own servers when the article is pasted, so a loopback or LAN
 * address is a broken image in the published article every time.
 */
export function isLocalHost(host: string): boolean {
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0.0.0.0') return true
  if (/^127\./.test(host)) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  const private172 = PRIVATE_V4.exec(host)
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true
  if (/\.(local|internal|lan|home|corp)$/.test(host)) return true
  // A single-label host is an intranet name, never a public site.
  return !host.includes('.')
}

export function classifyImageAddress(src: string): ImageAddressKind {
  const address = src.trim()
  if (!address) return 'placeholder'
  if (address.startsWith('img:')) return 'ready'
  // A DOCX import leaves a numbered slot behind until the author supplies a file.
  if (/^docx-import:/i.test(address)) return 'placeholder'
  if (/^data:/i.test(address)) return 'embedded'
  if (/^(https?:)?\/\//i.test(address)) {
    return isLocalHost(hostOf(address)) ? 'local' : 'external'
  }
  // No scheme means it resolves against whatever page it is pasted into, which
  // for a copied article is the WeChat editor's own origin — never ours.
  return 'local'
}

const short = (tex: string) => (tex.length > 60 ? `${tex.slice(0, 60)}…` : tex)

/**
 * The article's real state at the moment the author asks for output.
 *
 * Copy and both HTML exports run this one function, so "may I hand this out?"
 * has a single answer. Markdown and full-bundle export deliberately do not:
 * they hand back the source, which is exactly what an unfinished article needs.
 */
export function buildPreflight(input: PreflightInput): PreflightReport {
  const items: PreflightItem[] = []

  // ---- formulas: an unfinished formula must not ship as if it were done ----
  const formulas: { tex: string; display: boolean; line: number }[] = []
  const seen = new Set<string>()
  for (const b of input.blocks) {
    if (b.type !== 'math') continue
    const key = `${b.display ? 'd' : 'i'}\u0000${b.tex}`
    if (seen.has(key)) continue
    seen.add(key)
    formulas.push({ tex: b.tex, display: b.display, line: b.line })
  }
  const failedMath = formulas.filter((f) => input.mathStatus(f.tex, f.display) === 'failed')
  const pendingMath = formulas.filter((f) => input.mathStatus(f.tex, f.display) === 'pending')
  for (const f of failedMath) {
    items.push({
      id: `math-failed:${f.line}`,
      code: 'math-failed',
      severity: 'blocker',
      titleKey: 'preflight.mathFailed.title',
      detailKey: 'preflight.mathFailed.detail',
      detailParams: { tex: short(f.tex) },
      location: { line: f.line },
      ignorable: false,
    })
  }
  if (input.mathEngineUnavailable && pendingMath.length) {
    items.push({
      id: 'math-engine',
      code: 'math-engine',
      severity: 'blocker',
      titleKey: 'preflight.mathEngine.title',
      detailKey: 'preflight.mathEngine.detail',
      detailParams: { n: pendingMath.length },
      location: { line: pendingMath[0].line },
      ignorable: false,
    })
  } else {
    for (const f of pendingMath) {
      items.push({
        id: `math-pending:${f.line}`,
        code: 'math-pending',
        severity: 'blocker',
        titleKey: 'preflight.mathPending.title',
        detailKey: 'preflight.mathPending.detail',
        location: { line: f.line },
        ignorable: false,
      })
    }
  }

  // ---- diagrams: rasterizing and uploading both have to finish ----
  for (const d of input.diagrams) {
    if (d.state === 'ready') continue
    items.push({
      id: `diagram-${d.state}:${d.line}`,
      code: d.state === 'failed' ? 'diagram-failed' : 'diagram-pending',
      severity: 'blocker',
      titleKey: d.state === 'failed' ? 'preflight.diagramFailed.title' : 'preflight.diagramPending.title',
      detailKey: d.state === 'failed' ? 'preflight.diagramFailed.detail' : 'preflight.diagramPending.detail',
      location: { line: d.line },
      ignorable: false,
    })
  }

  // ---- images: placeholders are a choice, unreachable hosts are not ----
  for (const m of input.materials) {
    const kind = classifyImageAddress(m.src)
    const location: PreflightLocation = { line: m.line, figure: m.no, alt: m.alt, occurrence: m.occurrence }
    if (kind === 'placeholder') {
      items.push({
        id: `image-placeholder:${m.occurrence}`,
        code: 'image-placeholder',
        severity: 'warning',
        titleKey: 'preflight.placeholder.title',
        titleParams: { no: m.no },
        detailKey: 'preflight.placeholder.detail',
        detailParams: { desc: m.desc },
        location,
        ignorable: true,
      })
    } else if (kind === 'local' || kind === 'embedded') {
      items.push({
        id: `image-local:${m.occurrence}`,
        code: 'image-local',
        severity: 'blocker',
        titleKey: kind === 'embedded' ? 'preflight.embeddedImage.title' : 'preflight.localImage.title',
        titleParams: { no: m.no },
        detailKey: kind === 'embedded' ? 'preflight.embeddedImage.detail' : 'preflight.localImage.detail',
        detailParams: { src: short(m.src) },
        location,
        ignorable: false,
      })
    } else if (kind === 'external') {
      items.push({
        id: `image-unverifiable:${m.occurrence}`,
        code: 'image-unverifiable',
        severity: 'unverifiable',
        titleKey: 'preflight.externalImage.title',
        titleParams: { no: m.no },
        detailKey: 'preflight.externalImage.detail',
        detailParams: { src: short(m.src) },
        location,
        ignorable: true,
      })
    }
  }

  // ---- renderer warnings: re-used verbatim, they are already sentences ----
  for (const [index, warning] of input.rendererWarnings.entries()) {
    items.push({
      id: `renderer:${index}`,
      code: 'renderer-warning',
      severity: 'note',
      titleKey: 'preflight.renderer.title',
      detailKey: 'preflight.renderer.detail',
      text: warning,
      ignorable: true,
    })
  }

  const blockers = items.filter((i) => i.severity === 'blocker')
  const warnings = items.filter((i) => i.severity === 'warning')
  const notes = items.filter((i) => i.severity === 'note')
  const unverifiable = items.filter((i) => i.severity === 'unverifiable')
  return { items, blockers, warnings, notes, unverifiable, gates: blockers.length > 0 || warnings.length > 0 }
}