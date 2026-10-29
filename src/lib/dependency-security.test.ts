import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/** A vulnerable dependency must not be able to hang or exhaust the test runner. */
function isolated<T>(source: string, heapMb = 128): T {
  const child = spawnSync(process.execPath, [
    `--max-old-space-size=${heapMb}`,
    '--input-type=module',
    '--eval',
    source,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 6000,
    windowsHide: true,
    maxBuffer: 65536,
  })
  expect(child.error, child.error?.message).toBeUndefined()
  expect(child.status, child.stderr.slice(-1000)).toBe(0)
  return JSON.parse(child.stdout.trim()) as T
}

describe('dependency security regressions', () => {
  it.each(['title', 'label'])('bounds an unclosed multi-line Markdown reference %s', (kind) => {
    const result = isolated<{ outputLength: number }>(`
      import MarkdownIt from 'markdown-it';
      const kind = ${JSON.stringify(kind)};
      const input = (kind === 'title' ? '[a]: /u "' : '[') + 'x\\n'.repeat(200000);
      const output = new MarkdownIt({ html: false, linkify: false }).render(input);
      console.log(JSON.stringify({ outputLength: output.length }));
    `)
    // The incomplete definition is ordinary text, not silently dropped input.
    expect(result.outputLength).toBeGreaterThan(300000)
  }, 10000)

  it('rejects an oversized constrained array before accumulating element errors', () => {
    const result = isolated<{ success: boolean; issueCount: number; code: string }>(`
      import { z } from 'zod';
      const result = z.array(z.string()).max(1).safeParse(Array(250000).fill(null));
      console.log(JSON.stringify({
        success: result.success,
        issueCount: result.success ? 0 : result.error.issues.length,
        code: result.success ? '' : result.error.issues[0].code,
      }));
    `, 96)
    expect(result).toEqual({ success: false, issueCount: 1, code: 'too_big' })
  }, 10000)

  it('keeps the legacy TypeScript loader transforms compatible with its scoped esbuild update', () => {
    const result = isolated<{ sync: number; async: number }>(`
      import { createRequire } from 'node:module';
      import { runInNewContext } from 'node:vm';
      const require = createRequire(import.meta.url);
      const loader = require('@esbuild-kit/core-utils');
      const source = 'export const answer: number = 42;';
      const sync = loader.transformSync(source, 'dependency-override.ts');
      const cjs = { exports: {} };
      runInNewContext(sync.code, { module: cjs, exports: cjs.exports });
      const async = await loader.transform(source, 'dependency-override.ts');
      const esm = await import('data:text/javascript;base64,' + Buffer.from(async.code).toString('base64'));
      console.log(JSON.stringify({ sync: cjs.exports.answer, async: esm.answer }));
    `)
    expect(result).toEqual({ sync: 42, async: 42 })
  }, 10000)
})
