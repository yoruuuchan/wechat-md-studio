import { describe, expect, it } from 'vitest'
import { THEMES } from './themes'
import { normalizeRootStyle } from './theme-kit'

const rootStyle = (themeId: string): string => {
  const theme = THEMES.find((item) => item.id === themeId)
  if (!theme) throw new Error(`missing theme: ${themeId}`)
  const html = theme.root('marker')
  return /^<section style="([^"]*)"/.exec(html)?.[1] ?? ''
}

function horizontalPadding(style: string): number {
  let left = 0
  let right = 0
  for (const raw of style.split(';')) {
    const [name, value] = raw.split(':').map((part) => part?.trim())
    if (!name || !value) continue
    if (name === 'padding-left') left = Number.parseFloat(value) || 0
    if (name === 'padding-right') right = Number.parseFloat(value) || 0
    if (name === 'padding') {
      const values = value.split(/\s+/)
      left = Number.parseFloat(values.length === 2 || values.length === 3 ? values[1] : values[3] ?? values[0]) || 0
      right = left
    }
  }
  return left + right
}

describe('theme root geometry', () => {
  it.each(THEMES.map((theme) => theme.id))('%s has no repeated horizontal root gutter', (id) => {
    const style = rootStyle(id)
    expect(horizontalPadding(style), style).toBe(0)
    const max = /(?:^|;)max-width:(\d+)px/.exec(style)?.[1]
    expect(Number(max)).toBeGreaterThanOrEqual(240)
    expect(Number(max)).toBeLessThanOrEqual(677)
    expect(style).toContain('box-sizing:border-box')
  })

  it('folds importer wrapper padding into a one-time max width', () => {
    expect(normalizeRootStyle('max-width:677px;padding:8px')).toEqual({
      style: 'padding:8px 0',
      maxWidth: 661,
    })
  })

  it.each([
    ['olive', 8],
    ['xiaohu-apple-gradient', 16],
    ['xiaohu-academic-paper', 22],
  ])('folds a representative %s root gutter of %spx into max-width', (id, gutter) => {
    const style = rootStyle(id)
    const max = Number(/(?:^|;)max-width:(\d+)px/.exec(style)?.[1])
    expect(max).toBe(677 - gutter * 2)
  })
})
