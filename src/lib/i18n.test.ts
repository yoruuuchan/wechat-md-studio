import { describe, expect, it } from 'vitest'
import { zh, type Msg, type MsgKey } from './i18n.zh'
import { en } from './i18n.en'
import { currentLang, setLanguage, t } from './i18n'

/**
 * The English table is typed against the Chinese one, so a missing key is a
 * compile error already; these tests re-check at runtime and pin the two rules
 * typing cannot express: placeholder parity, and that English copy really is
 * English.
 */

function referencedNames(value: Msg): Set<string> {
  if (typeof value === 'function') {
    const seen = new Set<string>()
    value(
      new Proxy(
        {},
        {
          get: (_target, key) => {
            if (typeof key === 'string') seen.add(key)
            return 0
          },
        },
      ),
    )
    return seen
  }
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
}

const KEYS = Object.keys(zh) as MsgKey[]

describe('i18n dictionaries', () => {
  it('cover exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual([...KEYS].sort())
  })

  it('never drops an interpolation function that Chinese defines', () => {
    // English may add functions for plurals on top of Chinese strings, but it
    // must not turn a Chinese function back into a static string.
    for (const key of KEYS) {
      if (typeof zh[key] === 'function') expect(typeof en[key], key).toBe('function')
    }
  })

  it('use the same interpolation names on both sides', () => {
    for (const key of KEYS) {
      const zhNames = referencedNames(zh[key])
      const enNames = referencedNames(en[key])
      expect([...enNames].sort(), `en extras for ${key}`).toEqual([...zhNames].sort())
    }
  })

  it('keeps English copy free of Chinese characters (except the language label itself)', () => {
    const cjk = /[\u3400-\u9fff]/
    const allowed = new Set<string>(['lang.zh'])
    for (const key of KEYS) {
      if (allowed.has(key)) continue
      const value = en[key]
      const text = typeof value === 'string' ? value : String(value({ n: 2, w: 0, h: 0, chars: 0, imgs: 0 }))
      expect(cjk.test(text), `${key}: ${text}`).toBe(false)
    }
  })

  it('switches and interpolates through t()', () => {
    const before = currentLang()
    try {
      setLanguage('zh')
      expect(t('common.cancel')).toBe('取消')
      expect(t('refs.projects', { n: 1 })).toBe('1 个项目')
      setLanguage('en')
      expect(t('common.cancel')).toBe('Cancel')
      expect(t('refs.projects', { n: 1 })).toBe('1 project')
      expect(t('refs.projects', { n: 3 })).toBe('3 projects')
      expect(t('editor.toast.copied', { chars: 120, imgs: 1 })).toBe('Copied 120 chars · 1 image')
    } finally {
      setLanguage(before)
    }
  })

  it('leaves unknown placeholders untouched rather than printing undefined', () => {
    const before = currentLang()
    try {
      setLanguage('zh')
      // 「这条会显示 {missing} 原文」不存在；用真 key 验证缺参行为。
      expect(t('drafts.count')).toBe('{n} 篇')
    } finally {
      setLanguage(before)
    }
  })
})
