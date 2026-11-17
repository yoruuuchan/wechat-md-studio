// Fail a release build when Vite did not carry the composer's page into `dist`.
// node scripts/motion/verify-motion-dist.mjs
// `npm run build:release` runs this right after `vite build`; a release without
// a usable /motion/ page must not be reported as a successful build.
import fs from 'node:fs'
import path from 'node:path'

const motionRoot = path.resolve('dist/public/motion')
const index = path.join(motionRoot, 'index.html')

if (!fs.existsSync(index) || !fs.statSync(index).isFile()) {
  console.error(`[verify-motion-dist] missing release page: ${index}`)
  process.exit(1)
}
if (fs.statSync(index).size === 0) {
  console.error(`[verify-motion-dist] empty release page: ${index}`)
  process.exit(1)
}

const files = fs
  .readdirSync(motionRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
const bytes = files.reduce(
  (sum, entry) =>
    sum + fs.statSync(path.join(entry.parentPath, entry.name)).size,
  0,
)
console.log(
  `[verify-motion-dist] ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB -> ${motionRoot}`,
)
