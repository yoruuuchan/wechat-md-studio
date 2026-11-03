# 卡片模板文件格式 · `.reedcard`

[中文首页](../README.md) · [Agent 入口](../AGENTS.md) · [小红书卡片](xhs-cards.md)

`.reedcard` 是一个 zip 压缩包，用来描述一套小红书卡片模板：封面 / 正文 / 结尾的页面结构、CSS、可变体，以及可选字体和装饰图。
模板里**没有任何可执行代码**。引擎负责分页、封面标题自适应、精确字号导出和字体内嵌，模板只声明页面结构与样式。

## 1. 包结构

```text
example.reedcard
├── manifest.json          # 必需，位于根目录
├── pages/
│   ├── cover.html         # 封面片段
│   ├── body.html          # 正文片段（每页复用）
│   └── end.html           # 可选，最后一个正文页使用
├── styles/
│   └── template.css       # 一个或多个 CSS 文件
├── fonts/
│   └── example-grotesk.woff2
└── assets/
    └── ornament.svg
```

文件路径必须是相对路径，不允许 `..`、`/` 开头、盘符或反斜杠。允许的扩展名只有
`.json` `.html` `.css` `.woff2` `.woff` `.png` `.jpg` `.jpeg` `.webp` `.svg`。

仓库里的完整例子：[`examples/card-templates/example/`](../examples/card-templates/example/)；打包命令：

```powershell
node scripts/cards/pack-template.mjs examples/card-templates/example verify-out/example.reedcard
```

## 2. manifest.json

```json
{
  "format": "reed-card-template",
  "formatVersion": 1,
  "id": "example-daylight",
  "renderId": "example-daylight",
  "name": "示例 · 日光",
  "version": "1.0.0",
  "author": "Reed",
  "description": "一段给用户看的说明",
  "ratios": ["3:4", "1:1", "9:16"],
  "defaultRatio": "3:4",
  "variants": [
    {
      "id": "day",
      "name": "日间",
      "dark": false,
      "tokens": { "accent": "#2F6F5E", "text": "#1E2328", "muted": "#6E756F" }
    }
  ],
  "metrics": {
    "padX": 44,
    "padTop": 76,
    "padBottom": 64,
    "contentWidth": 452,
    "headerTop": 26,
    "footerBottom": 24,
    "coverInsetX": 44,
    "coverInsetY": 82,
    "coverFootBottom": 40,
    "coverReserve": 190,
    "coverTitleSize": [58, 50, 44, 38, 32],
    "coverSmallScale": 0.86
  },
  "fonts": [
    { "source": "builtin", "family": "Noto Sans SC", "weights": [400, 700] },
    { "source": "builtin", "family": "Geist Mono", "weights": [400] },
    {
      "source": "package",
      "family": "Example Grotesk",
      "file": "fonts/example-grotesk.woff2",
      "weight": 400,
      "style": "normal"
    }
  ],
  "pages": { "cover": "pages/cover.html", "body": "pages/body.html", "end": "pages/end.html" },
  "styles": ["styles/template.css"]
}
```

| 字段 | 说明 |
|---|---|
| `format` / `formatVersion` | 固定为 `reed-card-template` / `1`；版本升级会另行说明。 |
| `id` | 小写字母、数字、连字符，1–64 字符。只用于显示与记录，不会覆盖内置模板。 |
| `renderId` | 可选，写到 `data-template` 上供 CSS 匹配的键，默认等于 `id`。从内置模板转出的模板可以保留原键，这样 CSS 可以原样保留 `[data-template="…"]` 选择器，在删除内置模板后仍然自包含。两个模板不要共用同一个 `renderId`。即使共用，引擎的作用域仍按上传实例隔离，两套模板的规则不会互相影响。 |
| `name` / `version` / `author` | 选择器与“我的模板”列表里显示的名字、版本与作者。 |
| `description` | 可选，最多 500 字。 |
| `ratios` | 支持的比例，取 `3:4`、`1:1`、`9:16` 的非空子集；不在列表里的比例会禁用并提示。 |
| `defaultRatio` | 必须等于 `ratios` 的第一项。切换到该模板时若当前比例不支持，会自动改用这一项。 |
| `variants` | 1–16 个变体；`id` 用小写字母、数字、连字符，`name` 显示在“卡片背景”。`dark` 决定导出时是否使用暗色语义变量。`tokens` 只允许 `accent` / `text` / `muted` 三种安全颜色，`accent` 会写入 `--xhs-accent`。 |
| `metrics` | 分页与封面共用的度量，见下一节。 |
| `fonts` | 字体声明，见第 6 节。 |
| `pages` | 三个页面 HTML 的相对路径；`end` 省略时最后一页复用 `body`。 |
| `styles` | 1–8 个 CSS 相对路径。 |

### metrics

| 字段 | 含义 |
|---|---|
| `padX` | 正文左右边距；`contentWidth` 建议等于 `540 - padX * 2`。 |
| `padTop` / `padBottom` | 正文顶部 / 底部预留，用来给页眉、页脚和页码让位。 |
| `contentWidth` | 正文实测宽度。 |
| `headerTop` | 页眉距卡片顶部的距离。 |
| `footerBottom` | 页脚距卡片底部的距离。 |
| `coverInsetX` / `coverInsetY` | 封面内容区与卡片边缘的距离。 |
| `coverFootBottom` | 封面页脚距底部距离。 |
| `coverReserve` | 封面标题下方为页脚等内容预留的高度；标题按实际高度缩小时以它为准。 |
| `coverTitleSize` | 5 档标题字号：≤8 / ≤14 / ≤22 / ≤32 / 更长字符。 |
| `coverSmallScale` | 高度小于 600px 时的标题缩放系数。 |

度量是声明式的：引擎把 `padX` 等写成 `--xhs-pad-x` 等 CSS 变量，并按 `height - padTop - padBottom` 分页。模板不需要重复实现分页。

## 3. 页面与 slot

三个 HTML 文件都是片段（不写 `<html>` / `<head>` / `<body>`）。引擎把它们放进 `.xhs-card`，再填充 slot。
页面里用 `data-slot` 标记位置：

| slot | 内容 | 可用格式 |
|---|---|---|
| `title` | 封面标题。可以出现多次（例如描边 + 正片叠字）。 | 文本 |
| `subtitle` | 封面副标题；为空时元素会被移除。 | 文本 |
| `author` | 作者（没有作者时为“芦苇”）。 | 文本 |
| `article-title` | 文章标题，用于页眉 / 书脊。 | 文本 |
| `brand` | 产品名（跟随界面语言）。 | 文本 |
| `hint` | 内置的“滑动阅读 →”提示。 | 文本 |
| `date` | 当前日期，中文 `2026/11/03`，英文按 `en-GB` 格式。 | 文本 |
| `page-number` | 当前页号（封面为 1）。 | `pad2` / `chinese` / `plain` |
| `page-total` | 总页数。 | `pad2` / `chinese` / `plain` |
| `page-counter` | 页号与总页数一次填好。 | `pad2`（`01 / 03`）、`chinese`（`〇一 / 〇三`）、`plain`、`bracket`（`[ 01 / 03 ]`） |
| `page-count` | 本地化的“共 N 页”。 | `chinese` / `pad2` / `plain` |
| `content` | 引擎生成的正文节点（`section.xhs-body`），只能由引擎填入。 | — |

`data-format` 缺省时 `page-number` / `page-total` / `page-counter` 使用 `pad2`。
`data-slot="title"` / `subtitle` 为空时元素会被删除，因此 CSS 不需要处理空标题。

声明式条件与变换：

| 属性 | 作用 |
|---|---|
| `data-when-variant="analog sunset"` | 只有当前变体在列表里时保留该元素。 |
| `data-when-dark="true"` / `"false"` | 按变体的 `dark` 保留或删除。 |
| `data-transform="lowercase"` / `"uppercase"` | 填 slot 后转换大小写（例如 core 风格的标题栏）。 |
| `data-fit-cover-title` | 引擎从这里开始写封面标题字号，并在真实布局里继续缩小到不溢出。 |
| `data-fit-box` | 标题适配时用来比较的容器；默认取标题父元素。 |
| `data-fit-constrained` | 声明容器是固定高度（绝对定位），按 `scrollHeight / clientHeight` 比较。 |

需要“只在某个变体出现”的装饰，用 `data-when-variant`；需要“标题为空就不显示”，用 `data-slot="subtitle"`。
不需要脚本，也不要写 `<script>` 或内联事件。

示例封面：

```html
<div class="xhs-cover example-cover">
  <div class="example-cover-top">
    <span>REED TEMPLATE</span>
    <span data-slot="page-counter" data-format="pad2"></span>
  </div>
  <div class="xhs-cover-copy" data-fit-box>
    <h1 data-slot="title" data-fit-cover-title></h1>
    <p data-slot="subtitle"></p>
  </div>
  <div class="xhs-cover-foot">
    <span data-slot="author"></span>
    <span data-slot="brand"></span>
  </div>
</div>
```

正文片段通常由“页眉 + `data-slot="content"` + 页脚”组成，页脚里的页号用 `page-counter`。

## 4. 允许的 HTML

只保留结构元素与基本 SVG 图形：

```text
div span p h1 h2 h3 h4 h5 h6 section article header footer main aside
ul ol li figure figcaption blockquote pre code small strong em b i u s hr br
table thead tbody tfoot tr th td img
svg g path circle ellipse rect line polyline polygon text tspan defs clippath
```

- 不允许：`script`、`iframe`、`object`、`embed`、`form`、`input`、`foreignObject`、`style`、`link`、`meta`、`base`、`template`。
- 不允许任何 `on*` 事件属性、`style` 属性、`srcset`；所有样式必须写在 CSS 文件里。
- 允许 `class`、`id`、`role`、`aria-*`、`data-*` 和 SVG 基本属性（`viewBox`、`d`、`fill`、`stroke`、`cx` 等）。
- `img` 的 `src` 只能是包内图片（相对页面文件），或 `data:image/png|jpeg|webp|gif`。不接受 `http(s):`、`//`、`javascript:`、`data:text/html`。
- 内联 SVG 不允许 `<foreignObject>`、`<use>` 或脚本；`xmlns` 只接受 SVG 命名空间。
- 包内的 `.svg` 文件只作为图片资源（`img` 或 CSS `url()`）加载，不会被内联进 DOM；图片上下文不执行脚本。

过滤后的 HTML 在**上传时**和**每次加载时**各检查一遍。任何一项不合规都会拒绝整个模板，而不是悄悄删掉一半。

## 5. CSS 规则

- CSS 由浏览器 CSSOM 解析。引擎把每条规则包进 `@scope (.xhs-card[data-card-template-source="…"], .xhs-body[data-card-template-source="…"])`，作用域键是这次上传的唯一实例 id，不是 `renderId`。所以选择器只能命中这次上传的卡片和它的测量副本，碰不到 `body`、`:root`、编辑器、其它上传模板或内置模板。
- 以 `.xhs-card` / `.xhs-body` 开头的规则会自动补一份 `:scope.xhs-card` / `:scope.xhs-body`，因此可以给卡片根节点本身设背景、字体和变量。
- 不允许 `@import`、`@font-face`、`@namespace`、`@page`、`@property`、`@counter-style`、`@keyframes`、`@layer`、`@scope`；`@media`、`@supports`、`@container` 可以嵌套。
- 选择器里不允许出现 `body` / `html` / `:root` / `:host` / `::slotted`。
- 拒绝 `expression()`、`behavior`、`-moz-binding`、`javascript:` / `vbscript:`。
- `url()` 只允许指向包内文件，加载时替换成 data URL；`url(#本地id)` 可以保留。`http(s):`、`//`、缺失文件都拒绝。
- 字体不要写在 CSS 里：用 manifest 的 `fonts`，引擎负责 `FontFace` 和 PNG 内嵌。

建议根节点用变量：

```css
.xhs-card {
  background: #fbfaf7;
  color: var(--example-ink);
  --example-ink: #1e2328;
}
.xhs-card[data-variant="dusk"] {
  background: #15191e;
  color: #e8e4dc;
  --example-ink: #e8e4dc;
}
```

## 6. 字体

### 引用内置字体

```json
{ "source": "builtin", "family": "Noto Sans SC", "weights": [400, 700] }
```

可引用的 family（必须与内置声明完全一致）：

```text
Geist, Geist Mono, Noto Sans SC, Noto Serif SC, Zhuque Fangsong, Inter,
JetBrains Mono, EB Garamond, IBM Plex Sans, IBM Plex Mono, Caveat, Orbitron,
VT323, Space Grotesk, DM Serif Display, Rajdhani, Share Tech Mono,
Pixelify Sans, Tinos, Instrument Sans, B612 Mono
```

`weights` / `styles` 必须在该 family 的内置声明范围内，例如 `Zhuque Fangsong` 只有 400。

### 包内 woff2

```json
{
  "source": "package",
  "family": "Example Grotesk",
  "file": "fonts/example-grotesk.woff2",
  "weight": 400,
  "style": "normal",
  "unicodeRange": "U+0000-00FF"
}
```

- `family` 不能与内置 family 同名；同一个 family 的每个字重 / 样式只声明一次，多字重请拆成多条同 family 记录并给不同 `weight`。
- 引擎用 `new FontFace(family, ArrayBuffer)` 加载，不发网络请求；导出时把 woff2 以 data URL 写进 `@font-face`，PNG 能带上包内字体。
- 只接受 `.woff2` / `.woff`，单文件上限 4 MB。

## 7. 限制

| 项目 | 上限 |
|---|---|
| 压缩包 | 8 MB |
| 解压后总计 | 32 MB |
| 文件数 | 128 |
| `manifest.json` | 64 KB |
| 单个页面 HTML | 512 KB |
| 单个 CSS | 512 KB |
| 单个字体 | 4 MB |
| 单个图片 | 2 MB |
| 变体 | 16 |
| CSS 文件 | 8 |
| 字体声明 | 24 |

超限、坏 manifest、路径穿越、zip 炸弹、非白名单扩展名、危险 HTML/CSS 或包外资源都会让上传失败，界面会给出对应的中文 / 英文提示。

## 8. 上传与存储

- 入口：编辑器右栏「模板」→「我的模板」→「上传模板文件」。
- 上传的模板与内置模板走同一条分页、封面标题适配、精确字号导出、字体嵌入、单张 PNG 和整包 ZIP 管线。
- 原始 zip 与解析结果都存在本机 IndexedDB `mopai.card-templates`；刷新页面后仍然在，删除后从本机移除。
- 内置模板这一轮仍然保留；模板文件只是另一种来源，不与内置模板合并，也不会覆盖它们。
- 模板里的设计归上传者所有。上传即表示你有权使用其中的字体、图片与版式。

## 9. 最小示例

`examples/card-templates/example/manifest.json` 与同目录的 `pages/`、`styles/`、`fonts/` 是一个可以直接打包上传的完整模板，包含：

- 三个比例；
- 日间 / 傍晚两个变体；
- 独立结尾页；
- 内置 Noto Sans SC / Geist Mono 与包内 woff2 字体；
- 封面标题自适应、页眉、页脚、页码。

把它打包后上传，就能在「我的模板」里看到并使用。