// 主题快切器的加载 /渲染计划。
//
// 面板里最多同时列出收藏与四个分类的前 6 套，但真正的实现包（每个来源
// 0.1–0.4 MB）和缩略图计算只应该发生在用户看得见或马上会看见的 tile 上。
// 这里把「哪些 tile 允许加载 /渲染」和「分批让出主线程」抽成纯函数，
// 组件只负责 IntersectionObserver 与计时，测试可以直接验证门禁与批次。

/** 当前稿变化后，缩略图最多再等这么久就重算（trailing debounce）。 */
export const QUICK_PREVIEW_DEBOUNCE_MS = 220

/** 一次并行请求几个来源的实现；来源缓存与失败重试仍在 theme-api里。 */
export const QUICK_LOAD_BATCH = 3

/** 一轮缩略图计算里同步渲染几个 tile，其余让给下一帧。 */
export const QUICK_PREVIEW_BATCH = 3

/** 视口外再预取约一行的高度，滚动时不至于一格一格地等。 */
export const QUICK_PREVIEW_ROOT_MARGIN = '240px\u00200px'

export interface QuickPreviewPlanInput {
  /** UI顺序：收藏在前，然后四个分类；已去重。 */
  displayed: readonly string[]
  /** 已经进入（或接近）视口、允许加载的 tile。 */
  visible: ReadonlySet<string>
  /** 实现已经加载完成的主题 id。 */
  loaded: ReadonlySet<string>
  /** 当前稿件主题：首屏必须可用，即使它的 tile还没滚到视口。 */
  currentId: string
}

/**
 * 这一轮可以渲染缩略图的主题，当前主题优先，其余按界面顺序。
 * 没加载实现或不在视口附近的 tile 不进入计划——即不触发 renderPreview。
 */
export function planQuickPreviews(input: QuickPreviewPlanInput): string[] {
  const allowed = (id: string) => input.loaded.has(id) && (id === input.currentId || input.visible.has(id))
  const out: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (seen.has(id) || !allowed(id)) return
    seen.add(id)
    out.push(id)
  }
  if (input.displayed.includes(input.currentId)) push(input.currentId)
  for (const id of input.displayed) push(id)
  return out
}

/**
 * 把 ids 切成固定大小的批次，顺序不变；size 至少为 1。
 * 组件在每个批次之间让出一帧，避免整组缩略图同步计算。
 */
export function chunkQuickIds(ids: readonly string[], size: number): string[][] {
  const batchSize = Math.max(1, Math.floor(size))
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += batchSize) out.push(ids.slice(i, i + batchSize))
  return out
}
