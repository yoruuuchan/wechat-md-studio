import type { SignatureConfig } from './types'
import { SAMPLE_DOC } from './sample'

export interface DocRecord {
  id: string
  name: string
  content: string
  updatedAt: number
  /** When this article was last put into 草稿箱; null = never explicitly saved. */
  savedAt: number | null
  /** In the recycle bin since this timestamp; null = live. */
  deletedAt: number | null
  /** `agent:<token name>` when an agent pushed it through /api/agent; null = written here. */
  source?: string | null
}

export interface AppSettings {
  themeId: string
  sig: SignatureConfig
  /** Editor and preview scroll together. Defaults to on; persisted per browser. */
  syncScroll: boolean
}

const DOCS_KEY = 'mopai.docs.v1'
const ACTIVE_KEY = 'mopai.active.v1'
const SETTINGS_KEY = 'mopai.settings.v1'
/** One-time migration marker: browsers whose storage predates the sample. */
const SAMPLE_SEEDED_KEY = 'mopai.sample.v1'
const SAMPLE_MARKER = '欢迎使用公众号排版助手'

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Empty means "nothing but the front-matter skeleton": the old blank default. */
function bodyIsEmpty(content: string): boolean {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim() === ''
}

export function loadDocs(): { docs: DocRecord[]; activeId: string } {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    const activeId = localStorage.getItem(ACTIVE_KEY) || ''
    if (raw) {
      const docs = JSON.parse(raw) as DocRecord[]
      if (Array.isArray(docs) && docs.length) {
        // Tolerate records written before savedAt / deletedAt / source existed.
        let out: DocRecord[] = docs.map((d) => ({
          ...d,
          savedAt: d.savedAt ?? null,
          deletedAt: d.deletedAt ?? null,
          source: d.source ?? null,
        }))
        let active = out.some((d) => d.id === activeId) ? activeId : out[0].id
        // Browsers that stored docs before the sample existed keep their old
        // blank default forever otherwise — and a blank active article also
        // makes every theme thumbnail in the picker render as empty paper.
        if (!localStorage.getItem(SAMPLE_SEEDED_KEY)) {
          localStorage.setItem(SAMPLE_SEEDED_KEY, '1')
          let sample = out.find((d) => d.content.includes(SAMPLE_MARKER))
          if (!sample) {
            sample = createSampleDoc()
            out = [sample, ...out]
          }
          const current = out.find((d) => d.id === active)
          if (!current || bodyIsEmpty(current.content)) active = sample.id
          saveDocs(out, active)
        }
        return { docs: out, activeId: active }
      }
    }
  } catch {
    // fallthrough
  }
  const first = createSampleDoc()
  try {
    localStorage.setItem(SAMPLE_SEEDED_KEY, '1')
  } catch {
    // 存储失败不阻塞编辑
  }
  return { docs: [first], activeId: first.id }
}

export function saveDocs(docs: DocRecord[], activeId: string) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
    localStorage.setItem(ACTIVE_KEY, activeId)
  } catch {
    // 存储失败不阻塞编辑
  }
}

/** 当前选中的稿件 id。服务器接管后它只用来记住「上次看的是哪篇」。 */
export function loadActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveActiveId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // 忽略
  }
}

export function loadSettings(): AppSettings {
  const def: AppSettings = {
    themeId: 'golden',
    sig: { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' },
    syncScroll: true,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...def, ...(JSON.parse(raw) as AppSettings) }
  } catch {
    // fallthrough
  }
  return def
}

export function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // 忽略
  }
}

export function createDoc(): DocRecord {
  return {
    id: uid(),
    name: '未命名稿件',
    content: '---\ntitles:\n  - \n---\n\n',
    updatedAt: Date.now(),
    savedAt: null,
    deletedAt: null,
  }
}

export function createSampleDoc(): DocRecord {
  return {
    id: uid(),
    name: '示例稿 · 语法速览',
    content: SAMPLE_DOC,
    updatedAt: Date.now(),
    savedAt: null,
    deletedAt: null,
  }
}
