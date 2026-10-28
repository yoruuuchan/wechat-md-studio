import { env } from './env'

/**
 * Budget for uploads that arrive without a login.
 *
 * The image bucket is a shared 10 GB free tier, and an open upload endpoint is
 * the one place where a stranger can spend the owner's money and disk. Two
 * ceilings: a rolling 24 h allowance per visitor, and a hard total for every
 * anonymous upload ever kept. The owner's own session is not limited by either.
 *
 * This module only decides *whether* a request fits. Reading the usage and then
 * acting on it is not atomic, so the router never calls the check directly:
 * api/lib/anon-upload.ts repeats it inside the same SQLite transaction that
 * writes the reservation, which is what makes concurrent uploads stop at the
 * ceiling.
 */
export const ANON_OWNER_ID = 0

export const ANON_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AnonUsage {
  /** Uploads by this visitor in the last 24 h, including reserved but unfinished ones. */
  windowCount: number
  windowBytes: number
  /** Every anonymous upload still on record, all visitors, plus live reservations. */
  totalBytes: number
}

export interface AnonQuotaVerdict {
  ok: boolean
  message?: string
}

export function mb(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)))
}

/** Pure so the ceilings can be tested without a database. */
export function checkAnonQuota(usage: AnonUsage, incomingBytes: number): AnonQuotaVerdict {
  if (usage.totalBytes + incomingBytes > env.anonTotalBytes) {
    return {
      ok: false,
      message: `公共图床已经存满（上限 ${mb(env.anonTotalBytes)} MB），暂时不能再上传`,
    }
  }
  if (usage.windowCount + 1 > env.anonDailyImages) {
    return {
      ok: false,
      message: `24 小时内最多上传 ${env.anonDailyImages} 张图，额度用完了，明天再来`,
    }
  }
  if (usage.windowBytes + incomingBytes > env.anonDailyBytes) {
    return {
      ok: false,
      message: `24 小时内最多上传 ${mb(env.anonDailyBytes)} MB，额度用完了，明天再来`,
    }
  }
  return { ok: true }
}
