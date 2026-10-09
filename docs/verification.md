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
| 稿件同步 | `node scripts/cdp-verify-docs-sync.mjs 3216 9352` | 登录合并、stale save、三种冲突处理、按需正文与草稿箱 |
| Mermaid | `node scripts/cdp-verify-diagram.mjs 3203 9347` | fence → PNG → 上传 → 图片 |
| 多图网格 | `node scripts/cdp-verify-gallery.mjs 3221 9353` | 参数、上传前裁切、网格布局、HTML 输出 |

以上入口分别为 [agent](../scripts/cdp-verify-agent.mjs)、[skill](../scripts/verify-agent-skill.mjs)、
[sync](../scripts/cdp-verify-docs-sync.mjs)、[diagram](../scripts/cdp-verify-diagram.mjs)、
[gallery](../scripts/cdp-verify-gallery.mjs)。脚本当前 Chrome 路径主要按 Windows 环境写定，跨设备先读脚本。
`SKIP` 即使退出码为 0，也不能计作已完成该链路验收。

## 测试已启动的本地应用

以下脚本不会替你配置完整服务。先按 [配置说明](configuration.md) 起隔离的本地生产应用，
确认端口、密钥、数据库和图床指向测试环境，生产模式 GC 不应碰真实图床。

| 改动范围 | 现有入口与参数 |
|---|---|
| 主题库筛选 / 来源 / 预览 | [cdp-verify-theme-library.mjs](../scripts/cdp-verify-theme-library.mjs)：`node scripts/cdp-verify-theme-library.mjs <url> <key> 9334` |
| 收藏 / References | [cdp-verify-favorites.mjs](../scripts/cdp-verify-favorites.mjs)：`node scripts/cdp-verify-favorites.mjs <url> [CDP端口]`；无需登录 |
| 使用规范 /terms 与侧栏入口 | [cdp-verify-terms.mjs](../scripts/cdp-verify-terms.mjs)：`node scripts/cdp-verify-terms.mjs <url> [CDP端口]`；无需登录 |
| 同步滚动 / 布局变化 | [cdp-verify-scroll-sync.mjs](../scripts/cdp-verify-scroll-sync.mjs)：先读脚本参数；覆盖缩放、换纸、图片变化与往返漂移 |
| 匿名上传与公开访问 | [cdp-verify-public-access.mjs](../scripts/cdp-verify-public-access.mjs)：`node scripts/cdp-verify-public-access.mjs <url> 9335` |
| 编辑器 / 富文本 / 复制 / 图片粘贴 | [cdp-verify-editor-upgrades.mjs](../scripts/cdp-verify-editor-upgrades.mjs)：`node scripts/cdp-verify-editor-upgrades.mjs <url> <key> 9335` |
| 工具栏 / 语义格式刷 | [cdp-verify-toolbar.mjs](../scripts/cdp-verify-toolbar.mjs)：`node scripts/cdp-verify-toolbar.mjs <url> <key> 9336`；独立本地生产应用 |
| 公式与 SVG | [cdp-verify-math.mjs](../scripts/cdp-verify-math.mjs)：`node scripts/cdp-verify-math.mjs <url>`；CDP 固定 9339 |
| 图片操作 / 重裁 / 清除 | [cdp-verify-image-ops.mjs](../scripts/cdp-verify-image-ops.mjs)：`node scripts/cdp-verify-image-ops.mjs <url> <key>`；CDP 固定 9333；另有 [recrop](../scripts/cdp-verify-recrop.mjs) / [resize](../scripts/cdp-verify-resize.mjs) |
| 导入导出菜单 | [cdp-verify-io-menus.mjs](../scripts/cdp-verify-io-menus.mjs)：本地 URL 固定 `http://127.0.0.1:3202/`，CDP 固定 9337 |
| 草稿箱 / 素材 / 回收站 | [cdp-verify-drafts-materials.mjs](../scripts/cdp-verify-drafts-materials.mjs)、[cdp-verify-trash.mjs](../scripts/cdp-verify-trash.mjs)：先读文件确认当前参数与隔离环境 |
| 预览区局部复制 | [cdp-verify-selection-copy.mjs](../scripts/cdp-verify-selection-copy.mjs)：`node scripts/cdp-verify-selection-copy.mjs <url> [key] [CDP端口]`；默认 `http://127.0.0.1:3205/` 与 9338 |
| UI 深色模式 | [cdp-verify-dark-theme.mjs](../scripts/cdp-verify-dark-theme.mjs)：`node scripts/cdp-verify-dark-theme.mjs <url> [key] [CDP端口]`；默认同样 3205，CDP 默认 9339，与公式脚本的固定 9339 相同，勿并发 |

两个新脚本都自起无头 Chrome，只连接已启动的应用，Chrome 路径同样按 Windows 写定。
`cdp-verify-selection-copy.mjs` 覆盖预览内的真实选区与 Ctrl/⌘+C：`text/html` / `text/plain` 双通道、祖先内联样式随片段保留、选区首尾不被扩大、跨块选择、正文外选区回退浏览器原生复制，以及整篇复制不回归；
折叠选区与端点越界的回退另见 [selection-copy.test.ts](../src/lib/selection-copy.test.ts)。
`cdp-verify-dark-theme.mjs` 覆盖 `akari` / `yoru` 两态：`<html>` 上 `data-theme` 与 `.dark` 的同步、shadcn / Tailwind `dark:` 变体生效（侧栏 Tabs 在深色下可读，对比度 ≥ 3:1）并留两主题截图。

单测与浏览器各有验收层级：逻辑、字符串输出、浏览器交互、微信实际粘贴不能互相替代。
修改真实交互时运行对应现有脚本；涉及微信粘贴体验时照实记录是否在微信编辑器验证。
线上验收、脚本部署、构建哈希与重启检查统一见 [HANDOFF](../HANDOFF.md)。
