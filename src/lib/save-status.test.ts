import { describe, expect, it } from 'vitest'
import { articleSaveStatus, type LocalSaveReceipt } from './save-status'
import type { DocRecord } from './store'

const doc = (id: string, extra: Partial<DocRecord> = {}): DocRecord => ({
  id, name: id, content: 'body', updatedAt: 999, savedAt: null, deletedAt: null, ...extra,
})
const saved = (d: DocRecord, at: number | null = 100): LocalSaveReceipt => ({ ...d, at })
const state = (d: DocRecord, extra: Partial<Parameters<typeof articleSaveStatus>[0]> = {}) => articleSaveStatus({
  doc: d, enabled: false, settled: true, localReceipt: saved(d), localFailed: false,
  cloudSaving: false, cloudFailed: false, cloudLoadFailed: false, conflict: false, ...extra,
})

describe('current article save status', () => {
  it('shows a committed local version independently of account sync', () => {
    expect(state(doc('a'))).toMatchObject({ local: 'saved', localSavedAt: 100, cloud: 'signed-out' })
  })
  it('keeps old local records saved without inventing a save time', () => {
    const d = doc('a')
    expect(state(d, { localReceipt: saved(d, null) })).toMatchObject({ local: 'saved', localSavedAt: null })
  })
  it('does not display an edit timestamp as a successful save', () => {
    expect(state(doc('a'), { localReceipt: undefined })).toMatchObject({ local: 'saving', localSavedAt: null })
  })
  it('does not reuse a different article receipt even when its name and text are identical', () => {
    const first = doc('a', { name: 'same' })
    const second = doc('b', { name: 'same' })
    expect(state(second, { localReceipt: saved(first) }).local).toBe('saving')
  })
  it('does not reuse a purged article receipt for a new import of the same id and text', () => {
    const previous = doc('a', { localRevision: 5 })
    expect(state(doc('a'), { localReceipt: saved(previous) }).local).toBe('saving')
  })
  it('waits for the live restored state instead of reusing a receipt for the trash copy', () => {
    const previous = doc('a', { localRevision: 5, deletedAt: 100 })
    expect(state({ ...previous, deletedAt: null }, { localReceipt: saved(previous) }).local).toBe('saving')
  })
  it('invalidates the receipt immediately for text typed during an earlier save', () => {
    const before = doc('a')
    expect(state({ ...before, content: 'newer input' }, { localReceipt: saved(before) }))
      .toMatchObject({ local: 'saving', localSavedAt: null })
  })
  it('invalidates a successful receipt when only the article name changes', () => {
    const before = doc('a')
    expect(state({ ...before, name: 'Renamed' }, { localReceipt: saved(before) }).local).toBe('saving')
  })
  it('keeps local failures visible for the uncommitted version', () => {
    expect(state(doc('a'), { localReceipt: undefined, localFailed: true }).local).toBe('error')
  })
  it('does not call another article unsaved because a different write failed', () => {
    expect(state(doc('b'), { localFailed: true }).local).toBe('saved')
  })
  it('never treats an unreadable or missing body as a saved empty article', () => {
    for (const bodyState of ['read-failed', 'missing'] as const) {
      expect(state(doc('a', { contentLoaded: false, bodyState })).local).toBe('error')
    }
  })
  it('shows an unarchived signed-in article without claiming a cloud failure', () => {
    expect(state(doc('a'), { enabled: true, cloudLoadFailed: true }).cloud).toBe('unarchived')
  })
  it('keeps an explicit failed archive attempt actionable', () => {
    expect(state(doc('a'), { enabled: true, cloudFailed: true }).cloud).toBe('error')
  })
  it('shows a failed initial cloud read before reconciliation has settled', () => {
    const d = doc('a', { savedAt: 50 })
    expect(state(d, { enabled: true, settled: false, cloudLoadFailed: true }).cloud).toBe('error')
    expect(state(d, { enabled: true, settled: false, cloudLoadFailed: false }).cloud).toBe('loading')
  })
  it('checks the current version rather than the last global success', () => {
    const before = doc('a', { savedAt: 50 })
    expect(state({ ...before, content: 'new input' }, { enabled: true, cloudVersion: saved(before) }).cloud).toBe('pending')
    expect(state({ ...before, name: 'New name' }, { enabled: true, cloudVersion: saved(before) }).cloud).toBe('pending')
  })
  it('shows a cloud success only for its confirmed name and body', () => {
    const d = doc('b', { savedAt: 50 })
    expect(state(d, { enabled: true, cloudVersion: saved(d) }).cloud).toBe('synced')
  })
  it('keeps cloud work and conflicts scoped to the current article', () => {
    const d = doc('a', { savedAt: 50 })
    expect(state(d, { enabled: true, cloudSaving: true }).cloud).toBe('saving')
    expect(state(d, { enabled: true, cloudSaving: true, conflict: true }).cloud).toBe('conflict')
  })
  it('does not let an old cloud failure hide a newer confirmed success', () => {
    const d = doc('a', { savedAt: 50 })
    expect(state(d, { enabled: true, cloudVersion: saved(d), cloudFailed: true }).cloud).toBe('synced')
  })
})
