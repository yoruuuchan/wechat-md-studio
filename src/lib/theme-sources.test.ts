import { describe, expect, it } from 'vitest'
import { THEMES } from './themes'
import { THEME_SOURCES, licenseLabel, tallyByLicense, tallyThemeSources } from './theme-sources'
import { ORIGINAL_LICENSE } from './theme-meta'

// 与 scripts/verify-sources.ts 的分工：那里校验磁盘上的文件与文档；
// 这里把「数据自洽」钉进 npm test，不需要文件系统也能跑。

describe('theme → source join', () => {
  it('every theme references a registered source, with a matching kind', () => {
    const byProject = new Map(THEME_SOURCES.map((s) => [s.project, s]))
    for (const t of THEMES) {
      const source = byProject.get(t.meta.origin.project)
      expect(source, `${t.id} → ${t.meta.origin.project}`).toBeDefined()
      expect(source?.kind, t.id).toBe(t.meta.origin.kind)
    }
  })

  it('Project-Original only appears on original themes', () => {
    for (const t of THEMES) {
      if (t.meta.origin.kind === 'original') {
        expect(t.meta.origin.license, t.id).toBe(ORIGINAL_LICENSE)
      } else {
        expect(t.meta.origin.license, t.id).not.toBe(ORIGINAL_LICENSE)
      }
    }
  })

  it('every source has at least one theme and its default license is in use', () => {
    for (const source of THEME_SOURCES) {
      const own = THEMES.filter((t) => t.meta.origin.project === source.project)
      expect(own.length, source.project).toBeGreaterThan(0)
      expect(own.some((t) => t.meta.origin.license === source.license), source.project).toBe(true)
    }
  })
})

describe('tallies', () => {
  it('by source covers the whole catalog', () => {
    const total = tallyThemeSources(THEMES).reduce((n, s) => n + s.count, 0)
    expect(total).toBe(THEMES.length)
  })

  it('by license covers the whole catalog', () => {
    const total = tallyByLicense(THEMES).reduce((n, r) => n + r.count, 0)
    expect(total).toBe(THEMES.length)
  })

  it('per-source license breakdown sums to the source count', () => {
    for (const s of tallyThemeSources(THEMES)) {
      const sum = s.licenses.reduce((n, l) => n + l.count, 0)
      expect(sum, s.project).toBe(s.count)
    }
  })

  it('licenseLabel marks the project original marker, passes others through', () => {
    expect(licenseLabel(ORIGINAL_LICENSE)).toBe('本项目自研')
    expect(licenseLabel('MIT')).toBe('MIT')
  })
})
