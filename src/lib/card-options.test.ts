// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CARD_OPTIONS_KEY, loadCardOptions, reconcileCardOptions, saveCardOptions,
} from './card-options'
import { CARD_METRICS, registerCardTemplateRuntime, unregisterCardTemplateRuntime } from './cards'

beforeEach(() => localStorage.clear())

describe('remembered card options', () => {
  it('round-trips the last selection under the mopai key', () => {
    saveCardOptions({ ratio: '1:1', template: 'custom.abc', background: 'dusk' })
    expect(localStorage.getItem(CARD_OPTIONS_KEY)).toContain('custom.abc')
    expect(loadCardOptions()).toEqual({ ratio: '1:1', template: 'custom.abc', background: 'dusk' })
  })

  it('ignores malformed or unreadable storage instead of breaking the editor', () => {
    localStorage.setItem(CARD_OPTIONS_KEY, '{not json')
    expect(loadCardOptions()).toBeNull()
    localStorage.setItem(CARD_OPTIONS_KEY, JSON.stringify({ template: 'reed', background: 'paper' }))
    expect(loadCardOptions()).toBeNull()
    localStorage.setItem(CARD_OPTIONS_KEY, JSON.stringify({ ratio: '5:4', template: 'reed', background: 'paper' }))
    expect(loadCardOptions()).toBeNull()
  })

  it('keeps a synced uploaded template and its own variant', () => {
    registerCardTemplateRuntime({
      template: 'custom.abc',
      name: 'Dusk',
      variants: [{ id: 'dusk', name: 'Dusk', dark: false }],
      ratios: ['3:4', '1:1'],
      metrics: CARD_METRICS.reed,
      fonts: [],
    })
    expect(reconcileCardOptions(
      { ratio: '1:1', template: 'custom.abc', background: 'dusk' },
      new Set(['custom.abc']),
    )).toEqual({ ratio: '1:1', template: 'custom.abc', background: 'dusk' })
    expect(reconcileCardOptions(
      { ratio: '1:1', template: 'custom.abc', background: 'missing' },
      new Set(['custom.abc']),
    )).toEqual({ ratio: '1:1', template: 'custom.abc', background: 'dusk' })
    unregisterCardTemplateRuntime('custom.abc')
  })

  it('falls back to Reed when the saved template is gone', () => {
    expect(reconcileCardOptions(
      { ratio: '1:1', template: 'custom.deleted', background: 'dusk' },
      new Set(),
    )).toEqual({ ratio: '1:1', template: 'reed', background: 'paper' })
    // The old built-in ids from the retired nine also land on Reed.
    expect(reconcileCardOptions(
      { ratio: '9:16', template: 'yoru', background: 'signal' },
      new Set(),
    )).toEqual({ ratio: '9:16', template: 'reed', background: 'paper' })
    // A ratio Reed does not support is repaired too.
    expect(reconcileCardOptions(
      { ratio: '5:4' as never, template: 'reed', background: 'grid' },
      new Set(),
    )).toEqual({ ratio: '3:4', template: 'reed', background: 'grid' })
  })

  it('repairs a ratio / background the new template does not support', () => {
    expect(reconcileCardOptions(
      { ratio: '9:16', template: 'reed', background: 'not-a-variant' },
      new Set(),
    )).toEqual({ ratio: '9:16', template: 'reed', background: 'paper' })
  })
})