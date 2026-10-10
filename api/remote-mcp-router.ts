import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { REMOTE_MCP_MAX_CHARS } from '@contracts/remote-mcp'
import { env } from './lib/env'
import { allowBurst, clientIp } from './lib/burst'
import { readVisitorId, newVisitorId, visitorKey, visitorCookie } from './lib/visitor'
import {
  createVisitorConnection, readVisitorConnection, rotateVisitorToken,
  writeVisitorDoc, revokeVisitorConnection, RemoteMcpError,
} from './lib/remote-mcp'

const createHits = new Map<string, number[]>()
const localId = z.string().min(1).max(64)
const connectionId = z.string().min(1).max(64)
const body = z.string().max(REMOTE_MCP_MAX_CHARS)
const name = z.string().max(200)
const hash = z.string().regex(/^[0-9a-f]{16}$/)

export function publicOrigin(c: Context): string {
  return env.publicBaseUrl ? new URL(env.publicBaseUrl).origin : new URL(c.req.url).origin
}

/** Cookie management never accepts a cross-origin request. MCP has its own bearer door. */
export function hasAllowedOrigin(c: Context): boolean {
  const origin = c.req.header('origin')
  return !origin || origin === publicOrigin(c)
}

function visitor(c: Context, create = false): string | null {
  let id = readVisitorId(c.req.raw.headers)
  if (!id && create) {
    id = newVisitorId()
    c.header('Set-Cookie', visitorCookie(id, c.req.raw.headers))
  }
  return id ? visitorKey(id) : null
}

const router = new Hono()
router.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  if (!hasAllowedOrigin(c)) return c.json({ error: '不接受跨站授权请求' }, 403)
  await next()
})
router.onError((error, c) => {
  if (error instanceof RemoteMcpError) return c.json({ error: error.message }, error.status)
  console.error('[remote-mcp] request failed')
  return c.json({ error: '协作服务暂时不可用，本地稿件已保留' }, 500)
})

router.post('/connections', async (c) => {
  const parsed = z.object({ localDocId: localId, name, content: body }).strict()
    .safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: '稿件参数不正确，正文最多 200 万字符' }, 400)
  if (!allowBurst(createHits, clientIp(c.req.raw.headers), Date.now(), 10)) {
    return c.json({ error: '创建太频繁，请一分钟后再试' }, 429)
  }
  const owner = visitor(c, true)!
  const result = createVisitorConnection(owner, {
    ...parsed.data, name: parsed.data.name.trim() || '未命名稿件',
  })
  return c.json({ ...result.snapshot, token: result.token, endpoint: `${publicOrigin(c)}/api/mcp` }, result.token ? 201 : 200)
})

router.get('/connections/:localDocId', (c) => {
  const id = localId.safeParse(c.req.param('localDocId'))
  if (!id.success) return c.json({ error: '稿件标识不正确' }, 400)
  const owner = visitor(c)
  return c.json(owner ? readVisitorConnection(owner, id.data) : null)
})

router.put('/connections/:localDocId', async (c) => {
  const parsed = z.object({ connectionId, name, content: body, baseHash: hash }).strict()
    .safeParse(await c.req.json().catch(() => null))
  const id = localId.safeParse(c.req.param('localDocId'))
  if (!parsed.success || !id.success) return c.json({ error: '写入需要正文和上次读取的 baseHash' }, 400)
  const owner = visitor(c)
  if (!owner) return c.json({ error: '游客身份已失效，本地稿件已保留' }, 410)
  const result = writeVisitorDoc(owner, id.data, parsed.data.connectionId, parsed.data)
  return c.json(result, result.ok ? 200 : 409)
})

router.post('/connections/:localDocId/rotate', async (c) => {
  const parsed = z.object({ connectionId }).strict().safeParse(await c.req.json().catch(() => null))
  const id = localId.safeParse(c.req.param('localDocId'))
  if (!parsed.success || !id.success) return c.json({ error: '连接参数不正确' }, 400)
  const owner = visitor(c)
  if (!owner) return c.json({ error: '游客身份已失效' }, 410)
  if (!allowBurst(createHits, clientIp(c.req.raw.headers), Date.now(), 10)) {
    return c.json({ error: '操作太频繁，请一分钟后再试' }, 429)
  }
  return c.json({ ...rotateVisitorToken(owner, id.data, parsed.data.connectionId), endpoint: `${publicOrigin(c)}/api/mcp` })
})

router.delete('/connections/:localDocId', async (c) => {
  const parsed = z.object({ connectionId }).strict().safeParse(await c.req.json().catch(() => null))
  const id = localId.safeParse(c.req.param('localDocId'))
  if (!parsed.success || !id.success) return c.json({ error: '连接参数不正确' }, 400)
  const owner = visitor(c)
  const doc = owner ? revokeVisitorConnection(owner, id.data, parsed.data.connectionId) : null
  return c.json({ ok: true, doc })
})

export { router as remoteMcpRouter }
