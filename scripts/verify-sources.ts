// npm run verify:sources —— 致谢 / 来源 / 许可证数据的机器校验。
//
// 与 verify:themes 的分工：那支管「每套主题渲染出来是否合规」（公众号红线、
// 比例、删除契约）；这支管「数据与文档是否自洽」，全部读 src/lib 的数据文件：
//   1. 主题引用的来源项目必须存在于 theme-sources.ts（连带 kind 一致）
//   2. 来源声明的许可证文件必须真实存在（大小写精确，Windows 上也能抓到 licenses/LICENSES 这类错）
//   3. 主题的 licenseFile 与来源声明的列表必须一一对应（两边都不许有悬空/未用项）
//   4. README / THEME-SOURCES.md / LICENSES/NOTICE.md 的生成区块与数据一致
//   5. /references 页面必须是纯布局：不得出现数据里的项目名 / 仓库 / 许可证字面量
//   6. credits 的许可证副本存在，且 NOTICE.md 覆盖每个 credit（表里漏一行就报错）
//
// 数据或文档不同步时按提示跑 npm run sync:docs 重新生成（第 1-4 条生成的文档会自动修好）。

import fs from 'node:fs'
import path from 'node:path'
import { THEMES } from '../src/lib/themes'
import { CREDITS } from '../src/lib/credits'
import { THEME_SOURCES } from '../src/lib/theme-sources'
import { ORIGINAL_LICENSE } from '../src/lib/theme-meta'
import { DOC_BLOCKS, DOC_FILES, extractGeneratedBlock, extractGeneratedInline, renderDocFile } from './sources/report'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

/**
 * 路径必须逐段大小写完全一致地存在。fs.existsSync 在 Windows 上大小写不敏感，
 * `licenses/x` 会「找到」`LICENSES/x`——这支脚本就是要抓住这类只在
 * Linux（服务器 / CI）上才炸的错误。
 */
function existsExact(rel: string): boolean {
  let dir = process.cwd()
  for (const part of rel.split('/')) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      return false
    }
    if (!entries.includes(part)) return false
    dir = path.join(dir, part)
  }
  return true
}

// ---------------------------------------------------------------- 1. 主题 → 来源
console.log('=== theme → source join ===')
{
  const byProject = new Map(THEME_SOURCES.map((s) => [s.project, s]))
  const missing: string[] = []
  const kindMismatch: string[] = []
  const originalLicenseWrong: string[] = []
  for (const t of THEMES) {
    const source = byProject.get(t.meta.origin.project)
    if (!source) {
      missing.push(`${t.id} → ${t.meta.origin.project}`)
      continue
    }
    if (source.kind !== t.meta.origin.kind) kindMismatch.push(`${t.id}: ${t.meta.origin.kind} vs ${source.kind}`)
    if (source.kind === 'original' && t.meta.origin.license !== ORIGINAL_LICENSE)
      originalLicenseWrong.push(t.id)
    if (source.kind === 'ported' && t.meta.origin.license === ORIGINAL_LICENSE)
      originalLicenseWrong.push(t.id)
  }
  check('every theme references a registered source', missing.length === 0, missing.slice(0, 5).join(' | '))
  check('origin.kind matches the source registry', kindMismatch.length === 0, kindMismatch.slice(0, 5).join(' | '))
  check('original license only on original themes (and vice versa)', originalLicenseWrong.length === 0, originalLicenseWrong.slice(0, 5).join(' | '))
}

// ---------------------------------------------------------------- 2. 来源自洽
console.log('\n=== source registry ===')
{
  const dead: string[] = []
  const missingFile: string[] = []
  const licenseUnused: string[] = []
  const repoUnused: string[] = []
  for (const source of THEME_SOURCES) {
    const own = THEMES.filter((t) => t.meta.origin.project === source.project)
    if (!own.length) {
      dead.push(source.project)
      continue
    }
    for (const f of source.licenseFiles) {
      if (!existsExact(f)) missingFile.push(`${source.project}: ${f}`)
    }
    const dupes = source.licenseFiles.filter((f, i) => source.licenseFiles.indexOf(f) !== i)
    if (dupes.length) missingFile.push(`${source.project}: duplicate file entry ${dupes[0]}`)
    if (!own.some((t) => t.meta.origin.license === source.license))
      licenseUnused.push(`${source.project}: ${source.license}`)
    if (!own.some((t) => t.meta.origin.repo === source.repo))
      repoUnused.push(`${source.project}: ${source.repo}`)
  }
  check('no dead entries (every source has themes)', dead.length === 0, dead.join(' | '))
  check('every declared license file exists (case-exact)', missingFile.length === 0, missingFile.slice(0, 5).join(' | '))
  check('every source default license is actually used by its themes', licenseUnused.length === 0, licenseUnused.join(' | '))
  check('every source repo is referenced by at least one theme', repoUnused.length === 0, repoUnused.join(' | '))

  // 3. licenseFile 一一对应：主题声明的必须在来源列表里；来源列出的必须有主题在用
  const declared = new Set(THEME_SOURCES.flatMap((s) => (s.kind === 'ported' ? s.licenseFiles : [])))
  const referenced = new Set(THEMES.map((t) => t.meta.origin.licenseFile).filter((f): f is string => Boolean(f)))
  const undeclared: string[] = []
  for (const t of THEMES) {
    const f = t.meta.origin.licenseFile
    if (f && !declared.has(f)) undeclared.push(`${t.id}: ${f}`)
  }
  const unused = [...declared].filter((f) => !referenced.has(f))
  check('theme license files are declared by their source', undeclared.length === 0, undeclared.slice(0, 5).join(' | '))
  check('no declared license file is left unreferenced', unused.length === 0, unused.join(' | '))
}

// ---------------------------------------------------------------- 4. credits
console.log('\n=== credits ===')
{
  const missingFile: string[] = []
  for (const c of CREDITS) {
    if (!existsExact(`LICENSES/${c.licenseFile}`)) missingFile.push(c.licenseFile)
  }
  check('every credit license copy exists (case-exact)', missingFile.length === 0, missingFile.join(' | '))

  const notice = fs.readFileSync('LICENSES/NOTICE.md', 'utf8')
  const notCovered: string[] = []
  for (const c of CREDITS) {
    const slug = c.repo.replace(/^https?:\/\//, '')
    // 版权行用「（」之前的前缀比对：NOTICE 的行里会给 author 加反引号等排版，前缀是稳定的。
    const line = c.licenseCopyright.split(/（|——/)[0].trim()
    if (!notice.includes(c.licenseFile) || !notice.includes(slug) || !notice.includes(line)) {
      notCovered.push(c.name)
    }
  }
  check('NOTICE.md covers every credit (repo + license file + copyright line)', notCovered.length === 0, notCovered.join(' | '))
}

// ---------------------------------------------------------------- 5. 生成文档与数据一致
console.log('\n=== generated documents are in sync ===')
{
  let stale: string[] = []
  for (const file of DOC_FILES) {
    const current = fs.readFileSync(file, 'utf8')
    const localStale: string[] = []
    for (const block of DOC_BLOCKS.filter((b) => b.file === file)) {
      const found = block.inline ? extractGeneratedInline(current, block.name) : extractGeneratedBlock(current, block.name)
      if (found === null) localStale.push(`${block.name}(marker missing)`)
      else if (found !== block.build().trim()) localStale.push(block.name)
    }
    check(`${file} blocks match the data`, localStale.length === 0, localStale.join(', ') || undefined)
    stale = stale.concat(localStale.map((n) => `${file}:${n}`))
  }
  if (stale.length) {
    console.log('      → 跑 `npm run sync:docs` 重新生成，然后重跑本校验。')
  }
  // 兜底：整文件重算一遍必须和现文一致（防止块之外的标记性问题，比如标记重复）。
  // 按内容比较、忽略行尾：git 检出或编辑器可能把工作区写成 CRLF，那不是漂移。
  for (const file of DOC_FILES) {
    const current = fs.readFileSync(file, 'utf8')
    check(`${file} renders idempotently`, renderDocFile(file, current) === current.replace(/\r\n/g, '\n'))
  }
}

// ---------------------------------------------------------------- 6. references 页面纯布局
console.log('\n=== /references is layout-only ===')
{
  const ref = fs.readFileSync('src/pages/References.tsx', 'utf8')
  const tokens: string[] = [
    ...CREDITS.map((c) => c.name),
    ...CREDITS.map((c) => c.repo),
    ...CREDITS.map((c) => c.licenseFile),
    ...THEME_SOURCES.map((s) => s.project),
    ...THEME_SOURCES.map((s) => s.repo),
    ...THEME_SOURCES.flatMap((s) => s.licenseFiles),
  ].filter(Boolean)
  const licenses = [...new Set([...CREDITS.map((c) => c.license), ...THEMES.map((t) => t.meta.origin.license)])]
  const hits: string[] = []
  for (const token of tokens) if (ref.includes(token)) hits.push(token)
  for (const lic of licenses) {
    // 短标识（MIT / ISC…）按单词边界找，避免误伤普通英文词。
    const re = new RegExp(`\\b${lic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (re.test(ref)) hits.push(lic)
  }
  check('no data literals hardcoded in the page source', hits.length === 0, hits.slice(0, 6).join(' | '))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
