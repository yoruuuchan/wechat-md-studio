/**
 * Browser-side twin of `api/lib/doc-hash.ts`: first 16 hex chars of sha256
 * over the UTF-8 bytes of the Markdown. Both sides must produce the same
 * string for the same text — that is the whole point, since the server hands
 * out hashes that this side has to be able to compare against content it holds
 * locally (the login merge does exactly that for cache entries written before
 * `baseHash` existed).
 *
 * Web Crypto only exists in secure contexts; the app is served over https (and
 * over `localhost`/`127.0.0.1` in development, which browsers treat as secure),
 * and the module also runs under vitest's Node environment, where
 * `globalThis.crypto.subtle` is provided.
 */
export async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex.slice(0, 16)
}
