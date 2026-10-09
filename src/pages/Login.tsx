import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { trpc } from '@/providers/trpc'
import { APP_NAME, APP_BYLINE } from '@/lib/brand'
import { YoruMark } from '@/components/YoruMark'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function Login() {
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
  // button.
  const failure =
    loginMutation.error?.message ??
    (loginMutation.data && !loginMutation.data.success ? loginMutation.data.message : null)

  return (
    <div className="ya-page flex min-h-screen items-center justify-center">
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="ya-card w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center gap-1 text-center">
          <span className="mb-2.5">
            <YoruMark height={30} />
          </span>
          <span className="text-[19px] font-bold tracking-wide text-ink-1">{APP_NAME}</span>
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
            placeholder="访问口令"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            className="ya-input w-full"
            style={failure ? { boxShadow: 'inset 3px 3px 6px rgba(143,158,191,0.40), inset -2px -2px 5px rgba(255,255,255,0.95), 0 0 0 2px var(--error-500)' } : undefined}
          />
          <button className="ya-btn ya-btn-primary w-full !h-10" type="submit" disabled={!accessKey || loginMutation.isPending}>
            {loginMutation.isPending ? '验证中…' : '进入'}
          </button>
        </form>
        {failure && <p className="mt-3 text-center text-[12px] text-bad-700">{failure}</p>}
        <p className="mt-4 space-y-1 text-center text-[11px] leading-relaxed text-ink-3">
          <span className="block">不登录就能用：排版、上传、复制、导出、换主题。</span>
          <span className="block">口令只打开一样东西：云端草稿箱（跨设备保存、永久保留）。</span>
          <span className="block">它目前仅对站长开放；人数多后会更新为多账号。</span>
        </p>
      </div>
    </div>
  )
}
