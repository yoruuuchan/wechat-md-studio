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
| Agent API / 编辑器深链 | `node scripts/cdp-verify-agent.mjs 3215 9351` | 推稿、登录跳转、网页精修、读回、图片链路 |
| Python 客户端 | `node scripts/verify-agent-skill.mjs 3219` | CLI、配置、JSON / 退出码、本地图改写；无 Python 时显式 SKIP |
| 稿件同步 | `node scripts/cdp-verify-docs-sync.mjs 3216 9352` | 登录合并、仅改名称同步与刷新、stale save、三种冲突处理、按需正文与草稿箱 |
| 未入云稿件删除 / 撤销 / 回收站 | `node scripts/cdp-verify-draft-recovery.mjs 4101 9701` | 登录前后新稿的删除、立即撤销、撤销期结束后回收站恢复与刷新持久化、彻底删除；云端稿件的撤销 / 回收站；remove / restore 故障注入 |
| 本机正文读取失败 | `node scripts/cdp-verify-storage-read-failure.mjs 4102 9702` | 一次 / 持续 `getAll` 失败、IndexedDB 打开失败、真实缺失正文、云端 stub、主动清空、旧版迁移失败；每项都核对 IndexedDB 原件未被空串覆盖 |
| 双标签页本机保存 | `node scripts/cdp-verify-cross-tab.mjs 4104 9704` | 同稿并发冲突与副本、通知丢失、刷新恢复；不同稿件与同时新建；删除后继续编辑及撤销；事务中断回滚和可见失败 |
| 保存状态与恢复提示 | `node scripts/cdp-verify-save-status.mjs 4126 9726` | 本机提交时间、写失败与重试、切稿和迟到回执、未归档 / 同步中 / 网络失败、首次云端读取失败、冲突副本、撤销恢复、中英文、明暗主题、键盘焦点和窄屏 |
| 游客保存指引 | `node scripts/cdp-verify-guest-save-guidance.mjs 4129 9729` | 匿名保存详情说明本机存储与换浏览器 / 清站点数据的影响、「下载 Markdown」「下载整包备份」两个真实下载动作、站长登录命名、/login 与 /drafts 的"不开放注册"口径、中英文、明暗主题、390px 不横向溢出、退出与已登录深链、AI 提示词复制与匿名单篇 MCP |
| 窄屏单面板编辑器 | `node scripts/cdp-verify-mobile-panes.mjs 4128 9728` | 320/390/430/768/1024px 单面板切换、1440/1600px 三栏可拖拽、无横向滚动与被裁切 / 重叠的顶栏控件；切面板与横竖屏后正文 / 光标 / 滚动 / 上传不丢；复制 / 导入 / 裁切上传真实完成；窄屏弹窗可开可关、中英文与明暗主题、触控尺寸与键盘切换、软键盘高度的视口收缩 |
| 素材接口失败 / 引用未知 | `node scripts/cdp-verify-materials-states.mjs 4120 9720` | 用量、孤儿判定、图片列表分别失败与同时离线；重试恢复、后台刷新失败保留过期数据、本机草稿引用读取失败、真实空素材、单图删除失败保留账目；中英文文案 |
| 全主题根容器 | `node --import tsx scripts/cdp-verify-root-gutter.mjs [CDP端口]` | 219 套主题根节点嵌套 1/2/3 层后的真实内容宽度、375px 横向溢出；代表主题截图 |
| AI 写作 / 单篇 MCP | `node scripts/cdp-verify-remote-mcp.mjs 3227 9355` | 三个真实复制动作、匿名授权、SDK 工具与浏览器往返、冲突、隔离、撤销 / 到期、本地重开；更新 README 两态截图 |
| Mermaid | `node scripts/cdp-verify-diagram.mjs 3203 9347` | fence → PNG → 上传 → 图片 |
| 多图网格 | `node scripts/cdp-verify-gallery.mjs 3221 9353` | 参数、上传前裁切、网格布局、HTML 输出 |
| 轮播复制 / 图片链路 | `node scripts/cdp-verify-carousel-copy.mjs 3232 9362` | 三次整篇复制 payload 逐字节一致、无固定像素宽度结构、URL 绝对可读、GET / HEAD 与并发、滑动几何；设 `MOPAI_CAROUSEL_URLS=<url,url>` 时同一套抓图检查跑在给定公网地址上 |
| 单图上传大小 | `node scripts/cdp-verify-upload-size.mjs 3233 9357` | 松散图弹窗的自动 / 1–5 MB / 原图选项、自动＝2048px、2 MB＝2560px、原图字节一致（sha256）、选择跨上传记忆、超限原图在弹窗里被拦下并提示换档、轮播弹窗不出现该选项 |
| 侧栏单图回填 | `node scripts/cdp-verify-single-slot-upload.mjs 4106 9706 4206` | 侧栏单图占位 / 替换精确回填、同 alt 多占位、自动与手动裁切、多选只传第一张并提示、切稿与上传中文字保留、编辑器工具栏 / 拖入 / 粘贴仍按发起位置新增 |
| 公式就绪 / 复制与 HTML 导出 | `node scripts/cdp-verify-math-readiness.mjs 4113 9713 4213` | MathJax 慢加载、断网、坏公式、改公式、切稿、Mermaid 并存时，复制与干净正文 / 预览页导出先开「发布前检查」；未完成公式与图表不能默认通过，确认后才复制真实 SVG |
| 发布前检查 | `node scripts/cdp-verify-publish-preflight.mjs 4127 9727` | 纯文字稿一键通过；空图片位 / 本机内网地址 / 外链地址 / 坏公式 / 未完成图表各自可定位与可定位跳转；提醒需显式勾选、阻断项只能显式绕过；复制用点击那一刻的最新稿件；Markdown 与整包备份不受阻断；慢网、图床报错、切稿、键盘操作与中英文 |

以上入口分别为 [agent](../scripts/cdp-verify-agent.mjs)、[skill](../scripts/verify-agent-skill.mjs)、
[sync](../scripts/cdp-verify-docs-sync.mjs)、[draft-recovery](../scripts/cdp-verify-draft-recovery.mjs)、
[storage-read-failure](../scripts/cdp-verify-storage-read-failure.mjs)、
[save-status](../scripts/cdp-verify-save-status.mjs)、
[guest-save-guidance](../scripts/cdp-verify-guest-save-guidance.mjs)、
[mobile-panes](../scripts/cdp-verify-mobile-panes.mjs)、
[math-readiness](../scripts/cdp-verify-math-readiness.mjs)、
[publish-preflight](../scripts/cdp-verify-publish-preflight.mjs)、
[materials-states](../scripts/cdp-verify-materials-states.mjs)、
[diagram](../scripts/cdp-verify-diagram.mjs)、
[gallery](../scripts/cdp-verify-gallery.mjs)、
[carousel-copy](../scripts/cdp-verify-carousel-copy.mjs)、
[upload-size](../scripts/cdp-verify-upload-size.mjs)、
[single-slot-upload](../scripts/cdp-verify-single-slot-upload.mjs)。
未入云稿件脚本的 mock 图床用应用端口 +100（默认 4201），数据库为本工作树的 `data/audit-r01.db`。
本机正文读取失败脚本的 mock 图床用应用端口 +100（默认 4202），数据库为本工作树的 `data/audit-r02.db`。
游客保存指引脚本的 mock 图床用应用端口 +100（默认 4229），数据库在临时目录；脚本自带应用、Chrome 与下载目录，结果与截图默认写入临时目录，可用第三个参数指定保留目录。
双标签页脚本使用 `data/audit-r04-<时间>.db`，每次运行创建独立数据库，结果与截图默认写入临时目录。
侧栏单图回填脚本的 mock 图床同样用应用端口 +100（默认 4206），数据库为本工作树的 `data/audit-r06.db`。
结果与截图写入 `verify-out/single-slot-upload/`；粘贴 / 拖入使用浏览器合成文件事件，覆盖应用处理与写回，不代表原生操作系统交互已验收。
素材接口失败脚本同样把 mock 图床放在应用端口 +100（默认 4220），数据库为 `data/audit-r20.db`。
窄屏单面板脚本自带应用、Chrome 与内存 mock 图床（应用端口 +100，默认 4228），数据库在临时目录；
结果与截图默认写入临时目录，第三个参数可指定保留目录（如 `verify-out/u03-mobile-panes`）。
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
| 界面语言 / 反馈表单 | [cdp-verify-i18n.mjs](../scripts/cdp-verify-i18n.mjs)：`node scripts/cdp-verify-i18n.mjs <url> [CDP端口] [mock邮件端口]`；自起 mock 邮件服务，应用需按脚本头部注释配置 `RESEND_*` 指向它；勿对公网运行 |
| 收藏 / References | [cdp-verify-favorites.mjs](../scripts/cdp-verify-favorites.mjs)：`node scripts/cdp-verify-favorites.mjs <url> [CDP端口]`；无需登录 |
| 使用规范 /terms 与侧栏入口 | [cdp-verify-terms.mjs](../scripts/cdp-verify-terms.mjs)：`node scripts/cdp-verify-terms.mjs <url> [CDP端口]`；无需登录 |
| 同步滚动 / 布局变化 | [cdp-verify-scroll-sync.mjs](../scripts/cdp-verify-scroll-sync.mjs)：先读脚本参数；覆盖缩放、换纸、图片变化与往返漂移 |
| 匿名上传与公开访问 | [cdp-verify-public-access.mjs](../scripts/cdp-verify-public-access.mjs)：`node scripts/cdp-verify-public-access.mjs <url> 9335` |
| 编辑器 / 富文本 / 复制 / 图片粘贴 | [cdp-verify-editor-upgrades.mjs](../scripts/cdp-verify-editor-upgrades.mjs)：`node scripts/cdp-verify-editor-upgrades.mjs <url> <key> 9335` |
| 工具栏 / 语义格式刷 | [cdp-verify-toolbar.mjs](../scripts/cdp-verify-toolbar.mjs)：`node scripts/cdp-verify-toolbar.mjs <url> <key> 9336`；独立本地生产应用 |
| 公式与 SVG | [cdp-verify-math.mjs](../scripts/cdp-verify-math.mjs)：`node scripts/cdp-verify-math.mjs <url>`；CDP 固定 9339 |
| 图片操作 / 重裁 / 清除 | [cdp-verify-image-ops.mjs](../scripts/cdp-verify-image-ops.mjs)：`node scripts/cdp-verify-image-ops.mjs <url> <key>`；CDP 固定 9333；另有 [recrop](../scripts/cdp-verify-recrop.mjs)（轮播/网格 9:16、3:4、1:1 的真实上传像素、单图自由裁切与取消） / [resize](../scripts/cdp-verify-resize.mjs) |
| 导入导出菜单 | [cdp-verify-io-menus.mjs](../scripts/cdp-verify-io-menus.mjs)：本地 URL 固定 `http://127.0.0.1:3202/`，CDP 固定 9337 |
| 导入文件类型与真实文件 | [cdp-verify-import-picker.mjs](../scripts/cdp-verify-import-picker.mjs)：`node scripts/cdp-verify-import-picker.mjs <url> [CDP端口]`；连续切换 Markdown / DOCX / JSON 的 chooser `accept`，并通过同一 input 实际导入三种文件、重复选择 Markdown |
| 大型整包备份 | [cdp-verify-large-backup.mjs](../scripts/cdp-verify-large-backup.mjs)：`node scripts/cdp-verify-large-backup.mjs <url> [CDP端口]`；真实导入 1,000 篇，核对 IndexedDB 正文、刷新恢复，并验证重复 id 不覆盖已有正文 |
| 草稿箱 / 素材 / 回收站 | [cdp-verify-drafts-materials.mjs](../scripts/cdp-verify-drafts-materials.mjs)、[cdp-verify-trash.mjs](../scripts/cdp-verify-trash.mjs)：先读文件确认当前参数与隔离环境 |
| 预览区局部复制 | [cdp-verify-selection-copy.mjs](../scripts/cdp-verify-selection-copy.mjs)：`node scripts/cdp-verify-selection-copy.mjs <url> [key] [CDP端口]`；默认 `http://127.0.0.1:3205/` 与 9338 |
| UI 深色模式 | [cdp-verify-dark-theme.mjs](../scripts/cdp-verify-dark-theme.mjs)：`node scripts/cdp-verify-dark-theme.mjs <url> [key] [CDP端口]`；默认同样 3205，CDP 默认 9339，与公式脚本的固定 9339 相同，勿并发 |
| 首次使用引导 | [cdp-verify-onboarding.mjs](../scripts/cdp-verify-onboarding.mjs)：`node scripts/cdp-verify-onboarding.mjs <url> [CDP端口]`；默认 `http://127.0.0.1:3100`，CDP 默认 9356；无需登录，新浏览器 profile 即首次访客 |

这几个自起无头 Chrome 的脚本只连接已启动的应用，Chrome 路径同样按 Windows 写定。
`cdp-verify-selection-copy.mjs` 覆盖预览内的真实选区与 Ctrl/⌘+C：`text/html` / `text/plain` 双通道、祖先内联样式随片段保留、选区首尾不被扩大、跨块选择、正文外选区回退浏览器原生复制，以及整篇复制不回归；
折叠选区与端点越界的回退另见 [selection-copy.test.ts](../src/lib/selection-copy.test.ts)。
`cdp-verify-dark-theme.mjs` 覆盖 `akari` / `yoru` 两态：`<html>` 上 `data-theme` 与 `.dark` 的同步、shadcn / Tailwind `dark:` 变体生效（侧栏 Tabs 在深色下可读，对比度 ≥ 3:1）并留两主题截图。
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
