import { describe, expect, it } from 'vitest'
import { CREDITS } from './credits'
import { CREDITS_EN } from './credits.en'

/**
 * The English copy of the credit notes is data that must not drift from
 * `credits.ts`: every credit needs a translation keyed by its repo, with the
 * same shape (array lengths, `declined` presence, `licenseNote` presence). The
 * page falls back to the Chinese text when a key is missing, so this test is
 * what keeps the fallback from silently becoming the normal state.
 */

describe('credits.en', () => {
  it('covers every credit, keyed by repo, with no strays', () => {
    for (const credit of CREDITS) {
      expect(CREDITS_EN[credit.repo], credit.repo).toBeDefined()
    }
    const repos = new Set(CREDITS.map((c) => c.repo))
    for (const key of Object.keys(CREDITS_EN)) {
      expect(repos.has(key), `unknown repo in CREDITS_EN: ${key}`).toBe(true)
    }
  })

  it('mirrors borrowed / declined / licenseNote shapes exactly', () => {
    for (const credit of CREDITS) {
      const en = CREDITS_EN[credit.repo]
      expect(en.borrowed.length, credit.repo).toBe(credit.borrowed.length)
      expect(Boolean(en.declined), credit.repo).toBe(Boolean(credit.declined))
      if (credit.declined) expect(en.declined!.length, credit.repo).toBe(credit.declined.length)
      expect(Boolean(en.licenseNote), credit.repo).toBe(Boolean(credit.licenseNote))
    }
  })

  it('keeps the English text free of Chinese characters', () => {
    const cjk = /[\u3400-\u9fff]/
    for (const [repo, entry] of Object.entries(CREDITS_EN)) {
      for (const text of [...entry.borrowed, ...(entry.declined ?? []), ...(entry.licenseNote ? [entry.licenseNote] : [])]) {
        expect(cjk.test(text), `${repo}: ${text.slice(0, 60)}`).toBe(false)
      }
    }
  })
})
