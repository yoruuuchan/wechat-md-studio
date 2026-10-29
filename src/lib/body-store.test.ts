import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createBodyStore, type BodyRecord, type BodyStore } from './body-store'

const stores: BodyStore[] = []

async function openStore() {
  const store = await createBodyStore()
  stores.push(store)
  return store
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('atomic local article transactions', () => {
  it('upgrades version-1 records without copying or discarding their bodies', async () => {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mopai', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('bodies', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction('bodies', 'readwrite')
      tx.objectStore('bodies').put({ id: 'old', content: 'LEGACY_BODY' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    legacy.close()
    const store = await openStore()
    expect(await store.readAll()).toEqual([{ id: 'old', content: 'LEGACY_BODY' }])
    await expect(new Promise((resolve, reject) => {
      const request = indexedDB.open('mopai', 1)
      request.onsuccess = () => { request.result.close(); resolve(undefined) }
      request.onerror = () => reject(request.error)
    })).rejects.toMatchObject({ name: 'VersionError' })
  })

  it('rejects a blocked upgrade and closes its late connection so a retry succeeds', async () => {
    const legacy = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('mopai', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('bodies', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
    })
    try {
      await expect(createBodyStore()).rejects.toThrow('close or reload older tabs')
    } finally {
      legacy.close()
    }
    const store = await openStore()
    await store.write([{ id: 'after-retry', content: 'SAFE' }])
    expect(await store.readAll()).toEqual([{ id: 'after-retry', content: 'SAFE' }])
  })

  it('compares the persisted revision across independent connections without notifications', async () => {
    const first = await openStore()
    const second = await openStore()
    await first.write([{ id: 'shared', content: 'BASE', revision: 1 }])

    const save = (store: BodyStore, content: string) => store.transact((rows) => {
      const current = rows.find((row) => row.id === 'shared')!
      if (current.revision !== 1) return { result: { ok: false, current } }
      return { put: [{ id: 'shared', content, revision: 2 }], result: { ok: true, current } }
    }, ['shared'])

    const results = await Promise.all([save(first, 'FIRST'), save(second, 'SECOND')])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    const winner = (await first.read(['shared']))[0]
    expect(winner.revision).toBe(2)
    expect(results.find((result) => !result.ok)?.current).toEqual(winner)
  })

  it('commits body, metadata, tombstones and conflict copies as one unit', async () => {
    const store = await openStore()
    await store.write([{ id: 'shared', content: 'OTHER_TAB', revision: 2 }])
    await store.transact((rows) => ({
      put: [
        { ...rows[0], content: '', revision: 3, removed: true },
        { id: 'conflict', content: 'MY_EDIT', revision: 1, metadata: { name: 'Recovered draft' } },
      ],
      result: undefined,
    }), ['shared', 'conflict'])

    expect(await store.read(['shared', 'conflict'])).toEqual([
      { id: 'shared', content: '', revision: 3, removed: true },
      { id: 'conflict', content: 'MY_EDIT', revision: 1, metadata: { name: 'Recovered draft' } },
    ])
  })

  it('keeps the prior transaction intact when the planner throws', async () => {
    const store = await openStore()
    await store.write([{ id: 'a', content: 'ORIGINAL', revision: 4 }])
    await expect(store.transact(() => { throw new Error('simulated interruption') }, ['a']))
      .rejects.toThrow('simulated interruption')
    expect(await store.read(['a'])).toEqual([{ id: 'a', content: 'ORIGINAL', revision: 4 }])
  })

  it('rolls back earlier puts when any put cannot be serialized', async () => {
    const store = await openStore()
    await store.write([{ id: 'a', content: 'ORIGINAL', revision: 4 }])
    await expect(store.transact(() => ({
      put: [
        { id: 'a', content: 'MUST_ROLL_BACK', revision: 5 },
        { id: 'bad', content: 'bad', metadata: () => undefined },
      ],
      result: true,
    }), ['a', 'bad'])).rejects.toThrow()
    expect(await store.readAll()).toEqual([{ id: 'a', content: 'ORIGINAL', revision: 4 }])
  })

  it('only reads affected ids instead of copying unrelated article bodies on a keystroke', async () => {
    const store = await openStore()
    await store.write([
      { id: 'active', content: 'small', revision: 1 },
      { id: 'large', content: 'unrelated'.repeat(100_000), revision: 1 },
    ])
    const readAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    await store.transact((rows) => {
      expect(rows.map((row) => row.id)).toEqual(['active'])
      return { put: [{ ...rows[0], content: 'edited', revision: 2 }], result: true }
    }, ['active', 'active', 'missing'])
    expect(readAll).not.toHaveBeenCalled()
    expect((await store.read(['large']))[0].content.length).toBe(900_000)
  })

  it('reads legacy bodies and preserves version metadata in the localStorage fallback', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const values = new Map<string, string>([['mopai.bodies.v1', JSON.stringify({ a: 'legacy' })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => unknown) => callback() } })
    const store = await openStore()
    expect(await store.readAll()).toEqual([{ id: 'a', content: 'legacy' }])
    const next: BodyRecord = { id: 'a', content: 'new', revision: 1, metadata: { name: 'Title' } }
    await store.transact(() => ({ put: [next], result: true }), ['a'])
    expect(await store.read(['a'])).toEqual([next])
  })

  it.each(['{bad-json', '[]', '{"a":42}'])('keeps an unreadable fallback untouched: %s', async (raw) => {
    vi.stubGlobal('indexedDB', undefined)
    const write = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem: write })
    vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => unknown) => callback() } })
    const store = await openStore()
    await expect(store.readAll()).rejects.toThrow()
    await expect(store.transact(() => ({ put: [{ id: 'a', content: 'EMPTY_REPLACEMENT' }], result: true }), ['a']))
      .rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  })

  it('does not turn a fallback read error into an empty store', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const write = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('access denied') }, setItem: write })
    vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => unknown) => callback() } })
    const store = await openStore()
    await expect(store.transact(() => ({ put: [{ id: 'a', content: 'NEW' }], result: true }), ['a']))
      .rejects.toThrow('access denied')
    expect(write).not.toHaveBeenCalled()
  })

  it('fails closed instead of claiming a safe fallback save without Web Locks', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('navigator', {})
    const write = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: write })
    const store = await openStore()
    await expect(store.transact(() => ({ put: [{ id: 'a', content: 'NEW' }], result: true }), ['a']))
      .rejects.toThrow('IndexedDB or Web Locks')
    expect(write).not.toHaveBeenCalled()
  })
})
