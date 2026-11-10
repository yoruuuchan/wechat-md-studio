// Put the motion composer's built page under `public/motion/` before Vite
// copies `public/`, so the site serves it at /motion/.
//   node scripts/motion/pack-motion.mjs
//
// The composer is built in its own project, outside this repository; only its
// finished static page is copied here, and the copy is not committed. Where it
// comes from, first match wins:
//   1. REED_MOTION_SITE: the folder that holds the built index.html
//   2. `wechat-motion-lab/out/site` beside this repository's main checkout
// With neither, the step removes any earlier copy and the build goes on without
// /motion/: vite.config.ts then leaves the top bar's entry a placeholder.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const outputRoot = path.resolve('public/motion')

function defaultSource() {
  // A worktree lives anywhere; the main checkout is where the shared .git is.
  const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
  if (git.status !== 0) return null
  return path.resolve(git.stdout.trim(), '..', '..', 'wechat-motion-lab', 'out', 'site')
}

const source = process.env.REED_MOTION_SITE ? path.resolve(process.env.REED_MOTION_SITE) : defaultSource()
fs.rmSync(outputRoot, { recursive: true, force: true })

if (!source || !fs.existsSync(path.join(source, 'index.html'))) {
  if (process.env.REED_MOTION_SITE) throw new Error(`REED_MOTION_SITE has no index.html: ${source}`)
  console.log('[pack-motion] no composer build found; this build has no /motion/')
  process.exit(0)
}

const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
// The site's content policy runs no inline script: a page that has one would
// load and then do nothing, so refuse it here instead.
if (/<script(?![^>]* src=)/i.test(html)) throw new Error(`${source}/index.html has an inline script; build the composer's site variant`)

fs.cpSync(source, outputRoot, { recursive: true })
const files = fs.readdirSync(outputRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
const bytes = files.reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0)
console.log(`[pack-motion] ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB -> ${outputRoot}`)
