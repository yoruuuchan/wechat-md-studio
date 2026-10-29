import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  validateAgentTokenConfig,
  validateAgentTokens,
  warnAboutTokenConfig,
  warnAboutWeakTokens,
} from './agent-auth'

/**
 * The door parses AGENT_TOKENS per request, so these tests drive the environment
 * directly and never import a module-level copy of it. A strong token is 43
 * random URL-safe base64 characters after the `mopai_` prefix, so a 16-character
 * minimum is the floor, not the target. Short fixtures here are deliberately
 * explicit: they exist to prove the parser, not to model production.
 */
const ORIGINAL = process.env.AGENT_TOKENS
const strong = (seed: string) => `mopai_${seed.repeat(43).slice(0, 43)}`

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENT_TOKENS
  else process.env.AGENT_TOKENS = ORIGINAL
  vi.restoreAllMocks()
})

describe('AGENT_TOKENS grammar', () => {
  it('keeps the documented default: name:token is read + write', () => {
    const { tokens, problems } = validateAgentTokens(`claude-code:${strong('a')}`)
    expect(problems).toEqual([])
    expect(tokens).toEqual([{ name: 'claude-code', token: strong('a'), scopes: ['read', 'write'] }])
  })

  it('keeps :read read-only and nothing more', () => {
    const { tokens } = validateAgentTokens(`reviewer:${strong('b')}:read`)
    expect(tokens[0].scopes).toEqual(['read'])
  })

  it('treats an empty configuration as a closed door, not an error', () => {
    for (const raw of ['', '   ', ',', ' , , ']) {
      expect(validateAgentTokens(raw)).toEqual({ tokens: [], problems: [] })
      expect(validateAgentTokenConfig(raw)).toEqual([])
    }
  })

  it('rejects a misspelled scope instead of silently granting write', () => {
    for (const typo of ['raed', 'READ', 'Read', 'write', 'admin', ' read', 'read/write']) {
      const { tokens, problems } = validateAgentTokens(`claude-code:${strong('c')}:${typo}`)
      expect(tokens).toEqual([])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatchObject({ entry: 1, name: 'claude-code' })
      expect(problems[0].message).toContain('exactly "read"')
    }
  })

  it('rejects extra fields and entries with the wrong arity', () => {
    const cases = [
      `claude-code:${strong('d')}:read:extra`,
      `claude-code:${strong('d')}:read:`,
      `claude-code:${strong('d')}::`,
      `claude-code:${strong('d')}:`,
      'no-colon-here',
      ':token-only',
    ]
    for (const raw of cases) {
      const { tokens, problems } = validateAgentTokens(raw)
      expect(tokens).toEqual([])
      expect(problems.length).toBeGreaterThan(0)
    }
  })

  it('rejects an empty token', () => {
    const { tokens, problems } = validateAgentTokens('claude-code:')
    expect(tokens).toEqual([])
    expect(problems[0].message).toContain('name:token')
  })

  it('rejects a duplicate token under two names instead of letting the last one win', () => {
    const shared = strong('e')
    const { tokens, problems } = validateAgentTokens(`first:${shared},second:${shared}:read`)
    expect(tokens).toEqual([{ name: 'first', token: shared, scopes: ['read', 'write'] }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ entry: 2, name: 'second' })
    expect(problems[0].message).toContain('reuses a token')
  })

  it('rejects a duplicate name so one entry cannot silently shadow another', () => {
    const { tokens, problems } = validateAgentTokens(`same:${strong('f')},same:${strong('g')}:read`)
    expect(tokens.map((t) => t.token)).toEqual([strong('f')])
    expect(problems[0]).toMatchObject({ entry: 2, name: 'same' })
    expect(problems[0].message).toContain('more than once')
  })

  it('keeps good entries and only drops the bad ones', () => {
    const { tokens, problems } = validateAgentTokens(
      `good:${strong('h')},typo:${strong('i')}:raed,reader:${strong('j')}:read`,
    )
    expect(tokens.map((t) => [t.name, t.scopes])).toEqual([
      ['good', ['read', 'write']],
      ['reader', ['read']],
    ])
    expect(problems).toHaveLength(1)
  })

  it('never puts a token value in a problem message', () => {
    const secret = strong('k')
    const { problems } = validateAgentTokens(`typo:${secret}:raed`)
    expect(JSON.stringify(problems)).not.toContain(secret)
    expect(problems[0].name).toBe('typo')
  })

  it('trims surrounding whitespace around entries and names', () => {
    const { tokens, problems } = validateAgentTokens(`  spaced  :  ${strong('l')}  `)
    expect(problems).toEqual([])
    expect(tokens[0]).toMatchObject({ name: 'spaced', token: strong('l') })
  })
})

describe('validateAgentTokenConfig (production gate)', () => {
  it('rejects weak and short tokens', () => {
    for (const weak of ['pass', 'mopai_short', 'short-password', 'x'.repeat(15)]) {
      const problems = validateAgentTokenConfig(`claude-code:${weak}`)
      expect(problems).toHaveLength(1)
      expect(problems[0].name).toBe('claude-code')
      expect(problems[0].message).toContain(`${weak.length} characters`)
      expect(JSON.stringify(problems)).not.toContain(weak)
    }
  })

  it('rejects the placeholders published in this repository, whatever their length', () => {
    for (const placeholder of [
      'change-me',
      'Change-Me',
      'mopai-dev-only-access-key',
      'mopai-dev-only-session-secret',
    ]) {
      const problems = validateAgentTokenConfig(`claude-code:${placeholder}`)
      expect(problems).toHaveLength(1)
      expect(problems[0].message).toContain('placeholder')
      expect(JSON.stringify(problems)).not.toContain(placeholder)
    }
  })

  it('accepts the documented mint command output', () => {
    expect(validateAgentTokenConfig(`claude-code:${strong('m')}`)).toEqual([])
    expect(validateAgentTokenConfig(`a:${strong('m1')},b:${strong('m2')}:read`)).toEqual([])
  })

  it('combines syntax problems with weak-token problems', () => {
    const problems = validateAgentTokenConfig(`weak:pass,typo:${strong('p')}:raed`)
    expect(problems).toHaveLength(2)
    expect(problems.map((p) => p.name).sort()).toEqual(['typo', 'weak'])
  })
})

describe('boot-time reporting', () => {
  it('warnAboutWeakTokens names the weak entry by name and length, never by value', () => {
    const weak = 'weak-tok-a'
    process.env.AGENT_TOKENS = `claude-code:${weak},reviewer:${strong('q')}`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnAboutWeakTokens()
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines.some((l) => l.includes('claude-code') && l.includes(`${weak.length} characters`))).toBe(true)
    expect(lines.some((l) => l.includes('reviewer'))).toBe(false)
    expect(lines.join('\n')).not.toContain(weak)
  })

  it('warnAboutWeakTokens stays quiet for a healthy list and for the closed door', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.AGENT_TOKENS = `claude-code:${strong('r')}`
    warnAboutWeakTokens()
    expect(warn).not.toHaveBeenCalled()

    process.env.AGENT_TOKENS = ''
    warnAboutWeakTokens()
    expect(warn).not.toHaveBeenCalled()
  })

  it('warnAboutTokenConfig reports malformed entries without echoing the value', () => {
    const secret = strong('s')
    process.env.AGENT_TOKENS = `typo:${secret}:raed`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const problems = warnAboutTokenConfig()
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(problems).toHaveLength(1)
    expect(lines.join('\n')).toContain('typo')
    expect(lines.join('\n')).not.toContain(secret)
  })

  it('warnAboutTokenConfig is silent when every entry is valid', () => {
    process.env.AGENT_TOKENS = `claude-code:${strong('t')},reviewer:${strong('u')}:read`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnAboutTokenConfig()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })
})
