import type { RemoteMcpBinding, RemoteMcpDoc } from '@contracts/remote-mcp'

/** Three-way comparison: the local edit, acknowledged base, and remote edit. */
export function remoteSyncDecision(
  localHash: string, localName: string, base: RemoteMcpBinding, remote: RemoteMcpDoc,
): 'synced' | 'apply' | 'push' | 'conflict' {
  if (localHash === remote.hash && localName === remote.name) return 'synced'
  if (localHash === base.baseHash && localName === base.name) return 'apply'
  if (remote.hash === base.baseHash && remote.name === base.name) return 'push'
  return 'conflict'
}
