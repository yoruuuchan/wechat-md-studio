import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { RemoteMcpCredentials, RemoteMcpDoc, RemoteMcpSnapshot, RemoteMcpWriteResult } from '@contracts/remote-mcp'
import { contentHash } from '@/lib/content-hash'
import { createDoc, type DocRecord } from '@/lib/store'
import { remoteSyncDecision } from '@/lib/remote-mcp-sync'
import { t } from '@/lib/i18n'

type Phase = 'off' | 'synced' | 'saving' | 'error' | 'conflict'
class RequestError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`/api/remote-mcp/connections${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok && response.status !== 409) {
    throw new RequestError(response.status, result.error || t('mcp.err.service'))
  }
  return result as T
}

const pathOf = (id: string) => `/${encodeURIComponent(id)}`
const bindingOf = (snapshot: RemoteMcpSnapshot) => ({
  id: snapshot.connection.id, baseHash: snapshot.doc.hash, name: snapshot.doc.name,
})

/** Current-document collaboration. Bodies always persist through useDocs/setDocs. */
export function useRemoteMcp({ docs, activeId, setDocs }: {
  docs: DocRecord[]; activeId: string; setDocs: Dispatch<SetStateAction<DocRecord[]>>
}) {
  const [phase, setPhase] = useState<{ id: string; value: Phase }>({ id: '', value: 'off' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [credentials, setCredentials] = useState<RemoteMcpCredentials | null>(null)
  const [snapshot, setSnapshot] = useState<RemoteMcpSnapshot | null>(null)
  const [conflicts, setConflicts] = useState<Map<string, RemoteMcpDoc>>(new Map())
  const docsRef = useRef(docs)
  docsRef.current = docs
  const conflictsRef = useRef(conflicts)
  conflictsRef.current = conflicts
  const runningRef = useRef<Promise<void> | null>(null)
  const mutatingRef = useRef(false)
  const current = docs.find((d) => d.id === activeId)

  const markConflict = useCallback((id: string, remote: RemoteMcpDoc) => {
    setConflicts((prev) => new Map(prev).set(id, remote))
    setPhase({ id, value: 'conflict' })
  }, [])
  const clearConflict = useCallback((id: string) => {
    setConflicts((prev) => { const next = new Map(prev); next.delete(id); return next })
  }, [])

  const detach = useCallback((id: string, connectionId: string, finalDoc?: RemoteMcpDoc | null) => {
    const knownConflict = conflictsRef.current.get(id)
    setDocs((prev) => {
      const local = prev.find((d) => d.id === id)
      if (!local || local.remoteMcp?.id !== connectionId) return prev
      const remote = finalDoc ?? knownConflict
      const next = prev.map((d) => d.id === id ? { ...d, remoteMcp: null } : d)
      // On disconnect keep any already-observed divergent AI version too. A
      // server-side expiry/revocation never discards the browser's own body.
      if (remote && remote.content !== local.content) {
        next.push({ ...createDoc(), name: `${remote.name.slice(0, 188)}${t('mcp.version.ai')}`, content: remote.content })
      }
      return next
    })
    clearConflict(id)
    setCredentials((prev) => prev?.connection.id === connectionId ? null : prev)
    setSnapshot((prev) => prev?.connection.id === connectionId ? null : prev)
    setPhase({ id, value: 'off' })
  }, [setDocs, clearConflict])

  const applyRemote = useCallback((id: string, snap: RemoteMcpSnapshot, expected?: DocRecord) => {
    setDocs((prev) => {
      const local = prev.find((d) => d.id === id)
      if (!local || local.remoteMcp?.id !== snap.connection.id) return prev
      // Recheck after every network/hash await: typing must win over a late read.
      if (expected && (local.content !== expected.content || local.name !== expected.name)) return prev
      if (local.content === snap.doc.content && local.name === snap.doc.name && local.remoteMcp.baseHash === snap.doc.hash && local.remoteMcp.name === snap.doc.name) return prev
      return prev.map((d) => d.id === id
        ? { ...d, content: snap.doc.content, name: snap.doc.name, updatedAt: snap.doc.updatedAt, remoteMcp: bindingOf(snap) } : d)
    })
  }, [setDocs])

  const tick = useCallback(async (id: string) => {
    const local = docsRef.current.find((d) => d.id === id)
    if (!local?.remoteMcp || conflictsRef.current.has(id)) return
    const binding = local.remoteMcp
    try {
      const remote = await request<RemoteMcpSnapshot | null>(pathOf(id))
      if (!remote || remote.connection.id !== binding.id) {
        detach(id, binding.id)
        setError(t('mcp.err.revoked'))
        return
      }
      const hash = await contentHash(local.content)
      const live = docsRef.current.find((d) => d.id === id)
      if (live?.remoteMcp?.id !== binding.id || live.content !== local.content || live.name !== local.name) return
      setSnapshot(remote)
      const decision = remoteSyncDecision(hash, local.name, binding, remote.doc)
      if (decision === 'conflict') { markConflict(id, remote.doc); return }
      if (decision === 'apply' || decision === 'synced') {
        applyRemote(id, remote, local)
      } else {
        setPhase({ id, value: 'saving' })
        const result = await request<RemoteMcpWriteResult>(pathOf(id), 'PUT', {
          connectionId: binding.id, name: local.name, content: local.content, baseHash: binding.baseHash,
        })
        if (!result.ok) { markConflict(id, result.current); return }
        setDocs((prev) => prev.map((d) => d.id === id && d.remoteMcp?.id === binding.id
          ? { ...d, name: d.name === local.name ? result.doc.name : d.name, remoteMcp: { id: binding.id, baseHash: result.doc.hash, name: result.doc.name } }
          : d))
        setSnapshot({ ...remote, doc: result.doc })
      }
      setError(null)
      setPhase({ id, value: 'synced' })
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 410) detach(id, binding.id)
      else setPhase({ id, value: 'error' })
      setError(cause instanceof RequestError ? cause.message : t('mcp.err.network'))
    }
  }, [detach, applyRemote, markConflict, setDocs])

  const scheduleTick = useCallback((id: string) => {
    if (runningRef.current || mutatingRef.current) return
    const job = tick(id).finally(() => { if (runningRef.current === job) runningRef.current = null })
    runningRef.current = job
  }, [tick])

  const bindingId = current?.remoteMcp?.id
  useEffect(() => {
    setError(null)
    if (!bindingId) return
    scheduleTick(activeId)
    const timer = window.setInterval(() => scheduleTick(activeId), 2000)
    const focus = () => scheduleTick(activeId)
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [activeId, bindingId, scheduleTick])

  useEffect(() => {
    if (!bindingId) return
    const timer = window.setTimeout(() => scheduleTick(activeId), 700)
    return () => window.clearTimeout(timer)
  }, [activeId, bindingId, current?.content, current?.name, scheduleTick])

  const mutate = useCallback(async (action: () => Promise<void>) => {
    if (mutatingRef.current) return
    mutatingRef.current = true
    setBusy(true)
    setError(null)
    try {
      await runningRef.current
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mcp.err.generic'))
    } finally {
      mutatingRef.current = false
      setBusy(false)
    }
  }, [])

  const create = useCallback(() => mutate(async () => {
    const local = docsRef.current.find((d) => d.id === activeId)
    if (!local || local.contentLoaded === false) return
    const result = await request<RemoteMcpSnapshot & { endpoint: string; token: string | null }>('', 'POST', {
      localDocId: local.id, name: local.name, content: local.content,
    })
    setDocs((prev) => prev.map((d) => d.id === local.id ? { ...d, remoteMcp: bindingOf(result) } : d))
    setSnapshot(result)
    if (result.token) setCredentials({ ...result, token: result.token })
    // Rejoining an existing lease has no known common base. Show differences
    // explicitly instead of treating a stale local copy as permission to overwrite.
    if (!result.token && (result.doc.content !== local.content || result.doc.name !== local.name)) {
      markConflict(local.id, result.doc)
    } else setPhase({ id: local.id, value: 'synced' })
  }), [activeId, mutate, setDocs, markConflict])

  const rotate = useCallback(() => mutate(async () => {
    const local = docsRef.current.find((d) => d.id === activeId)
    if (!local?.remoteMcp) return
    const result = await request<RemoteMcpCredentials>(`${pathOf(activeId)}/rotate`, 'POST', { connectionId: local.remoteMcp.id })
    setCredentials(result)
    setSnapshot(result)
  }), [activeId, mutate])

  const revoke = useCallback(() => mutate(async () => {
    const local = docsRef.current.find((d) => d.id === activeId)
    if (!local?.remoteMcp) return
    const result = await request<{ ok: true; doc: RemoteMcpDoc | null }>(pathOf(activeId), 'DELETE', { connectionId: local.remoteMcp.id })
    detach(activeId, local.remoteMcp.id, result.doc)
  }), [activeId, mutate, detach])

  const resolve = useCallback((choice: 'local' | 'remote' | 'both') => mutate(async () => {
    const local = docsRef.current.find((d) => d.id === activeId)
    if (!local?.remoteMcp) return
    const remote = await request<RemoteMcpSnapshot | null>(pathOf(activeId))
    if (!remote || remote.connection.id !== local.remoteMcp.id) { detach(activeId, local.remoteMcp.id); return }
    if (choice === 'local') {
      const result = await request<RemoteMcpWriteResult>(pathOf(activeId), 'PUT', {
        connectionId: local.remoteMcp.id, name: local.name, content: local.content, baseHash: remote.doc.hash,
      })
      if (!result.ok) { markConflict(activeId, result.current); return }
      setDocs((prev) => prev.map((d) => d.id === activeId && d.remoteMcp?.id === local.remoteMcp?.id
        ? { ...d, remoteMcp: { id: remote.connection.id, baseHash: result.doc.hash, name: result.doc.name } } : d))
      setSnapshot({ ...remote, doc: result.doc })
    } else {
      setDocs((prev) => {
        const live = prev.find((d) => d.id === activeId)
        if (!live || live.remoteMcp?.id !== remote.connection.id) return prev
        // Keep-both takes the latest local body, including typing during the read.
        if (choice === 'remote' && (live.content !== local.content || live.name !== local.name)) return prev
        const next = prev.map((d) => d.id === activeId ? { ...d, ...remote.doc, remoteMcp: bindingOf(remote) } : d)
        if (choice === 'both') next.push({ ...createDoc(), name: `${live.name.slice(0, 186)}${t('mcp.version.local')}`, content: live.content })
        return next
      })
      setSnapshot(remote)
    }
    clearConflict(activeId)
    setPhase({ id: activeId, value: 'synced' })
  }), [activeId, mutate, detach, markConflict, setDocs, clearConflict])

  return {
    phase: current?.remoteMcp ? (phase.id === activeId ? phase.value : 'saving') : 'off',
    error, busy,
    credentials: credentials?.connection.localDocId === activeId ? credentials : null,
    snapshot: snapshot?.connection.localDocId === activeId ? snapshot : null,
    conflict: conflicts.get(activeId) ?? null,
    create, rotate, revoke, resolve,
  }
}
