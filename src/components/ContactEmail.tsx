import { useEffect, useRef, useState } from 'react'
import { copyPlain } from '@/lib/clipboard'
import { contactEmail } from '@/lib/contact'

const linkClass = 'underline decoration-1 underline-offset-2'
const linkStyle = { color: 'var(--primary-600)', fontFamily: 'var(--font-mono)', fontSize: '12px' } as const

/**
 * 联系邮箱展示件：初始 DOM 里只有按钮，地址在点击后由 contactEmail()
 * 现场拼出，渲染页面的爬虫与静态扫描都拿不到明文。
 * - inline（默认）：一个句内小按钮，用于 /terms 正文；
 * - panel：多一个「复制邮箱」，用于设置页。
 */
export function ContactEmail({ variant = 'inline' }: { variant?: 'inline' | 'panel' }) {
  const [revealed, setRevealed] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    let ok = false
    try {
      ok = await copyPlain(contactEmail())
    } catch {
      ok = false
    }
    // 剪贴板被拒时直接亮出地址，用户还能手动选中，不至于走进死路。
    if (!ok) setRevealed(true)
    setCopyState(ok ? 'ok' : 'fail')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopyState('idle'), 2000)
  }

  const address = revealed ? (
    <a href={`mailto:${contactEmail()}`} className={linkClass} style={linkStyle}>
      {contactEmail()}
    </a>
  ) : null

  const revealButton = (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={variant === 'panel' ? 'ya-link-btn' : `${linkClass} decoration-dashed`}
      style={variant === 'panel' ? undefined : { color: 'var(--primary-600)', fontSize: '12px' }}
      title="点击后才在页面里出现，避免被爬虫收录"
    >
      显示邮箱
    </button>
  )

  if (variant === 'panel') {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="ya-btn ya-btn-secondary ya-btn-sm !h-8"
          title="复制到剪贴板，粘进你的邮箱客户端"
        >
          {copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制邮箱'}
        </button>
        {address ?? revealButton}
      </span>
    )
  }

  return address ?? revealButton
}
