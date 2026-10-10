import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contactEmail } from './contact'

// 扫描规则同样从分片拼出，避免这份文件自己出现完整明文。
const plain = new RegExp(['yoruand', 'akari', 'duck\\.com'].join('@'), 'i')
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('contact email', () => {
  it('assembles the public duck relay address', () => {
    expect(contactEmail()).toBe(['yoruandakari', 'duck.com'].join('@'))
  })

  it('never appears as a plain literal in shipped sources', () => {
    const offenders = sourceFiles(srcDir).filter((file) => plain.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
