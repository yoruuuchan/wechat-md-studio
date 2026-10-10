import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RemoteMcpCredentials } from '@contracts/remote-mcp'
import { parseMarkdown } from '../src/lib/parse'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-mcp-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`
process.env.PUBLIC_BASE_URL = ''
const { default: app } = await import('./boot')
const { getSqlite } = await import('./queries/connection')
const { contentHash } = await import('./lib/doc-hash')
const { cleanupExpiredConnections, mcpTokenHash } = await import('./lib/remote-mcp')
const { env } = await import('./lib/env')

type RpcResult = {
  result: {
    serverInfo: { name: string }
    tools: { name: string }[]
    content: { text: string }[]
    isError?: boolean
    structuredContent?: { doc: RemoteMcpCredentials['doc']; error?: string }
  }
}
const rpcJson = async (response: Response) => await response.json() as RpcResult

let id = 0
async function browser(url: string, method = 'GET', body?: object, cookie?: string, origin?: string) {
  return app.request(`http://localhost${url}`, {
    method, headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}),
      'cf-connecting-ip': `test-${++id}`,
    }, body: body ? JSON.stringify(body) : undefined,
  })
}
async function create(localDocId = `doc-${++id}`, content = '原稿', cookie?: string) {
  const response = await browser('/api/remote-mcp/connections', 'POST', { localDocId, name: '稿件', content }, cookie)
  expect(response.status).toBe(201)
  return { ...await response.json() as RemoteMcpCredentials, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie! }
}
async function rpc(token: string, method: string, params: object = {}) {
  return app.request('http://localhost/api/mcp', {
    method: 'POST', headers: {
      authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  })
}
async function call(token: string, name: string, args: object = {}) {
  const response = await rpc(token, 'tools/call', { name, arguments: args })
  expect(response.status).toBe(200)
  const result = (await rpcJson(response)).result
  return { ...result, value: result.structuredContent ?? (result.content?.[0]?.text?.startsWith('{') ? JSON.parse(result.content[0].text) : null) }
}

describe('writing Skill', () => {
  it('is public and embeds exactly the tracked Skill source', async () => {
    const response = await browser('/skill.md')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    const text = await response.text()
    expect(text).toBe(fs.readFileSync(path.resolve('skills/wechat-typesetter/SKILL.md'), 'utf8').replace(/\r\n/g, '\n'))
    expect(text.indexOf('先写稿')).toBeLessThan(text.indexOf('Remote MCP 修改'))
    const template = text.split('### 完整写稿模板')[1].match(/```md\n([\s\S]*?)\n```/)![1]
    const parsed = parseMarkdown(template)
    expect(parsed.meta.titles).toEqual(['文章主标题', '另一种表达角度'])
    expect(parsed.blocks.map((b) => b.type)).toEqual(expect.arrayContaining(['heading', 'subheading', 'image', 'quoteBox', 'center', 'signature']))
  })
})

describe('anonymous single-document MCP', () => {
  it('creates a visitor cookie and persists only the token hash', async () => {
    const connection = await create()
    expect(connection.cookie).toMatch(/^mopai_vid=/)
    expect(connection.endpoint).toBe('http://localhost/api/mcp')
    const lease = getSqlite().prepare('SELECT * FROM remote_mcp_connections WHERE id = ?').get(connection.connection.id)!
    expect(lease.tokenHash).toBe(mcpTokenHash(connection.token))
    expect(Object.values(lease)).not.toContain(connection.token)
    expect(connection.doc.hash).toBe(contentHash('原稿'))
  })
  it('supports initialize, tool discovery, Skill and document reads', async () => {
    const connection = await create()
    const initialized = await rpc(connection.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(initialized.status).toBe(200)
    expect((await rpcJson(initialized)).result.serverInfo.name).toBe('wechat-md-studio')
    const listed = await rpc(connection.token, 'tools/list')
    expect((await rpcJson(listed)).result.tools.map((t) => t.name)).toEqual(['read_writing_skill', 'read_current_document', 'update_current_document'])
    const skill = await rpc(connection.token, 'tools/call', { name: 'read_writing_skill', arguments: {} })
    expect((await rpcJson(skill)).result.content[0].text).toContain('完整写稿模板')
    expect((await call(connection.token, 'read_current_document')).value.doc.content).toBe('原稿')
    expect((await rpc(connection.token, 'resources/list')).status).toBe(200)
  })
  it('protects concurrent MCP and browser writes with the same hash contract', async () => {
    const c = await create()
    const update = await call(c.token, 'update_current_document', { content: 'AI 改稿', baseHash: c.doc.hash })
    expect(update.isError).toBe(false)
    const stale = await browser(`/api/remote-mcp/connections/${c.connection.localDocId}`, 'PUT', {
      connectionId: c.connection.id, name: '稿件', content: '本机改稿', baseHash: c.doc.hash,
    }, c.cookie)
    expect(stale.status).toBe(409)
    expect((await stale.json() as { current: { content: string } }).current.content).toBe('AI 改稿')
    const staleAi = await call(c.token, 'update_current_document', { content: '旧版本重试', baseHash: c.doc.hash })
    expect(staleAi.isError).toBe(true)
    expect(staleAi.value.error).toBe('conflict')
    expect((await call(c.token, 'read_current_document')).value.doc.content).toBe('AI 改稿')
    const saved = await browser(`/api/remote-mcp/connections/${c.connection.localDocId}`, 'PUT', {
      connectionId: c.connection.id, name: '稿件', content: '本机精修', baseHash: update.value.doc.hash,
    }, c.cookie)
    expect(saved.status).toBe(200)
    expect((await call(c.token, 'read_current_document')).value.doc.content).toBe('本机精修')
  })
  it('isolates visitors with colliding local ids and different documents', async () => {
    const a = await create('same-local-id', '游客 A')
    const b = await create('same-local-id', '游客 B')
    const a2 = await create('second-local-id', 'A 第二篇', a.cookie)
    expect(a.connection.id).not.toBe(b.connection.id)
    expect((await call(a.token, 'read_current_document')).value.doc.content).toBe('游客 A')
    expect((await call(b.token, 'read_current_document')).value.doc.content).toBe('游客 B')
    const wrong = await browser('/api/remote-mcp/connections/same-local-id', 'PUT', {
      connectionId: a.connection.id, name: '偷改', content: '覆盖', baseHash: a.doc.hash,
    }, b.cookie)
    expect(wrong.status).toBe(410)
    const wrongRevoke = await browser('/api/remote-mcp/connections/same-local-id', 'DELETE', { connectionId: a.connection.id }, b.cookie)
    expect((await wrongRevoke.json() as { doc: null }).doc).toBeNull()
    expect((await rpc(a.token, 'tools/list')).status).toBe(200)
    const wrongRotate = await browser('/api/remote-mcp/connections/same-local-id/rotate', 'POST', { connectionId: a.connection.id }, b.cookie)
    expect(wrongRotate.status).toBe(410)
    await call(a.token, 'update_current_document', { content: 'A 自己改', baseHash: a.doc.hash, docId: a2.connection.id })
    expect((await call(a2.token, 'read_current_document')).value.doc.content).toBe('A 第二篇')
    expect((await call(b.token, 'read_current_document')).value.doc.content).toBe('游客 B')
  })
  it('keeps single-document credentials and owner Agent credentials separate', async () => {
    const c = await create()
    const { docId } = getSqlite().prepare('SELECT docId FROM remote_mcp_connections WHERE id = ?').get(c.connection.id) as { docId: string }
    const previous = process.env.AGENT_TOKENS
    const ownerToken = `mopai_${'x'.repeat(43)}`
    process.env.AGENT_TOKENS = `owner-test:${ownerToken}`
    try {
      const ownerRead = await app.request(`http://localhost/api/agent/docs/${docId}`, { headers: { authorization: `Bearer ${ownerToken}` } })
      expect(ownerRead.status).toBe(404)
      const wrongDoor = await app.request(`http://localhost/api/agent/docs/${docId}`, { headers: { authorization: `Bearer ${c.token}` } })
      expect(wrongDoor.status).toBe(401)
      expect((await rpc(ownerToken, 'tools/list')).status).toBe(401)
    } finally {
      if (previous === undefined) delete process.env.AGENT_TOKENS
      else process.env.AGENT_TOKENS = previous
    }
  })
  it('does not overwrite the AI copy when creation is retried', async () => {
    const c = await create()
    await call(c.token, 'update_current_document', { content: 'AI 已经改过', baseHash: c.doc.hash })
    const again = await browser('/api/remote-mcp/connections', 'POST', {
      localDocId: c.connection.localDocId, name: '旧标题', content: '旧本机版本',
    }, c.cookie)
    expect(again.status).toBe(200)
    const result = await again.json() as { token: null; doc: { content: string } }
    expect(result.token).toBeNull()
    expect(result.doc.content).toBe('AI 已经改过')
  })
  it('invalidates old tokens on rotation and immediately revokes access', async () => {
    const c = await create()
    const rotated = await browser(`/api/remote-mcp/connections/${c.connection.localDocId}/rotate`, 'POST', { connectionId: c.connection.id }, c.cookie)
    const next = await rotated.json() as RemoteMcpCredentials
    expect((await rpc(c.token, 'tools/list')).status).toBe(401)
    expect((await rpc(next.token, 'tools/list')).status).toBe(200)
    expect(next.connection.expiresAt).toBe(c.connection.expiresAt)
    const revoked = await browser(`/api/remote-mcp/connections/${c.connection.localDocId}`, 'DELETE', { connectionId: c.connection.id }, c.cookie)
    expect(revoked.status).toBe(200)
    expect((await rpc(next.token, 'tools/list')).status).toBe(401)
    expect((getSqlite().prepare('SELECT count(*) AS n FROM docs WHERE ownerId = 0 AND id IN (SELECT docId FROM remote_mcp_connections WHERE id = ?)').get(c.connection.id)!).n).toBe(0)
  })
  it('expires before cleanup and removes the body while retaining owner documents', async () => {
    const c = await create()
    const { docId } = getSqlite().prepare('SELECT docId FROM remote_mcp_connections WHERE id = ?').get(c.connection.id) as { docId: string }
    getSqlite().prepare('UPDATE remote_mcp_connections SET expiresAt = ? WHERE id = ?').run(Date.now() - 1, c.connection.id)
    expect((await rpc(c.token, 'tools/list')).status).toBe(401)
    const status = await browser(`/api/remote-mcp/connections/${c.connection.localDocId}`, 'GET', undefined, c.cookie)
    expect(await status.json()).toBeNull()
    cleanupExpiredConnections()
    expect(getSqlite().prepare('SELECT id FROM docs WHERE id = ?').get(docId)).toBeUndefined()
  })
  it('rejects missing bases, oversized requests and untrusted Origins', async () => {
    const c = await create()
    const missing = await browser(`/api/remote-mcp/connections/${c.connection.localDocId}`, 'PUT', { connectionId: c.connection.id, name: '稿件', content: '盲写' }, c.cookie)
    expect(missing.status).toBe(400)
    expect((await rpc('', 'tools/list')).status).toBe(401)
    const crossSite = await browser('/api/remote-mcp/connections', 'POST', { localDocId: 'bad', name: 'x', content: 'x' }, c.cookie, 'https://untrusted.example')
    expect(crossSite.status).toBe(403)
    const crossMcp = await app.request('http://localhost/api/mcp', {
      method: 'POST', headers: { origin: 'https://untrusted.example', authorization: `Bearer ${c.token}` },
    })
    expect(crossMcp.status).toBe(403)
    const large = await browser('/api/remote-mcp/connections', 'POST', { localDocId: 'big', name: 'x', content: 'x'.repeat(2_000_001) })
    expect(large.status).toBe(400)
    expect((await call(c.token, 'update_current_document', { content: 'missing' })).isError).toBe(true)
  })
  it('enforces the body byte cap without changing the stored draft', async () => {
    const c = await create()
    const savedLimit = env.remoteMcpTotalBytes
    env.remoteMcpTotalBytes = 0
    try {
      const update = await call(c.token, 'update_current_document', { content: '越额', baseHash: c.doc.hash })
      expect(update.isError).toBe(true)
      expect((await call(c.token, 'read_current_document')).value.doc.content).toBe('原稿')
    } finally { env.remoteMcpTotalBytes = savedLimit }
  })
  it('keeps simultaneous writers from both winning a stale base', async () => {
    const c = await create()
    const responses = await Promise.all(['writer-one', 'writer-two'].map((content) => call(c.token, 'update_current_document', { content, baseHash: c.doc.hash })))
    expect(responses.filter((r) => !r.isError)).toHaveLength(1)
    expect(responses.filter((r) => r.value.error === 'conflict')).toHaveLength(1)
  })
})
