// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LONG_OPTIONS_KEY, loadLongOptions, reconcileLongOptions, saveLongOptions,
} from './long-options'
import { publicLongTemplateRuntimeId } from './public-card-templates'

beforeEach(() => localStorage.clear())

describe('remembered long-image options', () => {
  it('round-trips under the mopai key', () => {
    saveLongOptions({ template: 'custom.abc', variant: 'ink', width: 1440, format: 'png' })
    expect(localStorage.getItem(LONG_OPTIONS_KEY)).toContain('custom.abc')
    expect(loadLongOptions()).toEqual({ template: 'custom.abc', variant: 'ink', width: 1440, format: 'png' })
  })

  it('ignores malformed storage instead of breaking the editor', () => {
    localStorage.setItem(LONG_OPTIONS_KEY, '{nope')
    expect(loadLongOptions()).toBeNull()
    localStorage.setItem(LONG_OPTIONS_KEY, JSON.stringify({ template: 'x', variant: 'y', width: 999, format: 'gif' }))
    expect(loadLongOptions()).toBeNull()
  })

  it('falls back to the public blue template when the saved one is gone', () => {
    const fallback = publicLongTemplateRuntimeId('blue-tech-recap')
    expect(reconcileLongOptions({ template: 'custom.deleted', variant: 'x', width: 1440, format: 'png' }, new Set()))
      .toEqual({ template: fallback, variant: 'blue', width: 1440, format: 'png' })
  })

  it('keeps a registered template and repairs width/format', () => {
    expect(reconcileLongOptions(
      { template: 'custom.abc', variant: 'ink', width: 1440, format: 'png' },
      new Set(['custom.abc']),
    )).toEqual({ template: 'custom.abc', variant: 'ink', width: 1440, format: 'png' })
  })
})
