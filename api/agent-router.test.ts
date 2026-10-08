import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Both the database path and the token list are read at import/first-use time,
// so they have to be in place before the router module loads.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-agent-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'agent.db')}`
process.env.AGENT_TOKENS = 'claude-code:mopai_write_tok,reviewer:mopai_read_tok:read'
process.env.IMG_BASE_URL = 'https://img.test'
process.env.IMG_ADMIN_KEY = 'test-admin-key'

// The image worker is a separate deployment; the upload route is exercised
// against a stub so these tests stay offline. `ref`/`url` shaping — the part
// that is actually easy to get wrong — is still asserted for real.
vi.mock('./lib/storage', () => {
  class StorageError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'StorageError'
      this.code = code
    }
  }
  return {
    StorageError,
    storage: {
      uploadFile: async (opts: { fileContent: Uint8Array; fileName: string }) => ({
        key: `key-${opts.fileContent.byteLength}`,
        fileName: opts.fileName,
        size: opts.fileContent.byteLength,
      }),
    },
  }
})

const { agentRouter } = await import('./agent-router')
const { docsRouter } = await import('./docs-router')
const { OWNER } = await import('./auth-types')
const { getDb } = await import('./queries/connection')
const { files } = await import('../db/schema')

const WRITE = { authorization: 'Bearer mopai_write_tok' }
const READ = { authorization: 'Bearer mopai_read_tok' }

/** The browser's own door, used to check the two agree about the same rows. */
const browser = docsRouter.createCaller({
  req: new Request('http://test/'),
  resHeaders: new Headers(),
  user: OWNER,
})

function call(
  method: string,
  url: string,
  init: { headers?: Record<string, string>; body?: unknown } = {},
) {
  return agentRouter.request(url, {
    method,
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function push(content: string, extra: Record<string, unknown> = {}) {
  const res = await call('POST', '/docs', { headers: WRITE, body: { content, ...extra } })
  expect(res.status).toBe(201)
  return json<{ id: string; name: string; savedAt: number; source: string; hash: string; editorUrl: string }>(res)
}

describe('the agent door', () => {
  it('refuses anonymous callers and unknown tokens, with different wording', async () => {
    const anon = await call('GET', '/whoami')
    expect(anon.status).toBe(401)
    expect((await json<{ error: string }>(anon)).error).toContain('需要令牌')

    const bad = await call('GET', '/whoami', { headers: { authorization: 'Bearer mopai_nope' } })
    expect(bad.status).toBe(401)
    expect((await json<{ error: string }>(bad)).error).toContain('无效')
  })

  it('answers whoami with the token name, its scopes and the public origin', async () => {
    const res = await call('GET', '/whoami', { headers: WRITE })
    expect(res.status).toBe(200)
    const body = await json<{ agent: string; scopes: string[]; publicBaseUrl: string }>(res)
    expect(body.agent).toBe('claude-code')
    expect(body.scopes).toEqual(['read', 'write'])
    // Derived from the request when PUBLIC_BASE_URL is unset.
    expect(body.publicBaseUrl).toBe('http://localhost')
  })

  it('keeps a read-only token out of the write routes', async () => {
    const res = await call('POST', '/docs', { headers: READ, body: { content: '# x' } })
    expect(res.status).toBe(403)
    const body = await json<{ error: string; hint: string }>(res)
    expect(body.error).toContain('reviewer')
    expect(body.hint).toContain('write')
    // …while its reads still work.
    expect((await call('GET', '/docs', { headers: READ })).status).toBe(200)
  })

  it('creates an article that is saved from birth, so browser edits sync back', async () => {
    const created = await push('---\ntitles:\n  - 深秋的排期\n---\n\n正文一段。')
    expect(created.name).toBe('深秋的排期')
    expect(created.source).toBe('agent:claude-code')
    expect(created.savedAt).toBeGreaterThan(0)
    expect(created.editorUrl).toBe(`http://localhost/?doc=${created.id}`)

    // The invariant that matters: savedAt must not be null, or useDocs.flush
    // skips the article forever and the owner's edits vanish on reload.
    const drafts = await browser.drafts()
    expect(drafts.map((d) => d.id)).toContain(created.id)
    expect(drafts.find((d) => d.id === created.id)?.savedAt).not.toBeNull()
  })

  it('falls back to the first heading, then to a placeholder, when there is no title', async () => {
    expect((await push('# 只有一个大标题\n\n正文')).name).toBe('只有一个大标题')
    expect((await push('没有任何标题的正文')).name).toBe('未命名稿件')
    expect((await push('#  ignored\n\n正文', { name: '显式给的名字' })).name).toBe('显式给的名字')
  })

  it('does not mistake a heading inside a code fence for the title', async () => {
    const created = await push('```md\n# 代码块里的假标题\n```\n\n## 真正的标题\n\n正文')
    expect(created.name).toBe('真正的标题')
  })

  it('lists articles without their content, but with a length', async () => {
    const content = '---\ntitles:\n  - 列表测试\n---\n\n一二三四五'
    const created = await push(content)
    const res = await call('GET', `/docs?q=${encodeURIComponent('列表测试')}`, { headers: READ })
    const body = await json<{ items: Record<string, unknown>[]; total: number }>(res)
    const row = body.items.find((i) => i.id === created.id)
    expect(row).toBeDefined()
    expect(row?.content).toBeUndefined()
    expect(row?.chars).toBe(content.length)
    expect(row?.source).toBe('agent:claude-code')
    expect(body.total).toBeGreaterThan(0)
  })

  it('filters to the drafts box on saved=1 and searches content as well as names', async () => {
    await browser.saveToDrafts({ id: 'browser-only', name: '网页里写的', content: '甲', updatedAt: Date.now() })
    // importLocal is the real path that leaves savedAt NULL: a working copy that
    // has never been put into 草稿箱.
    await browser.importLocal({
      docs: [{ id: 'working-copy', name: '未归档的工作稿', content: '临时内容', updatedAt: Date.now() }],
    })

    const all = await json<{ items: { id: string }[] }>(await call('GET', '/docs', { headers: READ }))
    expect(all.items.map((i) => i.id)).toContain('working-copy')

    const saved = await json<{ items: { id: string }[] }>(
      await call('GET', '/docs?saved=1', { headers: READ }),
    )
    expect(saved.items.map((i) => i.id)).toContain('browser-only')
    expect(saved.items.map((i) => i.id)).not.toContain('working-copy')

    // `q` reaches the body, not just the name: the term appears nowhere in a title.
    const byBody = await json<{ items: { id: string }[] }>(
      await call('GET', `/docs?q=${encodeURIComponent('临时内容')}`, { headers: READ }),
    )
    expect(byBody.items.map((i) => i.id)).toEqual(['working-copy'])
  })

  it('reads one article back, and 404s on an id that is not there', async () => {
    const created = await push('---\ntitles:\n  - 读回测试\n---\n\n正文内容')
    const res = await call('GET', `/docs/${created.id}`, { headers: READ })
    const body = await json<{ id: string; content: string; createdAt: number; chars: number }>(res)
    expect(body.id).toBe(created.id)
    expect(body.content).toContain('正文内容')
    expect(body.chars).toBe(body.content.length)
    expect(body.createdAt).toBeGreaterThan(0)

    expect((await call('GET', '/docs/nope', { headers: READ })).status).toBe(404)
  })

  it('updates with a matching baseHash and rejects a stale one with the current text', async () => {
    const created = await push('初稿')
    const first = await json<{ content: string; hash: string }>(
      await call('GET', `/docs/${created.id}`, { headers: READ }),
    )
    expect(first.hash).toBe(created.hash)

    const ok = await call('PUT', `/docs/${created.id}`, {
      headers: WRITE,
      body: { content: '第二稿', baseHash: first.hash },
    })
    expect(ok.status).toBe(200)
    const okBody = await json<{ ok: true; hash: string }>(ok)
    expect(okBody.ok).toBe(true)
    expect(okBody.hash).not.toBe(first.hash)

    // Replay the stale hash: the owner (or another agent) moved on.
    const conflict = await call('PUT', `/docs/${created.id}`, {
      headers: WRITE,
      body: { content: '过期的改动', baseHash: first.hash },
    })
    expect(conflict.status).toBe(409)
    const body = await json<{ ok: false; error: string; current: { content: string; hash: string } }>(conflict)
    expect(body.error).toBe('conflict')
    expect(body.current.content).toBe('第二稿')

    // The hash in the 409 is already good for a retry.
    const retry = await call('PUT', `/docs/${created.id}`, {
      headers: WRITE,
      body: { content: '在最新内容上接着改', baseHash: body.current.hash },
    })
    expect(retry.status).toBe(200)

    // Pushing byte-identical text is not a conflict, it is a no-op.
    const read = await json<{ hash: string }>(await call('GET', `/docs/${created.id}`, { headers: READ }))
    const same = await call('PUT', `/docs/${created.id}`, {
      headers: WRITE,
      body: { content: '在最新内容上接着改', baseHash: read.hash },
    })
    expect(same.status).toBe(200)

    // Forcing is explicit: no baseHash means "overwrite whatever is there".
    const forced = await call('PUT', `/docs/${created.id}`, { headers: WRITE, body: { content: '强制覆盖' } })
    expect(forced.status).toBe(200)
    const after = await json<{ content: string }>(
      await call('GET', `/docs/${created.id}`, { headers: READ }),
    )
    expect(after.content).toBe('强制覆盖')
  })

  it('hands back the owner’s own edits, which is the whole point of the round trip', async () => {
    const created = await push('Agent 推的初稿')
    // The owner polishes it in the browser; the auto-save path writes it back.
    await browser.save({ id: created.id, name: '精修过的标题', content: '人工精修后的正文', updatedAt: Date.now() })
    const readBack = await json<{ content: string; name: string }>(
      await call('GET', `/docs/${created.id}`, { headers: READ }),
    )
    expect(readBack.content).toBe('人工精修后的正文')
    expect(readBack.name).toBe('精修过的标题')
  })

  it('cannot see, read or write an article the owner moved to the bin', async () => {
    const created = await push('要被删掉的稿子')
    await browser.remove({ id: created.id })

    expect((await call('GET', `/docs/${created.id}`, { headers: READ })).status).toBe(404)
    const listed = await json<{ items: { id: string }[] }>(await call('GET', '/docs', { headers: READ }))
    expect(listed.items.map((i) => i.id)).not.toContain(created.id)
    // An agent must not resurrect what was just deleted.
    expect((await call('PUT', `/docs/${created.id}`, { headers: WRITE, body: { content: '复活' } })).status).toBe(404)
  })

  it('rejects an empty body and a JSON body that is not JSON', async () => {
    expect((await call('POST', '/docs', { headers: WRITE, body: { content: '' } })).status).toBe(400)
    const res = await agentRouter.request('/docs', {
      method: 'POST',
      headers: { ...WRITE, 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect((await json<{ hint?: string }>(res)).hint).toContain('content')
  })

  it('uploads an image and returns the img: reference the Markdown needs', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR4nGP8//8/AzbAxIAHjEIQRQoAHbcCpV0v4G8AAAAASUVORK5CYII=',
      'base64',
    )
    const form = new FormData()
    form.append('file', new File([png], 'cover.png', { type: 'image/png' }))
    const res = await agentRouter.request('/images', { method: 'POST', headers: WRITE, body: form })
    expect(res.status).toBe(201)
    const body = await json<{ key: string; ref: string; url: string; size: number }>(res)
    expect(body.key).toBe(`key-${png.byteLength}`)
    // `img:<key>` is what goes in the Markdown; the url is only for humans.
    expect(body.ref).toBe(`img:key-${png.byteLength}`)
    expect(body.url).toBe(`http://localhost/api/img/key-${png.byteLength}`)
    expect(body.size).toBe(png.byteLength)

    const rows = await getDb().select().from(files)
    expect(rows.map((r) => r.key)).toContain(`key-${png.byteLength}`)
    expect(rows.find((r) => r.key === `key-${png.byteLength}`)?.name).toContain('agent/1/')
  })

  it('refuses bytes whose magic numbers contradict the declared type', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'cover.png', { type: 'image/png' }))
    const res = await agentRouter.request('/images', { method: 'POST', headers: WRITE, body: form })
    expect(res.status).toBe(400)
    expect((await json<{ error: string }>(res)).error).toContain('只认')
  })

  it('explains a missing file field instead of failing obscurely', async () => {
    const form = new FormData()
    form.append('notfile', 'x')
    const res = await agentRouter.request('/images', { method: 'POST', headers: WRITE, body: form })
    expect(res.status).toBe(400)
    expect((await json<{ hint: string }>(res)).hint).toContain('file')
  })

  it('lists the live themes, so no client has to hardcode them', async () => {
    const res = await call('GET', '/themes', { headers: READ })
    expect(res.status).toBe(200)
    const body = await json<{ id: string; name: string; category: string; desc: string }[]>(res)
    expect(body.length).toBeGreaterThanOrEqual(9)
    expect(body[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      category: expect.any(String),
      desc: expect.any(String),
    })
    expect(body.map((t) => t.id)).toContain('golden')
  })
})
