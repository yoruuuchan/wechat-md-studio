# 推文动效搭建台（/motion/）

[项目首页](../README.md) · [Agent 工作入口](../AGENTS.md) · [验证导航](verification.md)

推文动效搭建台是一个独立的静态页面：在画布上摆元素、排「碰一下之后谁先动」，复制出公众号能用的 SVG 动效。它不属于 React 应用；顶栏的「动效」把它原地嵌进编辑器（同源 iframe，`/motion/?embed=1`），切回公众号文章或小红书卡片时只是隐藏，摆到一半的东西还在。`/motion/` 仍可单独打开，是完整的一页。

## 页面从哪里来

搭建台在仓库之外的项目里开发和构建，本仓库只接收它构建好的静态文件，不提交。

- `npm run build` 的第二步 `npm run pack:motion`（[pack-motion.mjs](../scripts/motion/pack-motion.mjs)）把构建结果复制到 `public/motion/`，Vite 再把它带进 `dist/public/motion/`。`public/motion/` 在 `.gitignore` 里。
- 来源按顺序取第一个存在的：环境变量 `REED_MOTION_SITE` 指向的目录；主 checkout 旁边的 `wechat-motion-lab/out/site`。
- 两处都没有时，这一步删掉旧副本并继续构建。[vite.config.ts](../vite.config.ts) 据此把 `__REED_MOTION__` 设为 `false`，[motion.ts](../src/lib/motion.ts) 返回 `null`，顶栏的「动效」保持「即将推出」的占位。
- 页面必须是搭建台的站点版：没有内联脚本，脚本和字体样式的地址带内容哈希。本站的内容策略是 `script-src 'self'`，带内联脚本的页面会被 `pack:motion` 拒绝。
- `/motion` 由 [boot.ts](../api/boot.ts) 重定向到 `/motion/`，页面按相对地址取自己的脚本、字体和许可文件。

搭建台带的开源素材和字体的许可原文随页面一起发布（`/motion/LICENSE-*.txt`、`/motion/fonts/OFL-NotoSansSC.txt`），页面里「怎么用 → 开源素材和许可」列出每一项。

只有以 `/motion/` 开头的响应允许被本站页面嵌入（`frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN`）；其余路径仍是 `frame-ancestors 'none'` / `DENY`。

## 稿子存在哪里

- 所有人：稿子自动存在浏览器的 `localStorage` 里（键 `wechat-motion-composer:simple`），「稿子 → 存成文件 / 打开文件」导出和读入一份 JSON。
- 站长：登录后，「稿子」里多出云端草稿箱。会话与文章的云端草稿箱相同（[session.ts](../api/session.ts)），不开放注册。

## 云端草稿接口

[motion-drafts-router.ts](../api/motion-drafts-router.ts)，挂在 `/api/motion-drafts`。除 `/session` 外，没有站长会话一律 `401`。所有响应带 `Cache-Control: no-store`。

| 请求 | 作用 |
|---|---|
| `GET /session` | `{ owner: boolean }`，任何人可读；搭建台据此决定显示云端草稿箱还是「站长登录」 |
| `GET /` | `{ items }`：每份的 `id`、`name`、`scenes`（画面数）、`size`、`updatedAt`，新的在前 |
| `POST /` | 存一份新的；请求体 `{ name, body }`，`Content-Type` 必须是 `application/json` |
| `GET /:id` | 元数据加 `body` |
| `PUT /:id` | 用新内容盖掉这一份，`id` 不变 |
| `DELETE /:id` | 删除 |

`body` 是搭建台自己的 JSON 文本。服务端只确认它能解析、带 `format: "reed-motion-draft"`、`doc.scenes` 是非空数组，然后原样保存；画面内容由搭建台在打开时重新规整。覆盖没有版本比对：站长在列表里点中某一行并二次确认后才会覆盖，后写的生效。

限制（[MOTION_DRAFT_LIMITS](../api/motion-drafts-router.ts)）：单份 8 MiB，最多 50 份，合计 100 MiB。超出分别返回 `413 draft_too_large`、`409 too_many_drafts`、`409 quota_exceeded`。

表 `motion_drafts` 由 [connection.ts](../api/queries/connection.ts) 在启动时 `CREATE TABLE IF NOT EXISTS`，旧库无需手工迁移。

## 验证

- 接口：`npx vitest run api/motion-drafts-router.test.ts`（鉴权、账号隔离、存 / 列 / 开 / 覆盖 / 删、校验与三项限制）。
- 顶栏入口：`node scripts/cdp-verify-ui-modes.mjs <url>`，点「动效」原地切换、iframe 里搭建台能画出来、切回文章稿子仍在；构建里没有搭建台时是占位，这些检查跳过并打印一行说明。
- 页面本身（本站内容策略下能运行、按需载入素材表、访客与站长两种「稿子」对话框、存 / 覆盖 / 打开 / 删除）由搭建台项目的 `tool/qa-drafts.mjs <origin> <口令文件>` 对着本地生产构建检查。
