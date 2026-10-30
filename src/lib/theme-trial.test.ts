import { describe, expect, it } from 'vitest'
import type { DocRecord, Loaded } from './store'
import { pickTrialArticle } from './theme-trial'

function doc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: 'doc-1',
    name: '当前稿',
    content: '## 标题\n\n正文',
    updatedAt: 1,
    savedAt: null,
    deletedAt: null,
    contentLoaded: true,
    ...overrides,
  }
}

function loaded(docs: DocRecord[], overrides: Partial<Loaded> = {}): Loaded {
  return { docs, activeId: docs[0]?.id ?? '', bodyReadFailed: false, ...overrides }
}

describe('pickTrialArticle', () => {
  it('returns the active article content', () => {
    expect(pickTrialArticle(loaded([doc()]), 'doc-1')).toMatchObject({
      status: 'ready',
      reason: 'none',
      id: 'doc-1',
      name: '当前稿',
      content: '## 标题\n\n正文',
    })
  })

  it('falls back to the first live article when the active id is stale', () => {
    const second = doc({ id: 'doc-2', name: '第二篇' })
    expect(pickTrialArticle(loaded([doc(), second]), 'gone')).toMatchObject({
      status: 'ready',
      id: 'doc-1',
    })
  })

  it('reports a deleted active article instead of silently choosing another', () => {
    expect(pickTrialArticle(loaded([doc({ deletedAt: 5 }), doc({ id: 'doc-2' })]), 'doc-1')).toMatchObject({
      status: 'unavailable',
      reason: 'deleted',
      id: 'doc-1',
    })
  })

  it('never turns a failed body read into an empty article', () => {
    expect(pickTrialArticle(loaded([doc({ content: '' })], { bodyReadFailed: true }), 'doc-1')).toMatchObject({
      status: 'unavailable',
      reason: 'read-failed',
    })
  })

  it('distinguishes cloud stubs, missing bodies and genuinely empty articles', () => {
    expect(
      pickTrialArticle(loaded([doc({ content: '', contentLoaded: false, bodyState: 'stub' })]), 'doc-1'),
    ).toMatchObject({ status: 'unavailable', reason: 'stub' })
    expect(
      pickTrialArticle(loaded([doc({ content: '', contentLoaded: false, bodyState: 'missing' })]), 'doc-1'),
    ).toMatchObject({ status: 'unavailable', reason: 'missing' })
    expect(pickTrialArticle(loaded([doc({ content: '   ' })]), 'doc-1')).toMatchObject({
      status: 'empty',
      reason: 'empty',
    })
  })

  it('reports when there is no article at all', () => {
    expect(pickTrialArticle(loaded([]), '')).toMatchObject({ status: 'unavailable', reason: 'none' })
  })
})