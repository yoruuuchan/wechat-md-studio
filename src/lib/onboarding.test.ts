import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding'

const ONBOARDING_KEY = 'mopai.onboarding.v1'

class MemoryStorage {
  private map = new Map<string, string>()
  readThrows = false
  quotaExceeded = false
  getItem(key: string) {
    if (this.readThrows) throw new Error('blocked')
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.quotaExceeded) {
      const err = new Error('quota')
      err.name = 'QuotaExceededError'
      throw err
    }
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('first-run onboarding flag', () => {
  it('reports a fresh browser as unseen', () => {
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('round-trips the seen flag through localStorage', () => {
    markOnboardingSeen()
    expect(storage.getItem(ONBOARDING_KEY)).toBe('done')
    expect(hasSeenOnboarding()).toBe(true)
  })

  it('treats a value from another version as unseen', () => {
    storage.setItem(ONBOARDING_KEY, '1')
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('survives storage that cannot be read (private mode)', () => {
    storage.readThrows = true
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('survives storage that cannot be written', () => {
    storage.quotaExceeded = true
    expect(() => markOnboardingSeen()).not.toThrow()
    storage.quotaExceeded = false
    expect(hasSeenOnboarding()).toBe(false)
  })
})
