import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// boot.ts builds the whole app but only starts a listener in production, so
// under vitest it hands back the Hono instance these tests drive — the same
// object the server serves, middleware order and all.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-boot-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'boot.db')}`

const { default: app } = await import('./boot')
const { env } = await import('./lib/env')

function login(ip: string, accessKey: string, url = 'http://127.0.0.1/api/trpc/auth.login') {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ json: { accessKey } }),
  })
}

/** A fresh address per test: the limiter is module state keyed by IP. */
const freshIp = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('auth.login', () => {
  it('answers a wrong key with the ordinary rejection, not an error envelope', async () => {
    const res = await login(freshIp('wrong'), 'not-the-key')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result?: { data?: { json?: { success: boolean } } } }
    expect(body.result?.data?.json?.success).toBe(false)
  })

  it('still lets the owner in and sets the session cookie', async () => {
    const res = await login(freshIp('owner'), env.accessKey)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result?: { data?: { json?: { success: boolean } } } }
    expect(body.result?.data?.json?.success).toBe(true)
    expect(res.headers.get('set-cookie')).toContain('mopai_sid=')
  })

  it('refuses the attempt past the per-IP ceiling with 429, and says so', async () => {
    const ip = freshIp('brute')
    for (let i = 0; i < env.authLoginPerMinute; i++) {
      expect((await login(ip, `guess-${i}`)).status).toBe(200)
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refused = await login(ip, 'guess-again')
    // superjson wraps the whole envelope, errors included: {error:{json:{…}}}.
    const body = (await refused.json()) as {
      error?: { json?: { message?: string; code?: number; data?: { code?: string; httpStatus?: number } } }
    }
    expect(refused.status).toBe(429)
    expect(body.error?.json?.data?.code).toBe('TOO_MANY_REQUESTS')
    expect(body.error?.json?.data?.httpStatus).toBe(429)
    expect(body.error?.json?.message).toContain('频繁')
    expect(warn.mock.calls.some(([line]) => String(line).startsWith('[auth-deny] login-burst'))).toBe(true)
    warn.mockRestore()
  })

  it('does not punish a different address for someone else\'s attempts', async () => {
    const victim = freshIp('victim')
    for (let i = 0; i < env.authLoginPerMinute; i++) await login(victim, `guess-${i}`)
    expect((await login(victim, 'guess')).status).toBe(429)

    expect((await login(freshIp('bystander'), env.accessKey)).status).toBe(200)
  })
})

describe('the app-wide response headers', () => {
  it('are on tRPC answers, the /api/img redirect and 404s alike', async () => {
    for (const res of [
      await login(freshIp('headers'), 'wrong-key'),
      await app.request('/api/img/some-key'),
      await app.request('/api/nope'),
    ]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('permissions-policy')).toContain('camera=()')
    }
  })

  it('stay off HSTS in development, where there is no certificate to pin', async () => {
    const res = await app.request('/api/nope', { headers: { 'x-forwarded-proto': 'https' } })
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })
})
