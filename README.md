# 公众号排版助手 by Yoru

把 Markdown 变成**可以直接粘进微信公众号后台**的排版：左侧写稿，右侧实时预览，一键复制富文本。
图片通过图床进入正文，微信粘贴时自行转存。

**[在线使用](https://wechat.yoru-and-akari.dev)** · [主题库](https://wechat.yoru-and-akari.dev/themes) · [开源致谢](https://wechat.yoru-and-akari.dev/references)

开发 Agent 请先读 [AGENTS.md](AGENTS.md)。

## 核心能力

- **<!-- gen:theme-count -->219 套<!-- /gen:theme-count -->主题**：按风格、复杂度、色系与来源筛选，收藏常用模板，同一份样稿比较；每套保留作者、License 与移植来源。
- **公众号 Markdown 方言**：自动编号章节、重点标记、金句卡、引文框、署名、表格、公式、Mermaid 图表。
- **图片与多图布局**：上传、压缩、自动 / 手动真实裁切；支持同比例轮播与 2～4 列网格、素材管理。
- **编辑与保存**：Markdown 工具栏、语义格式刷、375 / 677 预览、语法补全与同步滚动；本机防丢，登录后云端草稿箱与冲突处理。
- **导入导出**：Markdown、DOCX 导入；Markdown、正文 HTML、完整预览页与整包稿件备份导出。
- **Agent 往返**：REST API + Python 客户端推稿、打开网页精修、读回结果，内容 hash 防止静默覆盖。

排版、上传、复制和导出无需登录；口令用于站长云端草稿箱。匿名图片有额度与回收期限，见 [运维说明](HANDOFF.md#安全与匿名资源回收)。

## 核心架构

`Markdown → 语义 AST → Theme → 微信兼容的全内联 HTML`

[parser](src/lib/parse.ts) 只表达语义，[renderer](src/lib/render.ts) 编排节点，[Theme](src/lib/theme-kit.ts) 决定视觉；预览、复制、正文导出共用渲染结果。
React + Vite + CodeMirror 负责编辑；Hono 提供浏览器 tRPC 与 Agent REST API。
IndexedDB / localStorage 保存本机正文与索引，SQLite 保存云端稿件，图片 Worker + R2 承载图片。

## 快速开始

使用 Node.js 24（当前验收版本）。在含 `package.json` 的目录运行；本地伞仓库中先进入 `app/`。

```bash
npm ci
cp .env.example .env
npm run dev
```

PowerShell 复制配置用 `Copy-Item .env.example .env`。开发时将 `.env` 的 `NODE_ENV` 设为 `development`，默认打开 `http://localhost:3000`。
图床配置、生产密钥与启动方式见 [配置与本地运行](docs/configuration.md)。

## 公众号 Markdown 方言

同时支持常规 Markdown 的标题、列表、代码块与 GFM 表格；下面是公众号扩展的速览。

| 语法 | 效果 |
|---|---|
| `==重点==` | 关键词标记 |
| `## KICKER \| 标题` | 自动编号的章节标题 |
| `> 金句` | 金句卡片 |
| `:::quote` / `:::center` … `:::` | 引文框 / 居中强调句 |
| `![图注](src)` | 图片与自动图号；空 `src` 留占位 |
| `:::carousel 4:3 标题` … `:::` | 同比例轮播，默认 `4:3` |
| `:::gallery 3 1:1 标题` … `:::` | 多图网格，默认两列正方形 |
| `$$ … $$` 独占一段 | 块级公式，渲染成内联 SVG |
| ` ```mermaid 图注 ` … ` ``` ` | 图表转 PNG，沿图片链路上传 |
| `@signature` | 署名块 |
| `<!-- 备注 -->` | 源稿编辑备注，不进入正文；围栏代码中照常显示 |
| front matter `titles` / `cover` | 标题候选 / 封面建议，仅进入侧栏 |

完整样稿见 [sample.ts](src/lib/sample.ts)，公式、图表、多图参数与兼容规则见 [渲染与图片](docs/rendering.md)。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地开发 |
| `npm run check` | TypeScript 检查 |
| `npm test` | Vitest 单元与服务端测试 |
| `npm run verify:themes` | 全主题渲染、微信规则、来源与许可文件校验 |
| `npm run verify:sources` | 来源 / 致谢 / 许可数据与生成文档一致性 |
| `npm run build` | 构建 `dist/boot.js` + `dist/public/` |
| `npm start` | 生产服务，需真实配置；PowerShell 启动见配置文档 |

主题重新导入和按功能选择浏览器验收脚本，见 [验证导航](docs/verification.md)。

## License 与来源

项目采用 **AGPL-3.0-or-later**，见 [LICENSE](https://github.com/yoruuuchan/wechat-md-studio/blob/master/LICENSE)。
<!-- BEGIN GENERATED: readme-theme-sources — npm run sync:docs -->
主题库共 **219 套**：3 套自研 + 8 个上游项目的 216 套主题，来源与许可维护在统一 metadata 中。

主题审计见 [THEME-SOURCES](THEME-SOURCES.md)；工程借鉴、取舍与完整致谢由 [credits.ts](src/lib/credits.ts) 驱动 [References](https://wechat.yoru-and-akari.dev/references) 与 [LICENSES/NOTICE](LICENSES/NOTICE.md)。
<!-- END GENERATED: readme-theme-sources -->

## 详细资料

| 入口 | 职责 |
|---|---|
| [AGENTS.md](AGENTS.md) | 开发 Agent 的读取规则、模块导航、工程约束与验证 |
| [HANDOFF.md](HANDOFF.md) | 部署、服务器、Cloudflare、安全机制与环境记录 |
| [THEME-SOURCES.md](THEME-SOURCES.md) | 主题来源、License、lineage、移植损耗与导入审计 |
| [References](https://wechat.yoru-and-akari.dev/references) / [credits.ts](src/lib/credits.ts) / [NOTICE](LICENSES/NOTICE.md) | 统一开源致谢数据、取舍与许可核实记录 |
| [配置](docs/configuration.md) / [验证](docs/verification.md) | 环境变量、本地运行、开发与浏览器验收命令 |
| [渲染与图片](docs/rendering.md) | AST / Theme 边界、微信 HTML、公式、Mermaid、裁切与图片生命周期 |
| [稿件与编辑器](docs/documents.md) | 本地 / 云端保存、合并与冲突、草稿箱、素材库、导入导出 |
| [Agent API](docs/agent-api.md) / [wechat-typesetter Skill](skills/wechat-typesetter/SKILL.md) | REST 接口、认证、覆盖语义与 Python 客户端 |
