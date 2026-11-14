import { describe, expect, it } from 'vitest'
import { graphicsReadiness } from './graphics-readiness'
import type { MathSnapshot, MathStatus } from './math'
import type { DiagramState } from './preflight'
import { parseMarkdown } from './parse'

/** A snapshot that answers from a fixed status table, the way a warmed cache does. */
function snapshot(statuses: Record<string, MathStatus> = {}, engineUnavailable = false): MathSnapshot {
  return {
    get: () => (engineUnavailable ? null : '<svg></svg>'),
    status: (tex) => statuses[tex] ?? 'rendered',
    engineUnavailable: () => engineUnavailable,
  }
}

const diagram = (code: string, state: DiagramState['state']): DiagramState => ({
  code,
  line: 1,
  state,
})

describe('graphics readiness', () => {
  it('lets an article without formulas or diagrams export at once', () => {
    const doc = parseMarkdown('#标题\n\n一段正文。')
    const readiness = graphicsReadiness(doc.blocks, snapshot(), [])
    expect(readiness.ready).toBe(true)
    expect(readiness.math.state).toBe('ready')
    expect(readiness.diagrams.state).toBe('ready')
  })

  it('holds the export while a formula is still rendering', () => {
    const doc = parseMarkdown('$$\nE = mc^2\n$$')
    const readiness = graphicsReadiness(doc.blocks, snapshot({ 'E = mc^2': 'pending' }), [])
    expect(readiness.ready).toBe(false)
    expect(readiness.math.state).toBe('pending')
    expect(readiness.math.pending).toBe(1)
  })

  it('reports broken TeX as a failure, not an endless wait', () => {
    const doc = parseMarkdown('$$\n\\frac{1}{\n$$')
    const readiness = graphicsReadiness(doc.blocks, snapshot({ '\\frac{1}{': 'failed' }), [])
    expect(readiness.math.state).toBe('failed')
    expect(readiness.math.failed).toEqual(['\\frac{1}{'])
    expect(readiness.ready).toBe(false)
  })

  it('reports a MathJax that never loaded as a failure', () => {
    const doc = parseMarkdown('$$\nx =1\n$$')
    const readiness = graphicsReadiness(doc.blocks, snapshot({ 'x =1': 'pending' }, true), [])
    expect(readiness.math.state).toBe('failed')
    expect(readiness.math.engineUnavailable).toBe(true)
  })

  it('does not block on a formula that is fully cached', () => {
    const doc = parseMarkdown('$$\nE = mc^2\n$$')
    const readiness = graphicsReadiness(doc.blocks, snapshot(), [])
    expect(readiness.ready).toBe(true)
  })

  it('holds the export while a Mermaid fence is still becoming an image', () => {
    const doc = parseMarkdown('```mermaid\ngraph TD\n A --> B\n```')
    const readiness = graphicsReadiness(doc.blocks, snapshot(), [diagram('graph TD\n A --> B', 'pending')])
    expect(readiness.ready).toBe(false)
    expect(readiness.diagrams.state).toBe('pending')
    expect(readiness.diagrams.pending).toBe(1)
  })

  it('reports a failed diagram with its own state, and prefers failure over pending', () => {
    const doc = parseMarkdown('```mermaid\nbad\n```')
    const readiness = graphicsReadiness(doc.blocks, snapshot(), [diagram('bad', 'failed'), diagram('other', 'pending')])
    expect(readiness.diagrams.state).toBe('failed')
    expect(readiness.diagrams.failed).toHaveLength(1)
    expect(readiness.ready).toBe(false)
  })

  it('is ready once every formula and diagram has landed', () => {
    const doc = parseMarkdown('$$\nE = mc^2\n$$\n\n```mermaid\ngraph TD\n A --> B\n```')
    const readiness = graphicsReadiness(doc.blocks, snapshot(), [diagram('graph TD\n A --> B', 'ready')])
    expect(readiness.ready).toBe(true)
    expect(readiness.math.state).toBe('ready')
    expect(readiness.diagrams.state).toBe('ready')
  })
})
