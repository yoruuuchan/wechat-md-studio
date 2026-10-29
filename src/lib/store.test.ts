import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  __resetLocalStoreForTests,
  createDoc,
  loadDocs,
  persistenceStatus,
  saveDocs,
  subscribePersistence,
  type DocRecord,
} from './store'
import { SAMPLE_DOC } from './sample'

const LEGACY_KEY = 'mopai.docs.v1'
const INDEX_KEY = 'mopai.index.v2'
const MIGRATED_KEY = 'mopai.migrated.v2'
const BODIES_KEY = 'mopai.bodies.v1'

/** The subset of Storage the store touches, with a quota we can turn on. */
class MemoryStorage {
  private map = new Map<string, string>()
  /** Every setItem throws once this is set - the quota-exhausted browser. */
  quotaExceeded = false
  /** Keys that may not be written, for one-key-at-a-time failures. */
  readonly blocked = new Set<string>()

  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.quotaExceeded || this.blocked.has(key)) {
      const err = new Error('quota')
      err.name = 'QuotaExceededError'
      throw err
    }
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
  keys() {
    return [...this.map.keys()]
  }
}

let storage: MemoryStorage

function doc(id: string, content: string, extra: Partial<DocRecord> = {}): DocRecord {
  return { id, name: `稿件 ${id}`, content, updatedAt: 1000, savedAt: null, deletedAt: null, ...extra }
}

/** The body store is a real (fake) IndexedDB, so it outlives a single test. */
function wipeDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('mopai')
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  // Anything that is not about the sample seed runs as a browser that has
  // already seen it, so the seed never adds a document behind the test's back.
  storage.setItem('mopai.sample.v1', '1')
  __resetLocalStoreForTests()
  await wipeDatabase()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('migrating the old localStorage documents', () => {
  it('retains MCP bases across reloads and the complete local body after disconnection', async () => {
    const bound = doc('shared-local', '本机完整正文', { remoteMcp: { id: 'lease', baseHash: '0123456789abcdef', name: '稿件' } })
    await saveDocs([bound], bound.id)
    __resetLocalStoreForTests()
    const loaded = (await loadDocs()).docs.find((d) => d.id === bound.id)!
    expect(loaded.content).toBe(bound.content)
    expect(loaded.remoteMcp).toEqual(bound.remoteMcp)
    await saveDocs([{ ...loaded, remoteMcp: null }], loaded.id)
    __resetLocalStoreForTests()
    const disconnected = (await loadDocs()).docs.find((d) => d.id === bound.id)!
    expect(disconnected.content).toBe(bound.content)
    expect(disconnected.remoteMcp).toBeNull()
  })
  it('moves bodies into the store, verifies them, then drops the old key', async () => {
    const old = [doc('a', 'A 的正文 '.repeat(50)), doc('b', 'B 的正文', { savedAt: 123 })]
    storage.setItem(LEGACY_KEY, JSON.stringify(old))

    const s = persistenceStatus()
    const loaded = await loadDocs()
    expect(loaded.docs.map((d) => d.id).sort()).toEqual(['a', 'b'])
    expect(loaded.docs.find((d) => d.id === 'a')?.content).toBe('A 的正文 '.repeat(50))
    expect(loaded.docs.find((d) => d.id === 'b')?.savedAt).toBe(123)

    // The old key is gone only because the new copy was read back and checked.
    expect(storage.getItem(LEGACY_KEY)).toBeNull()
    expect(storage.getItem(MIGRATED_KEY)).toBe('1')
    expect(JSON.parse(storage.getItem(INDEX_KEY) as string).docs).toHaveLength(2)
    expect(storage.getItem(BODIES_KEY)).toBeNull()
    expect(persistenceStatus().healthy).toBe(true)
    expect(s.healthy).toBe(true)
  })

  it('advances the migrated revision on the first edit instead of creating a false conflict', async () => {
    storage.setItem(LEGACY_KEY, JSON.stringify([doc('a', 'LEGACY')]))
    const loaded = await loadDocs()
    const migrated = loaded.docs.find((d) => d.id === 'a')!
    await saveDocs([{ ...migrated, content: 'FIRST EDIT', updatedAt: 2000 }], 'a')

    __resetLocalStoreForTests()
    const after = await loadDocs()
    expect(after.docs.map((d) => [d.id, d.content])).toEqual([['a', 'FIRST EDIT']])
  })

  it('keeps the old key and reports when the new store cannot take the bodies', async () => {
    storage.setItem(LEGACY_KEY, JSON.stringify([doc('a', 'A')]))
    // The write path fails: the fallback store is what a browser without
    // IndexedDB would use, and it writes through localStorage.
    const failing = new MemoryStorage()
    failing.setItem(LEGACY_KEY, storage.getItem(LEGACY_KEY) as string)
    failing.quotaExceeded = true
    vi.stubGlobal('localStorage', failing)
    const { createBodyStore } = await import('./body-store')
    const original = indexedDB
    vi.stubGlobal('indexedDB', undefined)

    try {
      const loaded = await loadDocs()
      // The session still shows the article - "keep working, keep the original".
      expect(loaded.docs.map((d) => d.id)).toEqual(['a'])
      expect(loaded.docs[0].content).toBe('A')
      expect(failing.getItem(LEGACY_KEY)).not.toBeNull()
      expect(failing.getItem(MIGRATED_KEY)).toBeNull()
      expect(persistenceStatus().healthy).toBe(false)
      expect(persistenceStatus().failure?.kind).toBe('migration-failed')
    } finally {
      vi.stubGlobal('indexedDB', original)
      vi.stubGlobal('localStorage', storage)
      void createBodyStore
    }
  })

  it('leaves an unreadable legacy value alone and says so', async () => {
    storage.setItem(LEGACY_KEY, '{not json')

    const loaded = await loadDocs()
    expect(loaded.docs.length).toBe(1)
    expect(loaded.docs[0].name).toBe('示例稿 · 语法速览')
    // The raw string is still there: overwriting it would destroy whatever it is.
    expect(storage.getItem(LEGACY_KEY)).toBe('{not json')
    expect(persistenceStatus().failure?.kind).toBe('parse-failed')
  })

  it('does not migrate twice', async () => {
    storage.setItem(LEGACY_KEY, JSON.stringify([doc('a', 'A')]))
    await loadDocs()
    // A stale legacy key that reappears (another tab, a downgrade) is ignored
    // once the new index is the truth.
    storage.setItem(LEGACY_KEY, JSON.stringify([doc('gone', 'X')]))
    __resetLocalStoreForTests()
    const again = await loadDocs()
    expect(again.docs.map((d) => d.id)).toEqual(['a'])
  })
})

describe('saving', () => {
  it('writes bodies and index, and reports health', async () => {
    const docs = [doc('a', '正文 A'), doc('b', '正文 B')]
    expect(await saveDocs(docs, 'a')).toBe(true)
    expect(persistenceStatus().healthy).toBe(true)

    __resetLocalStoreForTests()
    const loaded = await loadDocs()
    expect(loaded.activeId).toBe('a')
    expect(loaded.docs.map((d) => [d.id, d.content])).toEqual([
      ['a', '正文 A'],
      ['b', '正文 B'],
    ])
  })

  it('reports a full browser instead of swallowing the failure', async () => {
    const seen: string[] = []
    const off = subscribePersistence((s) => seen.push(s.failure?.kind ?? 'ok'))

    await saveDocs([doc('a', 'A')], 'a')
    storage.quotaExceeded = true
    const ok = await saveDocs([doc('a', 'A2')], 'a')

    expect(ok).toBe(false)
    expect(persistenceStatus().healthy).toBe(false)
    expect(persistenceStatus().failure?.kind).toBe('quota')
    expect(persistenceStatus().failure?.message).toContain('本地')
    expect(seen).toContain('quota')
    off()
  })

  it('keeps the newest body recoverable when the index cannot be written', async () => {
    await saveDocs([doc('a', '第一版')], 'a')

    // The index write is the one that fails: the body has already landed, so
    // the article must not vanish on the next load.
    storage.blocked.add(INDEX_KEY)
    const ok = await saveDocs([doc('a', '第一版'), doc('b', '新写的')], 'b')
    expect(ok).toBe(false)

    storage.blocked.clear()
    __resetLocalStoreForTests()
    const loaded = await loadDocs()
    const b = loaded.docs.find((d) => d.id === 'b')
    expect(b?.content).toBe('新写的')
    // Metadata now commits with the body, so a missing index no longer reduces
    // the recovered article to its default name.
    expect(b?.name).toBe('稿件 b')
  })

  it('keeps a permanent delete durable when the index cache cannot be written', async () => {
    await saveDocs([doc('a', 'A'), doc('b', 'B')], 'a')
    storage.blocked.add(INDEX_KEY)
    const ok = await saveDocs([doc('a', 'A')], 'a')
    expect(ok).toBe(false)
    expect(persistenceStatus().failure?.kind).toBe('quota')

    storage.blocked.clear()
    __resetLocalStoreForTests()
    const loaded = await loadDocs()
    expect(loaded.docs.map((d) => d.id)).toEqual(['a'])
  })

  it('does not rewrite bodies that did not change', async () => {
    await saveDocs([doc('a', 'A')], 'a')
    const store = await import('./body-store')
    const created = await store.createBodyStore()
    const write = vi.spyOn(created, 'transact')
    vi.spyOn(store, 'createBodyStore').mockResolvedValue(created)
    // Re-open through the watched store, then let a load fill in what is
    // already on disk - otherwise "unchanged" is not knowable.
    __resetLocalStoreForTests()
    await loadDocs()

    await saveDocs([doc('a', 'A')], 'a')
    expect(write).not.toHaveBeenCalled()

    await saveDocs([doc('a', 'A changed')], 'a')
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('loading', () => {
  it('gives a brand new browser the sample article', async () => {
    const loaded = await loadDocs()
    expect(loaded.docs).toHaveLength(1)
    expect(loaded.docs[0].content).toBe(SAMPLE_DOC)
    expect(loaded.activeId).toBe(loaded.docs[0].id)
    expect(storage.getItem('mopai.sample.v1')).toBe('1')
  })

  it('seeds the sample into a browser that predates it, once', async () => {
    await saveDocs([doc('a', '自己写的')], 'a')
    storage.removeItem('mopai.sample.v1')
    __resetLocalStoreForTests()

    const first = await loadDocs()
    expect(first.docs.map((d) => d.content)).toContain(SAMPLE_DOC)
    expect(first.docs).toHaveLength(2)

    __resetLocalStoreForTests()
    const second = await loadDocs()
    expect(second.docs).toHaveLength(2)
  })

  it.each(['欢迎使用公众号排版助手', '欢迎使用芦苇'])('recognizes an existing %s sample without reseeding or rewriting it', async (marker) => {
    const content = `---\ntitles:\n  - ${marker}\n---\n\nA sample the user has edited.\n`
    await saveDocs([doc('existing-sample', content)], 'existing-sample')
    storage.removeItem('mopai.sample.v1')
    __resetLocalStoreForTests()

    const loaded = await loadDocs()
    expect(loaded.docs).toHaveLength(1)
    expect(loaded.docs[0].content).toBe(content)
    expect(loaded.activeId).toBe('existing-sample')
  })

  it('falls back to localStorage bodies and reports it when there is no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined)
    __resetLocalStoreForTests()

    const ok = await saveDocs([doc('a', '无 IDB 的正文')], 'a')
    expect(ok).toBe(true)
    expect(JSON.parse(storage.getItem(BODIES_KEY) as string)).toMatchObject({
      a: {
        id: 'a',
        content: '无 IDB 的正文',
        revision: 1,
        metadata: { name: '稿件 a' },
      },
    })
    // Working, but the user is told the store is the small one.
    expect(persistenceStatus().healthy).toBe(false)
    expect(persistenceStatus().failure?.kind).toBe('unsupported')

    __resetLocalStoreForTests()
    const loaded = await loadDocs()
    expect(loaded.docs[0].content).toBe('无 IDB 的正文')
  })
})

describe('what stays in localStorage', () => {
  it('keeps settings and the active id out of IndexedDB', async () => {
    const { loadSettings, saveSettings, saveActiveId, loadActiveId } = await import('./store')
    const settings = {
      themeId: 'steady',
      sig: { layout: 'a', proof: 'b', review: 'c' },
      syncScroll: false,
      zoom: 110,
      uploadSize: '2' as const,
    }
    saveSettings(settings)
    saveActiveId('doc-9')
    expect(JSON.parse(storage.getItem('mopai.settings.v1') as string)).toEqual(settings)
    expect(loadSettings()).toEqual(settings)
    expect(loadActiveId()).toBe('doc-9')
  })

  it('restores the remembered upload size and defaults it to auto when absent', async () => {
    const { loadSettings, saveSettings } = await import('./store')
    const base = { themeId: 'golden', sig: { layout: 'a', proof: 'b', review: 'c' }, syncScroll: true, zoom: 100 }

    // A settings blob written before the size choice existed must come back as
    // the shipped default, not as undefined.
    storage.setItem('mopai.settings.v1', JSON.stringify(base))
    expect(loadSettings().uploadSize).toBe('auto')

    saveSettings({ ...base, uploadSize: 'original' })
    expect(loadSettings().uploadSize).toBe('original')
  })

  it('reports a settings write that the browser refuses', async () => {
    const { saveSettings } = await import('./store')
    storage.quotaExceeded = true
    saveSettings({
      themeId: 'x',
      sig: { layout: '', proof: '', review: '' },
      syncScroll: true,
      zoom: 100,
      uploadSize: 'auto',
    })
    expect(persistenceStatus().failure?.kind).toBe('quota')
  })

  it('creates a blank article with the old skeleton', () => {
    const blank = createDoc()
    expect(blank.content).toContain('---')
    expect(blank.savedAt).toBeNull()
    expect(blank.deletedAt).toBeNull()
  })
})

describe('unavailable bodies', () => {
  async function storedBody(id: string): Promise<string | null> {
    const { createBodyStore } = await import('./body-store')
    const store = await createBodyStore()
    try {
      return (await store.readAll()).find((r) => r.id === id)?.content ?? null
    } finally {
      store.close()
    }
  }

  it('keeps the original when the first body read fails, then recovers it on retry', async () => {
    await saveDocs([doc('a', 'ORIGINAL_BODY_MUST_SURVIVE')], 'a')
    __resetLocalStoreForTests()

    const spy = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementationOnce(() => {
      throw new Error('Simulated transient read failure')
    })
    try {
      const loaded = await loadDocs()
      const a = loaded.docs.find((d) => d.id === 'a')!
      expect(loaded.bodyReadFailed).toBe(true)
      expect(a.content).toBe('')
      expect(a.contentLoaded).toBe(false)
      expect(a.bodyState).toBe('read-failed')
      expect(persistenceStatus().failure?.kind).toBe('read-failed')

      // This is what the editor's autosave effect runs with. It must write the
      // index, not an empty body.
      expect(await saveDocs(loaded.docs, loaded.activeId)).toBe(true)
      // A successful write does not repair a failed read.
      expect(persistenceStatus().failure?.kind).toBe('read-failed')
    } finally {
      spy.mockRestore()
    }

    expect(await storedBody('a')).toBe('ORIGINAL_BODY_MUST_SURVIVE')

    __resetLocalStoreForTests()
    const again = await loadDocs()
    const a = again.docs.find((d) => d.id === 'a')!
    expect(a.content).toBe('ORIGINAL_BODY_MUST_SURVIVE')
    expect(a.contentLoaded).toBe(true)
    expect(a.bodyState).toBeUndefined()
    expect(persistenceStatus().healthy).toBe(true)
  })

  it('distinguishes an emptied article from a missing body', async () => {
    await saveDocs([doc('empty', '')], 'empty')
    __resetLocalStoreForTests()

    const emptied = (await loadDocs()).docs.find((d) => d.id === 'empty')!
    expect(emptied.content).toBe('')
    expect(emptied.contentLoaded).toBe(true)
    expect(emptied.bodyState).toBeUndefined()
    expect(persistenceStatus().failure).toBeNull()

    // The index remembers an id the body store does not have: unknown, not empty.
    storage.setItem(
      INDEX_KEY,
      JSON.stringify({
        docs: [
          {
            id: 'gone',
            name: 'Missing',
            updatedAt: 2,
            savedAt: null,
            deletedAt: null,
            source: null,
            baseHash: null,
            contentLoaded: true,
          },
        ],
        removed: [],
      }),
    )
    __resetLocalStoreForTests()
    const missing = await loadDocs()
    expect(missing.docs[0].contentLoaded).toBe(false)
    expect(missing.docs[0].bodyState).toBe('missing')
    expect(persistenceStatus().failure?.kind).toBe('read-failed')

    await saveDocs(missing.docs, missing.activeId)
    expect(await storedBody('gone')).toBeNull()
    __resetLocalStoreForTests()
    expect((await loadDocs()).docs[0].bodyState).toBe('missing')
  })

  it('indexes a cloud stub without writing an empty body', async () => {
    storage.setItem(
      INDEX_KEY,
      JSON.stringify({
        docs: [
          {
            id: 'stub',
            name: 'Cloud stub',
            updatedAt: 2,
            savedAt: 3,
            deletedAt: null,
            source: null,
            baseHash: '0123456789abcdef',
            contentLoaded: false,
          },
        ],
        removed: [],
      }),
    )
    __resetLocalStoreForTests()

    const loaded = await loadDocs()
    expect(loaded.docs[0].contentLoaded).toBe(false)
    expect(loaded.docs[0].bodyState).toBe('stub')
    await saveDocs(loaded.docs, loaded.activeId)
    expect(await storedBody('stub')).toBeNull()

    __resetLocalStoreForTests()
    expect((await loadDocs()).docs[0].bodyState).toBe('stub')
  })

  it('does not fall back to an empty store when IndexedDB cannot open', async () => {
    await saveDocs([doc('a', 'ORIGINAL')], 'a')
    __resetLocalStoreForTests()

    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('Simulated IndexedDB open failure')
    })
    try {
      const loaded = await loadDocs()
      expect(loaded.bodyReadFailed).toBe(true)
      expect(loaded.docs[0].bodyState).toBe('read-failed')
      await saveDocs(loaded.docs, loaded.activeId)
    } finally {
      spy.mockRestore()
    }

    __resetLocalStoreForTests()
    const after = await loadDocs()
    expect(after.docs[0].content).toBe('ORIGINAL')
  })

  it('does not migrate or delete the legacy copy while bodies cannot be read', async () => {
    await saveDocs([doc('a', 'INDEXED_BODY')], 'a')
    storage.setItem(LEGACY_KEY, JSON.stringify([doc('legacy', 'LEGACY_BODY')]))
    storage.removeItem(MIGRATED_KEY)
    __resetLocalStoreForTests()

    const spy = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementationOnce(() => {
      throw new Error('Simulated transient read failure')
    })
    try {
      const loaded = await loadDocs()
      expect(loaded.bodyReadFailed).toBe(true)
      expect(storage.getItem(LEGACY_KEY)).not.toBeNull()
      expect(storage.getItem(MIGRATED_KEY)).toBeNull()
      expect(loaded.docs.find((d) => d.id === 'legacy')?.content).toBe('LEGACY_BODY')
      expect(loaded.docs.find((d) => d.id === 'a')?.bodyState).toBe('read-failed')
      await saveDocs(loaded.docs, loaded.activeId)
    } finally {
      spy.mockRestore()
    }

    expect(await storedBody('a')).toBe('INDEXED_BODY')

    __resetLocalStoreForTests()
    const again = await loadDocs()
    expect(again.docs.find((d) => d.id === 'a')?.content).toBe('INDEXED_BODY')
    expect(again.docs.find((d) => d.id === 'legacy')?.content).toBe('LEGACY_BODY')
    expect(storage.getItem(LEGACY_KEY)).toBeNull()
    expect(storage.getItem(MIGRATED_KEY)).toBe('1')
  })

  it('does not migrate a cloud stub as an empty body', async () => {
    storage.setItem(LEGACY_KEY, JSON.stringify([doc('legacy', 'LEGACY_BODY')]))
    storage.setItem(
      INDEX_KEY,
      JSON.stringify({
        docs: [
          {
            id: 'stub',
            name: 'Cloud stub',
            updatedAt: 2,
            savedAt: 3,
            deletedAt: null,
            source: null,
            baseHash: '0123456789abcdef',
            contentLoaded: false,
            bodyState: 'stub',
          },
        ],
        removed: [],
      }),
    )
    __resetLocalStoreForTests()

    const loaded = await loadDocs()
    expect(loaded.docs.find((d) => d.id === 'stub')?.bodyState).toBe('stub')
    // The legacy copy moved, but the stub must not have gained a '' body.
    expect(await storedBody('stub')).toBeNull()
    expect(await storedBody('legacy')).toBe('LEGACY_BODY')
    expect(storage.getItem(MIGRATED_KEY)).toBe('1')
  })
})
