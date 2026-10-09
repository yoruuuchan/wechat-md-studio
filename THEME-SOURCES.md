# 主题库来源与授权审计

审计日期：2026-10-07。所有 license 结论均取自仓库内 LICENSE 文件原文或 GitHub API 的
license 字段（实测），上游主题文件已浅克隆核对；标注「推断」的条目是法律判断而非事实记录。

<!-- BEGIN GENERATED: themes-doc-intro — npm run sync:docs -->
主题库当前共 **219 套**：210 套由 `scripts/themes/import.ts` 从 7 个上游仓库导入、6 套 gzh-design-skill 移植、3 套自研。
导入产物在 `src/lib/themes-imported/*.ts`，提交进仓库，运行时不依赖任何上游仓库。重跑：`npm run import:themes`（上游克隆位置见文末）。
<!-- END GENERATED: themes-doc-intro -->

## 一、已接入来源

<!-- BEGIN GENERATED: themes-doc-sources — npm run sync:docs -->
| 来源 | License | 套数 | 上游格式 | 许可证留存 |
|---|---|---|---|---|
| [xiaohuailabs/xiaohu-wechat-format](https://github.com/xiaohuailabs/xiaohu-wechat-format) | MIT | 85 | 纯 JSON，snake_case 样式字典 | `LICENSES/xiaohu-wechat-format/LICENSE-NOTE.md` |
| [liuxiaopai-ai/raphael-publish](https://github.com/liuxiaopai-ai/raphael-publish) | MIT | 30 | TS，tag→内联 CSS 串 | `LICENSES/raphael-publish/LICENSE` |
| [laogou717/md-wechat](https://github.com/laogou717/md-wechat) | MIT 26 套 · GPL-3.0-only 2 套 | 28 | JS，styles:(p)=>({元素:CSS}) | `LICENSES/md-wechat/LICENSE` |
| [michellewkx/inkpress](https://github.com/michellewkx/inkpress) | MIT | 26 | YAML，每节点 style: 多行 CSS，自带 series/tags | `LICENSES/inkpress/LICENSE` |
| [alchaincyf/huasheng_editor](https://github.com/alchaincyf/huasheng_editor) | MIT | 20 | JS 全局脚本，tag→内联 CSS 串 | `LICENSES/huasheng-editor/LICENSE` |
| [rotbit/xedit](https://github.com/rotbit/xedit) | MIT | 13 | TS，#nice 选择器 CSS 串 | `LICENSES/xedit/LICENSE` |
| [caol64/wenyan-core](https://github.com/caol64/wenyan-core) | MIT 7 套 · Apache-2.0 1 套 | 8 | CSS 文件 + TS 注册表 | `LICENSES/wenyan-core/LICENSE` + `LICENSES/typora-upstream/` 7 份 |
| [isjiamu/gzh-design-skill](https://github.com/isjiamu/gzh-design-skill) | AGPL-3.0-or-later | 6 | Markdown 组件库 | `LICENSES/gzh-design-skill/LICENSE` |
| 本项目自研 | Project-Original | 3 | 手写主题（theme-kit 语义节点） | — |

审计备注：

- **xiaohu-wechat-format**：上游 README 声明 MIT，但仓库内没有 LICENSE 文件；LICENSES/ 下的副本是这份授权状态记录。
- **md-wechat**：28 套里 2 套（科技蓝 / 全栈蓝）的上游自述移植自 mdnice 经典主题，按 GPL-3.0-only 单独标注；其余 26 套按上游 MIT。
- **huasheng_editor**：上游是 ricocc/rico-md 那 21 套主题的直接来源；我们取上游仓库本身，不取二手拷贝。
- **wenyan-core**：8 套里 7 套的 CSS 头注释标明各自的 Typora 上游主题与作者（7 个上游仓库实测均为 MIT），第 8 套 wenyan-default 按 wenyan-core 的 Apache-2.0 记录；许可证文本存在 typora-upstream/ 下。
- **gzh-design-skill**：AGPL-3.0-or-later 有传染性且第 13 条覆盖网络服务：本项目整体因此以 AGPL 提供源码；线上部署与公开仓库对应是履行该义务的方式。
<!-- END GENERATED: themes-doc-sources -->

### 统计（由 `npm run sync:docs` 生成；`npm run verify:sources` 复核一致性）

<!-- BEGIN GENERATED: themes-doc-stats — npm run sync:docs -->
- 按来源：xiaohu-wechat-format 85 · raphael-publish 30 · md-wechat 28 · inkpress 26 · huasheng_editor 20 · xedit 13 · wenyan-core 8 · gzh-design-skill 6 · 本项目自研 3
- 按许可证：MIT 207 · AGPL-3.0-or-later 6 · GPL-3.0-only 2 · Apache-2.0 1 · 本项目自研 3
- 按风格标签（多标签）：文艺复古 79 · 杂志 73 · 治愈 67 · 科技 58 · 商务 43 · 中国风 24 · 学术 22 · 暗色 21 · 卡通 10 · 政务 4 · 运动 2 · 节日 0
- 按复杂度：简洁 59 · 标准 100 · 复杂 60
- 按色系：冷色 93 · 暖色 88 · 中性 34 · 多彩 4
<!-- END GENERATED: themes-doc-stats -->

风格标签与复杂度由 `scripts/themes/lib/classify.ts` 从上游描述/标签文本 + 样式度量推导，
不是人工逐套标注；11 套上游文本完全没有关键词证据，其标签来自配色推导或兜底。
改关键词表后重跑 importer 即整套重算。

### lineage（二次移植）记录

- `md-wechat-tech-blue` / `md-wechat-fullstack-blue`：上游 description 原文自述「移植自 mdnice 经典」，
  而 mdnice/markdown-nice 是 GPL-3.0-only。这两套按 **GPL-3.0-only** 单独标注，
  MIT 标签不覆盖它们。
- wenyan 的 7 套（orangeheart / rainbow / lapis / pie / maize / purple / phycat）：CSS 头注释明文
  标注 Typora 上游主题、作者与仓库，7 个上游仓库实测全部 MIT。每套主题的 `meta.origin`
  记到 Typora 作者一级，许可证文本存在 `LICENSES/typora-upstream/`。
  第 8 套 `wenyan-default` 无头注释，按 wenyan-core 的 Apache-2.0 记录。
- huasheng_editor 是 ricocc/rico-md 那 21 套的上游（id 与 name 逐一对应）。取上游，不取二手拷贝。
- gzh-design-skill 的 6 套：上游 references/ 下无更窄授权，整套受 AGPL-3.0-or-later 覆盖。

## 二、未接入来源及原因

### 授权不允许或无法确认

| 来源 | 原因 |
|---|---|
| [mspringjade/wechat-formatter](https://github.com/mspringjade/wechat-formatter)（线上名 TypeZen） | AGPL-3.0，且 README 附加明文禁商用条款（禁 SaaS、禁广告/会员变现）。72 套实为 6 骨架 × 12 色，设计多样性低；还故意用 `float:left` 排列表图标。只作设计灵感，不复制代码 |
| [geekjourneyx/md2wechat-skill](https://github.com/geekjourneyx/md2wechat-skill) | BSL 1.1，LICENSE 限定 Personal Non-Commercial，部署为网络服务即违约 |
| [geekjourneyx/obsidian-md2wechat](https://github.com/geekjourneyx/obsidian-md2wechat) | AGPL-3.0，主题复用上一条 |
| [fxyadela/write-then-publish](https://github.com/fxyadela/write-then-publish) | 自定「个人非商业许可证」，禁止部署为网络服务 |
| [yan9651688/yituo-hub-studio](https://github.com/yan9651688/yituo-hub-studio)、[xiaoou-waou/xiaoou-gzh-layout](https://github.com/xiaoou-waou/xiaoou-gzh-layout) | AGPL-3.0 |
| [mdnice/markdown-nice](https://github.com/mdnice/markdown-nice) | GPL-3.0-only 传染；且其 30 套市场主题的 CSS 已不再由 API 下发（实测 `css` 字段全为 null），仓库内只有空壳模板与一份 basic.js。社区投稿主题无任何许可证声明 |
| [imageslr/mweb-themes](https://github.com/imageslr/mweb-themes)（31 套）、[huanxi007/markdown-here-css](https://github.com/huanxi007/markdown-here-css)（8 套）、[lyricat/wechat-format](https://github.com/lyricat/wechat-format)、[YiShu5/GZHcomposing](https://github.com/YiShu5/GZHcomposing)、[shenweiyan/Md2XEditor](https://github.com/shenweiyan/Md2XEditor)、[sheilaCat/typora-theme-css](https://github.com/sheilaCat/typora-theme-css) | 仓库内完全无 LICENSE，README 亦无授权声明。默认保留所有权利，不可再分发。YiShu5 的 7 个品牌组件与本项目语义节点重合度最高，建议单独发 issue 询问授权后回看 |
| [shynloc/ACKS-Markdown-Editor](https://github.com/shynloc/ACKS-Markdown-Editor) | 自身 MIT，但 32 个 signature 命名与 gzh-design-skill（AGPL）的 6 套高度撞车且无任何致谢或 AGPL 声明，疑似未声明的派生作品。只借鉴其「版式 × signature 正交分解」与 luminance 判明暗的思路 |
| [miantiao-me/bm.md](https://github.com/miantiao-me/bm.md) | LGPL-3.0；92 处伪元素 + 340 处 class/id 选择器，移植成本高；其 kami.css 追溯到的 tw93/Kami 授权本次未核实 |
| [HelloSanshi/Wechat-MD-Editor](https://github.com/HelloSanshi/Wechat-MD-Editor) | README 声明 MIT 但无 LICENSE 文件；与 Lightbaby/Wechat-MD-Editor 是同内容双镜像、归属混乱；14 套主题无表格支持且设计同质；已停更 |
| [typora/theme.typora.io](https://github.com/typora/theme.typora.io) | 214 套主题的索引，仅 1 套在 frontmatter 声明 license，其余需逐个访问作者仓库核实；索引仓库自身无 LICENSE |

### 授权清楚但价值不足（推断：收益低于移植成本）

| 来源 | 原因 |
|---|---|
| [doocs/md](https://github.com/doocs/md) | **WTFPL-2.0，零义务**，但内置只有 3 套主题，default.css 依赖 68 处 `var()` + 27 处 `calc()`，单套移植成本高于收益。真正值得搬的是它的 `cssProcessor.ts`（var/calc 解算）与 `clipboard-dom.ts`（juice 前消毒）两段工程代码，同为 WTFPL |
| [din4e/MDInline](https://github.com/din4e/MDInline) | MIT 最干净，但 14 套是朴素 token 预设，视觉区分度低，且产物带 `<div class="mdcss">` 外壳与 `white-space:pre` 代码块，需额外改造 |
| [Greatbeing/wechat-layout](https://github.com/Greatbeing/wechat-layout) | MIT，但只有设计 token（无表格/代码块/图注），生成器是 Python 正则，已停更约 4.5 个月 |
| [liangjingkanji/DrakeTyporaTheme](https://github.com/liangjingkanji/DrakeTyporaTheme) | MIT，但 Typora UI 主题：1764 处 `var()`、217 处伪元素、61 处 `position:absolute`，无法转内联样式，只可取配色 |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)、[brucecbi/wechat-design-html](https://github.com/brucecbi/wechat-design-html) | MIT，但是品牌设计 token 而非成品主题；据此做主题等于新设计，属未批准提案，不入 catalog。可作未来自研主题的配色输入 |
| 单主题 Typora 仓库（phycat/lapis/purple/pie 等的原始仓库） | 不满足「≥3 套成组」；其中 7 套已随 wenyan-core 以完整 lineage 接入 |
| [koala9527/markdown2wechat](https://github.com/koala9527/markdown2wechat) | 无 LICENSE，且 30 个 JSON 是 mdnice 官方主题名的 API 响应转储，属不可用来源的重复品 |

## 三、移植中的有损转换（逐条可复核）

微信编辑器只吃内联样式，以下上游特性在导入时被丢弃，`sanitizeStyle`（`src/lib/theme-kit.ts`）统一执行：

1. **伪元素 `::before` / `::after`** 整条规则丢弃（微信硬红线）。wenyan phycat 的标题装饰、
   xedit 的引用大引号因此丢失。
2. **`url(...)` 值丢弃**。data-URI SVG 内含单引号，而整段声明要写进双引号的 `style` 属性，
   没有两全的引号方案；外链背景图微信也不放行。
3. **`position: fixed/absolute/sticky`、`float`、`display:grid`、`@media`、`@keyframes`、CSS 变量残留** 丢弃。
4. **标题元素上的 `display:flex` 及其对齐声明剥离**：微信对 h1/h2/h3 上的 flex 支持不稳；
   上游放在 `h2 span` / `h2 .content` 的装饰改挂到本项目标题的内层 `<span leaf="">`。
5. **`var()` / `calc()` 在导入期求值**；求不出的声明整条丢弃（`scripts/themes/lib/css.ts`）。
6. md-wechat 的 `hrHtml` / `h2WrapOpen` 等 **HTML 片段不进样式槽**（带尖括号的值在 mapStyles 里被丢弃）。

## 四、应用整体许可证：已定为 AGPL-3.0-or-later（2026-10-07 拍板）

仓库根目录 `LICENSE` 为 AGPL-3.0 正文。

<!-- BEGIN GENERATED: themes-doc-compat — npm run sync:docs -->
`app/package.json` 的 `license` 字段与 `app/README.md` 的署名章节同步声明。219 套主题全部保留，兼容性逐族核对：

| 上游许可证 | 套数 | 与 AGPL-3.0-or-later 应用的关系 |
|---|---|---|
| MIT | 207 | 单向并入，保留版权声明与许可文本即可（已做） |
| AGPL-3.0-or-later | 6 | 同许可证族，保留联名署名（已做） |
| GPL-3.0-only | 2 | AGPL 第 13 条第二段明文允许与 GPL-3.0 作品组合为单一 AGPL 作品 |
| Apache-2.0 | 1 | 兼容；保留 LICENSE、标注修改、传递 NOTICE（上游无 NOTICE，此条免） |
| 本项目自研 | 3 | — |
<!-- END GENERATED: themes-doc-compat -->

由此产生的义务，按可执行性排序：

1. **源码提供**：AGPL 第 13 条要求线上服务向使用者提供完整对应源码。仓库公开、且部署
   构建能对应到公开提交即满足。**在仓库公开之前部署含 copyleft 主题的构建，义务尚未履行**——
   开源发布应早于或同步于下一次部署，别先部署后开源。
2. **署名保留**：各来源的版权声明、许可文本与 lineage 已在 `LICENSES/` 与每套主题的
   `meta.origin` 中保留；`npm run verify:sources` 会校验许可证文件真实存在、且每个来源与
   主题的引用一一对应，删主题时别留下悬空的 licenseFile 引用。
3. **衍生同许可证**：后续新增主题或改动渲染层，产物仍属 AGPL-3.0-or-later；再引入
   更严或不相容的来源（BSL、附加禁商用条款等）前，先回本文件第二节核对。

若未来想改回宽松许可证：按 `meta.origin.license` 过滤移除 8 套 copyleft 主题即可，
其余 208 套不受影响；gzh 那 6 套想要回，走 clean-room 重造，或按上游 README 的共创邀请
联系甲木谈单独授权（你已是该仓库上游贡献者，PR #19 已合并，接触点是现成的）。

## 五、重跑导入

上游仓库浅克隆在 `<local tmp>/theme-sources/<owner>--<repo>/`（tmp 区，不进仓库）。
换机器时按第一节表格里的仓库地址重新 `git clone --depth 1`，或用环境变量覆盖：

```bash
THEME_SOURCES=/path/to/clones npm run import:themes
```

导入后必须跑 `npm run verify:themes`（含 catalog 完整性与许可证文件存在性检查）
与 `node scripts/cdp-verify-theme-library.mjs <url> <key> 9334`（真实浏览器验收）。
