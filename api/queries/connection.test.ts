import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { backfillDocHashes, backfillSavedAt, DOCHASH_BACKFILL, runMigrations, SAVEDAT_BACKFILL } from './connection'
import { contentHash } from '../lib/doc-hash'

// Timestamp columns declared with `mode: 'timestamp'` are stored in *seconds*.
// Getting that wrong makes the cut-off comparison always true and archives
// everything, which is the failure this test exists to catch.
function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE docs (
      id TEXT PRIMARY KEY,
      ownerId INTEGER NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      savedAt INTEGER,
      hash TEXT
    );
    CREATE TABLE _migrations (
      name TEXT PRIMARY KEY,
      runAt INTEGER NOT NULL
    );
  `)
  return db
}

function insert(db: DatabaseSync, id: string, updatedAt: number, savedAt: number | null = null) {
  db.prepare(
    'INSERT INTO docs (id, ownerId, name, content, createdAt, updatedAt, savedAt) VALUES (?, 1, ?, ?, ?, ?, ?)',
  ).run(id, id, 'body', updatedAt, updatedAt, savedAt)
}

const savedAtOf = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT savedAt FROM docs WHERE id = ?').get(id) as { savedAt: number | null }).savedAt

const NOW = 1_800_000_000 // seconds
const LONG_AGO = NOW - 86_400 * 30

describe('backfillSavedAt', () => {
  it('archives an article written before 草稿箱 existed', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    expect(backfillSavedAt(db, NOW)).toBe(1)
    expect(savedAtOf(db, 'old')).toBe(LONG_AGO)
  })

  it('leaves an article saved after the cut-off alone', () => {
    const db = makeDb()
    insert(db, 'fresh', NOW + 60)
    expect(backfillSavedAt(db, NOW)).toBe(0)
    expect(savedAtOf(db, 'fresh')).toBe(null)
  })

  it('does not disturb an article that was already archived', () => {
    const db = makeDb()
    const earlier = LONG_AGO + 500
    insert(db, 'archived', LONG_AGO, earlier)
    backfillSavedAt(db, NOW)
    expect(savedAtOf(db, 'archived')).toBe(earlier)
  })
})

describe('backfillDocHashes', () => {
  it('computes the concurrency token for rows written before the column existed', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    expect(backfillDocHashes(db)).toBe(1)
    const row = db.prepare('SELECT hash FROM docs WHERE id = ?').get('old') as { hash: string }
    expect(row.hash).toBe(contentHash('body'))
  })

  it('leaves rows that already carry a hash alone', () => {
    const db = makeDb()
    insert(db, 'done', LONG_AGO)
    db.prepare('UPDATE docs SET hash = ? WHERE id = ?').run('deadbeefdeadbeef', 'done')
    expect(backfillDocHashes(db)).toBe(0)
    const row = db.prepare('SELECT hash FROM docs WHERE id = ?').get('done') as { hash: string }
    expect(row.hash).toBe('deadbeefdeadbeef')
  })
})

describe('runMigrations', () => {
  it('archives and hashes legacy articles once, and records both runs', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    // two rows touched: one by the savedAt backfill, one by the hash backfill
    expect(runMigrations(db, NOW)).toBe(2)
    const mark = db.prepare('SELECT name FROM _migrations').all()
    // No ORDER BY in the query: the primary-key index returns them by name.
    expect(mark.map((r) => (r as { name: string }).name).sort()).toEqual(
      [SAVEDAT_BACKFILL, DOCHASH_BACKFILL].sort(),
    )
  })

  it('does not run a second time, so later working copies stay unarchived', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    runMigrations(db, NOW)
    // A working copy the editor writes after the migration.
    insert(db, 'new-working-copy', NOW + 90)
    expect(runMigrations(db, NOW + 120)).toBe(0)
    expect(savedAtOf(db, 'new-working-copy')).toBe(null)
  })
})
