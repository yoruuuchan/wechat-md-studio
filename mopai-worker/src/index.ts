/**
 * mopai-images — R2 image host for Reed.
 *
 *   GET    /img/<key>            public read (no secret; the key is the capability)
 *   PUT    /api/upload?key=<key> write, requires X-Admin-Key
 *   DELETE /api/upload?key=<key> delete, requires X-Admin-Key
 *
 * The R2 bucket is never exposed directly: this worker owns the binding, so the
 * VPS holds no S3 credentials at all.
 */

interface Env {
  BUCKET: R2Bucket
  IMG_ADMIN_KEY: string
}

const MAX_BYTES = 20 * 1024 * 1024
const IMMUTABLE = 'public, max-age=31536000, immutable'

/** Constant-time compare so a wrong key leaks nothing through timing. */
function keysMatch(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function authed(request: Request, env: Env): boolean {
  const given = request.headers.get('X-Admin-Key')
  if (!given || !env.IMG_ADMIN_KEY) return false
  return keysMatch(given, env.IMG_ADMIN_KEY)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function keyFrom(url: URL): string {
  return (url.searchParams.get('key') || '').trim()
}

/** Keys are generated server-side; reject anything shaped like a traversal attempt. */
function validKey(key: string): boolean {
  return key.length > 0 && key.length <= 200 && !key.includes('..') && !key.startsWith('/')
}

async function handleRead(key: string, env: Env, request: Request): Promise<Response> {
  if (!validKey(key)) return json({ error: 'bad key' }, 400)

  const object = await env.BUCKET.get(key)
  if (!object) return json({ error: 'not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Cache-Control', IMMUTABLE)
  headers.set('Access-Control-Allow-Origin', '*')

  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(object.body, { headers })
}

async function handlePut(key: string, env: Env, request: Request): Promise<Response> {
  if (!validKey(key)) return json({ error: 'bad key' }, 400)

  const declared = Number(request.headers.get('Content-Length') || '0')
  if (declared > MAX_BYTES) return json({ error: 'too large' }, 413)

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) return json({ error: 'empty body' }, 400)
  if (body.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413)

  const contentType =
    request.headers.get('Content-Type') || 'application/octet-stream'

  await env.BUCKET.put(key, body, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE },
    customMetadata: { uploadedAt: new Date().toISOString() },
  })

  return json({ key, size: body.byteLength }, 200)
}

async function handleDelete(key: string, env: Env): Promise<Response> {
  if (!validKey(key)) return json({ error: 'bad key' }, 400)
  await env.BUCKET.delete(key)
  return json({ key, deleted: true }, 200)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path.startsWith('/img/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method not allowed' }, 405)
      }
      return handleRead(decodeURIComponent(path.slice('/img/'.length)), env, request)
    }

    if (path === '/api/upload') {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401)
      const key = keyFrom(url)
      if (request.method === 'PUT') return handlePut(key, env, request)
      if (request.method === 'DELETE') return handleDelete(key, env)
      return json({ error: 'method not allowed' }, 405)
    }

    return json({ error: 'not found' }, 404)
  },
}
