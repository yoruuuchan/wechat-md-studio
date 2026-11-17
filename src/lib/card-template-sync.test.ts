import { describe, expect, it } from 'vitest'
import { planCardTemplateSync } from './card-template-sync'

const local = (key: string, id: string, sha256: string, updatedAt: number, cloudUploadedAt?: number) => ({
  key, id, sha256, updatedAt,
  ...(cloudUploadedAt === undefined ? {} : { cloudUploadedAt }),
})
const cloud = (id: string, sha256: string, uploadedAt: number) => ({ id, sha256, uploadedAt })
const tombstone = (id: string, deletedAt: number) => ({ id, deletedAt })

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

  it('compares server times only for a confirmed copy, whatever the device clock says', () => {
    // This device runs 120 s fast: its record time looks later than the cloud
    // upload, but the server confirmed it 30 s before the cloud version.
    const cloudAt = 1_000_000
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'older', cloudAt + 90_000, cloudAt - 30_000)],
      [cloud('a', 'newer', cloudAt)],
    )).toEqual([{ kind: 'download', id: 'a' }])
    // A slow device clock must not make a newer confirmed copy look older.
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'newer', cloudAt - 200_000, cloudAt + 30_000)],
      [cloud('a', 'older', cloudAt)],
    )).toEqual([{ kind: 'upload', id: 'a', key: 'local-a' }])
  })

  it('uses the newest local duplicate for one manifest id', () => {
    expect(planCardTemplateSync(
      [local('old', 'a', 'old', 10), local('new', 'a', 'new', 20)],
      [],
    )).toEqual([{ kind: 'upload', id: 'a', key: 'new' }])
  })

  it('removes a synced copy when another device deleted the id', () => {
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'same', 9_000, 1_000)],
      [],
      [tombstone('a', 2_000)],
    )).toEqual([{ kind: 'delete-local', id: 'a', key: 'local-a' }])
  })

  it('uploads a copy that was never synced after a delete', () => {
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'new', 9_000)],
      [],
      [tombstone('a', 2_000)],
    )).toEqual([{ kind: 'upload', id: 'a', key: 'local-a' }])
  })

  it('uploads a copy confirmed after the tombstone', () => {
    expect(planCardTemplateSync(
      [local('local-a', 'a', 'newer', 9_000, 3_000)],
      [],
      [tombstone('a', 2_000)],
    )).toEqual([{ kind: 'upload', id: 'a', key: 'local-a' }])
  })
})