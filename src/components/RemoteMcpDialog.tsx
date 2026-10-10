import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { useRemoteMcp } from '@/hooks/useRemoteMcp'
import type { DocRecord } from '@/lib/store'
import { copyAiText } from './AiWritingDialog'

const PHASE = { off: '未授权', synced: '已同步', saving: '同步中', error: '同步待重试', conflict: '两边都有改动' }

export default function RemoteMcpDialog({ open, onOpenChange, doc, remote }: {
  open: boolean; onOpenChange: (open: boolean) => void; doc?: DocRecord | null; remote: ReturnType<typeof useRemoteMcp>
}) {
  const credentials = remote.credentials
  const endpoint = credentials?.endpoint ?? `${window.location.origin}/api/mcp`
  const config = credentials ? JSON.stringify({ mcpServers: {
    'mopai-current': { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${credentials.token}` } },
  } }, null, 2) : ''
  const connected = Boolean(doc?.remoteMcp)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !bg-surface-base sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI 直接编辑当前稿件</DialogTitle>
          <DialogDescription className="text-ink-3">高级功能 · Remote MCP · 仅授权「{doc?.name || '未命名稿件'}」</DialogDescription>
        </DialogHeader>
        <p className="text-[13px] leading-relaxed text-ink-2">
          创建后，这篇稿件会有一份临时服务端副本，供持有连接令牌的 AI 读取和修改。
          浏览器保持打开时会自动同步；本机也一直保存完整稿件。撤销或到期会删除临时副本，之后继续在本机编辑。
        </p>
        {!connected ? (
          <div className="ya-well space-y-3 p-4">
            <p className="text-[12px] text-ink-3">把连接信息填进自己的 MCP 客户端，即可协作这一篇稿件。</p>
            <button data-mcp-create disabled={!doc || doc.contentLoaded === false || remote.busy} onClick={() => void remote.create()} className="ya-btn ya-btn-primary">
              {remote.busy ? '创建中…' : '授权当前稿件并创建连接'}
            </button>
          </div>
        ) : (
          <div className="ya-well space-y-3 p-4 text-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span data-mcp-status className="text-ink-2">{PHASE[remote.phase]}</span>
              {remote.snapshot && <span className="text-ink-3">到期：{new Date(remote.snapshot.connection.expiresAt).toLocaleString('zh-CN', { hour12: false })}</span>}
            </div>
            <p className="text-ink-3">传输方式：Streamable HTTP</p>
            <label className="block space-y-1 text-ink-3">
              <span>MCP 地址</span>
              <input aria-label="MCP 地址" readOnly value={endpoint} className="ya-input w-full !text-[12px]" />
            </label>
            {credentials ? (
              <>
                <label className="block space-y-1 text-ink-3">
                  <span>Authorization 请求头 · 仅交给你信任的客户端</span>
                  <input aria-label="MCP Authorization" type="password" readOnly value={`Bearer ${credentials.token}`} className="ya-input w-full !text-[12px]" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button data-mcp-copy="config" onClick={() => void copyAiText(config, 'MCP 配置')} className="ya-btn ya-btn-primary">复制 MCP 配置</button>
                  <button data-mcp-copy="url" onClick={() => void copyAiText(endpoint, 'MCP 地址')} className="ya-btn ya-btn-secondary">复制地址</button>
                  <button data-mcp-copy="auth" onClick={() => void copyAiText(`Bearer ${credentials.token}`, 'Authorization')} className="ya-btn ya-btn-secondary">复制 Authorization</button>
                </div>
              </>
            ) : (
              <p className="text-ink-3">令牌仅在创建时显示。重新生成接入信息后，原客户端的令牌立即失效。</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button data-mcp-rotate disabled={remote.busy} onClick={() => void remote.rotate()} className="ya-btn ya-btn-secondary">重新生成接入信息</button>
              <button data-mcp-revoke disabled={remote.busy} onClick={() => void remote.revoke()} className="ya-link-btn danger">撤销授权</button>
            </div>
          </div>
        )}
        {remote.conflict && (
          <div data-mcp-conflict className="ya-well space-y-3 p-4">
            <p className="text-[13px] font-medium text-warn-700">你和 AI 都改过这篇稿件，自动同步已暂停。</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-[12px] text-ink-3">本机版本
                <textarea aria-label="MCP 本机冲突版本" readOnly value={doc?.content.slice(0, 20_000) || ''} className="ya-input !h-40 w-full !py-3 !text-[12px]" />
              </label>
              <label className="space-y-1 text-[12px] text-ink-3">AI 协作版本
                <textarea aria-label="MCP 远端冲突版本" readOnly value={remote.conflict.content.slice(0, 20_000)} className="ya-input !h-40 w-full !py-3 !text-[12px]" />
              </label>
            </div>
            <p className="text-[11px] text-ink-3">长稿预览显示前 2 万字符；选择保留时会使用完整正文。</p>
            <div className="flex flex-wrap gap-2">
              <button data-mcp-resolve="both" disabled={remote.busy} onClick={() => void remote.resolve('both')} className="ya-btn ya-btn-primary">两边都留</button>
              <button data-mcp-resolve="local" disabled={remote.busy} onClick={() => void remote.resolve('local')} className="ya-btn ya-btn-secondary">保留本机版本</button>
              <button data-mcp-resolve="remote" disabled={remote.busy} onClick={() => void remote.resolve('remote')} className="ya-btn ya-btn-secondary">采用 AI 版本</button>
            </div>
          </div>
        )}
        {remote.error && <p role="alert" className="text-[12px] text-warn-700">{remote.error}</p>}
        <p className="text-[12px] leading-relaxed text-ink-3">
          Kimi Code、Cherry Studio、Qoder、OpenCode、Claude Code 等客户端可按各自方式填写地址与请求头；JSON 配置格式以客户端为准。
          连接提供写作 Skill、读稿和改稿三个工具。ChatGPT 自定义连接如要求 OAuth，需要额外适配。
        </p>
      </DialogContent>
    </Dialog>
  )
}
