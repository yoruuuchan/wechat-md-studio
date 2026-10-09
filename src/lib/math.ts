/**
 * TeX -> inline SVG, lazily.
 *
 * renderDoc stays a pure synchronous function: it never sees MathJax. It asks an
 * injected resolver for the SVG of a formula and gets either the cached markup or
 * null, and the caller re-renders once the cache fills. That keeps the 38 MB
 * dependency off the first-load bundle and keeps the renderer usable in Node.
 *
 * What reaches renderDoc is not raw MathJax output: every formula is filtered by
 * `sanitizeMathSvg` first. Two independent layers do that work, on purpose -
 *
 *   1. The TeX package allowlist in TEX_PACKAGES. Only packages this tool needs
 *      are compiled in, which is what removes `html` (`\href`, `\style`,
 *      `\class`, `\cssId`), the loaders that could pull it back in at runtime
 *      (`require`, `autoload`), and `setoptions`, which could rewrite the
 *      parser's own options from inside a formula.
 *   2. MathJax's own Safe extension, which screens URLs, classes, ids and styles
 *      as the formula is parsed, plus `sanitizeMathSvg` over the serialized
 *      markup. Neither alone is enough: Safe trusts its own default scheme list
 *      (`https:` is allowed through) and knows nothing about our rules - WeChat
 *      strips class/id anyway - and the sanitizer cannot know what an extension
 *      intended.
 *
 * Measured against a real paste into the WeChat backend: the raw output, with its
 * `ex` units and currentColor, survives intact, so any further rewriting would
 * only be a chance to introduce an error. currentColor is resolved by an explicit
 * `color` on the wrapper paragraph instead.
 *
 * Version note: `mathjax-full` is the v3 API. Its v4 successor moved to
 * `@mathjax/src` plus a separate font package, and in v4 the default font loads
 * `\mathbb`, `\mathfrak` and `\mathcal` asynchronously ("MathJax retry -- an
 * asynchronous action is required" from `MathDocument.convert()`), which are
 * everyday commands in this tool's technical content. So this stays on the v3
 * line, pinned to its final release - see the exact pin in package.json.
 */

import mathjaxPkg from 'mathjax-full/package.json'
import { sanitizeMathSvg } from './math-sanitize'
import { mathFailure } from './theme-fallbacks'

export interface MathEngine {
  convert(tex: string, display: boolean): string
}

let engine: MathEngine | null = null
let loading: Promise<MathEngine> | null = null

/**
 * The TeX packages a formula here may use, paired with the module that registers
 * each one.
 *
 * This is an allowlist, not "everything MathJax ships". Importing a package's
 * configuration module is what registers it; naming it in the parser options
 * alone is not enough (an unknown name is dropped with a warning and its
 * commands stay undefined). Keeping both halves in one object is what stops them
 * from drifting apart. Left out, and why:
 *
 *   html        `\href` (emits a live `<a href>`), `\style`, `\class`, `\cssId`
 *   require     loads arbitrary packages at typeset time - including `html`
 *   autoload    same, on first use of a command
 *   setoptions  rewrites the parser's options from inside a formula
 *   action      interactive tooltips: they need a live DOM, throw under the lite
 *               adaptor, and a pasted article is static
 *   noerrors, noundefined
 *               typeset broken TeX as red boxes instead of failing, which would
 *               paste the error as if it were the formula
 */
export const TEX_PACKAGES = {
  base: () => import('mathjax-full/js/input/tex/base/BaseConfiguration.js'),
  ams: () => import('mathjax-full/js/input/tex/ams/AmsConfiguration.js'),
  amscd: () => import('mathjax-full/js/input/tex/amscd/AmsCdConfiguration.js'),
  bbox: () => import('mathjax-full/js/input/tex/bbox/BboxConfiguration.js'),
  boldsymbol: () => import('mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'),
  braket: () => import('mathjax-full/js/input/tex/braket/BraketConfiguration.js'),
  bussproofs: () => import('mathjax-full/js/input/tex/bussproofs/BussproofsConfiguration.js'),
  cancel: () => import('mathjax-full/js/input/tex/cancel/CancelConfiguration.js'),
  cases: () => import('mathjax-full/js/input/tex/cases/CasesConfiguration.js'),
  centernot: () => import('mathjax-full/js/input/tex/centernot/CenternotConfiguration.js'),
  color: () => import('mathjax-full/js/input/tex/color/ColorConfiguration.js'),
  colorv2: () => import('mathjax-full/js/input/tex/colorv2/ColorV2Configuration.js'),
  colortbl: () => import('mathjax-full/js/input/tex/colortbl/ColortblConfiguration.js'),
  configmacros: () => import('mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js'),
  empheq: () => import('mathjax-full/js/input/tex/empheq/EmpheqConfiguration.js'),
  enclose: () => import('mathjax-full/js/input/tex/enclose/EncloseConfiguration.js'),
  extpfeil: () => import('mathjax-full/js/input/tex/extpfeil/ExtpfeilConfiguration.js'),
  gensymb: () => import('mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js'),
  mathtools: () => import('mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js'),
  mhchem: () => import('mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js'),
  newcommand: () => import('mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'),
  physics: () => import('mathjax-full/js/input/tex/physics/PhysicsConfiguration.js'),
  tagformat: () => import('mathjax-full/js/input/tex/tagformat/TagFormatConfiguration.js'),
  textcomp: () => import('mathjax-full/js/input/tex/textcomp/TextcompConfiguration.js'),
  textmacros: () => import('mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js'),
  upgreek: () => import('mathjax-full/js/input/tex/upgreek/UpgreekConfiguration.js'),
  unicode: () => import('mathjax-full/js/input/tex/unicode/UnicodeConfiguration.js'),
  verb: () => import('mathjax-full/js/input/tex/verb/VerbConfiguration.js'),
} as const

export const TEX_PACKAGE_NAMES = Object.keys(TEX_PACKAGES)

async function loadEngine(): Promise<MathEngine> {
  // mathjax-full's components/version.js reads its own package.json through an
  // eval'd require, which does not exist in a browser bundle. It checks for a
  // PACKAGE_VERSION global first - the escape hatch its own bundlers use - so
  // define one and the require path is never taken. The value comes from the
  // installed package, so it cannot drift from package.json / the lockfile.
  ;(globalThis as Record<string, unknown>).PACKAGE_VERSION ??= mathjaxPkg.version
  // Package registration is a side effect of importing each configuration.
  await Promise.all(Object.values(TEX_PACKAGES).map((load) => load()))
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { SafeHandler }] =
    await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/ui/safe/SafeHandler.js'),
    ])
  const adaptor = liteAdaptor()
  // One registration only: SafeHandler rewrites the handler's document class in
  // place, and `mathjax.document` picks the first handler registered for the
  // document - registering a plain one first would quietly bypass Safe.
  SafeHandler(RegisterHTMLHandler(adaptor))
  const doc = mathjax.document('', {
    InputJax: new TeX({
      packages: [...TEX_PACKAGE_NAMES],
      // The TeX jax turns a parse error into an merror node here, before the
      // document ever sees it. Rethrow so the failure reaches the caller.
      formatError: (_jax: unknown, err: unknown) => {
        throw err
      },
    }),
    // fontCache:'none' inlines every glyph as <path>. The alternative shares a
    // global <defs> cache across formulas, which WeChat would strip and leave
    // the article full of dangling <use> references.
    OutputJax: new SVG({ fontCache: 'none' }),
    // The defaults do not fail: they typeset the problem as a red merror box
    // carrying a mirrored <text> node and a data-mjx-error attribute, which would
    // then be pasted into the article as if it were the formula. Rethrow so the
    // caller can show the TeX back instead.
    compileError: (_doc: unknown, _math: unknown, err: unknown) => {
      throw err
    },
    typesetError: (_doc: unknown, _math: unknown, err: unknown) => {
      throw err
    },
  })
  engine = {
    convert: (tex, display) => {
      // `doc.convert` builds a fresh MathItem per call and never files it in the
      // document's math list, so nothing piles up across a long editing session;
      // measured flat retained heap over 27k conversions. The cache below keeps
      // only strings, never the adaptor's tree.
      const container = adaptor.outerHTML(doc.convert(tex, { display }) as never)
      return sanitizeMathSvg(container)
    },
  }
  return engine
}

export interface MathSnapshot {
  /**
   * Inner HTML for a formula: its SVG, or a failure box once the TeX is known
   * not to compile. Null only while the formula is still pending.
   */
  get(tex: string, display: boolean): string | null
}

export interface MathRenderer {
  /**
   * Immutable view of the cache. Its identity changes only when a formula lands,
   * so a caller can hold it in state and depend on it directly.
   */
  snapshot(): MathSnapshot
  /** Render one formula now; resolves false if the TeX does not compile. */
  warm(tex: string, display: boolean): Promise<boolean>
  subscribe(fn: () => void): () => void
}

const keyOf = (tex: string, display: boolean) => (display ? 'd' : 'i') + '\u0000' + tex

const EMPTY: MathSnapshot = { get: () => null }

/**
 * One renderer per session. The cache is what makes typing tolerable: re-parsing
 * the document on every keystroke must not re-run MathJax over every formula.
 */
export function createMathRenderer(): MathRenderer {
  const cache = new Map<string, string>()
  const failures = new Set<string>()
  const inflight = new Map<string, Promise<boolean>>()
  const listeners = new Set<() => void>()
  let view: MathSnapshot = EMPTY

  const lookup = (tex: string, display: boolean): string | null => {
    const key = keyOf(tex, display)
    return cache.get(key) ?? (failures.has(key) ? mathFailure(tex) : null)
  }
  const publish = () => {
    // A fresh object every time: its identity is the only signal a React caller
    // has that the cache moved.
    view = { get: lookup }
    listeners.forEach((fn) => fn())
  }

  async function run(key: string, tex: string, display: boolean): Promise<boolean> {
    try {
      const e = engine ?? (await (loading ??= loadEngine()))
      cache.set(key, e.convert(tex, display))
      publish()
      return true
    } catch (e) {
      // A formula that does not compile - or whose markup the sanitizer refused
      // - must not take the whole article down; the renderer falls back to
      // showing the TeX as text. But silence here would leave the author staring
      // at a placeholder with no way to tell a bad formula from a broken loader.
      console.error('[math] render failed', tex, e)
      failures.add(key)
      publish()
      return false
    }
  }

  return {
    snapshot: () => view,
    warm(tex, display) {
      const key = keyOf(tex, display)
      if (cache.has(key)) return Promise.resolve(true)
      if (failures.has(key)) return Promise.resolve(false)
      // The warming effect re-runs on every keystroke, and loading the engine
      // takes seconds; without this the same formula would be converted once
      // per keystroke on the main thread.
      const running = inflight.get(key)
      if (running) return running
      const started = run(key, tex, display).finally(() => inflight.delete(key))
      inflight.set(key, started)
      return started
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
