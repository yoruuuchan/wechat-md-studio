import { describe, expect, it } from 'vitest'
import { planCardTemplateSync } from './card-template-sync'

const local = (key: string, id: string, sha256: string, updatedAt: number) => ({ key, id, sha256, updatedAt })
const cloud = (id: string, sha256: string, uploadedAt: number) => ({ id, sha256, uploadedAt })

describe('card template cloud merge', () => {
  it('pushes local-only templates and pulls cloud-only ones', () => {
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'aaa', 100)],
      [cloud('b', 'bbb', 200)],
    )).toEqual([
      { kind: 'upload', id: 'a', key: 'local-a' },
      { kind: 'download', id: 'b' },
    ])
  })

  it('keeps identical bytes without touching either side', () => {
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'same', 100)],
      [cloud('a', 'same', 50)],
    )).toEqual([{ kind: 'keep', id: 'a' }])
  })

  it('lets the later upload win when the same id differs', () => {
    // Local edited/uploaded after the cloud copy.
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'newer', 300)],
      [cloud('a', 'older', 200)],
    )).toEqual([{ kind: 'upload', id: 'a', key: 'local-a' }])
    // Another device uploaded after this local copy.
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'older', 100)],
      [cloud('a', 'newer', 400)],
    )).toEqual([{ kind: 'download', id: 'a' }])
  })

  it('uses the newest local duplicate for one manifest id', () => {
    expect(planCardTemplateSync(
      [local('old', 'a', 'old', 10), local('new', 'a', 'new', 20)],
      [],
    )).toEqual([{ kind: 'upload', id: 'a', key: 'new' }])
  })
})