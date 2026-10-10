# AI 写作与单稿件 Remote MCP

[项目首页](../README.md) · [稿件与编辑器](documents.md) · [验证导航](verification.md)

## 普通用户：AI 帮我写

编辑器左栏的「AI 帮我写」无需登录。复制提示词后补上主题、读者、资料与篇幅，交给自己常用的 AI；
AI 能读链接时发 Skill 地址，不能读链接时复制完整 Skill。最后把 Markdown 粘回编辑器。
页面不选择 AI，也不配置模型 API。

公共地址是 [https://wechat.yoru-and-akari.dev/skill.md](https://wechat.yoru-and-akari.dev/skill.md)。
[writing-skill.ts](../api/lib/writing-skill.ts) 在构建时直接嵌入仓库的
[wechat-typesetter/SKILL.md](../skills/wechat-typesetter/SKILL.md)，公开路由、网页复制和 MCP 读取共用它。
前半部分是可独立使用的写作规则与模板；后半部分保留 Remote MCP、Agent REST / Python 客户端能力。
它不包含任何访问令牌。

## 高级用户：授权当前稿件

1. 打开编辑器右栏「设置」→「高级功能」→「AI 直接编辑当前稿件」。未登录也能使用。
2. 点击「授权当前稿件并创建连接」，复制 MCP 配置，或分别复制地址与 Authorization。
3. 在自己的客户端接入，让 AI 先读写作 Skill、再读当前稿件，修改时回传读取到的 hash。
4. 浏览器保持打开时自动同步 AI 修改；本机输入也同步到临时副本。关闭后再打开同一篇会继续同步。
5. 双方都有未同步的改动时暂停，明确选择「两边都留 / 保留本机版本 / 采用 AI 版本」。
6. 「撤销授权」立即使令牌失效，并删除临时副本；本机完整正文继续保存和编辑。

创建时将当前正文上传到临时服务端副本，授权默认 24 小时。它不是站长的云端草稿箱，也不是公共分享链接。
授权范围固定为创建连接时的游客 + 本地稿件 id，切换编辑器稿件不会改变已发出的令牌范围。
每篇需要单独授权。游客 Cookie 清除、令牌到期或被撤销后，需要重新创建连接。
本机索引保留连接 id 和已确认 hash；原始 Bearer 只保存在当前页面内存，刷新后需重新生成接入信息。
重新生成立即失效旧令牌，不延长授权期限。

## 标准接入信息

| 字段 | 值 |
|---|---|
| URL | `https://wechat.yoru-and-akari.dev/api/mcp` |
| 传输 | Streamable HTTP |
| 请求头 | `Authorization: Bearer <页面创建的单稿件令牌>` |
| 身份 | 单篇临时 Bearer，无需站长口令或 `AGENT_TOKENS` |

使用官方 `@modelcontextprotocol/sdk` 的无状态 HTTP transport。POST 支持 initialize、通知、tools 与 resources；
不保持 SSE 流或会话，GET / DELETE 返回 405。没有有效授权的请求返回 401。
SDK 客户端按 MCP 标准发送 `Accept: application/json, text/event-stream`。
客户端无需发送浏览器 Origin；发送时必须匹配公开站点 origin。

通用 JSON 示例（各客户端字段以其自身配置为准）：

```json
{
  "mcpServers": {
    "mopai-current": {
      "type": "http",
      "url": "https://wechat.yoru-and-akari.dev/api/mcp",
      "headers": { "Authorization": "Bearer <单稿件令牌>" }
    }
  }
}
```

Kimi Code 的 MCP 配置支持 `url` 与 `headers`，可按其配置方式加入上述 server。
OpenCode 使用自己的 `mcp` / `type: remote` 格式：

```json
{
  "mcp": {
    "mopai-current": {
      "type": "remote",
      "url": "https://wechat.yoru-and-akari.dev/api/mcp",
      "headers": { "Authorization": "Bearer <单稿件令牌>" },
      "oauth": false
    }
  }
}
```

Cherry Studio、Qoder、Claude Code 等按自身界面或配置填写 HTTP 地址和请求头。
令牌不放 URL，不写进聊天、截图、仓库或公开日志。

ChatGPT 自定义连接可能额外要求 OAuth。核心 MCP 保持独立；若增加适配，应以
[yoruuuchan/chatgpt-mcp-connect](https://github.com/yoruuuchan/chatgpt-mcp-connect) 的已验证方案为基线，
完整验证 OAuth metadata / DCR / PKCE / token，再验证 initialize、tools/list 和真实工具调用。
本实现没有将 Bearer 接入等同于 ChatGPT 连接器验收。

客户端事实参考：[Kimi Code MCP 文档](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html)、
[OpenCode MCP 文档](https://opencode.ai/docs/mcp-servers/)、
[官方 TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)。

## 工具、资源与并发契约

| 工具 | 参数与结果 |
|---|---|
| `read_writing_skill` | 无参数；返回完整 Skill 文本 |
| `read_current_document` | 无参数；返回 `connection` 与 `doc: {name, content, hash, updatedAt}` |
| `update_current_document` | 完整 `content`、必需 `baseHash`、可选 `name`；成功返回 `{ok:true, doc}` |

资源包括公开 Skill URI 和 `mopai://document/current`。所有工具 / 资源都重新验证当前令牌。
工具没有稿件 id 选择器、列表、删除、上传图片、通用 workspace 或 `force` 入口。
需加图片时在网页上传，再让 AI 保留正文里的 `img:<key>` 短引用。

正文 hash 与已有 Agent API 相同：sha256 前 16 位。更新以读到的 `doc.hash` 作为 `baseHash`，
SQLite 在同一事务里检查版本和授权、执行 CAS 写入。MCP 冲突返回 `isError: true` 与
`{ok:false, error:"conflict", current}`；浏览器 PUT 冲突返回 HTTP 409。
AI 必须重新读稿与合并后再决定，不能拿新 hash 盲目覆盖人工修改。

浏览器每 2 秒检查当前授权稿件，输入约 700ms 后尝试同步。三方比较本机正文 / 名称、已确认版本与服务端版本：
只远端变化时拉取，只本机变化时 CAS 推送，两边变化时提示冲突。每次网络 / hash 等待后重新检查本机输入，
迟到的响应不会盖掉正在输入的正文。网络失败保留本机状态，恢复后重试。
撤销时若最终服务端正文与本机不同，额外保留一篇「AI 版本」，不丢本机正文。

浏览器 Cookie API（同源，`Cache-Control: no-store`）：

| 方法 | `/api/remote-mcp` 下的路径 | 用途 |
|---|---|---|
| POST | `/connections` | `{localDocId,name,content}` 创建；已存在时只读回，不覆盖、不重发旧令牌 |
| GET | `/connections/:localDocId` | 读取此游客的这一篇，失效 / 不存在返回 null |
| PUT | `/connections/:localDocId` | `{connectionId,name,content,baseHash}` CAS 同步 |
| POST | `/connections/:localDocId/rotate` | `{connectionId}` 换令牌，旧令牌立即失效 |
| DELETE | `/connections/:localDocId` | `{connectionId}` 撤销，返回最终副本供本机保留 |

## 数据升级与部署

启动沿用 [connection.ts](../api/queries/connection.ts) 的幂等升级，在现有 SQLite 增加
`remote_mcp_connections` 表与索引，无需手动执行 `db:migrate`，不改变现有 `docs` 列的位置。
临时正文复用 `docs`，`ownerId=0`、独立随机服务端 id、`source=mcp`、`savedAt=null`；
站长 docs / Agent API 只读写 ownerId=1，临时授权副本不会混入站长草稿箱。
访客值沿用 `visitorKey`，令牌仅存 SHA-256 哈希。
撤销在事务内删除授权和正文。到期立即拒绝访问，生产启动及每分钟删除过期副本。

生产应将 `PUBLIC_BASE_URL` 设为公开 HTTPS origin，确保接入地址与浏览器 Origin 验证正确。
新增可选配置 `REMOTE_MCP_TTL_HOURS=24`（1–168）和 `REMOTE_MCP_TOTAL_BYTES=52428800`；
每游客最多 5 条有效连接，全站最多 200 条，创建 / 换令牌每 IP 每分钟最多 10 次。
这些上限与匿名图片额度独立；超额不覆盖现有正文。
`/skill.md` 与 `/api/mcp` 需要边缘可访问，不能被登录墙、HTML challenge 或代理重定向替代。
不需要模型密钥、额外 OAuth secrets 或新域名。

验证入口为 [cdp-verify-remote-mcp.mjs](../scripts/cdp-verify-remote-mcp.mjs)；
相邻测试覆盖 Skill 同源、游客 / 稿件隔离、CAS、撤销、到期、额度与旧数据库升级。
