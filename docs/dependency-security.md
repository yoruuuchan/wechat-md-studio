# Dependency security updates

The application and `mopai-worker/` have independent npm manifests and lockfiles.
Run `npm ci`, `npm audit --json`, and `npm audit --omit=dev --json` in each directory;
updating the application does not update the Worker toolchain.

## Security version floors

The manifests require the patched Markdown parser, schema validator and build
tools. The lockfile also records patched transitive packages used by Mermaid,
MathJax, the MCP SDK and development tooling. Existing exact pins for MathJax and
the AI/MCP SDKs are preserved where they have no applicable npm audit finding;
upgrading the MathJax v3 integration to v4 is a separate API and font migration.

- [Markdown-it's multi-line reference definition issue](https://github.com/advisories/GHSA-gfr2-rv44-r23c)
  is fixed in 15.0.3. Untrusted Markdown can reach the browser preview parser.
  The API metadata reader does not render the whole Markdown document.
- [Zod's oversized collection issue](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
  is fixed in 4.6.6. Existing API array length limits remain in place; validation
  must reject oversized input without accumulating an issue for every element.
- [DOMPurify's shadow-root template issue](https://github.com/advisories/GHSA-cg2g-xh64-v4q7)
  is fixed in 3.4.17. Its reported critical exploit requires non-default template
  and DOM-output settings plus a later template evaluator. The application uses
  Mermaid's string-based sanitization path; this advisory is not evidence that
  the application has reproduced XSS.
- [The Hono static-path decoding issue](https://github.com/advisories/GHSA-rmxm-3fg6-px4f)
  is fixed in the Node adapter's 2.1.3 release. The application serves public
  static files, but both its production adapter and development bridge use the
  patched 2.x adapter. The [v2 release notes](https://github.com/honojs/node-server/releases/tag/v2.0.0)
  state that its public API is preserved; real development and production HTTP
  flows are still required when changing this adapter.

## Scoped development overrides

Two parent packages retain older transitive dependency ranges:

1. `@hono/vite-dev-server` uses the application's `@hono/node-server` version.
   This keeps `getRequestListener` on the same patched implementation used by
   production, instead of retaining a separate affected 1.x adapter.
2. `@esbuild-kit/core-utils` uses esbuild 0.25.12 or a compatible 0.25 patch.
   Drizzle Kit still depends on this deprecated loader. Its implementation calls
   `transform` and `transformSync`; it does not start the development `serve`
   endpoint implicated by [the esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
   The override updates that dependency without downgrading Drizzle Kit.

`src/lib/dependency-security.test.ts` runs the malicious Markdown/Zod cases in
separate processes with time and heap limits, and exercises both loader transform
APIs. For loader upgrades, also generate a migration with a temporary typed config
and output directory; include a TypeScript enum so Node's native strip-types
cannot mask a broken compiler path. Do not point that check at production data.

Validate application check/lint/tests/themes/sources/build, a production browser
flow containing formulas and diagrams, actual development-page/API requests, and
the Worker's local build/runtime. Keep complete before/after audit evidence with
the release review; a deprecation warning is not itself an audit vulnerability.
