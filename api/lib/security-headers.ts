import type { Context, MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { env } from './env'

/**
 * Security response headers, applied in the app rather than at the edge, so
 * they hold for every deployment shape (the Cloudflare Tunnel today, anything
 * else later) and can be asserted in tests.
 *
 * The content policy below is written against what the editor actually does.
 * Each allowance is load-bearing; nothing here is a blanket 'unsafe-*' pass to
 * make a report go green.
 */

/**
 * Only ever sent over an HTTPS request. One year, no includeSubDomains (the
 * host has no subdomains of its own, and this header is the wrong place to
 * commit a sibling host to HTTPS) and no preload.
 */
const HSTS_VALUE = 'max-age=31536000'

/**
 * Extra image origins. `/api/img/<key>` answers with a 302 to the R2 worker and
 * a redirect target is re-checked against the policy, so the worker's origin
 * must be named here — and it differs per deployment, hence IMG_BASE_URL.
 *
 * `data:` and `blob:` are not decoration: the mermaid rasterizer loads an SVG
 * through a data: URL, and every crop / compress preview and paste fallback is
 * a blob: URL.
 */
function imageOrigins(): string[] {
  const origins = ["'self'", 'data:', 'blob:']
  if (env.imgBaseUrl) origins.push(new URL(env.imgBaseUrl).origin)
  return origins
}

/** Exported so the policy is asserted directly in security-headers.test.ts. */
export function contentSecurityPolicy() {
  return {
    defaultSrc: ["'self'"],
    // The bundle is served from this origin; there are no inline scripts in
    // index.html and no third-party scripts at runtime (MathJax and mermaid
    // are Vite chunks, not CDN tags).
    scriptSrc: ["'self'"],
    // 'unsafe-inline' is required and stays: CodeMirror injects <style> at
    // runtime, Radix positions its overlays with style attributes, and both the
    // article preview and the HTML copied into WeChat are inline-style HTML by
    // design. Without it the editor loses its styling, not just a warning line.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: imageOrigins(),
    // Self-hosted webfonts, no font CDN. `data:` is required and stays: Vite
    // inlines the few font subsets smaller than `assetsInlineLimit` (the empty
    // Latin-ext / Cyrillic slices of Zen Kaku Gothic New and the Noto Sans SC
    // slices) as `data:font/woff2;base64,…` straight into the stylesheet, and
    // the browser refuses to apply them without this. A font cannot execute
    // anything, and @font-face can only come from a stylesheet — the article
    // preview's inline styles cannot declare one — so this is not a hole a
    // crafted document can climb through.
    fontSrc: ["'self'", 'data:'],
    // The browser talks only to this origin (tRPC, /api/img redirects, assets).
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  }
}

/**
 * The text tool needs none of these. `clipboard-write=(self)` is written out
 * even though `self` is the default, so a later edit to this map cannot
 * silently drop the copy-to-WeChat button's permission.
 */
export const permissionsPolicy = {
  camera: [],
  displayCapture: [],
  geolocation: [],
  hid: [],
  microphone: [],
  midi: [],
  payment: [],
  serial: [],
  usb: [],
  clipboardWrite: ['self'],
}

function isHttpsRequest(c: Context): boolean {
  // Behind the Cloudflare Tunnel the request reaches this process over plain
  // HTTP with `X-Forwarded-Proto: https` set by cloudflared; the URL check is
  // for a direct TLS deployment. HSTS over plain HTTP is ignored by browsers,
  // and a forged header can therefore do no harm.
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  return proto === 'https' || new URL(c.req.url).protocol === 'https:'
}

export function securityHeaders(): MiddlewareHandler {
  const base = secureHeaders({
    // Production only: in development the HTML comes from Vite's dev server
    // (inline HMR scripts, ws:// sockets), which this middleware never sees —
    // its only job in dev would be to break nothing, so it is left off.
    contentSecurityPolicy: env.isProduction ? contentSecurityPolicy() : undefined,
    // Set conditionally below instead of here: this middleware is shared by
    // plain-HTTP local runs and the HTTPS deployment.
    strictTransportSecurity: false,
    referrerPolicy: 'strict-origin-when-cross-origin',
    xFrameOptions: 'DENY',
    permissionsPolicy,
  })

  return async (c, next) => {
    await base(c, next)
    if (env.isProduction && isHttpsRequest(c)) {
      c.header('Strict-Transport-Security', HSTS_VALUE)
    }
  }
}
