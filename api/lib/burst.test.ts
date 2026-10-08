import { describe, expect, it } from 'vitest'
import { allowBurst, allowIpDaily, clientIp } from './burst'

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
