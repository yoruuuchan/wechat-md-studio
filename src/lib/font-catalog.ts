/**
 * Fonts a reader can pick for a template's font slots, and loading of the
 * stylesheets that are not part of the global bundle.
 *
 * Every family here is SIL OFL 1.1 and ships as unicode-range slices under
 * public/fonts (licence copies beside them). The browser downloads only the
 * slices whose ranges hit the text on screen, so listing a family costs one
 * small stylesheet until it is actually used.
 */

export interface CatalogFont {
  family: string
  name: { zh: string; en: string }
  /** The stylesheet that declares the family's @font-face slices. */
  sheet: string
  weights: readonly number[]
}

export const CHOOSABLE_FONTS: readonly CatalogFont[] = [
  { family: 'Noto Sans SC', name: { zh: '思源黑体', en: 'Noto Sans SC' }, sheet: '/fonts/noto-sans-sc-local.css', weights: [400, 700] },
  { family: 'Noto Serif SC', name: { zh: '思源宋体', en: 'Noto Serif SC' }, sheet: '/fonts/fonts-local.css', weights: [400, 700] },
  { family: 'Zhuque Fangsong', name: { zh: '朱雀仿宋', en: 'Zhuque Fangsong' }, sheet: '/fonts/zhuque-fangsong.css', weights: [400] },
  { family: 'LXGW WenKai', name: { zh: '霞鹜文楷', en: 'LXGW WenKai' }, sheet: '/fonts/lxgw-wenkai.css', weights: [400] },
  { family: 'Smiley Sans', name: { zh: '得意黑', en: 'Smiley Sans' }, sheet: '/fonts/smiley-sans.css', weights: [400] },
  { family: 'ZCOOL XiaoWei', name: { zh: '站酷小薇体', en: 'ZCOOL XiaoWei' }, sheet: '/fonts/zcool-xiaowei.css', weights: [400] },
  { family: 'ZCOOL QingKe HuangYou', name: { zh: '站酷庆科黄油体', en: 'ZCOOL QingKe HuangYou' }, sheet: '/fonts/zcool-qingke-huangyou.css', weights: [400] },
  { family: 'ZCOOL KuaiLe', name: { zh: '站酷快乐体', en: 'ZCOOL KuaiLe' }, sheet: '/fonts/zcool-kuaile.css', weights: [400] },
  { family: 'Ma Shan Zheng', name: { zh: '马善政楷书', en: 'Ma Shan Zheng' }, sheet: '/fonts/ma-shan-zheng.css', weights: [400] },
]

export function catalogFont(family: string): CatalogFont | undefined {
  return CHOOSABLE_FONTS.find((font) => font.family === family)
}

/**
 * Stylesheets src/index.css already imports. Everything else is linked on
 * first use so the editor's first paint does not parse a dozen 100 KB sheets.
 */
const GLOBAL_SHEETS = new Set([
  '/fonts/fonts-local.css',
  '/fonts/noto-sans-sc-local.css',
  '/fonts/fonts-templates.css',
  '/fonts/fonts-design.css',
])

/** Families whose @font-face rules live in a sheet that is loaded on demand. */
const ON_DEMAND_SHEETS = new Map(
  CHOOSABLE_FONTS.filter((font) => !GLOBAL_SHEETS.has(font.sheet)).map((font) => [font.family, font.sheet]),
)

export const ON_DEMAND_FONT_SHEETS: readonly string[] = [...new Set(ON_DEMAND_SHEETS.values())]

const linked = new Map<string, Promise<void>>()

/**
 * Make sure the @font-face rules for these families are in the document before
 * anything is measured with them. Unknown and globally loaded families are a
 * no-op; a sheet that fails to load resolves anyway and the text falls back.
 */
export function ensureFontSheets(families: Iterable<string>): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const pending: Promise<void>[] = []
  for (const family of families) {
    const sheet = ON_DEMAND_SHEETS.get(family)
    if (!sheet) continue
    let ready = linked.get(sheet)
    if (!ready) {
      ready = new Promise<void>((resolve) => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet
        link.dataset.fontSheet = family
        link.onload = () => resolve()
        link.onerror = () => {
          linked.delete(sheet)
          link.remove()
          resolve()
        }
        document.head.append(link)
      })
      linked.set(sheet, ready)
    }
    pending.push(ready)
  }
  return Promise.all(pending).then(() => undefined)
}
