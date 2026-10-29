/**
 * Browser-side twin of `api/lib/doc-hash.ts`. Both sides must produce identical
 * strings because the server hands out lock tokens that this side compares
 * against local document state.
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

/** Current version token: the article name and Markdown are one document. */
export async function documentHash(name: string, content: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mopai-document-v2\0${name}\0${content}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex.slice(0, 16)
}
