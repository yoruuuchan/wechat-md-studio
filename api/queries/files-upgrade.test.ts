import { afterAll, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { and, eq } from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A database written before anonymous uploads existed has no `files.visitor`
 * column. `getDb()` adds it with ALTER TABLE, which appends the column at the
 * end — while drizzle maps sqlite-proxy rows *positionally* against the order
 * declared in db/schema.ts. If those two orders ever disagree, every read of an
 * upgraded database comes back with the wrong values in the wrong fields, and
 * nothing throws. This test pins the pair down.
 */
const dbFile = path.join(os.tmpdir(), `mopai-upgrade-${process.pid}-${Date.now()}.db`)

// The pre-anonymous shape, byte for byte what the first release created.
const legacy = new DatabaseSync(dbFile)
legacy.exec(`
  CREATE TABLE files (
    key TEXT PRIMARY KEY,
    ownerId INTEGER NOT NULL,
    name TEXT,
    size INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );
  INSERT INTO files (key, ownerId, name, size, createdAt)
    VALUES ('legacy-key', 1, 'mopai/1/photo.png', 2048, 1700000000);
`)
legacy.close()

process.env.DATABASE_URL = `file:${dbFile}`

const { getDb, getSqlite } = await import('./connection')
const { files } = await import('../../db/schema')

afterAll(() => {
  // getDb() keeps the handle open for the process lifetime, and Windows will
  // not unlink an open file — a leftover temp file is not a test failure.
  try {
    fs.rmSync(dbFile, { force: true })
  } catch {
    // ignore
  }
})

describe('upgrading a pre-anonymous database', () => {
  it('adds the visitor column and still reads every field into the right place', async () => {
    const rows = await getDb().select().from(files)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row.key).toBe('legacy-key')
    expect(row.ownerId).toBe(1)
    expect(row.name).toBe('mopai/1/photo.png')
    expect(row.size).toBe(2048)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.visitor).toBe(null)
  })

  it('keeps one anonymous visitor from reading another one’s uploads', async () => {
    const db = getDb()
    await db.insert(files).values({
      key: 'anon-key',
      ownerId: 0,
      visitor: 'visitor-a',
      name: 'mopai/v/visitor-a/anon.png',
      size: 1024,
      createdAt: new Date(),
    })

    const scope = (visitor: string) => and(eq(files.ownerId, 0), eq(files.visitor, visitor))!

    const mine = await db.select({ key: files.key }).from(files).where(scope('visitor-a'))
    expect(mine.map((r) => r.key)).toEqual(['anon-key'])

    const theirs = await db.select({ key: files.key }).from(files).where(scope('visitor-b'))
    expect(theirs).toEqual([])
  })

  it('creates the anonymous upload reservation table without touching files', () => {
    const columns = (
      getSqlite().prepare('PRAGMA table_info(anon_upload_reservations)').all() as { name: string }[]
    ).map((c) => c.name)
    expect(columns).toEqual([
      'token',
      'visitor',
      'objectKey',
      'bytes',
      'state',
      'createdAt',
      'expiresAt',
    ])
    // The upgrade is additive: `files` keeps its established column order,
    // which the positional sqlite-proxy driver depends on.
    const fileColumns = (getSqlite().prepare('PRAGMA table_info(files)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(fileColumns).toEqual(['key', 'ownerId', 'name', 'size', 'createdAt', 'visitor'])
  })
})
