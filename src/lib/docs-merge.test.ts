import { describe, expect, it } from 'vitest'
import { documentHash } from './content-hash'
import { conflictCopyName, planMerge, type RemoteDocMeta } from './docs-merge'
import { createSampleDoc, type DocRecord } from './store'
import { documentHash as serverDocumentHash } from '../../api/lib/doc-hash'

const NOW = 1_700_000_000_000

function localDoc(over: Partial<DocRecord> & { id: string; content: string }): DocRecord {
  return {
    name: over.name ?? over.id,
    updatedAt: NOW,
    savedAt: null,
    deletedAt: null,
    baseHash: null,
    contentLoaded: true,
    ...over,
  }
}

async function remoteDoc(over: { id: string; content: string } & Partial<RemoteDocMeta>): Promise<RemoteDocMeta> {
  const { id, content, ...rest } = over
  const name = over.name ?? id
  return {
    id,
    name,
    updatedAt: NOW,
    savedAt: NOW,
    source: null,
    hash: await documentHash(name, content),
    ...rest,
  }
}

describe('document hash parity with the server', () => {
  it('produces the same name+content token as api/lib/doc-hash', async () => {
    for (const [name, text] of [
      ['稿件', ''],
      ['文章 A', '正文内容'],
      ['标题', '---\ntitles:\n  - 标题\n---\n'],
      ['长文', 'a'.repeat(1000)],
      ['Emoji', '中文😀混合 English 123'],
    ]) {
      expect(await documentHash(name, text)).toBe(serverDocumentHash(name, text))
    }
  })
})

describe('the login merge', () => {
  it('keeps a local-only article and queues it for upload (the A/B case)', async () => {
    const localA = localDoc({ id: 'local-a', name: '本地稿 A', content: '本地写的正文' })
    const remoteB = await remoteDoc({ id: 'cloud-b', name: '云端稿 B', content: '云端已有的正文' })

    const plan = await planMerge({ local: [localA], remote: [remoteB] })

    expect(plan.docs.map((d) => d.id)).toEqual(['local-a', 'cloud-b'])
    expect(plan.toImport.map((d) => d.id)).toEqual(['local-a'])
    const kept = plan.docs.find((d) => d.id === 'local-a')!
    expect(kept.content).toBe('本地写的正文')
    expect(kept.contentLoaded).toBe(true)
  })

  it('keeps a cloud-only article as a metadata stub, body on demand', async () => {
    const remote = await remoteDoc({ id: 'cloud-only', name: '云端独有', content: '正文在云端' })
    const plan = await planMerge({ local: [], remote: [remote] })
    const stub = plan.docs[0]
    expect(stub.id).toBe('cloud-only')
    expect(stub.contentLoaded).toBe(false)
    expect(stub.baseHash).toBe(remote.hash)
    expect(stub.savedAt).toBe(NOW)
    expect(stub.name).toBe('云端独有')
  })

  it('merges identical id+content silently, adopting the cached body', async () => {
    const remote = await remoteDoc({ id: 'same', content: '两边一样' })
    const local = localDoc({ id: 'same', content: '两边一样', savedAt: NOW, baseHash: remote.hash })
    const plan = await planMerge({ local: [local], remote: [remote] })
    expect(plan.docs).toHaveLength(1)
    expect(plan.docs[0].content).toBe('两边一样')
    expect(plan.docs[0].contentLoaded).toBe(true)
    expect(plan.toImport).toEqual([])
    expect(plan.toArchive).toEqual([])
    expect(plan.unsynced).toEqual([])
    expect(plan.notices).toEqual([])
  })

  it('re-homes a diverged local version instead of overwriting either side', async () => {
    const remote = await remoteDoc({ id: 'div', name: '重要稿', content: '云端改过的正文' })
    const local = localDoc({
      id: 'div',
      name: '重要稿',
      content: '本机改过的正文',
      savedAt: NOW,
      baseHash: 'stale-hash-not-matching',
    })
    const plan = await planMerge({ local: [local], remote: [remote] })

    const canonical = plan.docs.find((d) => d.id === 'div')!
    expect(canonical.contentLoaded).toBe(false)
    expect(canonical.baseHash).toBe(remote.hash)
    expect(canonical.name).toBe('重要稿')

    expect(plan.toArchive).toHaveLength(1)
    const copy = plan.toArchive[0]
    expect(copy.id).not.toBe('div')
    expect(copy.content).toBe('本机改过的正文')
    expect(copy.name).toBe(conflictCopyName('重要稿'))
    expect(plan.docs.some((d) => d.id === copy.id)).toBe(true)
    expect(plan.notices.join('\n')).toContain('各有一版')
    // Nothing queued for a plain upload: the copy goes through saveToDrafts.
    expect(plan.toImport).toEqual([])
  })

  it('compares bodies when the cache predates baseHash (upgrade), avoiding false conflicts', async () => {
    const remote = await remoteDoc({ id: 'legacy', content: '老缓存里的正文' })
    const local = localDoc({ id: 'legacy', content: '老缓存里的正文', savedAt: NOW, baseHash: null })
    const plan = await planMerge({ local: [local], remote: [remote] })
    expect(plan.docs).toHaveLength(1)
    expect(plan.docs[0].contentLoaded).toBe(true)
    expect(plan.docs[0].baseHash).toBe(remote.hash)
    expect(plan.toArchive).toEqual([])
    expect(plan.unsynced).toEqual([])
  })

  it('treats a cache edit on top of the current cloud version as unsynced, not a conflict', async () => {
    const remote = await remoteDoc({ id: 'ahead', content: '云端这一版' })
    const local = localDoc({
      id: 'ahead',
      content: '云端这一版 + 本机又写了一段',
      savedAt: NOW,
      baseHash: remote.hash!,
    })
    const plan = await planMerge({ local: [local], remote: [remote] })
    expect(plan.toArchive).toEqual([])
    expect(plan.unsynced).toEqual(['ahead'])
    expect(plan.docs[0].content).toBe('云端这一版 + 本机又写了一段')
    expect(plan.docs[0].baseHash).toBe(remote.hash)
  })

  it('does not discard a local rename when the cloud content is unchanged', async () => {
    const remote = await remoteDoc({ id: 'renamed', name: '云端标题', content: '同一份正文' })
    const local = localDoc({
      id: 'renamed',
      name: '本机标题',
      content: '同一份正文',
      savedAt: NOW,
      baseHash: remote.hash!,
    })
    const plan = await planMerge({ local: [local], remote: [remote] })
    expect(plan.toArchive).toEqual([])
    expect(plan.unsynced).toEqual(['renamed'])
    expect(plan.docs[0]).toMatchObject({ name: '本机标题', content: '同一份正文', baseHash: remote.hash })
  })

  it('does not ship the pristine sample into the account', async () => {
    const sample = createSampleDoc()
    const remote = await remoteDoc({ id: 'real', content: '用户自己的稿子' })
    const plan = await planMerge({ local: [sample], remote: [remote] })
    expect(plan.docs.map((d) => d.id)).toContain(sample.id)
    expect(plan.toImport).toEqual([])
  })

  it('syncs a sample the owner actually edited', async () => {
    const sample = createSampleDoc()
    const edited = { ...sample, content: `${sample.content}\n\n补了一段自己的话` }
    const plan = await planMerge({ local: [edited], remote: [] })
    expect(plan.toImport.map((d) => d.id)).toEqual([sample.id])
  })

  it('treats an article in the cloud bin as present, not missing', async () => {
    const local = localDoc({ id: 'binny', content: '本机这份', savedAt: NOW, baseHash: 'h' })
    const plan = await planMerge({ local: [local], remote: [], trashedIds: new Set(['binny']) })
    expect(plan.toImport).toEqual([])
    expect(plan.docs[0]).toMatchObject({ id: 'binny', savedAt: NOW, content: '本机这份' })
  })

  it('brings an archived local-only article back as a working copy, with a notice', async () => {
    const local = localDoc({ id: 'purged', name: '被删的稿', content: '本机还有', savedAt: NOW })
    const plan = await planMerge({ local: [local], remote: [] })
    expect(plan.toImport.map((d) => d.id)).toEqual(['purged'])
    expect(plan.notices.join('\n')).toContain('在云端已经没有了')
  })

  it('treats an uncomparable cloud row (null hash) as a divergence, never a silent overwrite', async () => {
    const remote: RemoteDocMeta = {
      id: 'nullhash',
      name: '老数据',
      updatedAt: NOW,
      savedAt: NOW,
      source: null,
      hash: null,
    }
    const local = localDoc({ id: 'nullhash', content: '本机正文', savedAt: NOW })
    const plan = await planMerge({ local: [local], remote: [remote] })
    expect(plan.toArchive).toHaveLength(1)
    expect(plan.toArchive[0].content).toBe('本机正文')
  })

  it('never merges, uploads or archives with an unknown local body', async () => {
    const unreadable = localDoc({
      id: 'unknown',
      name: '读不出来的稿',
      content: '',
      savedAt: NOW,
      contentLoaded: false,
      bodyState: 'read-failed',
    })
    const remote = await remoteDoc({ id: 'unknown', content: '云端正文' })

    for (const remoteRows of [[], [remote]]) {
      const plan = await planMerge({ local: [unreadable], remote: remoteRows })
      expect(plan.toImport).toEqual([])
      expect(plan.toArchive).toEqual([])
      expect(plan.unsynced).toEqual([])
      const kept = plan.docs.find((d) => d.id === 'unknown')!
      expect(kept.contentLoaded).toBe(false)
      expect(kept.bodyState).toBe('read-failed')
      expect(kept.baseHash).toBeNull()
    }
  })
})
