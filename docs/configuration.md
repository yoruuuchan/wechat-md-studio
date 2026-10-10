# 配置与本地运行

[项目首页](../README.md) · [Agent 入口](../AGENTS.md) · [部署与运维](../HANDOFF.md)

配置的事实来源是 [api/lib/env.ts](../api/lib/env.ts)、[env.test.ts](../api/lib/env.test.ts) 和
[.env.example](../.env.example)。本文解释用途；默认值、范围与启动校验以代码为准。

## 本地开发

使用 Node.js 24（当前开发与验收版本，需支持 `node:sqlite`）。命令在含 `package.json` 的目录运行；
本地伞仓库的应用目录是 `app/`，公开仓库直接使用根目录。

```bash
npm ci
cp .env.example .env
npm run dev
```

PowerShell 复制配置用 `Copy-Item .env.example .env`。开发时**删掉 `.env` 里的 `NODE_ENV` 这一行**：
服务端只要不是字面量 `production` 就是开发语义，不用显式写；而 vite 会把 `.env` 的 `NODE_ENV`
当作 React 的编译条件，留着 `development` 就会把开发版 bundle 一路构建出来并部署上线。
默认开发地址是 `http://localhost:3000`，Vite 与 Hono 共用端口。
开发环境允许示例密钥；缺密钥会使用开发默认值并输出 `[env]` 警告。
图片服务未配置或不可达时，上传会明确报错，仍可编辑、预览、复制与导出。
本地上传验收优先使用已有脚本自带的 mock 图床，见 [验证导航](verification.md)。

## 基础配置

| 变量 | 当前默认 / 要求 | 用途 |
|---|---|---|
| `NODE_ENV` | 示例文件默认 `production`；**开发时整行删掉，不要写成 `development`** | `production` 开启生产校验与 GC 排程；写进 `.env` 会同时改变前端构建产物 |
| `HOST` | `127.0.0.1` | 服务端监听地址 |
| `PORT` | `3100` | 生产服务端端口；Vite 开发端口由 `vite.config.ts` 定义 |
| `DATABASE_URL` | 生产必填；示例为 `file:./data/mopai.db` | SQLite；相对路径按进程工作目录解析 |
| `ACCESS_KEY` | 生产必填，至少 16 字符，拒绝公开占位值 | 站长云端草稿箱口令；匿名排版与图片上传不需要它 |
| `SESSION_SECRET` | 生产必填，至少 32 字符，拒绝公开占位值 | 浏览器会话签名 |
| `IMG_BASE_URL` | 可留空；填写时须为绝对 http(s) URL | 图片 Worker；未配置则上传失败 |
| `IMG_ADMIN_KEY` | 生产必填，至少 16 字符，拒绝公开占位值 | 与 Worker secret 一致的上传 / 删除凭证 |
| `PUBLIC_BASE_URL` | 默认取请求 origin；生产反向代理应设公开 HTTPS origin | Agent `editorUrl`、MCP 接入地址及浏览器 Origin 检查的来源 |
| `AGENT_TOKENS` | 默认空，Agent API 全部 401 | `名字:令牌[:read]`，逗号分隔；见 [Agent API](agent-api.md) |
| `STORAGE_QUOTA_BYTES` | `2147483648`（2 GiB） | 登录后素材库显示的用量上限 |
| `REMOTE_MCP_TTL_HOURS` | `24`，整数 1–168 | 单篇 MCP 授权有效期，创建时固定；重新生成令牌不续期 |
| `REMOTE_MCP_TOTAL_BYTES` | `52428800`（50 MiB），整数 ≥ 0 | 全部临时协作正文的 UTF-8 字节硬顶，与匿名图片额度独立 |
| `RESEND_API_KEY` / `RESEND_FROM` / `FEEDBACK_TO` | 默认空；三者缺一做反馈接口返回 503 | 站内反馈的邮件转发（Resend）；只存在于服务端配置，页面与接口响应不含这些值 |
| `RESEND_API_URL` | 默认 `https://api.resend.com/emails` | 仅本地端到端测试或自托管时覆盖邮件接口地址；生产不设 |
| `FEEDBACK_PER_MINUTE` / `FEEDBACK_PER_DAY` | `3` / `20`，整数 ≥ 0 | 每来源 IP 的反馈提交上限（内存计数）；拒绝写 `[feedback-deny]` 日志 |

生产启动会拒绝缺失 / 占位 / 过短的必需密钥、缺失 `DATABASE_URL`、非法 URL，以及非整数或越界的数值配置，
错误信息点名变量。生产配置应生成真实密钥；`ACCESS_KEY` 可用 `openssl rand -hex 24`，
`SESSION_SECRET` / `IMG_ADMIN_KEY` 可用 `openssl rand -hex 32`。真实 `.env` 不提交。

## 匿名额度与回收

| 变量 | 默认 | 含义 |
|---|---|---|
| `ANON_DAILY_IMAGES` | `30` | 每访客滚动 24 小时图片张数 |
| `ANON_DAILY_BYTES` | `104857600`（100 MiB） | 每访客滚动 24 小时字节数 |
| `ANON_TOTAL_BYTES` | `1610612736`（1.5 GiB） | 所有匿名上传合计封顶 |
| `ANON_BURST_PER_MINUTE` | `12` | 每来源 IP 每分钟上传次数，内存计数 |
| `ANON_IP_DAILY_IMAGES` | `100` | 每来源 IP 每 UTC 日上传次数，内存计数 |
| `AUTH_LOGIN_PER_MINUTE` | `10` | 每来源 IP 每分钟登录尝试次数，内存计数 |
| `ANON_GC_DAYS` | `14` | 无云端引用的匿名图回收年龄；`0` 表示无引用即可回收 |
| `ANON_GC_ENABLED` | `true` | 只有字符串 `false` 关闭回收 |

访客身份来自浏览器 Cookie，服务端保存其哈希。回收边界、日志、边缘防护与已接受的取舍见
[HANDOFF](../HANDOFF.md#安全与匿名资源回收)。

## 本地生产模式

先填好生产配置，再 `npm run build`。输出为 `dist/boot.js` 与 `dist/public/`。
POSIX shell 可直接运行 `npm start`；该脚本使用 POSIX 环境变量语法，Windows PowerShell 用：

```powershell
$env:NODE_ENV = 'production'
node dist/boot.js
```

验收使用独立 `PORT`、`DATABASE_URL` 和本地 / mock 图床。生产模式会启动匿名 GC，
`IMG_BASE_URL` 指向真实 Worker 时可删除真实匿名图；本地测试隔离流程见 [HANDOFF](../HANDOFF.md)。
