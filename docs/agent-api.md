# Agent API 与客户端

[项目首页](../README.md) · [开发 Agent 入口](../AGENTS.md) · [验证导航](verification.md)

这里是 Agent 调用产品的接口说明。代码事实来源为 [contracts/agent.ts](../contracts/agent.ts)、
[agent-router.ts](../api/agent-router.ts)、[agent-auth.ts](../api/lib/agent-auth.ts) 与
[agent-router.test.ts](../api/agent-router.test.ts)。客户端细则见
[wechat-typesetter/SKILL.md](../skills/wechat-typesetter/SKILL.md)。

## 往返模型与认证

`Agent 推初稿 → 返回 editorUrl → 人在网页精修 → Agent 读回 Markdown`。
浏览器使用 tRPC + Cookie session；Agent 使用 `/api/agent/*` REST + Bearer。
两者共用 `docs` 表，Agent 草稿是网页里的普通稿件；`ACCESS_KEY` 不兼作 API 令牌。
`editorUrl` 指向云端稿件，打开者需要浏览器登录，链接本身不是匿名分享授权。

服务端 `.env` 设置 `AGENT_TOKENS=名字:令牌[:read]`，多项逗号分隔：默认 read + write，
`:read` 只有读取权限；每个 Agent 单独配置。留空时所有 Agent 端点返回 401。
生成令牌可用以下命令，将结果存入本机配置，不写进文档、日志或提交：

```bash
python -c "import secrets,base64;print('mopai_'+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
```

吊销时移除对应配置项并重启应用；不影响其他令牌与已有稿件。
当前实现从环境变量读取令牌并做常量时间比较，没有令牌数据库或管理面板。
`PUBLIC_BASE_URL` 决定返回链接的 origin，留空按请求 origin 推导。
若部署在 Cloudflare Access 后，路径放行与图片公网读取按 [HANDOFF](../HANDOFF.md) 处理。

## 端点

| 方法 | `/api/agent` 下的路径 | 权限 | 行为 |
|---|---|---|---|
| GET | `/whoami` | read | 返回令牌名、scope、服务端时间 |
| GET | `/docs?limit=&offset=&q=&saved=1` | read | 分页摘要列表，不含正文 |
| POST | `/docs` | write | 创建，返回 `id` / `hash` / `editorUrl` |
| GET | `/docs/:id` | read | 读 Markdown、元信息和 `hash` |
| PUT | `/docs/:id` | write | 更新；必须带 `baseHash` 或 `force: true` |
| POST | `/images` | write | multipart 字段 `file`，返回 `ref=img:<key>` 和公网 `url` |
| GET | `/themes` | read | 从 `THEMES` 读取实时主题表 |

Agent 不提供 DELETE；回收站稿件不可见、不可改，返回 404。创建稿件即设 `savedAt=now`，
确保网页精修会自动同步；默认来源为 `agent:<令牌名>`。
正文上限 200 万字符，图片上限 20 MiB，接受 JPEG / PNG / GIF / WebP，以字节头判型。
上传落站长 `ownerId`，不计匿名池；Agent API 不执行浏览器的轮播 / 网格裁切，需先准备同比例图片。

## 并发与失败

`hash` 是正文 sha256 前 16 位。读回后保存该值，改稿时以 `baseHash` 回传；
服务端写入时再次检查，冲突返回 HTTP 409 + `current` 的正文与 hash。
409 需要重新读 / 合并后再决定，不能盲目重试。缺 `baseHash` 且未传 `force:true` 返回 400；
`force:true` 是显式覆盖当前版本，可能覆盖人工精修。

认证失败为 401，合法令牌权限不足为 403；正文 / 图片超限为 413；图床失败给出可诊断错误。
具体 JSON 结构以 contracts / 路由 / 测试为准，冲突响应不是普通成功响应。

## Python 客户端

[skills/wechat-typesetter/](../skills/wechat-typesetter/) 是 Python 3 标准库客户端，可复制进各 harness 的技能目录；
同步时排除已有 `.env`，保留用户配置。令牌设置、环境变量覆盖、掩码输出与退出码见 Skill。

```bash
python skills/wechat-typesetter/scripts/mopai.py set-token mopai_xxx
python skills/wechat-typesetter/scripts/mopai.py push --file draft.md
python skills/wechat-typesetter/scripts/mopai.py get <id> --out draft.md
python skills/wechat-typesetter/scripts/mopai.py update <id> --file draft.md --base-hash <上次返回的hash>
```

本地图片相对路径按 Markdown 文件所在目录解析，同路径只上传一次，引用改写为 `img:<key>`。
单张失败保留原引用，原因进入 `warnings`；稿件推送成功不代表每张图上传成功。
CLI 不带 `--base-hash` 时会先读最新 hash 再写，只保护那一次 GET 与 PUT 之间的竞态；
要保护此前人工修改，应显式使用上一次 push / get 返回的 hash。
真实往返验收使用 [cdp-verify-agent.mjs](../scripts/cdp-verify-agent.mjs)，客户端用
[verify-agent-skill.mjs](../scripts/verify-agent-skill.mjs)，两者自带 mock 图床。
