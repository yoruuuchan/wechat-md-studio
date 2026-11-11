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
    description: '改编自 geekfoxcharlie/XHS-TextCard 的 swiss-studio.json（MIT）。严格瑞士网格：超大粗标题压在左下，橙色模块占住右上网格；正文左栏用大号章号配右栏阅读，结尾以文章题与作者署名收束。',
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
    description: '改编自 geekfoxcharlie/XHS-TextCard 的 minimalist-magazine.json（MIT）。杂志封面式社论：上下双细线夹住衬线大标题，副题当导语；正文首段放大成导语，引文居中排成大号引语，结尾以文章题作引、落作者署名。',
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
    description: '改编自 geekfoxcharlie/XHS-TextCard 的 elegant-book.json（MIT）。书的扉页：布书脊、居中衬线标题和书签丝带；正文首行缩进两字、宽行距，引文作摘录；结尾把标题与作者收进一条长书签。',
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
    description: '改编自 geekfoxcharlie/XHS-TextCard 的 aura-gradient.json（MIT）。满版 CSS 弥散色场托住一张大圆角磨砂卡，标题压在卡内；正文整页落进浅底面板，引用和清单各有气口；结尾只留一个装着文章题的居中胶囊。',
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
    description: '改编自 geekfoxcharlie/XHS-TextCard 的 deep-night.json（MIT）。夜间研究笔记：深底左下标题、一条冰蓝竖轨强调；正文代码与引用沉进更暗面板，h2 前一根短色条；结尾以等宽数字的信息行收束页数。',
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
    description: '改编自 geekfoxcharlie/XHS-TextCard 的 pro-doc.json（MIT）。技术文档首页：顶部一条文档表头线，底部作者 / 页数信息表；正文用 1. 与 1.1 分级标题、完整边框表格和左侧大纲线；结尾是带边框的签名表。',
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
    description: '改编自 uhhc/md2card 的 tech-pulse.ts（MIT）。深蓝到青的渐变封面被一条内联 SVG 折线脉冲横穿，标题大而粗；正文用青色的重点色块、方块列表和数据块，结尾让脉冲线再出现一次。',
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
    description: '改编自 uhhc/md2card 的 fresh-notes.ts（MIT）。点阵纸上的手帐：标题写在略微倾斜、贴着半透明胶带的便签上；正文 h2 是标签贴，无序清单画成勾选框，引用是另一张便签；结尾是一张胶带便签。',
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
    description: '改编自 Haodong Cui/md2card 的 notebook.css（MIT）。活页本：左侧一列打孔、浅松绿封面、标题写在纸页上；正文是横线本，行距与横线对齐，引用带绿色「摘录」标签；结尾简单署名落在横线上。',
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
/** A public long-image template shares the same archive and loader path. */
export interface PublicLongTemplate {
  id: string
  name: string
  author: string
  description: string
  reference: string
  license: 'MIT'
  sourceUrl: string
  pack: string
  variants: readonly { id: string; name: string }[]
}

export const PUBLIC_LONG_TEMPLATES: readonly PublicLongTemplate[] = [
  {
    id: 'blue-tech-recap',
    name: '蓝色科技活动回顾',
    author: 'Reed',
    description: '深蓝渐变上的活动回顾长图：满宽头图叠白到浅蓝的粗斜标题，小节用白底标签、手写感宽字距和细描边照片框，落款居中收束。适合成立大会、发布会与线下活动。',
    reference: '一张未公开的活动回顾长图',
    license: 'MIT',
    sourceUrl: 'https://github.com/yoruuuchan/wechat-md-studio',
    pack: '/card-templates/blue-tech-recap.reedcard',
    variants: [{ id: 'blue', name: '科技蓝' }],
  },
] as const

export function publicLongTemplateInstanceId(id: string): string {
  return `public-${id}`
}

export function publicLongTemplateRuntimeId(id: string): string {
  return PUBLIC_CARD_TEMPLATE_PREFIX + id
}

export function publicLongTemplateFor(template: string): PublicLongTemplate | undefined {
  if (!isPublicCardTemplateId(template)) return undefined
  const id = template.slice(PUBLIC_CARD_TEMPLATE_PREFIX.length)
  return PUBLIC_LONG_TEMPLATES.find((item) => item.id === id)
}

export function publicLongTemplateSummary(item: PublicLongTemplate): CardTemplateSummary {
  return {
    kind: 'long',
    id: item.id,
    template: publicLongTemplateRuntimeId(item.id),
    name: item.name,
    version: '1.0.0',
    author: item.author,
    variants: item.variants,
    ratios: [],
  }
}

export function publicCardTemplateSummary(item: PublicCardTemplate): CardTemplateSummary {
  return {
    id: item.id,
    kind: 'card',
    template: publicCardTemplateRuntimeId(item.id),
    name: item.name,
    version: '1.0.0',
    author: item.author,
    variants: item.variants,
    ratios: item.ratios,
  }
}