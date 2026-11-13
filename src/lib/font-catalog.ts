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
  { family: 'Noto Sans SC Black', name: { zh: '思源黑体 特粗', en: 'Noto Sans SC Black' }, sheet: '/fonts/noto-sans-sc-black.css', weights: [900] },
  { family: 'Noto Serif SC', name: { zh: '思源宋体', en: 'Noto Serif SC' }, sheet: '/fonts/fonts-local.css', weights: [400, 700] },
  { family: 'Zhuque Fangsong', name: { zh: '朱雀仿宋', en: 'Zhuque Fangsong' }, sheet: '/fonts/zhuque-fangsong.css', weights: [400] },
  { family: 'LXGW WenKai', name: { zh: '霞鹜文楷', en: 'LXGW WenKai' }, sheet: '/fonts/lxgw-wenkai.css', weights: [400] },
  { family: 'Smiley Sans', name: { zh: '得意黑', en: 'Smiley Sans' }, sheet: '/fonts/smiley-sans.css', weights: [400] },
  { family: 'ZCOOL XiaoWei', name: { zh: '站酷小薇体', en: 'ZCOOL XiaoWei' }, sheet: '/fonts/zcool-xiaowei.css', weights: [400] },
  { family: 'ZCOOL QingKe HuangYou', name: { zh: '站酷庆科黄油体', en: 'ZCOOL QingKe HuangYou' }, sheet: '/fonts/zcool-qingke-huangyou.css', weights: [400] },
  { family: 'ZCOOL KuaiLe', name: { zh: '站酷快乐体', en: 'ZCOOL KuaiLe' }, sheet: '/fonts/zcool-kuaile.css', weights: [400] },
  { family: 'Ma Shan Zheng', name: { zh: '马善政楷书', en: 'Ma Shan Zheng' }, sheet: '/fonts/ma-shan-zheng.css', weights: [400] },
  { family: 'Unbounded Sans', name: { zh: '无界黑', en: 'Unbounded Sans' }, sheet: '/fonts/unbounded-sans.css', weights: [400] },
  { family: 'Tiejili SC', name: { zh: '铁蒺藜体', en: 'Tiejili SC' }, sheet: '/fonts/tiejili-sc.css', weights: [400] },
  { family: 'GenRyuMin2', name: { zh: '源流明体', en: 'GenRyuMin2' }, sheet: '/fonts/genryumin2.css', weights: [700, 900] },
  { family: 'GenYoMin2', name: { zh: '源样明体', en: 'GenYoMin2' }, sheet: '/fonts/genyomin2.css', weights: [700, 900] },
  { family: 'Glow Sans SC', name: { zh: '未来荧黑', en: 'Glow Sans SC' }, sheet: '/fonts/glow-sans-sc.css', weights: [900] },
]

export function catalogFont(family: string): CatalogFont | undefined {
  return CHOOSABLE_FONTS.find((font) => font.family === family)
}

/**
 * Stylesheets src/index.css imports: the interface fonts (Geist, Geist Mono,
 * Noto Sans SC) and Noto Serif SC 700. Everything else is linked on first use
 * so the editor's first paint does not parse a dozen 100 KB sheets.
 */
export const GLOBAL_FONT_SHEETS: ReadonlySet<string> = new Set([
  '/fonts/fonts-local.css',
  '/fonts/noto-sans-sc-local.css',
])

/**
 * The two shared sheets that templates and article themes draw on, with the
 * families each declares. font-catalog.test.ts reads the CSS files and fails
 * when this list and the sheets disagree.
 */
export const SHARED_FONT_SHEETS: Readonly<Record<string, readonly string[]>> = {
  '/fonts/fonts-templates.css': [
    'Caveat', 'EB Garamond', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter', 'JetBrains Mono', 'Noto Serif SC',
  ],
  '/fonts/fonts-design.css': [
    'Anton', 'B612 Mono', 'Bebas Neue', 'Chakra Petch', 'DM Serif Display', 'DotGothic16', 'Instrument Sans',
    'Instrument Serif', 'JetBrains Mono', 'Major Mono Display', 'Orbitron', 'Pixelify Sans', 'Press Start 2P',
    'Rajdhani', 'Share Tech Mono', 'Space Grotesk', 'Tinos', 'VT323',
  ],
}

/**
 * Family → the on-demand sheets declaring it. One family can sit in several
 * sheets with different weights (Noto Serif SC 700 is global, 400 is in the
 * template sheet; JetBrains Mono 400 and 700 are in different sheets).
 */
const ON_DEMAND_SHEETS = new Map<string, string[]>()
function addSheet(family: string, sheet: string) {
  if (GLOBAL_FONT_SHEETS.has(sheet)) return
  const sheets = ON_DEMAND_SHEETS.get(family) ?? []
  if (!sheets.includes(sheet)) sheets.push(sheet)
  ON_DEMAND_SHEETS.set(family, sheets)
}
for (const font of CHOOSABLE_FONTS) addSheet(font.family, font.sheet)
for (const [sheet, families] of Object.entries(SHARED_FONT_SHEETS)) {
  for (const family of families) addSheet(family, sheet)
}

export const ON_DEMAND_FONT_SHEETS: readonly string[] = [...new Set([...ON_DEMAND_SHEETS.values()].flat())]

/** The on-demand sheets a family needs; empty for global and unknown families. */
export function fontSheetsFor(family: string): readonly string[] {
  return ON_DEMAND_SHEETS.get(family) ?? []
}

const linked = new Map<string, Promise<void>>()

/**
 * Make sure the @font-face rules for these families are in the document before
 * anything is measured with them. Unknown and globally loaded families are a
 * no-op; a sheet that fails to load resolves anyway and the text falls back.
 */
export function ensureFontSheets(families: Iterable<string>): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const pending: Promise<void>[] = []
  // Sheet → the first family that asked for it (kept on the link for checks).
  const sheets = new Map<string, string>()
  for (const family of families) {
    for (const sheet of fontSheetsFor(family)) if (!sheets.has(sheet)) sheets.set(sheet, family)
  }
  for (const [sheet, family] of sheets) {
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

/**
 * Families named in `font-family` declarations of rendered HTML or CSS. Theme
 * output is inline styles, so this reads both `style="font-family: …"` and
 * entity-quoted names (`&quot;EB Garamond&quot;`).
 */
export function fontFamiliesIn(markup: string): Set<string> {
  const families = new Set<string>()
  // Decode quote entities first: the `;` in `&quot;` would end the value.
  const text = markup.replace(/&quot;|&#34;|&#39;|&#x27;/g, '"')
  for (const match of text.matchAll(/font-family\s*:\s*([^;"}>]*(?:"[^"]*"[^;"}>]*)*)/gi)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^["']|["']$/g, '').trim()
      if (name) families.add(name)
    }
  }
  return families
}

/** Link the on-demand sheets for every family the markup uses. */
export function ensureFontSheetsFor(markup: string): Promise<void> {
  return ensureFontSheets(fontFamiliesIn(markup))
}
