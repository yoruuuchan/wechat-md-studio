// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { IDBFactory } from 'fake-indexeddb'
import { parseCardTemplateSource } from './card-template'
import {
  closeCardTemplateStore, deleteCardTemplateRecord, listCardTemplateRecords, saveCardTemplateRecord,
} from './card-template-store'

const metrics = {
  padX: 40, padTop: 52, padBottom: 76, contentWidth: 460,
  headerTop: 22, footerBottom: 26,
  coverInsetX: 48, coverInsetY: 56, coverFootBottom: 40, coverReserve: 156,
  coverTitleSize: [56, 48, 42, 36, 30], coverSmallScale: 0.86,
}

async function record(id: string, name = 'Example') {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({
    format: 'reed-card-template', formatVersion: 1, id: 'example', name, version: '1.0.0',
    author: 'Reed', description: '', ratios: ['3:4'], defaultRatio: '3:4',
    variants: [{ id: 'paper', name: 'Paper', dark: false, tokens: {} }],
    metrics,
    fonts: [{ source: 'builtin', family: 'Noto Sans SC', weights: [400] }],
    pages: { cover: 'pages/cover.html', body: 'pages/body.html' },
    styles: ['styles/template.css'],
  }))
  zip.file('pages/cover.html', '<div data-slot="title"></div>')
  zip.file('pages/body.html', '<div data-slot="content"></div>')
  zip.file('styles/template.css', 'p { margin: 0; }')
  return parseCardTemplateSource(await zip.generateAsync({ type: 'arraybuffer' }), id)
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
  closeCardTemplateStore()
  vi.unstubAllGlobals()
})

describe('uploaded template storage', () => {
  it('persists the raw zip and parsed result across reopen', async () => {
    await saveCardTemplateRecord(await record('one'))
    closeCardTemplateStore()
    const rows = await listCardTemplateRecords()
    expect(rows).toHaveLength(1)
    expect(rows[0].raw.byteLength).toBeGreaterThan(0)
    expect(rows[0].parsed.manifest.id).toBe('example')
    expect(rows[0].parsed.pages.cover.html).toContain('data-slot')
    expect(rows[0].parsed.files.some((file) => file.path === 'styles/template.css')).toBe(true)
  })

  it('lists oldest first and deletes one record', async () => {
    const first = await record('one', 'First')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await record('two', 'Second')
    await saveCardTemplateRecord(first)
    await saveCardTemplateRecord(second)
    expect((await listCardTemplateRecords()).map((row) => row.id)).toEqual(['one', 'two'])
    await deleteCardTemplateRecord('one')
    expect((await listCardTemplateRecords()).map((row) => row.id)).toEqual(['two'])
  })
})