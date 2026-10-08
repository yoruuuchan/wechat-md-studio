/**
 * One structured line per refused upload.
 *
 * The anonymous door is open on purpose, so refusals are the only early signal
 * that someone is pushing on it: a quiet month and a month of steady rejections
 * look identical in the access log. These lines are what the morning report
 * greps for; keep the format `key=value` and the prefix stable.
 */
export function denyLog(reason: string, detail: Record<string, string | number | undefined> = {}) {
  const kv = Object.entries(detail)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.warn(`[upload-deny] ${reason}${kv ? ' ' + kv : ''}`)
}
