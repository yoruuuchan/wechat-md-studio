import { describe, expect, it } from 'vitest'
import { SECONDS_PER_DAY, selectGcCandidates, type GcFileRow } from './anon-gc'

const DAY = SECONDS_PER_DAY

// An arbitrary wall clock. Unix **seconds**, like files.createdAt — the column is
// sqlite's unixepoch, and reading it as milliseconds would make every row look
// older than any limit and empty the pool.
const NOW = 1_900_000_000

const row = (over: Partial<GcFileRow> = {}): GcFileRow => ({
  key: 'k1',
  ownerId: 0,
  size: 2048,
  createdAt: NOW - 30 * DAY,
  ...over,
})

describe('selectGcCandidates', () => {
  it('reclaims an anonymous image that is old and referenced by nothing', () => {
    expect(selectGcCandidates([row()], [], NOW, 14)).toEqual(['k1'])
  })

  it('keeps an image sitting exactly on the age limit, and drops it a second later', () => {
    const atLimit = row({ createdAt: NOW - 14 * DAY })
    expect(selectGcCandidates([atLimit], [], NOW, 14)).toEqual([])
    expect(selectGcCandidates([atLimit], [], NOW + 1, 14)).toEqual(['k1'])
  })

  it('keeps an image that is still young', () => {
    expect(selectGcCandidates([row({ createdAt: NOW - 60 })], [], NOW, 14)).toEqual([])
  })

  it('never touches an owner’s image, however old and unreferenced', () => {
    const owners = row({ key: 'owner-key', ownerId: 1, createdAt: NOW - 400 * DAY })
    expect(selectGcCandidates([owners, row()], [], NOW, 14)).toEqual(['k1'])
  })

  it('keeps an image a cloud article still references', () => {
    expect(selectGcCandidates([row()], ['开头\n\n![配图](img:k1)\n\n结尾'], NOW, 14)).toEqual([])
  })

  it('reads every article, not just the first, for references', () => {
    expect(selectGcCandidates([row()], ['no pictures here', '![a](img:k1)'], NOW, 14)).toEqual([])
  })

  it('treats a key that is a prefix of a referenced key as referenced', () => {
    // The check is a substring search, so `img:k10` also matches `img:k1`. The
    // only mistake that can make is keeping an unused image; it can never delete
    // one that is in use.
    expect(selectGcCandidates([row({ key: 'k1' })], ['![a](img:k10)'], NOW, 14)).toEqual([])
  })

  it('follows the days knob in both directions', () => {
    const rows = [
      row({ key: 'week', createdAt: NOW - 7 * DAY }),
      row({ key: 'month', createdAt: NOW - 30 * DAY }),
    ]
    expect(selectGcCandidates(rows, [], NOW, 14)).toEqual(['month'])
    expect(selectGcCandidates(rows, [], NOW, 60)).toEqual([])
    expect(selectGcCandidates(rows, [], NOW, 1)).toEqual(['week', 'month'])
  })

  it('has nothing to do on an empty ledger', () => {
    expect(selectGcCandidates([], ['![a](img:k1)'], NOW, 14)).toEqual([])
  })
})
