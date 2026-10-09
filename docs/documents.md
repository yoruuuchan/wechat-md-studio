# 编辑器、稿件与导入导出

[项目首页](../README.md) · [Agent 入口](../AGENTS.md) · [验证导航](verification.md)

事实来源：[EditorPage.tsx](../src/pages/EditorPage.tsx)、[useDocs.ts](../src/hooks/useDocs.ts)、
[store.ts](../src/lib/store.ts)、[body-store.ts](../src/lib/body-store.ts)、
[docs-router.ts](../api/docs-router.ts)、[schema.ts](../db/schema.ts) 及相邻测试。

## 本地与云端保存

| 层 | 写入时机与职责 |
|---|---|
| IndexedDB 正文 + localStorage 索引 / 设置 | 每次改动本地防丢；只缓存已拿到正文的稿件，不把纯元数据 stub 当空正文保存 |
| 云端 SQLite | 登录后，已有 `savedAt` 的稿件编辑后约 900ms 防抖同步 |
| 云端归档 | 点击「保存到草稿箱」设置 `savedAt`；Agent 创建的稿件从一开始就已归档 |

`savedAt=null` 是工作稿，不在草稿箱列表中。一篇稿件只占一条记录，保存更新原记录，没有版本历史。
未登录可编辑、上传、复制与导出，正文仅在本机；口令只解锁站长的云端稿件空间。

旧 `mopai.docs.v1` 会迁入新本地存储，读取与校验成功后才删旧键；失败保留旧数据并重试。
无 IndexedDB 时降级到 localStorage，迁移 / 写入失败进入 `persistenceStatus()`，
UI 显示「本地未存」并提示原因。`mopai.*` 是已有存储协议，改名需要迁移。

## 同步与并发

`docs.hash` 是正文 sha256 前 16 位，浏览器与 Agent 共用 `baseHash` 乐观锁。
服务端 compare-and-swap 更新正文与 hash；时间戳只负责展示，不作为并发依据。
浏览器 stale save 返回冲突与云端当前正文，提供「保留我的 / 用云端的 / 两边都留」。
Agent 更新的 400 / 409 / `force` 语义见 [Agent API](agent-api.md)。

登录合并由 [docs-merge.ts](../src/lib/docs-merge.ts) 定义：

- 本机独有稿件上传成工作稿；云端独有稿件保留 metadata stub，打开后再拉正文。
- 同 id、同内容合并；同 id、不同内容保留云端原 id，本机版另存新 id 并归档，提示用户。
- 云端回收站稿件视为已存在，避免从旧本地缓存复活；旧缓存缺 hash 时按内容补比较。

`docs.save` 是 update-only；新稿走 `saveToDrafts` / `importLocal`，避免删除后迟到的自动保存重新插入稿件。
删除支持撤销与回收站，Agent 无删除入口。对应 [docs-merge.test.ts](../src/lib/docs-merge.test.ts)、
[docs-router.test.ts](../api/docs-router.test.ts)、[cdp-verify-docs-sync.mjs](../scripts/cdp-verify-docs-sync.mjs)。

## 草稿箱与素材库

`/drafts` 按保存时间展示已归档稿件；支持搜索、排序、仅看有图、续写、复制 Markdown、回收站。
卡片字数 / 图片 / 轮播 / 小标题由服务端计算；列表不给全量正文，打开和复制时按需取。

`/materials` 显示用量、最近 200 张图、在用状态与可批量清理的旧图。
登录后引用判定结合云端稿件和当前浏览器 `alsoKeep`；匿名时仅能判断当前浏览器本地稿件。
另一台设备尚未同步的引用服务端看不见，不能把「孤儿」当作全设备已弃用。
匿名图片归属 Cookie 哈希，清除站点数据后无法再列出 / 删除原身份下的图；
正文短引用在对象被删除 / GC 前仍可读取，生命周期见 [渲染与图片](rendering.md)。

## 编辑与导入导出

CodeMirror 的 `Ctrl/⌘ + Space` 与行首触发字符提供方言补全；图片定位使用 occurrence，
同步滚动使用 AST 源行与渲染块偏移。Markdown 输入 / 预览通过 `useDeferredValue` + `useMemo` 解耦。

工具栏与语义格式刷由 [MarkdownToolbar.tsx](../src/components/MarkdownToolbar.tsx) / [md-format.ts](../src/lib/md-format.ts) 提供。
命令是 `(text, selection) → { doc, from, to }` 的纯函数，编辑层通过 CodeMirror dispatch 更新同一份正文；
格式刷复制语义，不复制主题样式。相邻测试与 [工具栏验收](../scripts/cdp-verify-toolbar.mjs) 覆盖该入口。

| 操作 | 当前行为与实现 |
|---|---|
| 富文本粘贴 | [rich-paste.ts](../src/lib/rich-paste.ts) 区分 Markdown、IDE 代码、代码块和图片占位；清理 Office HTML，再用 Turndown 转公众号方言；粘贴的外链图片不自动上传 |
| Markdown 导入 / 导出 | [import-export.ts](../src/lib/import-export.ts) 保留方言与原始正文，导入仅剥 BOM；不做通用 Markdown round-trip |
| DOCX 导入 | 动态加载 mammoth → HTML → 复用 `htmlToDialect`；抽出图片、命名占位后上传 / 回填，失败保留占位并显示张数 |
| 整包备份 | JSON 包含稿件与可选主题 / 署名设置；先 `hydrateAllForExport` 补全所有正文，拉取失败拒绝导出空稿；图片字节不打包，引用仍依赖图床生命周期 |
| HTML 导出 / 复制 | [clipboard.ts](../src/lib/clipboard.ts) 提供干净正文与完整预览页；富文本复制优先 HTML + plain 双通道，失败可改用导出 |

逻辑测试在 [import-export.test.ts](../src/lib/import-export.test.ts)、
[rich-paste.test.ts](../src/lib/rich-paste.test.ts)、[store.test.ts](../src/lib/store.test.ts)；
菜单、复制和真实文件交互按 [验证导航](verification.md) 验收。

## 数据库升级约束

SQLite 使用 Node 内置 `node:sqlite` + Drizzle `sqlite-proxy`。
[connection.ts](../api/queries/connection.ts) 按位置映射行，所以新增列须在 schema 末尾声明，
索引在升级追加列之后建立；每条正文写入路径同时更新 hash。
查询使用普通 `select().limit(1)`，驱动命中 / 未命中契约见
[connection.test.ts](../api/queries/connection.test.ts)、[files-upgrade.test.ts](../api/queries/files-upgrade.test.ts)。
服务端重启、数据文件与真实环境操作由 [HANDOFF](../HANDOFF.md) 维护。
