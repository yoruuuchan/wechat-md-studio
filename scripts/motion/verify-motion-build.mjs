// Exercise both motion build paths without the real composer project.
// node scripts/motion/verify-motion-build.mjs
// Release (`--require`) must refuse a missing or invalid source with a non-zero
// exit before touching an earlier copy, and must copy a minimal fixture when the
// source is valid. The development path must still be able to omit /motion/.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packScript = path.join(scriptDir, 'pack-motion.mjs')
const distScript = path.join(scriptDir, 'verify-motion-dist.mjs')
const fixtureSite = path.join(scriptDir, 'fixtures', 'min-site')
const tempRoots = []
let checks = 0
let failures = 0

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reed-motion-build-'))
  tempRoots.push(root)
  return root
}

function baseEnv(cwd) {
  const env = { ...process.env }
  delete env.REED_MOTION_SITE
  // Keep the default source lookup from finding a repository above the temp cwd.
  if (cwd) env.GIT_CEILING_DIRECTORIES = cwd
  return env
}

function run(script, args, cwd, env = baseEnv(cwd)) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function check(name, ok, detail) {
  checks += 1
  if (ok) {
    console.log(`[verify-motion-build] PASS ${name}`)
    return
  }
  failures += 1
  console.error(`[verify-motion-build] FAIL ${name}`)
  if (detail) console.error(String(detail).trimEnd())
}

function seedPreviousCopy(cwd) {
  const previous = path.join(cwd, 'public', 'motion', 'previous.txt')
  fs.mkdirSync(path.dirname(previous), { recursive: true })
  fs.writeFileSync(previous, 'previous good build')
  return previous
}

// 1. Release build without any source: fails before Vite and keeps the old copy.
{
  const cwd = tempRoot()
  const previous = seedPreviousCopy(cwd)
  const result = run(packScript, ['--require'], cwd)
  check(
    'release fails without a source',
    result.status !== 0,
    `exit=${result.status} signal=${result.signal}\n${result.stderr}`,
  )
  check(
    'failure names the missing sources',
    /\brelease build requires\b/.test(result.stderr) &&
      /REED_MOTION_SITE/.test(result.stderr),
    result.stderr,
  )
  check(
    'failure keeps the previous public/motion copy',
    fs.existsSync(previous),
    `${previous} was removed`,
  )
}

// 2. Release build with REED_MOTION_SITE but no index.html: names the path.
{
  const cwd = tempRoot()
  const site = path.join(cwd, 'empty-site')
  fs.mkdirSync(site)
  const previous = seedPreviousCopy(cwd)
  const result = run(packScript, ['--require'], cwd, {
    ...baseEnv(cwd),
    REED_MOTION_SITE: site,
  })
  check(
    'release fails when REED_MOTION_SITE has no index.html',
    result.status !== 0,
    `exit=${result.status}\n${result.stderr}`,
  )
  check(
    'failure names the bad source',
    result.stderr.includes(site) && /no index\.html/.test(result.stderr),
    result.stderr,
  )
  check(
    'invalid source keeps the previous copy',
    fs.existsSync(previous),
    `${previous} was removed`,
  )
}

// 3. Release build with an inline-script page: rejected before the old copy is removed.
{
  const cwd = tempRoot()
  const site = path.join(cwd, 'inline-site')
  fs.mkdirSync(site)
  fs.writeFileSync(
    path.join(site, 'index.html'),
    '<!doctype html><html><body><script>document.title="x"</script></body></html>',
  )
  const previous = seedPreviousCopy(cwd)
  const result = run(packScript, ['--require'], cwd, {
    ...baseEnv(cwd),
    REED_MOTION_SITE: site,
  })
  check(
    'release rejects an inline-script page',
    result.status !== 0,
    `exit=${result.status}\n${result.stderr}`,
  )
  check(
    'inline-script failure keeps the previous copy',
    fs.existsSync(previous),
    `${previous} was removed`,
  )
}

// 4. Release build with the fixture: copies it and logs the file count.
{
  const cwd = tempRoot()
  const previous = seedPreviousCopy(cwd)
  const result = run(packScript, ['--require'], cwd, {
    ...baseEnv(cwd),
    REED_MOTION_SITE: fixtureSite,
  })
  const output = path.join(cwd, 'public', 'motion')
  check(
    'release copies a valid fixture',
    result.status === 0,
    `exit=${result.status}\n${result.stderr}`,
  )
  check(
    'release logs the file count',
    /\[pack-motion\] 3 files/.test(result.stdout),
    result.stdout,
  )
  check(
    'fixture page lands in public/motion',
    fs.existsSync(path.join(output, 'index.html')),
    output,
  )
  check(
    'fixture assets are copied recursively',
    fs.existsSync(path.join(output, 'assets', 'app.js')) &&
      fs.existsSync(path.join(output, 'assets', 'app.css')),
    output,
  )
  check(
    'successful release replaces the previous copy',
    !fs.existsSync(previous),
    `${previous} still exists`,
  )
}

// 5. Development build without a source: omits /motion/ and exits0.
{
  const cwd = tempRoot()
  seedPreviousCopy(cwd)
  const result = run(packScript, [], cwd)
  check(
    'development build can omit /motion/',
    result.status === 0,
    `exit=${result.status}\n${result.stderr}`,
  )
  check(
    'development omit mentions no composer build',
    /no composer build found/.test(result.stdout),
    result.stdout,
  )
  check(
    'development omit clears the old copy',
    !fs.existsSync(path.join(cwd, 'public', 'motion')),
    path.join(cwd, 'public', 'motion'),
  )
}

// 6. Development build with an explicitly broken source fails loudly instead of silently omitting.
{
  const cwd = tempRoot()
  const site = path.join(cwd, 'broken-site')
  fs.mkdirSync(site)
  const result = run(packScript, [], cwd, {
    ...baseEnv(cwd),
    REED_MOTION_SITE: site,
  })
  check(
    'development build rejects an explicitly broken source',
    result.status !== 0 && /no index\.html/.test(result.stderr),
    `exit=${result.status}\n${result.stderr}`,
  )
}

// 7. Post-build check: accepts a packed dist and rejects a missing page.
{
  const cwd = tempRoot()
  const page = path.join(cwd, 'dist', 'public', 'motion', 'index.html')
  fs.mkdirSync(path.dirname(page), { recursive: true })
  fs.writeFileSync(page, '<!doctype html><html><body>packed</body></html>')
  const ok = run(distScript, [], cwd)
  check(
    'post-build check accepts dist/public/motion/index.html',
    ok.status === 0 && /\[verify-motion-dist\] 1 files/.test(ok.stdout),
    `exit=${ok.status}\n${ok.stderr}\n${ok.stdout}`,
  )
  fs.rmSync(page)
  const missing = run(distScript, [], cwd)
  check(
    'post-build check rejects a missing page',
    missing.status !== 0 && /missing release page/.test(missing.stderr),
    `exit=${missing.status}\n${missing.stderr}`,
  )
}

for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true })

console.log(
  `[verify-motion-build] ${checks - failures}/${checks} checks passed`,
)
if (failures > 0) {
  console.error(`[verify-motion-build] ${failures} check(s) failed`)
  process.exit(1)
}
console.log('[verify-motion-build] ALL CHECKS PASSED')
