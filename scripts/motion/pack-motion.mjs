// Put the motion composer's built page under `public/motion/` before Vite
// copies `public/`, so the site serves it at /motion/.
// node scripts/motion/pack-motion.mjs # development build (optional)
// node scripts/motion/pack-motion.mjs --require # release build (required)
//
// The composer is built in its own project, outside this repository; only its
// finished static page is copied here, and the copy is not committed. Where it
// comes from, first match wins:
//   1. REED_MOTION_SITE: the folder that holds the built index.html
//   2. `wechat-motion-lab/out/site` beside this repository's main checkout
// A development build may go without /motion/: this step then removes any old
// copy and vite.config.ts leaves the top bar's entry a placeholder. A release
// build (`npm run build:release`, which passes --require) must not: a missing or
// invalid page stops the build here with a non-zero exit, before Vite runs and
// before an earlier usable copy under public/motion/ is removed.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const flags = process.argv.slice(2)
const unknown = flags.filter((flag) => flag !== '--require')
if (unknown.length > 0) {
  console.error(
    `usage: node scripts/motion/pack-motion.mjs [--require] (unknown argument: ${unknown.join(' ')})`,
  )
  process.exit(2)
}
const required = flags.includes('--require')

const outputRoot = path.resolve('public/motion')

function defaultSource() {
  // A worktree lives anywhere; the main checkout is where the shared .git is.
  const git = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  )
  if (git.status !== 0) return null
  return path.resolve(
    git.stdout.trim(),
    '..',
    '..',
    'wechat-motion-lab',
    'out',
    'site',
  )
}

const envSource = process.env.REED_MOTION_SITE
  ? path.resolve(process.env.REED_MOTION_SITE)
  : null
const fallbackSource = envSource ? null : defaultSource()
const source = envSource ?? fallbackSource
const sourceLabel = envSource
  ? `REED_MOTION_SITE (${envSource})`
  : fallbackSource
    ? `main checkout (${fallbackSource})`
    : null

function sourceCandidates() {
  const env = envSource
    ? `REED_MOTION_SITE=${envSource}`
    : 'REED_MOTION_SITE (unset)'
  const fallback = fallbackSource
    ? `main checkout: ${fallbackSource}`
    : 'main checkout: <main checkout>/../wechat-motion-lab/out/site (main checkout not found, or git unavailable)'
  return `${env}; ${fallback}`
}

function fail(message) {
  console.error(`[pack-motion] ${message}`)
  console.error(
    `[pack-motion] looked for the composer's built page in: ${sourceCandidates()}`,
  )
  process.exit(1)
}

if (!source) {
  if (required)
    fail(
      "release build requires the motion composer's built page, but no source was found",
    )
  fs.rmSync(outputRoot, { recursive: true, force: true })
  console.log(
    '[pack-motion] no composer build found; this build has no /motion/',
  )
  process.exit(0)
}

if (!fs.existsSync(path.join(source, 'index.html'))) {
  if (required)
    fail(
      `release build requires the motion composer's built page, but ${sourceLabel} has no index.html`,
    )
  if (envSource) {
    // A source the developer pointed at explicitly must be valid even in a
    // development build; do not quietly fall back to a page-less build.
    fail(`${sourceLabel} has no index.html`)
  }
  fs.rmSync(outputRoot, { recursive: true, force: true })
  console.log(
    '[pack-motion] no composer build found; this build has no /motion/',
  )
  process.exit(0)
}

const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
// The site's content policy runs no inline script: a page that has one would
// load and then do nothing, so refuse it here instead. Validate before removing
// the previous copy so a failed build never destroys the last usable output.
if (/<script(?![^>]* src=)/i.test(html))
  fail(`${sourceLabel} has an inline script; build the composer's site variant`)

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.cpSync(source, outputRoot, { recursive: true })
const index = path.join(outputRoot, 'index.html')
if (!fs.existsSync(index)) fail(`copy finished without index.html: ${index}`)
const files = fs
  .readdirSync(outputRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
const bytes = files.reduce(
  (sum, entry) =>
    sum + fs.statSync(path.join(entry.parentPath, entry.name)).size,
  0,
)
console.log(
  `[pack-motion] ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB -> ${outputRoot}`,
)
