import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The database path is read when the connection module loads, so it has to be
// set before docs-router (and therefore connection) is imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-docs-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'docs.db')}`

const { docsRouter } = await import('./docs-router')
const { contentHash } = await import('./lib/doc-hash')

const user = {
  id: 1,
  unionId: 'u1',
  name: null,
  email: null,
  avatar: null,
  role: 'user' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
}

/** One caller per "device"; both write rows owned by the same account. */
function client(id = 1) {
  return docsRouter.createCaller({
    req: new Request('http://test/'),
    resHeaders: new Headers(),
    user: { ...user, id },
  })
}
const caller = client()
const stranger = client(2)

const save = (id: string, content: string, extra: Record<string, unknown> = {}) =>
  caller.saveToDrafts({ id, name: id, content, updatedAt: Date.now(), ...extra })

describe('the recycle bin', () => {
  it('moves a doc out of every live list without destroying it', async () => {
    await save('a', '正文甲')
    expect((await caller.list()).items.map((d) => d.id)).toContain('a')

    await caller.remove({ id: 'a' })
    expect((await caller.list()).items.map((d) => d.id)).not.toContain('a')
    expect((await caller.drafts()).items.map((d) => d.id)).not.toContain('a')
    const trash = await caller.trash()
    expect(trash.map((d) => d.id)).toEqual(['a'])
    expect(trash[0].deletedAt).not.toBeNull()
  })

  it('restores the content, not just the row', async () => {
    const res = await caller.restore({ id: 'a' })
    expect(res.doc?.content).toBe('正文甲')
    expect((await caller.get({ id: 'a' })).doc?.content).toBe('正文甲')
    expect(await caller.trash()).toEqual([])
  })

  it('keeps a trashed doc trashed when an auto-save lands on it', async () => {
    // The client holds the hash from its last sync; the debounced save can be
    // in flight when the delete happens, so the write itself still goes through
    // — but the row must stay in the bin.
    const live = (await caller.get({ id: 'a' })).doc!
    await caller.remove({ id: 'a' })
    const res = await caller.save({
      id: 'a',
      name: 'a',
      content: '改过的正文',
      updatedAt: Date.now(),
      baseHash: live.hash,
    })
    expect(res.ok).toBe(true)
    expect((await caller.list()).items.map((d) => d.id)).not.toContain('a')
    expect((await caller.trash()).map((d) => d.id)).toEqual(['a'])
    await caller.restore({ id: 'a' })
  })

  it('lets saving to the drafts box bring a trashed doc back', async () => {
    const live = (await caller.get({ id: 'a' })).doc!
    await caller.remove({ id: 'a' })
    // Also a compare-and-swap: the explicit save carries the base it saw.
    const res = await caller.saveToDrafts({
      id: 'a',
      name: 'a',
      content: '正文甲',
      updatedAt: Date.now(),
      baseHash: live.hash,
    })
    expect(res.ok).toBe(true)
    expect((await caller.list()).items.map((d) => d.id)).toContain('a')
    expect(await caller.trash()).toEqual([])
  })

  it('purges for good, and a later restore finds nothing', async () => {
    await save('b', '正文乙')
    await caller.remove({ id: 'b' })
    await caller.purge({ id: 'b' })
    expect(await caller.trash()).toEqual([])
    const res = await caller.restore({ id: 'b' })
    expect(res.doc).toBeUndefined()
    expect((await caller.list()).items.map((d) => d.id)).not.toContain('b')
    expect((await caller.get({ id: 'b' })).doc).toBeNull()
  })

  it('never touches another owner’s rows', async () => {
    await save('c', '正文丙')
    await stranger.remove({ id: 'c' })
    expect((await caller.list()).items.map((d) => d.id)).toContain('c')
    expect(await stranger.trash()).toEqual([])
    expect((await stranger.get({ id: 'c' })).doc).toBeNull()
    expect(await stranger.list()).toMatchObject({ total: 0, items: [] })
  })
})

describe('compare-and-swap saves', () => {
  it('keeps a stale save out and hands back the current text', async () => {
    const created = await save('cas-1', '第一版')
    const deviceA = client()
    const deviceB = client()

    // Both devices read the same version.
    const seenByA = (await deviceA.get({ id: 'cas-1' })).doc!
    const seenByB = (await deviceB.get({ id: 'cas-1' })).doc!
    expect(seenByA.hash).toBe(created.hash)
    expect(seenByB.hash).toBe(created.hash)

    // A writes first.
    const aSave = await deviceA.save({
      id: 'cas-1',
      name: 'cas-1',
      content: '第二版（A 写的）',
      updatedAt: Date.now(),
      baseHash: seenByA.hash,
    })
    expect(aSave).toMatchObject({ ok: true, missing: false })

    // B, holding the stale base, must not overwrite A's text.
    const bSave = await deviceB.save({
      id: 'cas-1',
      name: 'cas-1',
      content: '第二版（B 写的）',
      updatedAt: Date.now(),
      baseHash: seenByB.hash,
    })
    expect(bSave.ok).toBe(false)
    if (bSave.ok) throw new Error('unreachable')
    expect(bSave.conflict).toBe(true)
    expect(bSave.current.content).toBe('第二版（A 写的）')
    // Timestamp columns are stored at second granularity, so compare at that
    // resolution (this is exactly why `updatedAt` is not the lock).
    expect(created.savedAt).not.toBeNull()
    expect(bSave.current.savedAt).toBe(Math.floor((created.savedAt ?? 0) / 1000) * 1000)

    // The stored text is still A's version, not B's.
    expect((await caller.get({ id: 'cas-1' })).doc?.content).toBe('第二版（A 写的）')

    // Reading the conflict payload and retrying is the recovery path.
    const retry = await deviceB.save({
      id: 'cas-1',
      name: 'cas-1',
      content: '第三版（B 在 A 的基础上改的）',
      updatedAt: Date.now(),
      baseHash: bSave.current.hash,
    })
    expect(retry).toMatchObject({ ok: true })
    expect((await caller.get({ id: 'cas-1' })).doc?.content).toBe('第三版（B 在 A 的基础上改的）')
  })

  it('accepts an identical re-save even without a base hash', async () => {
    await save('cas-2', '没有变化')
    const res = await caller.save({
      id: 'cas-2',
      name: 'cas-2',
      content: '没有变化',
      updatedAt: Date.now(),
      baseHash: null,
    })
    expect(res).toMatchObject({ ok: true, missing: false })
  })

  it('reports missing instead of resurrecting a purged article', async () => {
    await save('cas-3', '要被彻底删掉的')
    await caller.remove({ id: 'cas-3' })
    await caller.purge({ id: 'cas-3' })
    const res = await caller.save({
      id: 'cas-3',
      name: 'cas-3',
      content: '还想自动保存回来',
      updatedAt: Date.now(),
    })
    expect(res).toMatchObject({ ok: true, missing: true })
    expect((await caller.get({ id: 'cas-3' })).doc).toBeNull()
  })

  it('applies the same lock to saveToDrafts', async () => {
    const created = await save('cas-4', '草稿第一版')
    const deviceB = client()
    await caller.save({
      id: 'cas-4',
      name: 'cas-4',
      content: '自动保存第二版',
      updatedAt: Date.now(),
      baseHash: created.hash,
    })

    const stale = await deviceB.saveToDrafts({
      id: 'cas-4',
      name: 'cas-4',
      content: 'B 直接存草稿',
      updatedAt: Date.now(),
      baseHash: created.hash,
    })
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('unreachable')
    expect(stale.current.content).toBe('自动保存第二版')
    expect((await caller.get({ id: 'cas-4' })).doc?.content).toBe('自动保存第二版')
  })

  it('still inserts when the row does not exist yet', async () => {
    const res = await caller.saveToDrafts({
      id: 'cas-5',
      name: 'cas-5',
      content: '新归档的稿子',
      updatedAt: Date.now(),
      baseHash: null,
    })
    expect(res).toMatchObject({ ok: true, conflict: false })
    expect((await caller.get({ id: 'cas-5' })).doc?.content).toBe('新归档的稿子')
  })
})

describe('importLocal', () => {
  it('is insert-only and reports the stored hash for every id', async () => {
    const first = await caller.importLocal({
      docs: [
        { id: 'imp-1', name: '本地稿', content: '浏览器里的正文', updatedAt: Date.now(), baseHash: null },
      ],
    })
    expect(first.imported).toBe(1)
    expect(first.hashes['imp-1']).toBe(contentHash('浏览器里的正文'))

    // A replay with different content must not clobber what is stored — the
    // merge that produces the local copy has its own place to put conflicts.
    const replay = await caller.importLocal({
      docs: [
        { id: 'imp-1', name: '本地稿', content: '重放时不一样的正文', updatedAt: Date.now(), baseHash: null },
      ],
    })
    expect(replay.imported).toBe(0)
    expect(replay.hashes['imp-1']).toBe(contentHash('浏览器里的正文'))
    expect((await caller.get({ id: 'imp-1' })).doc?.content).toBe('浏览器里的正文')

    // Imported work is a working copy, not an archived draft.
    expect((await caller.drafts()).items.map((d) => d.id)).not.toContain('imp-1')
    expect((await caller.list()).items.map((d) => d.id)).toContain('imp-1')
  })
})

describe('the metadata list', () => {
  it('never ships article bodies and carries the concurrency hash', async () => {
    const marker = '这段话只应该出现在正文读取里-marker-9c1f'
    const res = await caller.saveToDrafts({
      id: 'meta-1',
      name: '元数据测试',
      content: `正文 ${marker}`,
      updatedAt: Date.now(),
      baseHash: null,
    })
    const listed = await caller.list({ limit: 200, offset: 0 })
    const row = listed.items.find((d) => d.id === 'meta-1')!
    expect(row).toBeDefined()
    expect(row.hash).toBe(res.hash)
    expect(row.hash).toBe(contentHash(`正文 ${marker}`))
    expect(JSON.stringify(listed)).not.toContain(marker)
    expect(row).not.toHaveProperty('content')
  })

  it('pages through the archive newest first and reports the total', async () => {
    const pager = client(9)
    for (let i = 1; i <= 5; i++) {
      await pager.saveToDrafts({
        id: `page-${i}`,
        name: `第${i}篇`,
        content: `正文 ${i}`,
        updatedAt: 1_700_000_000_000 + i * 1000,
        baseHash: null,
      })
    }
    const first = await pager.list({ limit: 2, offset: 0 })
    expect(first.total).toBe(5)
    expect(first.items.map((d) => d.id)).toEqual(['page-5', 'page-4'])
    expect(first.hasMore).toBe(true)

    const second = await pager.list({ limit: 2, offset: 2 })
    expect(second.items.map((d) => d.id)).toEqual(['page-3', 'page-2'])

    const last = await pager.list({ limit: 2, offset: 4 })
    expect(last.items.map((d) => d.id)).toEqual(['page-1'])
    expect(last.hasMore).toBe(false)
  })

  it('does not ship the archive with the list, however large it gets', async () => {
    const bulk = client(21)
    const markers: string[] = []
    for (let i = 0; i < 25; i++) {
      const marker = `列表标记-${i}-unique-body-token`
      markers.push(marker)
      await bulk.saveToDrafts({
        id: `bulk-${i}`,
        name: `批量 ${i}`,
        content: `正文内容 ${marker}`,
        updatedAt: Date.now(),
        baseHash: null,
      })
    }
    const page = await bulk.list({ limit: 10, offset: 0 })
    expect(page.total).toBe(25)
    expect(page.items).toHaveLength(10)
    expect(page.hasMore).toBe(true)
    // Not a single body rides along, on this page or any other.
    const wire = JSON.stringify(page)
    for (const marker of markers) expect(wire).not.toContain(marker)
    const secondPage = await bulk.list({ limit: 100, offset: 10 })
    const wire2 = JSON.stringify(secondPage)
    for (const marker of markers) expect(wire2).not.toContain(marker)
  })

  it('serves the body on demand and hides trashed articles', async () => {
    const res = await caller.saveToDrafts({
      id: 'meta-2',
      name: '按需读取',
      content: '只有 get 才拿得到的正文',
      updatedAt: Date.now(),
      baseHash: null,
    })
    const got = await caller.get({ id: 'meta-2' })
    expect(got.doc?.content).toBe('只有 get 才拿得到的正文')
    expect(got.doc?.hash).toBe(res.hash)
    expect((await caller.get({ id: 'no-such-doc' })).doc).toBeNull()

    await caller.remove({ id: 'meta-2' })
    expect((await caller.get({ id: 'meta-2' })).doc).toBeNull()
  })

  it('batches contents for a bundle export, live ids only', async () => {
    await caller.saveToDrafts({ id: 'many-1', name: '批量一', content: '批量正文一', updatedAt: Date.now(), baseHash: null })
    await caller.saveToDrafts({ id: 'many-2', name: '批量二', content: '批量正文二', updatedAt: Date.now(), baseHash: null })
    await caller.remove({ id: 'many-2' })

    const res = await caller.getMany({ ids: ['many-1', 'many-2', 'missing-id'] })
    expect(res.docs.map((d) => d.id)).toEqual(['many-1'])
    expect(res.docs[0].content).toBe('批量正文一')
    expect(res.docs[0].hash).toBe(contentHash('批量正文一'))
  })
})

describe('the drafts box', () => {
  it('derives card stats server-side without shipping bodies', async () => {
    const body = [
      '---',
      'titles:',
      '  - 草稿卡片',
      '---',
      '',
      '## KICKER | 第一节 起点',
      '',
      '![图注](img:key-1)',
      '',
      ':::carousel 4:3 一组图',
      '![a](img:key-2)',
      ':::',
      '',
      '## 第二节',
    ].join('\n')
    await caller.saveToDrafts({ id: 'draft-1', name: '草稿卡片', content: body, updatedAt: Date.now(), baseHash: null })

    const page = await caller.drafts({ q: '', sort: 'savedAt', withImages: false, limit: 100, offset: 0 })
    const card = page.items.find((c) => c.id === 'draft-1')!
    expect(card).toBeDefined()
    expect(card.chars).toBe(body.replace(/\s/g, '').length)
    expect(card.images).toBe(2)
    expect(card.carousels).toBe(1)
    expect(card.hasImages).toBe(true)
    expect(card.headings).toEqual(['第一节 起点', '第二节'])
    expect(JSON.stringify(page)).not.toContain('img:key-1')
    expect(card).not.toHaveProperty('content')
  })

  it('searches the body server-side and filters on images', async () => {
    await caller.saveToDrafts({ id: 'draft-2', name: '普通稿', content: '里面有 特殊词条 这个词', updatedAt: Date.now(), baseHash: null })
    await caller.saveToDrafts({ id: 'draft-3', name: '带图稿', content: '词条 也有，还带 ![图](img:k)', updatedAt: Date.now(), baseHash: null })

    const byBody = await caller.drafts({ q: '特殊词条', sort: 'savedAt', withImages: false, limit: 100, offset: 0 })
    expect(byBody.items.map((c) => c.id)).toEqual(['draft-2'])
    expect(byBody.total).toBe(1)

    const withImages = await caller.drafts({ q: '词条', sort: 'savedAt', withImages: true, limit: 100, offset: 0 })
    expect(withImages.items.map((c) => c.id)).toEqual(['draft-3'])

    const sorted = await caller.drafts({ q: '', sort: 'images', withImages: false, limit: 100, offset: 0 })
    expect(sorted.items[0].images).toBeGreaterThanOrEqual(sorted.items.at(-1)!.images)
  })

  it('pages the drafts box and keeps the count stable', async () => {
    const pager = client(11)
    for (let i = 1; i <= 4; i++) {
      await pager.saveToDrafts({
        id: `dpage-${i}`,
        name: `草稿${i}`,
        content: `草稿正文${i}`,
        updatedAt: Date.now(),
        baseHash: null,
      })
    }
    const page1 = await pager.drafts({ q: '', sort: 'savedAt', withImages: false, limit: 2, offset: 0 })
    expect(page1.total).toBe(4)
    expect(page1.items).toHaveLength(2)
    const page2 = await pager.drafts({ q: '', sort: 'savedAt', withImages: false, limit: 2, offset: 2 })
    expect(page2.items).toHaveLength(2)
    const ids = new Set([...page1.items, ...page2.items].map((c) => c.id))
    expect(ids.size).toBe(4)
  })
})
