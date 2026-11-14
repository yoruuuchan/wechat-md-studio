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
| 临时 AI 协作副本 | 明确授权当前稿件后，在同一 SQLite 的 `docs`（`ownerId=0`）中建立独立 id 的临时副本，以 `remote_mcp_connections` 绑定游客与本地稿件；不是草稿箱归档 |

`savedAt=null` 是工作稿，不在草稿箱列表中。一篇稿件只占一条记录，保存更新原记录，没有版本历史。
未登录可编辑、上传、复制、导出与使用 AI 写作提示词，正文默认只在本机；口令只解锁站长的云端稿件空间。
单篇 Remote MCP 是额外的明确授权，临时副本默认 24 小时，撤销或到期不影响本机正文，见 [AI 写作与 Remote MCP](remote-mcp.md)。

旧 `mopai.docs.v1` 会迁入新本地存储，读取与校验成功后才删旧键；失败保留旧数据并重试。
无 IndexedDB 时降级到 localStorage，迁移 / 写入失败进入 `persistenceStatus()`，
UI 显示「本地未存」并提示原因。`mopai.*` 是已有存储协议，改名需要迁移。

顶部保存状态把本机持久化与云端归档分开显示：

- 本机时间只来自正文记录提交成功时写入的 `storedAt`；旧记录没有这个字段时显示“保存时间未记录”，
  不用编辑时间或页面加载时间冒充保存时间。
- 云端状态区分未登录、未归档、读取中、待同步、同步中、已同步、冲突和失败。标题或正文变化后，
  上一次成功版本不能继续点亮“已同步”。
- 本机写入失败保留正文、原因、重试和 Markdown 导出入口；云端失败保留重试入口。冲突可直接打开版本选择。
- 未登录时保存详情额外说明正文只存在当前浏览器：换浏览器、清站点数据或用无痕窗口都会丢失，
  并给出「下载 Markdown」与「下载整包备份」两个明确动作；云端草稿箱属于站长，不开放注册。
  登录入口标注为「站长登录」，退出口径一致；登录后的归档与自动同步维持原状。
- 撤销删除与“两边都留”产生的恢复来源保存在本机正文记录中，刷新后仍可在保存详情中查看。

正文读取失败、索引指向的正文缺失、或 IndexedDB 存在却打不开时，稿件保持「正文未加载」状态：
原件不被空串覆盖，也不参与自动保存；编辑区显示原因与「重试」，读取成功后恢复编辑与保存。
索引指向的正文确实缺失与作者主动清空（正文为 `''`）是两种状态，前者不会被当成空稿保存。
迁移只有在正文写入并读回校验成功后才删除旧键；正文读取失败时迁移暂停，旧键保留。

编辑器把 `contentLoaded` / `bodyState` 折算成同一个 `contentReadable` 状态，作为编辑、改名、复制和单篇
Markdown / HTML 导出的共同前提：云端 stub 显示「正在加载」，`docs.get` 失败显示原因与「重试」，
登出后保留的 stub 显示「需要登录」，本机读取失败 / 正文缺失保留原有诊断与重试；只有正文真的在手里时
CodeMirror 才出现。不可读期间顶栏的复制、改名和单篇导出不可用并给出原因，正文加载成功后自动恢复；
复制和单篇导出在执行前会重新核对当前稿件，避免弹检查窗或异步等待期间状态变化把空稿交出去。
整包备份仍由 `hydrateAllForExport` 负责防丢：登录状态下会先补全云端 stub 再打包，这个状态不替代它；
未登录时它读不到云端正文，行为与改动前一致。

IndexedDB 正文记录还原子保存稿件元数据、本地 revision 与永久删除 tombstone；
localStorage 索引是兼容缓存，不再是正文元数据的唯一来源。多个标签页同时编辑时，
保存事务会重新读取持久化 revision。通知只用来让其他标签页尽快刷新，即使通知丢失，
过期写入也不会直接覆盖新版本；正文冲突会保留原稿并另存「本机版本」副本。
恢复原 id 需要本次操作在请求前读到的本机 revision；这份许可只在内存中保留，
不进入索引、正文记录或整包备份。归档时间与历史恢复标签不能让旧页复活后来的删除，
迟到的恢复响应同样只能保留独立副本。

## 同步与并发

`docs.hash` 是稿件名称与正文共同计算的 sha256 前 16 位，浏览器、Agent 与 Remote MCP
共用 `baseHash` 乐观锁。服务端 compare-and-swap 同时保护名称与正文；
时间戳只负责展示，不作为并发依据。旧数据里的纯正文 hash 仍可作为最后一次 base，
第一次成功写入时会升级为新版本 token。
浏览器 stale save 返回冲突与云端当前正文，提供「保留我的 / 用云端的 / 两边都留」。
Agent 更新的 400 / 409 / `force` 语义见 [Agent API](agent-api.md)。
单篇 MCP 与浏览器也复用稿件 hash / `baseHash` CAS，没有 `force` 写入入口。
本地记录的 `remoteMcp` 只保存连接 id 与已确认版本，不保存 Bearer；它的 `baseHash` 与站长云端同步的 `baseHash` 独立。

登录合并由 [docs-merge.ts](../src/lib/docs-merge.ts) 定义：

- 本机独有稿件上传成工作稿；云端独有稿件保留 metadata stub，打开后再拉正文。
- 同 id、同内容合并；同 id、不同内容保留云端原 id，本机版另存新 id 并归档，提示用户。
- 云端回收站稿件视为已存在，避免从旧本地缓存复活；旧缓存缺 hash 时按内容补比较。
- 本机 `savedAt` 非空、但云端已 purge（列表和回收站都没有）或行在回收站的两条分支，都合并成
  `savedAt=null` 的本机工作稿：正文、名称与显式恢复所需的 `baseHash` 保留，但不登记成已同步版本，
  合并后的保存状态不显示「已同步」。purge 的那份用同一条规范化记录进入 insert-only 上传队列。
- 工作稿不参与普通自动保存，回收站行不会被自动写回；只有用户明确「保存到草稿箱」才恢复 / 归档
  （回收站行走 restore，已 purge 的走 insert），随后在草稿箱与第二台设备可见。
- 合并提示如实说明「正文仍在本机、不在可见草稿箱」，不把尚未确认的上传说成已完成。
- 「保存到草稿箱」途中若稿件已被另一台设备彻底删除，服务端返回 `missing`：本机正文与名称保留，
  `savedAt` / `baseHash` 归零并明确提示需要再保存一次；不自动重新插入（不复活回收站行），
  也不报「已保存到草稿箱」成功。

登录合并（reconcile）完成后导入整包备份，不重跑整库合并：

- 只把本次导入真正新增的 id 交给 `docs.importLocal` 分批上传，每批 `BUNDLE_IMPORT_BATCH_SIZE`（100）篇；
  本机已有的同 id 保留原正文，也不进入上传集合。
- 新上传的是工作稿，`savedAt=null`；本机状态与服务端一致，不把备份里的旧 `savedAt` 当成已归档，
  只有明确「保存到草稿箱」才归档。
- 成功批次回写服务端返回的 hash 作为 `baseHash`，并更新本机已同步基线，界面不误报待同步。
  回写的 hash 与本机按名称 + 正文算出的 hash 不一致，说明这个 id 在服务端属于另一篇内容：
  `importLocal` 保持 insert-only，不覆盖服务端、不丢失本机正文，进入既有冲突处理，autosave 不会静默覆盖。
- 中间批次失败时，已成功批次的状态如实保留，失败稿件正文完整留在本机；界面分开报告本机导入成功数
  与云端成功 / 跳过 / 失败数，并只对未完成项提供重试。

`docs.save` 是 update-only；新稿走 `saveToDrafts` / `importLocal`，避免删除后迟到的自动保存重新插入稿件。
删除按稿件实际所在位置保存可恢复副本，Agent 无删除入口：

- 仅在本机、还没进云端的稿件（登录后新建、两次登录合并之间写的）在登录状态下也进本机回收站，
  删除、撤销与回收站恢复都不依赖网络；已入云稿件走云端软删除，撤销与回收站仍以云端为准。
- `docs.remove` 的 `removed` 回报账号里是否真的移走了一行。没有这一行时客户端保留本机副本，
  避免把唯一一份正文删掉；云端删除成功后也只会放弃名称与正文均已确认同步的本机副本，
  尚未同步的改名或正文仍留在本机回收站，支持撤销与刷新后恢复。云端删除失败时同样保留副本并提示。
- `restore` 先问云端：账号里有这一行就以云端为准解除删除，正文优先用本机最后持有的副本
  （删除前未同步的修改不丢；本机 base 仍匹配云端版本时正常同步，不匹配时清除 base 并进入冲突选择）；
  没有这一行才回退到本机副本。云端恢复失败时保留回收站里的副本并返回失败，正文没有真正回来就不报成功。
  恢复后的「已同步」只依据服务器实际返回的名称与正文；本机恢复了不同的内容时，
  仍显示待同步或冲突，直到后续写入真正成功。
- 回收站列表是本机与云端两条来源的并集，同一 id 只显示一条；彻底删除先删云端行（若存在）再删本机副本。

对应 [docs-merge.test.ts](../src/lib/docs-merge.test.ts)、
[docs-router.test.ts](../api/docs-router.test.ts)、[cdp-verify-docs-sync.mjs](../scripts/cdp-verify-docs-sync.mjs)、
[cdp-verify-draft-recovery.mjs](../scripts/cdp-verify-draft-recovery.mjs)。

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
| 整包备份 | JSON 包含稿件与可选主题 / 署名设置；先 `hydrateAllForExport` 补全所有正文，拉取失败拒绝导出空稿；图片字节不打包，引用仍依赖图床生命周期。单文件上限 64 MiB / 10,000 篇；更大的库需拆包。登录且登录合并（reconcile）完成后，云端导入只把本次真正新增的 id 按每批 100 篇（`BUNDLE_IMPORT_BATCH_SIZE`）交给 `docs.importLocal`，不重跑整库合并；已有 id 保留原正文、不上传，导入的是 `savedAt=null` 工作稿；成功批次回写 hash，同 id 不同内容保持 insert-only 并进入既有冲突处理，失败批次保留本机正文且只重试未完成项。上传与冲突细节见「同步与并发」 |
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

## 预览局部复制

整篇复制仍由 renderer HTML → `copyRichText` 完成。预览内框选后的 Ctrl/⌘+C 由
[selection-copy.ts](../src/lib/selection-copy.ts) 保留选区片段，并克隆祖先内联样式直到文章根 `section`；
不扩大首尾选区，也不展开预览的 `getComputedStyle`。折叠选区或端点在正文外时保留浏览器原生复制。
对应 [selection-copy.test.ts](../src/lib/selection-copy.test.ts) 与 [浏览器验收](../scripts/cdp-verify-selection-copy.mjs)。
