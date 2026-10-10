/**
 * In-site feedback → email relay.
 *
 * The shape mirrors the mature setup on the owner's other sites: a Resend
 * relay configured purely through environment variables, a honeypot field,
 * strict input bounds and a per-IP rate limit. The receiving mailbox and the
 * API key exist only in server configuration and never reach the client.
 *
 * One deliberate difference: this handler awaits the mail service and reports
 * failure. There is no database behind it, so the email IS the delivery, and a
 * success response must mean the message was accepted on its way — a failed
 * send answers 502 instead.
 */

export interface FeedbackConfig {
  apiKey: string
  from: string
  to: string
}

export interface FeedbackEmail {
  from: string
  to: string
  /** Set when the submitter left a valid reply address. */
  replyTo?: string
  subject: string
  text: string
}

export interface FeedbackEmailContext {
  message: string
  contact: string
  lang: 'zh' | 'en'
  ip: string
  userAgent: string
  now: Date
}

export type FeedbackVerdict =
  | { ok: true; message: string; contact: string }
  | { ok: false; code: 'invalid_message' | 'invalid_contact' | 'disposable_email' }

const MESSAGE_MIN = 5
const MESSAGE_MAX = 2000
const CONTACT_MAX = 254

/** Mirrors the blocklist the owner's other feedback endpoints use. */
const DISPOSABLE_MARKERS = [
  '10minutemail',
  'mailinator',
  'tempmail',
  'guerrillamail',
  'throwaway',
  'yopmail',
  'maildrop',
  'getnada',
  'trashmail',
  'fakemail',
]

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** True when the hidden field carries a value — i.e. a bot filled the form. */
export function hasTrapValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= CONTACT_MAX
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@').at(-1)?.toLowerCase() ?? ''
  return DISPOSABLE_MARKERS.some((marker) => domain.includes(marker))
}

/** Field checks shared by the route and its tests. Pure. */
export function validateFeedback(payload: Record<string, unknown>): FeedbackVerdict {
  const message = normalizeText(payload.message)
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    return { ok: false, code: 'invalid_message' }
  }
  const contact = normalizeText(payload.contact).toLowerCase()
  if (contact) {
    if (!isValidEmail(contact)) return { ok: false, code: 'invalid_contact' }
    if (isDisposableEmail(contact)) return { ok: false, code: 'disposable_email' }
  }
  return { ok: true, message, contact }
}

/**
 * Relay configuration, read from the environment on every call (the same rule
 * `AGENT_TOKENS` follows). The variable names match the owner's other sites:
 * RESEND_API_KEY, RESEND_FROM, FEEDBACK_TO. Any of them missing means the
 * endpoint answers 503 rather than silently dropping mail.
 */
export function feedbackConfig(input: Record<string, string | undefined> = process.env): FeedbackConfig | null {
  const apiKey = normalizeText(input.RESEND_API_KEY)
  const from = normalizeText(input.RESEND_FROM)
  const to = normalizeText(input.FEEDBACK_TO)
  if (!apiKey || !from || !to) return null
  return { apiKey, from, to }
}

/** The Resend endpoint; overridable for local end-to-end tests and self-hosting. */
export function feedbackApiUrl(input: Record<string, string | undefined> = process.env): string {
  return normalizeText(input.RESEND_API_URL) || 'https://api.resend.com/emails'
}

/** Pure mail payload builder, so the message shape is pinned by tests. */
export function buildFeedbackEmail(cfg: FeedbackConfig, ctx: FeedbackEmailContext): FeedbackEmail {
  const replyTo = ctx.contact && isValidEmail(ctx.contact) ? ctx.contact : undefined
  const subject = `[芦苇 / Reed 反馈]${ctx.contact ? ` ${ctx.contact}` : ''}`
  // The contact line is always present so a reply address typed as plain text
  // (never a valid email) still reaches the owner.
  const text = [
    ctx.message,
    '',
    '---',
    `Contact: ${ctx.contact || '(not provided)'}`,
    `Language: ${ctx.lang === 'en' ? 'English' : '中文'}`,
    `Time: ${ctx.now.toISOString()}`,
    `IP: ${ctx.ip}`,
    `User agent: ${ctx.userAgent}`,
  ].join('\n')
  return replyTo ? { from: cfg.from, to: cfg.to, replyTo, subject, text } : { from: cfg.from, to: cfg.to, subject, text }
}

/**
 * Hand the message to the mail service. Throws when the service refuses or is
 * unreachable — the caller turns that into an explicit failure response.
 */
export async function sendFeedbackEmail(
  cfg: FeedbackConfig,
  email: FeedbackEmail,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = feedbackApiUrl(),
): Promise<void> {
  const res = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: email.from,
      to: email.to,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      subject: email.subject,
      text: email.text,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`mail service responded ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
}
