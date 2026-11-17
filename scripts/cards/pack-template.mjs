// Pack a source directory into one `.reedcard` archive.
//   node scripts/cards/pack-template.mjs <source-dir> <output.reedcard>
//
// The source directory must contain manifest.json at its root. Only files the
// manifest can reference are packed, and paths are checked before writing. The
// upload pipeline still validates the resulting archive again.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ALLOWED = new Set(['.json', '.html', '.css', '.woff2', '.woff', '.png', '.jpg', '.jpeg', '.webp', '.svg'])
const MAX_BYTES = 8 * 1024 * 1024

const [sourceArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !outputArg) {
  console.error('usage: node scripts/cards/pack-template.mjs <source-dir> <output.reedcard>')
  process.exit(2)
}
const source = path.resolve(sourceArg)
const output = path.resolve(outputArg)
const rootWithSeparator = source.endsWith(path.sep) ? source : source + path.sep

function walk(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

function relative(absolute) {
  const relativePath = path.relative(source, absolute).replace(/\\/g, '/')
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new Error('path escapes source directory: ' + absolute)
  }
  const extension = path.extname(relativePath).toLowerCase()
  if (!ALLOWED.has(extension)) throw new Error(`extension not allowed in a template: ${relativePath}`)
  return relativePath
}

const manifestPath = path.join(source, 'manifest.json')
if (!fs.existsSync(manifestPath)) throw new Error('manifest.json is missing at ' + manifestPath)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest.format !== 'reed-card-template' || manifest.formatVersion !== 1) {
  throw new Error('manifest.json is not a reed-card-template version 1 file')
}

const zip = new JSZip()
let total = 0
for (const absolute of walk(source)) {
  const relativePath = relative(absolute)
  const bytes = fs.readFileSync(absolute)
  total += bytes.byteLength
  if (total > MAX_BYTES) throw new Error('template source exceeds 8 MB')
  zip.file(relativePath, bytes)
}

for (const required of [...Object.values(manifest.pages ?? {}).filter(Boolean), ...(manifest.styles ?? [])]) {
  if (typeof required !== 'string' || !zip.file(required)) throw new Error('manifest references a missing file: ' + required)
}
for (const font of manifest.fonts ?? []) {
  if (font?.source === 'package' && !zip.file(font.file)) throw new Error('manifest references a missing font: ' + font.file)
}

const archive = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX',
})
if (archive.byteLength > MAX_BYTES) throw new Error('packed template exceeds 8 MB')
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, archive)
console.log(`[pack-template] ${relative(manifestPath) === 'manifest.json' ? manifest.id : manifest.id} -> ${output} (${archive.byteLength} bytes)`)
console.log(`[pack-template] ${Object.keys(zip.files).filter((name) => !zip.files[name].dir).length} files, ${total} source bytes`)