/** Browser metadata contains no bearer credentials and no duplicate body. */
export interface RemoteMcpBinding {
  id: string
  baseHash: string
  name: string
}

export interface RemoteMcpConnection {
  id: string
  localDocId: string
  expiresAt: number
}

export interface RemoteMcpDoc {
  name: string
  content: string
  hash: string
  updatedAt: number
}

export interface RemoteMcpSnapshot {
  connection: RemoteMcpConnection
  doc: RemoteMcpDoc
}

export interface RemoteMcpCredentials extends RemoteMcpSnapshot {
  endpoint: string
  token: string
}

export type RemoteMcpWriteResult =
  | { ok: true; doc: RemoteMcpDoc }
  | { ok: false; error: 'conflict'; current: RemoteMcpDoc }

export const REMOTE_MCP_MAX_CHARS = 2_000_000
export const WRITING_SKILL_URL = 'https://wechat.yoru-and-akari.dev/skill.md'
