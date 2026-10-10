import { useNavigate } from 'react-router'
import { Link } from 'react-router'
import { YoruMark } from '@/components/YoruMark'
import { APP_BYLINE } from '@/lib/brand'
import { THEMES } from '@/lib/themes'
import { RichText } from '@/components/RichText'
import { LanguageToggle } from '@/components/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useI18n } from '@/hooks/useI18n'

/**
 * Acceptable-use / liability page. Route: /terms
 *
 * Everything asserted here is a property of the current implementation, not a
 * boilerplate promise: drafts stay local by default (store.ts + body-store.ts),
 * explicit MCP grants create a temporary copy (api/lib/remote-mcp.ts), uploads
 * reach the server (api/lib/storage.ts → R2 via mopai-worker),
 * the quota numbers mirror api/lib/anon-quota.ts and api/lib/burst.ts, and the
 * 14-day sweep is api/lib/anon-gc.ts. Change those and change this page.
 *
 * Colours go through the Console tokens in index.css, same as References.tsx.
 */

function IconBack() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19 12H5M11 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m3.5 7 8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconStop() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.6 5.6l12.8 12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconImage() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="9.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="m4 17 5-5 4 4 3-2.5 4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function IconDoc() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Section({
  icon,
  title,
  eyebrow,
  children,
}: {
  icon?: React.ReactNode
  title: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="ya-well mb-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {icon && (
          <span style={{ color: 'var(--primary-600)' }} aria-hidden="true">
            {icon}
          </span>
        )}
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ink-1)' }}>
          {title}
        </h2>
        {eyebrow && <span className="ya-eyebrow">{eyebrow}</span>}
      </div>
      <div className="mt-2.5 space-y-2.5 text-[12.5px] leading-[1.8]" style={{ color: 'var(--ink-2)' }}>
        {children}
      </div>
    </section>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="ya-dot mt-[9px] shrink-0" style={{ background: 'var(--primary-500)' }} aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

export default function Terms() {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-2.5 px-3 sm:gap-3 sm:px-4">
        <button onClick={() => navigate('/')} className="ya-btn ya-btn-secondary ya-btn-sm !h-8 shrink-0">
          <IconBack />
          <span>{t('common.backToEditor')}</span>
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <YoruMark height={15} />
          <span className="truncate text-[15px] font-bold tracking-wide" style={{ color: 'var(--ink-1)' }}>
            {t('terms.title')}
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

      <main className="mx-auto max-w-3xl px-3 py-5 sm:px-4 sm:py-6">
        <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          <RichText text={t('terms.intro')} />
        </p>

        <Section icon={<IconDoc />} title={t('terms.local.title')} eyebrow={t('terms.local.eyebrow')}>
          <p>
            <RichText text={t('terms.local.p1')} />
          </p>
          <p>
            <RichText text={t('terms.local.p2')} />
          </p>
          <p>
            <RichText text={t('terms.local.p3')} />
          </p>
          <p style={{ color: 'var(--ink-3)' }}>
            <RichText text={t('terms.local.p4')} />
          </p>
        </Section>

        <Section icon={<IconImage />} title={t('terms.images.title')} eyebrow={t('terms.images.eyebrow')}>
          <p>
            <RichText text={t('terms.images.p1')} />
          </p>
          <ul className="space-y-2">
            <Bullet><RichText text={t('terms.images.b1')} /></Bullet>
            <Bullet><RichText text={t('terms.images.b2')} /></Bullet>
            <Bullet><RichText text={t('terms.images.b3')} /></Bullet>
          </ul>
          <p>
            <RichText text={t('terms.images.p2')} />
          </p>
        </Section>

        <Section icon={<IconStop />} title={t('terms.ban.title')} eyebrow={t('terms.ban.eyebrow')}>
          <ul className="space-y-2">
            <Bullet>{t('terms.ban.b1')}</Bullet>
            <Bullet>{t('terms.ban.b2')}</Bullet>
            <Bullet>{t('terms.ban.b3')}</Bullet>
            <Bullet>{t('terms.ban.b4')}</Bullet>
            <Bullet>{t('terms.ban.b5')}</Bullet>
          </ul>
          <p style={{ color: 'var(--ink-3)' }}>
            {t('terms.ban.p1')}
          </p>
        </Section>

        <Section icon={<IconMail />} title={t('terms.complaint.title')} eyebrow={t('terms.complaint.eyebrow')}>
          <p>
            <RichText text={t('terms.complaint.p1')} />
          </p>
          <ul className="space-y-2">
            <Bullet>{t('terms.complaint.b1')}</Bullet>
            <Bullet>{t('terms.complaint.b2')}</Bullet>
            <Bullet>{t('terms.complaint.b3')}</Bullet>
          </ul>
          <p>
            {t('terms.complaint.p2')}
          </p>
          <p>
            <Link
              to="/feedback"
              className="ya-btn ya-btn-primary ya-btn-sm mt-1 inline-flex"
            >
              {t('terms.complaint.openForm')}
            </Link>
          </p>
        </Section>

        <Section title={t('terms.liability.title')}>
          <ul className="space-y-2">
            <Bullet>
              {t('terms.liability.b1')}
            </Bullet>
            <Bullet>
              {t('terms.liability.b2')}
            </Bullet>
            <Bullet>
              {t('terms.liability.b3')}
            </Bullet>
            <Bullet>
              <RichText text={t('terms.liability.b4', { n: THEMES.length })} />
            </Bullet>
          </ul>
        </Section>

        <Section title={t('terms.selfhost.title')} eyebrow={t('terms.selfhost.eyebrow')}>
          <p>
            <RichText text={t('terms.selfhost.p1')} />
          </p>
        </Section>

        <p className="mt-2 text-center text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          {t('terms.footer')}
        </p>
      </main>
    </div>
  )
}
