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

仓库里的公用模板也可以当范例：九套源文件在 [`card-templates/public/`](../card-templates/public/)，每套都有 `manifest.json`、`pages/` 和 `styles/`；`npm run pack:public-cards` 会把它们打成 `.reedcard` 放到 `public/card-templates/`。这些包在应用里只通过和用户上传完全相同的解析、安全检查与激活路径加载。

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
| `renderId` | 可选，写到 `data-template` 上供 CSS 匹配的键，默认等于 `id`。不能使用内置模板名（现在只有 `reed`），否则会被拒绝，免得上传包混进内置样式。从原内置模板转出的模板可以保留自己的 `renderId`，CSS 里的 `[data-template="…"]` 选择器会在删除内置模板后继续命中包里自带的那份规则。两个模板不要共用同一个 `renderId`；即使共用，引擎的作用域仍按上传实例隔离，两套模板的规则不会互相影响。 |
| `name` / `version` / `author` | 选择器「我的」组里显示的名字、版本与作者。 |
| `description` | 可选，最多 500 字。 |
| `ratios` | 支持的比例，取 `3:4`、`1:1`、`9:16` 的非空子集；不在列表里的比例会禁用并提示。 |
| `defaultRatio` | 必须等于 `ratios` 的第一项。切换到该模板时若当前比例不支持，会自动改用这一项。 |
| `variants` | 1–16 个变体；`id` 用小写字母、数字、连字符，`name` 显示在“卡片背景”。`dark` 决定导出时是否使用暗色语义变量。`tokens` 只允许 `accent` / `text` / `muted` 三种安全颜色，`accent` 会写入 `--xhs-accent`。 |
| `metrics` | 分页与封面共用的度量，见下一节。 |
| `fonts` | 字体声明，见第 6 节。 |
| `customize` | 可选，读者能在右栏改的颜色和字体，见下面的 [customize](#customize)。 |
| `pages` | 三个页面 HTML 的相对路径。`end` 省略时最后一页复用 `body`；`end` 里放了 `data-slot="content"` 时，它是最后一页正文的外框；没放时，它是正文之后**另加**的一张结尾页（只有标题、作者等），不会吞掉最后一页的正文。 |
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

### customize

模板把自己的几个 CSS 变量开放给读者，右栏「模板」里就会出现对应的色块和字体菜单：

```json
"customize": {
  "colors": [
    { "var": "--accent", "name": "主色" },
    { "var": "--paper", "name": "底色" }
  ],
  "fonts": [
    { "var": "--display", "name": "标题" },
    { "var": "--body-font", "name": "正文" }
  ]
}
```

- `colors` 最多 10 项，`fonts` 最多 4 项；`var` 符合 `^--[a-z][a-z0-9-]{0,47}$`，同一个 `var` 只能出现一次。`--xhs-`、`--long-`、`--reed-` 开头的是引擎保留的，不能开放。`name` 是最多 20 个字符的显示名。
- 这些变量要声明在作用域根上（卡片是 `.xhs-card`，长图是 `.reed-long-root`），模板 CSS 里只通过 `var(--…)` 使用它们。色块的初始颜色就是从根上读到的值，带透明度的颜色改色相时保留原透明度；根上没有值的显示为「跟随主题」。
- 读者的选择以内联样式写到卡片根、测量副本 `.xhs-body`（长图是 `.reed-long-root` 和 `.reed-long-flow`）上，所以分页、封面标题适配和导出都按改后的字体测量。
- 颜色只接受普通颜色值（十六进制、`rgb()`、`hsl()` 等），按变体分别记住；字体按模板记住。字体菜单里是「模板默认」、芦苇自带的 15 款（见第 6 节）和读者自己添加的字体文件；选中后变量的值是 `"字体名", "Noto Sans SC", sans-serif`，缺字回落到思源黑体。
- 选择存在本机 `localStorage` 的 `mopai.template-custom.v1`，按模板 id 分开；「恢复默认」清掉当前变体的颜色和这个模板的全部字体选择。
- 读者添加的字体（`.ttf` / `.otf` / `.woff` / `.woff2`，单个最多 40 MB）只存在这台设备浏览器的 IndexedDB `mopai.user-fonts`，不上传。导出时 `.ttf` / `.otf` 用 HarfBuzz（WebAssembly）裁成只含这张图用到的字再嵌入，`.woff` / `.woff2` 整个嵌入。删除字体后，用到它的位置回到模板默认。
- 不写 `customize` 的模板不显示这块面板。默认 Reed 模板开放「主色」和正文字体。

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
- 只有 `url()` 可以携带资源地址，而且只能指向包内文件，加载时替换成 data URL；`url(#本地id)` 可以保留。`http(s):`、`//`、缺失文件都拒绝。
- `image-set()` / `-webkit-image-set()` 一律拒绝，即使里面只是相对路径字符串（浏览器仍会向本站发 GET）。`cross-fade()`、`-webkit-cross-fade()`、`element()` / `-moz-element()`、`paint()`、`src()`、`image()`、`-webkit-canvas()`、`-webkit-named-image()` 等会把字符串当地址的函数也一律拒绝。属性值、`@font-face` 和任何 at-rule 里的出现都算。
- `position: fixed` / `sticky` / `-webkit-sticky` 一律拒绝，包括 `:scope.xhs-card` 自身和 `@media` 内部；`position: var(--p)` 这类无法证明安全的值也拒绝。卡片外还有一层模板选择不到的 `contain: paint` + `isolation: isolate` 容器，漏网的超大 transform / z-index 不会盖住编辑器。HTML 的 `style` 属性同样不允许。
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
Pixelify Sans, Tinos, Instrument Sans, B612 Mono, LXGW WenKai, Smiley Sans,
ZCOOL XiaoWei, ZCOOL QingKe HuangYou, ZCOOL KuaiLe, Ma Shan Zheng,
Noto Sans SC Black, Unbounded Sans, Tiejili SC, GenRyuMin2, GenYoMin2,
Glow Sans SC, Anton, Instrument Serif
```

`weights` / `styles` 必须在该 family 的内置声明范围内，例如 `Zhuque Fangsong` 和霞鹜文楷到马善政楷书这六款都只有 400，`Noto Sans SC Black` 只有 900；无界黑 `Unbounded Sans`、铁蒺藜体 `Tiejili SC`、`Anton`、`Instrument Serif`（正体和斜体）只有 400，源流明体 `GenRyuMin2`、源样明体 `GenYoMin2` 有 700 和 900，未来荧黑 `Glow Sans SC` 只有 900。单字重的标题字体用在 800 / 900 的标题上时，浏览器会再假加粗一层；模板可以在根上写 `font-synthesis-weight: none` 关掉。

`Noto Sans SC Black` 是思源黑体的特粗字重。单独起名是为了不影响已有模板里 `Noto Sans SC` 的 800 / 900 粗体（它们仍用 700 字形）；要用特粗标题就在 `fonts` 里引用它，CSS 写 `font-family: "Noto Sans SC Black"; font-weight: 900`。

读者在 `customize` 字体菜单里能选的是其中 15 款中文字体：思源黑体、思源黑体 特粗、思源宋体、朱雀仿宋、霞鹜文楷、得意黑、站酷小薇体、站酷庆科黄油体、站酷快乐体、马善政楷书、无界黑、铁蒺藜体、源流明体、源样明体、未来荧黑。它们都是 SIL OFL 1.1 字体，按 Unicode 区段切成小文件，用到哪段才下载哪段；许可证副本在 `public/fonts/OFL-*.txt`，来源见 [渲染与图片](rendering.md)。

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
| `customize.colors` | 10 |
| `customize.fonts` | 4 |

超限、坏 manifest、路径穿越、zip 炸弹、非白名单扩展名、危险 HTML/CSS 或包外资源都会让上传失败，界面会给出对应的中文 / 英文提示。解压是流式的：中央目录声明的大小只用于提前判断，实际字节一边解压一边累计，超过单文件或总上限立刻中止并丢弃，声明 1 KB、实际几百 MB 的 zip 不会先被整块解开。

## 8. 上传与存储

- 入口：编辑器右栏「模板」→「我的」组标题右侧的「上传」。「管理」进入管理状态后，每张自己的模板旁出现「删除」。文件选择器支持一次选多个 `.reedcard`，逐个处理，失败的逐个给出原因，报错框就放在「我的」组标题下方。
- 上传的模板与内置模板走同一条分页、封面标题适配、精确字号导出、字体嵌入、单张 PNG 和整包 ZIP 管线。
- 原始 zip 与解析结果都存在本机 IndexedDB `mopai.card-templates`；刷新页面后仍然在，删除后从本机移除。
- 内置模板只剩 Reed 默认模板；模板文件是另一种来源，不与内置模板合并，也不会覆盖它。记住的旧内置模板选择会自动回到 Reed（本机键 `mopai.card-options.v1`）。
- 登录后，「我的」组会与站长的云端模板库双向同步：只在本机的上传，只在云端的下载；同一个模板 id 两边内容不同时，上传时间晚的那份赢，不弹窗。同步状态（同步中 / 已同步 / 失败并可重试）显示在「我的」组标题下方。下载的包走和本地上传完全相同的解析与安全检查。登录状态下删除会同时删除云端与本机；访客删除只影响这台设备，并会明确提示。
- 删除是跨设备生效的：服务端删模板时留下一条服务器时间的墓碑（每个账号保留最近 200 条）。其他设备同步时会比较本机记住的「这份副本对应的云端上传时间」和墓碑时间：早于或等于墓碑的旧副本只从本机移除，并提示「已按其他设备的删除，移除 N 个模板」；从没同步过的副本（删除后在这台设备新加的），以及上传时间晚于墓碑的副本，仍会上传并清掉墓碑。比较只用服务器时间，不拿设备时钟和服务器时间比，避免手机时钟不准时误删刚加的模板。当前选中的模板被移除时，选择回到 Reed。
- 云端上限：单包 8 MB、每人最多 30 个、总计 100 MB；服务端不解压 zip，只校验大小与 zip 文件头，下载一律作为 `application/octet-stream` 附件发送并带 `nosniff`。
- 模板里的设计归上传者所有。上传即表示你有权使用其中的字体、图片与版式。

## 9. 最小示例

`examples/card-templates/example/manifest.json` 与同目录的 `pages/`、`styles/`、`fonts/` 是一个可以直接打包上传的完整模板，包含：

- 三个比例；
- 日间 / 傍晚两个变体；
- 独立结尾页；
- 内置 Noto Sans SC / Geist Mono 与包内 woff2 字体；
- 封面标题自适应、页眉、页脚、页码。

把它打包后上传，就能在「我的」组里看到并使用。

## 10. 长图模板

同一个 `.reedcard` 包也可以是长图模板：在 manifest 里写 `"kind": "long"`。不写 `kind` 就是卡片，前面九节的规则不变。长图的用法见 [长图模式](long-image.md)。

和卡片不同的地方只有这些：

| 项 | 长图模板 |
|---|---|
| `ratios` / `defaultRatio` | 不接受，写了会被拒绝（长图没有固定比例） |
| `metrics` | 只有四项：`padX`（0–140）、`contentWidth`（200–540）、`photoGap`（0–60）、`photoInset`（0–80）；`contentWidth + 2 × padX` 不能超过 540 |
| `pages` | 只有 `header` 和 `footer`，都可以不写；小节和照片组由引擎生成 |
| CSS 作用域根 | `.reed-long-root`（外层）和 `.reed-long-flow`（内容流） |

其余字段（`id`、`renderId`、`name`、`version`、`author`、`description`、`variants`、`fonts`、`customize`、`styles`）、允许的 HTML、CSS 规则、字体、大小限制和上传存储都与卡片相同。

### 页面片段与 slot

`header` 在稿件有一级标题时出现，`footer` 在稿件有落款（最后一个单独一行的 `---` 之后有内容）时出现。可用的 slot：

| slot | 内容 |
|---|---|
| `title` / `subtitle` | 一级标题和紧跟的短段落；为空时元素被移除 |
| `cover` | 头图，只能放在 `<img>` 上，引擎写入 `src`；没有头图时元素被移除 |
| `content` | 仅 `footer`：落款内容（引擎渲染好的段落） |
| `author` | front matter 的 `author`；为空时元素被移除 |
| `brand` / `date` | 与卡片相同 |

条件属性在卡片的 `data-when-variant`、`data-when-dark` 之外多一个 `data-when-cover="true|false"`：有没有头图时各显示哪一块。

### 引擎生成的结构

```html
<div class="reed-long-root" data-template="…" data-variant="…" data-kind="long">
  <div class="reed-long-flow">
    <!-- header 片段 -->
    <div class="reed-long-preamble">…</div>            <!-- 第一个二级标题之前的正文 -->
    <section class="reed-long-section">
      <div class="reed-long-section-head">
        <span class="reed-long-section-mark"></span>
        <h2 class="reed-long-section-label"><span>小节标题</span></h2>
        <span class="reed-long-section-kicker">KICKER</span>   <!-- 写了才有 -->
      </div>
      <div class="reed-long-section-body">
        <p class="reed-long-lede">小节的第一段</p>
        <div class="reed-long-photos" data-photo-count="5">
          <div class="reed-long-photo-frame">
            <div class="reed-long-photo-row">
              <figure class="reed-long-photo"><img></figure>
            </div>
          </div>
          <span class="reed-long-photo-next"></span>
        </div>
        <div class="reed-long-divider"></div>             <!-- 小节里的 --- -->
      </div>
    </section>
    <!-- footer 片段 -->
  </div>
</div>
```

照片行的宽高由引擎按原始比例算好并写成内联样式，模板不要改 `.reed-long-photo` 的宽高，只画外框、间距和装饰。

引擎还给正文留了几个钩子，模板用得上就写 CSS，用不上什么都不用做：

| 钩子 | 来自 Markdown | 用法 |
|---|---|---|
| `figure.reed-long-photo[data-has-caption] > figcaption.reed-long-photo-caption` | 照片的说明文字 `![说明](…)` | 默认带 `hidden` 不显示。模板写 `.reed-long-photo-caption { display: block }` 就显示在照片下方：照片仍按行高排，`figure` 的高度随说明变高。显示说明时别给 `.reed-long-photo` 加上下内边距或边框，否则会撑出行外 |
| `p[data-lead]` | 段落以一段加粗开头，后面还有正文：`**导语** 近日……` | 开头的加粗词是 `p[data-lead] > strong:first-child`，可以排成标签 |
| `p[data-label]` | 整段都是加粗、不超过 16 个字：`**要点**` | 一行小标签，常用来给下面的列表起头 |
| `ul[data-lead-items]` / `ol[data-lead-items]` | 列表的每一项都以加粗开头：`- **10倍** 推理速度提升` | 可以排成数字卡片或带箭头的步骤卡；每项的加粗部分是 `li > p > strong:first-child` |

这几个属性只按 Markdown 的写法判断，不看文字内容；不满足条件的段落和列表保持原样。

导出时每个块的高度会按预览量到的值固定下来，穿出父元素的外边距在这一步会丢。引擎自己的容器（`.reed-long-preamble`、`.reed-long-section`、`.reed-long-section-body`）已经是 `display: flow-root`；`header` / `footer` 片段的最外层元素请自己留 padding 或写 `display: flow-root`，别让里面的外边距穿出去，否则导出会比预览矮。

引擎在 `.reed-long-root` 上提供这些变量：

| 变量 | 含义 |
|---|---|
| `--long-pad-x`、`--long-content-w`、`--long-photo-gap`、`--long-photo-inset` | manifest 里的四项 metrics，带 `px` |
| `--long-title-units`、`--long-subtitle-units` | 标题、副标题大约相当于多少个全角字（中文算 1，其它算 0.55）。用它让长标题自动缩小，例如 `font-size: clamp(30px, calc(486px / var(--long-title-units, 8) - 2px), 56px)` |

### 最小示例

`examples/card-templates/example-long/` 是一个可以直接打包上传的长图模板：白底、一个变体、只用内置 Noto Sans SC。

```bash
node scripts/cards/pack-template.mjs examples/card-templates/example-long example-long.reedcard
```
