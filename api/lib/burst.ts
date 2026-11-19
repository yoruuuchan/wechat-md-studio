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
import { ipBucket } from './client-ip'
import { mb } from './anon-quota'

const WINDOW_MS = 60 * 1000
/** Past this many tracked IPs, sweep the ones whose window has expired. */
const SWEEP_AT = 5000

const hits = new Map<string, number[]>()
const days = new Map<string, { day: string; count: number }>()
const dailyBytes = new Map<string, { day: string; bytes: number }>()
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

/**
 * Volume per bucket per UTC day.
 *
 * The image count on its own was not a ceiling. Every anonymous upload is
 * allowed to be `20 MiB`, so `100` of them is two gigabytes against a pool that
 * holds `1.5` — one address could empty it. Counting bytes instead makes filling
 * that pool take many source networks rather than one.
 *
 * Like its neighbours this is best-effort and in memory: it resets on restart
 * and is not shared between instances. It is a cost knob, not an accounting
 * system.
 */
export function allowIpDailyBytes(
  store: Map<string, { day: string; bytes: number }>,
  key: string,
  day: string,
  incomingBytes: number,
  limit = env.anonIpDailyBytes,
): boolean {
  const current = store.get(key)
  const used = current && current.day === day ? current.bytes : 0
  if (used + incomingBytes > limit) return false
  store.set(key, { day, bytes: used + incomingBytes })

  if (store.size > SWEEP_AT) {
    for (const [k, b] of store) if (b.day !== day) store.delete(k)
  }
  return true
}

export function checkBurst(ip: string): BurstVerdict {
  if (!allowBurst(hits, ipBucket(ip), Date.now(), env.anonBurstPerMinute)) {
    return { ok: false, message: `上传太频繁了，每分钟最多 ${env.anonBurstPerMinute} 张，稍等一下再试` }
  }
  return { ok: true }
}

export function checkIpDaily(ip: string, bytes: number): BurstVerdict {
  const day = new Date().toISOString().slice(0, 10)
  // Volume first: that is the ceiling a stranger actually reaches, and it must
  // not be spent incrementally by requests the image count was about to refuse.
  if (!allowIpDailyBytes(dailyBytes, ipBucket(ip), day, bytes)) {
    return { ok: false, message: `这个地址今天传的图太大了（每日最多 ${mb(env.anonIpDailyBytes)} MB），明天再来` }
  }
  if (!allowIpDaily(days, ipBucket(ip), new Date().toISOString().slice(0, 10))) {
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
  if (!allowBurst(loginHits, ipBucket(ip), Date.now(), env.authLoginPerMinute)) {
    return { ok: false, message: `尝试太频繁了，每分钟最多 ${env.authLoginPerMinute} 次，等一分钟再来` }
  }
  return { ok: true }
}
