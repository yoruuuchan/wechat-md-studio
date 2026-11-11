// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { parseCardTemplateSource } from './card-template'
import {
  PUBLIC_CARD_TEMPLATES, isPublicCardTemplateId, publicCardTemplateFor,
  publicCardTemplateInstanceId, publicCardTemplateRuntimeId,
} from './public-card-templates'

const sourceRoot = path.resolve('card-templates/public')

function sourceFiles(id: string): { path: string; bytes: Buffer }[] {
  const root = path.join(sourceRoot, id)
  const files: { path: string; bytes: Buffer }[] = []
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else files.push({
        path: path.relative(root, absolute).replace(/\\/g, '/'),
        bytes: fs.readFileSync(absolute),
      })
    }
  }
  walk(root)
  return files
}

async function archive(id: string): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const file of sourceFiles(id)) zip.file(file.path, file.bytes)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

describe('public card templates', () => {
  it('ships exactly nine distinct runtime ids', () => {
    expect(PUBLIC_CARD_TEMPLATES).toHaveLength(9)
    const ids = PUBLIC_CARD_TEMPLATES.map((item) => item.id)
    const runtimes = PUBLIC_CARD_TEMPLATES.map((item) => publicCardTemplateRuntimeId(item.id))
    expect(new Set(ids).size).toBe(9)
    expect(new Set(runtimes).size).toBe(9)
    for (const item of PUBLIC_CARD_TEMPLATES) {
      expect(isPublicCardTemplateId(publicCardTemplateRuntimeId(item.id))).toBe(true)
      expect(publicCardTemplateFor(publicCardTemplateRuntimeId(item.id))?.id).toBe(item.id)
      expect(publicCardTemplateInstanceId(item.id)).not.toBe(item.id)
    }
  })

  it('keeps the static catalog aligned with every source manifest', () => {
    for (const item of PUBLIC_CARD_TEMPLATES) {
      const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, item.id, 'manifest.json'), 'utf8'))
      expect(manifest.id).toBe(item.id)
      expect(manifest.name).toBe(item.name)
      expect(manifest.author).toBe(item.author)
      expect(manifest.description).toContain('改编自')
      expect(manifest.description).toContain('MIT')
      expect(manifest.ratios).toEqual(item.ratios)
      expect(manifest.variants.map((variant: { id: string; name: string }) => ({
        id: variant.id,
        name: variant.name,
      }))).toEqual(item.variants)
    }
  })

  it('keeps a public instance and an upload with the same manifest id independent', async () => {
    const raw = await archive('swiss-grid')
    const publicRecord = await parseCardTemplateSource(raw, publicCardTemplateInstanceId('swiss-grid'))
    const uploadRecord = await parseCardTemplateSource(raw, '2bd28ae4-test-upload')
    expect(publicRecord.parsed.manifest.id).toBe(uploadRecord.parsed.manifest.id)
    expect(publicRecord.template).toBe(publicCardTemplateRuntimeId('swiss-grid'))
    expect(uploadRecord.template).toBe('custom.2bd28ae4-test-upload')
    expect(publicRecord.template).not.toBe(uploadRecord.template)
    expect(publicRecord.id).not.toBe(uploadRecord.id)
  })

  it('passes the exact upload parser and safety checks for all nine packages', async () => {
    for (const item of PUBLIC_CARD_TEMPLATES) {
      const record = await parseCardTemplateSource(await archive(item.id), publicCardTemplateInstanceId(item.id))
      expect(record.parsed.manifest.id).toBe(item.id)
      expect(record.template).toBe(publicCardTemplateRuntimeId(item.id))
      expect(record.parsed.pages.cover!.html).toContain('data-slot="title"')
      expect(record.parsed.pages.body!.html).toContain('data-slot="content"')
      expect(record.parsed.pages.end?.html).toContain('data-slot="author"')
      expect(record.parsed.pages.end?.html).not.toContain('data-slot="brand"')
      expect(record.parsed.pages.cover!.html).not.toContain('data-slot="brand"')
      expect(record.parsed.pages.body!.html).not.toContain('data-slot="brand"')
      expect(record.parsed.styles).toHaveLength(2)
    }
  })
})