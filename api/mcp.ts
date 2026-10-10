import type { Context } from 'hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { REMOTE_MCP_MAX_CHARS } from '@contracts/remote-mcp'
import { writingSkill } from './lib/writing-skill'
import { findTokenLease, readTokenConnection, writeTokenDoc, RemoteMcpError } from './lib/remote-mcp'
import { hasAllowedOrigin, publicOrigin } from './remote-mcp-router'

function jsonResult(value: object, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: { ...value },
    isError,
  }
}

function withGrant(token: string, action: () => ReturnType<typeof jsonResult> | { content: { type: 'text'; text: string }[] }) {
  try {
    readTokenConnection(token)
    return action()
  } catch (error) {
    if (error instanceof RemoteMcpError) return jsonResult({ ok: false, error: error.message }, true)
    console.error('[remote-mcp] tool failed')
    return jsonResult({ ok: false, error: '协作服务暂时不可用，请稍后重试' }, true)
  }
}

function createServer(token: string, origin: string): McpServer {
  const server = new McpServer(
    { name: 'wechat-md-studio', title: '芦苇 Reed', version: '1.0.0' },
    { instructions: '只协作已授权的当前稿件。先 read_writing_skill，再 read_current_document；更新必须回传读取时的 hash 作为 baseHash。冲突时重新读稿并合并，不能盲重试。' },
  )
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  server.registerTool('read_writing_skill', {
    title: '读取芦苇写作规则', description: '读取公众号 Markdown 方言、图片引用和写作模板的完整 Skill。',
    inputSchema: {}, annotations: readOnly,
  }, () => withGrant(token, () => ({ content: [{ type: 'text', text: writingSkill }] })))
  server.registerTool('read_current_document', {
    title: '读取当前稿件', description: '读取这条连接唯一获授权的稿件，返回 Markdown、名称和并发 hash。',
    inputSchema: {}, annotations: readOnly,
  }, () => withGrant(token, () => jsonResult(readTokenConnection(token))))
  server.registerTool('update_current_document', {
    title: '更新当前稿件', description: '用完整 Markdown 更新当前稿件。必须传读取时的 hash 作为 baseHash；冲突返回当前版本且不会覆盖。',
    inputSchema: {
      content: z.string().max(REMOTE_MCP_MAX_CHARS).describe('完整 Markdown 正文，允许空稿'),
      baseHash: z.string().regex(/^[0-9a-f]{16}$/).describe('read_current_document 返回的 doc.hash'),
      name: z.string().min(1).max(200).optional().describe('可选的新稿件名称'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, (input) => withGrant(token, () => {
    const result = writeTokenDoc(token, input)
    return jsonResult(result, !result.ok)
  }))
  server.registerResource('writing-skill', `${origin}/skill.md`, {
    title: '芦苇写作 Skill', mimeType: 'text/markdown',
  }, (uri) => {
    readTokenConnection(token)
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: writingSkill }] }
  })
  server.registerResource('current-document', 'mopai://document/current', {
    title: '当前授权稿件', mimeType: 'application/json',
  }, (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(readTokenConnection(token)) }] }))
  return server
}

/** Stateless HTTP transport per request; each request rechecks the persisted lease. */
export async function handleMcpRequest(c: Context): Promise<Response> {
  c.header('Cache-Control', 'no-store')
  if (!hasAllowedOrigin(c)) return c.json({ error: '不接受此 Origin' }, 403)
  const token = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization')?.trim() ?? '')?.[1] ?? ''
  if (!findTokenLease(token)) {
    c.header('WWW-Authenticate', 'Bearer realm="wechat-md-studio", error="invalid_token"')
    return c.json({ error: '需要当前稿件的有效授权令牌；可能已撤销或到期' }, 401)
  }
  // This server does not keep SSE streams or MCP sessions. GET/DELETE are
  // optional in Streamable HTTP; returning 405 also keeps unused streams closed.
  if (c.req.method !== 'POST') {
    c.header('Allow', 'POST')
    return c.json({ error: '此 MCP 使用无状态 Streamable HTTP POST' }, 405)
  }
  const server = createServer(token, publicOrigin(c))
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
    maxRequestBodySize: 16 * 1024 * 1024,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(c.req.raw)
  } finally {
    await server.close()
  }
}
