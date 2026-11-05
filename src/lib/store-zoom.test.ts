import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyZoom } from './store'

function stubRoot() {
  const props = new Map<string, string>()
  const style = { zoom: '', setProperty: (name: string, value: string) => { props.set(name, value) } }
  vi.stubGlobal('document', { documentElement: { style } })
  return { style, props }
}

describe('applyZoom', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sets the zoom and the --ui-zoom factor that viewport-height shells divide by', () => {
    const { style, props } = stubRoot()
    applyZoom(90)
    expect(style.zoom).toBe('0.9')
    expect(props.get('--ui-zoom')).toBe('0.9')
    applyZoom(125)
    expect(style.zoom).toBe('1.25')
    expect(props.get('--ui-zoom')).toBe('1.25')
  })

  it('falls back to 100% for a value outside the offered steps', () => {
    const { style, props } = stubRoot()
    applyZoom(73)
    expect(style.zoom).toBe('1')
    expect(props.get('--ui-zoom')).toBe('1')
  })
})
