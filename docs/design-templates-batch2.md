# 设计系统模板（第二批）

本文接 [设计系统模板](design-templates.md)，原则沿用第一批：结构跟着系统走，不只借色；设计系统是唯一事实来源；卡片与公众号分开想；公众号浅色为主；按载体换算尺度。第一批三套（YORU Content、PAPER、yoru-and-akari Console）已经落成公众号主题；这一批写剩下六套的设计依据，其中 KUNLUN、RIFT、core、Aozora、KIHON 已落成公众号主题，六套的卡片模板也都已落成；Mayonaka 不做公众号主题。各系统仍按自己的规则处理，不混成一套。

推荐实现顺序：

1. **KUNLUN · 雪线**：上游已有批准的浅色主题，公众号和卡片都能直接取；结构（切角、LCD、HUD）静态也成立。
2. **RIFT · 黎明**：浅色是完整的 token override，公众号只需要把 glitch 静态化；卡片可做深色主形态。
3. **core · 霜纸**：默认就是浅色，卡片可完整复刻 Y2K 窗口；公众号需要把绝对叠窗改成流式叠窗。
4. **Aozora · 青空**：浅色 daylight 可用，但玻璃只能模拟，且系统禁止真实照片；卡片和公众号都要收窄适用范围。
5. **KIHON · 银**：卡片原生 9:16 最合适；公众号要处理视频字号与“帧边缘保持干净”的规则，放在卡片之后更稳。
6. **Mayonaka · 真夜中**：只有深色，不做公众号；卡片是它的主场，放最后单独做。

下文路径都相对 yoru-design-systems 仓库根；读取时本机 clone 为 `e1ad05f`。设计系统代码本身沿用上游 MIT；字体是另一层授权，按下面的字体表逐项处理。

## 共同边界

- **公众号只做浅色。** 读者端会把页面自动转深色，深色主题很容易被转成脏色或亮块。六套里只有 Mayonaka 没有浅色形态，所以本批不为它做公众号主题。
- **公众号不依赖 `backdrop-filter` 和 `clip-path`。** 微信编辑器对内联样式的支持有边界；玻璃用半透明底、1px 亮边和内阴影模拟，切角用直角加 L 形角标或 1px 线兜底。卡片是浏览器截图，才用真实模糊与切角。
- **卡片不改变分页器。** 卡片仍是 540px 宽、导出两倍像素；模板只提供视觉皮肤、封面/正文的结构差异，以及必要的页眉页脚开关。六套都不把公众号主题的正文规则直接搬到卡片。
- **字体分两条路。** 卡片可以把网页字体嵌进 PNG；公众号只能用读者手机里的字体，主题的辨识度靠颜色、线条、间距和结构。所有公众号字体栈都必须有系统字体兜底。
- **动效不进静态载体。** RIFT 的 glitch、Mayonaka 的扫描线漂移、KIHON 的入场阶梯都只作为静态构图或卡片上的固定纹理，不在公众号或 PNG 里跑动画。
- **`PROPOSAL` 的含义。** 上游没有写、需要模板自己决定的，标 `PROPOSAL`；实现前可以和 Yoru 再确认，但不影响先做小样。

第二批六套的卡片落地只改卡片层，不改公众号主题。尺寸仍以 540 CSS px 为画布、PNG 两倍导出；1242px 卡片稿按 540/1242 ≈ 0.435 换算，KIHON 的原生 1080×1920 按 0.5 换算。六套都不使用两端刻点分隔线、齿纹带、刻度、读数或角落英文小标签，也不在卡片上印设计系统名或模板名；每张卡只在页脚或状态栏保留一处页码。正文、副标题和小字与它们实际压住的底色（含渐变、颗粒和扫描线）对比度不低于 4.5:1，24px 以上的粗体标题不低于 3:1。

## Aozora 青空

来源：`Aozora 青空 Design System/README.md`（「Visual foundations」「Content fundamentals」「Imagery」「Caveats」）、`Aozora 青空 Design System/SKILL.md`，`tokens/colors.css`、`tokens/semantic.css`、`tokens/typography.css`、`tokens/radius.css`、`tokens/glass.css`、`tokens/gradients.css`、`tokens/yozora.css`，`foundations/type-mixed.html`、`foundations/glass-tiers.html`、`components/surface/Card.prompt.md`。

**适不适合。** 公众号：**改编**。daylight 是浅色，蓝白纸和玻璃块都能成立；但 iOS 26 液体玻璃依赖 `backdrop-filter`，公众号里只能模拟，不能宣称“真玻璃”。系统又明确“不用真实照片”，所以带摄影稿的公众号不适合套青空。卡片：**做**，但限定文字、抽象玻璃/水滴/太阳和截图类内容；真实照片不进 Aozora 卡片。

| 部位 | 来源 | 借用 |
|---|---|---|
| 页面底色 / 纸色 | `tokens/colors.css`、`tokens/gradients.css` | 公众号用 `neutral-50 #F7FAFD` 作纸，顶部标题区用 `--gradient-morning`（`#EAF5FF → #CFE8FF → #9DD2FF → #FFE980`）；卡片 daylight 用 morning / mesh 渐变，yozora 用 `tokens/yozora.css` 的 `night-800 #071426`。公众号把纯白页面改成 `neutral-50` 是 `PROPOSAL`，目的是让玻璃有底色。 |
| 文字墨色层级 | `tokens/semantic.css`、`tokens/colors.css` | strong `#131922`、body `#232C36`、muted `#5C6B7C`、faint `#8A9AAB`；链接 `blue-600 #006FE0`。正文只用 body，标题才用 strong。 |
| 强调色及限制 | `tokens/colors.css`、`README.md`（Colors） | 主色 `#0A84FF`；太阳黄 `#FFE34D` 只做小 chip、焦点或海报斜切，绝不做背景砖；mint / coral / peach / lilac 只进插画和 badge。公众号里黄色最多一个 kicker 点或一处高亮。 |
| 圆角 | `tokens/radius.css` | 4 / 8 / 14 / 20 / 28 / 36 / pill；按钮 14，卡片 20–28，hero 36，chip 用 pill。公众号只用 14–28；卡片 28–36。 |
| 线条和分隔 | `tokens/semantic.css`、`tokens/glass.css` | 发丝线 `rgba(10,68,140,.08)`，强线 `.24`；玻璃描边是 55% 白加 `--glass-edge` 顶部亮边。只用 1px 线，不用粗黑分隔；分节靠留白和玻璃块，不靠彩色左边条。 |
| 标题与编号 | `tokens/typography.css`、`foundations/type-mixed.html` | 标题用 `--font-display` Inter，48–200px、字距 `-.03em`；海报语法是竖排 eyebrow（10–11px、`.16–.32em` 字距）+ 大号拉丁标题 + 小号日文副题 + 角落小注。上游没有章节编号，公众号用等宽 `01 / 05` 作 kicker 是 `PROPOSAL`；卡片封面保留竖排 eyebrow，公众号改成横排，属于载体适配 `PROPOSAL`。 |
| 加粗与高亮 | `tokens/typography.css`、`tokens/colors.css` | 正文加粗用 700/800 墨色，不加彩色；`==高亮==` 用太阳黄 50–55% 的下半行荧光带是 `PROPOSAL`，因为系统只规定黄色做 accent，没有规定高亮组件。 |
| 引用 | `tokens/glass.css`、`components/surface/Card.prompt.md` | 系统没有独立引用组件；用 regular glass（白 48%、20–24px 圆角、顶部亮边）承载引文，不加左侧色条。整个引用块是 `PROPOSAL`；公众号把白 48% 改成白 72% 并去掉模糊。 |
| 代码 | `tokens/typography.css`、`tokens/glass.css` | JetBrains Mono；深色玻璃 `--glass-bg-dark` 或实色 `#07090E`，白色文字，1px 白色顶部亮边。系统没有代码组件，这个组合是 `PROPOSAL`；公众号没有模糊，用实色深蓝黑加 inset 高光；卡片可以保留半透明。 |
| 图片与图注 | `README.md`（Imagery）、`tokens/radius.css`、`tokens/glass.css` | 图片 20–28px 圆角、1px 白玻璃描边、蓝调阴影、顶部亮边；图注 11px 等宽、`.16em` 字距、muted。系统禁止真实照片，卡片里只放抽象玻璃/水滴/太阳或 UI 截图；公众号同样不把摄影图放进青空。 |
| 标志性结构 | `README.md`（Layout、Glass）、`foundations/glass-tiers.html` | 不是“蓝色加圆角”，而是：玻璃永远压在颜色/渐变上；每块玻璃有顶部亮边；海报是竖排 eyebrow + 巨大标题 + 小副题 + 角落注；内容用 bento 玻璃块。公众号保留“玻璃压在浅色渐变上”和“巨大标题 + 小副题”，卡片保留全部海报语法。 |
| 系统不许出现 | `README.md`（Content fundamentals、Visual foundations、Imagery、Iconography） | 不用 emoji；不用真实照片；不用图标式插画；不用硬 90° 角（海报编辑块除外）；不用纯黑阴影；玻璃不放在纯白平面上；感叹号只允许促销 banner；不把太阳黄当背景砖。 |

**字体。** Inter（拉丁正文）、Bebas Neue（海报标题）、Space Grotesk（字标）、Fraunces（可选衬线）、JetBrains Mono（代码/数字）、Noto Sans JP / Noto Serif JP（日文）。全部 SIL OFL 1.1，可以自托管并随 Reed 再分发。中文按系统规定用 PingFang SC / 思源黑体，Reed 用现有 Noto Sans SC 代替。公众号回落：标题 `Bebas Neue → Impact / Arial Narrow → PingFang SC / 微软雅黑`；拉丁正文 `Inter → Helvetica / Arial`；中文 `PingFang SC / 微软雅黑`；代码 `Menlo / Consolas`；日文 `Hiragino Sans / Yu Gothic`。

**卡片模板方案。**

- 变体：`daylight`（默认，晨空渐变 + 玻璃）和 `yozora`（夜空蓝玻璃）。两套都出 cover / body；比例 3:4、1:1、9:16。
- 需新增字体：Inter 400/600、Bebas Neue 400、Space Grotesk 500/700、JetBrains Mono 400、Noto Sans JP 400/700；Fraunces、Noto Serif JP 按需。
- 尺寸：按 1242×1660 的卡片稿换算，`540 / 1242 ≈ 0.435`（`PROPOSAL`，上游没有小红书画布）。不要按 App 的 390px 画布放大到 1.385，卡片是海报，不是手机界面；圆角、间距按 0.435 取整，字号另设：封面 54–72px，正文 18px / 1.75。
- 结构：封面用竖排 eyebrow、大号拉丁标题、日文小副题、底部作者/页码，玻璃托盘只压在渐变上；正文每页只放一块玻璃托盘，图注等宽小字。玻璃用 `rgba(255,255,255,.55)` + 1px 白描边 + `inset 0 1px 0` 高光模拟，避免截图时依赖模糊。抽象 SVG 资产从系统 `assets/` 取，不另画。
- 图像限制：不做真实照片版；有摄影图的文章换别的模板，不能静默丢图。截图可以放进玻璃框，但标为内容而不是品牌插画。

**公众号主题方案。** id `aozora-daylight`，中文名「青空」，分类「活力」。只做 daylight，不做 yozora。页面 `#F7FAFD`，标题区用 morning 渐变，正文 16px / 1.75；H1 28–32px，H2 22px，标题字体栈 `Bebas Neue / Inter / PingFang SC`；玻璃块只用于引用和重点段，`rgba(255,255,255,.72)` + 1px 白描边 + inset 高光 + 蓝调轻阴影，不使用 `backdrop-filter`；强调色 `#0A84FF`，太阳黄只做一个 kicker 点或一处高亮；代码 `#07090E` 深色块；图片 20px 圆角、白描边，按普通图片展示、不套玻璃框。微信转深色时渐变会被压暗，玻璃只放在承载块上，页面本身保持浅色。

**公众号主题落地。**

- 主题 `aozora-daylight`（青空）在 `src/lib/themes-design.ts`。根容器 `max-width:677px`，页面平的 `#F7FAFD`，正文 16px / 1.75；正文不写 `font-family`，标题才用 `Bebas Neue → Impact / Arial Narrow → PingFang SC` 栈。
- 标题与编号：H1 是 morning 渐变（`#EAF5FF → #CFE8FF → #9DD2FF → #FFE980`）的 28px 圆角海报块，1px 白玻璃边 + 顶部内高光 + 蓝调轻阴影；H2 用等宽 `01 / OVERVIEW` kicker + 22px 大标题，不加横线，靠留白与玻璃块分节（上游没有章节号，这是 `PROPOSAL`）。
- 玻璃只做静态：引用与居中重点段是白 72% 覆在晨空蓝渐变（`#EAF5FF → #CFE8FF → #9DD2FF`）上的 24px 圆角块，1px 白描边 + `inset 0 1px 0` 顶部亮边 + `0 6px 18px rgba(10,68,140,.12)` 蓝调阴影；不用 `backdrop-filter`、外链背景图、滤镜或伪元素。
- 加粗 700 墨色；高亮是太阳黄 `#FFE34D` 55% 的下半行带，全文只此一种黄色用法；链接 `#006FE0`。代码是 `#07090E` 实色深玻璃、`#F7FAFD` 字、JetBrains Mono 栈 13px、顶部内高光；行内代码用 14px 圆角的浅玻璃。
- 图片按普通图片展示：20px 圆角、1px 白玻璃描边、蓝调轻阴影，不给照片套玻璃框、不加照片滤镜；图注 11px 等宽、`.16em` 字距。图组沿用同一套图片样式，轮播共用同一套圆角与描边；玻璃只留给引文与重点段。
- 表格、分隔线、署名用 8% 蓝发丝线与等宽标签；accent 蓝只做编号、链接、图号；没有 emoji、图标式插画、硬 90° 角、纯黑阴影，也不把太阳黄当背景砖。
- 与设计系统的差异：公众号没有 `backdrop-filter`，玻璃是白 72% 填充 + 顶部内高光；morning 渐变只留在标题海报块，页面本身保持平色；竖排 eyebrow、角落小注与 bento 网格不进正文；yozora 不做，真实照片和完整液体玻璃留给卡片。

**卡片模板落地。**

- 变体 `daylight`（默认晨空渐变）/ `yozora`（夜空蓝），3:4、1:1、9:16 都可用。卡片字体 Inter 400/600、Space Grotesk 500/700、JetBrains Mono 400、Noto Sans SC 400/700；不额外打包 Noto Sans JP。
- 封面：压在渐变上的 28px 玻璃托盘、大号标题与副题；底部作者与 `01 / 05`。托盘和页脚统一用左右 42px 的边距，去掉原来的竖排 `青空` eyebrow 和字标后仍然居中平衡。玻璃是静态白 55% + 1px 白描边 + 顶部内高光 + 蓝调阴影，不依赖模糊。
- 正文：每页一块玻璃托盘（20px 圆角），H2 26px + JetBrains Mono `01 / OVERVIEW` 式小 kicker；加粗 700 墨色；高亮是太阳黄 55% 下半行带，全文只此一种黄色用法。daylight 的次级文字提到 `#4A5868`，强调色和链接色用 `#005DB3`，页脚压在晨空底部黄色上仍达到 4.5:1。
- 引用是白 72% 玻璃块；代码是 `#07090E` 深玻璃 + JetBrains Mono 13px；图片按普通图片展示：20px 圆角、蓝调阴影，不套玻璃框、不加照片滤镜；图注 11px 等宽 `.16em`；表格与分隔线 1px 蓝发丝线；页脚作者与页码。
- 系统禁止真实照片与 emoji。卡片允许抽象玻璃/水滴/太阳或 UI 截图；摄影稿应换模板，Reed 不会把照片包装成青空品牌插画。

## KIHON 基本

来源：`KIHON 基本 Design System/README.md`（「The 9th system」「VISUAL FOUNDATIONS」「Type hierarchy」「One tick grid」「Considered and rejected」「Type substitution flags」）、`KIHON 基本 Design System/SKILL.md`，`tokens/colors.css`、`tokens/typography.css`、`tokens/surfaces.css`、`tokens/spacing.css`、`tokens/fonts.css`，`components/type/type.card.html`、`components/frame/frame.card.html`、`components/data/data.card.html`。

**适不适合。** 公众号：**改编**。银灰金属底是浅色，能直接做，但 KIHON 原本是 1080p 视频帧，不是长文；它的字号、空白和“帧边缘保持干净”的规则需要翻译到 677px 文章栏。卡片：**做**，而且是最合适的载体之一：系统原生有 9:16，540×960 正好是它的竖版画布；但 Reed 通用的顶部文章名和底部页码会违反“帧边缘干净”，必须允许 KIHON 模板关掉这两行。

| 部位 | 来源 | 借用 |
|---|---|---|
| 页面底色 / 纸色 | `tokens/colors.css`、`tokens/surfaces.css` | 银（gin）：page `#E7E9EB`、well `#DDE0E3`、plate `#EDEFF1`、card `#F4F5F6`、control `#FAFBFB`，全都不用到 `#FFFFFF`；每层有约 1.5% 的竖向 brushed 微渐变。玄（kuro）：page `#111417`、card `#1D2226`、accent `#7BA3CC`。公众号只做银。 |
| 文字墨色层级 | `tokens/colors.css`、`tokens/typography.css` | ink `#16191C`、muted `#5A636B`、faint `#8D969D`；accent gun blue `#2B4C6F`；negative oxide red `#A6402F` 只用于错误。数据只用 `--ramp-1..4`（`#C3CACE / #8E979E / #4E585F / #16191C`），不用色相区分系列。 |
| 强调色及限制 | `tokens/colors.css`、`README.md`（Color rules） | 烤蓝 `#2B4C6F` 只标状态：selected、active、AFTER、CTA、链接、章节号。它不做数据系列、不做装饰、不做背景。positive 故意等于 accent；negative 才是氧化红。 |
| 圆角 | `tokens/surfaces.css` | card 10、control 8、chip 6、pill 999。是“金属板”不是“枕头”；卡片不要用 16–24 的大圆角。 |
| 线条和分隔 | `tokens/surfaces.css`、`README.md`（One tick grid） | 每个面都有 1px `--line #C8CDD1`，强调时换 `--line-strong #16191C`；两段式 chamfer 是“上 1px 亮 + 1px 半亮，下 1px 暗 + 1px 半暗”；上游的 knurl 是 1px 齿、5px 节距、10px 高的刻度带，Rule 两端各有一个 5px 竖向刻点。**2026-10-31 Yoru 决定公众号和卡片都不用两端刻点和齿纹带，只用普通 1px 线**；分隔不用彩色横条。 |
| 标题与编号 | `tokens/typography.css`、`components/type/type.card.html` | title 88px / 1.12 / 700，subtitle 54px / 1.3 / 300；label 30px / 0.14em / 大写；data value 132px B612 Mono、tabular。编号用 `01 / 05` 等宽标签加一条普通 1px 线（2026-10-31 Yoru 决定公众号和卡片都不用两端刻点和齿纹带，只用普通 1px 线），前面不加“第几章”的汉字。公众号按 677/1920 ≈ 0.353 换算：正文 15.5px、H2 31px、label 10.5px；卡片按 540/1080 = 0.5 换算。 |
| 加粗与高亮 | `tokens/colors.css`、`tokens/surfaces.css` | 加粗 700 墨色；`==高亮==` 用 accent-soft `#DCE3EB` 的浅金属凹槽 + 1px 底线是 `PROPOSAL`；不要用黄色荧光笔，也不要把 accent 当高亮底色。 |
| 引用 | `tokens/surfaces.css`、`components/frame/frame.card.html` | 引用是 recessed well：`--grad-well`（`#DADDE0 → #DFE2E5`）、1px line、8px 圆角、`--shadow-well` 内凹；不用左侧彩色竖条。系统没有独立引用组件，组合成引用块是 `PROPOSAL`；引文里的强调仍只用 accent 状态色。 |
| 代码 | `tokens/typography.css`、`tokens/surfaces.css` | B612 Mono，13px；代码块用 well（凹槽）而不是深色终端；无语法高亮，只有墨色层级。系统没有代码组件，这个组合是 `PROPOSAL`；公众号里 well 用 1px 线 + inset 阴影；卡片保留完整凹槽和 8px 圆角。 |
| 图片与图注 | `tokens/surfaces.css`、`README.md`（Craft on the content itself） | 图片放在 card 面：1px line、10px 圆角、两段式 chamfer、三层定向阴影；图注用 caption 34px（卡片 17px / 公众号 12px），muted；图号用 B612 Mono、tabular。图片本身不倾斜、不裁成异形。 |
| 标志性结构 | `README.md`（5 surface levels、lens falloff、knurl、engraved type、frame edges） | 五个不透明层级（well → bg → plate → card → control）；每个面 1px 边框 + 两段 chamfer；页面有镜头式 falloff 和 5% 颗粒；标签是“刻”进金属的（`--engrave`）；数字要大、要等宽、要对齐；帧边缘留空，不放顶部标签条或底部进度条。上游的 knurl 和 Rule 两端刻点不采用：2026-10-31 Yoru 决定公众号和卡片都只用普通 1px 线。只借颜色不算。 |
| 系统不许出现 | `README.md`（Depth、Color rules、Detail at small sizes、Iconography、Considered and rejected） | 不做 Console 那种软阴影新拟态；不用色相做数据系列；accent 不做装饰；不用大圆角卡片；中文正文不用等宽；不用 emoji 或图标库；不做顶部标签条/底部进度条/相机饰件；没有 logo，字标只用字体排；边框外不加装饰。 |

**字体。** Source Han Sans SC（中文）、Instrument Sans（拉丁/标签）、B612 Mono（数字/编号）。Source Han Sans 现行为 SIL OFL 1.1（1.001 旧版是 Apache 2.0，两者都允许自托管）；Instrument Sans、B612 Mono 均为 SIL OFL 1.1。Reed 已有 Noto Sans SC（与思源黑体同源），建议直接代用，避免再打一套 CJK；Instrument Sans 400/500/700 与 B612 Mono 400/700 已落盘。公众号回落：标题/拉丁 `Instrument Sans → Helvetica / Arial`；中文 `PingFang SC / 微软雅黑`；数字/标签/代码 `B612 Mono → Menlo / Consolas`；中文正文绝不套等宽栈。

**卡片模板方案。**

- 变体：`gin`（默认银）和 `kuro`（玄）。只做 9:16，尺寸 540×960；不做 3:4 / 1:1，因为系统原生画布就是 1080×1920，重排到其他比例会破坏“两种原生版式”的规则。Reed 的卡片比例选择器在 KIHON 模板下应禁用另外两种比例，而不是把 9:16 硬塞进 3:4。
- 需新增字体：Instrument Sans 400–700、B612 Mono 400/700；中文用现有 Noto Sans SC 代 Source Han Sans。
- 尺寸：`540 / 1080 = 0.5`。标题 88→44px、display 108→54px、正文 44→22px、label 30→15px、caption 34→17px、data value 132→66px；安全区按 9:16 的 7.5% / 6%，内容不贴边。正文 22px 偏大，是有意的视频帧尺度；KIHON 卡片适合短稿、数据卡、步骤卡，不适合 3000 字长文全文分页。
- 结构：封面用 title / data / before-after / steps 里的原生骨架；正文用 plate/card/well 层级；2026-10-31 Yoru 决定卡片也不用齿纹带和两端刻点，需要分隔时只用普通 1px 线；页眉页脚默认关闭，页码若要保留，只作为内容区右下角的一个 `01 / 05` 等宽编号，不做整条 footer（`PROPOSAL`，需要 Yoru 拍板）。
- 纹理：卡片用 5%（银）/ 7%（玄）的颗粒和 lens falloff；公众号不用页面颗粒，避免被微信转色后变脏。

**公众号主题方案。** id `kihon-gin`，中文名「银」，分类「商务」。只做银，不做玄。页面 `#E7E9EB`，正文 15.5px / 1.7，按 677/1920 ≈ 0.353 从视频字号换算；H2 用 `01 / 05` 等宽 kicker + 19–22px 标题；每个承载块 1px `#C8CDD1` 边、10px 圆角、inset 亮暗两段边；引用和代码用凹槽；分隔只用普通 1px 线，不用两端刻点和齿纹带（2026-10-31 Yoru 决定公众号和卡片都不用）；accent 只给编号、链接和状态；页面不铺颗粒，承载块最多 5% 颗粒。微信深色模式可能把银灰压暗，保留 1px 上亮边和下暗边，免得整块糊成一片。

**公众号主题落地。**

- 主题 `kihon-gin`（银）在 `src/lib/themes-design.ts`。根容器 `max-width:677px`，银灰 `#E7E9EB` + 约 1.5% 竖向拉丝渐变 + 镜头式 falloff；正文 15.5px / 1.7（44 × 677/1920 ≈ 15.5），中文不套等宽栈，页面不铺颗粒。
- 标题与编号：H1 是 card 面（10px 圆角、1px `#C8CDD1` 线、两段 chamfer、三层定向阴影），标题 31px（88 × 0.353）700；H2 = 等宽 `01 / kicker` 刻字标签 + 一条普通 1px 线 + 21px 标题（2026-10-31 Yoru 决定公众号和卡片都不用两端刻点和齿纹带，只用普通 1px 线）；H3 17px，下沿 1px 线。编号不写「第几章」。
- 承载块分五档：card `#F4F5F6`、plate `#EDEFF1`、well `#DDE0E3` 都保持不透明、1px 线和约 1.5% 拉丝微渐变；引用与代码是 well（内凹三段阴影 + 底部亮唇），表格是 plate，图片放在 card 面（10px 圆角、两段 chamfer，图片本身 6px 圆角、不裁异形）。
- 加粗 700 墨色；高亮是 `#DCE3EB` 浅金属凹槽 + 1px `#8E979E` 底线，不用黄色荧光笔，也不把烤蓝当底色；链接与编号用烤蓝 `#2B4C6F`（只做状态）。代码用 B612 Mono 13px、无语法高亮。
- 图注 12px（34 × 0.353）、muted，图号用 B612 Mono tabular；无序列表用系统 `·` 圆点，有序列表两位补零；分隔线只用普通 1px `#C8CDD1` 线（2026-10-31 Yoru 决定公众号和卡片都不用两端刻点和齿纹带），表格与正文分隔同样只用 1px 线。
- 页面家具不进正文：不加顶部标签条、底部进度条、帧角刻度、相机饰件，也没有 logo；5% 颗粒只留给卡片，公众号不铺。等宽只给编号、标签、数字和代码。
- 与设计系统的差异：1080p 视频画布的 88/54/44/34 等字号按 677/1920 换算成 31/19/15.5/12px；9:16 / 16:9 两种原生版式与入场阶梯不进正文；上游的 Rule 两端刻点和 knurl 齿纹带都不进公众号，只用普通 1px 线（2026-10-31 Yoru 决定公众号和卡片都不用）；玄（kuro）不做。

**卡片模板落地。**

- 变体 `gin`（默认银）/ `kuro`（玄），**只做 9:16**。选中 KIHON 时比例自动切到 9:16，3:4 与 1:1 按钮禁用，并在比例行下给一句提示。卡片字体 Instrument Sans 400/500/700、B612 Mono 400/700、Noto Sans SC 400/700。
- 封面：card 面的 10px 圆角 + 两段式 chamfer、44–54px 标题、20px 副标题、一条普通 1px 线；没有字标、页眉页脚，只在右下角保留 `01 / 05` 的 B612 Mono 页码。
- 正文：22px / 1.45 的视频帧尺度；H2 32px + B612 Mono kicker + 普通 1px 线，H3 26px；加粗 700；高亮是 `#DCE3EB` 浅金属凹槽 + 1px `#8E979E` 底线，不用黄色荧光笔。
- 引用是 well（凹槽渐变 + 1px 线 + 8px 圆角 + 内凹阴影）；代码也是 well + B612 Mono 15px，不开深色终端；图片放在 card 面（1px 线、10px 圆角、两段 chamfer、三层定向阴影），图片本体 6px 圆角；图注 17px；表格 plate；分隔线 1px；列表用 `·` 刻度、有序列表两位补零。
- 不用系统原有的两端刻点 Rule、knurl 齿纹带、顶部标签条、底部进度条或相机饰件；5% 颗粒和镜头 falloff 只铺页面，不铺每个承载块。

## KUNLUN 昆仑

来源：`KUNLUN Design System/README.md`（「VISUAL FOUNDATIONS」「Content fundamentals」「Iconography」「CAVEATS」）、`KUNLUN Design System/SKILL.md`，`tokens/snowline.css`、`tokens/colors.css`、`tokens/typography.css`、`tokens/effects.css`、`tokens/spacing.css`，`proposals/snowline/README.md`、`proposals/snowline/ROLLOUT-NOTES.md`，`components/surfaces/Panel.prompt.md`、`components/terminal/CodeBlock.prompt.md`、`components/terminal/Terminal.prompt.md`，`foundations/brand-hud-ornaments.html`、`foundations/type-hud-labels.html`、`foundations/spacing-chamfer.html`。

**适不适合。** 公众号：**改编**。默认 void 是深色，不能直接做；但上游已经有批准的 SNOWLINE 雪线浅色主题，公众号只做雪线。雪线的“全等宽”在中文长文里会牺牲可读性，公众号版只让标签、编号、数字和代码保持等宽，中文正文回落系统黑体；这是本批唯一一处对 KUNLUN 硬规则的主动偏离。卡片：**做**，void 和 snowline 都成立，切角、LCD、HUD 角标在静态图里比网页更有辨识度；深色卡片是主形态，浅色是第二形态。

| 部位 | 来源 | 借用 |
|---|---|---|
| 页面底色 / 纸色 | `tokens/snowline.css`、`tokens/colors.css` | 公众号雪线：page `#E2E9F2`（实验台）、panel `#F7FAFD`（仪表板）、elevated `#FFFFFF`、inset `#D9E2EE`。卡片 void：`#04060A / #06080D / #0D1320 / #131A2A`；卡片 snowline 同公众号。 |
| 文字墨色层级 | `tokens/snowline.css`、`tokens/colors.css` | 雪线 ink-900 `#0C1526`、ink-700 `#24334D`、ink-500 `#4A5C7A`、ink-300 `#8595AF`；深色用 neutral-100 / 300 / 400。正文不用 cyan 当正文色，cyan 只做信号。 |
| 强调色及限制 | `README.md`（Color）、`tokens/snowline.css` | cyan-500 `#00B8FF` 是填充/信号；浅色文字与链接降到 cyan-600 `#0098D4` / cyan-700 `#0075A8`；amber `#FFB000` 只警告，red `#FF3A3A` 只危险，green `#00E891` 只成功。**任何紫色都不出现。** 雪线的 glow 是背光，最多 12–24px，不能做大面积 bloom。 |
| 圆角 | `tokens/spacing.css`、`tokens/effects.css` | 没有常规圆角：用 6 / 8 / 12 / 18 / 24px 切角；只有头像和状态点是圆形。公众号若不能稳定使用 `clip-path`，用直角 + 1px 边 + L 形角标兜底（`PROPOSAL`）；卡片用真正的切角。 |
| 线条和分隔 | `tokens/snowline.css`、`README.md`（Borders & dividers） | 1px `#C7D3E3`，强线 `#9DAEC7`，信号线 `cyan-600`；提示和软分隔可用虚线；章节断开可以用 ASCII 框线（`├──── ▣ ────┤`）。不要双边框、不要彩色渐变边框。 |
| 标题与编号 | `tokens/typography.css`、`foundations/type-hud-labels.html`、`components/surfaces/Panel.prompt.md` | Orbitron 900 显示标题，HUD label 大写 + `.22em` 字距，正文 JetBrains Mono + Noto Sans SC；编号用 `[ 01 ]`、`NODE-07`、`// SECTOR-A` 这类操作员标签，数字补零。公众号 H2 = `[ 01 ]` 等宽 cyan kicker + 标题；卡片封面用 `KUNLUN · 昆仑` 字标 + 切角 K 标。 |
| 加粗与高亮 | `tokens/snowline.css`、`tokens/effects.css` | 加粗 700 ink；`==高亮==` 用 `rgba(0,152,212,.12)` 的 cyan tint + 1px cyan 边 + 小角标是 `PROPOSAL`；不要用黄色或紫色高亮，也不要把 glow 当高亮。 |
| 引用 | `components/surfaces/Panel.prompt.md`、`components/terminal/Terminal.prompt.md` | 引用是一个 chamfered panel：1px signal 边、可选 `// QUOTE` 头和 meta、无圆角；深色可带轻微背光，雪线只留 6–12px。公众号用 L 角标 + 1px 边，卡片用真切角。 |
| 代码 | `tokens/snowline.css`、`components/terminal/CodeBlock.prompt.md`、`proposals/snowline/README.md` | 雪线的代码是嵌在浅色台面上的 LCD：`#C9D6D8` 液晶底、`#1C3038` 段码墨、VT323、可见扫描线、内凹 bezel 和顶部反光；不要开深色岛。深色主题才用 `#02040A` 的终端底。 |
| 图片与图注 | `README.md`（Imagery）、`foundations/spacing-chamfer.html` | 图像降温、去饱和；外框用 1px line + 四角 tick，不用圆角卡片；图注 11–12px 等宽大写，`FIG. 01` / `//` 前缀。公众号图片保持直角或 2px 微圆角，卡片可裁切角。 |
| 标志性结构 | `README.md`（Corners、Backgrounds、Iconography）、`foundations/brand-hud-ornaments.html`、`foundations/spacing-chamfer.html` | 切角表面；40px 蓝图网格 + 扫描线/颗粒；LCD 终端；HUD 四角刻度、准星、坐标、ASCII 框；全大写等宽标签；步进式而不是弹簧式动效。只换 cyan 不算 KUNLUN。 |
| 系统不许出现 | `SKILL.md`、`README.md`（Color、Corners、Motion）、`proposals/snowline/README.md` | 禁紫（含紫色渐变/高光）；不用圆角卡片；不用 emoji；不用弹簧/回弹；不做大面积渐变背景；浅色主题不做夸张外发光；图像不做暖调；装饰性循环动画只允许状态灯。 |

**字体。** Orbitron（显示）、JetBrains Mono（正文/标签/代码）、VT323（LCD 读数）、Noto Sans SC（中文）。四者均为 SIL OFL 1.1（Orbitron 带 RFN “Orbitron”）；Reed 已有 Noto Sans SC 400/500/700，Orbitron 500/700/900、JetBrains Mono 400/700、VT323 400 已落盘。公众号回落：显示 `Orbitron → Arial Black / Impact → PingFang SC`；英文正文/标签 `JetBrains Mono → Menlo / Consolas`；中文 `PingFang SC / 微软雅黑`；LCD `VT323 → Courier New`。中文正文不套等宽栈。

**卡片模板方案。**

- 变体：`void`（默认深色）和 `snowline`（浅色）。主比例 3:4；1:1 和 9:16 可选。封面、终端日志、数据表、引文四类版式。
- 需新增字体：Orbitron 500/700/900、JetBrains Mono 400/700、VT323 400；中文用现有 Noto Sans SC。
- 尺寸：按 1242×1660 的卡片稿换算，`540 / 1242 ≈ 0.435`（`PROPOSAL`）。切角不要直接乘：12px → 5px、18px → 8px、24px → 10px，按视觉取整；1px 线保持 1px。字号另设：封面 36–48px、正文 17–18px、标签 11px、数据值 44–56px。
- 结构：封面用 `KUNLUN · 昆仑` 字标 + 切角 K 标 + 网格；正文页用 HUD 头（`// 01 · SECTOR`）和切角面板；终端页用 LCD + VT323 + 扫描线；数据页用等宽表格，状态只用 amber/red/green。每张最多一个 L 角标或一个准星，不要满屏装饰。
- 图像：卡片允许图片，但统一冷调、低饱和；不要暖色产品照。

**公众号主题方案。** id `kunlun-snowline`，中文名「雪线」，分类「商务」。只做雪线，不做 void。页面 `#E2E9F2`，正文 15px / 1.7 直接落在台面上，引用/代码/图组才用 `#F7FAFD` 面板；40px 蓝图网格用低透明度背景，`clip-path` 不稳定时改用直角 + L 角标 + 1px 边；H2 = `[ 01 ]` 等宽 cyan kicker + 19–22px 标题；代码用 LCD `#C9D6D8` + `#1C3038` + VT323 栈（回落 Courier New）；标签/数字/代码保持等宽，中文正文回落 PingFang / 微软雅黑；accent 只做信号，glow 最多 6–12px。禁紫、禁圆角卡片、禁弹簧。

**公众号主题落地。**

- 主题 `kunlun-snowline`（雪线）在 `src/lib/themes-design.ts`。根容器 `max-width:677px`，页面 `#E2E9F2` 上铺 40px 低透明蓝图网格；正文 15px / 1.7，中文正文不套等宽栈。
- 标题与编号：H1 是直角面板，用背景渐变画左上/右下 L 形青色角标，不写 `position` 或 `clip-path`；H2 用 `[ 01 ]` 等宽青色编号、大写字距 kicker 与 Orbitron 标题，章节上沿压 1px 强线。
- 加粗 700 ink；高亮用 `rgba(0,152,212,.12)` 青色底 + 1px cyan 下边；链接降到 cyan-700。引用是 1px 信号边 + L 角标的 `#F7FAFD` 面板，背光控制在 12px 以内。
- 代码是 LCD：`#C9D6D8` 液晶底、`#1C3038` 段码墨、VT323、可见扫描线、顶部反光和内凹 bezel，不开深色岛。图注用等宽 11px、`FIG. 01 //` 前缀（有图片地址时）；空图位仍保留「图N 说明」。
- 表格、图组、分隔线与署名都用 1px 发丝线/强线和等宽标签；accent 只做信号，amber/red/green 不进入正文装饰。没有紫色、圆角卡片、emoji、弹簧或大面积 bloom。
- 与设计系统的差异：上游全等宽在中文长文里牺牲可读性，公众号只让标签、编号、数字与代码保持等宽；切角用直角 + L 角标兜底；HUD 坐标、四角刻度、ASCII 框这些页面家具不进正文；深色 void 不做。

**卡片模板落地。**

- 变体 `void`（默认深色）/ `snowline`（浅色），3:4、1:1、9:16 都可用。卡片字体 Orbitron 500/700/900、JetBrains Mono 400/700、VT323 400、Noto Sans SC 400/700。
- 封面：切角面板、Orbitron 大标题与副标题；底部作者与 `[ 01 / 05 ]`。没有字标、HUD 四角刻度、坐标、ASCII 框或紫色。
- 正文：页眉只写文章标题和一条普通 1px 头线；页码只在页脚出现，不在页眉重复。每页一块切角内容面板。H2 用 Orbitron + `[ kicker ]` 等宽标签，H3 用等宽；加粗 700 墨色；高亮是 cyan 12% 底 + 1px cyan 下边。
- 引用是 1px signal 边切角面板；代码在 snowline 是 `#C9D6D8` LCD + `#1C3038` 段码墨 + VT323 扫描线，在 void 是 `#02040A` 终端底。图片 1px 线 + 2px 微圆角，图注 11px 等宽；表格 1px 线；分隔线 1px；页脚作者与 `[ 01 / 05 ]`。snowline 的强调色加深到 `#005F87`，让页码、H2 kicker 和链接在浅底上达到 4.5:1。
- 切角用真实 `clip-path`（卡片是浏览器截图）；不用圆角卡片、不用大面积 bloom，也不把 cyan 当正文色。

## Mayonaka 真夜中

来源：`Mayonaka Design System/README.md`（「Content fundamentals」「VISUAL FOUNDATIONS」「Iconography」）、`Mayonaka Design System/SKILL.md`（Core rules），`tokens/colors.css`、`tokens/typography.css`、`tokens/effects.css`、`tokens/spacing.css`、`tokens/fonts.css`，`guidelines/grid-floor.html`、`guidelines/logotype.html`、`guidelines/borders-radii.html`、`guidelines/type-display.html`。

**适不适合。** 公众号：**不做**。系统写死“Dark only. No light mode.”，深色底又是它的身份；把它改成浅色等于另造一套系统，违背“设计系统是唯一事实来源”。如果 Yoru 坚持要，只能做明确的“daylight VHS”改编：淡紫纸、深梅墨、低饱和洋红/青，保留 2px 像素边和硬阴影，去掉霓虹 glow；这是 `PROPOSAL`，且它不再是 Mayonaka，本批不建议。卡片：**做**，深色是原生形态；但中文像素字体有风险，建议只保证封面、短句、歌单/数据卡，长中文正文先不要承诺。

| 部位 | 来源 | 借用 |
|---|---|---|
| 页面底色 / 纸色 | `tokens/colors.css`、`tokens/effects.css` | void `#07000F`、midnight `#100225`、aubergine `#1C0838`、plum `#2D0A55`、orchid `#4A1A8A`；卡片底 `#0A1654`。默认 `--bg-base` 是 midnight；封面可用 `--grad-night` 或 `--grad-sunset`，正文页保持深夜底。 |
| 文字墨色层级 | `tokens/colors.css` | chrome `#F0EAFF`、silver `#C8BCE0`、dusk `#7A6BA0`、shadow `#03000A`；链接 azure `#4AA3FF`。正文用 silver，标题才用 chrome；dusk 只做弱信息。 |
| 强调色及限制 | `README.md`（Palette）、`tokens/effects.css` | 主 accent 洋红 `#FF2BD6`，次 accent 青 `#19E6FF`；sunset `#F97E72` / amber `#FFCC66` 只出现在 imagery 和 sunset gradient；electric/azure/neon-blue 是蓝色副脊。glow 只给 hero CTA、active、logo、now-playing；一张卡最多一处主 glow。不要通用紫蓝 AI 渐变。 |
| 圆角 | `tokens/spacing.css`、`README.md`（Borders + radii） | 默认 0；输入框偶尔 2px；pill 只给明确想“不像素”的 badge。边框默认 2px，强调 3px 霓虹；1px 只做分隔线。 |
| 线条和分隔 | `tokens/colors.css`、`README.md`（Borders + radii） | 边框色用低透明蓝/洋红/青：`rgba(74,163,255,.28)`、`rgba(255,43,214,.6)`、`rgba(25,230,255,.55)`；2px 是像素默认，3px 是霓虹强调，1px 只做 hairline。不要细软阴影线。 |
| 标题与编号 | `tokens/typography.css`、`guidelines/type-display.html` | Press Start 2P 显示，10–48px、ALL CAPS、宽字距；VT323 正文/UI；DotGothic16 日文；`font-smoothing: none`、`image-rendering: pixelated`。上游没有章节号，卡片用 `// 01` 像素标签是 `PROPOSAL`；不要用细衬线编号。 |
| 加粗与高亮 | `tokens/effects.css`、`README.md`（Lighting） | 加粗用 chrome；`==高亮==` 用 cyan 2px 下划线或洋红 3px 偏移硬阴影是 `PROPOSAL`；不要用柔和半透明荧光带，那会破坏像素感。 |
| 引用 | `tokens/colors.css`、`tokens/effects.css` | 引用是 `--bg-card` 深蓝面板，2px border + `4px 4px 0 #03000A` 硬像素阴影，无模糊；前缀 `> prompt_` 或 `//`；不要左圆角、不要 backdrop blur。系统没有引用组件，组合成引用块是 `PROPOSAL`。 |
| 代码 | `tokens/colors.css`、`tokens/effects.css` | `#03000A` 深底、2px 边、VT323，扫描线可叠；代码里的标签可用 cyan/magenta，正文保持 chrome/silver；不要语法高亮的糖果色。系统没有代码组件，这个组合是 `PROPOSAL`。 |
| 图片与图注 | `README.md`（Imagery、Imagery color treatment） | 图片方形、2px 边框、不圆角；统一加暖洋红滤镜（`screen` + 15% magenta）或洋红/青 duotone；图注 VT323、大写、宽字距。不要干净 stock，不要圆裁。 |
| 标志性结构 | `guidelines/grid-floor.html`、`guidelines/logotype.html`、`README.md`（Backgrounds、Layout） | 透视网格地板 + 条纹太阳；扫描线；硬像素阴影；霓虹 glow；8-bit 字体；洋红标题栏窗口；静态 glitch。封面没有网格/太阳就不算 Mayonaka。 |
| 系统不许出现 | `SKILL.md`（Core rules）、`README.md`（Backgrounds、Shadows、Transparency、Motion） | 不做浅色模式；像素字体不能开抗锯齿；不做圆角卡片；不做 backdrop blur；不用 emoji；不用通用紫蓝 AI 渐变；同一元素不混用像素阴影和 glow（带 glow 的按钮除外）；opacity 只用于 disabled；不要弹簧/回弹。 |

**字体。** Press Start 2P（显示）、VT323（正文/终端）、DotGothic16（日文/部分汉字）、Major Mono Display（字标）。四者均为 SIL OFL 1.1（Press Start 2P 带 RFN）；都可自托管。Mayonaka 没有中文正文专用字；中文用 DotGothic16 会有日文字形，用 Noto Sans SC 又会失去像素感。卡片长中文建议先用 Noto Sans SC 保可读，封面/短句再用 DotGothic16（`PROPOSAL`）。本批不做公众号，因此不设公众号字体；若未来做 daylight VHS，像素拉丁回落 Courier New / monospace，中文回落 PingFang SC / 微软雅黑。

**卡片模板方案。**

- 变体：`midnight`（默认，深夜底 + 扫描线）和 `sunset`（封面专用，`--grad-sunset` + 条纹太阳 + 网格地板）。主比例 3:4；9:16 可选，1:1 不建议。没有浅色变体。
- 需新增字体：Press Start 2P 400、VT323 400、DotGothic16 400、Major Mono Display 400。
- 尺寸：按 1242×1660 的卡片稿换算，`540 / 1242 ≈ 0.435`（`PROPOSAL`）。像素字体读起来偏小，封面 32–56px，正文 18–20px，标签 12–14px；不要按 112px 的 hero 直接缩。
- 结构：封面用网格地板 + 太阳 + 洋红/青标题；正文用 2px 边框、硬像素阴影、扫描线，每页最多一处 glow；尾页可以用 `// END OF TRANSMISSION` 或 `[OK]`。长中文正文用 Noto Sans SC 会破坏像素感，这是待拍板项。
- 图像：允许 citypop 暖调照片，统一加洋红滤镜；不要干净 stock 和圆裁。

**公众号主题方案。** 本批 **不做**。若未来强行做，预留 id `mayonaka-neon`、中文名「真夜中」、分类「活力」，但需要一套 `daylight VHS` 浅色改编（淡紫纸 `#F3EEFF`、深梅墨 `#1C0838`、洋红 `#C4009B`、青 `#007A8A`、2px 像素边和硬阴影，去掉 glow 和扫描线）。这只是 `PROPOSAL`，且会失去“深夜”的身份，不建议进主题库。

**卡片模板落地。**

- 变体 `midnight`（默认深夜 + 扫描线）/ `sunset`（封面专用：`--grad-sunset` + 条纹太阳 + 网格地板）；没有浅色。3:4 为主，9:16 可用。卡片字体 VT323 400、Noto Sans SC 400/700；Press Start 2P、DotGothic16、Major Mono Display 不再用于卡片。
- 封面：`midnight` 是深夜底 + 扫描线 + 网格地板；`sunset` 追加条纹太阳与洋红渐变，并在下半部压一层从透明到 `rgba(7, 0, 15, .94)` 的暗色渐变，让中文大标题、副题和页脚在洋红/粉色上仍高于对比度门槛。中文大标题用 Noto Sans SC 并加静态洋红/青双向偏移；底部作者与页码。一张卡最多一处主 glow。
- 正文：每页一块 `#0A1654` 深蓝面板，2px 边框 + `4px 4px 0` 硬像素阴影，直角；H2 Noto Sans SC 700 + VT323 `//` kicker + 2px 青线；长中文正文一律 Noto Sans SC 17px / 1.7，不引入日文字体回退。次级文字提到 `#9A8BC0`，页脚和图注在深蓝面板上达到 4.5:1。
- 加粗 chrome；高亮是 2px 青下划线，不用柔和荧光带；引用是 2px 洋红边 + 硬阴影；代码 `#03000A` + VT323 + 扫描线；图片方形、2px 边框、洋红暖调；图注 VT323；表格 2px 边框；分隔线 1px；页脚作者与页码。
- 不做浅色模式、圆角卡片、backdrop blur 或 emoji；同一元素不同时用像素阴影和 glow。

## RIFT 裂隙

来源：`RIFT Design System/README.md`（「Content fundamentals」「Visual foundations」「Ambient FX」「Iconography」）、`RIFT Design System/SKILL.md`，`tokens/theme-light.css`、`tokens/theme-dark.css`、`tokens/palette.css`、`tokens/typography.css`、`tokens/spacing.css`，`base.css`、`components.css`、`effects.css`，`templates/marketing/Marketing.dc.html`、`templates/console/Console.dc.html`、`cards/surfaces-light.html`、`cards/type-display.html`。

**适不适合。** 公众号：**改编**。`daybreak / 黎明` 是完整的浅色 token override，页面、墨色、玻璃都有对应值；公众号只做黎明。RIFT 的玻璃与 glitch 在公众号里只能静态化：玻璃用半透明填充 + 顶部内高光，不依赖模糊；chromatic edge 用固定偏移的双色文字阴影，不做 7s 循环。卡片：**做**，深色是主形态，黎明是第二形态；静态 glitch、L 角标、扫描线和网格在图片里都能成立。

| 部位 | 来源 | 借用 |
|---|---|---|
| 页面底色 / 纸色 | `tokens/theme-light.css`、`tokens/theme-dark.css`、`base.css` | 黎明：page `#EAF1FC`、surface `#F4F8FF`、elevated `#FAFCFF`、sunken `#DCE7F8`，画布是白 → 冰蓝的径向渐变，叠 72px 网格（`rgba(34,64,128,.07)`）。深色：`#070C1B / #0E1830 / #15233F / #050A18`。公众号只做黎明。 |
| 文字墨色层级 | `tokens/theme-light.css`、`tokens/theme-dark.css` | 黎明 ink-1 `#0A1430`、ink-2 `#3E4F76`、ink-3 `#6B7896`、ink-4 `#A6B6D4`；深色 `#EDF2FF / #A7B4D2 / #6B7896 / #3E4866`。正文 ink-2，标题 ink-1，mono 标签 ink-3。 |
| 强调色及限制 | `tokens/palette.css`、`tokens/theme-light.css`、`README.md`（Colors） | 黎明 royal `#3F5BE6`、深色 `#5C7BFF`；cobalt `#2E6FD6`、ice `#8FD2F5`、aqua `#8AD8D0`；状态 green/amber/red 只做 ok/warn/bad。chromatic edge 的配对只用 sky × royal 或 aqua × royal，不引入系统外青/洋红。 |
| 圆角 | `tokens/spacing.css` | 6 / 10 / 14 / 18 / 24 / 32 / pill；卡片 18、按钮 14、输入 10。卡片要圆但不要“首尾都是极端”：不用 0，也不用 999（badge 除外）。 |
| 线条和分隔 | `tokens/theme-light.css`、`tokens/theme-dark.css`、`README.md`（Borders） | 三档 1px 线：line-1（黎明 8% / 深色 7%，表格分隔）、line-2（15% / 13%，卡片默认）、line-strong（30% / 24%，hover/focus）。每块玻璃再加 `inset 0 1px 0` 顶部高光；不要双边框、不要内描边套内描边。 |
| 标题与编号 | `tokens/typography.css`、`templates/console/Console.dc.html`、`cards/type-display.html` | Space Grotesk 标题，Chakra Petch 只做 RIFT 字标，DM Serif Display 只做斜体短句，Rajdhani 正文/UI，Share Tech Mono 日志/时间戳/标签，Shippori Mincho 日文显示，Zen Kaku Gothic New 日文 UI。编号用 mono `01 / signal`、`// CONSOLE / NODE-04`，大写标签 `.12–.16em` 字距。 |
| 加粗与高亮 | `tokens/theme-light.css`、`components.css` | 加粗 600 ink；`==高亮==` 用 royal 18% 的玻璃带 + 1px royal 下划线是 `PROPOSAL`；不要用大面积荧光底，RIFT 的高亮应该像“信号被圈出”。 |
| 引用 | `components.css`、`effects.css`、`templates/auth/Auth.dc.html` | 引用用 glass-2 面板：18px 圆角、1px `--glass-border`、顶部内高光，可叠 `.rift-frame` L 角标和 `.rift-scan` 扫描线。系统没有引用组件，组合成引用块是 `PROPOSAL`；公众号去掉模糊，用半透明填充 + 顶部高光；卡片才用真玻璃。 |
| 代码 | `tokens/theme-light.css`、`base.css`、`README.md`（Transparency & blur） | 代码用 sunken `#DCE7F8`（黎明）/ `#050A18`（深色），1px line、10px 圆角、顶部内高光；Share Tech Mono、无语法高亮。系统没有代码组件，这个组合是 `PROPOSAL`；不要给代码加模糊；文字永远在玻璃上面，不在模糊层后面。 |
| 图片与图注 | `README.md`（Color vibe of imagery）、`components.css` | 图片 18px 圆角、1px glass 边、顶部内高光；整体冷调、中饱和，不加暖色；图注 11px mono、大写、`FIG. 01 //` 前缀，ink-3。暖调照片不适合 RIFT。 |
| 标志性结构 | `README.md`（the chromatic edge、Glass、Ambient FX）、`effects.css`、`templates/marketing/Marketing.dc.html` | 不是“蓝色玻璃”：是 sky × royal 的 chromatic edge；每块玻璃的 1px 顶部内高光；72px 网格；L 形 `rift-frame`；1px、3px 节距的扫描线；角落淡 `裂隙` 字；状态点。每屏最多一个 L 框、一处扫描线、一个水印。 |
| 系统不许出现 | `README.md`（Iconography、Borders、Transparency、Animation）、`SKILL.md` | 不用 emoji、不用图标字体；图像不要暖调；文字不放在模糊层后面；disabled 不用 `opacity:.5`，用 ink-3/4；不要双边框或双层内描边；不要系统外青/洋红；不要弹簧/回弹；glitch 不要满屏循环。 |

**字体。** Space Grotesk、Chakra Petch、DM Serif Display、Rajdhani、Share Tech Mono、Shippori Mincho、Zen Kaku Gothic New，全部 SIL OFL 1.1（DM Serif 带 RFN “Source”，Share Tech Mono 带 RFN “Share”）。Reed 已有 Noto Sans SC 可做中文正文，前五个拉丁族已落盘；两个日文族按需加。公众号回落：标题 `Space Grotesk → 系统无衬线`；正文/UI `Rajdhani → PingFang SC / 微软雅黑`；标签/日志 `Share Tech Mono → Menlo / Consolas`；斜体 `DM Serif Display → Georgia italic`；中文 `PingFang SC / 微软雅黑`。

**卡片模板方案。**

- 变体：`dark`（默认，深色玻璃 + 强 glitch）和 `light`（黎明，白/冰蓝玻璃 + 弱 glitch）。比例 3:4、1:1、9:16。
- 需新增字体：Space Grotesk 300–700、Chakra Petch 500–700、DM Serif Display 400 italic、Rajdhani 400–700、Share Tech Mono 400；Shippori Mincho / Zen Kaku Gothic New 按日文内容加。
- 尺寸：按 1242×1660 的卡片稿换算，`540 / 1242 ≈ 0.435`（`PROPOSAL`，上游没有卡片画布）。18px 圆角 → 8px，32px → 14px；1px 线保持 1px。字号另设：封面 48–72px、正文 18px、标签 11px。
- 结构：封面用 `THE RIFT` / `RIFT` 字标 + 静态双色偏移 + 一行 DM Serif 斜体；正文页用 L 角标框住一块玻璃，不要整页四边都框；日志页用 Share Tech Mono + 状态点；每张最多一处扫描线、一个 `裂隙` 水印。glitch 只用静态偏移，不跑动画。
- 图像：统一冷调、中饱和；暖调照片要么不用，要么先做冷调处理。不要给文字加 blur。

**公众号主题方案。** id `rift-daybreak`，中文名「黎明」，分类「商务」。只做黎明，不做深色。页面 `#EAF1FC`，叠 72px 低透明网格 + 顶部极淡径向光；正文 15.5px / 1.7，H1 30px、H2 22px；标题用静态 chromatic edge（用 sky `#6BB6F0` / royal `#3F5BE6` 做两向偏移文字阴影，透明度压到 40–50%），不做动画；引用/代码/图组用 `rgba(255,255,255,.55)` + 1px `--glass-border` + 顶部内高光模拟玻璃，不用 `backdrop-filter`；代码用 `#DCE7F8` 承载块；标签用 Share Tech Mono 栈回落 Menlo/Consolas；`裂隙` 水印在公众号里省略，避免无信息装饰。禁紫、禁暖图、禁双边框。

**公众号主题落地。**

- 主题 `rift-daybreak`（黎明）在 `src/lib/themes-design.ts`。根容器 677px，`#EAF1FC` + 72px 网格 + 顶部白到冰蓝的径向光；正文 15.5px / 1.7。
- 标题：H1/H2 用 Space Grotesk 600，`text-shadow` 以 sky/royal 固定 ±1px 偏移、约 45% 透明度做静态 chromatic edge，不跑 7s 动画；H1 是 18px 圆角玻璃面板，H2 用 `01 /` 等宽 kicker + 1px 线。
- 加粗 600 ink-1；高亮是 royal 14% 玻璃带 + 1px royal 下划线；链接 royal。引用用 `rgba(255,255,255,.55)` + 1px glass 边 + `inset 0 1px 0` 顶部高光，再加四个 L 形角标（背景渐变，无 `position`）；图片/图组用 18px 圆角 + 1px glass 边 + 蓝调轻阴影。
- 代码与行内代码用 `#DCE7F8` sunken 承载块、1px line、10 / 6px 圆角与顶部内高光；代码块叠 3px 节距扫描线，Share Tech Mono 13px。图片 18px 圆角、1px glass 边、蓝调轻阴影；图注 11px mono、`FIG. 01 //`。
- 表格放在玻璃托盘里；分隔线 1px line-2；署名用 mono 标签。`裂隙` 水印、cursor 跟随与大屏扫描线都不进正文；禁紫、禁暖图、禁双边框，也不引入系统外青/洋红。
- 与设计系统的差异：公众号没有 `backdrop-filter`，玻璃是半透明填充 + 顶部内高光；glitch 只留静态双色偏移；深色主题不做，真玻璃与完整 glitch 留给小红书卡片。

**卡片模板落地。**

- 变体 `dark`（默认）/ `light`（黎明），3:4、1:1、9:16 都可用。卡片字体 Space Grotesk 300–700、DM Serif Display 400 italic、Rajdhani 400–700、Share Tech Mono 400、Noto Sans SC 400/700。
- 封面：静态 sky × royal 双色偏移标题、DM Serif 斜体副题；底部作者与页码。没有字标、循环 glitch，也没有满屏扫描线。
- 正文：每页一块玻璃内容面板，左上只有一个 L 形角标；H2 用 Space Grotesk 600 + 静态 chromatic edge + Share Tech Mono kicker；加粗 600；高亮是 royal 14% 带 + 1px royal 下划线。页眉只有文章标题，页码只在页脚。
- 引用是玻璃面板；代码用 sunken 底 + 1px 线 + 10px 圆角 + 顶部内高光 + 3px 节距扫描线；图片 8px 圆角、1px glass 边、顶部内高光，图注 11px 等宽；表格在玻璃里；分隔线 1px；页脚作者与页码。dark 的次级文字提到 `#8FA0C0`；light 的次级文字 `#4E5C80`、强调色 `#2C46C8`，页眉、页脚、图注和页码在黎明底色上达到 4.5:1。
- 玻璃是半透明填充 + 内高光，不用 `backdrop-filter`；禁紫、禁暖图、禁双边框。

## core

来源：`core Design System/README.md`（「How the aesthetics combine」「Content fundamentals」「Visual foundations」「Borders & shadows」「Layout」「Caveats」）、`core Design System/SKILL.md`，`tokens/colors.css`、`tokens/typography.css`、`tokens/effects.css`、`tokens/spacing.css`、`tokens/nightpool.css`、`tokens/fonts.css`，`components/window/Window.jsx`、`components/window/Window.prompt.md`，`cards/effects-bevel.html`、`cards/effects-shadow.html`、`cards/type-display.html`、`cards/brand-textures.html`，`ui_kits/blog/README.md`、`ui_kits/archive/README.md`、`slides/README.md`。

**适不适合。** 公众号：**改编**。默认 frost 是浅色，蓝白纸 + 1px 墨线 + 硬偏移阴影都能做；但系统里的窗口可以绝对定位、重叠、散落，公众号是流式文档，只能改成纵向叠窗。core 的“每个面都是 Window”很适合做公众号的章节容器，但不能把假关闭键、斜纹条和悬浮窗全部搬进正文。卡片：**做**，frost 和 nightpool 都成立；卡片是完整复刻 Y2K 桌面语法的最佳载体。

| 部位 | 来源 | 借用 |
|---|---|---|
| 页面底色 / 纸色 | `tokens/colors.css`、`tokens/nightpool.css` | frost：paper `#EAF4F8`、stained `#D8E7EF`、grout `#BCD3DF`、fold `#95B3C4`；卡片面 `frost-50 #F5FAFD`、窗口面 `bondi-50 #E0F4FB`。nightpool：page `#071820`、card `#0A2230`、window `#0E2C3D`、sunk `#041018`。**不用纯 `#FFFFFF` / `#000000`**。 |
| 文字墨色层级 | `tokens/colors.css`、`tokens/nightpool.css` | 白天 ink `#0C1A26`、soft `#1A2F42`、muted `#4A5E72`、faint `#7A8C9E`；夜间 phosphor-200 `#C4E2EE`、300 `#9ABECC`、400 `#6E93A4`、500 `#4A6B7C`；线/阴影墨在夜间单独用 abyss-950 `#02090E`，和文字墨分开。 |
| 强调色及限制 | `tokens/colors.css`、`README.md`（Color） | bondi-500 `#009DE0` 是标题栏/主 CTA/hero；bubblegum-500 `#FF7EB6` 是热 accent（stamp、ironic CTA、marquee）；sodium `#DCB13F` 只做“错误的暖”，dream peach/rose 只做小面积 halo；neon 五色只进 marquee 和 visited link，不进主表面。 |
| 圆角 | `tokens/spacing.css`、`README.md`（Borders & shadows） | 窗口/卡片 0；按钮 2px；pebble 10px；pill 999。不要给窗口或卡片加圆角；按钮的 2px 是唯一“软”角。 |
| 线条和分隔 | `tokens/colors.css`、`tokens/effects.css` | 1px solid `--ink #0C1A26`；bevel 用 1px 高光 + 1px 低光；卡片阴影 `2px 2px 0 ink`，窗口 `3px 3px 0 ink, 6px 6px 0 rgba(26,20,12,.25)`；全部无模糊。分隔用虚线或 1px 墨线，不用灰色 hairline。 |
| 标题与编号 | `tokens/typography.css`、`cards/type-display.html`、`components/window/Window.jsx` | 三个声音：Pixelify Sans 显示（144/88/56px，lowercase）、Tinos 正文（15px / 1.55）、system sans 做 UI chrome（11–13px，Tahoma / MS Sans Serif）。标题用 lowercase；编号用像素 mono `[ 01 ]` 是 `PROPOSAL`；窗口标题栏里放标题文本，不再加额外章节号。 |
| 加粗与高亮 | `tokens/colors.css`、`tokens/effects.css` | 加粗 700 ink；`==高亮==` 用 bubblegum 40–50% 的下半行高亮或 peach halo 是 `PROPOSAL`；不要用现代细荧光笔，也不要给全段加底色。 |
| 引用 | `tokens/effects.css`、`slides/README.md`（QuoteSlide） | 引用是 bevel-in 的 sunken panel：`--surface-sunk #DDE4EC`、1px ink、Tinos 斜体、可加 peach halo；或者用 peach-100 的 `dream` 面板。不要圆角、不要左侧灰条。 |
| 代码 | `tokens/effects.css`、`tokens/colors.css` | 代码是 sunken window：`surface-sunk #DDE4EC` / `#D8E7EF`、1px ink、bevel-in、VT323 14px；不要深色终端，也不要圆角代码卡。系统没有代码组件，这个组合是 `PROPOSAL`。 |
| 图片与图注 | `README.md`（Imagery）、`cards/effects-shadow.html` | 图片 1px ink 框、直角、2px 偏移硬阴影；卡片可用 `--filter-overexposed` / `--filter-jpeg` / `--filter-vhs`，公众号不能用滤镜处理用户图；图注 11px 像素 mono、lowercase，像档案脚注。 |
| 标志性结构 | `components/window/Window.prompt.md`、`components/window/Window.jsx`、`ui_kits/archive/README.md` | 每个面都是 Window：1px 墨边、标题栏、斜纹、可选关闭/最小化键、底部 status；bevel 立体按钮；硬偏移阴影；32px tile 纹理；lowercase 档案语气；三套字体不统一。卡片可以把窗口叠起来；公众号只能纵向叠窗。 |
| 系统不许出现 | `README.md`（Don't、Color、Borders、Transparency、Motion）、`SKILL.md` | 不用纯白/纯黑；不用圆角卡片；不用 emoji；不用营销话术；感叹号只允许 marquee/popup；不用 backdrop blur；不用 200ms 平滑变色；不要“现代极简”；不要暖奶油纸底；图片不要圆裁、不要除 hero 外的满幅。 |

**字体。** Pixelify Sans（显示）、VT323（像素 mono/代码）、Tinos（拉丁正文）、system UI sans（Tahoma / MS Sans Serif）。Pixelify Sans、VT323、Tinos 均为 SIL OFL 1.1（Tinos 当前 OFL，旧 Croscore 版本是 Apache 2.0，两者都允许自托管）；MS Sans Serif 是 Microsoft 的专有字体，**不能打包或自托管**，只能 `local()` 命中，回落 Tahoma / Segoe UI。中文正文用 Noto Serif SC（需补 400；现有 700 太重），中文 UI chrome 用 Noto Sans SC。公众号回落：显示 `Pixelify Sans → Courier New → PingFang SC`；正文 `Tinos → Times New Roman → Songti SC / STSong`；UI chrome `Tahoma / Segoe UI`；代码 `VT323 → Courier New`。

**卡片模板方案。**

- 变体：`frost`（默认浅色）和 `nightpool`（深色）。比例 3:4、1:1、9:16；封面、正文、引用/尾页都可套 Window。
- 需新增字体：Pixelify Sans 400–700、VT323 400、Tinos 400/700、Noto Serif SC 400（中文正文）；中文 UI chrome 用现有 Noto Sans SC。
- 尺寸：按 1242×1660 的卡片稿换算，`540 / 1242 ≈ 0.435`（`PROPOSAL`）。32px tile → 14px；1px 线保持 1px；字号另设：封面 56–72px、正文 18px / 1.6、图注 11px。
- 结构：封面是一扇 Window，标题栏用 bondi `#009DE0` + frost-50 字（不用 token 里的 `#FFFFFF`，遵从“禁纯白”硬规则，`PROPOSAL`），可带斜纹和假关闭键；正文每页一个 Window，标题栏只写小写标题，不重复作者；引用/代码用 sunken bodyTone；状态栏只有一处，放页码或档案号。窗口可以轻微错位叠放，但不要超出画布。
- 图像：1px ink 框、直角、2px 偏移阴影；照片统一过曝/JPEG/VHS 滤镜；不要圆裁。

**公众号主题方案。** id `core-frost`，中文名「霜纸」，分类「活力」。只做 frost，不做 nightpool。页面 `#EAF4F8`，正文 16px / 1.6，Tinos 栈回落 Songti SC / STSong；H1/H2 用 Pixelify Sans 栈（公众号回落 Courier New → PingFang SC），英文标签 lowercase；H1 加一条 bondi `#009DE0` 的标题栏带 + 1px ink 边 + 2px 偏移阴影，**不做假关闭键、不做斜纹、不做绝对定位**（`PROPOSAL`）；每个承载块 1px `#0C1A26` 边、直角、2px 偏移阴影；引用/代码用 sunken bevel；图片 1px ink 框；不用纯白/纯黑。微信深色模式会把 frost 纸压暗，1px 墨边和硬阴影保留，避免所有块糊在一起。

**公众号主题落地。**

- 主题 `core-frost`（霜纸）在 `src/lib/themes-design.ts`。根容器 677px，`#EAF4F8` + 32px 低透明瓷砖网格；正文 16px / 1.6，用 Songti SC / STSong / SimSun 的系统衬线栈，不加载 Tinos。现有 Noto Serif SC 只有 700，放进正文栈会让预览偏重，所以正文栈不依赖它。
- 标题与编号：H1 是一扇 Window——bondi `#009DE0` 标题栏 + 1px ink 边 + 3px/6px 硬偏移阴影，标题用 Pixelify 栈 lowercase；H2 同样是 Window，标题栏里用小号像素 mono 放 `[ 01 ]` 与 kicker 状态行，标题本身也在标题栏里 lowercase，不再另起正文标题。没有假关闭键、没有斜纹、没有绝对定位。
- 加粗 700 ink；高亮用 bubblegum 45% 下半行带；引用与代码用 `#DDE4EC` sunken bevel-in（1px ink 边 + 1px 高/低光），引用用衬线斜体，代码用 VT323。图片是 1px ink 直角框 + 2px 偏移硬阴影，图注 VT323 `// 图N`。
- 表格用 bondi 表头 + 1px ink 网格 + 2px 硬阴影；分隔线 1px dashed ink；署名是 sunken 状态栏；列表用方点 / 十进制。页面不铺纯白、纯黑，也不做暖奶油纸。
- 与设计系统的差异：上游窗口可以绝对定位、叠放、散落，公众号只能改成纵向叠窗；标题栏不放假关闭键与斜纹，编号放进标题栏而不是另起一行；图片不做 overexposed / JPEG / VHS 滤镜（不能处理用户图）；nightpool 深色不做。

**卡片模板落地。**

- 变体 `frost`（默认浅色）/ `nightpool`（深色），3:4、1:1、9:16 都可用。卡片字体 Pixelify Sans 400–700、VT323 400、Tinos 400/700 + italic、Noto Serif SC 400/700、Noto Sans SC 400/700。
- 封面是一扇 Window：深 bondi 标题栏（留空，不放 `cover` 占位词）、1px ink 边框、3px/6px 硬偏移阴影、Pixelify / Noto Serif SC 标题、Tinos 斜体副题、底部状态栏。没有假关闭键、没有斜纹、没有圆角。
- 正文每页也是一扇 Window：标题栏只写小写文章标题，不再放页码；状态栏放作者与页码。H2 用 Pixelify / Noto Serif SC + VT323 `[ kicker ]`；加粗 700；高亮是 bubblegum 45% 下半行带。标题栏用 `#0072A3`（nightpool `#006B9C`）配白字，正文链接 `#006A94`，状态栏与图注同样按 4.5:1 校验。
- 引用与代码是 sunken bevel-in 面板；代码 VT323；图片 1px ink 直角框 + 2px 偏移硬阴影，图注 VT323；表格深 bondi 表头 + 1px ink 网格；分隔线 1px 虚线；没有纯白/纯黑，也不给用户图套滤镜。

## 字体与授权

第一批与第二批的字体已随两条工作线落盘：`public/fonts/fonts-templates.css`、`fonts-design.css` 与 `OFL-*.txt` 覆盖下表除标「按需」外的全部族，分页预载与 PNG 内嵌共用 `CARD_TEMPLATE_FONTS`。下表的“Reed 现状”写合并后的实际状态。

OFL 1.1 允许自托管、转换 WOFF2 并随软件再分发；需要随字体附上版权声明和完整 OFL 文本，不能单独售卖字体，修改版不能使用保留字体名（RFN）。Bebas Neue 只使用 Dharma Type 的 OFL 发行版，不把付费/扩展 cut 打进 Reed。**除 MS Sans Serif 外，下表所有字体都能自托管并进 Reed；“Reed 现状”说明它是否已落盘。**

| 字体 | 用在哪 | 授权 | Reed 现状 | 公众号回落 |
|---|---|---|---|---|
| [Noto Sans SC](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt) / [Source Han Sans SC](https://raw.githubusercontent.com/adobe-fonts/source-han-sans/master/LICENSE.txt) | Aozora 中文代用、KIHON 中文、KUNLUN / RIFT 中文、core chrome | SIL OFL 1.1（RFN “Source”） | Noto Sans SC 400/500/700 已有；不重复打包 Source Han | PingFang SC / 微软雅黑 |
| [Noto Serif SC](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt) | core 中文正文 | SIL OFL 1.1 | 400/700 已落盘 | Songti SC / STSong / serif |
| [Inter](https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt) | Aozora 拉丁正文 | SIL OFL 1.1 | 已落盘 | Helvetica / Arial |
| [Bebas Neue](https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/OFL.txt) | Aozora 海报标题 | SIL OFL 1.1 | 已落盘 | Impact / Arial Narrow |
| [Fraunces](https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/OFL.txt) | Aozora 可选衬线 | SIL OFL 1.1 | 按需 | Georgia / Times |
| [Space Grotesk](https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt) | Aozora 字标、RIFT 标题 | SIL OFL 1.1 | 已落盘 | 系统无衬线 |
| [JetBrains Mono](https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt) | Aozora / KUNLUN 代码与数字 | SIL OFL 1.1 | 已落盘 | Menlo / Consolas |
| [Noto Sans JP](https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt) / [Noto Serif JP](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/OFL.txt) | Aozora 日文 | SIL OFL 1.1（Noto Sans JP 带 RFN “Source”） | 按需 | Hiragino Sans / Yu Gothic / serif |
| [Instrument Sans](https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentsans/OFL.txt) | KIHON 拉丁/标签 | SIL OFL 1.1 | 已落盘 | Helvetica / Arial |
| [B612 Mono](https://raw.githubusercontent.com/google/fonts/main/ofl/b612mono/OFL.txt) | KIHON 数字/编号 | SIL OFL 1.1 | 已落盘 | Menlo / Consolas |
| [Orbitron](https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/OFL.txt) | KUNLUN 显示 | SIL OFL 1.1（RFN “Orbitron”） | 已落盘 | Arial Black / Impact |
| [VT323](https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/OFL.txt) | KUNLUN LCD、Mayonaka、core 代码 | SIL OFL 1.1 | 已落盘 | Courier New / monospace |
| [Press Start 2P](https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/OFL.txt) | Mayonaka 显示 | SIL OFL 1.1（RFN） | 已落盘 | Courier New / monospace |
| [DotGothic16](https://raw.githubusercontent.com/google/fonts/main/ofl/dotgothic16/OFL.txt) | Mayonaka 日文/短句 | SIL OFL 1.1 | 已落盘 | PingFang SC / Noto Sans SC |
| [Major Mono Display](https://raw.githubusercontent.com/google/fonts/main/ofl/majormonodisplay/OFL.txt) | Mayonaka 字标 | SIL OFL 1.1 | 已落盘（未用于卡片） | Courier New |
| [Chakra Petch](https://raw.githubusercontent.com/google/fonts/main/ofl/chakrapetch/OFL.txt) | RIFT 字标 | SIL OFL 1.1 | 已落盘 | 系统无衬线 |
| [DM Serif Display](https://raw.githubusercontent.com/google/fonts/main/ofl/dmserifdisplay/OFL.txt) | RIFT 斜体短句 | SIL OFL 1.1（RFN “Source”） | 已落盘 | Georgia italic |
| [Rajdhani](https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/OFL.txt) | RIFT 正文/UI | SIL OFL 1.1 | 已落盘 | PingFang SC / Helvetica |
| [Share Tech Mono](https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/OFL.txt) | RIFT 标签/日志 | SIL OFL 1.1（RFN “Share”） | 已落盘 | Menlo / Consolas |
| [Shippori Mincho](https://raw.githubusercontent.com/google/fonts/main/ofl/shipporimincho/OFL.txt) | RIFT 日文显示 | SIL OFL 1.1 | 按需 | Songti SC / Yu Mincho |
| [Zen Kaku Gothic New](https://raw.githubusercontent.com/google/fonts/main/ofl/zenkakugothicnew/OFL.txt) | RIFT 日文 UI | SIL OFL 1.1 | 按需 | Hiragino Sans / Yu Gothic |
| [Pixelify Sans](https://raw.githubusercontent.com/google/fonts/main/ofl/pixelifysans/OFL.txt) | core 显示 | SIL OFL 1.1 | 已落盘 | Courier New / 系统无衬线 |
| [Tinos](https://raw.githubusercontent.com/googlefonts/tinos/main/OFL.txt) | core 拉丁正文 | SIL OFL 1.1（旧版 Apache 2.0） | 已落盘 | Times New Roman / Songti SC |
| [MS Sans Serif](https://learn.microsoft.com/en-us/typography/fonts/font-faq) | core UI chrome | Microsoft 专有 | **不能打包**；只能 `local()`，回落 Tahoma / Segoe UI | Tahoma / Segoe UI |

字体落地时还要做三件事：

- **卡片导出前验证实际字体。** 用 Chrome 报告的实际渲染字体检查，看到对应族名才算数；中文字形不能被日文字体悄悄替换而不自知。
- **公众号不加载网页字体。** 主题只在标题、标签和代码写字体栈；正文完全交给读者手机。所有“字体辨识度”都要有颜色、线条、间距或结构兜底，不能只靠字体。
- **许可证副本随字体落盘。** `public/fonts/OFL-*.txt` 已覆盖下表已落盘的字体；新增字体时要同时落 WOFF2 和 OFL 文本，发布前核对字体元数据与许可副本。

## 总表

| 系统 | 公众号 | 卡片 | 一句理由 |
|---|---|---|---|
| Aozora 青空 | 改编 | 做 | 浅色玻璃海报可做，但玻璃只能模拟，且系统禁止真实照片；公众号不做 yozora，卡片限文字/抽象图。 |
| KIHON 基本 | 改编 | 做 | 银灰金属适合短篇、数据文；卡片用原生 9:16 最合身，但必须允许关掉 Reed 通用页眉页脚。 |
| KUNLUN 昆仑 | 改编 | 做 | 雪线浅色已有批准版，公众号可做；卡片 void / snowline 都强，注意禁紫和中文全等宽的例外。 |
| Mayonaka 真夜中 | 不做 | 做 | 只有深色，浅色改编会变成另一套系统；卡片是它的主场，但长中文像素字体仍需拍板。 |
| RIFT 裂隙 | 改编 | 做 | 黎明浅色 token 完整；公众号的 glitch 只能静态化，卡片才是完整签名。 |
| core | 改编 | 做 | 霜纸浅色适合长文，Y2K 窗口在公众号需改成流式叠窗；卡片可完整复刻桌面语法。 |