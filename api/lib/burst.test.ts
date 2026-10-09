import { describe, expect, it } from 'vitest'
import { allowBurst, allowIpDaily, checkLoginAttempt, clientIp } from './burst'
import { env } from './env'

const NOW = 1_800_000_000_000
const MINUTE = 60_000

describe('allowBurst', () => {
  it('lets a normal burst through and stops the next one', () => {
    const store = new Map<string, number[]>()
    for (let i = 0; i < 12; i++) {
      expect(allowBurst(store, 'ip-a', NOW + i, 12)).toBe(true)
    }
    expect(allowBurst(store, 'ip-a', NOW + 20, 12)).toBe(false)
  })

  it('counts each IP separately', () => {
    const store = new Map<string, number[]>()
    for (let i = 0; i < 12; i++) allowBurst(store, 'ip-a', NOW + i, 12)
    expect(allowBurst(store, 'ip-a', NOW + 13, 12)).toBe(false)
    expect(allowBurst(store, 'ip-b', NOW + 13, 12)).toBe(true)
  })

  it('opens up again once the window has passed', () => {
    const store = new Map<string, number[]>()
    for (let i = 0; i < 12; i++) allowBurst(store, 'ip-a', NOW + i, 12)
    expect(allowBurst(store, 'ip-a', NOW + 13, 12)).toBe(false)
    // A full second past the window: every recorded hit has expired. Anything
    // closer leaves the later hits inside it and tests the wrong thing.
    expect(allowBurst(store, 'ip-a', NOW + MINUTE + 1000, 12)).toBe(true)
  })

  it('does not accumulate state for IPs whose window expired', () => {
    const store = new Map<string, number[]>()
    for (let i = 0; i < 12; i++) allowBurst(store, 'ip-a', NOW + i, 12)
    allowBurst(store, 'ip-a', NOW + MINUTE + 1000, 12)
    expect(store.get('ip-a')).toEqual([NOW + MINUTE + 1000])
  })

  it('honours a caller-supplied window (the login door uses its own)', () => {
    const store = new Map<string, number[]>()
    const WINDOW = 10_000
    expect(allowBurst(store, 'ip-a', NOW, 2, WINDOW)).toBe(true)
    expect(allowBurst(store, 'ip-a', NOW + 1, 2, WINDOW)).toBe(true)
    expect(allowBurst(store, 'ip-a', NOW + 2, 2, WINDOW)).toBe(false)
    // Still inside the shorter window.
    expect(allowBurst(store, 'ip-a', NOW + WINDOW - 1, 2, WINDOW)).toBe(false)
    expect(allowBurst(store, 'ip-a', NOW + WINDOW + 1, 2, WINDOW)).toBe(true)
  })

  it('a zero limit closes the door without special-casing', () => {
    const store = new Map<string, number[]>()
    expect(allowBurst(store, 'ip-a', NOW, 0)).toBe(false)
    expect(store.get('ip-a')).toEqual([])
  })
})

describe('checkLoginAttempt', () => {
  it(`allows ${env.authLoginPerMinute} attempts from one address per minute, then refuses`, () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}-${Date.now()}`
    for (let i = 0; i < env.authLoginPerMinute; i++) {
      expect(checkLoginAttempt(ip).ok).toBe(true)
    }
    const refused = checkLoginAttempt(ip)
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('频繁')
  })

  it('keeps counting each address separately', () => {
    const stamp = Date.now()
    const blocked = `203.0.113.9-${stamp}`
    for (let i = 0; i < env.authLoginPerMinute; i++) checkLoginAttempt(blocked)
    expect(checkLoginAttempt(blocked).ok).toBe(false)
    expect(checkLoginAttempt(`203.0.113.10-${stamp}`).ok).toBe(true)
  })
})

describe('allowIpDaily', () => {
  it('stops the upload past the daily limit', () => {
    const store = new Map<string, { day: string; count: number }>()
    for (let i = 0; i < 100; i++) expect(allowIpDaily(store, 'ip-a', '2026-10-08', 100)).toBe(true)
    expect(allowIpDaily(store, 'ip-a', '2026-10-08', 100)).toBe(false)
  })

  it('resets when the UTC day rolls', () => {
    const store = new Map<string, { day: string; count: number }>()
    for (let i = 0; i < 100; i++) allowIpDaily(store, 'ip-a', '2026-10-08', 100)
    expect(allowIpDaily(store, 'ip-a', '2026-10-08', 100)).toBe(false)
    expect(allowIpDaily(store, 'ip-a', '2026-10-09', 100)).toBe(true)
  })

  it('counts each IP separately', () => {
    const store = new Map<string, { day: string; count: number }>()
    for (let i = 0; i < 100; i++) allowIpDaily(store, 'ip-a', '2026-10-08', 100)
    expect(allowIpDaily(store, 'ip-a', '2026-10-08', 100)).toBe(false)
    expect(allowIpDaily(store, 'ip-b', '2026-10-08', 100)).toBe(true)
  })
})

describe('clientIp', () => {
  it('trusts the address the Cloudflare edge reports', () => {
    const h = new Headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })
    expect(clientIp(h)).toBe('203.0.113.9')
  })

  it('falls back to x-forwarded-for off Cloudflare, taking the first hop', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }))).toBe('198.51.100.7')
  })

  it('buckets unattributable requests together rather than letting them through', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
