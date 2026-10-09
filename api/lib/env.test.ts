import { describe, expect, it } from 'vitest'
import { parseEnv, type EnvInput } from './env'

/**
 * env.ts parses the ambient `process.env` once at import; these tests drive the
 * pure parser with explicit inputs instead, so every case is spelled out and
 * none of them depends on whether a local `.env` exists.
 */
const production: EnvInput = {
  NODE_ENV: 'production',
  ACCESS_KEY: 'a'.repeat(48),
  SESSION_SECRET: 'b'.repeat(64),
  DATABASE_URL: 'file:./data/mopai.db',
  IMG_BASE_URL: 'https://mopai-img.example.test',
  IMG_ADMIN_KEY: 'c'.repeat(64),
}

/** The keys that used to be `Number(process.env.X)` and could turn into NaN. */
const NUMERIC_KNOBS = [
  'STORAGE_QUOTA_BYTES',
  'ANON_DAILY_IMAGES',
  'ANON_DAILY_BYTES',
  'ANON_TOTAL_BYTES',
  'ANON_GC_DAYS',
  'ANON_BURST_PER_MINUTE',
  'ANON_IP_DAILY_IMAGES',
  'AUTH_LOGIN_PER_MINUTE',
  'PORT',
]

describe('parseEnv in production', () => {
  it('parses a complete configuration', () => {
    const env = parseEnv(production)
    expect(env.isProduction).toBe(true)
    expect(env.accessKey).toBe(production.ACCESS_KEY)
    expect(env.sessionSecret).toBe(production.SESSION_SECRET)
    expect(env.imgBaseUrl).toBe('https://mopai-img.example.test')
  })

  it('keeps the documented default ceilings when the knobs are unset', () => {
    const env = parseEnv(production)
    expect(env.storageQuotaBytes).toBe(2 * 1024 * 1024 * 1024)
    expect(env.anonDailyImages).toBe(30)
    expect(env.anonDailyBytes).toBe(100 * 1024 * 1024)
    expect(env.anonTotalBytes).toBe(1536 * 1024 * 1024)
    expect(env.anonGcDays).toBe(14)
    expect(env.anonGcEnabled).toBe(true)
    expect(env.anonBurstPerMinute).toBe(12)
    expect(env.anonIpDailyImages).toBe(100)
    expect(env.authLoginPerMinute).toBe(10)
    expect(env.port).toBe(3100)
    expect(env.host).toBe('127.0.0.1')
  })

  it('takes numeric overrides, including an explicit zero ceiling', () => {
    const env = parseEnv({
      ...production,
      ANON_DAILY_IMAGES: '3',
      ANON_BURST_PER_MINUTE: '0',
      ANON_GC_DAYS: '7',
      AUTH_LOGIN_PER_MINUTE: '5',
      PORT: '3200',
    })
    expect(env.anonDailyImages).toBe(3)
    expect(env.anonBurstPerMinute).toBe(0)
    expect(env.anonGcDays).toBe(7)
    expect(env.authLoginPerMinute).toBe(5)
    expect(env.port).toBe(3200)
  })

  it('refuses to boot without ACCESS_KEY', () => {
    expect(() => parseEnv({ ...production, ACCESS_KEY: undefined })).toThrow(/ACCESS_KEY is required/)
  })

  it('refuses the placeholder values that ship in the repository', () => {
    expect(() => parseEnv({ ...production, ACCESS_KEY: 'change-me' })).toThrow(
      /ACCESS_KEY is still the placeholder/,
    )
    expect(() => parseEnv({ ...production, ACCESS_KEY: 'mopai-dev-only-access-key' })).toThrow(
      /ACCESS_KEY is still the placeholder/,
    )
    // Matched case-insensitively: "Change-Me" is the same credential.
    expect(() => parseEnv({ ...production, ACCESS_KEY: 'Change-Me' })).toThrow(
      /ACCESS_KEY is still the placeholder/,
    )
  })

  it('refuses an ACCESS_KEY shorter than the minimum', () => {
    expect(() => parseEnv({ ...production, ACCESS_KEY: 'short-key' })).toThrow(/at least 16 characters/)
  })

  it('applies the same rules to the other secrets', () => {
    expect(() => parseEnv({ ...production, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET is required/)
    expect(() => parseEnv({ ...production, SESSION_SECRET: 'change-me' })).toThrow(
      /SESSION_SECRET is still the placeholder/,
    )
    expect(() => parseEnv({ ...production, SESSION_SECRET: 'b'.repeat(31) })).toThrow(/at least 32 characters/)
    expect(() => parseEnv({ ...production, IMG_ADMIN_KEY: undefined })).toThrow(/IMG_ADMIN_KEY is required/)
    expect(() => parseEnv({ ...production, IMG_ADMIN_KEY: 'change-me' })).toThrow(
      /IMG_ADMIN_KEY is still the placeholder/,
    )
    expect(() => parseEnv({ ...production, DATABASE_URL: undefined })).toThrow(/DATABASE_URL is required/)
  })

  it.each(NUMERIC_KNOBS)('refuses %s = "abc" (a NaN ceiling must not boot)', (name) => {
    expect(() => parseEnv({ ...production, [name]: 'abc' })).toThrow(new RegExp(`${name} must be an integer`))
  })

  it.each(NUMERIC_KNOBS)('refuses %s = "12.5" (limits are whole units)', (name) => {
    expect(() => parseEnv({ ...production, [name]: '12.5' })).toThrow(new RegExp(`${name} must be an integer`))
  })

  it.each(NUMERIC_KNOBS)('refuses %s = "-1" (out of range)', (name) => {
    expect(() => parseEnv({ ...production, [name]: '-1' })).toThrow(new RegExp(`${name} must be an integer`))
  })

  it('rejects a port outside 1-65535', () => {
    expect(() => parseEnv({ ...production, PORT: '70000' })).toThrow(/PORT must be an integer between 1 and 65535/)
  })

  it('keeps ANON_GC_DAYS=0 legal — it is the documented "sweep everything unreferenced now"', () => {
    expect(parseEnv({ ...production, ANON_GC_DAYS: '0' }).anonGcDays).toBe(0)
  })

  it('reports every problem at once instead of one per boot', () => {
    const error = (() => {
      try {
        parseEnv({ ...production, ACCESS_KEY: 'change-me', ANON_DAILY_IMAGES: 'abc', PORT: 'nope' })
      } catch (e) {
        return e as Error
      }
      return null
    })()
    expect(error?.message).toMatch(/ACCESS_KEY/)
    expect(error?.message).toMatch(/ANON_DAILY_IMAGES/)
    expect(error?.message).toMatch(/PORT/)
    expect(error?.message).toMatch(/3 configuration problem/)
  })

  it('validates optional URLs and trims trailing slashes', () => {
    expect(parseEnv({ ...production, IMG_BASE_URL: 'https://img.example.test///' }).imgBaseUrl).toBe(
      'https://img.example.test',
    )
    expect(parseEnv({ ...production, PUBLIC_BASE_URL: 'https://wechat.example.test' }).publicBaseUrl).toBe(
      'https://wechat.example.test',
    )
    expect(() => parseEnv({ ...production, IMG_BASE_URL: 'not a url' })).toThrow(/IMG_BASE_URL must be an absolute/)
    expect(() => parseEnv({ ...production, PUBLIC_BASE_URL: 'ftp://files.example.test' })).toThrow(
      /PUBLIC_BASE_URL must be an absolute/,
    )
  })

  it('reads ANON_GC_ENABLED exactly like before: only the string "false" turns it off', () => {
    expect(parseEnv({ ...production, ANON_GC_ENABLED: 'false' }).anonGcEnabled).toBe(false)
    expect(parseEnv({ ...production, ANON_GC_ENABLED: '0' }).anonGcEnabled).toBe(true)
    expect(parseEnv({ ...production, ANON_GC_ENABLED: 'true' }).anonGcEnabled).toBe(true)
  })
})

describe('parseEnv in development', () => {
  const development: EnvInput = { NODE_ENV: 'development', DATABASE_URL: 'file:./data/mopai.db' }

  it('starts without secrets and says which fallbacks it used', () => {
    const env = parseEnv(development)
    expect(env.isProduction).toBe(false)
    expect(env.accessKey).toBe('mopai-dev-only-access-key')
    expect(env.sessionSecret).toBe('mopai-dev-only-session-secret')
  })

  it('accepts the placeholder identity a fresh clone gets from .env.example', () => {
    const env = parseEnv({ ...development, ACCESS_KEY: 'change-me', SESSION_SECRET: 'change-me' })
    expect(env.accessKey).toBe('change-me')
    expect(env.sessionSecret).toBe('change-me')
  })

  it('never hands the development fallbacks to production', () => {
    // The regression this file exists for: production used to inherit the
    // source-published key when ACCESS_KEY was missing.
    expect(() => parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'file:./data/mopai.db' })).toThrow(
      /ACCESS_KEY is required in production/,
    )
  })
})
