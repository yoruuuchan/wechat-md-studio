import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-mcp-upgrade-'))
const file = path.join(dir, 'legacy.db')
const legacy = new DatabaseSync(file)
legacy.exec(`
  CREATE TABLE files (key TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, name TEXT, size INTEGER NOT NULL, createdAt INTEGER NOT NULL);
  CREATE TABLE docs (id TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
  INSERT INTO docs VALUES ('owner-article', 1, '旧稿件', '不能丢失的旧正文', 100, 101);
`)
legacy.close()
process.env.DATABASE_URL = `file:${file}`
const { getDb, getSqlite } = await import('./connection')
const { docs } = await import('../../db/schema')
const { cleanupExpiredConnections } = await import('../lib/remote-mcp')

describe('MCP upgrade of an existing SQLite database', () => {
  it('adds only the lease table and keeps old articles mapped correctly', async () => {
    const [doc] = await getDb().select().from(docs)
    expect(doc.name).toBe('旧稿件')
    expect(doc.content).toBe('不能丢失的旧正文')
    expect(doc.ownerId).toBe(1)
    expect(doc.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(getSqlite().prepare('SELECT count(*) AS n FROM remote_mcp_connections').get()!.n).toBe(0)
  })
  it('does not clean up owner articles or unleased bodies', () => {
    expect(cleanupExpiredConnections(Date.now() + 1000_000_000)).toBe(0)
    expect(getSqlite().prepare('SELECT content FROM docs WHERE id = ?').get('owner-article')!.content).toBe('不能丢失的旧正文')
  })
})
