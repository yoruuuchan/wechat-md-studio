/**
 * Per-IP burst limits, applied in the app rather than at the edge.
 *
 * Cloudflare's free plan allows exactly one rate limiting rule per zone, and
 * this zone already spends it elsewhere — see scripts/cf-open-public.sh. The
 * daily quota in anon-quota.ts bounds how much one visitor can store, but not
 * how fast they can hammer the endpoint; this is the other half. The same
 * sliding-window primitive also backs the login door (checkLoginAttempt), where
 * the point is not storage but not letting one address sit there guessing the
 * access key.
 *
 * Deliberately in-memory: it is best-effort, resets on restart, and is not
 * shared between instances. That is enough to stop a flood, and it costs a
 * self-hosted deployment nothing.
 */
import { env } from './env'

const WINDOW_MS = 60 * 1000
/** Past this many tracked IPs, sweep the ones whose window has expired. */
const SWEEP_AT = 5000

const hits = new Map<string, number[]>()
const days = new Map<string, { day: string; count: number }>()
const loginHits = new Map<string, number[]>()

export interface BurstVerdict {
  ok: boolean
  message?: string
}

/** Pure so the window arithmetic can be tested without touching the shared map. */
export function allowBurst(
  store: Map<string, number[]>,
  key: string,
  now: number,
  limit: number,
  windowMs = WINDOW_MS,
): boolean {
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    store.set(key, recent)
    return false
  }
  recent.push(now)
  store.set(key, recent)

  if (store.size > SWEEP_AT) {
    for (const [k, times] of store) {
      const live = times.filter((t) => now - t < windowMs)
      if (live.length === 0) store.delete(k)
      else store.set(k, live)
    }
  }
  return true
}

/**
 * Pure like allowBurst: `day` is injected so a date roll can be tested.
 *
 * The per-IP ceiling per UTC day. The visitor quota is keyed on a cookie an
 * attacker can delete, so without this one IP could rotate cookies and drip
 * uploads all day; the global byte cap still bounds the damage either way.
 */
export function allowIpDaily(
  store: Map<string, { day: string; count: number }>,
  key: string,
  day: string,
  limit = env.anonIpDailyImages,
): boolean {
  const bucket = store.get(key)
  if (!bucket || bucket.day !== day) {
    store.set(key, { day, count: 1 })
  } else if (bucket.count >= limit) {
    return false
  } else {
    bucket.count += 1
  }

  if (store.size > SWEEP_AT) {
    for (const [k, b] of store) if (b.day !== day) store.delete(k)
  }
  return true
}

export function checkBurst(ip: string): BurstVerdict {
  if (!allowBurst(hits, ip, Date.now(), env.anonBurstPerMinute)) {
    return { ok: false, message: `上传太频繁了，每分钟最多 ${env.anonBurstPerMinute} 张，稍等一下再试` }
  }
  return { ok: true }
}

export function checkIpDaily(ip: string): BurstVerdict {
  if (!allowIpDaily(days, ip, new Date().toISOString().slice(0, 10))) {
    return { ok: false, message: `这个地址今天传得够多了（每日最多 ${env.anonIpDailyImages} 张），明天再来` }
  }
  return { ok: true }
}

/**
 * The login door. Every attempt counts, right or wrong: the access key is long
 * and random, so the goal here is not incremental lockout arithmetic but a hard
 * per-address ceiling on how fast anyone can push on `/api/trpc` at all.
 * The owner logging in on a new device stays far below the default.
 */
export function checkLoginAttempt(ip: string): BurstVerdict {
  if (!allowBurst(loginHits, ip, Date.now(), env.authLoginPerMinute)) {
    return { ok: false, message: `尝试太频繁了，每分钟最多 ${env.authLoginPerMinute} 次，等一分钟再来` }
  }
  return { ok: true }
}

/**
 * The address the request really came from. The app only listens on loopback and
 * is reached through the Cloudflare Tunnel, so CF-Connecting-IP is set by the
 * edge and cannot be forged by the client; the fallbacks are for local runs and
 * self-hosted deployments without Cloudflare in front.
 *
 * `'unattributed'` is what a request carrying none of those headers gets — the
 * server's own acceptance scripts, for one. Every such caller shares that single
 * bucket, which is why a burst of host-side logins can spend the login ceiling
 * for all of them at once. The label is what a deny line prints, so it says what
 * happened instead of `unknown`, which reads like a bug.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unattributed'
  )
}
