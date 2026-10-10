import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeedbackRouter } from './feedback-router'

/**
 * HTTP surface of the feedback relay, driven through the real Hono app with an
 * injected fetch so no request ever leaves this process. The relay credentials
 * come from process.env, so each test sets only what it needs and restores it.
 */

const ENV_KEYS = ['RESEND_API_KEY', 'RESEND_FROM', 'FEEDBACK_TO', 'RESEND_API_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function configure() {
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.RESEND_FROM = 'reed@example.com'
  process.env.FEEDBACK_TO = 'owner@example.com'
}

/** A fresh IP per test: the limiter is module-independent in-memory state. */
const freshIp = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`

function post(router: ReturnType<typeof createFeedbackRouter>, body: unknown, ip = freshIp('fb')) {
  return router.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  })
}

const MESSAGE = '这个页面在手机上有个小问题，附上截图地址。'

describe('POST /api/feedback', () => {
  it('rejects a non-JSON body with invalid_json', async () => {
    configure()
    const router = createFeedbackRouter({ fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch })
    const res = await router.request('/', { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json')
  })

  it('answers the honeypot with ok and sends nothing', async () => {
    configure()
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const router = createFeedbackRouter({ fetchImpl })
    const res = await post(router, { message: MESSAGE, _trap: 'bot' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('validates fields with stable codes', async () => {
    configure()
    const router = createFeedbackRouter({ fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch })
    expect(((await (await post(router, { message: 'x' })).json()) as { error: string }).error).toBe('invalid_message')
    expect(((await (await post(router, { message: MESSAGE, contact: 'nope' })).json()) as { error: string }).error).toBe('invalid_contact')
    expect(
      ((await (await post(router, { message: MESSAGE, contact: 'a@mailinator.com' })).json()) as { error: string }).error,
    ).toBe('disposable_email')
  })

  it('answers 503 when the relay has no credentials', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = createFeedbackRouter({ fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch })
    const res = await post(router, { message: MESSAGE })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe('unavailable')
    expect(warn.mock.calls.some(([line]) => String(line).startsWith('[feedback] unavailable'))).toBe(true)
    warn.mockRestore()
  })

  it('relays to the mail service and reports success only on acceptance', async () => {
    configure()
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response('{"id":"abc"}', { status: 200 })
    }) as typeof fetch
    const router = createFeedbackRouter({ fetchImpl })

    const res = await post(router, { message: MESSAGE, contact: 'reader@example.com', lang: 'en' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(bodies).toHaveLength(1)
    expect(bodies[0].to).toBe('owner@example.com')
    expect(bodies[0].reply_to).toBe('reader@example.com')
    expect(String(bodies[0].text)).toContain('Language: English')
  })

  it('answers 502 when the mail service refuses, and 502 on a network failure', async () => {
    configure()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refuse = createFeedbackRouter({ fetchImpl: (async () => new Response('{"error":"nope"}', { status: 401 })) as typeof fetch })
    const refused = await post(refuse, { message: MESSAGE })
    expect(refused.status).toBe(502)
    expect(((await refused.json()) as { error: string }).error).toBe('delivery_failed')

    const down = createFeedbackRouter({
      fetchImpl: (async () => {
        throw new Error('fetch failed')
      }) as typeof fetch,
    })
    const failed = await post(down, { message: MESSAGE })
    expect(failed.status).toBe(502)

    expect(warn.mock.calls.some(([line]) => String(line).startsWith('[feedback] delivery-failed'))).toBe(true)
    warn.mockRestore()
  })

  it('rate-limits one address per minute', async () => {
    configure()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = createFeedbackRouter({ fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch })
    const ip = freshIp('burst')
    for (let i = 0; i < 3; i++) {
      expect((await post(router, { message: MESSAGE }, ip)).status).toBe(200)
    }
    const limited = await post(router, { message: MESSAGE }, ip)
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as { error: string }).error).toBe('rate_limited')
    expect(warn.mock.calls.some(([line]) => String(line).startsWith('[feedback-deny] minute'))).toBe(true)
    // A different address is not punished.
    expect((await post(router, { message: MESSAGE }, freshIp('other'))).status).toBe(200)
    warn.mockRestore()
  })
})
