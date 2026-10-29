import { createHash, randomBytes } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { RemoteMcpDoc, RemoteMcpSnapshot, RemoteMcpWriteResult } from '@contracts/remote-mcp'
import { getSqlite } from '../queries/connection'
import { documentHash } from './doc-hash'
import { env } from './env'

const MAX_VISITOR_CONNECTIONS = 5
const MAX_CONNECTIONS = 200

interface Lease {
  id: string
  visitor: string
  source: string | null
  localDocId: string
  docId: string
  tokenHash: string
  createdAt: number
  expiresAt: number
}

export class RemoteMcpError extends Error {
  constructor(public status: 410 | 413 | 429, message: string) {
    super(message)
  }
}

/** Hash only: the raw bearer is returned once and never stored on the server. */
export function mcpTokenHash(token: string): string {
  return createHash('sha256').update(`mopai-mcp:${token}`).digest('hex')
}

/** Keep source addresses out of lease rows while preserving a stable budget key. */
export function mcpSourceKey(ip: string): string {
  return createHash('sha256').update(`mopai-mcp-source:${ip}`).digest('hex').slice(0, 32)
}

function mintToken(): string {
  return `mopai_mcp_${randomBytes(32).toString('base64url')}`
}

function transaction<T>(action: () => T): T {
  const db = getSqlite()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function readDoc(lease: Lease): RemoteMcpDoc {
  const row = getSqlite().prepare(
    'SELECT name, content, hash, updatedAt FROM docs WHERE id = ? AND ownerId = 0',
  ).get(lease.docId) as { name: string; content: string; hash: string | null; updatedAt: number } | undefined
  if (!row) throw new RemoteMcpError(410, '连接已失效，本地稿件仍可正常编辑')
  return {
    ...row,
    hash: row.hash ?? documentHash(row.name, row.content),
    updatedAt: row.updatedAt * 1000,
  }
}

function snapshot(lease: Lease): RemoteMcpSnapshot {
  return {
    connection: { id: lease.id, localDocId: lease.localDocId, expiresAt: lease.expiresAt },
    doc: readDoc(lease),
  }
}

function findVisitorLease(visitor: string, localDocId: string, now = Date.now()): Lease | null {
  return getSqlite().prepare(
    'SELECT * FROM remote_mcp_connections WHERE visitor = ? AND localDocId = ? AND expiresAt > ?',
  ).get(visitor, localDocId, now) as Lease | undefined ?? null
}

export function findTokenLease(token: string, now = Date.now()): Lease | null {
  if (!/^mopai_mcp_[A-Za-z0-9_-]{43}$/.test(token)) return null
  return getSqlite().prepare(
    'SELECT * FROM remote_mcp_connections WHERE tokenHash = ? AND expiresAt > ?',
  ).get(mcpTokenHash(token), now) as Lease | undefined ?? null
}

export function readVisitorConnection(visitor: string, localDocId: string): RemoteMcpSnapshot | null {
  const lease = findVisitorLease(visitor, localDocId)
  return lease ? snapshot(lease) : null
}

export function readTokenConnection(token: string): RemoteMcpSnapshot {
  const lease = findTokenLease(token)
  if (!lease) throw new RemoteMcpError(410, '授权已撤销或到期，请在浏览器重新创建连接')
  return snapshot(lease)
}

/** Hard byte cap is checked inside the same transaction as every body write. */
function checkBodyQuota(content: string, replacingDocId = ''): void {
  const { bytes } = getSqlite().prepare(`
    SELECT coalesce(sum(length(cast(content AS BLOB))), 0) AS bytes
    FROM docs WHERE ownerId = 0 AND id != ?
      AND id IN (SELECT docId FROM remote_mcp_connections)
  `).get(replacingDocId) as { bytes: number }
  if (bytes + Buffer.byteLength(content, 'utf8') > env.remoteMcpTotalBytes) {
    throw new RemoteMcpError(429, '临时协作空间已满，请稍后再试；本地稿件已保留')
  }
}

export function createVisitorConnection(
  visitor: string,
  input: { localDocId: string; name: string; content: string },
  source: string,
  now = Date.now(),
): { snapshot: RemoteMcpSnapshot; token: string | null } {
  cleanupExpiredConnections()
  return transaction(() => {
    // A retry or second tab must never replace a copy the AI has already edited.
    const existing = findVisitorLease(visitor, input.localDocId)
    if (existing) return { snapshot: snapshot(existing), token: null }
    const { total, own, sourceActive } = getSqlite().prepare(`
      SELECT
        count(*) AS total,
        coalesce(sum(visitor = ?), 0) AS own,
        coalesce(sum(source = ?), 0) AS sourceActive
      FROM remote_mcp_connections
      WHERE expiresAt > ?
    `).get(visitor, source, now) as { total: number; own: number; sourceActive: number }
    if (own >= MAX_VISITOR_CONNECTIONS || total >= MAX_CONNECTIONS) {
      throw new RemoteMcpError(429, '连接数量已达上限，请先撤销不用的连接')
    }
    if (sourceActive >= env.remoteMcpMaxActivePerSource) {
      console.warn(`[remote-mcp-deny] reason=source-active source=${source.slice(0, 12)}`)
      throw new RemoteMcpError(
        429,
        '这个网络创建的临时协作连接太多，请先撤销不用的连接或稍后再试',
      )
    }

    const day = new Date(now).toISOString().slice(0, 10)
    const used = getSqlite().prepare(
      'SELECT count FROM remote_mcp_source_budget WHERE source = ? AND day = ?',
    ).get(source, day) as { count: number } | undefined
    if ((used?.count ?? 0) >= env.remoteMcpCreatesPerSourcePerDay) {
      console.warn(`[remote-mcp-deny] reason=source-daily source=${source.slice(0, 12)}`)
      throw new RemoteMcpError(429, '这个网络今天创建的临时协作连接较多，请稍后再试')
    }

    checkBodyQuota(input.content)
    const token = mintToken()
    const lease: Lease = {
      id: nanoid(), visitor, source, localDocId: input.localDocId, docId: nanoid(),
      tokenHash: mcpTokenHash(token), createdAt: now,
      expiresAt: now + env.remoteMcpTtlHours * 3600_000,
    }
    getSqlite().prepare(`
      INSERT INTO docs (id, ownerId, name, content, createdAt, updatedAt, savedAt, deletedAt, source, hash)
      VALUES (?, 0, ?, ?, ?, ?, NULL, NULL, 'mcp', ?)
    `).run(lease.docId, input.name, input.content, Math.floor(now / 1000), Math.floor(now / 1000), documentHash(input.name, input.content))
    getSqlite().prepare(`
      INSERT INTO remote_mcp_connections
        (id, visitor, localDocId, docId, tokenHash, createdAt, expiresAt, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lease.id,
      lease.visitor,
      lease.localDocId,
      lease.docId,
      lease.tokenHash,
      lease.createdAt,
      lease.expiresAt,
      lease.source,
    )
    getSqlite().prepare(`
      INSERT INTO remote_mcp_source_budget (source, day, count) VALUES (?, ?, 1)
      ON CONFLICT(source, day) DO UPDATE SET count = count + 1
    `).run(source, day)
    return { snapshot: snapshot(lease), token }
  })
}

export function rotateVisitorToken(visitor: string, localDocId: string, connectionId: string) {
  const lease = findVisitorLease(visitor, localDocId)
  if (!lease || lease.id !== connectionId) throw new RemoteMcpError(410, '连接已失效，请重新创建')
  const token = mintToken()
  getSqlite().prepare('UPDATE remote_mcp_connections SET tokenHash = ? WHERE id = ?')
    .run(mcpTokenHash(token), lease.id)
  return { ...snapshot(lease), token }
}

function writeLease(lease: Lease, input: { name?: string; content: string; baseHash: string }): RemoteMcpWriteResult {
  return transaction(() => {
    const current = readDoc(lease)
    if (input.baseHash !== current.hash) return { ok: false, error: 'conflict', current }
    checkBodyQuota(input.content, lease.docId)
    const name = input.name?.trim() || current.name
    const hash = documentHash(name, input.content)
    const updatedAt = Math.floor(Date.now() / 1000)
    const result = getSqlite().prepare(`
      UPDATE docs SET name = ?, content = ?, hash = ?, updatedAt = ?
      WHERE id = ? AND ownerId = 0 AND hash = ?
        AND EXISTS (SELECT 1 FROM remote_mcp_connections WHERE id = ? AND expiresAt > ?)
    `).run(name, input.content, hash, updatedAt, lease.docId, input.baseHash, lease.id, Date.now())
    if (!result.changes) throw new RemoteMcpError(410, '授权已撤销或到期，本地稿件已保留')
    return { ok: true, doc: { name, content: input.content, hash, updatedAt: updatedAt * 1000 } }
  })
}

export function writeVisitorDoc(
  visitor: string, localDocId: string, connectionId: string,
  input: { name: string; content: string; baseHash: string },
): RemoteMcpWriteResult {
  const lease = findVisitorLease(visitor, localDocId)
  if (!lease || lease.id !== connectionId) throw new RemoteMcpError(410, '连接已失效，本地稿件仍可正常编辑')
  return writeLease(lease, input)
}

export function writeTokenDoc(token: string, input: { name?: string; content: string; baseHash: string }) {
  // Check at tool execution as well as HTTP entry: revocation wins an in-flight request too.
  const lease = findTokenLease(token)
  if (!lease) throw new RemoteMcpError(410, '授权已撤销或到期，请重新创建连接')
  return writeLease(lease, input)
}

export function revokeVisitorConnection(visitor: string, localDocId: string, connectionId: string): RemoteMcpDoc | null {
  return transaction(() => {
    const lease = findVisitorLease(visitor, localDocId)
    if (!lease || lease.id !== connectionId) return null
    const doc = readDoc(lease)
    getSqlite().prepare('DELETE FROM remote_mcp_connections WHERE id = ?').run(lease.id)
    getSqlite().prepare('DELETE FROM docs WHERE id = ? AND ownerId = 0').run(lease.docId)
    return doc
  })
}

/** Access expires immediately; periodic cleanup removes the temporary body too. */
export function cleanupExpiredConnections(now = Date.now()): number {
  return transaction(() => {
    getSqlite().prepare(`DELETE FROM docs WHERE ownerId = 0 AND id IN (
      SELECT docId FROM remote_mcp_connections WHERE expiresAt <= ?
    )`).run(now)
    const removed = Number(
      getSqlite().prepare('DELETE FROM remote_mcp_connections WHERE expiresAt <= ?').run(now).changes,
    )
    const day = new Date(now).toISOString().slice(0, 10)
    getSqlite().prepare('DELETE FROM remote_mcp_source_budget WHERE day < ?').run(day)
    return removed
  })
}

export function startRemoteMcpCleanup(): void {
  cleanupExpiredConnections()
  const timer = setInterval(() => {
    try { cleanupExpiredConnections() } catch { console.error('[remote-mcp] expiry cleanup failed') }
  }, 60_000)
  timer.unref()
}
