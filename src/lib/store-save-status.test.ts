import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { __resetLocalStoreForTests, loadDocs, saveLocalDocs, type DocRecord } from './store'
import { documentFromBody, planLocalCommit } from './local-docs'

beforeEach(() => {
  __resetLocalStoreForTests()
  vi.stubGlobal('indexedDB', new IDBFactory())
  const storage = new Map<string, string>([['mopai.sample.v1', '1']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => {
  __resetLocalStoreForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const article = (extra: Partial<DocRecord> = {}): DocRecord => ({
  id: 'status-proof', name: 'Title', content: 'BODY', updatedAt: 100,
  savedAt: null, deletedAt: null, ...extra,
})

describe('durable local save receipts', () => {
  it('returns the committed record time and preserves it across a reload', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const input = article()
    const saved = await saveLocalDocs([input], input.id, [])
    expect(saved.ok).toBe(true)
    expect(saved.persisted[0]).toMatchObject({ content: 'BODY', localSavedAt: 10_000, localRevision: 1 })
    __resetLocalStoreForTests()
    const loaded = await loadDocs()
    expect(loaded.docs[0]).toMatchObject({ content: 'BODY', updatedAt: 100, localSavedAt: 10_000 })
  })

  it('does not move the timestamp for an unchanged autosave or a different active selection', async () => {
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const first = await saveLocalDocs([article()], 'status-proof', [])
    now = 20_000
    const unchanged = await saveLocalDocs(first.persisted, 'another-selection', first.persisted)
    expect(unchanged.ok).toBe(true)
    expect(unchanged.commit.changedIds).toEqual([])
    expect(unchanged.persisted[0].localSavedAt).toBe(10_000)
  })

  it('advances the timestamp for a committed name-only change', async () => {
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const first = await saveLocalDocs([article()], 'status-proof', [])
    now = 20_000
    const changed = await saveLocalDocs([{ ...first.persisted[0], name: 'Renamed' }], 'status-proof', first.persisted)
    expect(changed.ok).toBe(true)
    expect(changed.persisted[0]).toMatchObject({ name: 'Renamed', content: 'BODY', localSavedAt: 20_000 })
  })

  it('does not acknowledge a failed transaction or overwrite its prior proof', async () => {
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const first = await saveLocalDocs([article()], 'status-proof', [])
    now = 20_000
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('simulated full disk', 'QuotaExceededError')
    })
    const failed = await saveLocalDocs([{ ...first.persisted[0], content: 'NOT_COMMITTED' }], 'status-proof', first.persisted)
    put.mockRestore()
    expect(failed.ok).toBe(false)
    expect(failed.persisted).toEqual([])
    const loaded = await loadDocs()
    expect(loaded.docs[0]).toMatchObject({ content: 'BODY', localSavedAt: 10_000 })
  })

  it('does not invent a time for older records that have only an edit timestamp', () => {
    const record = documentFromBody({ id: 'status-proof', content: 'OLD_BODY' }, article({ updatedAt: 999_999 }))
    expect(record?.localSavedAt).toBeUndefined()
    expect(record?.updatedAt).toBe(999_999)
  })
  it('returns verified record time and revision immediately after legacy migration', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    localStorage.setItem('mopai.docs.v1', JSON.stringify([article()]))
    const loaded = await loadDocs()
    expect(loaded.docs[0]).toMatchObject({ content: 'BODY', updatedAt: 100, localSavedAt: 10_000, localRevision: 1 })
  })

  it('keeps a recovery result available after its transient notice and reload are gone', async () => {
    const recovery = { kind: 'restored' as const, at: 8_000 }
    await saveLocalDocs([article({ recovery })], 'status-proof', [])
    __resetLocalStoreForTests()
    expect((await loadDocs()).docs[0].recovery).toEqual(recovery)
  })

  it('stamps a preserved conflict copy with durable provenance', () => {
    const base = { ...article(), localRevision: 1 }
    const plan = planLocalCommit([{
      id: base.id, content: 'OTHER_TAB', revision: 2,
      metadata: { ...base, content: undefined },
    }], [{ id: base.id, before: base, after: { ...base, content: 'MY_VERSION' }, conflictId: 'recovery' }], (name) => `${name} copy`)
    const copy = plan.result.docs.find((doc) => doc.id === 'recovery')
    expect(copy?.recovery?.kind).toBe('conflict')
    expect(copy?.localSavedAt).toBeTypeOf('number')
    expect(copy?.content).toBe('MY_VERSION')
  })
})
