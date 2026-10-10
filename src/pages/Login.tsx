import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { trpc } from '@/providers/trpc'
import { APP_BYLINE } from '@/lib/brand'
import { YoruMark } from '@/components/YoruMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/hooks/useI18n'

export default function Login() {
  const { t } = useI18n()
  const [accessKey, setAccessKey] = useState('')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const utils = trpc.useUtils()

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (res) => {
      if (res.success) {
        await utils.auth.me.invalidate()
        // Sent here from an agent's ?doc= link: go back to that article rather
        // than dropping her on whichever one she last happened to look at.
        const doc = searchParams.get('doc')
        navigate(doc ? `/?doc=${encodeURIComponent(doc)}` : '/')
      }
    },
  })

  // A wrong key is a normal 200 with {success:false}; a refused rate limit is a
  // thrown TOO_MANY_REQUESTS. Both have to land under the field — silently
  // swallowing the second one would make "too many attempts" look like a dead
  // button. Known cases are shown in the interface language; anything else
  // falls back to the server's own wording.
  const failure = loginMutation.error
    ? ((loginMutation.error.data as { code?: string } | undefined)?.code === 'TOO_MANY_REQUESTS'
        ? t('login.tooMany')
        : loginMutation.error.message)
    : loginMutation.data && !loginMutation.data.success
      ? t('login.wrongKey')
      : null

  return (
    <div className="ya-page flex min-h-screen items-center justify-center">
      <div className="fixed right-4 top-4 z-10 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="ya-card w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center gap-1 text-center">
          <span className="mb-2.5">
            <YoruMark height={30} />
          </span>
          <span className="text-[19px] font-bold tracking-wide text-ink-1">{t('app.name')}</span>
          <span className="ya-eyebrow">{APP_BYLINE}</span>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (accessKey) loginMutation.mutate({ accessKey })
          }}
        >
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder={t('login.placeholder')}
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            className="ya-input w-full"
            style={failure ? { boxShadow: 'inset 3px 3px 6px rgba(143,158,191,0.40), inset -2px -2px 5px rgba(255,255,255,0.95), 0 0 0 2px var(--error-500)' } : undefined}
          />
          <button className="ya-btn ya-btn-primary w-full !h-10" type="submit" disabled={!accessKey || loginMutation.isPending}>
            {loginMutation.isPending ? t('login.pending') : t('login.submit')}
          </button>
        </form>
        {failure && <p className="mt-3 text-center text-[12px] text-bad-700">{failure}</p>}
        <p className="mt-4 space-y-1 text-center text-[11px] leading-relaxed text-ink-3">
          <span className="block">{t('login.note1')}</span>
          <span className="block">{t('login.note2')}</span>
          <span className="block">{t('login.note3')}</span>
        </p>
      </div>
    </div>
  )
}
