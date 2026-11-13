import { describe, expect, it } from 'vitest'
import { bodyReadiness } from './body-readiness'

const loaded = { contentLoaded: true, bodyState: undefined } as const
const legacy = {} as const
const stub = { contentLoaded: false, bodyState: 'stub' } as const
const readFailed = { contentLoaded: false, bodyState: 'read-failed' } as const
const missing = { contentLoaded: false, bodyState: 'missing' } as const

describe('bodyReadiness', () => {
  it('treats a loaded record without a body state as the article', () => {
    expect(bodyReadiness({ doc: loaded })).toEqual({
      state: 'ready',
      readable: true,
      reasonKey: null,
      retry: null,
    })
  })

  it('keeps older records readable when contentLoaded was never written', () => {
    expect(bodyReadiness({ doc: legacy }).readable).toBe(true)
  })

  it('does not claim a body before the list has loaded', () => {
    const readiness = bodyReadiness({ doc: null })
    expect(readiness.readable).toBe(false)
    expect(readiness.state).toBe('loading')
    expect(readiness.reasonKey).toBe('docs.bodyLoading')
  })

  it('shows a stub as loading while the account fetch runs', () => {
    const readiness = bodyReadiness({ doc: stub, hydrating: true, enabled: true })
    expect(readiness).toMatchObject({ state: 'loading', readable: false, retry: null })
  })

  it('shows a stub as loading while the session is still resolving', () => {
    const readiness = bodyReadiness({ doc: stub, enabled: true })
    expect(readiness.state).toBe('loading')
  })

  it('offers a cloud retry after the account fetch failed', () => {
    const readiness = bodyReadiness({ doc: stub, loadFailed: true, enabled: true })
    expect(readiness).toMatchObject({
      state: 'load-failed',
      readable: false,
      reasonKey: 'docs.hydrateFailed',
      retry: 'cloud',
    })
  })

  it('shows a retained stub as unavailable once the author signed out', () => {
    const readiness = bodyReadiness({ doc: stub, enabled: false })
    expect(readiness).toMatchObject({
      state: 'unavailable',
      readable: false,
      reasonKey: 'docs.bodyUnavailable',
      retry: null,
    })
  })

  it('does not offer a cloud retry that the signed-out session cannot run', () => {
    const readiness = bodyReadiness({ doc: stub, loadFailed: true, enabled: false })
    expect(readiness.state).toBe('unavailable')
    expect(readiness.retry).toBeNull()
  })

  it('does not blame the author for a stub while authentication is pending', () => {
    expect(bodyReadiness({ doc: stub, enabled: false, authPending: true }).state).toBe('loading')
  })

  it('keeps a local read failure distinct and retryable locally', () => {
    expect(bodyReadiness({ doc: readFailed, enabled: true })).toMatchObject({
      state: 'read-failed',
      readable: false,
      reasonKey: 'docs.bodyReadFailed',
      retry: 'local',
    })
  })

  it('keeps a missing local body distinct and retryable locally', () => {
    expect(bodyReadiness({ doc: missing, enabled: false })).toMatchObject({
      state: 'missing',
      readable: false,
      reasonKey: 'docs.bodyMissing',
      retry: 'local',
    })
  })

  it('never calls a record with an unloaded body readable', () => {
    for (const doc of [stub, readFailed, missing, { contentLoaded: false, bodyState: undefined }]) {
      expect(bodyReadiness({ doc, enabled: true }).readable).toBe(false)
    }
  })
})