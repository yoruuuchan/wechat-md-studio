/**
 * Public card templates shipped by Reed itself.
 *
 * The archives live under `public/card-templates/` and are built from
 * `card-templates/public/<id>/` at build time. They are never imported into the
 * card runtime directly: `useCardTemplates` fetches the zip and hands it to the
 * same `parseCardTemplateSource` / `activateCardTemplate` path as a local
 * upload. Source and upload instances therefore have separate runtime ids and
 * cannot replace each other even when two manifests share an `id`.
 */
import type { CardTemplateSummary } from './card-template-format'
import type { CardRatio } from './cards'

export const PUBLIC_CARD_TEMPLATE_PREFIX = 'custom.public-'

export interface PublicCardTemplate {
  /** Manifest id inside the archive. */
  id: string
  name: string
  author: string
  description: string
  reference: string
  license: 'MIT'
  sourceUrl: string
  /** Static path copied from `public/` by Vite. */
  pack: string
  ratios: readonly CardRatio[]
  variants: readonly { id: string; name: string }[]
}

export const PUBLIC_CARD_TEMPLATES: readonly PublicCardTemplate[] = [
  {
    id: 'swiss-grid',
    name: 'Swiss Grid · 瑞士秩序',
    author: 'Reed · 改编自 geekfoxcharlie/XHS-TextCard（MIT）',
    description: '瑞士平面风格的秩序感：严格左对齐、粗细分明的无衬线标题、橙色方形强调与克制的灰白页面。',
    reference: 'geekfoxcharlie/XHS-TextCard · swiss-studio.json',
    license: 'MIT',
    sourceUrl: 'https://github.com/geekfoxcharlie/XHS-TextCard/blob/main/templates/swiss-studio.json',
    pack: '/card-templates/swiss-grid.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'day', name: '日光' }, { id: 'ink', name: '墨夜' }],
  },
  {
    id: 'editorial-white',
    name: 'Editorial White · 纸页杂志',
    author: 'Reed · 改编自 geekfoxcharlie/XHS-TextCard（MIT）',
    description: '纸页杂志的社论气质：衬线大标题、宽留白和一条酒红色细线。',
    reference: 'geekfoxcharlie/XHS-TextCard · minimalist-magazine.json',
    license: 'MIT',
    sourceUrl: 'https://github.com/geekfoxcharlie/XHS-TextCard/blob/main/templates/minimalist-magazine.json',
    pack: '/card-templates/editorial-white.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'paper', name: '纸白' }],
  },
  {
    id: 'book-notes',
    name: 'Book Notes · 书页摘录',
    author: 'Reed · 改编自 geekfoxcharlie/XHS-TextCard（MIT）',
    description: '暖白纸色、衬线正文和书脊式装订线的阅读笔记版式，适合摘录、书评与长文。',
    reference: 'geekfoxcharlie/XHS-TextCard · elegant-book.json',
    license: 'MIT',
    sourceUrl: 'https://github.com/geekfoxcharlie/XHS-TextCard/blob/main/templates/elegant-book.json',
    pack: '/card-templates/book-notes.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'cream', name: '米纸' }, { id: 'night', name: '夜读' }],
  },
  {
    id: 'aurora',
    name: 'Aurora · 柔光极光',
    author: 'Reed · 改编自 geekfoxcharlie/XHS-TextCard（MIT）',
    description: '只用 CSS 渐变和柔焦色块做出的弥散光背景，正文落在半透明纸片上，适合生活与创意记录。',
    reference: 'geekfoxcharlie/XHS-TextCard · aura-gradient.json',
    license: 'MIT',
    sourceUrl: 'https://github.com/geekfoxcharlie/XHS-TextCard/blob/main/templates/aura-gradient.json',
    pack: '/card-templates/aurora.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'dawn', name: '晨光' }, { id: 'dusk', name: '暮色' }],
  },
  {
    id: 'deep-night',
    name: 'Deep Night · 夜间研究',
    author: 'Reed · 改编自 geekfoxcharlie/XHS-TextCard（MIT）',
    description: '深夜阅读的沉浸暗色：低亮背景、温白正文和冰蓝强调，保留代码、引用与表格的层级。',
    reference: 'geekfoxcharlie/XHS-TextCard · deep-night.json',
    license: 'MIT',
    sourceUrl: 'https://github.com/geekfoxcharlie/XHS-TextCard/blob/main/templates/deep-night.json',
    pack: '/card-templates/deep-night.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'night', name: '深夜' }],
  },
  {
    id: 'doc-frame',
    name: 'Doc Frame · 文档结构',
    author: 'Reed · 改编自 geekfoxcharlie/XHS-TextCard（MIT）',
    description: '技术文档的清晰框架：编号标题、细边表格、蓝灰强调和可扫读的信息层级。',
    reference: 'geekfoxcharlie/XHS-TextCard · pro-doc.json',
    license: 'MIT',
    sourceUrl: 'https://github.com/geekfoxcharlie/XHS-TextCard/blob/main/templates/pro-doc.json',
    pack: '/card-templates/doc-frame.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'paper', name: '纸灰' }, { id: 'ink', name: '墨蓝' }],
  },
  {
    id: 'tech-pulse',
    name: 'Tech Pulse · 科技脉冲',
    author: 'Reed · 改编自 uhhc/md2card（MIT）',
    description: '深蓝到青灰的渐变、克制的技术网格和半透明信息块，适合 AI、产品与工程笔记。',
    reference: 'uhhc/md2card · src/lib/themes/tech-pulse.ts',
    license: 'MIT',
    sourceUrl: 'https://github.com/uhhc/md2card/blob/master/src/lib/themes/tech-pulse.ts',
    pack: '/card-templates/tech-pulse.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'pulse', name: '脉冲' }],
  },
  {
    id: 'fresh-notes',
    name: 'Fresh Notes · 清爽手帐',
    author: 'Reed · 改编自 uhhc/md2card（MIT）',
    description: '薄荷底、圆角便签和轻盈的清单排版，手帐感来自留白、色块与字距，不依赖贴纸素材。',
    reference: 'uhhc/md2card · src/lib/themes/fresh-notes.ts',
    license: 'MIT',
    sourceUrl: 'https://github.com/uhhc/md2card/blob/master/src/lib/themes/fresh-notes.ts',
    pack: '/card-templates/fresh-notes.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'mint', name: '薄荷' }, { id: 'peach', name: '蜜桃' }],
  },
  {
    id: 'pine-notebook',
    name: 'Pine Notebook · 雾松笔记',
    author: 'Reed · 改编自 Haodong Cui/md2card（MIT）',
    description: '松绿与雾白的分层纸面、圆角标题标记和安静的自然阅读节奏。',
    reference: 'Haodong Cui/md2card · src/styles/cards/themes/notebook.css',
    license: 'MIT',
    sourceUrl: 'https://github.com/haodongcui/md2card/blob/main/src/styles/cards/themes/notebook.css',
    pack: '/card-templates/pine-notebook.reedcard',
    ratios: ['3:4', '1:1', '9:16'],
    variants: [{ id: 'pine', name: '雾松' }, { id: 'dusk', name: '松夜' }],
  },
] as const

/** Instance id used by the shared parse/activate path; never a manifest id. */
export function publicCardTemplateInstanceId(id: string): string {
  return `public-${id}`
}

/** Runtime selection id (the existing uploaded-template id namespace). */
export function publicCardTemplateRuntimeId(id: string): string {
  return PUBLIC_CARD_TEMPLATE_PREFIX + id
}

export function isPublicCardTemplateId(template: string): boolean {
  return template.startsWith(PUBLIC_CARD_TEMPLATE_PREFIX)
}

export function publicCardTemplateFor(template: string): PublicCardTemplate | undefined {
  if (!isPublicCardTemplateId(template)) return undefined
  const id = template.slice(PUBLIC_CARD_TEMPLATE_PREFIX.length)
  return PUBLIC_CARD_TEMPLATES.find((item) => item.id === id)
}

/** Summary from static metadata, before the zip has arrived. */
export function publicCardTemplateSummary(item: PublicCardTemplate): CardTemplateSummary {
  return {
    id: item.id,
    template: publicCardTemplateRuntimeId(item.id),
    name: item.name,
    version: '1.0.0',
    author: item.author,
    variants: item.variants,
    ratios: item.ratios,
  }
}