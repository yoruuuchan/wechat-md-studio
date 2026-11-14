/**
 * Whether a card or long-image export may run.
 *
 * Formulas and Mermaid diagrams are asynchronous: until they finish, the two
 * renderers fall back to the TeX or fence source so the page still reads. That
 * fallback is right for the editor, but exporting it would hand out a finished
 * looking PNG with source text inside. Both views therefore ask this module
 * before enabling a download.
 *
 * It is a pure reading of facts the editor already owns - the shared
 * `MathSnapshot` and its `diagramStates` - so the views and the publish check
 * cannot disagree about what is finished.
 */
import type { Block } from './types'
import type { DiagramState } from './preflight'
import { documentFormulas, mathReadiness, type MathSnapshot } from './math'

export type GraphicsGate = 'ready' | 'pending' | 'failed'

export interface GraphicsReadiness {
  math: {
    state: GraphicsGate
    /** Formulas still waiting on MathJax. */
    pending: number
    /** TeX that does not compile, in reading order. */
    failed: readonly string[]
    /** MathJax itself did not load; an empty cache cannot recover on its own. */
    engineUnavailable: boolean
  }
  diagrams: {
    state: GraphicsGate
    /** Fences still rasterizing or uploading. */
    pending: number
    failed: readonly DiagramState[]
  }
  ready: boolean
}

export function graphicsReadiness(
  blocks: readonly Block[],
  math: MathSnapshot,
  diagrams: readonly DiagramState[],
): GraphicsReadiness {
  const formulas = mathReadiness(documentFormulas(blocks), math)
  const mathState: GraphicsGate =
    formulas.failed.length || (formulas.engineUnavailable && formulas.pending > 0)
      ? 'failed'
      : formulas.pending > 0
        ? 'pending'
        : 'ready'
  const failedDiagrams = diagrams.filter((diagram) => diagram.state === 'failed')
  const pendingDiagrams = diagrams.filter((diagram) => diagram.state === 'pending')
  const diagramState: GraphicsGate = failedDiagrams.length ? 'failed' : pendingDiagrams.length ? 'pending' : 'ready'
  return {
    math: {
      state: mathState,
      pending: formulas.pending,
      failed: formulas.failed,
      engineUnavailable: formulas.engineUnavailable,
    },
    diagrams: {
      state: diagramState,
      pending: pendingDiagrams.length,
      failed: failedDiagrams,
    },
    ready: mathState === 'ready' && diagramState === 'ready',
  }
}
