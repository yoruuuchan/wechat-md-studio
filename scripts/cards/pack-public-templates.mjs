// Build the deployable public template archives before Vite copies `public/`.
// node scripts/cards/pack-public-templates.mjs
//
// The source directories stay reviewable in `card-templates/public/<id>/`.
// Generated archives are deliberately not committed; every production build
// recreates them through the same packer used for hand-authored packages.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const sourceRoot = path.resolve('card-templates/public')
const outputRoot = path.resolve('public/card-templates')
const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
 .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
 .map((entry) => entry.name)
 .filter((id) => fs.existsSync(path.join(sourceRoot, id, 'manifest.json')))
 .sort()
const kinds = new Map(entries.map((id) => {
 const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, id, 'manifest.json'), 'utf8'))
 return [id, manifest.kind === 'long' ? 'long' : 'card']
}))
const cards = entries.filter((id) => kinds.get(id) === 'card')
const longs = entries.filter((id) => kinds.get(id) === 'long')

if (cards.length !==9) throw new Error(`expected9 public card template sources, found ${cards.length}`)
if (longs.length !==1) throw new Error(`expected1 public long-image template source, found ${longs.length}`)

fs.mkdirSync(outputRoot, { recursive: true })
for (const file of fs.readdirSync(outputRoot)) {
 if (file.endsWith('.reedcard')) fs.unlinkSync(path.join(outputRoot, file))
}

for (const id of entries) {
 const result = spawnSync(process.execPath, [
 'scripts/cards/pack-template.mjs',
 path.join(sourceRoot, id),
 path.join(outputRoot, `${id}.reedcard`),
 ], { stdio: 'inherit' })
 if (result.error) throw result.error
 if (result.status !==0) throw new Error(`pack failed for ${id} (exit ${result.status})`)
}
console.log(`[pack-public] ${cards.length} card + ${longs.length} long archives -> ${outputRoot}`)
