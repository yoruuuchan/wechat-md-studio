import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Link } from 'react-router'
import { YoruMark } from '@/components/YoruMark'
import { APP_BYLINE } from '@/lib/brand'
import { LanguageToggle } from '@/components/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useI18n } from '@/hooks/useI18n'
import { currentLang, type MsgKey } from '@/lib/i18n'

/**
 * In-site feedback. The form posts to the server, which relays it as an email
 * to the site owner (api/lib/feedback.ts); no address is exposed on any public
 * surface. Success is shown only after the server has confirmed the mail
 * service accepted the message, so a failed delivery never looks like a win.
 */

type SubmitState = 'idle' | 'submitting' | 'success'

const ERROR_KEYS: Record<string, MsgKey> = {
  invalid_message: 'feedback.err.messageLength',
  invalid_contact: 'feedback.err.contact',
  disposable_email: 'feedback.err.disposable',
  rate_limited: 'feedback.err.rateLimited',
  unavailable: 'feedback.err.unavailable',
  delivery_failed: 'feedback.err.delivery',
}

export default function Feedback() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [trap, setTrap] = useState('')
  const [state, setState] = useState<SubmitState>('idle')
  const [errorKey, setErrorKey] = useState<MsgKey | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state === 'submitting') return
    const trimmed = message.trim()
    if (trimmed.length < 5 || trimmed.length > 2000) {
      setErrorKey('feedback.err.messageLength')
      return
    }
    setState('submitting')
    setErrorKey(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, contact: contact.trim(), _trap: trap, lang: currentLang() }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        setState('success')
        return
      }
      setState('idle')
      setErrorKey(ERROR_KEYS[data?.error ?? ''] ?? 'feedback.err.invalid')
    } catch {
      setState('idle')
      setErrorKey('feedback.err.network')
    }
  }

  return (
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-2.5 px-3 sm:gap-3 sm:px-4">
        <button onClick={() => navigate('/')} className="ya-btn ya-btn-secondary ya-btn-sm !h-8 shrink-0">
          ← {t('feedback.backToEditor')}
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <YoruMark height={15} />
          <span className="truncate text-[15px] font-bold tracking-wide" style={{ color: 'var(--ink-1)' }}>
            {t('feedback.title')}
          </span>
          <span className="ya-eyebrow hidden sm:inline">
            {t('app.name')} · {APP_BYLINE}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-3 py-5 sm:px-4 sm:py-6">
        <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          {t('feedback.intro')}
        </p>

        {state === 'success' ? (
          <div
            className="ya-well p-5 text-[13px] leading-relaxed"
            style={{ color: 'var(--ink-2)' }}
            role="status"
            data-feedback-state="success"
          >
            {t('feedback.success')}
          </div>
        ) : (
          <form onSubmit={submit} className="ya-well space-y-4 p-5" data-feedback-form>
            <label className="block space-y-1.5" htmlFor="feedback-message">
              <span className="text-[12px] font-medium" style={{ color: 'var(--ink-2)' }}>
                {t('feedback.messageLabel')}
              </span>
              <textarea
                id="feedback-message"
                name="message"
                required
                minLength={5}
                maxLength={2000}
                rows={7}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('feedback.messagePlaceholder')}
                className="ya-input w-full !py-3 !text-[12px]"
                aria-describedby="feedback-message-help"
              />
            </label>
            <p id="feedback-message-help" className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
              {t('feedback.complaintNote')}
            </p>

            <label className="block space-y-1.5" htmlFor="feedback-contact">
              <span className="text-[12px] font-medium" style={{ color: 'var(--ink-2)' }}>
                {t('feedback.contactLabel')}
              </span>
              <input
                id="feedback-contact"
                name="contact"
                type="email"
                autoComplete="email"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t('feedback.contactPlaceholder')}
                className="ya-input w-full !text-[12px]"
                aria-describedby="feedback-contact-help"
              />
            </label>
            <p id="feedback-contact-help" className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
              {t('feedback.contactNote')}
            </p>

            {/* Honeypot: visually hidden and unreachable by keyboard; a bot that
                fills it gets a silent ok, exactly like is-ai-down's form. */}
            <input
              type="text"
              name="_trap"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
              style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={state === 'submitting'}
                className="ya-btn ya-btn-primary"
                data-feedback-submit
              >
                {state === 'submitting' ? t('feedback.submitting') : t('feedback.submit')}
              </button>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
                {t('feedback.privacy')}
              </p>
            </div>

            {errorKey && (
              <p role="alert" data-feedback-error className="text-[12px]" style={{ color: 'var(--error-500)' }}>
                {t(errorKey)}
              </p>
            )}
          </form>
        )}

        <p className="mt-4 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          <Link to="/terms" className="text-brand underline decoration-brand/40 underline-offset-2">
            {t('feedback.termsLink')}
          </Link>
        </p>
      </main>
    </div>
  )
}
