/**
 * One structured line per refused request.
 *
 * Both open doors are monitored this way: the anonymous upload face and the
 * login face. Refusals are the only early signal that someone is pushing on
 * them — a quiet month and a month of steady rejections look identical in the
 * access log. These lines are what the morning report greps for; keep the
 * format `key=value` and the prefixes (`[upload-deny]`, `[auth-deny]`) stable.
 */
function logDeny(prefix: string, reason: string, detail: Record<string, string | number | undefined>) {
  const kv = Object.entries(detail)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.warn(`${prefix} ${reason}${kv ? ' ' + kv : ''}`)
}

/** Refused image upload: burst / ip-daily / quota / bad-magic, both doors. */
export function denyLog(reason: string, detail: Record<string, string | number | undefined> = {}) {
  logDeny('[upload-deny]', reason, detail)
}

/** Refused login attempt: the per-IP burst on `/api/trpc` auth.login. */
export function authDenyLog(reason: string, detail: Record<string, string | number | undefined> = {}) {
  logDeny('[auth-deny]', reason, detail)
}
