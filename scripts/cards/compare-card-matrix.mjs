// Compare two capture-card-matrix.mjs outputs pixel by pixel.
//   node scripts/cards/compare-card-matrix.mjs <baseline-dir> <current-dir> <report-dir> [--templates a,b]
//
// `--templates` limits the comparison to those ids, which is what lets an
// uploaded-only capture (nine packages) be compared against the full built-in
// baseline while `reed` keeps its separate before/after check.
//
// Exact equality is reported for every image. When it is not exact, the
// acceptance threshold is mean channel difference < 0.5 and the fraction of
// pixels with a channel difference > 16 below 0.1%.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const argv = process.argv.slice(2)
const templatesAt = argv.indexOf('--templates')
const onlyTemplates = templatesAt >= 0 ? (argv[templatesAt + 1] ?? '').split(',').filter(Boolean) : []
const positional = argv.filter((value, index) => index !== templatesAt && index !== templatesAt + 1)
const [baselineArg, currentArg, reportArg] = positional
if (!baselineArg || !currentArg || !reportArg) {
  console.error('usage: node scripts/cards/compare-card-matrix.mjs <baseline-dir> <current-dir> <report-dir> [--templates a,b]')
  process.exit(2)
}
const baselineDir = path.resolve(baselineArg)
const currentDir = path.resolve(currentArg)
const reportDir = path.resolve(reportArg)
fs.mkdirSync(reportDir, { recursive: true })
fs.mkdirSync(path.join(reportDir, 'diff'), { recursive: true })

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodePng(file) {
  const bytes = fs.readFileSync(file)
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG not supported: ' + file)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}: ${file}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0
  if (!channels) throw new Error(`unsupported color type ${colorType}: ${file}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]
    const row = Buffer.from(raw.subarray(at, at + stride))
    at += stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      switch (filter) {
        case 0: break
        case 1: row[x] = (row[x] + left) & 0xff; break
        case 2: row[x] = (row[x] + up) & 0xff; break
        case 3: row[x] = (row[x] + ((left + up) >> 1)) & 0xff; break
        case 4: row[x] = (row[x] + paeth(left, up, upLeft)) & 0xff; break
        default: throw new Error('unknown PNG filter ' + filter)
      }
    }
    for (let x = 0; x < width; x++) {
      const destination = (y * width + x) * 4
      if (channels === 4) {
        pixels[destination] = row[x * 4]
        pixels[destination + 1] = row[x * 4 + 1]
        pixels[destination + 2] = row[x * 4 + 2]
        pixels[destination + 3] = row[x * 4 + 3]
      } else if (channels === 3) {
        pixels[destination] = row[x * 3]
        pixels[destination + 1] = row[x * 3 + 1]
        pixels[destination + 2] = row[x * 3 + 2]
        pixels[destination + 3] = 255
      } else if (channels === 2) {
        pixels[destination] = row[x * 2]
        pixels[destination + 1] = row[x * 2]
        pixels[destination + 2] = row[x * 2]
        pixels[destination + 3] = row[x * 2 + 1]
      } else {
        pixels[destination] = row[x]
        pixels[destination + 1] = row[x]
        pixels[destination + 2] = row[x]
        pixels[destination + 3] = 255
      }
    }
    previous = row
  }
  return { width, height, pixels }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function compare(aFile, bFile) {
  const a = decodePng(aFile)
  const b = decodePng(bFile)
  if (a.width !== b.width || a.height !== b.height) {
    return { width: a.width, height: a.height, sizeMismatch: true, mean: Infinity, bad: 1, exact: false }
  }
  const diff = Buffer.alloc(a.width * a.height * 4)
  let sum = 0
  let bad = 0
  let exact = true
  let max = 0
  const total = a.width * a.height
  for (let i = 0; i < total; i++) {
    let worst = 0
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a.pixels[i * 4 + channel] - b.pixels[i * 4 + channel])
      sum += delta
      if (delta) exact = false
      if (delta > worst) worst = delta
      diff[i * 4 + channel] = Math.min(255, delta * 4)
    }
    if (worst > max) max = worst
    if (worst > 16) bad++
    diff[i * 4 + 3] = 255
  }
  return {
    width: a.width, height: a.height, sizeMismatch: false,
    exact, mean: sum / (total * 3), bad: bad / total, max,
    diff: encodePng(a.width, a.height, diff),
  }
}

const baseline = JSON.parse(fs.readFileSync(path.join(baselineDir, 'manifest.json'), 'utf8'))
const current = JSON.parse(fs.readFileSync(path.join(currentDir, 'manifest.json'), 'utf8'))
const key = (entry) => `${entry.template}/${entry.variant}/${entry.ratio}/${entry.role}`
const selected = (entry) => !onlyTemplates.length || onlyTemplates.includes(entry.template)
const baselineEntries = baseline.entries.filter(selected)
const currentRows = current.entries.filter(selected)
const currentEntries = new Map(currentRows.map((entry) => [key(entry), entry]))
const entries = []
const byTemplate = {}

for (const before of baselineEntries) {
  const after = currentEntries.get(key(before))
  if (!after) {
    entries.push({ key: key(before), missing: true, exact: false, mean: Infinity, bad: 1 })
    continue
  }
  const beforeFile = path.join(baselineDir, before.file)
  const afterFile = path.join(currentDir, after.file)
  const result = compare(beforeFile, afterFile)
  const row = {
    key: key(before), template: before.template, variant: before.variant, ratio: before.ratio, role: before.role,
    pageIndex: before.pageIndex, sha256Baseline: before.sha256, sha256Current: after.sha256,
    exact: result.exact, mean: result.mean, bad: result.bad, max: result.max, sizeMismatch: result.sizeMismatch,
    thresholdPass: !result.sizeMismatch && result.mean < 0.5 && result.bad < 0.001,
  }
  entries.push(row)
  if (!result.exact && result.diff) {
    const name = `${before.template}-${before.variant}-${before.ratio.replace(':', 'x')}-${before.role}-diff.png`
    fs.writeFileSync(path.join(reportDir, 'diff', name), result.diff)
    row.diff = `diff/${name}`
  }
  const group = byTemplate[before.template] ??= { variants: {} }
  const variant = group.variants[before.variant] ??= { entries: 0, exact: 0, failed: 0, worstMean: 0, worstBad: 0 }
  variant.entries++
  if (row.exact) variant.exact++
  if (!row.thresholdPass) variant.failed++
  variant.worstMean = Math.max(variant.worstMean, row.mean)
  variant.worstBad = Math.max(variant.worstBad, row.bad)
}

const total = entries.length
const exact = entries.filter((entry) => entry.exact).length
const threshold = entries.filter((entry) => entry.thresholdPass).length
const missing = currentRows.filter((entry) => !baselineEntries.some((before) => key(before) === key(entry)))
for (const extra of missing) {
  entries.push({ key: key(extra), extra: true, exact: false, mean: Infinity, bad: 1, thresholdPass: false })
}
const report = {
  format: 'reed-card-matrix-compare-v1',
  baseline: baselineDir,
  current: currentDir,
  templates: onlyTemplates,
  generatedAt: new Date().toISOString(),
  summary: {
    entries: total, exact, exactFraction: exact / Math.max(1, total),
    thresholdPass: threshold, thresholdFraction: threshold / Math.max(1, total),
    extraInCurrent: missing.length,
    missing: entries.filter((entry) => entry.missing).map((entry) => entry.key),
  },
  byTemplate,
  entries,
}
fs.writeFileSync(path.join(reportDir, 'compare.json'), JSON.stringify(report, null, 2))
console.log(`[compare] ${exact}/${total} exact; ${threshold}/${total} within threshold; ${report.summary.missing.length} missing`)
for (const [template, group] of Object.entries(byTemplate)) {
  for (const [variant, row] of Object.entries(group.variants)) {
    console.log(`[compare] ${template}/${variant}: ${row.exact}/${row.entries} exact, worst mean ${row.worstMean.toFixed(4)}, worst bad ${(row.worstBad * 100).toFixed(4)}%${row.failed ? ' FAIL' : ''}`)
  }
}
process.exitCode = threshold === total && !missing.length ? 0 : 1