import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'

// securityHeaders() freezes the policy in when it is called and env.ts is
// parsed once when it is imported, so NODE_ENV has to be production *before*
// the module graph loads. vitest isolates test files, and every variable this
// module needs is set here, so the test does not depend on a local `.env`.
process.env.NODE_ENV = 'production'
process.env.ACCESS_KEY = 'security-headers-test-access-key'
process.env.SESSION_SECRET = 'security-headers-test-session-secret-0123456789'
process.env.DATABASE_URL = 'file:./data/security-headers-test.db'
process.env.IMG_BASE_URL = 'https://img.example.test'
process.env.IMG_ADMIN_KEY = 'security-headers-test-admin-key'

const { contentSecurityPolicy, securityHeaders } = await import('./security-headers')

function testApp() {
  const app = new Hono()
  app.use('*', securityHeaders())
  app.get('/', (c) => c.html('<div>editor</div>'))
  app.get('/api/img/:key', (c) => c.redirect('https://img.example.test/img/x', 302))
  return app
}

describe('contentSecurityPolicy', () => {
  it("names the image worker's origin, taken from IMG_BASE_URL", () => {
    expect(contentSecurityPolicy().imgSrc).toContain('https://img.example.test')
  })

  it('allows the data:/blob: images the rasterizer and croppers create', () => {
    const imgSrc = contentSecurityPolicy().imgSrc
    expect(imgSrc).toContain('data:')
    expect(imgSrc).toContain('blob:')
  })

  it('keeps scripts locked to this origin, with no escape hatch', () => {
    const csp = JSON.stringify(contentSecurityPolicy())
    expect(csp).toContain("'self'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('unsafe-hashes')
  })

  it('allows the data: fonts Vite inlines into the stylesheet', () => {
    // The browser run caught this: the bundled CSS carries a handful of
    // `url(data:font/woff2;base64,…)` subsets, and `font-src 'self'` alone
    // makes every one of them fail to apply.
    expect(contentSecurityPolicy().fontSrc).toContain('data:')
  })
})

describe('the response headers', () => {
  it('sets the baseline on every response, redirects included', async () => {
    for (const res of [await testApp().request('/'), await testApp().request('/api/img/key-1')]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      const permissions = res.headers.get('permissions-policy') ?? ''
      expect(permissions).toContain('camera=()')
      expect(permissions).toContain('microphone=()')
      expect(permissions).toContain('geolocation=()')
      // The copy-to-WeChat button depends on this one staying allowed.
      expect(permissions).toContain('clipboard-write=(self)')
    }
  })

  it('sends the content policy in production', async () => {
    const csp = (await testApp().request('/')).headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    // Required by CodeMirror's runtime <style> and the inline-style article.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain('img-src')
    expect(csp).toContain('https://img.example.test')
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('sends HSTS only for a request that arrived over HTTPS', async () => {
    const plain = await testApp().request('/')
    expect(plain.headers.get('strict-transport-security')).toBeNull()

    // The way the Cloudflare Tunnel delivers a public HTTPS request.
    const tunnelled = await testApp().request('/', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(tunnelled.headers.get('strict-transport-security')).toBe('max-age=31536000')

    // And a direct TLS deployment, where the URL itself is https.
    const direct = await testApp().request('https://wechat.example.test/')
    expect(direct.headers.get('strict-transport-security')).toBe('max-age=31536000')
  })
})
