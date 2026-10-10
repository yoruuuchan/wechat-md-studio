# Agent 工作入口

适用于 Codex、Claude Code 及其他开发 Agent。先读 [README](README.md)，再按下面的入口定位任务。
本文路径以含 `package.json` 的应用根目录为基准；在本地伞仓库中，该目录是当前 worktree 的 `app/`。

## 项目基线与模块导航

核心链路：`Markdown → 语义 AST → Theme → 微信兼容的全内联 HTML`。
语义解析不携带视觉判断；Theme 消费同一份 AST。预览、复制、正文 HTML 导出共用 `renderDoc` 的结果。
前端为 React + Vite + CodeMirror，服务端为 Hono + tRPC / REST，数据为 SQLite + R2 图片 Worker。

| 模块 | 实现入口与职责 |
|---|---|
| Parser / renderer | [types.ts](src/lib/types.ts)、[parse.ts](src/lib/parse.ts)、[render.ts](src/lib/render.ts)：语义节点、源位置、图号、素材定位、HTML；[clipboard.ts](src/lib/clipboard.ts)：复制和 HTML 导出 |
| Theme system | [theme-kit.ts](src/lib/theme-kit.ts)：Theme 契约、共享构件、样式消毒；[themes.ts](src/lib/themes.ts)：总注册表；[theme-fallbacks.ts](src/lib/theme-fallbacks.ts)：扩展组件；[themes-extra.ts](src/lib/themes-extra.ts)：手写移植；[importer](scripts/themes/import.ts) → [生成目录](src/lib/themes-imported/) |
| Metadata / credits | [theme-meta.ts](src/lib/theme-meta.ts) 定义结构，[theme-sources.ts](src/lib/theme-sources.ts) 注册来源，各 Theme 的 `meta.origin` 引用它；[credits.ts](src/lib/credits.ts) 驱动 [References 页面](src/pages/References.tsx) 与完整致谢；[sources/report.ts](scripts/sources/report.ts) 生成文档区块，许可统一在 `LICENSES/` |
| Editor | [EditorPage.tsx](src/pages/EditorPage.tsx) 编排；[EditorPane.tsx](src/components/EditorPane.tsx)、[PreviewPane.tsx](src/components/PreviewPane.tsx)、[SidePanel.tsx](src/components/SidePanel.tsx) 分工；[MarkdownToolbar.tsx](src/components/MarkdownToolbar.tsx) 调用 [md-format.ts](src/lib/md-format.ts) 的语义变换；[sync-scroll.ts](src/lib/sync-scroll.ts) / [useSyncScroll.ts](src/hooks/useSyncScroll.ts) 负责块映射滚动；[selection-copy.ts](src/lib/selection-copy.ts) 负责预览区局部复制，从用户 Range 保留真实选区，并克隆祖先结构与内联样式直到正文根 `section` |
| UI theme | [ui-theme.ts](src/lib/ui-theme.ts)：应用级浅色 / 深色 / 跟随系统，`yoru` 模式同步设置 `.dark`，是当前 UI theme 切换入口；[ThemeToggle.tsx](src/components/ThemeToggle.tsx) 是各页面里的三态切换控件 |
| Image pipeline | [image.ts](src/lib/image.ts)、[image-compress.ts](src/lib/image-compress.ts)：真实裁切与压缩；[storage-router.ts](api/storage-router.ts) / [storage.ts](api/lib/storage.ts) → [Worker](mopai-worker/src/index.ts)；[math.ts](src/lib/math.ts)、[math-sanitize.ts](src/lib/math-sanitize.ts)、[diagram-raster.ts](src/lib/diagram-raster.ts) 处理公式与图表 |
| Local / cloud documents | [store.ts](src/lib/store.ts) + [body-store.ts](src/lib/body-store.ts)：本机索引与正文；[useDocs.ts](src/hooks/useDocs.ts) + [docs-merge.ts](src/lib/docs-merge.ts)：同步与冲突；[docs-router.ts](api/docs-router.ts)、[schema.ts](db/schema.ts)、[connection.ts](api/queries/connection.ts)：云端保存、表结构与升级 |
| Import / export | [import-export.ts](src/lib/import-export.ts)：Markdown、整包备份、DOCX；[rich-paste.ts](src/lib/rich-paste.ts)：HTML 转公众号方言；文件与 UI 接线在 `EditorPage.tsx` |
| Agent API | [agent-router.ts](api/agent-router.ts)、[agent-auth.ts](api/lib/agent-auth.ts)、[contracts/agent.ts](contracts/agent.ts)；[wechat-typesetter Skill](skills/wechat-typesetter/SKILL.md) 是 Python 客户端入口 |
| AI writing / single-document MCP | [wechat-typesetter Skill](skills/wechat-typesetter/SKILL.md) 同时是写作事实源；[writing-skill.ts](api/lib/writing-skill.ts) 直接嵌入它；[mcp.ts](api/mcp.ts)、[remote-mcp-router.ts](api/remote-mcp-router.ts)、[remote-mcp.ts](api/lib/remote-mcp.ts)、[useRemoteMcp.ts](src/hooks/useRemoteMcp.ts) 负责临时授权、CAS 与浏览器同步 |
| Favorites | [favorites.ts](src/lib/favorites.ts) / [useThemeFavorites.ts](src/hooks/useThemeFavorites.ts)：本机收藏，`mopai.theme-favorites.v1`；主题库与编辑器共用 |
| Verification | [package.json](package.json)、[verify-themes.ts](scripts/verify-themes.ts)、[verify-sources.ts](scripts/verify-sources.ts)、各模块相邻 `*.test.ts`；[验证导航](docs/verification.md) 对应现有浏览器验收脚本 |

## 开工前读取与事实来源

| 任务范围 | 必读资料 |
|---|---|
| 所有任务 | 本文件 + [README](README.md)；先读涉及模块的现有实现和测试，再修改 |
| 部署 / 服务端 / Cloudflare | [HANDOFF](HANDOFF.md)、[配置说明](docs/configuration.md)、涉及的 API / schema / 运维脚本 |
| 主题 / License / attribution | [THEME-SOURCES](THEME-SOURCES.md)、`theme-sources.ts` / `theme-meta.ts`、涉及 Theme 的 `meta.origin`、`credits.ts`、对应许可证副本与 `LICENSES/NOTICE.md` |
| 微信排版 / renderer | [渲染与图片](docs/rendering.md)、`parse.ts` / `render.ts` / `theme-kit.ts`、相关测试、`scripts/verify-themes.ts`；公式另读 `math-sanitize.ts` |
| 保存 / 同步 / 导入导出 | [稿件与编辑器](docs/documents.md)、相关 hooks / API / schema 及其测试 |
| Agent 接入 | [Agent API](docs/agent-api.md)、`contracts/agent.ts`、路由 / 鉴权与客户端实现及验收脚本 |
| AI 写作 / Remote MCP | [AI 写作与 Remote MCP](docs/remote-mcp.md)、现有 Skill、游客 / docs / hash 实现与相邻测试；ChatGPT OAuth 兼容以 `yoruuuchan/chatgpt-mcp-connect` 的已验证实践为事实基线 |
| 复制 / 剪贴板 / 预览选区行为 | `selection-copy.ts`、`PreviewPane.tsx`、`selection-copy.test.ts`、`scripts/cdp-verify-selection-copy.mjs`；整篇复制另见 `clipboard.ts` |
| UI 明暗主题 / shadcn / Tailwind dark variant | `ui-theme.ts`、`ThemeToggle.tsx`、`tailwind.config.js` 的 `darkMode` 与 `src/index.css` 双主题 token、`scripts/cdp-verify-dark-theme.mjs` |
| 使用规范 / 责任边界 | [Terms.tsx](src/pages/Terms.tsx) 与 README 的「使用规范与责任边界」是派生文档：额度读 `api/lib/anon-quota.ts` 与 `api/lib/burst.ts`、回收读 `api/lib/anon-gc.ts`、正文落在哪里读 `src/lib/store.ts` 与 `body-store.ts`。改这些行为时同步两处措辞，只写实现兑现得了的处置 |

实现、schema、测试与验证脚本定义可执行规则；命令以 `package.json` 和脚本参数为准。
主题数量从 `THEMES` 注册表复算。署名事实维护在 sources / metadata / credits，审计依据保存在专项文档与许可证副本。
`BEGIN GENERATED` / `gen:` 区块由 `sync:docs` 生成，`verify:sources` 复核；README 只保留数量与来源摘要，完整致谢进入 NOTICE。
README 只做项目首页；本文件维护工作约束；HANDOFF 记录部署流程与有日期的环境快照，实际环境操作前重新核对。
README 顶部的界面截图存在 `docs/images/`，界面结构（栏数、顶栏动作、模板库布局）变化后重截并同名替换，别只改文案留旧图。
修改事实源后只更新受影响的说明与入口，避免维护多份主题表、署名表或兼容规则清单。

## 核心工程约束

- 延续语义 AST → Theme 的边界和已有测试确认的行为。成熟模块优先复用当前实现，特别是 parser、裁切、富文本转换与上传链路。
- 微信正文输出服从 renderer 与 `verify:themes`：单一根 `section`、内联样式、文字 leaf 包装，图片短引用必须解析。具体标签、样式、公式及比例规则见 [渲染说明](docs/rendering.md) 和验证脚本。
- 主题注册、来源、License 与 attribution 使用现有统一数据源；`themes-imported/` 是生成物，修改 importer 后重生成，保留完整 metadata 与许可副本。
- 保存、同步、图片处理与 Agent API 的失败必须显式、可诊断。保留保存状态、上传警告与冲突结果；`savedAt` 表示归档，内容 hash / `baseHash` 表示并发版本。存储协议、升级与覆盖语义见 [稿件说明](docs/documents.md) 和 [Agent API](docs/agent-api.md)。
- 并行开发使用独立 worktree / branch。开工时确认主线和其他开发线状态；修改 `EditorPage`、Theme 总注册表、schema 等共享入口前确认文件分工与合并顺序。端口、数据库、图床隔离和统一部署流程见 [HANDOFF](HANDOFF.md)。
- 凭证只进被忽略的本机配置或环境变量；验收使用独立数据与 mock / 本地图床。生产发布和真实环境变更按 HANDOFF 执行。

## 验证与完成报告

按改动范围运行相邻测试及 [验证导航](docs/verification.md) 中的对应脚本。项目级完成检查：

```bash
npm run check
npm test
npm run verify:themes
npm run build
```

涉及真实 UI、复制、上传、同步、Agent 往返等行为时，构建后再运行仓库已有的对应浏览器验收：预览局部复制用 `scripts/cdp-verify-selection-copy.mjs`，UI 明暗主题用 `scripts/cdp-verify-dark-theme.mjs`；其余入口见[验证导航](docs/verification.md)。
改主题 / 来源 / 致谢或生成文档时，先 `npm run sync:docs`，再 `npm run verify:sources`。
纯文档调整检查链接、命令、路径和事实一致性；不需要启动线上验收。
报告写明实际修改、运行的验证、结果和尚存在的真实问题；`SKIP` 与未执行不能报成通过。
提交信息用英文，说明变更的目的。
