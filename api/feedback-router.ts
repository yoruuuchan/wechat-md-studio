import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { allowBurst, allowIpDaily, clientIp } from './lib/burst'
import { env } from './lib/env'
import {
  buildFeedbackEmail,
  feedbackConfig,
  hasTrapValue,
  sendFeedbackEmail,
  validateFeedback,
} from './lib/feedback'

/**
 * POST /api/feedback — the only public write surface for feedback; the form on
 * /feedback posts here and the server relays the message as an email (see
 * lib/feedback.ts). Responses carry stable codes, never credentials:
 *
 *   200 {ok:true}                  handed to the mail service
 *   400 invalid_json | invalid_message | invalid_contact | disposable_email
 *   429 rate_limited
 *   502 delivery_failed            mail service refused or was unreachable
 *   503 unavailable                relay not configured on the server
 *
 * Failure codes are what the page translates; the mailbox and the API key are
 * never echoed here.
 */

export interface FeedbackRouterDeps {
  /** Injected in tests; production uses the global fetch. */
  fetchImpl?: typeof fetch
  now?: () => Date
}

export function createFeedbackRouter(deps: FeedbackRouterDeps = {}) {
  const router = new Hono()
  const minuteHits = new Map<string, number[]>()
  const dayHits = new Map<string, { day: string; count: number }>()

  // The form posts one short message; anything bigger is not a submission.
  router.use('*', bodyLimit({ maxSize: 16 * 1024 }))

  router.post('/', async (c) => {
    let payload: Record<string, unknown> | null = null
    try {
      const json = await c.req.json()
      payload = json !== null && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null
    } catch {
      payload = null
    }
    if (!payload) return c.json({ error: 'invalid_json' }, 400)

    // Honeypot: bots that fill the hidden field get the same answer as a human,
    // and nothing is sent.
    if (hasTrapValue(payload._trap)) return c.json({ ok: true })

    const verdict = validateFeedback(payload)
    if (!verdict.ok) return c.json({ error: verdict.code }, 400)

    const cfg = feedbackConfig()
    if (!cfg) {
      console.warn('[feedback] unavailable reason=unconfigured')
      return c.json({ error: 'unavailable' }, 503)
    }

    const ip = clientIp(c.req.raw.headers)
    if (!allowBurst(minuteHits, ip, Date.now(), env.feedbackPerMinute)) {
      console.warn(`[feedback-deny] minute ip=${ip}`)
      return c.json({ error: 'rate_limited' }, 429)
    }
    if (!allowIpDaily(dayHits, ip, new Date().toISOString().slice(0, 10), env.feedbackPerDay)) {
      console.warn(`[feedback-deny] day ip=${ip}`)
      return c.json({ error: 'rate_limited' }, 429)
    }

    const lang = payload.lang === 'en' ? 'en' : 'zh'
    const email = buildFeedbackEmail(cfg, {
      message: verdict.message,
      contact: verdict.contact,
      lang,
      ip,
      userAgent: (c.req.header('user-agent') ?? '').slice(0, 500),
      now: deps.now?.() ?? new Date(),
    })

    try {
      await sendFeedbackEmail(cfg, email, deps.fetchImpl)
    } catch (e) {
      // The submitter is told; the message itself is not kept anywhere else.
      console.warn(`[feedback] delivery-failed ${e instanceof Error ? e.message : 'unknown'}`)
      return c.json({ error: 'delivery_failed' }, 502)
    }

    console.log(`[feedback] sent lang=${lang} ip=${ip}`)
    return c.json({ ok: true })
  })

  return router
}

export const feedbackRouter = createFeedbackRouter()
