import { describe, expect, it } from 'vitest'

// env.ts reads process.env once at import time, and dotenv never overrides a
// value that is already set, so the ceilings are fixed before the module loads.
process.env.ANON_DAILY_IMAGES = '3'
process.env.ANON_DAILY_BYTES = '1000'
process.env.ANON_TOTAL_BYTES = '4000'
process.env.ANON_DAILY_TOTAL_BYTES = '2000'

const { checkAnonQuota } = await import('./anon-quota')

const usage = (over: Partial<{ windowCount: number; windowBytes: number; totalBytes: number }> = {}) => ({
  windowCount: 0,
  windowBytes: 0,
  totalBytes: 0,
  ...over,
})

describe('checkAnonQuota', () => {
  it('lets an upload through while every ceiling has room', () => {
    expect(checkAnonQuota(usage({ windowCount: 2, windowBytes: 900, totalBytes: 3000 }), 100, 0).ok).toBe(true)
  })

  it('counts the incoming image against the 24 h allowance', () => {
    const verdict = checkAnonQuota(usage({ windowCount: 3 }), 10, 0)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('3 张')
  })

  it('counts the incoming bytes against the 24 h allowance', () => {
    const verdict = checkAnonQuota(usage({ windowBytes: 950 }), 100, 0)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('24 小时')
  })

  it('stops everything once the shared anonymous budget is full', () => {
    const verdict = checkAnonQuota(usage({ totalBytes: 3990 }), 20, 0)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('存满')
  })

  it('stops everyone once the whole day has been spent', () => {
    const verdict = checkAnonQuota(usage(), 100, 1950)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('今天')
  })

  it('reports a spent day before the pool, which may still have room', () => {
    const verdict = checkAnonQuota(usage({ totalBytes: 100 }), 20, 2000)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('今天')
  })

  it('reports the shared budget before a per-visitor allowance, since it is the harder stop', () => {
    const verdict = checkAnonQuota(usage({ windowCount: 9, totalBytes: 4000 }), 20, 0)
    expect(verdict.message).toContain('存满')
  })
})
