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

新字体文件与 `@font-face` 在 [public/fonts/fonts-templates.css](../public/fonts/fonts-templates.css)，
朱雀的切片由 [scripts/fonts/slice-by-ranges.py](../scripts/fonts/slice-by-ranges.py) 生成，
许可副本为 `public/fonts/OFL-*.txt`。分页预载与 PNG 内嵌共用
[cards.ts](../src/lib/cards.ts) 的 `CARD_TEMPLATE_FONTS`。

卡片导出前必须确认这些字体真的参与了渲染：用 Chrome 报告的实际渲染字体检查，看到对应族名（网页字体）才算数。

导出还必须使用与预览相同的计算字号。`html-to-image` 克隆时会把每个字号改成 `floor(size) - 0.1px`，在 17–18px 的中文正文上足以改变断行；导出器在克隆阶段把模板实际字号补回去，并用 CDP 的 DOM / PNG 对照验证。四套模板（含默认模板）都走这条路径，不保留旧字号基线。
