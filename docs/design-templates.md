# 设计系统模板

把 Yoru 的设计系统（[yoru-design-systems](https://github.com/yoruuuchan/yoru-design-systems)，MIT）做成 Reed 的公众号主题和小红书卡片模板。第一批三套：YORU Content、PAPER、yoru-and-akari Console。三套先出小样给 Yoru 看，她点头后再做其余系统；上线与小红书卡片一起。

## 原则

- **结构跟着系统走，不只借色。** 每套系统靠什么成形（阴影造型、线条体系、圆角、版面家具、强调手段），模板就带什么。只换了颜色的模板不算完成。
- **设计系统是唯一事实来源。** 字号、颜色、间距从系统的 tokens 读，再换算到载体尺度；系统明令禁止的做法（YORU 的左侧色条、PAPER 的圆角等）在模板里同样不出现。
- **卡片与公众号分开想。** 卡片导出成图片，字体跟着图片走，可以用系统规定的网页字体；公众号正文只能用读者手机里的字体，主题的辨识度靠颜色、线条、间距和结构。
- **公众号浅色为主。** 深色模式交给微信转换；画面里不放不传递信息的装饰（角落英文小标签、刻度、读数）。需要自己底色的质感（新拟态）只用在承载内容的块上。
- **尺度换算。** 系统卡片画布 1242px 宽，Reed 卡片 540 CSS px（导出两倍为 1080px），系数 540/1242 ≈ 0.435；手机界面类系统（Console 设计宽 390px）按 540/390 ≈ 1.385 放大。

下文路径都相对 yoru-design-systems 仓库根。

## YORU Content · 铅字房

来源：`YORU Content Design System/README.md`（「VISUAL FOUNDATIONS」「四个签名动作」「封面：套印靠这几件东西撑住」），`tokens/*.css`，`templates/xhs-post/`，`templates/wechat-article/`。

| 部位 | 来源 | 借用 |
|---|---|---|
| 纸与墨 | `tokens/colors.css`、`tokens/variants.css` | 青白纸 `#F2F5F5`；冷墨阶 ink-1…6（正文 ink-2）；四个变体强调色 Signal `#3186FF`、Lab `#00A9BB`、Studio `#45C496`、Special `#FF6B78`；靖青 `#2E4A68` 只做印章位细节 |
| 报头（内页顶部） | 签名动作 ① | 左：月相行（新月、上弦、满月、残月；满月用变体色，其余墨色）；右：仿宋汉字页码「〇二 / 〇七」；下：文武线（粗线加细线，相隔 4px）；没有刊名和日期 |
| 书脊 | 页面家具 | 右边距一条直排仿宋，字距 .4em；Reed 里印文章标题 |
| 封面 | 封面一节、`templates/xhs-post/` | 标题两遍套印（墨色一遍，变体色错位一遍）；仿宋副标题压住标题；底部横排（作者、页数）撑住版心下沿；无图时居中，不为填空加色块或图形 |
| 标题 | 装饰细节 ④ | 思源宋体（Noto Serif SC）；页面第一个标题上方一条墨色横线；章节编号等宽补零、变体色 |
| 强调 | 签名动作 ②③ | `**加粗**` 是着重号（词下方的点），正文不着色；`==高亮==` 是荧光笔（压在行盒下部约 42% 的浅色带） |
| 引用 | 硬规则 | 上下两条横线夹住，仿宋 |
| 代码 | 硬规则 | 深色 `#20293C`，系统里唯一的阴影：内凹 |
| 图片 | 图片处理 | frame：发丝边加极轻投影，圆角 2px |
| 变体 | `tokens/variants.css` | 行高 Signal 1.72、Lab 1.68、Studio 1.9、Special 1.85；块间距按 1242 画布的 56/56/100/76 换算；Lab 分隔线用虚线；Studio、Special 用胶囊标签 |
| 不出现 | 硬规则 | 左侧色条与彩色 `border-left`、渐变、玻璃、发光、彩色阴影、8/12px 通用圆角卡片、黄色 |

字体：标题与卡片正文 Noto Serif SC；仿宋位（页码、书脊、引用、副标题）用朱雀仿宋（系统规定仿宋，网页上用这款开源仿宋实现）；代码 JetBrains Mono；英文 Inter。公众号版正文用读者默认黑体（系统规定文章正文是黑体），标题写宋体字体栈，强调色用 Signal。

## PAPER · 纸本

来源：`PAPER Design System/README.md`（「The two modes」「The theme axis」「Visual foundations」），`SKILL.md`（「Three rules that matter more than the rest」），`tokens/`，`templates/photo-essay/`。

| 部位 | 来源 | 借用 |
|---|---|---|
| 纸与墨 | Visual foundations、`tokens/` | Editorial 纸 `#F4F1EA`、Analog 纸 `#EDE6D7`、Midnight 午夜蓝（`tokens/midnight.css`）；暖炭墨，不用纯黑；铁锈红 `#B8543A` 每页最多两处（页码、章节数字或图号） |
| 版面 | Visual foundations | 零圆角；三档线：节内发丝线、节间 1px 墨线、封面与章节断开用 3px 加 1px 双线；用线和留白代替卡片 |
| 正文 | Type | 首段之后的段落首行缩进，段间不空行；17px/1.68 按载体换算 |
| 标签 | The two modes | Editorial：IBM Plex Sans，字距 .14em；Analog：IBM Plex Mono，字距 .06em |
| 图片 | Imagery | 直角，1px 内描边（墨色 14%）；Analog 加印刷阴影，偶尔倾斜 −0.55° |
| 质感 | Backgrounds、The two modes | 纸面颗粒 Editorial 3.5%、Analog 7.5%；Analog 每张最多一两处物件（日期戳、胶带、一行 Caveat 手写） |
| 图注 | Three rules | 写事实，不复述标题 |

字体：中文 Noto Serif SC；英文 EB Garamond；标签 IBM Plex Sans / IBM Plex Mono；手写 Caveat。公众号版只做 Editorial 浅色纸。

## yoru-and-akari Console · 灯与夜

来源：`yoru-and-akari Console Design System/README.md`（「Brand concept」「VISUAL FOUNDATIONS」，尤其「Shadows — the core motif」「Radii」「Borders」），`colors_and_type.css`，`preview/` 组件卡。

| 部位 | 来源 | 借用 |
|---|---|---|
| 配色 | Brand concept、Color | akari 瓷白 `#E8ECF3`、yoru 午夜靛 `#0B1020`；主色 `#4F6CE8` / `#7A95FA`；ember 与 frost 各不超过画面 5% |
| 质感 | Shadows | 柔和新拟态，阴影带色、不用纯黑；内凹优先（正文承载区、引用、代码、分组行），外凸留给前景物件（图片、页码胶囊） |
| 圆角 | Radii | 6/9/12/16/22/胶囊；卡片 16–18 |
| 线 | Borders | 发丝线是 6%、10% 墨；块靠阴影成形，不靠描边；选中态 1.5px 主色描边；不用彩色左边条 |
| 背景 | Backgrounds | 纯色，加页面级极淡径向光（右上蓝、左下 ember） |
| 字体 | Type | Geist 加 Noto Sans SC；数字和页码 Geist Mono；标题字距 −0.012em |

公众号版：新拟态需要自己的底色，深色模式下会变成一块亮色，所以只在代码块、引用这类承载块上用内凹，页面保持白纸。

## 第二批 · 卡片模板落地

第二批六套的卡片落地只改卡片层，不改公众号主题。尺寸仍以 540 CSS px 为画布、PNG 两倍导出；1242px 卡片稿按 540/1242 ≈ 0.435 换算，KIHON 的原生 1080×1920 按 0.5 换算。六套都不使用两端刻点分隔线、齿纹带、刻度、读数或角落英文小标签，也不在卡片上印设计系统名或模板名；每张卡只在页脚或状态栏保留一处页码。正文、副标题和小字与它们实际压住的底色（含渐变、颗粒和扫描线）对比度不低于 4.5:1，24px 以上的粗体标题不低于 3:1。

### KUNLUN · 昆仑

- 变体 `void`（默认深色）/ `snowline`（浅色），3:4、1:1、9:16 都可用。卡片字体 Orbitron 500/700/900、JetBrains Mono 400/700、VT323 400、Noto Sans SC 400/700。
- 封面：切角面板、Orbitron 大标题与副标题；底部作者与 `[ 01 / 05 ]`。没有字标、HUD 四角刻度、坐标、ASCII 框或紫色。
- 正文：页眉只写文章标题和一条普通 1px 头线；页码只在页脚出现，不在页眉重复。每页一块切角内容面板。H2 用 Orbitron + `[ kicker ]` 等宽标签，H3 用等宽；加粗 700 墨色；高亮是 cyan 12% 底 + 1px cyan 下边。
- 引用是 1px signal 边切角面板；代码在 snowline 是 `#C9D6D8` LCD + `#1C3038` 段码墨 + VT323 扫描线，在 void 是 `#02040A` 终端底。图片 1px 线 + 2px 微圆角，图注 11px 等宽；表格 1px 线；分隔线 1px；页脚作者与 `[ 01 / 05 ]`。snowline 的强调色加深到 `#005F87`，让页码、H2 kicker 和链接在浅底上达到 4.5:1。
- 切角用真实 `clip-path`（卡片是浏览器截图）；不用圆角卡片、不用大面积 bloom，也不把 cyan 当正文色。

### RIFT · 裂隙

- 变体 `dark`（默认）/ `light`（黎明），3:4、1:1、9:16 都可用。卡片字体 Space Grotesk 300–700、DM Serif Display 400 italic、Rajdhani 400–700、Share Tech Mono 400、Noto Sans SC 400/700。
- 封面：静态 sky × royal 双色偏移标题、DM Serif 斜体副题；底部作者与页码。没有字标、循环 glitch，也没有满屏扫描线。
- 正文：每页一块玻璃内容面板，左上只有一个 L 形角标；H2 用 Space Grotesk 600 + 静态 chromatic edge + Share Tech Mono kicker；加粗 600；高亮是 royal 14% 带 + 1px royal 下划线。页眉只有文章标题，页码只在页脚。
- 引用是玻璃面板；代码用 sunken 底 + 1px 线 + 10px 圆角 + 顶部内高光 + 3px 节距扫描线；图片 8px 圆角、1px glass 边、顶部内高光，图注 11px 等宽；表格在玻璃里；分隔线 1px；页脚作者与页码。dark 的次级文字提到 `#8FA0C0`；light 的次级文字 `#4E5C80`、强调色 `#2C46C8`，页眉、页脚、图注和页码在黎明底色上达到 4.5:1。
- 玻璃是半透明填充 + 内高光，不用 `backdrop-filter`；禁紫、禁暖图、禁双边框。

### core

- 变体 `frost`（默认浅色）/ `nightpool`（深色），3:4、1:1、9:16 都可用。卡片字体 Pixelify Sans 400–700、VT323 400、Tinos 400/700 + italic、Noto Serif SC 400/700、Noto Sans SC 400/700。
- 封面是一扇 Window：深 bondi 标题栏（留空，不放 `cover` 占位词）、1px ink 边框、3px/6px 硬偏移阴影、Pixelify / Noto Serif SC 标题、Tinos 斜体副题、底部状态栏。没有假关闭键、没有斜纹、没有圆角。
- 正文每页也是一扇 Window：标题栏只写小写文章标题，不再放页码；状态栏放作者与页码。H2 用 Pixelify / Noto Serif SC + VT323 `[ kicker ]`；加粗 700；高亮是 bubblegum 45% 下半行带。标题栏用 `#0072A3`（nightpool `#006B9C`）配白字，正文链接 `#006A94`，状态栏与图注同样按 4.5:1 校验。
- 引用与代码是 sunken bevel-in 面板；代码 VT323；图片 1px ink 直角框 + 2px 偏移硬阴影，图注 VT323；表格深 bondi 表头 + 1px ink 网格；分隔线 1px 虚线；没有纯白/纯黑，也不给用户图套滤镜。

### Aozora · 青空

- 变体 `daylight`（默认晨空渐变）/ `yozora`（夜空蓝），3:4、1:1、9:16 都可用。卡片字体 Inter 400/600、Space Grotesk 500/700、JetBrains Mono 400、Noto Sans SC 400/700；不额外打包 Noto Sans JP。
- 封面：压在渐变上的 28px 玻璃托盘、大号标题与副题；底部作者与 `01 / 05`。托盘和页脚统一用左右 42px 的边距，去掉原来的竖排 `青空` eyebrow 和字标后仍然居中平衡。玻璃是静态白 55% + 1px 白描边 + 顶部内高光 + 蓝调阴影，不依赖模糊。
- 正文：每页一块玻璃托盘（20px 圆角），H2 26px + JetBrains Mono `01 / OVERVIEW` 式小 kicker；加粗 700 墨色；高亮是太阳黄 55% 下半行带，全文只此一种黄色用法。daylight 的次级文字提到 `#4A5868`，强调色和链接色用 `#005DB3`，页脚压在晨空底部黄色上仍达到 4.5:1。
- 引用是白 72% 玻璃块；代码是 `#07090E` 深玻璃 + JetBrains Mono 13px；图片按普通图片展示：20px 圆角、蓝调阴影，不套玻璃框、不加照片滤镜；图注 11px 等宽 `.16em`；表格与分隔线 1px 蓝发丝线；页脚作者与页码。
- 系统禁止真实照片与 emoji。卡片允许抽象玻璃/水滴/太阳或 UI 截图；摄影稿应换模板，Reed 不会把照片包装成青空品牌插画。

### KIHON · 基本

- 变体 `gin`（默认银）/ `kuro`（玄），**只做 9:16**。选中 KIHON 时比例自动切到 9:16，3:4 与 1:1 按钮禁用，并在比例行下给一句提示。卡片字体 Instrument Sans 400/500/700、B612 Mono 400/700、Noto Sans SC 400/700。
- 封面：card 面的 10px 圆角 + 两段式 chamfer、44–54px 标题、20px 副标题、一条普通 1px 线；没有字标、页眉页脚，只在右下角保留 `01 / 05` 的 B612 Mono 页码。
- 正文：22px / 1.45 的视频帧尺度；H2 32px + B612 Mono kicker + 普通 1px 线，H3 26px；加粗 700；高亮是 `#DCE3EB` 浅金属凹槽 + 1px `#8E979E` 底线，不用黄色荧光笔。
- 引用是 well（凹槽渐变 + 1px 线 + 8px 圆角 + 内凹阴影）；代码也是 well + B612 Mono 15px，不开深色终端；图片放在 card 面（1px 线、10px 圆角、两段 chamfer、三层定向阴影），图片本体 6px 圆角；图注 17px；表格 plate；分隔线 1px；列表用 `·` 刻度、有序列表两位补零。
- 不用系统原有的两端刻点 Rule、knurl 齿纹带、顶部标签条、底部进度条或相机饰件；5% 颗粒和镜头 falloff 只铺页面，不铺每个承载块。

### Mayonaka · 真夜中

- 变体 `midnight`（默认深夜 + 扫描线）/ `sunset`（封面专用：`--grad-sunset` + 条纹太阳 + 网格地板）；没有浅色。3:4 为主，9:16 可用。卡片字体 VT323 400、Noto Sans SC 400/700；Press Start 2P、DotGothic16、Major Mono Display 不再用于卡片。
- 封面：`midnight` 是深夜底 + 扫描线 + 网格地板；`sunset` 追加条纹太阳与洋红渐变，并在下半部压一层从透明到 `rgba(7, 0, 15, .94)` 的暗色渐变，让中文大标题、副题和页脚在洋红/粉色上仍高于对比度门槛。中文大标题用 Noto Sans SC 并加静态洋红/青双向偏移；底部作者与页码。一张卡最多一处主 glow。
- 正文：每页一块 `#0A1654` 深蓝面板，2px 边框 + `4px 4px 0` 硬像素阴影，直角；H2 Noto Sans SC 700 + VT323 `//` kicker + 2px 青线；长中文正文一律 Noto Sans SC 17px / 1.7，不引入日文字体回退。次级文字提到 `#9A8BC0`，页脚和图注在深蓝面板上达到 4.5:1。
- 加粗 chrome；高亮是 2px 青下划线，不用柔和荧光带；引用是 2px 洋红边 + 硬阴影；代码 `#03000A` + VT323 + 扫描线；图片方形、2px 边框、洋红暖调；图注 VT323；表格 2px 边框；分隔线 1px；页脚作者与页码。
- 不做浅色模式、圆角卡片、backdrop blur 或 emoji；同一元素不同时用像素阴影和 glow。

## 字体

| 族 | 字重 | 用在 | 来源与授权 |
|---|---|---|---|
| Noto Serif SC | 400（新增）、700（已有） | YORU、PAPER 中文 | `@fontsource/noto-serif-sc@5.3.1` 切片，OFL |
| 朱雀仿宋 | 400 | YORU 仿宋位 | [TrionesType/zhuque](https://github.com/TrionesType/zhuque)（官方仓库，release v0.212），OFL；按 Noto Serif SC 切片的 unicode-range 自行切片 |
| Inter | 400、600 | YORU 英文 | `@fontsource/inter@5.3.0` 的 latin / latin-ext，OFL |
| JetBrains Mono | 400 | YORU 代码 | `@fontsource/jetbrains-mono@5.3.0` 的 latin / latin-ext，OFL |
| EB Garamond | 400、400 italic、600 | PAPER 英文 | `@fontsource/eb-garamond@5.3.0` 的 latin / latin-ext，OFL |
| IBM Plex Sans / IBM Plex Mono | 400、500 / 400 | PAPER 标签 | `@fontsource/ibm-plex-sans@5.3.0` / `@fontsource/ibm-plex-mono@5.3.0` 的 latin / latin-ext，OFL |
| Caveat | 400 | PAPER Analog 手写 | `@fontsource/caveat@5.3.0` 的 latin / latin-ext，OFL |
| Geist、Geist Mono、Noto Sans SC | 已有 | Console | 已有 |
| Instrument Sans | 400、500、700 | KIHON 拉丁/标签 | `@fontsource/instrument-sans@5.3.0` 的 latin 子集，OFL |
| B612 Mono | 400、700 | KIHON 数字/页码/代码 | `@fontsource/b612-mono@5.3.0` 的 latin 子集，OFL |
| Orbitron | 500、700、900 | KUNLUN 显示 | `@fontsource/orbitron@5.3.0` 的 latin 子集，OFL（RFN） |
| VT323 | 400 | KUNLUN / Mayonaka / core 代码 | `@fontsource/vt323@5.3.0` 的 latin 子集，OFL |
| Space Grotesk | 300、400、500、600、700 | RIFT 标题/正文 | `@fontsource/space-grotesk@5.3.0` 的 latin 子集，OFL |
| DM Serif Display | 400 italic | RIFT 斜体短句 | `@fontsource/dm-serif-display@5.3.0` 的 latin 子集，OFL（RFN） |
| Rajdhani | 400、500、600、700 | RIFT 正文/UI | `@fontsource/rajdhani@5.3.0` 的 latin 子集，OFL |
| Share Tech Mono | 400 | RIFT 标签/日志 | `@fontsource/share-tech-mono@5.3.0` 的 latin 子集，OFL（RFN） |
| Pixelify Sans | 400、500、600、700 | core 显示 | `@fontsource/pixelify-sans@5.3.0` 的 latin 子集，OFL |
| Tinos | 400、700、400 italic、700 italic | core 拉丁正文/引用 | `@fontsource/tinos@5.3.0` 的 latin 子集，OFL |

新字体文件与 `@font-face` 在 [public/fonts/fonts-templates.css](../public/fonts/fonts-templates.css) 和
[public/fonts/fonts-design.css](../public/fonts/fonts-design.css)（第二批，157 个 woff2，合计约 1.20 MB），
朱雀的切片由 [scripts/fonts/slice-by-ranges.py](../scripts/fonts/slice-by-ranges.py) 生成，
许可副本为 `public/fonts/OFL-*.txt`。分页预载与 PNG 内嵌共用
[cards.ts](../src/lib/cards.ts) 的 `CARD_TEMPLATE_FONTS`。

卡片导出前必须确认这些字体真的参与了渲染：用 Chrome 报告的实际渲染字体检查，看到对应族名（网页字体）才算数。

导出还必须使用与预览相同的计算字号。`html-to-image` 克隆时会把每个字号改成 `floor(size) - 0.1px`，在 17–18px 的中文正文上足以改变断行；导出器在克隆阶段把模板实际字号补回去，并用 CDP 的 DOM / PNG 对照验证。十套模板（含默认模板）都走这条路径，不保留旧字号基线。
