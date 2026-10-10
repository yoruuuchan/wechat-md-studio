import { Link, useNavigate } from 'react-router'
import { ContactEmail } from '@/components/ContactEmail'
import { YoruMark } from '@/components/YoruMark'
import { APP_NAME, APP_BYLINE } from '@/lib/brand'
import { THEMES } from '@/lib/themes'

/**
 * Acceptable-use / liability page. Route: /terms
 *
 * Everything asserted here is a property of the current implementation, not a
 * boilerplate promise: anonymous drafts never reach the server (src/lib/store.ts
 * + body-store.ts), anonymous uploads do (api/lib/storage.ts → R2 via mopai-worker),
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

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-1)' }}>{children}</code>
  )
}

export default function Terms() {
  const navigate = useNavigate()

  return (
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-2.5 px-3 sm:gap-3 sm:px-4">
        <button onClick={() => navigate('/')} className="ya-btn ya-btn-secondary ya-btn-sm !h-8 shrink-0">
          <IconBack />
          <span>回到编辑器</span>
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <YoruMark height={15} />
          <span className="truncate text-[15px] font-bold tracking-wide" style={{ color: 'var(--ink-1)' }}>
            使用规范
          </span>
          <span className="ya-eyebrow hidden sm:inline">
            {APP_NAME} · {APP_BYLINE}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-5 sm:px-4 sm:py-6">
        <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          这是一个把 Markdown 排成公众号正文的工具，不是内容平台。它不发布文章、不推荐内容、也不审阅任何稿件。
          下面把三件事说清楚：你的正文和图片各自存在哪里、什么不能传、以及看到问题时找谁删。
        </p>

        <Section icon={<IconDoc />} title="你的正文不经过本站" eyebrow="未登录时">
          <p>
            不登录就能排版，是因为稿件只存在<strong style={{ color: 'var(--ink-1)' }}>你自己浏览器</strong>的
            <Code>IndexedDB</Code> / <Code>localStorage</Code> 里。服务器收不到正文，也看不见你写了什么。
            登录只打开一样东西——云端草稿箱，那是站长自己的账号。
          </p>
          <p>
            所以本站不持有任何人的文章内容，也不参与它被发布到公众号之后发生的事情。你排出来的东西写了什么，
            责任在执笔和发布的人，不在这个编辑器。
          </p>
          <p style={{ color: 'var(--ink-3)' }}>
            反过来提醒一句：浏览器存储不是备份。清缓存、换设备、用无痕窗口都会把它一起清掉。
            要长期留住的稿子请导出 Markdown 自己存一份。
          </p>
        </Section>

        <Section icon={<IconImage />} title="图片是唯一的例外，也是最需要看清的一节" eyebrow="公开写入面">
          <p>
            上传图片同样不需要登录，所以这是本站唯一会替你保管内容的地方。它的行为是完全公开的，你要知道确切的边界：
          </p>
          <ul className="space-y-2">
            <Bullet>
              图片存在本站的对象存储里，通过 <Code>https://wechat.yoru-and-akari.dev/api/img/…</Code>{' '}
              <strong style={{ color: 'var(--ink-1)' }}>公网可读</strong>——拿到链接的人都能看到，不需要登录，也没有访问密码。
            </Bullet>
            <Bullet>
              本站<strong style={{ color: 'var(--ink-1)' }}>不做内容审核</strong>：没有人工审阅，也没有自动扫描。
              只校验文件头是不是真的图片（jpeg / png / gif / webp），不判断画面上是什么。
            </Bullet>
            <Bullet>
              额度是硬顶：每个 IP 每分钟 12 张、每个 UTC 日 100 张；全部匿名访客合计 1.5 GiB 封顶；
              匿名图片 14 天没被任何云端稿件引用就自动回收。
            </Bullet>
          </ul>
          <p>
            一句话：<strong style={{ color: 'var(--ink-1)' }}>不要上传任何你不愿意公开、或者你不拥有权利的图片。</strong>{' '}
            需要私密或长期有效的图片，请自己托管，再把地址填进正文——本工具不挑图片来源。
          </p>
        </Section>

        <Section icon={<IconStop />} title="禁止借由本站图床传播的内容" eyebrow="发现即删">
          <ul className="space-y-2">
            <Bullet>违反中华人民共和国法律或其他适用法域法律的内容。</Bullet>
            <Bullet>涉及未成年人的性、色情或剥削内容——这一类会被立刻删除，不做解释。</Bullet>
            <Bullet>侵犯他人著作权、商标、肖像、隐私或其他合法权益的内容。</Bullet>
            <Bullet>恶意程序、钓鱼页面、诈骗诱导素材。</Bullet>
            <Bullet>把本站图床当网盘或对外图片 CDN 批量灌图。</Bullet>
          </ul>
          <p style={{ color: 'var(--ink-3)' }}>
            本站没有账号体系，所以「封号」这种话写不了。能兑现的处置只有三种：删除文件、拒绝继续接收、
            以及在服务日志里留下这次拒收。
          </p>
        </Section>

        <Section icon={<IconMail />} title="投诉与删除" eyebrow="权利人请走这里">
          <p>
            如果你是权利人，或者你发现本站某个 <Code>/api/img/…</Code> 地址上挂着违法或侵权内容，
            写信到 <ContactEmail />，写清三样东西：
          </p>
          <ul className="space-y-2">
            <Bullet>具体地址（图片 URL，或足够定位到它的描述，比如上传的大致时间）。</Bullet>
            <Bullet>你是权利人、或受权利人委托的说明。</Bullet>
            <Bullet>你的联系方式。</Bullet>
          </ul>
          <p>
            这是一个人的业余项目，不承诺处理时限，但邮件会看。确认之后会删除对应文件并回信。
          </p>
        </Section>

        <Section title="责任边界">
          <ul className="space-y-2">
            <Bullet>
              你用本站排出的内容、以及它发布到公众号之后产生的后果，由执笔和发布的人自己负责。
            </Bullet>
            <Bullet>
              复制到公众号时，微信会自行转存图片；那一步之后文章就不再依赖本站的存储。反过来说，
              如果在微信转存完成前就发布、而本站的匿名图刚好被回收了，正文会裂图——这是使用风险，发布前自己核对。
            </Bullet>
            <Bullet>
              服务按「现状」提供，可能随时变更、限流或下线，不承诺可用性。软件本身无担保，
              见仓库根目录 LICENSE（AGPL-3.0-or-later）第 15 条。
            </Bullet>
            <Bullet>
              模板库的 {THEMES.length} 套主题各自的作者与许可证保留在{' '}
              <Link
                to="/references"
                className="underline decoration-1 underline-offset-2"
                style={{ color: 'var(--primary-600)' }}
              >
                致谢页
              </Link>{' '}
              和仓库的 <Code>LICENSES/</Code>；把某套主题用到你自己的项目里时，许可义务在你那边。
            </Bullet>
          </ul>
        </Section>

        <Section title="想要完全不同的责任边界" eyebrow="自托管">
          <p>
            本站源码全部开源（AGPL-3.0-or-later）。自己部署一份，存储桶、域名、额度和日志都在你自己手里，
            这一页的内容对你就不再适用了。部署步骤在仓库的 <Code>docs/configuration.md</Code> 和{' '}
            <Code>HANDOFF.md</Code>。
          </p>
        </Section>

        <p className="mt-2 text-center text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          本页截至 2026-10-09。有措辞不当或者和实现不符的地方，开个 issue 或写信到上面的邮箱，都会改。
        </p>
      </main>
    </div>
  )
}
