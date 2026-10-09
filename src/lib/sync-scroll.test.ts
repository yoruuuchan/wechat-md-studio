import { describe, expect, it } from 'vitest'
import {
  blockIndexAtLine,
  fillBlockOffsets,
  fractionInSpan,
  lineAtProgress,
  pointInSpan,
  progressInBlock,
  rangeOf,
} from './sync-scroll'

// Blocks as parseMarkdown emits them: one entry per rendered block, in document
// order, carrying the whole-file line it starts on.
const blocks = [
  { line: 0 }, // front matter opens the file
  { line: 6 }, // heading
  { line: 8 }, // paragraph
  { line: 12 }, // image
  { line: 20 }, // carousel
]

describe('blockIndexAtLine', () => {
  it('finds the block a line falls inside', () => {
    expect(blockIndexAtLine(blocks, 0)).toBe(0)
    expect(blockIndexAtLine(blocks, 6)).toBe(1)
    expect(blockIndexAtLine(blocks, 9)).toBe(2)
    expect(blockIndexAtLine(blocks, 19)).toBe(3)
    expect(blockIndexAtLine(blocks, 25)).toBe(4)
  })

  it('reports no block for lines above the first one', () => {
    expect(blockIndexAtLine([], 5)).toBe(-1)
    expect(blockIndexAtLine([{ line: 3 }], 0)).toBe(-1)
  })

  it('stays on the last block past the end of the document', () => {
    expect(blockIndexAtLine(blocks, 10_000)).toBe(blocks.length - 1)
  })
})

describe('progressInBlock', () => {
  it('is zero at the start of a block and approaches one at the next', () => {
    expect(progressInBlock(blocks, 2, 8)).toBe(0)
    expect(progressInBlock(blocks, 2, 10)).toBeCloseTo(0.5)
    expect(progressInBlock(blocks, 2, 12)).toBe(1)
  })

  it('clamps instead of running away on a line outside the block', () => {
    expect(progressInBlock(blocks, 2, 0)).toBe(0)
    expect(progressInBlock(blocks, 2, 999)).toBe(1)
  })

  it('falls back to the block range when there is no next block', () => {
    // No next block and no lineEnd: the range collapses to one line, so anything
    // past it clamps to the end rather than running away.
    expect(progressInBlock(blocks, 4, 20)).toBe(0)
    expect(progressInBlock(blocks, 4, 30)).toBe(1)
    // With lineEnd the last block is measured over its real source span.
    expect(progressInBlock([{ line: 20, lineEnd: 30 }], 0, 25)).toBeCloseTo(0.5)
  })
})

describe('lineAtProgress', () => {
  it('hits both ends of a block exactly', () => {
    for (const i of [0, 1, 2, 3]) {
      expect(lineAtProgress(blocks, i, 0)).toBe(blocks[i].line)
      expect(lineAtProgress(blocks, i, 1)).toBe(blocks[i + 1].line)
    }
  })

  it('moves monotonically, which is all sync needs', () => {
    // The editor can only land on whole lines, so a round trip through
    // lineAtProgress quantises: asking for 0.25 of a six-line block can come
    // back as 0.333. Monotonicity is the property that actually matters - a
    // pane that scrolls down must never make the other pane scroll up.
    for (const i of [0, 1, 2, 3]) {
      let prev = -1
      for (let step = 0; step <= 10; step++) {
        const line = lineAtProgress(blocks, i, step / 10)
        expect(line).toBeGreaterThanOrEqual(prev)
        prev = line
      }
    }
  })

  it('clamps a fraction outside 0..1', () => {
    expect(lineAtProgress(blocks, 2, -3)).toBe(8)
    expect(lineAtProgress(blocks, 2, 7)).toBe(12)
  })
})

describe('fillBlockOffsets', () => {
  it('pulls a block that emitted nothing back onto the previous one', () => {
    // -1 means the renderer produced no element for that block, so scrolling to
    // it must land on the last block that did produce one.
    expect(fillBlockOffsets([0, 1, -1, 2, -1, 3])).toEqual([0, 1, 1, 2, 2, 3])
  })

  it('never leaves a leading hole pointing before the document', () => {
    expect(fillBlockOffsets([-1, -1, 4])).toEqual([0, 0, 4])
  })

  it('is monotonic for already-sound input', () => {
    const filled = fillBlockOffsets([0, 1, 2, 3])
    expect(filled).toEqual([0, 1, 2, 3])
  })
})

describe('rangeOf', () => {
  it('ends a block where the next one starts', () => {
    expect(rangeOf(blocks, 2)).toEqual({ start: 8, end: 12 })
  })

  it('falls back to the block own span when there is no next block', () => {
    expect(rangeOf([{ line: 20, lineEnd: 30 }], 0)).toEqual({ start: 20, end: 30 })
  })

  it('never collapses to zero lines, which would divide by zero later', () => {
    // Two blocks on one line is legal in the AST (a heading and the paragraph
    // that follows it on the same source line), and the range still has to have
    // a size.
    expect(rangeOf([{ line: 4 }, { line: 4 }], 0)).toEqual({ start: 4, end: 5 })
  })
})

// The preview is proportional type with images and the editor wraps its own
// lines, so the two panes only agree about a block's *ends*. Everything between
// them is interpolated, and these two functions are that interpolation: the
// panes measure the same block in their own pixels and hand each other a
// fraction of it.
describe('fractionInSpan / pointInSpan', () => {
  it('agrees with the ends of the span', () => {
    expect(fractionInSpan(120, 100, 300)).toBeCloseTo(0.1)
    expect(fractionInSpan(100, 100, 300)).toBe(0)
    expect(fractionInSpan(300, 100, 300)).toBe(1)
    expect(pointInSpan(0, 100, 300)).toBe(100)
    expect(pointInSpan(1, 100, 300)).toBe(300)
  })

  it('round-trips, which is what keeps the two panes from creeping apart', () => {
    for (const frac of [0, 0.13, 0.5, 0.87, 1]) {
      expect(fractionInSpan(pointInSpan(frac, 40, 900), 40, 900)).toBeCloseTo(frac, 10)
    }
  })

  it('clamps a value outside the span', () => {
    expect(fractionInSpan(-50, 100, 300)).toBe(0)
    expect(fractionInSpan(9999, 100, 300)).toBe(1)
    expect(pointInSpan(-1, 100, 300)).toBe(100)
    expect(pointInSpan(4, 100, 300)).toBe(300)
  })

  it('reports zero rather than dividing when a block has no pixels', () => {
    // A block whose element rendered with no height would otherwise produce
    // Infinity, which a scrollTop assignment turns into a jump to the top.
    expect(fractionInSpan(500, 200, 200)).toBe(0)
    expect(Number.isFinite(pointInSpan(0.5, 200, 200))).toBe(true)
    expect(pointInSpan(0.5, 200, 200)).toBe(200)
  })
})
