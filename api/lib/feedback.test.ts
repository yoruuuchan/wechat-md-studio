import { describe, expect, it } from 'vitest'
import {
  buildFeedbackEmail,
  feedbackApiUrl,
  feedbackConfig,
  hasTrapValue,
  isDisposableEmail,
  isValidEmail,
  normalizeText,
  sendFeedbackEmail,
  validateFeedback,
  type FeedbackConfig,
} from './feedback'

/**
 * The relay's pure half: field validation, config parsing, and the exact mail
 * payload the Resend call would carry. The router test next door covers the
 * HTTP surface; nothing here touches the network.
 */

const CONFIG: FeedbackConfig = {
  apiKey: 're_test_key',
  from: 'reed@example.com',
  to: 'owner@example.com',
}

describe('validateFeedback', () => {
  it('accepts a plain message with no contact', () => {
    const v = validateFeedback({ message: '  这个页面有个小问题  ' })
    expect(v).toEqual({ ok: true, message: '这个页面有个小问题', contact: '' })
  })

  it('normalises the contact to lower case', () => {
    const v = validateFeedback({ message: 'hello there', contact: '  SomeOne@Example.COM ' })
    expect(v.ok && v.contact).toBe('someone@example.com')
  })

  it('rejects messages outside the 5–2000 bounds', () => {
    expect(validateFeedback({ message: 'xxxx' })).toEqual({ ok: false, code: 'invalid_message' })
    expect(validateFeedback({ message: 'x'.repeat(2001) })).toEqual({ ok: false, code: 'invalid_message' })
    expect(validateFeedback({ message: '     ' })).toEqual({ ok: false, code: 'invalid_message' })
    expect(validateFeedback({ message: 'x'.repeat(2000) }).ok).toBe(true)
  })

  it('rejects a contact that is not an email address', () => {
    expect(validateFeedback({ message: 'hello there', contact: 'not-an-address' })).toEqual({
      ok: false,
      code: 'invalid_contact',
    })
  })

  it('rejects disposable email domains', () => {
    expect(validateFeedback({ message: 'hello there', contact: 'a@mailinator.com' })).toEqual({
      ok: false,
      code: 'disposable_email',
    })
  })

  it('treats non-string message values as missing', () => {
    expect(validateFeedback({ message: 42 }).ok).toBe(false)
    expect(validateFeedback({}).ok).toBe(false)
  })
})

describe('contact helpers', () => {
  it('validates shape and length', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('a b@c.co')).toBe(false)
    expect(isValidEmail(`${'x'.repeat(250)}@b.co`)).toBe(false)
  })

  it('flags disposable domains case-insensitively', () => {
    expect(isDisposableEmail('x@YOPMAIL.com')).toBe(true)
    expect(isDisposableEmail('x@example.com')).toBe(false)
  })

  it('normalises and detects the honeypot', () => {
    expect(normalizeText('  hi  ')).toBe('hi')
    expect(normalizeText(undefined)).toBe('')
    expect(hasTrapValue('')).toBe(false)
    expect(hasTrapValue('   ')).toBe(false)
    expect(hasTrapValue('bot')).toBe(true)
    expect(hasTrapValue(undefined)).toBe(false)
  })
})

describe('feedbackConfig', () => {
  it('is null unless all three variables are present', () => {
    expect(feedbackConfig({})).toBeNull()
    expect(feedbackConfig({ RESEND_API_KEY: 'k' })).toBeNull()
    expect(feedbackConfig({ RESEND_API_KEY: 'k', RESEND_FROM: 'a@b.co' })).toBeNull()
  })

  it('trims the values it keeps', () => {
    expect(
      feedbackConfig({ RESEND_API_KEY: ' k ', RESEND_FROM: ' a@b.co ', FEEDBACK_TO: ' c@d.co ' }),
    ).toEqual({ apiKey: 'k', from: 'a@b.co', to: 'c@d.co' })
  })
})

describe('buildFeedbackEmail', () => {
  const ctx = {
    message: 'Something is off on the themes page.',
    contact: 'reader@example.com',
    lang: 'en' as const,
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (test)',
    now: new Date('2026-10-10T12:00:00Z'),
  }

  it('carries the message, contact and context', () => {
    const email = buildFeedbackEmail(CONFIG, ctx)
    expect(email.from).toBe(CONFIG.from)
    expect(email.to).toBe(CONFIG.to)
    expect(email.replyTo).toBe('reader@example.com')
    expect(email.subject).toContain('[芦苇 / Reed 反馈]')
    expect(email.subject).toContain('reader@example.com')
    expect(email.text).toContain(ctx.message)
    expect(email.text).toContain('Language: English')
    expect(email.text).toContain('IP: 203.0.113.9')
    expect(email.text).toContain('User agent: Mozilla/5.0 (test)')
    expect(email.text).toContain('Time: 2026-10-10T12:00:00.000Z')
  })

  it('omits reply_to when there is no contact', () => {
    const email = buildFeedbackEmail(CONFIG, { ...ctx, contact: '' })
    expect(email.replyTo).toBeUndefined()
    expect(email.subject).toBe('[芦苇 / Reed 反馈]')
    expect(email.text).toContain('Contact: (not provided)')
  })

  it('marks the Chinese interface language', () => {
    const email = buildFeedbackEmail(CONFIG, { ...ctx, lang: 'zh' })
    expect(email.text).toContain('Language: 中文')
  })
})

describe('sendFeedbackEmail', () => {
  it('posts a Resend-shaped request and resolves on 2xx', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      return new Response('{"id":"abc"}', { status: 200 })
    }) as typeof fetch

    await sendFeedbackEmail(CONFIG, buildFeedbackEmail(CONFIG, {
      message: 'hello there',
      contact: '',
      lang: 'zh',
      ip: '127.0.0.1',
      userAgent: 'test',
      now: new Date(),
    }), fetchImpl)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${CONFIG.apiKey}`)
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(body.from).toBe(CONFIG.from)
    expect(body.to).toBe(CONFIG.to)
    expect(body.reply_to).toBeUndefined()
    expect(String(body.subject)).toContain('反馈')
  })

  it('throws when the mail service refuses', async () => {
    const fetchImpl = (async () => new Response('{"error":"bad key"}', { status: 401 })) as typeof fetch
    await expect(
      sendFeedbackEmail(CONFIG, buildFeedbackEmail(CONFIG, {
        message: 'hello there',
        contact: '',
        lang: 'zh',
        ip: '127.0.0.1',
        userAgent: 'test',
        now: new Date(),
      }), fetchImpl),
    ).rejects.toThrow(/401/)
  })

  it('honours a RESEND_API_URL override for local testing', () => {
    expect(feedbackApiUrl({ RESEND_API_URL: 'http://127.0.0.1:9999/emails' })).toBe('http://127.0.0.1:9999/emails')
    expect(feedbackApiUrl({})).toBe('https://api.resend.com/emails')
  })
})
