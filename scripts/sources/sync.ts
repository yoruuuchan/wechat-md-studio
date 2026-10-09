// npm run sync:docs —— 重算所有「生成区块」并把变化写回文件。
// 新增主题 / 新来源 / 新 credit 之后跑一次，README、THEME-SOURCES.md、
// LICENSES/NOTICE.md 里需要跟数据一致的部分就都更新了。
// 只改标记之内的内容；标记外的手写文案原样保留。
// 一致性由 npm run verify:sources 复核（CI/验收清单里跑它，不跑本脚本）。

import fs from 'node:fs'
import { DOC_BLOCKS, DOC_FILES, renderDocFile } from './report'

let changed = 0
for (const file of DOC_FILES) {
  const before = fs.readFileSync(file, 'utf8')
  const after = renderDocFile(file, before)
  if (after === before) {
    console.log(`unchanged  ${file}`)
    continue
  }
  fs.writeFileSync(file, after, 'utf8')
  changed++
  const names = DOC_BLOCKS.filter((b) => b.file === file).map((b) => b.name)
  console.log(`updated    ${file}  (${names.join(', ')})`)
}

console.log(`\n${changed === 0 ? 'all generated blocks already up to date' : `${changed} file(s) rewritten`}`)
