import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../lib/env'
import { contentHash } from '../lib/doc-hash'
import * as schema from '@db/schema'

/**
 * SQLite via Node's built-in driver — no external process, no extra memory.
 * Drizzle has no `node:sqlite` driver yet, so `sqlite-proxy` is driven by a
 * callback that runs each statement synchronously and hands back rows.
 *
 * IMPORTANT: use core queries (`select/insert/update/delete`), not the
 * relational API (`db.query.<table>.findFirst`). Drizzle's relational layer
 * maps rows by column *name*, while sqlite-proxy supplies positional values, so
 * findFirst returns rows of nulls regardless of what the driver does. Core
 * queries use the positional path this driver is built for.
 */
function resolveDbPath(): string {
  const raw = env.databaseUrl || 'file:./mopai.db'
  const withoutScheme = raw.startsWith('file:') ? raw.slice('file:'.length) : raw
  return path.resolve(withoutScheme)
}

function openDatabase(): DatabaseSync {
  const file = resolveDbPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  // Tables, created on first use — no migration tooling needed at this size.
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      key TEXT PRIMARY KEY,
      ownerId INTEGER NOT NULL,
      name TEXT,
      size INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      visitor TEXT
    );

    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      ownerId INTEGER NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      savedAt INTEGER,
      hash TEXT
    );

    CREATE INDEX IF NOT EXISTS docs_owner_updated
      ON docs (ownerId, updatedAt DESC);
  `)

  // Added after the first release: an existing database has docs without the
  // column, so bring it up to date rather than requiring a manual step.
  const columns = db.prepare('PRAGMA table_info(docs)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'savedAt')) {
    db.exec('ALTER TABLE docs ADD COLUMN savedAt INTEGER')
  }
  // Same story for the recycle bin: rows written before it existed are simply
  // not in it.
  if (!columns.some((c) => c.name === 'deletedAt')) {
    db.exec('ALTER TABLE docs ADD COLUMN deletedAt INTEGER')
  }
  // …and for provenance: a row with no `source` predates the agent API, which
  // reads as "written in the browser" — the same as a row created there.
  if (!columns.some((c) => c.name === 'source')) {
    db.exec('ALTER TABLE docs ADD COLUMN source TEXT')
  }
  // …and for the concurrency token (api/lib/doc-hash.ts). NULL on rows written
  // before it existed; runMigrations backfills them so compare-and-swap has a
  // real value to compare against. Appended last — the schema declares it last.
  if (!columns.some((c) => c.name === 'hash')) {
    db.exec('ALTER TABLE docs ADD COLUMN hash TEXT')
  }

  // Same for uploads that arrive without a login: older databases have no
  // `visitor` column, and every anonymous query filters on it. ALTER appends,
  // which is why the column is declared last in db/schema.ts too. The index has
  // to wait for the column — on an upgraded database the CREATE TABLE above is a
  // no-op, so indexing it there would fail.
  const fileColumns = db.prepare('PRAGMA table_info(files)').all() as { name: string }[]
  if (!fileColumns.some((c) => c.name === 'visitor')) {
    db.exec('ALTER TABLE files ADD COLUMN visitor TEXT')
  }
  db.exec('CREATE INDEX IF NOT EXISTS files_owner_visitor ON files (ownerId, visitor)')

  // One-off data migrations, recorded so they never run twice.
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      runAt INTEGER NOT NULL
    );
  `)
  runMigrations(db)

  return db
}

/**
 * Backfill `savedAt` for articles written before 草稿箱 existed.
 *
 * `savedAt` was added later, so every article from the first release has NULL
 * there. NULL means "working copy, not archived", which is why those articles
 * never showed up in 草稿箱 — the owner saw them in the editor but found an
 * empty archive, and would have lost them with the browser cache. Stamping them
 * with `savedAt = updatedAt` puts them back in the archive.
 *
 * The cut-off is the moment this migration first runs: only rows that already
 * existed are backfilled, so a brand-new working copy created afterwards still
 * stays out of 草稿箱 until the owner saves it.
 *
 * Timestamp columns with `mode: 'timestamp'` hold *seconds*, so the cut-off is
 * seconds too. Comparing against Date.now() would be off by a factor of 1000
 * and pull in every row, including fresh working copies.
 */
export const SAVEDAT_BACKFILL = 'backfill-savedAt-from-pre-drafts-articles'

export function backfillSavedAt(db: DatabaseSync, cutoffSeconds = Math.floor(Date.now() / 1000)): number {
  const result = db
    .prepare(
      `UPDATE docs SET savedAt = updatedAt
       WHERE savedAt IS NULL AND updatedAt < ?`,
    )
    .run(cutoffSeconds)
  return Number(result.changes)
}

export const DOCHASH_BACKFILL = 'backfill-doc-hash-from-content'

/**
 * Compute `docs.hash` for articles written before the column existed.
 *
 * The concurrency token is derived from the content, so backfilling it is
 * mechanical — but it has to actually be done: NULL would make the
 * compare-and-swap predicate match nothing and every save would come back as a
 * conflict. Runs once at boot against upgraded databases only (fresh tables get
 * the column filled by their writers).
 */
export function backfillDocHashes(db: DatabaseSync): number {
  const rows = db.prepare('SELECT id, content FROM docs WHERE hash IS NULL').all() as {
    id: string
    content: string
  }[]
  if (!rows.length) return 0
  const update = db.prepare('UPDATE docs SET hash = ? WHERE id = ?')
  for (const row of rows) update.run(contentHash(row.content), row.id)
  return rows.length
}

function migrationRan(db: DatabaseSync, name: string): boolean {
  return db.prepare('SELECT name FROM _migrations WHERE name = ?').get(name) !== undefined
}

function recordMigration(db: DatabaseSync, name: string, at: number): void {
  db.prepare('INSERT INTO _migrations (name, runAt) VALUES (?, ?)').run(name, at)
}

/** Runs every one-off migration that has not run yet; returns rows touched. */
export function runMigrations(db: DatabaseSync, cutoffSeconds = Math.floor(Date.now() / 1000)): number {
  let changed = 0

  if (!migrationRan(db, SAVEDAT_BACKFILL)) {
    const n = backfillSavedAt(db, cutoffSeconds)
    recordMigration(db, SAVEDAT_BACKFILL, cutoffSeconds)
    if (n > 0) {
      console.log(`[migrate] archived ${n} article(s) written before the drafts box existed`)
    }
    changed += n
  }

  if (!migrationRan(db, DOCHASH_BACKFILL)) {
    const n = backfillDocHashes(db)
    recordMigration(db, DOCHASH_BACKFILL, cutoffSeconds)
    if (n > 0) {
      console.log(`[migrate] computed the concurrency hash for ${n} article(s)`)
    }
    changed += n
  }

  return changed
}

let instance: ReturnType<typeof drizzle<typeof schema>>

export function getDb() {
  if (!instance) {
    const db = openDatabase()
    instance = drizzle(
      async (sqlText, params, method) => {
        const stmt = db.prepare(sqlText)
        if (method === 'run') {
          const r = stmt.run(...(params as never[]))
          return { rows: [{ changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }] }
        }
        if (method === 'get') {
          const row = stmt.get(...(params as never[]))
          // drizzle does `clientResult.rows` and hands that straight to the
          // field mapper, so a hit is the row's values in column order and a
          // miss is undefined. An array here would be read as "row whose first
          // column is an array", i.e. every field null.
          if (row === undefined) return { rows: undefined as unknown as unknown[] }
          return { rows: Object.values(row) as unknown as unknown[] }
        }
        return {
          rows: stmt.all(...(params as never[])).map((row) => Object.values(row)),
        }
      },
      { schema },
    )
  }
  return instance
}
