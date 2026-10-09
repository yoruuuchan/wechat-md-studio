import { afterEach, describe, expect, it, vi } from 'vitest'
import { warnAboutWeakTokens } from './agent-auth'

/**
 * The door parses AGENT_TOKENS per request, so these tests drive the environment
 * directly and never import a module-level copy of it.
 */
const ORIGINAL = process.env.AGENT_TOKENS

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENT_TOKENS
  else process.env.AGENT_TOKENS = ORIGINAL
  vi.restoreAllMocks()
})

function warnings() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  warnAboutWeakTokens()
  return warn.mock.calls.map(([line]) => String(line))
}

describe('warnAboutWeakTokens', () => {
  it('names the weak entry by name and length, never by value', () => {
    const weak = 'weak-tok-a'
    process.env.AGENT_TOKENS = `claude-code:${weak},reviewer:mopai_` + 'x'.repeat(40)
    const lines = warnings()
    expect(lines.some((l) => l.includes('claude-code') && l.includes(`${weak.length} characters`))).toBe(true)
    expect(lines.some((l) => l.includes('reviewer'))).toBe(false)
    // The token itself must not be printed — the log is not a secret store.
    expect(lines.join('\n')).not.toContain(weak)
  })

  it('stays quiet for a healthy list, and for the closed door', () => {
    process.env.AGENT_TOKENS = 'claude-code:mopai_' + 'y'.repeat(43)
    expect(warnings()).toHaveLength(0)

    process.env.AGENT_TOKENS = ''
    expect(warnings()).toHaveLength(0)
  })

  it('still reports entries the parser cannot read', () => {
    process.env.AGENT_TOKENS = 'no-colon-here'
    expect(warnings().some((l) => l.includes('malformed'))).toBe(true)
  })
})
