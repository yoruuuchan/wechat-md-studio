# 芦苇 / Reed：品牌与兼容标识

[中文首页](../README.md) · [English](../README_EN.md) · [Agent 入口](../AGENTS.md)

中文产品名为「芦苇」，英文名为「Reed」，品牌句为「人是一根会思考的芦苇。」。
品牌常量在 [brand.ts](../src/lib/brand.ts)，网页、示例稿、AI 提示词、Skill 和 MCP 工具标题使用当前名称。
仓库 `yoruuuchan/wechat-md-studio` 与现有域名保持不变；Yoru 的作者署名和既有视觉标记继续使用。

## 保留的标识

以下字符串是兼容约定或实际资源名称，文档和命令中保留原值，避免品牌更新改变数据归属、连接或部署目标。

| 标识 | 用途与保留原因 |
|---|---|
| IndexedDB `mopai`、localStorage `mopai.*` | 已有稿件正文、索引、迁移标记、活动稿件、设置、收藏、布局与图表缓存；改键会让现有内容或偏好无法读回 |
| `mopai_sid` / `mopai_vid`、`mopai-visitor:` | 已有登录和游客身份，以及图片 / 单篇 MCP 授权归属；改 Cookie 或哈希前缀会更换身份 |
| `mopai_` / `mopai_mcp_`、`mopai-mcp:` | Agent / MCP 令牌格式与服务端存储的令牌哈希；保持现有令牌有效 |
| `mopai://document/current`、MCP server name `wechat-md-studio` | 已有 MCP 资源 URI 与服务身份；展示标题使用「芦苇 Reed」，工具名和协议不变 |
| `scripts/mopai.py`、`MOPAI_API_URL` / `MOPAI_TOKEN` / `MOPAI_TIMEOUT` | 已有 Python 客户端的调用路径和配置；用户的 Skill 安装与私密 `.env` 可继续使用 |
| `mopai.db`、R2 对象路径 `mopai/…` | 现有数据库位置与图片对象 key；保持文件和公开图片引用可访问 |
| `mopai-worker/`、`mopai-images`、`mopai-assets` | Worker 源目录、已部署服务与存储桶；改部署名称可能创建另一组空资源 |
| `mopai-img.yoru-and-akari.dev` | 现有图片域名；按本次要求保持域名和图片引用不变 |
| `/opt/mopai`、`mopai.service`、`cloudflared-mopai.service`、`/etc/cloudflared/mopai*` | 已有服务用户、目录、systemd 与 Tunnel 配置；本次无需迁移线上数据或基础设施 |
| `/tmp/mopai-*`、部署锁、`MOPAI_*` 运维 / 验收变量 | 运维脚本、已记录发布包与调用方式；锁名统一才能避免两个安装流程同时运行 |
| `__mopaiCodemirror`、`mopai-theme-change` | 现有浏览器验收入口和界面事件约定；对应消费者继续沿用 |
| `mopai-dev-only-*`、测试里的令牌、路径与临时目录前缀 | 开发占位值、生产拒绝名单及兼容测试数据；没有对外品牌含义 |
| 旧版欢迎示例的文本标记 | 仅在本机存储识别和对应测试中保留，用于识别旧稿，避免再次插入示例；不改写用户已保存的正文 |
| 浏览器回归断言中的旧中文名称 | 用作禁止出现的检测词，确保提示词和公开页面使用当前品牌 |

可复制的 MCP 配置现在使用 `reed-current` 作为客户端自选连接名；已配置的旧连接名也能继续调用同一服务。
临时图表 DOM id 和 Python 内部异常 / multipart 名称使用 `reed`，不改变持久化数据或网络契约。
部署交接中的历史发布包、hash、路径与域名变更记录保留事实；当前产品说明使用芦苇。

This update changes the public brand to **Reed / 芦苇**. Legacy identifiers above remain for stored data, authentication, client configuration and deployed resources. No data migration or new environment variables are required.
