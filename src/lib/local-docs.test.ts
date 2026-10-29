import { describe, expect, it } from 'vitest'
import { applyLocalDelta, bodyFromDocument, documentFromBody, mergeLocalCommit, planLocalCommit, type LocalDocRecord } from './local-docs'
import type { BodyRecord } from './body-store'

const copyName = (name: string) => `${name} (conflict)`
const doc = (id: string, content: string, extra: Partial<LocalDocRecord> = {}): LocalDocRecord => ({
  id, name: id, content, updatedAt: 100, savedAt: null, deletedAt: null, localRevision: 1, ...extra,
})
const row = (value: LocalDocRecord, revision = value.localRevision ?? 1) => bodyFromDocument(value, revision)
const change = (before: LocalDocRecord | undefined, after: LocalDocRecord | undefined) => ({
  id: (after ?? before)!.id, before, after, conflictId: `${(after ?? before)!.id}-copy`,
})
const apply = (rows: BodyRecord[], puts: BodyRecord[] = []) => {
  const result = new Map(rows.map((r) => [r.id, r]))
  for (const r of puts) result.set(r.id, r)
  return [...result.values()]
}

describe('local document version planning', () => {
  it('advances the matching persisted version with body and metadata in the same record', () => {
    const base = doc('a', 'BASE')
    const next = { ...base, content: 'EDIT', name: 'Renamed', updatedAt: 110 }
    const plan = planLocalCommit([row(base)], [change(base, next)], copyName)
    expect(plan.result.conflicted).toBe(false)
    expect(plan.put?.[0]).toMatchObject({ id: 'a', content: 'EDIT', revision: 2, metadata: { name: 'Renamed' } })
  })

  it('retains both simultaneous edits even if the second tab never got a notification', () => {
    const base = doc('a', 'BASE')
    const first = { ...base, content: 'FIRST', updatedAt: 110 }
    const second = { ...base, content: 'SECOND', updatedAt: 120 }
    const current = planLocalCommit([row(base)], [change(base, first)], copyName).put!
    const plan = planLocalCommit(current, [change(base, second)], copyName)
    const stored = apply(current, plan.put)
    expect(stored.find((r) => r.id === 'a')?.content).toBe('FIRST')
    expect(stored.find((r) => r.id === 'a-copy')).toMatchObject({ content: 'SECOND', metadata: { savedAt: null, baseHash: null } })
    expect(plan.result.copies).toEqual([{ originalId: 'a', copyId: 'a-copy' }])
  })

  it('does not multiply conflict copies when a save is retried', () => {
    const base = doc('a', 'BASE')
    const current = [row({ ...base, content: 'OTHER', updatedAt: 110 }, 2)]
    const pending = change(base, { ...base, content: 'MY_EDIT', updatedAt: 120 })
    const first = planLocalCommit(current, [pending], copyName)
    const second = planLocalCommit(apply(current, first.put), [pending], copyName)
    expect(first.put).toHaveLength(1)
    expect(second.put).toHaveLength(0)
    expect(second.result.copies).toEqual(first.result.copies)
  })

  it('does not overwrite a conflict copy the user has edited while an old request retries', () => {
    const base = doc('a', 'BASE')
    const pending = change(base, { ...base, content: 'MY_EDIT', updatedAt: 120 })
    const current = [row({ ...base, content: 'OTHER' }, 2), row(doc('a-copy', 'MY_NEWER_COPY_EDIT'), 3)]
    const plan = planLocalCommit(current, [pending], copyName)
    expect(plan.put).toHaveLength(0)
    expect(plan.result.docs.find((d) => d.id === 'a-copy')?.content).toBe('MY_NEWER_COPY_EDIT')
  })

  it('ignores unchanged stale snapshots instead of writing an older version back', () => {
    const base = doc('a', 'BASE')
    const current = row({ ...base, content: 'NEWER', updatedAt: 110 }, 2)
    const plan = planLocalCommit([current], [change(base, base)], copyName)
    expect(plan.put).toHaveLength(0)
    expect(plan.result.docs[0].content).toBe('NEWER')
  })

  it('merges edits to independent fields of the same article', () => {
    const base = doc('a', 'BASE')
    const current = row({ ...base, name: 'OTHER_TAB_NAME', updatedAt: 110 }, 2)
    const plan = planLocalCommit([current], [change(base, { ...base, content: 'MY_BODY', updatedAt: 120 })], copyName)
    expect(plan.result.conflicted).toBe(false)
    expect(plan.result.docs[0]).toMatchObject({ name: 'OTHER_TAB_NAME', content: 'MY_BODY', localRevision: 3 })
  })

  it('keeps an unrelated newly created article when a stale list saves another article', () => {
    const base = doc('a', 'BASE')
    const current = [row(base), row(doc('new-in-other-tab', 'NEW'))]
    const plan = planLocalCommit([current[0]], [change(base, { ...base, content: 'EDIT' })], copyName)
    expect(apply(current, plan.put).map((r) => r.id).sort()).toEqual(['a', 'new-in-other-tab'])
  })

  it('keeps concurrent new articles instead of replacing the index wholesale', () => {
    const first = doc('new-a', 'A')
    const second = doc('new-b', 'B')
    const current = planLocalCommit([], [change(undefined, first)], copyName).put!
    const plan = planLocalCommit([], [change(undefined, second)], copyName)
    expect(apply(current, plan.put).map((r) => r.content).sort()).toEqual(['A', 'B'])
  })

  it('preserves an edit in a copy instead of reviving a trashed original id', () => {
    const base = doc('a', 'BASE')
    const current = row({ ...base, deletedAt: 110 }, 2)
    const plan = planLocalCommit([current], [change(base, { ...base, content: 'MY_LATE_EDIT' })], copyName)
    expect(plan.result.docs.find((d) => d.id === 'a')?.deletedAt).toBe(110)
    expect(plan.put?.find((r) => r.id === 'a-copy')).toMatchObject({ content: 'MY_LATE_EDIT', metadata: { deletedAt: null } })
    expect(plan.put?.find((r) => r.id === 'a')).toBeUndefined()
  })

  it('preserves an edit in a copy after the original was permanently removed', () => {
    const base = doc('a', 'BASE')
    const tombstone: BodyRecord = { id: 'a', content: '', revision: 2, removed: true }
    const plan = planLocalCommit([tombstone], [change(base, { ...base, content: 'LATE' })], copyName)
    expect(plan.result.removed).toEqual(['a'])
    expect(plan.put?.map((r) => r.id)).toEqual(['a-copy'])
  })

  it('does not resurrect a purged article from an unchanged stale view', () => {
    const base = doc('a', 'BASE')
    const plan = planLocalCommit([{ id: 'a', content: '', revision: 2, removed: true }], [change(base, base)], copyName)
    expect(plan.put).toHaveLength(0)
    expect(plan.result.removed).toEqual(['a'])
  })

  it('moves the latest body to trash when an older unchanged body requests soft deletion', () => {
    const base = doc('a', 'BASE')
    const current = row({ ...base, content: 'LATEST', updatedAt: 110 }, 2)
    const plan = planLocalCommit([current], [change(base, { ...base, deletedAt: 120 })], copyName)
    expect(plan.result.docs[0]).toMatchObject({ content: 'LATEST', deletedAt: 120 })
    expect(plan.result.conflicted).toBe(false)
  })

  it('restores a trashed article without replacing a newer body', () => {
    const base = doc('a', 'BASE', { deletedAt: 110 })
    const current = row({ ...base, content: 'LATEST', updatedAt: 120 }, 2)
    const plan = planLocalCommit([current], [change(base, { ...base, deletedAt: null })], copyName)
    expect(plan.result.docs[0]).toMatchObject({ content: 'LATEST', deletedAt: null })
  })

  it('does not purge a revision that moved after the user read the recycle bin', () => {
    const base = doc('a', 'BASE', { deletedAt: 110 })
    const current = row({ ...base, content: 'LATEST', updatedAt: 120 }, 2)
    const plan = planLocalCommit([current], [change(base, undefined)], copyName)
    expect(plan.put).toHaveLength(0)
    expect(plan.result.conflicted).toBe(true)
    expect(plan.result.docs[0].content).toBe('LATEST')
  })

  it('leaves a body intact when the new index only carries an unloaded placeholder', () => {
    const base = doc('a', 'ORIGINAL')
    const plan = planLocalCommit([row(base)], [change(base, { ...base, content: '', contentLoaded: false, bodyState: 'read-failed' })], copyName)
    expect(plan.put).toHaveLength(0)
    expect(plan.result.docs[0]).toMatchObject({ content: 'ORIGINAL', contentLoaded: true })
    expect(plan.result.docs[0].bodyState).toBeUndefined()
  })

  it('does not advance a good body to the hash of an unloaded cloud placeholder', () => {
    const base = doc('a', 'ORIGINAL', { baseHash: 'original-hash' })
    const plan = planLocalCommit([row(base)], [change(base, {
      ...base, content: '', contentLoaded: false, bodyState: 'stub', baseHash: 'new-cloud-hash',
    })], copyName)
    expect(plan.put).toHaveLength(0)
    expect(plan.result.docs[0]).toMatchObject({ content: 'ORIGINAL', baseHash: 'original-hash', contentLoaded: true })
  })
})

describe('reading a stored body', () => {
  it('returns a readable body as loaded even when the fallback entry remembers a failed read', () => {
    const fallback = doc('a', '', { contentLoaded: false, bodyState: 'read-failed' })
    const stored = documentFromBody({ id: 'a', content: 'ORIGINAL_BODY_MUST_SURVIVE' }, fallback)
    expect(stored).toMatchObject({
      id: 'a',
      content: 'ORIGINAL_BODY_MUST_SURVIVE',
      contentLoaded: true,
      bodyState: undefined,
    })
  })

  it('keeps metadata written with the body authoritative over the fallback', () => {
    const fallback = doc('a', '', { name: 'stale name', contentLoaded: false, bodyState: 'read-failed' })
    const stored = documentFromBody({
      id: 'a',
      content: 'BODY',
      revision: 3,
      metadata: { name: 'persisted name', updatedAt: 200, savedAt: null, deletedAt: null },
    }, fallback)
    expect(stored).toMatchObject({ name: 'persisted name', content: 'BODY', localRevision: 3, contentLoaded: true })
  })
})

describe('acknowledging local transactions', () => {
  it('preserves typing that happened while an earlier save was in flight', () => {
    const sent = doc('a', 'SENT')
    const current = { ...sent, content: 'SENT_AND_TYPED_MORE', updatedAt: 120 }
    const saved = { ...sent, localRevision: 2 }
    const result = mergeLocalCommit([current], [sent], {
      docs: [saved], removed: [], copies: [], conflicted: false, changedIds: ['a'],
    })
    expect(result[0]).toMatchObject({ content: 'SENT_AND_TYPED_MORE', localRevision: 2 })
  })

  it('moves later typing into the recovered copy rather than losing it behind the other version', () => {
    const sent = doc('a', 'SENT')
    const current = { ...sent, content: 'SENT_AND_MORE', updatedAt: 120 }
    const other = doc('a', 'OTHER_TAB', { localRevision: 2 })
    const copy = doc('copy', 'SENT', { localRevision: 1 })
    const result = mergeLocalCommit([current], [sent], {
      docs: [other, copy], removed: [], copies: [{ originalId: 'a', copyId: 'copy' }], conflicted: true, changedIds: ['copy'],
    })
    expect(result.find((d) => d.id === 'a')?.content).toBe('OTHER_TAB')
    expect(result.find((d) => d.id === 'copy')).toMatchObject({ content: 'SENT_AND_MORE', savedAt: null, baseHash: null, localRevision: 1 })
  })

  it('does not resurrect a document deleted by the user during a save', () => {
    const sent = doc('a', 'SENT')
    const result = mergeLocalCommit([], [sent], {
      docs: [{ ...sent, localRevision: 2 }], removed: [], copies: [], conflicted: false, changedIds: ['a'],
    })
    expect(result).toEqual([])
  })

  it('keeps failed-read state local instead of healing it through an autosave acknowledgement', () => {
    const paused = doc('a', '', { contentLoaded: false, bodyState: 'read-failed' })
    const result = mergeLocalCommit([paused], [paused], {
      docs: [doc('a', 'GOOD_BODY_IN_ANOTHER_TAB')], removed: [], copies: [], conflicted: false, changedIds: [],
    })
    expect(result[0]).toBe(paused)
  })

  it('reuses unchanged state so save acknowledgements cannot produce an effect loop', () => {
    const current = [doc('a', 'SAME')]
    const result = mergeLocalCommit(current, current, {
      docs: [current[0]], removed: [], copies: [], conflicted: false, changedIds: [],
    })
    expect(result).toBe(current)
  })

  it('rebases queued edits without losing a preceding cloud acknowledgement', () => {
    const base = doc('a', 'BASE', { baseHash: 'old' })
    const queued = { ...base, content: 'NEW' }
    const acknowledged = { ...base, content: 'FIRST', baseHash: 'new', localRevision: 2 }
    expect(applyLocalDelta(base, queued, acknowledged)).toMatchObject({ content: 'NEW', baseHash: 'new', localRevision: 2 })
  })
})
