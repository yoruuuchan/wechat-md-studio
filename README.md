[中文](README.md) | [English](README_EN.md)

# 芦苇 · Reed

> 人是一根会思考的芦苇。

**从一份 Markdown，做出公众号文章、小红书图文卡片和活动回顾长图；也可以在同一个工作台制作微信交互动效。**

芦苇是一款免费、开源的网页创作与排版工具。写好内容，选一种呈现方式，调整模板、字体和图片，就能复制到公众号或导出成图片。你可以自己完成整个过程，也可以让习惯使用的 AI 帮忙写稿，甚至通过 MCP 直接修改当前文章。

**[在线使用芦苇](https://wechat.yoru-and-akari.dev)** · [浏览公众号主题](https://wechat.yoru-and-akari.dev/themes) · [AI 写作 Skill](https://wechat.yoru-and-akari.dev/skill.md)

由 Yoru 开发，持续在真实创作中使用与完善。支持中文 / English 界面；不用安装，也无需登录即可开始编辑、排版和导出。喜欢这个项目，欢迎点个 [Star](https://github.com/yoruuuchan/wechat-md-studio)。

| 亮色界面 · akari | 深色界面 · yoru |
|:--:|:--:|
| ![芦苇：Markdown 编辑、公众号预览与素材侧栏](docs/images/editor-akari.png) | ![芦苇深色界面，正文预览仍保持白底](docs/images/editor-yoru.png) |

## 芦苇能做什么

| 创作模式 | 你可以做什么 | 如何交付 |
|---|---|---|
| **微信公众号文章** | Markdown 实时排版；227 套主题、主题筛选与对比；图片裁切、公式、表格、图表、金句卡、图集和轮播 | **复制富文本到公众号后台**，或导出正文 HTML |
| **小红书图文卡片** | 一篇文章自动生成封面并分页；内置与公用模板、不同画幅和背景；查看模板缩略图、调整配色字体、导入 `.reedcard` 模板 | **1080px PNG**，或整套图片 ZIP |
| **活动回顾长图** | 用标题、头图、章节和照片组排出竖向长图；连续照片自动等高成行；自定义模板配色与字体 | **1080 / 1440px JPG 或 PNG**；超长内容自动分张 |
| **微信公众号动效** | 可视化摆放文字、图标、表情和插画；制作滑动、点击、逐步展开等五种交互效果 | **复制到微信公众号**，保留互动效果 |

公众号文章、小红书卡片和长图使用**同一份 Markdown 原稿**，在顶栏切换模式即可重新排版。动效有独立的可视化搭建台，也直接集成在编辑器里。

比如写完一篇活动回顾，你可以先选一套公众号主题，复制到微信后台；再切到「小红书卡片」，自动分页、换个模板，导出整组图片；最后切到「长图」，把现场照片排成一张竖长图。**文章始终是同一份 Markdown**，改了内容，不必维护三套稿件。

公众号主题可以用当前文章试排，最多三套并排比较；卡片和长图模板有缩略图，还能调整配色、字体或导入自己的模板。

## 三步开始创作

1. **准备内容：** [打开编辑器](https://wechat.yoru-and-akari.dev)，直接输入或粘贴 Markdown，也可以导入 Markdown / DOCX 或粘贴网页、Word 的富文本。
2. **选择呈现方式：** 在顶栏切换公众号文章、小红书卡片或长图；挑选主题 / 模板，再调整图片、颜色和字体。想制作交互内容就切换到「动效」。
3. **复制或导出：** 公众号文章复制到微信后台；卡片和长图下载图片；动效复制到公众号。稿件也能单独保存成文件。

## 和 AI 一起创作

**让 AI 起稿。** 点击编辑器里的「AI 帮我写」，复制提示词或 [写作 Skill](skills/wechat-typesetter/SKILL.md) 地址，交给 ChatGPT、Claude、Codex、OpenCode 等常用 AI。生成的 Markdown 粘回芦苇，继续人工校对、换主题、整理图片即可。无法联网读取 Skill 的 AI，也可以直接使用弹窗的「复制完整 Skill」。

**让 AI 画图表。** 点击「AI 画图表」，可以先看架构图、流程图和柱状图示例，再把提示词及 [diagram-design-zh](https://github.com/patrick-xin/diagram-design-zh) Skill 地址交给自己的 AI（中文适配作者 patrick-xin，MIT；基于 Cathryn Lavery 的 [英文原版](https://github.com/cathrynlavery/diagram-design)）；拿到 PNG 后上传插入文章。此入口提供操作说明，不会在芦苇网页内调用生成模型。

**让 Agent 直接改当前文章。** 在「设置 → 高级功能 → AI 直接编辑当前稿件」创建 Remote MCP 连接。支持匿名使用，授权限定到当前稿件；Agent 可以读取写作规则和正文、写回修改，浏览器实时同步。版本冲突会暂停覆盖并交给你选择。[查看 Remote MCP 接入说明](docs/remote-mcp.md)。

另有面向站长云端稿件的 [Agent REST API 与 Python 客户端](docs/agent-api.md)，适合「Agent 推稿 → 网页精修 → 读回结果」工作流。

## 编辑器与排版

- **<!-- gen:theme-count -->227 套<!-- /gen:theme-count -->主题**：按风格、复杂度、色系与来源筛选，收藏常用模板，用同一份样稿比较效果；保留作者、License 与移植来源。
- **公众号 Markdown 方言**：章节自动编号、重点标记、金句卡、引文框、居中句、署名、表格、公式和 Mermaid 图表。
- **图片**：上传、压缩（自动 / 指定 1–5 MB / 原图）、自动 / 手动真实裁切、素材管理；同比例轮播与 2～4 列网格。
- **编辑与预览**：CodeMirror、Markdown 工具栏（含表格按列 / 整表对齐）、语义格式刷、语法补全、同步滚动、375 / 677 预览；界面支持浅色 / 深色 / 跟随系统。
- **小红书卡片**：从顶栏的模式入口切到「小红书卡片」，模板、比例和背景在右栏「模板」里调整；一份 Markdown 自动分页并生成封面，内置默认模板支持三种比例、五种背景，导出 1080px 宽 PNG 或整套 ZIP；单独一行 `---` 可手动换页。模板选择里另有 9 套人人可用的公用模板（瑞士秩序、纸页杂志、书页摘录、柔光极光、夜间研究、文档结构、科技脉冲、清爽手帐、雾松笔记），访客也能直接使用；同一栏还可以一次上传多个本机 `.reedcard` 模板文件，登录后与站长的云端模板库同步，删除也会跨设备生效。源文件在 [`card-templates/public/`](card-templates/public/)，公用包与上传包走完全相同的解析和安全检查。格式与限制见 [模板文件格式](docs/card-template-format.md)，[使用与实现说明](docs/xhs-cards.md)。
- **长图**：从模式入口切到「长图」，同一份 Markdown 排成一张活动回顾式的竖长图：一级标题和第一张图是头部，二级标题分小节，连着放的照片按原比例等高成行，最后一个 `---` 之后是落款。导出 1080 或 1440 宽的 JPG / PNG，太长时明说分成几张；模板同样是 `.reedcard`，可以上传自己的。
- **推文动效**：顶栏的「动效」在编辑器里原地打开推文动效搭建台（`/motion/` 仍可单独打开），在画布上摆文字、图标、表情和插画，排好读者碰一下之后谁先动，五种玩法（滑过就演、一滑一步、点哪动哪、左右滑、点一下长出来），整篇复制进公众号；稿子存在浏览器里，可以存成文件带走，站长登录后另有云端草稿箱。[说明](docs/motion.md)。
- **保存**：本机防丢，登录后使用站长的云端草稿箱；本机与云端同步同样有冲突处理。
- **导入导出**：Markdown、DOCX 与整包备份导入，粘贴网页 / Word 富文本会自动转成公众号方言；Markdown、正文 HTML、完整预览页与整包稿件备份导出。
- **发布前检查**：整篇复制、正文 HTML 与完整预览页导出之前，先列出未完成的公式与图表、空图片位、本机或内网的图片地址，按阻断 / 提醒分级；干净的稿件直接通过。
- **Agent REST API**：保留独立的 REST API 和零依赖 Python 客户端，支持推稿 → 网页精修 → 读回结果，使用 hash 防止静默覆盖。它访问站长的云端稿件，需要单独配置 Agent 令牌，打开编辑链接需要浏览器登录；接入见 [Agent API](docs/agent-api.md)。

模板库中的卡片都渲染同一份样稿，方便横向比较；也可以切到当前文章试排，把最多 3 套候选并排比较。试排和对比都不会改正文或保存主题，只有明确的「应用」才写入；来源项目、色系与许可证直接列在卡片上，作者点开「来源」查看。

![主题库：筛选模板并查看真实渲染结果](docs/images/theme-library.png)

默认 `golden` 主题的正文特写：首行缩进、章节编号、重点、链接脚注、金句卡和引文框。

<img src="docs/images/typeset-golden.png" width="420" alt="golden 主题的公众号正文排版" />

## Markdown 方言速览

支持常规 Markdown 标题、列表、行内标记、围栏代码块与 GFM 表格。公众号扩展如下：

| 语法 | 效果 |
|---|---|
| `==重点==` | 关键词标记 |
| `## KICKER \| 标题` | 自动编号章节，可带短标签 |
| `> 金句` | 金句卡片 |
| `:::quote` / `:::center` … `:::` | 引文框 / 居中强调句 |
| `![图注](src)` | 图片与自动图号；空 `src` 留上传占位 |
| `![图注](img:key)` | 引用已上传的本站图片；公开 HTTPS 图片地址也可使用 |
| `:::carousel 4:3 标题` … `:::` | 同比例轮播，默认 `4:3` |
| `:::gallery 3 1:1 标题` … `:::` | 多图网格，默认两列正方形 |
| `$$ … $$` 独占一段 | 块级公式，转为 SVG；不支持行内公式 |
| 围栏代码语言为 `mermaid`，可附图注 | 图表转 PNG，沿图片链路上传 |
| `@signature` | 署名块 |
| `<!-- 备注 -->` | 源稿编辑备注，不进入正文；围栏代码中照常显示 |
| front matter `titles` / `cover` | 标题候选 / 封面建议，仅进入侧栏 |

完整 [示例稿](src/lib/sample.ts)和 [写作 Skill](skills/wechat-typesetter/SKILL.md)可以直接参照。参数、裁切、公式与微信兼容规则见 [渲染与图片](docs/rendering.md)。

## 本地运行

使用 Node.js 24（当前验收版本）。在含 `package.json` 的目录运行；本地伞仓库中先进入 `app/`。

```bash
npm ci
cp .env.example .env
npm run dev
```

PowerShell 用 `Copy-Item .env.example .env` 复制配置，默认打开 `http://localhost:3000`。开发配置中删掉 `NODE_ENV` 整行：将它写为 `development` 会影响 Vite 的 React 生产构建。图床、密钥与生产启动方式见 [配置说明](docs/configuration.md)。

| 命令 | 用途 |
|---|---|
| `npm run check` | TypeScript 检查 |
| `npm test` | Vitest 单元与服务端测试 |
| `npm run verify:themes` | 全主题渲染与微信规则校验 |
| `npm run sync:docs` / `npm run verify:sources` | 生成并核对中英文 README 的主题统计、来源与致谢 |
| `npm run build` | 构建 `dist/boot.js` 与 `dist/public/` |
| `npm start` | 生产服务；PowerShell 启动见配置文档 |

核心链路是 `Markdown → 语义 AST → Theme → 微信兼容的全内联 HTML`。React + Vite + CodeMirror 负责编辑，Hono 提供 tRPC / REST / MCP；IndexedDB / localStorage 保存本机稿件，SQLite 保存云端稿件和明确授权的临时协作副本，图片 Worker + R2 承载图片。预览、复制和正文 HTML 导出共用渲染结果。

## 保存、图片与使用边界

- **正文默认在本机。** 开启 Remote MCP 后才上传这一篇的临时协作副本，默认 24 小时有效。只有对应游客与持有该篇令牌的客户端能读写；撤销立即删除副本，到期立即拒绝访问并定期清理，本机稿件保留。登录另打开站长云端草稿箱。
- **上传图片公网可读。** 图片落在本站对象存储，通过 `/api/img/…` 公开提供；拿到链接的人都能看到。匿名图片有上传额度，默认按 14 天期限回收；本机稿件中的引用不保证图片永久保留。微信粘贴成功并转存后，公众号中的图片由微信保存。
- **内容由执笔与发布的人负责。** 本站做格式、额度与文件类型检查，不审阅稿件或图片内容。禁止用图床传播违法内容、涉及未成年人的性内容、侵权或侵犯隐私的内容、恶意程序与诈骗素材，也禁止当网盘批量灌图。发现违规内容可删除文件并拒绝继续接收。

完整规则见 [使用规范](https://wechat.yoru-and-akari.dev/terms)。权利投诉通过站内反馈表单提交（[wechat.yoru-and-akari.dev/feedback](https://wechat.yoru-and-akari.dev/feedback)，或编辑器右栏「设置 → 反馈」），写明具体地址、权利人或受托说明与联系方式；收件邮箱不公开在页面上，由服务端转发。服务按现状提供，可能变更、限流或下线；软件无担保。自行部署时，存储、域名与使用规则由部署者管理。

## 开源与资料

项目采用 **AGPL-3.0-or-later**，见 [LICENSE](https://github.com/yoruuuchan/wechat-md-studio/blob/master/LICENSE)。

<!-- BEGIN GENERATED: readme-theme-sources — npm run sync:docs -->
主题库共 **227 套**：3 套自研 + 9 个上游项目的 224 套主题，来源与许可维护在统一 metadata 中。

主题审计见 [THEME-SOURCES](THEME-SOURCES.md)；工程借鉴、取舍与完整致谢由 [credits.ts](src/lib/credits.ts) 驱动 [References](https://wechat.yoru-and-akari.dev/references) 与 [LICENSES/NOTICE](LICENSES/NOTICE.md)。
<!-- END GENERATED: readme-theme-sources -->

| 资料 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 开发 Agent 入口、模块导航与工程约束 |
| [AI 写作与 Remote MCP](docs/remote-mcp.md) / [Skill](skills/wechat-typesetter/SKILL.md) | 写稿规则、授权当前稿件与客户端接入 |
| [稿件与编辑器](docs/documents.md) | 本机 / 云端保存、合并、冲突、草稿箱和导入导出 |
| [渲染与图片](docs/rendering.md) | Markdown、Theme、微信 HTML 与图片生命周期 |
| [小红书卡片](docs/xhs-cards.md) / [模板文件格式](docs/card-template-format.md) | 卡片分页、模板、比例、导出与上传模板格式 |
| [长图模式](docs/long-image.md) | Markdown 对应规则、照片组、长图模板、导出与分张 |
| [Agent API](docs/agent-api.md) | REST / Python 推稿与读回 |
| [配置](docs/configuration.md) / [验证](docs/verification.md) / [HANDOFF](HANDOFF.md) | 运行、测试与部署 |
| [品牌与兼容标识](docs/branding.md) | 芦苇 / Reed 的命名与保留内部标识的原因 |

仓库名 `wechat-md-studio` 和现有域名保持不变。
