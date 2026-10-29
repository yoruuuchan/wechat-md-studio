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

## 生产图片来源与重裁

生产内容安全策略允许正文展示本站图片、公开 HTTPS 外链图片，以及裁切 / 图表生成使用的
`data:` / `blob:` 图片。普通 HTTP 外链图片不在支持范围；显式配置的 HTTP `IMG_BASE_URL`
供本地生产验收使用，HTTPS 站点应配置 HTTPS 图床，避免浏览器阻止混合内容。

「重裁」会先请求本站 `/api/img/<key>`，再跟随 302 到 `IMG_BASE_URL` 的图片地址。
因此 `connect-src` 同时允许本站和**该配置的 origin**（协议、主机及端口），不会因为支持
HTTPS 外链图片而允许向任意外站发起脚本请求。更改 `IMG_BASE_URL` 后重启服务，策略随之更新。
脚本、对象和第三方嵌入仍保留各自的限制；本站不提供任意图片 URL 的服务端代理。

跨域取图的每个重定向响应和最终图床都必须满足 CORS。本站图片跳转和自带 Worker 允许公开读取；
替换 Worker 或增加 CDN 时，保留相应的 `Access-Control-Allow-Origin` 响应头，并让最终取图
地址停留在已配置的 origin。图片能在预览中显示，不代表它一定可以由 `fetch` 取回重裁。
未配置、图片不存在、图床离线、CSP 或 CORS 拒绝时，重裁会显示「取回原图失败」；HTTP 错误附带
状态码，网络错误结合浏览器控制台的 CSP / CORS 信息和图床可达性排查，原正文保留。

真实生产浏览器回归见 [cdp-verify-image-policy.mjs](../scripts/cdp-verify-image-policy.mjs)：
先构建，再运行 `node scripts/cdp-verify-image-policy.mjs 4108 9708 <输出目录>`。
它使用独立数据库、模拟图床和浏览器配置；模拟图床端口是应用端口加 100，输出目录应放在仓库外。

## 基础配置

| 变量 | 当前默认 / 要求 | 用途 |
|---|---|---|
| `NODE_ENV` | 示例文件默认 `production`；**开发时整行删掉，不要写成 `development`** | `production` 开启生产校验与 GC 排程；写进 `.env` 会同时改变前端构建产物 |
| `HOST` | `127.0.0.1` | 服务端监听地址 |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.1/32,::1/128`；显式留空表示直连 | 允许提供 `CF-Connecting-IP` / `X-Real-IP` / `X-Forwarded-For` 的反向代理地址或 CIDR；其他对端的这些头一律忽略 |
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
| `REMOTE_MCP_MAX_ACTIVE_PER_SOURCE` | `20`，整数 1–200 | 同一可信来源同时有效的临时协作连接上限；撤销或到期释放 |
| `REMOTE_MCP_CREATES_PER_SOURCE_PER_DAY` | `40`，整数 ≥ 1 | 同一可信来源每 UTC 日实际新建次数；Cookie 更换、撤销和重启都不重置 |
| `RESEND_API_KEY` / `RESEND_FROM` / `FEEDBACK_TO` | 默认空；三者缺一做反馈接口返回 503 | 站内反馈的邮件转发（Resend）；只存在于服务端配置，页面与接口响应不含这些值 |
| `RESEND_API_URL` | 默认 `https://api.resend.com/emails` | 仅本地端到端测试或自托管时覆盖邮件接口地址；生产不设 |
| `FEEDBACK_PER_MINUTE` / `FEEDBACK_PER_DAY` | `3` / `20`，整数 ≥ 0 | 每来源 IP 的反馈提交上限（内存计数）；拒绝写 `[feedback-deny]` 日志 |

生产启动会拒绝缺失 / 占位 / 过短的必需密钥、缺失 `DATABASE_URL`、非法 URL，以及非整数或越界的数值配置，
错误信息点名变量。生产配置应生成真实密钥；`ACCESS_KEY` 可用 `openssl rand -hex 24`，
`SESSION_SECRET` / `IMG_ADMIN_KEY` 可用 `openssl rand -hex 32`。真实 `.env` 不提交。

## 反向代理与客户端 IP

登录、匿名上传、反馈和 Remote MCP 创建限流都使用同一份“客户端 IP”。服务端先读取 TCP
连接的真实对端，只有对端落在 `TRUSTED_PROXY_CIDRS` 内时才采信转发头。优先级依次是
`CF-Connecting-IP`、`X-Real-IP`、`X-Forwarded-For`；`X-Forwarded-For` 从最靠近服务端的地址
向左查找，并跳过同一信任列表中的代理。空值、非法 IP 和多值冲突会退回真实对端，不会退到
更宽松的转发头。转发链中任一地址非法时整条链不采信。

三种部署按下面配置：

- **Cloudflare Tunnel（当前部署）**：保持 `HOST=127.0.0.1`，默认只信任
  `127.0.0.1/32,::1/128`。Tunnel 从本机连接，Cloudflare 写入的 `CF-Connecting-IP`
  代表真实访客；不要扩大到整个内网或公网。
- **普通反向代理**：只填写代理实际连接服务端所用的地址或最小 CIDR，例如
  `TRUSTED_PROXY_CIDRS=10.0.0.5/32`。代理必须覆盖而不是拼接客户端自带的转发头；
  多级代理要把每一级都对端加入列表，并设置 `PUBLIC_BASE_URL`。
- **直接对外监听**：设置 `TRUSTED_PROXY_CIDRS=`，让服务端忽略所有转发头，直接按 TCP
  对端地址限流。若前面有多台未知代理，不应把它们整体加入信任列表。

没有真实对端元数据时（例如不经过 Node 服务的本地函数测试），身份统一是
`unattributed`，转发头也不会改变这个桶。生产启动会拒绝无法解析的地址或 CIDR。

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

访客张数、访客字节与全局匿名字节走同一套原子预留：额度检查和写入预留发生在同一条 SQLite
事务里，并发请求不会一起穿过检查；上传失败、取消、超时或记账失败会立即释放额度。对象 key
在请求图床之前生成并随预留落库，进程中断留下的预留在 90 秒租约到期后由启动 / 定期清理释放
额度，对象删除确认后才会丢掉记录。`anon_upload_reservations` 表在启动时自动创建，旧数据库
无需手工迁移。

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
