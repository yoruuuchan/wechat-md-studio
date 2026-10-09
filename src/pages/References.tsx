import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { YoruMark } from '@/components/YoruMark'
import { APP_NAME, APP_BYLINE, REPO_URL } from '@/lib/brand'
import {
  CREDITS,
  USAGE_HINT,
  USAGE_LABEL,
  USAGE_ORDER,
  type Credit,
  type Usage,
} from '@/lib/credits'
import { THEMES } from '@/lib/themes'
import { licenseLabel, tallyByLicense, tallyThemeSources } from '@/lib/theme-sources'
import { ORIGINAL_LICENSE } from '@/lib/theme-meta'

/**
 * Acknowledgements / References page. All content comes from src/lib/credits.ts
 * (code-level credits) and src/lib/theme-sources.ts / src/lib/themes.ts (theme
 * material provenance); this file is layout only. `npm run verify:sources`
 * fails if any project name, repo or license literal shows up in here.
 *
 * Every colour goes through the Console tokens in index.css (--ink-*, --bg-*,
 * --line-*, --primary-*) instead of hardcoded hex, so the page follows along if
 * data-theme="yoru" is ever hoisted onto <html>. Today data-theme is scoped to
 * the dark well around the code editor in EditorPage, so the app renders akari.
 */

// ---------- Inline SVG, hand-written like TopBar rather than lucide ----------

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

function IconExternal() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconBorrowed() {
  // Arrow landing in a tray: something was taken in and stayed.
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v11M7 10l5 5 5-5M4 19h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconDeclined() {
  // A slash through a circle: read, evaluated, not the road we took.
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M6 18 18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconScale() {
  // Scales: licensing and attribution.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v16M7 20h10M4 9h16M4 9l-2 5a3 3 0 0 0 4 0L4 9Zm16 0-2 5a3 3 0 0 0 4 0l-2-5ZM12 4l-8 5m8-5 8 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconLayers() {
  // Stacked sheets: the theme library's many sources.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m3 13 9 5 9-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

// ---------- Small parts ----------

function LicensePill({ license }: { license: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
      style={{
        background: 'var(--bg-elevated)',
        boxShadow: 'inset 0 0 0 1px var(--line-2)',
        color: 'var(--ink-2)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {license}
    </span>
  )
}

function UsagePill({ usage }: { usage: Usage }) {
  const active = usage === 'ported' || usage === 'adapted'
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={
        active
          ? { background: 'var(--primary-500)', color: 'var(--ink-on-primary, #fff)' }
          : {
              background: 'transparent',
              boxShadow: 'inset 0 0 0 1px var(--line-strong, var(--line-2))',
              color: 'var(--ink-3)',
            }
      }
    >
      {USAGE_LABEL[usage]}
    </span>
  )
}

function ItemList({
  items,
  icon,
  tone,
}: {
  items: string[]
  icon: React.ReactNode
  tone: 'borrowed' | 'declined'
}) {
  return (
    <ul className="mt-2 space-y-2.5">
      {items.map((text, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-md"
            style={{
              color: tone === 'borrowed' ? 'var(--primary-600)' : 'var(--ink-4)',
              background: tone === 'borrowed' ? 'var(--primary-100)' : 'transparent',
            }}
          >
            {icon}
          </span>
          <p
            className="min-w-0 flex-1 text-[12.5px] leading-[1.75]"
            style={{ color: tone === 'borrowed' ? 'var(--ink-2)' : 'var(--ink-3)' }}
          >
            {text}
          </p>
        </li>
      ))}
    </ul>
  )
}

function CreditCard({ credit }: { credit: Credit }) {
  return (
    <article className="ya-well p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--ink-1)' }}>
          {credit.name}
        </h3>
        <UsagePill usage={credit.usage} />
        <LicensePill license={credit.license} />
        <a
          href={credit.repo}
          target="_blank"
          rel="noreferrer noopener"
          className="ya-link-btn ml-auto inline-flex max-w-full min-w-0 !text-[11px]"
          style={{ color: 'var(--primary-600)' }}
        >
          <span className="min-w-0 truncate" style={{ fontFamily: 'var(--font-mono)' }}>
            {credit.repo.replace(/^https?:\/\//, '')}
          </span>
          <span className="shrink-0">
            <IconExternal />
          </span>
        </a>
      </div>

      <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        {credit.author}
        <span style={{ color: 'var(--ink-4)' }}> · 许可证副本 </span>
        <code className="text-[11px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>
          LICENSES/{credit.licenseFile}
        </code>
      </p>

      {credit.licenseNote && (
        <div
          className="mt-3 flex gap-2.5 rounded-xl p-3"
          style={{ background: 'var(--bg-tint)', boxShadow: 'inset 0 0 0 1px var(--line-2)' }}
        >
          <span
            className="ya-dot mt-[5px] shrink-0"
            style={{ background: 'var(--warning-500)' }}
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 text-[11.5px] leading-[1.7]" style={{ color: 'var(--ink-2)' }}>
            {credit.licenseNote}
          </p>
        </div>
      )}

      <section className="mt-4">
        <h4
          className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide"
          style={{ color: 'var(--ink-1)' }}
        >
          <span style={{ color: 'var(--primary-600)' }}>
            <IconBorrowed />
          </span>
          借用了什么
          <span className="ya-eyebrow">{credit.borrowed.length}</span>
        </h4>
        <ItemList items={credit.borrowed} icon={<IconBorrowed />} tone="borrowed" />
      </section>

      {credit.declined && credit.declined.length > 0 && (
        <section className="mt-4">
          <h4
            className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide"
            style={{ color: 'var(--ink-3)' }}
          >
            <IconDeclined />
            评估过但没采用
            <span className="ya-eyebrow">{credit.declined.length}</span>
          </h4>
          <ItemList items={credit.declined} icon={<IconDeclined />} tone="declined" />
        </section>
      )}
    </article>
  )
}

// ---------- Page ----------

type Filter = Usage | 'all'

export default function References() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  // brand.ts declares REPO_URL as the empty-string literal, which makes the
  // truthy branch below narrow to `never`. Widen it once so this keeps compiling
  // both while the constant is empty and after the repo URL gets filled in.
  const repoUrl: string = REPO_URL

  const groups = useMemo(
    () =>
      USAGE_ORDER.map((usage) => ({ usage, credits: CREDITS.filter((c) => c.usage === usage) })).filter(
        (g) => g.credits.length > 0,
      ),
    [],
  )

  const licenseTally = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of CREDITS) m.set(c.license, (m.get(c.license) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [])

  // copyleft 检测与 scripts/sources/report.ts 的口径一致：如果上游列表里出现
  // GPL / SSPL 一类许可证，正向陈述「全部宽松」就不成立了，改成点名提示。
  const copyleftCredits = useMemo(
    () => CREDITS.filter((c) => /GPL|SSPL|BUSL|MPL/.test(c.license)),
    [],
  )

  // 主题库的账：按许可证（自研放最后）与按来源（套数降序）。
  const themeLicenseTally = useMemo(() => {
    const rows = tallyByLicense(THEMES)
    return [...rows.filter((r) => r.license !== ORIGINAL_LICENSE), ...rows.filter((r) => r.license === ORIGINAL_LICENSE)]
  }, [])
  const sourceRows = useMemo(
    () =>
      [...tallyThemeSources(THEMES)]
        .sort((a, b) => b.count - a.count)
        .map((s) => ({ ...s, label: s.kind === 'original' ? '本项目自研' : s.project })),
    [],
  )

  const visible = groups.filter((g) => filter === 'all' || g.usage === filter)

  // Chips come from the groups that have entries, not from USAGE_ORDER: a usage
  // whose items have all landed would otherwise render a chip stuck at 0 that
  // filters the list down to nothing.
  const filters: Filter[] = ['all', ...groups.map((g) => g.usage)]

  return (
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-2.5 px-3 sm:gap-3 sm:px-4">
        <button
          onClick={() => navigate('/')}
          className="ya-btn ya-btn-secondary ya-btn-sm !h-8 shrink-0"
        >
          <IconBack />
          <span>回到编辑器</span>
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <YoruMark height={15} />
          <span
            className="truncate text-[15px] font-bold tracking-wide"
            style={{ color: 'var(--ink-1)' }}
          >
            致谢
          </span>
          <span className="ya-eyebrow hidden sm:inline">
            {APP_NAME} · {APP_BYLINE}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-5 sm:px-4 sm:py-6">
        <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          这个工具的能力有一大部分是站在别人的开源工作上长出来的。下面按「我们到底拿了多少」分组，
          每一条都写清具体是哪个文件的哪套机制，以及——同样重要——我们评估过但主动放弃的部分和放弃的理由。
        </p>

        {/* 许可核实结论 */}
        <section className="ya-well mb-4 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--primary-600)' }}>
              <IconScale />
            </span>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ink-1)' }}>
              许可证核实
            </h2>
            <span className="ya-eyebrow">2026-10-07 逐个打开 LICENSE 文件核对</span>
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.75]" style={{ color: 'var(--ink-2)' }}>
            {CREDITS.length} 个上游项目全部是宽松许可：
            {licenseTally.map(([lic, n], i) => (
              <span key={lic}>
                {i > 0 && '、'}
                <strong style={{ color: 'var(--ink-1)', fontFamily: 'var(--font-mono)' }}>{lic}</strong>
                {' ×'}
                {n}
              </span>
            ))}
            。
            {copyleftCredits.length === 0
              ? '没有 GPL / AGPL / SSPL 一类 copyleft，也没有任何项目缺失 LICENSE 文件——所以这些上游对本项目自己选开源许可证不构成传染性约束。'
              : `注意：存在 copyleft 上游（${copyleftCredits.map((c) => c.name).join('、')}），整体许可证选择以它们为准。`}
          </p>
          <ul className="mt-3 space-y-2 text-[12px] leading-[1.7]" style={{ color: 'var(--ink-3)' }}>
            {CREDITS.filter((c) => c.licenseNote).map((c) => (
              <li key={c.name} className="flex gap-2">
                <span className="ya-dot mt-[6px] shrink-0" style={{ background: 'var(--warning-500)' }} />
                <span>
                  <strong style={{ color: 'var(--ink-2)' }}>{c.name}</strong>：{c.licenseNote}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-[1.7]" style={{ color: 'var(--ink-4)' }}>
            每份 LICENSE 的逐字副本、上游 commit、md5 和明细在仓库的{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>LICENSES/</code> 目录，
            说明文件是 <code style={{ fontFamily: 'var(--font-mono)' }}>LICENSES/NOTICE.md</code>。
          </p>
        </section>

        {/* 主题库来源：模板库里的每一套主题的来路与许可账 */}
        <section className="ya-well mb-4 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--primary-600)' }}>
              <IconLayers />
            </span>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ink-1)' }}>
              主题库来源
            </h2>
            <span className="ya-eyebrow">模板库 {THEMES.length} 套 · 逐来源</span>
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.75]" style={{ color: 'var(--ink-2)' }}>
            模板库的 {THEMES.length} 套主题按上游许可证分组：{' '}
            {themeLicenseTally.map((r, i) => (
              <span key={r.license}>
                {i > 0 && ' · '}
                <strong style={{ color: 'var(--ink-1)', fontFamily: 'var(--font-mono)' }}>
                  {licenseLabel(r.license)}
                </strong>{' '}
                {r.count}
              </span>
            ))}
            。每套主题的卡片上点「来源」可看到它的原项目、原作者与 lineage；许可证原文留存在仓库{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>LICENSES/</code>，逐来源审计见{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>THEME-SOURCES.md</code>。
          </p>
          <ul className="mt-3 space-y-2">
            {sourceRows.map((s) => (
              <li
                key={s.project}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-xl px-3 py-2 text-[12px]"
                style={{ background: 'var(--bg-tint)' }}
              >
                {s.repo ? (
                  <a
                    href={s.repo}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-semibold underline decoration-dotted underline-offset-2"
                    style={{ color: 'var(--primary-600)' }}
                  >
                    {s.label}
                  </a>
                ) : (
                  <span className="font-semibold" style={{ color: 'var(--ink-1)' }}>{s.label}</span>
                )}
                <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>{s.count} 套</span>
                <span className="text-[11px]" style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                  {s.licenses.map((l) => `${licenseLabel(l.license)} ×${l.count}`).join(' · ')}
                </span>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--ink-4)' }}>{s.author}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-[1.7]" style={{ color: 'var(--ink-4)' }}>
            这份账与 README、THEME-SOURCES.md 的数字同源（`src/lib/theme-sources.ts` + 主题 catalog），
            由 <code style={{ fontFamily: 'var(--font-mono)' }}>npm run verify:sources</code> 在构建前机器校验。
          </p>
        </section>

        {/* 我们自己的许可声明 */}
        <section className="ya-well mb-5 p-4 sm:p-5">
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ink-1)' }}>
            本项目自己的许可
          </h2>
          {repoUrl ? (
            <p className="mt-2 text-[12.5px] leading-[1.75]" style={{ color: 'var(--ink-2)' }}>
              「{APP_NAME} {APP_BYLINE}」的源码仓库在{' '}
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-1 underline-offset-2"
                style={{ color: 'var(--primary-600)' }}
              >
                {repoUrl.replace(/^https?:\/\//, '')}
              </a>
              ，仓库根目录的 LICENSE 是本项目自己的许可条款；本页列出的上游许可各自独立，
              副本收在 <code style={{ fontFamily: 'var(--font-mono)' }}>LICENSES/</code>。
            </p>
          ) : (
            <p className="mt-2 text-[12.5px] leading-[1.75]" style={{ color: 'var(--ink-3)' }}>
              开源仓库地址还没填。等{' '}
              <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
                src/lib/brand.ts
              </code>{' '}
              里的 <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>REPO_URL</code>{' '}
              填上之后，这里会自动换成仓库链接，并指向仓库根目录那份属于本项目自己的 LICENSE。
              在那之前，上游归属以本页和{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>LICENSES/NOTICE.md</code> 为准。
            </p>
          )}
        </section>

        {/* 分组筛选 */}
        <div
          className="ya-well mb-5 flex flex-wrap gap-2 p-2.5"
          role="group"
          aria-label="按使用性质筛选"
        >
          {filters.map((f) => {
            const on = filter === f
            const count = f === 'all' ? CREDITS.length : CREDITS.filter((c) => c.usage === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={on}
                className={`ya-btn ya-btn-sm ${on ? 'ya-selected' : 'ya-btn-ghost'}`}
                style={on ? { color: 'var(--ink-1)' } : undefined}
              >
                {f === 'all' ? '全部' : USAGE_LABEL[f]}
                <span className="tabular-nums" style={{ color: 'var(--ink-4)' }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {visible.map((g) => (
          <section key={g.usage} className="mb-7">
            <div className="mb-2.5 flex items-center gap-2.5 px-0.5">
              <span className="text-[13px] font-bold tracking-wide" style={{ color: 'var(--ink-1)' }}>
                {USAGE_LABEL[g.usage]}
              </span>
              <span className="ya-eyebrow">{g.credits.length} 个项目</span>
              <span className="h-px flex-1" style={{ background: 'var(--line-2)' }} />
            </div>
            <p className="mb-3 px-0.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
              {USAGE_HINT[g.usage]}
            </p>
            <div className="grid gap-4">
              {g.credits.map((c) => (
                <CreditCard key={c.repo} credit={c} />
              ))}
            </div>
          </section>
        ))}

        <p className="mt-2 text-center text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          发现归属写错、漏了某个上游，或者某条其实已经落地了——开个 issue 告诉我们，改数据只要动{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>src/lib/credits.ts</code> 一个文件。
        </p>
      </main>
    </div>
  )
}
