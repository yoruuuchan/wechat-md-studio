# 开发与验证导航

[项目首页](../README.md) · [Agent 入口](../AGENTS.md) · [部署与线上验收](../HANDOFF.md)

命令以 [package.json](../package.json) 与脚本自身参数为准；在含 `package.json` 的应用根目录运行。
本地伞仓库的各 worktree 都先进入其 `app/`，使用 Node.js 24 与 `npm ci`。

## 项目级检查

```bash
npm run check
npm test
npm run verify:themes
npm run build
```

- `check`：TypeScript 项目检查；`test`：Vitest，覆盖 parser、存储、导入导出、API 等相邻测试。
- `verify:themes`：全主题渲染、微信正文规则、metadata / 许可文件、图片短引用、比例、图片操作、SQLite 驱动契约；成功输出 `ALL CHECKS PASSED`。
- `build`：Vite 前端 `dist/public/` + esbuild 服务端 `dist/boot.js`。`vite preview` 只预览前端，不能替代带 API 的服务验收。

主题验证同时输出 `verify-out/*_clean.html` 与 `*_preview.html`；可通过 `MOPAI_VERIFY_OUT` 指定目录。
新增主题 / 来源时用 `npm run import:themes` 重生成，再复算主题统计与检查许可证文件，见
[THEME-SOURCES](../THEME-SOURCES.md)。
来源与致谢的事实源为 [theme-sources.ts](../src/lib/theme-sources.ts)、[credits.ts](../src/lib/credits.ts) 和各 Theme 的 metadata。
相关改动先 `npm run sync:docs` 更新 README / THEME-SOURCES / NOTICE 的生成区块，再 `npm run verify:sources` 检查数据、许可路径大小写与文档一致性。
生成器在 [sources/report.ts](../scripts/sources/report.ts)，长篇致谢生成到 NOTICE，README 保留简短入口。
针对性单测示例：`npm test -- src/lib/parse.test.ts src/lib/render.image-ops.test.ts`。
纯文档变更核对 Markdown 链接、目标文件、路径大小写、命令与当前实现，不需要浏览器或线上数据。

## 自带测试服务的验收

先构建。这些脚本起独立应用、数据库和内存 mock 图床；参数是应用端口，浏览器脚本第二参数是 CDP 端口。
Worker 端口通常为应用端口 + 10，运行前也要确认可用；脚本内测试数据库名固定，同一脚本不在同棵树并发运行。

| 改动范围 | 命令 | 覆盖 |
|---|---|---|
| 小红书卡片 | `node scripts/cdp-verify-xhs-cards.mjs 3201 9334` | SAMPLE_DOC / 中文长文、右栏「模板」里的三比例 × 默认模板五背景、默认模板 × 各自变体的封面 + 前两页导出与像素对比（3:4）、封面标题 / 副标题 / 第 3 页正文对比度、默认模板每个变体 × 三比例的装饰扫描（封面 / 正文 / 结尾的 1–16px 短横线与正文外短句 / 伪元素中的装饰破折号）、PNG 尺寸与 ZIP 张数、明暗 / 中英界面、图片读取失败、卡片视图下改稿时卡片与阅读位置保持、CDP 实际字体；本地 mock 图床、独立 `data/test-xhs.db`，证据在 `verify-out/xhs/`，模板小样在 `verify-out/templates/` |
| 模板颜色与字体 | `node scripts/cdp-verify-template-custom.mjs 3295 9405` | 公用卡片模板 Editorial White：右栏列出模板开放的 5 个颜色和 2 个字体；色块初值等于模板自己的颜色；改主色 / 底色后每张卡片生效；选霞鹜文楷后按需插入它的样式表、封面标题实际渲染为霞鹜文楷而正文仍是模板字体，导出内嵌该字体且 PNG 随之变化；刷新后选择仍在；从本机添加字体（测试用 node_modules 里 KaTeX 的 TTF）后标题用上它、导出以子集内嵌（小于原文件）、刷新仍在、删除后回到模板默认；「恢复默认」；默认 Reed 模板的主色与正文字体（得意黑）且不漏到编辑器界面；没有内容 slot 的结尾页加在正文之后而不吞正文；长图预览按需加载朱雀仿宋；无 CSP / WebAssembly 报错与页面报错。自带本地文件服务与独立 `data/test-custom-cdp.db`，证据在 `verify-out/template-custom/` |
| 长图 | `node scripts/cdp-verify-long-image.mjs 3295 9405` | 中性测试稿（5 节、24 张占位照片、横竖混排、列表与引用、落款）：公用蓝色模板经上传加载器装载、CDP 实际字体、1080 / 1440 的 JPG / PNG 尺寸、预览 DOM 与导出 PNG 的三段像素对比、标题与小节标签的墨色、渐变接缝、强制小上限时的分张 ZIP、空稿 / 只有标题 / 没有图 / 读图失败、示例长图模板上传 → 刷新仍在 → 删除回默认、明暗与中英界面、console 报错；自带本地图床与独立 `data/test-long-cdp.db`，证据在 `verify-out/long/` |
| 上传卡片模板 | `node scripts/cdp-verify-card-template-upload.mjs 3281 9398 [输出目录]` | 只用仓库里的示例模板：`.reedcard` 打包、空 / 有内容两态、多文件上传（含坏包逐项拒绝，报错就在「我的」组内）、上传后进入选择器与「我的」组、选中渲染、单张 PNG 与整包 ZIP、预览 DOM / PNG 像素一致、刷新后仍在、恶意包被拒绝并显示提示、管理状态下删除及刷新后不再出现、删除选中模板回退默认；站长登录后自动上云、全新浏览器 profile 登录后自动下载、登录删除两边消失、访客看不到同步；`data/test-card-template.db` 与本地 mock 图床，证据默认在 `verify-out/card-template-upload/` |
| 公用卡片模板 | `node scripts/cdp-verify-public-cards.mjs 3281 9398 [模板id,...]` | 九套公用模板全部经上传同款解析与激活；公众号模式不请求包、进入卡片模式才加载；逐个变体检查封面 / 正文 / 结尾页溢出、每个变体 × 三比例的装饰扫描（含 `::before` / `::after` 的细短横线与装饰破折号）、3:4 封面 + 正文导出、1:1 / 9:16 封面导出、DOM / PNG 像素一致（mean < 2、bad < 0.025）、封面标题墨色与标题 / 正文对比度；记住公用模板选择并在刷新后恢复；证据在 `verify-out/public-cards/` |
| Agent API / 编辑器深链 | `node scripts/cdp-verify-agent.mjs 3215 9351` | 推稿、登录跳转、网页精修、读回、图片链路 |
| Python 客户端 | `node scripts/verify-agent-skill.mjs 3219` | CLI、配置、JSON / 退出码、本地图改写；无 Python 时显式 SKIP |
| 稿件同步 | `node scripts/cdp-verify-docs-sync.mjs 3216 9352` | 登录合并、仅改名称同步与刷新、stale save、三种冲突处理、按需正文与草稿箱 |
| 稿件删除 / 撤销 / 回收站 | `node scripts/cdp-verify-draft-recovery.mjs 4101 9701` | 登录前后新稿的删除、立即撤销、撤销期结束后回收站恢复与刷新持久化、彻底删除；云端稿件的撤销 / 回收站；未同步正文与改名的删除、撤销及刷新恢复；remove / restore 故障注入 |
| 本机正文读取失败 | `node scripts/cdp-verify-storage-read-failure.mjs 4102 9702` | 一次 / 持续 `getAll` 失败、IndexedDB 打开失败、真实缺失正文、云端 stub、主动清空、旧版迁移失败；每项都核对 IndexedDB 原件未被空串覆盖 |
| 正文未就绪时的动作拦截 | `node scripts/cdp-verify-body-gating.mjs 4134 9734` | `docs.get` 延迟 / 失败、登出后保留 stub：编辑区显示加载、失败可重试、未登录显示原因，没有空白 CodeMirror；顶栏复制、改名、单篇 Markdown / HTML 导出被禁用并给出原因；实际断言剪贴板与下载为空、无成功提示，正文到达后编辑 / 复制 / 导出恢复；弹检查窗期间切稿不会用旧结论交出稿件；切换稿件不残留另一篇的回执；截图为三种阻断状态与加载完成 |
| 双标签页本机保存 | `node scripts/cdp-verify-cross-tab.mjs 4104 9704` | 同稿并发冲突与副本、通知丢失、刷新恢复；不同稿件与同时新建；删除后继续编辑及撤销；已归档 / 曾恢复稿件彻底删除后的旧页编辑；事务中断回滚和可见失败 |
| 按需字体表 | `node scripts/cdp-verify-theme-fonts.mjs 4133 9733` | 首屏样式不含模板 / 设计字体表的字体、不内联字体文件、界面字体仍是网页字体；逐个切到设计主题与手写主题，在预览里读 Chrome 实际渲染字体，确认按需加载的字体真正生效 |
| 慢网云端保存 | `node scripts/cdp-verify-slow-cloud-save.mjs 4131 9731` | 每次保存请求拖慢 2.5 秒、分段连续输入：不误报冲突、同一篇同时最多一个保存在路上、云端拿到全部内容；零延迟对照 |
| 保存状态与恢复提示 | `node scripts/cdp-verify-save-status.mjs 4126 9726` | 本机提交时间、写失败与重试、切稿和迟到回执、未归档 / 同步中 / 网络失败、首次云端读取失败、冲突副本、撤销恢复、中英文、明暗主题、键盘焦点和窄屏 |
| 游客保存指引 | `node scripts/cdp-verify-guest-save-guidance.mjs 4129 9729` | 匿名保存详情说明本机存储与换浏览器 / 清站点数据的影响、「下载 Markdown」「下载整包备份」两个真实下载动作、站长登录命名、/login 与 /drafts 的"不开放注册"口径、中英文、明暗主题、390px 不横向溢出、退出与已登录深链、AI 提示词复制与匿名单篇 MCP |
| 响应式编辑器布局 | `node scripts/cdp-verify-mobile-panes.mjs 4128 9728` | 1536/1280px 三栏、1100/960/768/700px 编辑 + 预览两栏、320/390/430px 单面板；每档无横向滚动与被裁切 / 重叠的顶栏控件（手机是顶栏里的模式胶囊，不再有单独模式行）；768px 抽屉可开可关（按钮 / Esc / 点外部）、内容与宽屏右栏一致（含模式专属的「主题 / 模板」标签）、关闭再开保留标签页、封面大标题可见；切面板后正文 / 光标 / 滚动 / 上传不丢；复制 / 导入 / 裁切上传真实完成；弹窗、中英文、明暗主题（从「设置」标签切换）、触控与键盘、软键盘视口收缩；按档位截图并生成 index.html |
| 素材接口失败 / 引用未知 | `node scripts/cdp-verify-materials-states.mjs 4120 9720` | 用量、孤儿判定、图片列表分别失败与同时离线；重试恢复、后台刷新失败保留过期数据、本机草稿引用读取失败、真实空素材、单图删除失败保留账目；中英文文案 |
| 全主题根容器 | `node --import tsx scripts/cdp-verify-root-gutter.mjs [CDP端口]` | 227 套主题根节点嵌套 1/2/3 层后的真实内容宽度、375px 横向溢出；代表主题截图 |
| AI 写作 / 单篇 MCP | `node scripts/cdp-verify-remote-mcp.mjs 3227 9355` | 三个真实复制动作、匿名授权、SDK 工具与浏览器往返、冲突、隔离、撤销 / 到期、本地重开；更新 README 两态截图 |
| AI 画图表入口 | `node scripts/cdp-verify-ai-diagram.mjs 3228 9356 [输出目录]` | 两个 AI 入口同排、「AI 图表」弹窗的中英文文案与提示词、可见文案保持简短、弹窗只有一个主 well、三张示例图从本地 `public/diagram-examples/` 真实解码且各自链到上游画廊对应锚点（带 alt 与 `rel="noreferrer"`）、两次真实复制（提示词 / Skill 地址）、三个外链（SKILL.md、仓库、英文原版）都带 `rel="noreferrer"`、弹窗不请求 Skill / 模型 / 图床、提示词框未塌陷、界面与示例图注字体实际生效、明暗主题对比度、390px 无横向溢出且弹窗在视口内、打开图表弹窗不改正文、与「AI 帮我写」互不串弹窗且同为一 well 结构；截图为明暗 / 中文 / 英文 / 390px 四张，JSON 与日志写入 `verify-out/ai-diagram/` |
| Mermaid | `node scripts/cdp-verify-diagram.mjs 3203 9347` | fence → PNG → 上传 → 图片 |
| 多图网格 | `node scripts/cdp-verify-gallery.mjs 3221 9353` | 参数、上传前裁切、网格布局、HTML 输出 |
| 轮播复制 / 图片链路 | `node scripts/cdp-verify-carousel-copy.mjs 3232 9362` | 三次整篇复制 payload 逐字节一致、无固定像素宽度结构、URL 绝对可读、GET / HEAD 与并发、滑动几何；设 `MOPAI_CAROUSEL_URLS=<url,url>` 时同一套抓图检查跑在给定公网地址上 |
| 单图上传大小 | `node scripts/cdp-verify-upload-size.mjs 3233 9357` | 松散图弹窗的自动 / 1–5 MB / 原图选项、自动＝2048px、2 MB＝2560px、原图字节一致（sha256）、选择跨上传记忆、超限原图在弹窗里被拦下并提示换档、轮播弹窗不出现该选项 |
| 侧栏单图回填 | `node scripts/cdp-verify-single-slot-upload.mjs 4106 9706 4206` | 侧栏单图占位 / 替换精确回填、同 alt 多占位、自动与手动裁切、多选只传第一张并提示、切稿与上传中文字保留、编辑器工具栏 / 拖入 / 粘贴仍按发起位置新增 |
| 公式就绪 / 复制与 HTML 导出 | `node scripts/cdp-verify-math-readiness.mjs 4113 9713 4213` | MathJax 慢加载、断网、坏公式、改公式、切稿、Mermaid 并存时，复制与干净正文 / 预览页导出先开「发布前检查」；未完成公式与图表不能默认通过，确认后才复制真实 SVG |
| 卡片 /长图公式与图表就绪 | `node scripts/cdp-verify-graphics-gate.mjs 4113 9713 4213` | 卡片与长图在慢 MathJax、坏公式、延迟 Mermaid、Mermaid 失败时按钮禁用、无下载、可见原因与重试；就绪后恢复导出并真的产生下载；证据截图在 `verify-out/graphics-gate/`，独立 `data/audit-a06.db` 与本地图床 |
| 发布前检查 | `node scripts/cdp-verify-publish-preflight.mjs 4127 9727` | 纯文字稿一键通过；空图片位 / 本机内网地址 / 外链地址 / 坏公式 / 未完成图表各自可定位与可定位跳转；提醒需显式勾选、阻断项只能显式绕过；复制用点击那一刻的最新稿件；Markdown 与整包备份不受阻断；慢网、图床报错、切稿、键盘操作与中英文 |

以上入口分别为 [agent](../scripts/cdp-verify-agent.mjs)、[skill](../scripts/verify-agent-skill.mjs)、
[sync](../scripts/cdp-verify-docs-sync.mjs)、[draft-recovery](../scripts/cdp-verify-draft-recovery.mjs)、
[storage-read-failure](../scripts/cdp-verify-storage-read-failure.mjs)、
[body-gating](../scripts/cdp-verify-body-gating.mjs)、
[save-status](../scripts/cdp-verify-save-status.mjs)、[slow-cloud-save](../scripts/cdp-verify-slow-cloud-save.mjs)、[theme-fonts](../scripts/cdp-verify-theme-fonts.mjs)、
[guest-save-guidance](../scripts/cdp-verify-guest-save-guidance.mjs)、
[mobile-panes](../scripts/cdp-verify-mobile-panes.mjs)、
[public-cards](../scripts/cdp-verify-public-cards.mjs)、
[math-readiness](../scripts/cdp-verify-math-readiness.mjs)、
[graphics-gate](../scripts/cdp-verify-graphics-gate.mjs)、
[publish-preflight](../scripts/cdp-verify-publish-preflight.mjs)、
[materials-states](../scripts/cdp-verify-materials-states.mjs)、
[diagram](../scripts/cdp-verify-diagram.mjs)、
[gallery](../scripts/cdp-verify-gallery.mjs)、
[carousel-copy](../scripts/cdp-verify-carousel-copy.mjs)、
[upload-size](../scripts/cdp-verify-upload-size.mjs)、
[ai-diagram](../scripts/cdp-verify-ai-diagram.mjs)、
[single-slot-upload](../scripts/cdp-verify-single-slot-upload.mjs)。
未入云稿件脚本的 mock 图床用应用端口 +100（默认 4201），数据库为本工作树的 `data/audit-r01.db`。
本机正文读取失败脚本的 mock 图床用应用端口 +100（默认 4202），数据库为本工作树的 `data/audit-r02.db`。
游客保存指引脚本的 mock 图床用应用端口 +100（默认 4229），数据库在临时目录；脚本自带应用、Chrome 与下载目录，结果与截图默认写入临时目录，可用第三个参数指定保留目录。
双标签页脚本使用 `data/audit-r04-<时间>.db`，每次运行创建独立数据库，结果与截图默认写入临时目录。
侧栏单图回填脚本的 mock 图床同样用应用端口 +100（默认 4206），数据库为本工作树的 `data/audit-r06.db`。
结果与截图写入 `verify-out/single-slot-upload/`；粘贴 / 拖入使用浏览器合成文件事件，覆盖应用处理与写回，不代表原生操作系统交互已验收。
素材接口失败脚本同样把 mock 图床放在应用端口 +100（默认 4220），数据库为 `data/audit-r20.db`。
响应式布局脚本自带应用、Chrome 与内存 mock 图床（应用端口 +100，默认 4228），数据库在临时目录；
结果与截图默认写入临时目录，第三个参数可指定保留目录（如 `verify-out/layout`），并在其中生成按宽度分组的 `index.html`。
浮动视口宽度用 `Emulation.setDeviceMetricsOverride` 的 `mobile:false`，与 `cdp-verify-i18n.mjs` 的 390px 口径一致；
真机触摸、真实软键盘与横竖屏传感器仍需在设备上复核，脚本只覆盖布局与交互行为。
公式就绪脚本同样把 mock 图床放在应用端口 +100（默认 4213），数据库为 `data/audit-r13.db`。
发布前检查脚本自带应用、Chrome 与内存 mock 图床（应用端口 +100，默认 4227），数据库在临时目录；
它用一个 500 的上传与一个 500 的图片读取来模拟图床故障，截图与 JSON 默认写入临时目录，第三个参数可指定保留目录。
外部图片地址只做「无法在这里验证」的标注，脚本不发起服务端抓取。
脚本当前 Chrome 路径主要按 Windows 环境写定，跨设备先读脚本。
`SKIP` 即使退出码为 0，也不能计作已完成该链路验收。

Remote MCP 脚本设置 `MOPAI_OPENCODE_BIN` 为已安装的 OpenCode 原生可执行文件后，会启动真实 OpenCode
进行 Skill / 读稿 / 改稿三个工具调用；模型响应由本地确定性驱动提供，配置与数据库均在临时目录，
不读取用户模型账号或修改全局 MCP 配置。未设置时该客户端部分明确 `SKIP`，不能当成客户端验收通过。

需要复验已部署的公网版本时，可在 PowerShell 设置：

```powershell
$env:MOPAI_MCP_PUBLIC_URL = 'https://wechat.yoru-and-akari.dev'
$env:MOPAI_OPENCODE_BIN = '<已安装的 OpenCode 原生可执行文件绝对路径>'
node scripts/cdp-verify-remote-mcp.mjs 3227 9355
```

公网模式不启动本地应用或图床，3227 不会被监听，9355 仍是 Chrome CDP 端口。
使用新浏览器 profile / 游客，不读取现有稿件；测试结束撤销测试连接，截图留在 `verify-out/remote-mcp/`，
不覆盖 README 图片。强制到期需要改测试 SQLite，只在自带私有数据库的模式运行；公网模式明确 `SKIP`，
不能把它报告为线上到期测试通过。2026-10-10 已用 OpenCode 1.18.31 完成上述公网往返验收。

## 测试已启动的本地应用

以下脚本不会替你配置完整服务。先按 [配置说明](configuration.md) 起隔离的本地生产应用，
确认端口、密钥、数据库和图床指向测试环境，生产模式 GC 不应碰真实图床。

| 改动范围 | 现有入口与参数 |
|---|---|
| 主题库筛选 / 来源 / 预览 | [cdp-verify-theme-library.mjs](../scripts/cdp-verify-theme-library.mjs)：`node scripts/cdp-verify-theme-library.mjs <url> <key> 9334` |
| 主题库当前稿试排 / 对比 | [cdp-verify-theme-trial.mjs](../scripts/cdp-verify-theme-trial.mjs)：`node scripts/cdp-verify-theme-trial.mjs <url> [CDP端口] [证据目录]`；种一篇带标题 / 表格 / 单图 / 轮播 / 公式的本机稿，核对试排 HTML 与编辑器预览逐字节一致、1–3 套候选不写正文 / 主题、应用后返回保留筛选与滚动、已加载正文不提示缺失、缺失正文回退样稿，并在英文、390px 和明暗模式下复验标题 / 署名对比度、字体、标题与控件不重叠及正文白底 |
| 首次加载体积与分块 | [cdp-measure-initial-load.mjs](../scripts/cdp-measure-initial-load.mjs)：`node scripts/cdp-measure-initial-load.mjs <url> [CDP端口] [输出文件]`；同环境记录入口资源、transfer / decoded 字节、FCP / DCL / load、长任务与编辑器可交互耗时，以及模板库首卡片 / 首预览 / 全部卡片时间 |
| 分块失败与重试 | [cdp-verify-u05-load-failure.mjs](../scripts/cdp-verify-u05-load-failure.mjs)：`node scripts/cdp-verify-u05-load-failure.mjs <url> [CDP端口]`；路由分块被阻断时的可见错误页与重试、当前主题 pack 被阻断时正文不丢且可重试、离线 SPA 导航的错误页与恢复 |
| 字体实际呈现 | [cdp-verify-u05-fonts.mjs](../scripts/cdp-verify-u05-fonts.mjs)：`node scripts/cdp-verify-u05-fonts.mjs <url> [CDP端口]`；Geist / Noto Sans SC 真实可用、导入主题的 Noto Serif SC 在标题实际生效、已移除的 Zen Kaku 不再有 @font-face |
| 嵌套列表层级 / 起始序号 | [cdp-verify-nested-list.mjs](../scripts/cdp-verify-nested-list.mjs)：`node scripts/cdp-verify-nested-list.mjs <url> [CDP端口]` |
| 界面语言 / 反馈表单 | [cdp-verify-i18n.mjs](../scripts/cdp-verify-i18n.mjs)：`node scripts/cdp-verify-i18n.mjs <url> [CDP端口] [mock邮件端口]`；语言切换在右栏「设置」标签的「外观与语言」组里，脚本先经「更多 → 外观与语言」打开该标签；自起 mock 邮件服务，应用需按脚本头部注释配置 `RESEND_*` 指向它；勿对公网运行 |
| 收藏 / References | [cdp-verify-favorites.mjs](../scripts/cdp-verify-favorites.mjs)：`node scripts/cdp-verify-favorites.mjs <url> [CDP端口]`；无需登录 |
| 使用规范 /terms 与侧栏入口 | [cdp-verify-terms.mjs](../scripts/cdp-verify-terms.mjs)：`node scripts/cdp-verify-terms.mjs <url> [CDP端口]`；无需登录 |
| 同步滚动 / 布局变化 | [cdp-verify-scroll-sync.mjs](../scripts/cdp-verify-scroll-sync.mjs)：先读脚本参数；覆盖缩放、换纸、图片变化与往返漂移 |
| 匿名上传与公开访问 | [cdp-verify-public-access.mjs](../scripts/cdp-verify-public-access.mjs)：`node scripts/cdp-verify-public-access.mjs <url> 9335` |
| 编辑器 / 富文本 / 复制 / 图片粘贴 | [cdp-verify-editor-upgrades.mjs](../scripts/cdp-verify-editor-upgrades.mjs)：`node scripts/cdp-verify-editor-upgrades.mjs <url> <key> 9335` |
| 工具栏 / 语义格式刷 / 表格对齐 | [cdp-verify-toolbar.mjs](../scripts/cdp-verify-toolbar.mjs)：`node scripts/cdp-verify-toolbar.mjs <url> <key> 9336`；独立本地生产应用，含工具栏「表格」的按列与整表对齐 |
| 公式与 SVG | [cdp-verify-math.mjs](../scripts/cdp-verify-math.mjs)：`node scripts/cdp-verify-math.mjs <url>`；CDP 固定 9339 |
| 图片操作 / 重裁 / 清除 | [cdp-verify-image-ops.mjs](../scripts/cdp-verify-image-ops.mjs)：`node scripts/cdp-verify-image-ops.mjs <url> <key>`；CDP 固定 9333；另有 [recrop](../scripts/cdp-verify-recrop.mjs)（轮播/网格 9:16、3:4、1:1 的真实上传像素、单图自由裁切与取消） / [resize](../scripts/cdp-verify-resize.mjs)：`node scripts/cdp-verify-resize.mjs <url> [CDP端口]`，1536px 三栏无 820/520 上限、900px 两栏 240/360 下限、拖动与宽度持久化、侧栏折叠开关（已收进「更多」） |
| 导入导出菜单 | [cdp-verify-io-menus.mjs](../scripts/cdp-verify-io-menus.mjs)：本地 URL 固定 `http://127.0.0.1:3202/`，CDP 固定 9337 |
| 导入文件类型与真实文件 | [cdp-verify-import-picker.mjs](../scripts/cdp-verify-import-picker.mjs)：`node scripts/cdp-verify-import-picker.mjs <url> [CDP端口]`；连续切换 Markdown / DOCX / JSON 的 chooser `accept`，并通过同一 input 实际导入三种文件、重复选择 Markdown |
| 大型整包备份 | [cdp-verify-large-backup.mjs](../scripts/cdp-verify-large-backup.mjs)：`node scripts/cdp-verify-large-backup.mjs <url> [CDP端口]`；真实导入 1,000 篇，核对 IndexedDB 正文、刷新恢复，并验证重复 id 不覆盖已有正文 |
| 草稿箱 / 素材 / 回收站 | [cdp-verify-drafts-materials.mjs](../scripts/cdp-verify-drafts-materials.mjs)、[cdp-verify-trash.mjs](../scripts/cdp-verify-trash.mjs)：先读文件确认当前参数与隔离环境 |
| 预览区局部复制 | [cdp-verify-selection-copy.mjs](../scripts/cdp-verify-selection-copy.mjs)：`node scripts/cdp-verify-selection-copy.mjs <url> [key] [CDP端口]`；默认 `http://127.0.0.1:3205/` 与 9338 |
| UI 深色模式 | [cdp-verify-dark-theme.mjs](../scripts/cdp-verify-dark-theme.mjs)：`node scripts/cdp-verify-dark-theme.mjs <url> [key] [CDP端口]`；默认同样 3205，CDP 默认 9339，与公式脚本的固定 9339 相同，勿并发 |
| 首次使用引导 | [cdp-verify-onboarding.mjs](../scripts/cdp-verify-onboarding.mjs)：`node scripts/cdp-verify-onboarding.mjs <url> [CDP端口]`；默认 `http://127.0.0.1:3100`，CDP 默认 9356；无需登录，新浏览器 profile 即首次访客 |
| 编辑器界面重排（顶栏 / 模式入口 / 右栏） | [cdp-verify-ui-modes.mjs](../scripts/cdp-verify-ui-modes.mjs)：`node scripts/cdp-verify-ui-modes.mjs <url> [CDP端口] [输出目录]`；默认 `http://127.0.0.1:3271`、CDP 9397、输出 `verify-out/ui`，连接已启动的应用，自带 Chrome profile 与下载目录 |
| 四处界面小毛病（手机模式胶囊 / 外观与语言 / 存草稿 / 我的模板） | [cdp-verify-ui-nits.mjs](../scripts/cdp-verify-ui-nits.mjs)：`node scripts/cdp-verify-ui-nits.mjs <url> [CDP端口] [输出目录]`；默认同上，连接已启动的应用；迭代截图写入 `verify-out/nits/after/` 并与 `before/` 生成 `verify-out/nits/index.html`；用 `.env` 的 `ACCESS_KEY` 登录，不上传真实图床 |

这几个自起无头 Chrome 的脚本只连接已启动的应用，Chrome 路径同样按 Windows 写定。
`cdp-verify-selection-copy.mjs` 覆盖预览内的真实选区与 Ctrl/⌘+C：`text/html` / `text/plain` 双通道、祖先内联样式随片段保留、选区首尾不被扩大、跨块选择、正文外选区回退浏览器原生复制，以及整篇复制不回归；
折叠选区与端点越界的回退另见 [selection-copy.test.ts](../src/lib/selection-copy.test.ts)。
`cdp-verify-dark-theme.mjs` 覆盖 `akari` / `yoru` 两态：`<html>` 上 `data-theme` 与 `.dark` 的同步、shadcn / Tailwind `dark:` 变体生效（侧栏四格 Tabs——主题或模板、图片、稿件信息、设置——在深色下可读，对比度 ≥ 3:1）；「设置」里的「外观与语言」两行及其语言 / 明暗控件在两套主题下都可见、标签对比度 ≥ 3:1，并留两主题截图。
`cdp-verify-ui-modes.mjs` 覆盖 1536 / 1280 / 960 / 768 / 640 / 390 / 360 七档：顶栏无横向溢出、可见控件不被裁切或重叠，≥960px 稿件名至少容纳八个汉字；手机档的模式入口收成顶栏里的胶囊下拉（列出四种模式；长图可选，动效是原地切换的模式，搭建台嵌在同源 iframe 里，构建里没有搭建台时才是占位，见 [motion.md](motion.md)），不再有单独模式行，390 / 360 正文起点比改前高至少 40px；中英文与公众号 / 卡片两种模式下各档顶栏都不溢出；「更多」列出并真实打开草稿箱 / 素材库 / 导入 / 导出 / 外观与语言 / GitHub / 致谢 / 登录，1280 / 768 / 390 三档都能从「更多 → 外观与语言」打开右栏「设置」并切换语言和明暗；登录后保存状态旁的一键「存草稿」在 1536 / 1280 / 960 / 768 / 640 / 390 / 360 都显示完整中文且不裁切；卡片模板 / 比例 / 配色与公众号主题都实时换预览；公众号模式复制到剪贴板、卡片模式生成全套 ZIP。截图与 `ui-modes.json` 写入输出目录，并生成按宽度分组的 `index.html`。
`cdp-verify-ui-nits.mjs` 覆盖四处小毛病：手机模式胶囊（四种模式、长图不可选、动效可选或在没有搭建台的构建里是占位、390 / 360 高度下降 ≥ 40px）；「更多 → 外观与语言」在 1280 / 768 / 390 打开「设置」且语言与明暗都生效；中文快捷保存按钮在七个宽度下始终是「存草稿」；「我的」模板组内上传两个示例包、管理状态删除一个且选中回退默认、管理状态点模板不切换、空组仍有提示与上传按钮、坏文件的报错留在组内、全右栏只在这一处列出「我的」模板。另核对稿件名输入框的 `text-overflow` 为 `ellipsis`，390 / 360 宽放不下时仍带省略号且顶栏不横向溢出。同时生成改前 / 改后并排的 `verify-out/nits/index.html`。
`cdp-verify-onboarding.mjs` 覆盖首次使用引导：新 profile 自动出现并逐步命中五个锚点、进度与完成 / 跳过 / 关闭三条退出路径都写入本机状态、刷新与窄屏不再自动出现、设置内「重新查看使用引导」可重开、中英文文案、明暗两主题对比度 ≥ 3:1，以及引导关掉后编辑器输入仍实时进入预览；截图留在临时目录。

## 微信后台实测

公众号后台需要登录态，脚本进不去，粘贴之后的行为只能人工在编辑器里核。2026-10-28 在测试号用样例稿
（标题 / 引用卡 / 金句 / 表格 / 列表 / 代码 / 单图 / 轮播 / 网格 / 脚注降级 / 签名）跑过一轮，参考值如下。

| 检查点 | 预期 |
|---|---|
| 粘贴 | 弹「内容结构检测」，把多列块标成溢出风险（#1.4 width），点「继续插入」才入正文 |
| 根容器 | 整宽块的左右边缘同属一组；正文里没有 `padding:0 10px` 残留（编辑器会把根 `<section>` 复制 / 合并） |
| 轮播 / 网格 | 轮播保留 `overflow-x:auto` + `white-space:nowrap`，格子百分比宽度不变；网格格子仍是百分比 `inline-block` |
| 代码 / 表格 | 代码块 `white-space:pre-wrap` 保留；表格仍是 `table` 节点 |
| 图片 | 转存成 `mmbiz.qpic.cn` 后仍保留内联样式与 `width` / `height`；src 微信抓不到时图片被 `display:none` 隐形，不是裂图 |
| 复制嵌套 | 整篇粘进自己末尾：块数翻倍，边缘与 `padding` 残留不变 |
| 保存 → 刷新 | 文档尺寸、字数、块数、边缘、`padding` 残留与保存前一致 |

2026-10-28 的实测数字（同一份样例稿）：粘贴后 `docSize 1418`、1088 字、16 块；保存后刷新完全一致；
自粘贴后 `docSize 2909`、32 块，`padding` 残留仍为 0。
DOM 里每张图旁会多一个无 `src` 的 `<img class="ProseMirror-separator">`，按 `img` 计数要过滤。
同一轮**未覆盖**：撤销 / 重做、原生 Enter 与跨块 Backspace 合并、视频插入、真机预览。

单测与浏览器各有验收层级：逻辑、字符串输出、浏览器交互、微信实际粘贴不能互相替代。
修改真实交互时运行对应现有脚本；涉及微信粘贴体验时照实记录是否在微信编辑器验证。
线上验收、脚本部署、构建哈希与重启检查统一见 [HANDOFF](../HANDOFF.md)。
