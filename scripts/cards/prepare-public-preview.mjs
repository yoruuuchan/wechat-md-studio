// Pack the nine public card sources for the local preview contact sheet.
//   node scripts/cards/prepare-public-preview.mjs [--out <dir>]
//
// The default output lives under the gitignored `verify-out/`; passing `--out`
// points the contact sheet at a publishable directory. `packs/` holds the zips
// uploaded through the normal card-template flow and `catalog.json` is the
// input for capture-card-matrix.mjs --mode uploaded --profile preview.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : fallback
}
const out = path.resolve(arg('out', 'verify-out/public-cards-preview'))
const sourceRoot = path.resolve('card-templates/public')
const packs = path.join(out, 'packs')

const ids = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .filter((id) => fs.existsSync(path.join(sourceRoot, id, 'manifest.json')))
  .sort()
if (ids.length !== 9) throw new Error(`expected 9 public sources, found ${ids.length}`)

fs.mkdirSync(packs, { recursive: true })
const catalog = []
for (const id of ids) {
  const source = path.join(sourceRoot, id)
  const zip = path.join(packs, `${id}.reedcard`)
  const result = spawnSync(process.execPath, ['scripts/cards/pack-template.mjs', source, zip], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pack failed for ${id} (exit ${result.status})`)
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'))
  catalog.push({
    id: manifest.id,
    name: manifest.name,
    zip,
    variants: manifest.variants.map((variant) => variant.id),
    ratios: manifest.ratios,
  })
}
fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
console.log(`[preview-prep] ${catalog.length} packs + catalog -> ${out}`)