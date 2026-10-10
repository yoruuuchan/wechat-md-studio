import { describe, expect, it } from 'vitest'
import { remoteSyncDecision } from './remote-mcp-sync'

const base = { id: 'lease', baseHash: 'base', name: '原稿' }
const remote = { name: '原稿', content: '', hash: 'base', updatedAt: 0 }

describe('MCP three-way sync', () => {
  it('pulls AI changes when the browser has not edited the base', () => {
    expect(remoteSyncDecision('base', '原稿', base, { ...remote, hash: 'ai' })).toBe('apply')
  })
  it('pushes browser edits only when the remote still matches the base', () => {
    expect(remoteSyncDecision('local', '原稿', base, remote)).toBe('push')
  })
  it('leaves both changed versions for explicit conflict resolution', () => {
    expect(remoteSyncDecision('local', '原稿', base, { ...remote, hash: 'ai' })).toBe('conflict')
  })
  it('recognizes identical edits without creating a conflict', () => {
    expect(remoteSyncDecision('same', '原稿', base, { ...remote, hash: 'same' })).toBe('synced')
  })
  it('also detects divergent renames and one-sided name edits', () => {
    expect(remoteSyncDecision('base', '本机改名', base, remote)).toBe('push')
    expect(remoteSyncDecision('base', '原稿', base, { ...remote, name: 'AI 改名' })).toBe('apply')
    expect(remoteSyncDecision('base', '本机改名', base, { ...remote, name: 'AI 改名' })).toBe('conflict')
  })
})
