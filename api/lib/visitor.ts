import { createHash, randomBytes } from 'node:crypto'
import * as cookie from 'cookie'
import { getSessionCookieOptions } from './cookies'

/**
 * Anonymous visitors get an identity too.
 *
 * Uploads no longer require a login, but "who owns this image" still has to be
 * answerable — otherwise every visitor would see (and could delete) everybody
 * else's pictures. A first-party cookie carries a random id; only its hash is
 * stored, so a leaked database cannot be used to reach someone else's images.
 */
const VISITOR_COOKIE = 'mopai_vid'
const VISITOR_MAX_AGE_S = 365 * 24 * 60 * 60

export function readVisitorId(headers: Headers): string | null {
  const raw = cookie.parse(headers.get('cookie') || '')[VISITOR_COOKIE]
  return raw && /^[0-9a-f]{32}$/.test(raw) ? raw : null
}

export function newVisitorId(): string {
  return randomBytes(16).toString('hex')
}

/** Stable owner key for an anonymous visitor. Never store the cookie value itself. */
export function visitorKey(id: string): string {
  return createHash('sha256').update(`mopai-visitor:${id}`).digest('hex').slice(0, 32)
}

export function visitorCookie(id: string, headers: Headers): string {
  const opts = getSessionCookieOptions(headers)
  return cookie.serialize(VISITOR_COOKIE, id, {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as 'lax' | 'none',
    secure: opts.secure,
    maxAge: VISITOR_MAX_AGE_S,
  })
}

/** The raw visitor id for one HTTP request, and whether this request minted it. */
export interface VisitorIdentity {
  id: string
  minted: boolean
}

/** Resolves the request's visitor identity, minting it at most once. */
export type VisitorResolver = () => Promise<VisitorIdentity>

/**
 * One visitor identity per HTTP request.
 *
 * tRPC resolves every procedure of a `?batch=1` call with the same context, and
 * the batch is one HTTP request carrying one cookie. Reading the request headers
 * inside each procedure (the old behaviour) made every first-contact upload in
 * a batch mint its own id and append its own `Set-Cookie`; the browser keeps
 * only the last cookie, so the other uploads belonged to identities nobody
 * held. Resolving lazily here, behind a memo, means the whole batch awaits the
 * same mint and the response carries one `Set-Cookie` that names all of it.
 * A request that already has a cookie is not touched: no Set-Cookie, same id.
 */
export function createVisitorResolver(headers: Headers, resHeaders: Headers): VisitorResolver {
  let resolved: Promise<VisitorIdentity> | undefined
  return () => {
    resolved ??= (async () => {
      const existing = readVisitorId(headers)
      if (existing) return { id: existing, minted: false }

      const id = newVisitorId()
      resHeaders.append('set-cookie', visitorCookie(id, headers))
      return { id, minted: true }
    })()
    return resolved
  }
}
