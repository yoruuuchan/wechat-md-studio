// Build the deployable public template archives before Vite copies `public/`.
//   node scripts/cards/pack-public-templates.mjs
//
// The source directories stay reviewable in `card-templates/public/<id>/`.
// Generated archives are deliberately not committed; every production build
// recreates them through the same packer used for hand-authored packages.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const sourceRoot = path.resolve('card-templates/public')
const outputRoot = path.resolve('public/card-templates')
const ids = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .filter((id) => fs.existsSync(path.join(sourceRoot, id, 'manifest.json')))
  .sort()

if (ids.length !== 9) throw new Error(`expected 9 public template sources, found ${ids.length}`)
fs.mkdirSync(outputRoot, { recursive: true })
for (const file of fs.readdirSync(outputRoot)) {
  if (file.endsWith('.reedcard')) fs.unlinkSync(path.join(outputRoot, file))
}

for (const id of ids) {
  const result = spawnSync(process.execPath, [
    'scripts/cards/pack-template.mjs',
    path.join(sourceRoot, id),
    path.join(outputRoot, `${id}.reedcard`),
  ], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pack failed for ${id} (exit ${result.status})`)
}
console.log(`[pack-public] ${ids.length} archives -> ${outputRoot}`)