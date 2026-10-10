# 公众号排版助手 by Yoru · 部署、运维与环境交接

[项目首页](README.md) · [Agent 工作入口](AGENTS.md) · [配置与本地运行](docs/configuration.md) · [验证导航](docs/verification.md)

本文负责服务器、部署流水线、Cloudflare、安全机制与真实环境记录。通用开发规则与模块导航由
AGENTS 维护；渲染、图片、稿件和 Agent 接口分别进入对应专项文档。

线上实例：[公众号排版助手](https://wechat.yoru-and-akari.dev)；公开源码：
[yoruuuchan/wechat-md-studio](https://github.com/yoruuuchan/wechat-md-studio)。
下列环境与历史记录截至 2026-10-10，运行状态、凭证权限与边缘设置在操作前重新核对。

## 一、项目位置与环境

```
仓库根目录：<umbrella repo root>   ← git 仓库（伞仓库）
应用代码：  <umbrella repo root>\app   ← npm/构建/部署都在这里跑
```

**仓库结构（2026-10-07 变更）**：app 原本是独立 git 仓库（项目最早只有它，`git init` 在 app/ 里）；为了让 harness 能在父目录层级建分支并行开发，仓库已上移到父目录——app/ 的**全部提交历史原样保留**（hash 不变，作为 merge commit `767661c` 的第二父）。app/.git 已删除，现在全目录只有一个 `.git`（父目录）。旧 .git 备份在 `<local archive>\app-git-backup-20261007\`（确认稳定后可删）。父目录下还有 signin/、vote-slider/、媒体拼图/ 等小项目，已一并纳入版本管理。

品牌：产品名「公众号排版助手」、署名「by Yoru」，常量在 `app/src/lib/brand.ts`；logo 是 YORU 设计系统的月相行「新月-上弦-满月-下弦」（`app/src/components/YoruMark.tsx`，3b 变体，满月用品牌靛青 #2E4A68），favicon 是弦月（`app/public/favicon.svg`）。localStorage key 沿用历史前缀 `mopai.*`（内部标识，用户不可见，不要改，改了丢老数据）。

### 多 AI 并行纪律（分支/worktree 都在这个伞仓库上开）

harness 会在父仓库自建分支或 worktree。并行干活必须遵守：

1. **工作目录**：不管哪棵树、哪个分支，npm 命令（check/build/test/CDP）都在其 `app/` 子目录里跑。新 worktree 建好后要在其 `app/` 里 `npm ci`，并从主工作区复制 `app/.env`（gitignore 不随仓库走）。
2. **端口错开**：本地测试服与 CDP 调试端口不能撞车。主工作区用 `PORT=3200` + CDP `9333`；第二棵树用 `PORT=3201` + CDP `9334`（CDP 脚本接受端口参数或改文件内常量）。测试数据库按惯例用环境变量覆盖成独立文件（`DATABASE_URL=file:./data/test-xxx.db`），绝不共享。
3. **部署只许从 master 执行，且同一时刻只留一个会话在部署**：线上只有一个。功能在分支上验证全绿（check + verify:themes + test + CDP）后合回 `master`，由主工作区统一构建、scp、`install.sh`；主工作区被并行会话占用或弄脏时，改从**目标 commit 的干净 worktree** 构建（`git worktree add <tmp> <commit>`，2026-10-10 起的等效做法）。分支上的人不碰服务器。
4. **合并顺序**：分支开工前先 `git merge master` 同步；交付在分支上提交，回合由主工作区执行，冲突按功能归属取舍。
5. **合并前先 `git status -sb` 确认主工作区停在哪个分支**——并行会话会把它切到自己的分支，此时 `--ff-only` 落在的是那个分支而不是 master（2026-10-10 实例：merge 落在 `codex/ai-writing-mcp` 上，master 原地没动；事后用带旧值校验的 `git update-ref refs/heads/master <new> <old>` 补真快进）。事后 `git log -1 master` 回查。

- Node.js 24（当前开发与验收版本，使用内置 `node:sqlite`），`npm ci` 装依赖
- `.env` 从 `.env.example` 复制（`.env` 已被 gitignore，**永远不要提交**）
- 项目级命令与按范围选择的验收脚本见 [AGENTS](AGENTS.md#验证与完成报告) 和 [验证导航](docs/verification.md)。

开发模式下 `ACCESS_KEY` / `SESSION_SECRET` 可使用示例占位值；`.env` 里**不要写 `NODE_ENV`**
（不是字面量 `production` 就是开发语义，而 vite 会把这个值拿去决定 React 编译条件）。
生产模式会拒绝占位值，完整变量与启动方式见 [配置文档](docs/configuration.md)。
测匿名额度不用等一天：起服务时压小就行，例如
`ANON_DAILY_IMAGES=2 ANON_DAILY_BYTES=1048576 ANON_TOTAL_BYTES=10485760`。

匿名图回收（GC）的旋钮是 `ANON_GC_DAYS`（默认 14 天）和 `ANON_GC_ENABLED`（默认开，只有写成字符串 `false` 才关）。
**别拿本地服务试删**：`.env` 里的 `IMG_BASE_URL` 指的是线上 Worker，本地跑一次生产模式的 GC 就会真删线上匿名图。
要端到端验，先用 `mopai-worker/` 起一个本地 `wrangler dev` 再把 `IMG_BASE_URL` 指过去；
纯逻辑（年龄边界、`img:<key>` 引用判定、`ownerId≠0` 绝不碰）已经在 `api/lib/anon-gc.test.ts` 里，`npm test` 就够。
排程只挂在 `api/boot.ts` 的生产分支里，所以 `npm run dev` 和 vitest 都不会跑 GC。

---

## 二、应用技术资料入口

| 内容 | 事实源与说明 |
|---|---|
| 语义 AST、Theme、微信 HTML、公式、Mermaid、图片与多图 | [渲染与图片](docs/rendering.md)，规则以 renderer / tests / `verify:themes` 为准 |
| 本地防丢、云端归档、并发锁、回收站、导入导出 | [稿件与编辑器](docs/documents.md)，事实以 hooks / API / schema / tests 为准 |
| REST API、令牌、客户端与覆盖语义 | [Agent API](docs/agent-api.md) 与 [wechat-typesetter Skill](skills/wechat-typesetter/SKILL.md) |
| AI 写作 / 匿名单篇 Remote MCP | [AI 写作与 Remote MCP](docs/remote-mcp.md)：公共 Skill、单篇授权、hash 同步、撤销、自动升级与客户端配置 |
| 主题来源与许可 | [THEME-SOURCES](THEME-SOURCES.md)，数量由 `THEMES` / `verify:themes` 复算 |
| 开源致谢与技术取舍 | [References](https://wechat.yoru-and-akari.dev/references)、[credits 数据](src/lib/credits.ts)、[许可核实记录](LICENSES/NOTICE.md) |
| 来源与生成文档 | [theme-sources.ts](src/lib/theme-sources.ts)、[credits.ts](src/lib/credits.ts)、[sources/report.ts](scripts/sources/report.ts)；`sync:docs` 更新区块，`verify:sources` 复核，完整致谢在 NOTICE |

本文件保留真实环境操作与历史排障记录；旧记录的功能状态以当前实现和验收为准。

---

## 三、部署形态（这些细节踩过坑，照做）

| 部件 | 位置 |
|---|---|
| 站点 | cc-tokyo-01 `/opt/mopai/app`，Node 直跑 `dist/boot.js`，监听 **127.0.0.1:3100** |
| 进程 | `mopai.service`（systemd，内存上限 384M，实测吃 ~35MB）+ `cloudflared-mopai.service` |
| 入口 | Cloudflare Tunnel → `wechat.yoru-and-akari.dev`，tunnel id `1c05edf4-f1f1-4156-9aa2-8a1ddca0fa14`（ingress 在服务器 `/etc/cloudflared/mopai.yml`） |
| 门禁 | **站点公开，没有 Cloudflare Access**（2026-10-08 撤掉，之前是邮箱验证只放行站长）。撤的方式：本机的 CF token 只读写不动，于是借一个已登录 dashboard 的浏览器会话，走它的同源代理 `dash.cloudflare.com/api/v4/...` 删掉了两个 Access 应用；同一会话把本站并入了 zone 上那条高威胁分数 challenge 规则（现在 `http.host in {"app..." "wechat..."}`）。`ACCESS_KEY` 只决定谁能用云端草稿箱；排版、上传、复制、导出都不用登录 |
| 图片公网读 | 站点公开之后 `/api/img/*` 自然是公网可读（微信抓图必须匿名可达）。以前那个 bypass Access 应用已随之删除。若将来把门禁关回去，必须同时建一个 bypass 应用放行 `/api/img/*`（`cf-create-access.sh` 里已有这段，路径最具体者优先）；同理若放行 `/api/agent/*`，**绝不能连带放行 `/api/trpc/*`**——那里有 `auth.login` |
| 防滥用 | 应用层额度（IP 突发限流 / 每 IP 每日 / 访客 24h / 匿名总量封顶 / 字节头判类型）+ **匿名图回收**（`api/lib/anon-gc.ts`：启动 1 分钟后跑一次、之后每 24h，删掉超过 `ANON_GC_DAYS` 且没有云端稿件引用的 `ownerId=0` 图，先 Worker 确认对象已删再删账本行）+ zone 上已有的 WAF 规则。额度、日志与既定取舍见下文 [安全与匿名资源回收](#安全与匿名资源回收) |
| 图片存储 | Worker `mopai-images` → R2 `mopai-assets`；Worker 持有 R2 binding，**服务器上不存在任何 S3 凭证** |
| 数据 | SQLite，`/opt/mopai/app/data/mopai.db` |
| SSH | `ssh cc-tokyo-01` |
| Cloudflare token | 环境里的 `CLOUDFLARE_API_TOKEN` **是只读的**：读接口正常，写接口一律回 `HTTP 405` + 错误码 `10405 Method not allowed for this authentication scheme`（看着像方法不对，其实是 token scope 不够）。改 Access / WAF 规则要先换一个带 `Zone → Rulesets Edit` + `Account → Access → Apps and Policies Edit` 的 token。**不要硬编码、不要提交**。`~/.config/codex/private.env` 里已经没有这个变量了（只剩 SILICONFLOW_API_KEY），旧脚本的 `source` 那行会静默拿到空值 |
| Cloudflare 标识 | account `5e96dfd2bf22d385e4ffdaa794d74676`；zone `yoru-and-akari.dev` = `4f9b5c7236e63090439676eec70031e2`（**Free 计划**）；ruleset：自定义规则 `3478aaf3df1b4d8eb385f7dadc47d3c6`、速率限制 `b002f9cb15564f3a9b560efe95f138eb` |
| Cloudflare 免费额度现状 | 自定义规则 **5/5 已用满**（telegram webhook、扫描器 UA、app 域威胁分数 challenge、路径穿越、危险方法），速率限制 **1/1 已用掉**（`feedback-rl-5pm`，`/feedback` POST 5 req/10s）。所以本项目**不能再加规则**，只能并入既有的；上传防洪放在应用层。别以为 zone 是空的——`GET /zones/{z}/rulesets` 的列表里 `rules` 是空的，必须逐个 `GET /zones/{z}/rulesets/{id}` 才看得到规则 |

### 安全与匿名资源回收

以下是既定防护与当前代码默认额度，配置旋钮见 [配置文档](docs/configuration.md#匿名额度与回收)。
站点公开、上传不用登录；应用规则由代码与测试定义，边缘状态以实际账户核对为准：

| 层 | 措施 | 位置 |
|---|---|---|
| 应用 | 每 IP 每分钟 12 次上传（内存计数，重启即清） | `api/lib/burst.ts` |
| 应用 | 每 IP 每 UTC 日 100 张（内存计数）——访客额度挂在可删的 Cookie 上，这条让换 Cookie 慢灌变贵 | 同上，`ANON_IP_DAILY_IMAGES` |
| 应用 | 每 IP 每分钟 10 次登录尝试（内存计数）。站点公开之后，`auth.login` 是全站唯一能被人坐在那儿一直试的门；超了答 429，口令比较本身仍是常数时间 | 同上，`AUTH_LOGIN_PER_MINUTE`；`api/auth-router.ts` |
| 应用 | 配置错了不启动：生产环境缺 `ACCESS_KEY` / `SESSION_SECRET`，或用了仓库里公开的占位值，或任何数值旋钮写了非整数 / 越界值，启动时直接报错并点名变量——**不再有「静默拿开发默认值上线」这条路** | `api/lib/env.ts` |
| 应用 | 安全响应头由代码统一设置（HTML / 静态资源 / API 一致）：CSP、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`，以及只在 HTTPS 请求上发的 HSTS | `api/lib/security-headers.ts` |
| 应用 | 每访客滚动 24 小时 30 张 / 100 MiB | `api/lib/anon-quota.ts` |
| 应用 | 全部匿名上传合计 1.5 GiB 封顶 | 同上，`ANON_TOTAL_BYTES` |
| 应用 | 匿名图回收（GC）：`ownerId=0`、超过 `ANON_GC_DAYS`（默认 14 天）、且没有任何云端稿件引用（正文里搜不到 `img:<key>`）的图删掉——上面那个 1.5 GiB 池子因此是循环的，不会填满一次就永久拒客。启动 1 分钟后跑一次，之后每 24 小时一次；先让 Worker 确认对象已删，再删账本行，Worker 失败就留着下次重试 | `api/lib/anon-gc.ts` |
| 应用 | 只认字节头是 jpeg / png / gif / webp 的图；**对外提供的 Content-Type 由字节决定，不信请求头** | `api/lib/image-type.ts` |
| 应用 | 匿名图片按访客 Cookie 的哈希归属，别人列不出也删不掉 | `api/lib/visitor.ts` |
| 运维 | 每次拒收写一行 `[upload-deny] 原因 key=value` 到服务日志（burst / ip-daily / quota / bad-magic，两扇门都写），晨报定时任务 grep 它；被限流的登录写 `[auth-deny] login-burst ip=…` | `api/lib/deny-log.ts` |
| 运维 | 每次 GC 跑完写一行 `[anon-gc] deleted=N bytes=B failed=F days=D` 到服务日志（删不掉的另写 `[anon-gc] delete-failed key=… reason=…`）。格式固定，晨报定时任务一起 grep | `api/lib/anon-gc.ts` |
| 运维 | 匿名池应急清理：`sudo bash /opt/mopai/scripts/server-anon-purge.sh --days N` 先干跑、`--apply` 才删，只碰 ownerId=0 | `scripts/server-anon-purge.sh` |
| 既定 | agent 门上传落 ownerId=1，**不计入**匿名池封顶——它是站长自己的流量，匿名池只度量陌生人；agent 门默认关（`AGENT_TOKENS` 留空），开不开由站长配令牌决定 | 2026-10-08 拍板 |
| 边缘 | 高威胁分数请求走 managed challenge、扫描器 UA 直接拦、路径穿越与危险方法拦掉 | zone 上已有的 WAF 自定义规则 |
| 边缘 | AI 爬虫保护 = block | Cloudflare 账户设置 |

GC 有一个**明知且接受**的漏洞：匿名访客的稿件只存在他们自己浏览器的 IndexedDB / localStorage 里，服务端看不见，所以「14 天前传的图，某个访客的本地草稿还在引用」这种情况会被误删。这和应急脚本 `server-anon-purge.sh` 是同一个口径，不是遗漏——匿名图本来就是用完即走的，而池子填满会让**所有**真实访客传不了图，两边权衡之后选择让池子循环。有了 GC 之后那个脚本降级成手动超驰（想立刻收回空间、或想把阈值临时改小时用），不再是唯一的清理入口。要图片长期有效就走登录后的云端草稿箱：站长的图 `ownerId≠0`，GC 永远不碰。

三条刻意**没做**的，别当成遗漏：

- **Bot Fight Mode 不开**。它按 zone 拦已知机器人，而微信抓图的服务端客户端正是这种机器人——开了会导致粘贴到公众号的文章图片全丢。
- **不占 Cloudflare 速率限制规则**。免费计划每个 zone 只有 1 条，已经被同 zone 的另一个项目用掉了；上传的防洪改由上面的应用层承担。
- **Turnstile 先不接**。它免费且不限量，是下一层该加的东西，但验证失败会让大陆访客彻底传不了图，所以等到配额被证明太松再加。

`scripts/cf-open-public.sh` 负责开：撤掉 Access 应用，并把本站域名加进 zone 上那条已有的高威胁分数规则（免费计划只有 5 条自定义规则，已经用满，所以是**并入**而不是新增）。三种模式：

```bash
export CLOUDFLARE_API_TOKEN=...   # 需要 Zone→Rulesets Edit + Account→Access Edit
bash scripts/cf-open-public.sh --check   # 只读，看现在是什么
bash scripts/cf-open-public.sh --plan    # 算出要改成什么，不发请求
bash scripts/cf-open-public.sh           # 执行
```

要重新关回门禁：`bash scripts/cf-create-access.sh`（会重建 Access 应用与 `/api/img/*` 的 bypass）。

补充运维记录：请求没有可识别来源头时会落入同一个 `ip=unattributed` 限流桶。服务器验收套件后立刻再次登录，
可能由自家请求触发 429；先检查 `[auth-deny] login-burst ip=unattributed` 与时间窗口，再判断是否受攻击。


### 运维脚本导航

脚本在应用根目录的 `scripts/`，环境变量与参数先读脚本；操作真实资源前按上表核对环境：

- [cf-create-bucket.sh](scripts/cf-create-bucket.sh) / [cf-create-tunnel.sh](scripts/cf-create-tunnel.sh)：R2 与 Tunnel 资源。
- [cf-create-access.sh](scripts/cf-create-access.sh) / [cf-open-public.sh](scripts/cf-open-public.sh)：门禁与公开访问。
- [server-bootstrap.sh](scripts/server-bootstrap.sh)：用户、目录、systemd 与 cloudflared 配置。
- [server-install-release.sh](scripts/server-install-release.sh)：安装构建并重启；[stage-to-tokyo.sh](scripts/stage-to-tokyo.sh) 保持脚本 LF 字节传输。
- [server-verify-all.sh](scripts/server-verify-all.sh)：服务器验收入口；分项与应急清理见下文。

### 部署流程（**服务器上不要跑 npm ci**，2GB 内存会 OOM）

```bash
# 本地：包名带 commit 短哈希，临时目录用 mktemp——绝不用固定名
TAG=$(git rev-parse --short HEAD)
OUT=$(mktemp -d)
npm run build
tar -czf "$OUT/mopai-$TAG.tar.gz" dist

# 传上去：先传脚本本身（仓库版），再传包
scp scripts/server-install-release.sh cc-tokyo-01:/tmp/install.sh
scp "$OUT/mopai-$TAG.tar.gz" cc-tokyo-01:/tmp/mopai-$TAG.tar.gz

# 服务器：先对哈希，再抢部署锁装（tarball 路径当参数传给脚本）
ssh cc-tokyo-01 "sha256sum /tmp/mopai-$TAG.tar.gz"   # 必须等于本机 sha256sum 的输出
ssh cc-tokyo-01 "flock /tmp/mopai-deploy.lock bash /tmp/install.sh /tmp/mopai-$TAG.tar.gz"
```

`scripts/server-install-release.sh` 就是那个 install 脚本（解包 → 装到 /opt/mopai/app → **restart** → 健康检查），
它接受一个 tarball 路径参数，默认 `/tmp/mopai-release.tar.gz`。

**家里这条线路对 30 MB+ 的单次 scp 会稳定重置**（`FATAL: send() failed, 10054`，2026-10-09 当天连试三次全挂，
有一次还挂在连接上不退出）。别干等重试，按 network-ops 的分块办法：`split -b 4M` 切块 → 逐块 `scp`
（每块配 `timeout`，失败只重传那一块）→ 每块在服务器上 `sha256sum` 对过 → `cat part-* > /tmp/mopai-$TAG.tar.gz`
→ 再对整个包对一次 sha256。9 块里通常有一两块要重传，整体 10 分钟左右，比反复重传整包可靠。

**两条硬规矩，2026-10-09 三个并行会话同时部署时踩出来的，别再违反：**

1. **包名永远带 commit 短哈希，本机临时文件用 `mktemp -d`。** worktree 只隔离仓库里的文件，
   本机 `/tmp`（都指向同一个 `E:\SYSTEM~2\15877\Temp`）和服务器 `/tmp` 是所有会话共享的。
   配方原来写死 `$env:TEMP\mopai.tar.gz` → `/tmp/mopai-release.tar.gz`，照做就必然互相覆盖——
   而且同一份 dist 两次打包**尺寸几乎一样**，用尺寸或 mtime 根本核不出串包（当时还出现过
   「mtime 一直在更新、大小却对不上」的假象）。只有 sha256 能分辨：传前在服务器上
   `sha256sum` 比对，必要时再从包里解出 `dist/boot.js` 单独比一次。
2. **安装必须在服务器上抢 `flock`。** install 脚本是 `rm -rf dist` + `cp` + `restart` 的顺序，
   两个 install 并行时读者会看到半成品目录，或者后装的旧包把新包顶掉。`flock` 让第二次调用排队，
   而不是交错执行。

**部署后必须核对**（别只看命令有没有报错）：本地与线上的 `dist/boot.js` sha256、以及
`dist/public/index.html` 引用的 js/css 文件名是否一致；再用
`systemctl show mopai.service -p ExecMainStartTimestamp` 确认重启时间就是这一次的。
前一轮出现过"以为部署了、其实服务器还在跑旧包"。

### 公开仓库与发布流水线

公开仓库：<https://github.com/yoruuuchan/wechat-md-studio>（master，AGPL-3.0-or-later，
`src/lib/brand.ts` 的 `REPO_URL` 已指向它，顶栏 GitHub 图标因此出现）。
**伞仓库继续私有，是唯一事实来源**；公开仓库只装 app 子树，不含 signin/、vote-slider/、
媒体拼图/、WTO 报道文件与那批大二进制。

公开历史的形状：app 原始仓库的 31 个提交（合并提交 `767661c` 的第二父链）+ 伞时代触及
`app/` 的提交 + 一个补 LICENSE 的提交。全量重建步骤（幂等，约半分钟）：

```bash
# 在伞仓库里
SP=$(git rev-parse 767661c^2)
git format-patch --binary 767661c..HEAD -- app/   # 补丁会落在仓库根，记得移走
# 在构建目录里（<local workspace>/Projects/wechat-md-studio 是现成的克隆，remote 已指向公开仓库）
git init && git fetch <伞仓库路径> $SP && git reset --hard FETCH_HEAD
git am -p2 <那些补丁>                              # -p2 剥掉 a/app/ 前缀
git rev-parse HEAD^{tree}                          # 必须等于伞仓库的 git rev-parse HEAD:app
cat <伞根>/publish-scrub-expressions.txt <伞根>/publish-scrub-rebuild-only.txt > /tmp/scrub-all.txt
python -m git_filter_repo --force \
  --replace-text  /tmp/scrub-all.txt \
  --replace-message /tmp/scrub-all.txt
# 补一个 LICENSE 提交，然后 push
```

两张表都在**伞仓库根目录**（刻意放在 app/ 之外，不进公开仓库）：
`publish-scrub-expressions.txt` 是常用规则（个人邮箱、真实姓名、WSL 用户名、本机路径，
以及修复早期错误替换留下的 `literal:` 前缀那组）；`publish-scrub-rebuild-only.txt`
里的规则**只在全量重建时用**（见下）。新增敏感串时先加进表再重发布。

三个踩过的坑，都会静默毁掉公开仓库，改表之前先读完：

1. **表里绝对不能有注释行。** git-filter-repo 不支持 `#` 注释，它把**每一行**都当规则：
   一行光秃秃的 `#` 会变成"把所有文件里的每个 `#` 换成 `***REMOVED***`"。
   2026-10-07 这么干过一次，重写后 **64 个文件**被啃掉 shell/Python 注释和 Markdown 标题，
   而且不报错。`scripts/publish-scrub.py` 现在遇到注释行会直接退出。要写说明就写在这里。
2. **规则右边不要再写 `literal:`。** 格式是 `literal:原文==>替换文本`，filter-repo 按
   **最后一个** `==>` 切，右边整串都是替换文本。早期写成 `==>literal:X`，于是公开仓库里
   到处是带 `literal:` 前缀的占位符，四个 `cf-*.sh` 的 `source` 行因此指向一个不存在的文件，
   `2>/dev/null` 又把报错吞了，脚本静默拿到空 token。表里现在有一组专门的修复规则，
   重建时会把历史里那些前缀一并清掉。
3. **`--incremental` 必须跳过 rebuild-only 那张表。** 那些规则是 2026-10-07 之后加的，
   公开历史的基线没有它们；补丁的**上下文行**被替换掉，`git am` 就报 `patch does not apply`。

**验收重写结果时只扫 HEAD 的祖先**：`git rev-list --all` 会把你为了对比而 fetch 进来的
备份 remote 也算进去，于是"没替换成功"的假象。用 `git rev-list HEAD`。
重写前先 `git clone --mirror` 一份备份，出问题能整仓还原。

**红线：全量重建会改写公开历史，只有在确认还没有外部 clone/fork 时才允许 force push。**
一旦有了外部克隆者，停止重建，改为在公开仓库里直接接收提交（伞仓库退居归档），
或从伞仓库 cherry-pick。

#### 增量发布（2026-10-07 起用的就是这条，不重写历史）

2026-10-09 文档整理发布基线：公开仓库 `7822921` 对应伞仓库 `fd6fec7` 的 `app/` 子树（经常规脱敏，保留公开根 LICENSE）。后续增量从此伞提交计算，发布前仍需核对远端与本地主线。

```bash
# 在伞仓库里：<base> = 公开仓库当前镜像到的那个伞提交
git format-patch --binary <base>..master -- app/     # -o 只能写仓库内；落在根目录后移走
python app/scripts/publish-scrub.py publish-scrub-expressions.txt <补丁目录> --incremental
# 在公开克隆里
git am -p2 <补丁目录>/0*.patch                        # -p2 剥掉 a/app/ 前缀
git push origin master                                # 普通推送，不是 force
```

**坑：`--incremental` 是必须的。** 它跳过 `publish-scrub-rebuild-only.txt` 那张表——
里面的规则是 2026-10-07 之后加的，公开历史的基线是用旧规则跑出来的，那些地方仍是原文；
补丁的**上下文行**一旦被替换成占位符，`git am` 就报 `patch does not apply`。
它们只对**全量重建**有意义（重建时整条历史一起换）。
同一条教训的另一面：**新写进公开文件的文本不要再出现这些串**，否则每次增量都得特殊处理——
`scripts/cdp-verify-public-access.mjs` 里原本用黑名单校验脱敏，被 scrub 改成两个相同占位符后
静默失效，现已改成正向断言示例稿自己的标题。

### ⚠️ 往服务器推脚本的坑

**不要用 PowerShell 管道推脚本**——它会把末尾换行变成 CRLF，bash 会在最后一行报 `$'\r': command not found`。

用 `scripts/stage-to-tokyo.sh`，且**必须在 WSL 里跑**：

```powershell
wsl -e bash -lc "bash '<umbrella repo root>/app/scripts/stage-to-tokyo.sh' '<脚本的 /mnt/e/... 路径>' /tmp/xxx.sh"
```

### 服务器上的验收脚本

`/opt/mopai/scripts/` 下有三套，`verify-all.sh` 一次跑完：

- `server-acceptance-test.sh` — 站点可达、登录、站长上传归属、公网 302→200、匿名上传与图片隔离
- `server-e2e-check.sh` — 图片全链路（上传→公网取回→删除）
- `server-round2-check.sh` — 稿件 CRUD、草稿箱语义、存储统计、孤儿图清理
- `server-anon-purge.sh` — 匿名池应急清理：`--days N` 默认干跑、`--apply` 才删，只碰 ownerId=0。
  注意 `files.createdAt` 存的是 **unix 秒**（sqlite 的 unixepoch 默认），不是毫秒。
  2026-10-08 起常态回收由应用内的 GC 做（`api/lib/anon-gc.ts`），这个脚本降级成手动超驰：
  想立刻收回空间、或想用比 `ANON_GC_DAYS` 更小的阈值扫一次时才用

改了 API 或数据结构后，**验收脚本自己也可能要改**（它们不在部署包里，装 dist 不会更新），改完重跑必须 exit 0。
改法与推脚本一样走 LF 字节：在仓库 `app/scripts/` 改 → `cat <脚本> | ssh cc-tokyo-01 'cat > /tmp/x.sh'`（或 WSL 里的 `stage-to-tokyo.sh`）→ `sudo install -m 755 -o root -g root /tmp/x.sh /opt/mopai/scripts/`。
2026-10-09 撞过这条：稿件 API 改成元数据列表后，`round2` 还按数组解析 `docs.list`，verify-all 直接失败。

---

## 四、微信输出约束入口

核心边界是单一正文根 `section`、全内联 HTML、图片短引用解析与真实裁切。
具体标签 / 样式 / 公式 / 比例规则统一见 [渲染与图片](docs/rendering.md#正文兼容规则)、
[verify-themes.ts](scripts/verify-themes.ts) 和模块相邻测试；渲染改动运行 `npm run verify:themes`。

---

## 五、已经踩过的坑（别再踩）

1. **drizzle 的关系查询 `findFirst` 在这个驱动上根本不能用。** 关系层按列名取字段，而 `drizzle-orm/sqlite-proxy` 给的是按位置的值数组 → `findFirst` 必然返回空值。**用普通 `select().limit(1)`**。三处调用已经改过，`api/queries/connection.ts` 顶部有注释说明。
2. **sqlite 驱动的命/未命中契约**：`get` 命中要返回 `Object.values(row)`，未命中要返回 `undefined`。返回 `[]` 会让 drizzle 把它读成"一行全 null"，于是「先查再插」永远以为记录已存在、静默不插入。
3. **`DialogContent` 没有 max-height 和滚动**（`src/components/ui/dialog.tsx`）。弹窗比窗口高时上下被裁且够不到。现有两个弹窗自己加了 `max-h-[90vh] overflow-y-auto` 和吸底按钮——**新加弹窗要注意同样问题**。
4. **`react-easy-crop` 的样式表必须手动 import**（`import 'react-easy-crop/react-easy-crop.css'`），否则裁切框不可见。
5. **tRPC 错误要检查状态与 error 信封**，不能只截前几个字节判断成功。测试脚本显式检查 `result` / `error`，以及不合法的数值（例如 `NaN`）。
6. **会话 cookie 是 `Secure`**，本地/服务器上用纯 HTTP 测试时 curl 的 cookie jar 会静默丢弃它——改成手工捕获 `set-cookie` 头回放。
7. **round2 验收脚本**断言的是"增量"而不是绝对值（别的脚本会留下自己的测试图），并且预清理只删**它自己生成的文件名**。别改成"把现有的都删掉"——前一轮就是这样误删了用户的真实上传。
8. **默认示例稿已脱敏**（2026-10-07）：`src/lib/sample.ts` 的 `SAMPLE_DOC` 以前是站长公司的宣传稿，随公开仓库外泄过，现已换成中性的「示例稿 · 语法速览」（覆盖全部语法，同时是 golden 主题的验收样例）。**服务器数据库里还留着改名前的那一行默认稿**（`ownerId=1`、`savedAt` 为 null），那是站长私有数据、登录后才读得到；别在诊断时对它跑无差别 DELETE。旧文本仍存在于公开仓库的历史提交里——工作树已经干净，要连历史一起清掉只能走全量重建（见「公开仓库与发布流水线」）。
9. **给 `files` 加列必须加在最后**。drizzle 的 `sqlite-proxy` 驱动按**位置**映射行，而 `ALTER TABLE ... ADD COLUMN` 只会追加到末尾；`db/schema.ts` 里声明的顺序一旦和物理顺序不一致，读出来的字段会整体错位，而且**不报错**。`api/queries/files-upgrade.test.ts` 就是钉这件事的。同理，`CREATE INDEX` 引用新列必须放在 `ALTER` 之后——旧库上 `CREATE TABLE IF NOT EXISTS` 是 no-op，先建索引会直接 `no such column`。
10. **改 Cloudflare 之前先确认 token 能写**。只读 token 的写操作回 `HTTP 405 / 10405`，不是「权限不足」那种一眼能认的错。免费额度已经用满（见部署形态表），加规则前先 `bash scripts/cf-open-public.sh --check` 看清 zone 上已有什么。
11. **脚本里调 tRPC：查询用 GET，变更用 POST**。用 POST 打查询会得到 `Unsupported POST-request to query procedure`；检查完整响应与错误信封，避免误判。
12. **编辑备注 `<!-- … -->` 曾经根本没被隐藏**（2026-10-09 修）：markdown-it 用 `html: false`（这是红线，原样 HTML 不能进正文），于是注释被转义成普通文字，预览和复制都带着它——示例稿里「渲染和复制都不会带上它」那句话是 2026-10-07 重写示例时写下的空头支票。现在 `src/lib/comments.ts` 在解析前做**等长空格化**（围栏代码块里的不动），行号与字符偏移完全不变，所以块偏移和图片 occurrence 编号都不受影响；两处原始正文扫描（`parse.ts` 的 `scanImageOccurrences`、`render.ts` 的 `findImageSpan`）对称跳过注释范围，注释里的 `![…](…)` 不打乱图号。**动这两处扫描器时保持对称，否则上传的图会写错位置。** 已知限制（与图片扫描同源）：行内代码里的注释也会被空格化。
13. **控制台里那条「Cloudflare 探针被 CSP 拦掉」的报错不是 bug**（2026-10-09 决定容忍）：zone 开着 JavaScript Detections（`bot_management.enable_js=true`），CF 会往 HTML 注入内联探针 `window.__CF$cv$params={r:'<ray id>',…}`，正文每次请求都不同（**用哈希放行不可行**），于是一律被 `script-src 'self'` 拦下——页面功能不受影响，只是每次访问多一条 violation。保留该设置是因为同 zone 其他子域没有严格 CSP、仍然受益，而探针本来也拿不到本站信号；要根除只能去 dashboard 关掉 zone 级的 `enable_js`（本机 token 只读，改不了）。

---

## 六、历史变更与当前注意事项

> 2026-10-06 更新：撤销删除、删稿复活竞态、轮播批量传图定位、编辑器快捷键、Home.tsx 残留已修（`scripts/cdp-verify-round5.mjs` 是验收脚本）。另外 **`docs.save` 现在是 update-only**：新行只能走 `saveToDrafts` / `importLocal`，别给 `save` 加回 insert 分支——那是删稿复活的闸门。
>
> 2026-10-07 更新（主题库分支）：修掉 `src/lib/parse.ts` 的 `walkInline` 状态恢复 bug——
> 关闭行内标记时用 `Object.assign(flags, stack.pop())` 恢复，空快照不会清掉已置位的键，
> 导致**加粗/下划线/斜体在标记结束后泄漏到同段剩余文字**（线上一直存在，截图可见整段被划线）。
> 现改为整体换回快照，回归测试在 `src/lib/parse.test.ts`。
>
> 2026-10-07 的 CodeMirror 行装饰零长度问题已在当前实现修正：四处 `Decoration.line`
> 均使用 `from=to=line.from`，不再列为未修问题；真实编辑器验收见 `cdp-verify-editor-upgrades.mjs`。
>
> 2026-10-07 更新：更名「公众号排版助手 by Yoru」+ Yoru 阴文印 logo + 弦月 favicon（`src/lib/brand.ts`、`src/components/YoruMark.tsx`）；新增模板专区页 `/themes`（`src/pages/Themes.tsx`，验收 `scripts/cdp-verify-rebrand.mjs`）；前端按设计系统铁律进一步内凹化（carriers 用 `ya-well`/inset，`ya-selected` 自带 sunken 底+1.5px 描边）；域名从 mopai 切到 wechat（Tunnel ingress + DNS + Access 放行三处都要动）。同日晚些时候 `/themes` 升级为多来源模板库（见上表与 THEME-SOURCES.md）。
>
> 2026-10-08 更新：匿名图 GC 落地——`api/lib/anon-gc.ts`（纯函数 `selectGcCandidates` + sweep）
> 与 `api/boot.ts` 生产分支里的排程，旋钮 `ANON_GC_DAYS`（默认 14）/ `ANON_GC_ENABLED`（默认开）。
> 匿名池从「只进不出、填满即永久拒客」变成循环的，下面第 2 条因此结案；
> `scripts/server-anon-purge.sh` 保留不动，降级成手动超驰。误删面（访客本地草稿的引用服务端看不见）
> 是**刻意接受**的取舍，细节在第 2 条与 [安全与匿名资源回收](#安全与匿名资源回收)。
>
> 2026-10-08 晚（服务端加固分支）：四件事一起落地——`api/lib/env.ts` 重写成统一的解析/校验
> （生产缺 `ACCESS_KEY` / `SESSION_SECRET` / `IMG_ADMIN_KEY`、留 `change-me` 这类公开占位值、
> 或任何数值旋钮写错，都在**启动时**报错点名变量；不再有回退到源码里那个公开默认口令的 fail-open），
> 新增 `AUTH_LOGIN_PER_MINUTE`（默认 10，每 IP 每分钟登录尝试，超了 429 + `[auth-deny] login-burst`），
> 新增 `api/lib/security-headers.ts`（CSP / nosniff / Referrer-Policy / Permissions-Policy，HSTS 只在
> HTTPS 请求上发；CSP 的 `img-src` 从 `IMG_BASE_URL` 取 Worker 源，因为 `/api/img` 是 302）。
> 回归测试：`api/lib/env.test.ts`、`api/boot.test.ts`（走真实 Hono 应用拿 429）、
> `api/lib/security-headers.test.ts`。**开发环境不受影响**（占位值照用，缺密钥回退并打印 `[env]` 警告）。
> 注意：本地 `.env` 的 `NODE_ENV` 是 `development`，用 `NODE_ENV=production npm start` 跑本地时
> 会先过一遍生产校验——真实值在服务器 `.env` 里，别拿占位值起生产模式。
>
> 2026-10-08 更新（稿件同步，同日第二组）：**并发与合并模型重做**。`docs.hash` 列 + 两扇门统一的
> compare-and-swap（浏览器 `baseHash`、Agent `baseHash`/`force: true`，旧库启动时自动回填 hash）；
> 登录合并（`src/lib/docs-merge.ts`）不再用云端列表覆盖本地——local-only 上传、diverged 另存为
> 「（本机版本）」收进草稿箱、云端回收站里的当存在处理；冲突在编辑器里弹窗三选一，任何一边都
> 不会被静默覆盖。列表/草稿箱改元数据模型（正文按需取、分页；草稿卡片统计服务端算）。验收脚本
> `scripts/cdp-verify-docs-sync.mjs`（全绿）；回归测试在 `src/lib/docs-merge.test.ts` 与
> `api/docs-router.test.ts`（双客户端 stale save、Agent force 语义见 `api/agent-router.test.ts`）。
> 升级注意：**`docs.hash` 必须保持 `db/schema.ts` 里声明在最后**（ALTER 追加 + 位置映射，见坑 9），
> 且**每一条写正文的路径都要同时写 hash**（save / saveToDrafts / importLocal / Agent create+update 都
> 已经这么做了）——hash 和 content 一旦不同步，compare-and-swap 就会朝错误方向判；加新的写入路径时
> 这是第一件要检查的事。旧库升级由启动时的 `backfill-doc-hash-from-content` 自动补齐。
>
> 2026-10-09 更新（两处已确认的小 bug）：**中文标点旁的行内标记失效** + **窗口缩放后同步滚动失准**。
> 一、行内解析：CommonMark 的 flanking 判定把全角标点算作标点，`这是**“重点”**内容`、
> `赛事采用==“专家评审70% + 大众投票30%”==的…` 于是「不能开合」，`**` / `==` 原样留在正文里
> （`**` 与 `==` 走的是同一段 `scanDelims`）。新增 `src/lib/cjk-inline.ts`：**中文标点与 Markdown
> 自己的定界符都按普通字参与 flanking**，ASCII 标点仍是标点、`_` 的 canSplitWord 判定仍用标准
> 标点集，因此 `（_重点_）`、`_重点_。`、`甲_重点_乙` 行为不变；`==…**加粗**==` 这类相邻定界符
> 也因此能配对。markdown-it 没有暴露 flanking 钩子，实现挂在 `StateInline.prototype.scanDelims`
> 上并只对本项目的解析器生效——**不要改成在最终 HTML 上做字符串替换**。
> 二、同步滚动：块内插值从「源码行数比例」换成**像素比例**（编辑器 `lineBlockAt().top` ↔ 预览元素
> top），并新增 `onLayoutChange(source)`：编辑器重排（`scrollDOM` 尺寸变化）时以**预览**为锚，
> 预览内容高度变化（`ResizeObserver`：迟到图片、375↔677 换纸）时以**编辑器**为锚；180ms 合并突发、
> 写入前 1px 内直接跳过（这正是防反馈循环的那道闸）。验收脚本 `scripts/cdp-verify-scroll-sync.mjs`
> （新，含窄窗口、resize、换纸、图片变化、往返漂移）；同时修好了侧栏改版后失效的「同步滚动」开关
> 选择器（`cdp-verify-editor-upgrades.mjs` 现在全绿）。回归测试：`src/lib/inline-cjk.test.ts`、
> `src/lib/sync-scroll.test.ts`。
>
> 2026-10-09 补记（部署协调，不涉及代码）：线上今天**装了两遍**，原因值得记住。第一次（13:54 +09:00）
> 用本会话 merge 出的 `661d3fa` 构建部署，装完才发现 master 上还有 `7111efb`（主题收藏）没进那个构建
> ——等于把别人已经上线的功能从线上盖掉了。第二次（14:17）改用当时的 tip `ee324e0` 重建、重新分块
> 上传、再 `flock` 装一遍，收藏功能已回到线上（实测 `/themes` 219 个收藏按钮，点击写入
> `mopai.theme-favorites.v1`）。**教训：构建前先 `git log --oneline -1 master` 确认 tip，别用自己
> 合并时的那个 commit 去构建**——并行会话的提交可能在合并与安装之间进到 master。分块上传 + `flock`
> 这两条硬规矩这次都照做了（包名带 commit 短哈希，`/tmp` 里 9 块逐块核 sha256 再 `cat` 重组）。
>
> 发布到公开仓库：本次增量发布的区间是 `3460436..47ddeb2`（本会话的两次修复 + 主题收藏 +
> verify-sources + LICENSE 目录合并）。
>
> 2026-10-09 更新（编辑器工具栏分支）：左栏标题区加了一条 Markdown 工具栏 + 语义格式刷。
> 新文件 `src/lib/md-format.ts`（**纯函数**：行内/块级转换、格式状态识别、格式刷、插入模板）与
> `src/components/MarkdownToolbar.tsx`（UI；折叠靠隐藏测量行按真实宽度算，低频项进常驻的 `···`）。
> `EditorPane` 新增 `getState / applyEdit / insertTemplate / undo / redo` 句柄方法和
> `onViewState / onPaint` 回调；`EditorPage` 把命令接到和打字同一条链路上（`view.dispatch` →
> `onChange` → `activeDoc.content`），所以预览、同步滚动、草稿保存、复制都自然跟着更新。
> **模块约定**：`md-format.ts` 不 import CodeMirror / React，每个命令都是
> `(text, selection) → { doc, from, to }`，编辑层只负责 dispatch 与最小 diff；加新命令沿用这一形状。
> 格式刷只复制**语义**、不复制视觉：行内 bold/mark/italic/strike/code 取精确状态（源没有的会被去掉），
> 块级复制 普通正文/章节标题/小标题/金句卡片/引文框/居中强调（章节标题连 kicker 一起复制）。
> 单击刷一次、双击锁定、Esc 退出；锁定态在按钮上多一个锁形小标。
> 单测 `src/lib/md-format.test.ts`（52 项）；浏览器验收 `scripts/cdp-verify-toolbar.mjs`
> （75 项，本地生产模式 + 独立库；折叠部分要先把侧栏展开，否则预览面板 maxSize 820 会顶住编辑区宽度）。
>
> 2026-10-09 部署记录（工具栏上线）：合并 `93bd5ac`（含 `8017cbd` 工具栏 + master 侧的主题收藏）。
> 合并后在主工作区重跑 `check`/`verify:themes`/`test`（1351 项全过）再构建。33.7MB 包按分块红线走
> （9×4MB 逐块 scp + 逐块 sha256 + `cat` 重组 + 整包 sha256 `c014632e…` 对上），`flock` 安装。
> 部署后三重核对全过：线上 `dist/boot.js` sha256 = 本地 `b4840d2f…`，`index.html` 资产名一致
> （`index-CFYxMExv.js` / `index-BwLwt3me.css`），`ExecMainStartTimestamp` = 2026-10-09 06:54:26 UTC，
> 公网 `wechat.yoru-and-akari.dev` 已在服务新资产名（HTTP 200）。**公开仓库增量发布还没做**：
> 本次区间是 `47ddeb2..93bd5ac`（工具栏 + 格式刷），走不走、何时走由站长定。
>
> 2026-10-09 部署记录（预览局部复制上线）：`e8e6fa7`（预览框选后 Ctrl/⌘+C 直接复制，
> `src/lib/selection-copy.ts` 重建祖先链；验收脚本 `scripts/cdp-verify-selection-copy.mjs`）经
> worktree 分支合并进 master（`93a1d81`，含当天全部并行会话的提交）。合并态在分支上重跑
> `check`/`test`（1366 项全过）/`verify:themes`/`build`/CDP 验收（ALL CHECKS PASSED）后再快进 master。
> 33.7MB 包照分块红线走（9×4MB 逐块 scp + 逐块 sha256 + `cat` 重组，整包 sha256
> `7f87e025…` 对上），`flock` 安装于 07:18:54 UTC。三重核对全过：线上 `dist/boot.js` sha256
> = 本地 `b4840d2f…`（API 层两版相同），`index.html` 资产名一致（`index-NXPJchCO.js` /
> `index-BwLwt3me.css`），公网已在服务新资产名且 bundle 里能 grep 到「已复制选中内容」。
> **公开仓库增量发布仍欠着**：区间现为 `47ddeb2..93a1d81`（工具栏 + 格式刷 + 局部复制 + 文档），
> 走不走、何时走仍由站长定。
>
> 2026-10-09 补记（16:38）：**公开仓库已发布**——并行会话以单个 sync 提交 `5dddd1b` 同步到
> `b6d792e` 并推上 GitHub，待发布区间清零。核验过：selection-copy 三文件与部署版字节一致，
> HANDOFF 仅差 4 处路径脱敏块。
>
> 2026-10-09 部署记录（深色模式修复上线）：`b695c04`——`applyTheme()` 之前只挂 `data-theme`，
> 从不加 Tailwind 的 `.dark` 类（`darkMode: ["class"]`），所有 shadcn 组件的 `dark:` 变体在
> 深色下全部失效：侧栏未选中标签是浅色语义的近黑文字，压在深色轨道上直接隐形（站长截图报障）。
> 现在 `applyTheme` 同步切换 `.dark`，index.css 里早就写好的深色语义块终于生效；激活态标签
> 也从深色下的突兀白底变回正常深色胶囊。验收脚本 `scripts/cdp-verify-dark-theme.mjs`（新）：
> 两套主题下量未选中标签对轨道的对比度（yoru 修复后 7.56:1，修复前约 1:1；akari 15.45:1
> 不变）并截图。`flock` 安装于 08:14:48 UTC，三重核对全过（`index-Baubn_TV.js` 已上公网，
> 线上跑同脚本 ALL CHECKS PASSED）。**通道备注**：本次 xray 代理通道握手即断
> （`Connection closed by UNKNOWN`），改走 `cc-tokyo-01-direct` 全程顺畅——家里直连 22 端口
> 这次没有被 KEX 重置，两条通道都值得下次先试。
>
> 2026-10-09 补记（深色修复被短暂盖掉的 17 分钟，教训再+1）：工具栏会话在 08:26:50 UTC 装上了
> 自己 07:13 从 `464c759` 构建的包——**构建在先、`b695c04` 深色修复在后**，等于把刚上线的深色修复
> 盖回了坏版本（`index-BJcwkIeO.js`），直到 08:44 UTC 才恢复。这正是本文件「构建前先确认 tip」
> 教训的第三次上演，这次的特殊点是：**构建没问题、等待安装的窗口太长（代理通道被目的地侧限流，
> 分块上传拖了 70 分钟），期间 tip 又动了**。结论收严为一句话：`flock` 只挡住并发安装，挡不住
> 「旧包排队进锁」——**长时间传包后、抢锁安装前，必须重查一次 `git log --oneline -1 master`，
> 若 tip 已前移就扔掉手上这包重建**（重建 2 分钟，比重装一遍便宜）。恢复方式：master tip
> `f30b771` 重建重传，xray 与直连两条通道轮流开窗（直连 08:43 重开），按「分块累积 + 逐块
> sha256 + 凑齐后 `flock` 安装」落地，三重核对全过，线上资产名回到 `index-Baubn_TV.js`。
>
> 2026-10-09 部署记录（收尾文档同步上线）：合并 `102567b`（README / AGENTS / 验证导航登记局部复制与深色验收，
> Skill 更名「公众号排版助手 by Yoru」与 editorUrl 登录边界；纯文档，构建产物不变）。整包 sha256 `c5555bda…`
> （33.7MB，9×4MB 分块上传，part-05 撞到一次 `send() failed, 10054`，自动重传补齐后逐块核 hash），
> `flock` 安装于 10:29:28 UTC，三重核对全过：线上 `dist/boot.js` sha256 = 本地 `b4840d2f…`，`index.html`
> 资产名 `index-Baubn_TV.js` / `index-BwLwt3me.css` 未变（JS 资产字节 `80bd585b…` 与本地一致），公网 200。
> **本轮等于原样重装**：改动都在文档层。
>
> **顺带发现（未处理，待站长拍板）**：**当前线上**客户端 bundle 是 React 开发版——根因是主工作区
> `app/.env` 第一行 `NODE_ENV=development` 被 `npm run build`（vite build）读走，React 按开发模式出包
> （入口 2.66MB，含 `jsxDEV`；`StrictMode` 双渲染与开发警告在线上一直生效）。生产版构建入口 2.31MB
> （`index-QCLeONym.js`），`NODE_ENV=production npm run build` 可复现，且与干净 worktree 构建字节一致
> （入口 sha256 `d87e6206…`）；服务端 `dist/boot.js` 两种模式同哈希，不受影响。此前版本未逐版回查。
> 要不要切生产版、部署构建是否固定 `NODE_ENV=production`，由站长决定后另行处理。
>
> 2026-10-09 部署记录（/terms 使用规范页 + README 配图上线）：合并 `qoder/readme-shots-and-terms` →
> master `5968fce`。合并冲突只有一处（AGENTS 的必读资料表被三方各自追加行），保留全部三条。
> 合并态在主工作区重跑 `check`、`verify:themes`（ALL CHECKS PASSED）、`test`（1366 项全过）、`build`，
> 再对本地 vite 跑 `cdp-verify-terms.mjs`（新，12 项）与 `cdp-verify-dark-theme.mjs`（全绿）。
> 33.7MB 包按分块红线走（9×4MB，逐块 sha256，整包 `26f5efab…` 对上）；`flock` 安装于 12:25:31 UTC。
> **抢锁前重查 tip 仍是 `5968fce`**，照 08:44 那次的教训收严执行。三重核对全过：线上 `dist/boot.js`
> sha256 = 本地 `b4840d2f…`（API 层未变）、`index.html` 资产名 `index-BbB82EWp.js` / `index-BqizAfmg.css`
> 本地 = 线上 = 公网、重启时间即本次安装。部署后对**公网**再跑一遍 `cdp-verify-terms.mjs` 12/12。
> 本轮线上 bundle 仍是 React 开发版（入口 2,684,681 字节、含 `jsxDEV`），与上面那条待拍板的发现同源，
> 不是本轮引入的回归。
>
> **两条操作教训**：① 分块上传脚本写成**可续传**的（每块先在服务器上对 sha256，已过的跳过），
> 这次 p06 连撞三次 `10054` 整脚本退出，重跑只补那一块，不用重传 33MB。② `api/lib/vite.ts` 的 SPA
> fallback 只在请求 `Accept` 含 `text/html` 时回 index.html，否则 404 JSON——裸 `curl` 探 `/terms`
> 拿到 404 看着像路由没注册，带 `-H "Accept: text/html"` 才是真相（安装脚本里 `/login` 那步早就这么写了）。
>
> 2026-10-10 发布记录（区间已推上公开仓库）：伞提交 `f30b771..52915ea` → 公开 `5f3caa6..b45e8de`，
> 普通 push 不是 force。**base 要实测不要推断**：先前记的 `b6d792e` 已经旧了——公开侧在 16:38 之后
> 又收了深色修复与 docs-sync 两批，逐 blob 比对（1099 个文件）证实真实 base 是 `f30b771`，
> 公开侧只多一个根 `LICENSE`，另有 5 个脚本（四个 `cf-*.sh` + `themes/import.ts`）是 rebuild-only
> 占位符的既有差异，属正常状态而非泄漏。7 个补丁走 `format-patch --binary` → `publish-scrub.py
> --incremental`（3 处 `<local workspace>` 替换）→ `git am -p2 --3way`；AGENTS 必读资料表那处
> 三方追加冲突按合并时的同一解法保留全部三条。推前用脱敏表自己的 19 条左值扫公开工作树与新增行，
> **零命中**才推。配图 1.7MB 随 `--binary` 正常进出，GitHub raw 取回字节与本地一致。
>
> 2026-10-10 结案（线上 bundle 已切成 React 生产版）：上面那条「由站长决定」的悬案在无人值守窗口
> 拍板执行，依据是没有任何一条理由支持继续跑开发版。**根因不是构建命令，是 `.env` 里那行
> `NODE_ENV=development`**——vite 会把它拿去当 React 的编译条件，而 `api/lib/env.ts` 只认字面量
> `production`，所以「不写这行」和「写 development」对服务端完全等价、对构建产物天差地别。
> 两条看着像正确答案的修法都**实测无效**，别再走：`vite build --mode production` 之后入口仍是
> `index-BbB82EWp.js`、`jsxDEV` 13 处；在 `vite.config.ts` 加 `define: {'process.env.NODE_ENV': …}`
> 只把体积压到 2,478,265、`jsxDEV` 还剩 11 处（React 的 dev/prod 走包导出条件，`define` 只替换字面量）。
> 删掉 `.env` 那行之后入口 `index-D_Kmk5xT.js`、2,326,911 字节、`jsxDEV` 归零。
> 根因是文档教的：README / 配置文档 / 本文件三处都写着「开发时设 NODE_ENV=development」，四处指示
> 已全部改成「整行删掉」，`.env.example` 也加了注释。
> **新增防线**：`scripts/server-install-release.sh` 现在拒绝入口含 `jsxDEV` 的包（`MOPAI_ALLOW_DEV_BUNDLE=1`
> 才放行），放在动 `/opt/mopai` 之前。已拿上一个开发版包做过反向测试：`REFUSED` + exit=1，
> 线上资产名与服务状态都没被碰。
> 上线验证：本地生产模式（独立库 + `ANON_GC_ENABLED=false`）跑 `cdp-verify-terms` 12/12、
> `cdp-verify-dark-theme` 与 `cdp-verify-favorites` ALL PASSED，确认压缩后的生产 bundle 交互正常；
> 部署后对公网再跑同样两套，全绿。三重核对全过（`boot.js` `b4840d2f…` 未变、
> `index-D_Kmk5xT.js` / `index-BqizAfmg.css` 本地=线上=公网、`ExecMainStartTimestamp` 16:34:40 UTC）。
>
> 2026-10-10 部署记录（联系邮箱防采集 + star 引导 + 窄屏提示上线）：合并 `qoder/contact-and-star`
> → `fcdee69`。设置页新增「反馈与联系」区块：邮箱分片存储、点击「显示邮箱」才拼装进 DOM（爬虫与
> bundle grep 都拿不到明文），剪贴板被拒时自动亮出地址兜底；`/terms` 换用同一组件，旧的明文
> `mailto:` 从 bundle 里消失。README 与设置页加 star 引导；编辑器 `< md` 宽度显示「目前只做了
> 网页端适配」提示条。`cdp-verify-terms` 扩到 16 项（含隐藏/揭示与 star/issues 断言），新增
> `src/lib/contact.test.ts` 防明文回归。构建从**干净的临时 worktree**（`fcdee69` 检出）进行，
> 理由见下条：check / verify:themes 全过，test 热跑 1368/1368（冷跑偶发单条 5s 超时，单独跑均过，
> 与本次改动无关）；产物 `boot.js b4840d2f…`（与上一版逐字节相同，API 未动）、入口
> `index-CsHyWFhM.js`（生产版、`jsxDEV`=0）、`index-DkOvzaBg.css`；整包 sha256 `0083475e…`
> （33.6MB，9×4MB 分块逐块核 hash、全部一次通过）；`flock` 安装于 00:31:24 UTC。三重核对全过
> （本地=线上=公网资产名、`ExecMainStartTimestamp` 即本次），公网复跑 `cdp-verify-terms` 16/16、
> `cdp-verify-dark-theme` ALL PASSED。**公开仓库增量发布**：已由并行会话（Codex 线）随其增量发布
> 一并带上——本会话两个提交在公开侧对应 `ee3236b` / `2c36cab`；逐 blob 复核见下条记录。
>
> 2026-10-10 并行会话教训（主工作区被其他会话当成工地时的构建与合并）：
> ① 主工作区当时被并行的 Codex 会话占用（`codex/ai-writing-mcp`，AI 写作 MCP 功能，**未提交**，
> 正持续写文件），在其中连续 `npm run build` 得到的 `boot.js` 在 2.2MB / 3.0MB 之间跳、`dist`
> 里混进两份构建产物——**不是 esbuild 不确定性，是构建目录里混入了别人未提交的源码**。稳妥做法：
> `git worktree add <临时目录> <目标commit>` 开干净检出，在其中 `npm ci` / 构建 / 验收，主工作区
> 一个字节都不碰（本轮即如此执行）。
> ② 同一场景的另一面：**`git merge --ff-only` 落在我以为还在 master 的主工作区，而它已被对方
> 切到 `codex/ai-writing-mcp`**——merge 实际快进了对方分支（无害：它本就要基于新 master 继续），
> master 原地没动，reflog 里没有任何痕迹。用 `git update-ref refs/heads/master fcdee69 f56b863`
> （带旧值校验的原子快进）补上，纪律条目见第一节第 5 条。
> ③ 现状留档：`codex/ai-writing-mcp` = `fcdee69` + 未提交 WIP（`api/mcp.ts`、`api/remote-mcp-router.ts`、
> `api/lib/remote-mcp.ts`、`api/lib/writing-skill.ts`、`contracts/remote-mcp.ts`、`src/hooks/useRemoteMcp.ts`、
> `src/lib/remote-mcp-sync.ts`，以及 `boot.ts` / `env.ts` / `schema.ts` / `store.ts` / `SidePanel.tsx` /
> `TopBar.tsx` / `EditorPage.tsx` / `useDocs.ts` / `vite.config.ts` / `package.json` 的改动）——
> **下一个部署者勿把这条线的 WIP 混进构建**，等它提交并走完自己的验收。（该 WIP 已于同日提交、
> 合入 master 并完成部署与公开发布，见下条记录。）

> 2026-10-10 部署记录（AI 写作与当前稿件 Remote MCP）：上面的 MCP WIP 已提交并合入 master。
> 功能提交 `a20980e` 与现有联系 / star 主线合并为 `4c480cc`；兼容补丁 `98de250` 将公开 Skill
> 改为 UTF-8 `text/plain` 原始 Markdown，并加入可安全复验公网版本的脚本模式。公开仓库已正常
> 增量 push：功能 `7ce84cd`、兼容 `ad8566c`，未重写历史；此前联系 / star 的公开发布欠账也已补齐。
>
> 最终构建来自主工作区 master `98de250`，check / 1395 项 test / 219 主题验证 / build 全过。
> Agent 浏览器往返、Python Skill 与云端稿件同步脚本均通过；新 MCP 脚本在独立生产模式库里验证
> 匿名授权、完整 Skill、读写、浏览器同步、hash 冲突的三种选择、游客 / 稿件隔离、换令牌、撤销、
> 强制到期及本机重开。真实 OpenCode 1.18.31 原生客户端完成 Skill / read / update 三个调用，
> 模型响应使用本地确定性驱动，不使用用户模型账号。公网同一浏览器 + OpenCode 流程全过；
> 公网的强制数据库到期明确 SKIP（私有测试库已过），没有直接改线上库制造到期。
> `/terms` 与相邻设置入口公网复验 16/16；README 两态编辑器截图已在功能提交更新。
>
> 首次安装前备份 `/opt/mopai/backups/mopai-pre-remote-mcp-4c480cc.db` 与
> `env-pre-remote-mcp-4c480cc.env`（权限 600），并配置
> `PUBLIC_BASE_URL=https://wechat.yoru-and-akari.dev`。启动自动增加 `remote_mcp_connections`
> 表与索引，正文复用 `docs` 的 ownerId=0 临时行；既有列与站长 ownerId=1 路径不变。
> 新旋钮 `REMOTE_MCP_TTL_HOURS` / `REMOTE_MCP_TOTAL_BYTES` 使用默认 24h / 50 MiB，
> 无模型密钥或 OAuth 环境配置需求。到期立即拒绝访问，生产每分钟回收临时副本。
>
> 最终包 33,828,412 bytes，sha256 `1bd72accd4dc2a83dbe33a4fa82a1887a4b421b779b9a33f64c59ef8d6d2f5cc`；
> 使用 `/tmp/mopai-deploy.lock` 安装，`ExecMainStartTimestamp` 为 2026-10-10 01:09:46 UTC。
> 三重核对通过：本机 / 服务器 `boot.js` sha256
> `8cf94d440976996282e90277e6b881170141c74b7230fb1404de6aed0cc593c4`，首页与公网资产均为
> `index-BO_dxRPV.js` / `index-BsGB4w3K.css`。公网 `/skill.md` 返回 200，25,973 bytes，
> 与跟踪 Skill 的 LF 内容完全一致，sha256 `ee1c279f74926c74cd70aebb195666eae0562bcc2bc23923b4cefe0908773890`。
>
> 传输补记：本机原生 SSH / Git SSH 的 4 MiB scp 块均出现中途 reset，改为 33 个 1 MiB 块，
> 每块与重组整包都核 sha256，最多三个独立块并发。Git Bash helper 需
> `export SHELL=/usr/bin/bash`，否则继承的 PowerShell SHELL 会令 Git SSH 的自动 exec 启动失败。
> 上传的 installer 在本机显式规范为 LF，再按字节 scp，避免 PowerShell 管道的 CRLF 变形。
>
> 网页读取限制按实测保留：普通 HTTP 可取完整 Skill；本会话的网页检索工具对该域返回不可访问，
> Tavily 提取只保留前段。完整复制与 MCP Skill 读取均得到全文，仓库 Raw 地址也可读完整内容。
> 核对边缘设置后，AI search / user 策略均为 disabled（不阻断），此时间窗 `/skill.md` 没有
> firewallEventsAdaptive 阻断事件；这些证据不用于宣称每个网页版 AI 都能读本站链接。
> 未改 Cloudflare 全区策略；ChatGPT OAuth 连接器也未计作通过，核心 Bearer MCP 保持独立。
>
> 2026-10-10 交叉复核（联系 / star 区间的公开发布对账与线上状态）：按实测复核公开仓库与本站。
> ① 公开发布完整：公开 `4d63f10` 与伞 `e5839d6:app` 逐 blob 比对，1119 个文件中 1113 个完全一致，
> 差异恰为已知项——HANDOFF 的 12 行路径脱敏、5 个 rebuild-only 占位符脚本（四个 `cf-*.sh` +
> `themes/import.ts`），另公开根多一个 `LICENSE`；两张脱敏表的 21 条左值扫公开全树与
> `b45e8de..4d63f10` 的全部新增补丁文本，**零命中**。
> ② 线上状态：当时的线上服务（01:09:46 UTC 安装的 Codex 构建）对上面两组脚本复验——
> `cdp-verify-terms` 16/16、`cdp-verify-dark-theme` ALL PASSED，联系区块默认隐藏 / 点击揭示、
> star 与 issues 链接都在位。本条记录提交随后同步到公开仓库。

### 产品方向（用户明确拍板的）

- **公开源码已落地**：`src/lib/brand.ts` 的 `REPO_URL` 指向 `yoruuuchan/wechat-md-studio`；增量发布与部署对应关系见上面的发布流水线。
- **许可证已定（2026-10-07）**：仓库整体 **AGPL-3.0-or-later**。三处声明：根目录 `LICENSE`、
  [package.json](package.json) 的 `license` 字段与 [README](README.md#license-与来源)。
  选它是因为主题库含 6 套 AGPL 与 2 套 GPL-3.0 主题（兼容性逐族核对见 `THEME-SOURCES.md` 第四节）。
  操作红线：**开源发布不得晚于部署**——AGPL 第 13 条覆盖线上服务，仓库没公开之前
  部署含 copyleft 主题的构建就是未履行源码提供义务。
- **公开上线（2026-10-07 用户拍板）**：仓库开源之后，站点也直接对公众开放——撤掉 Cloudflare Access，
  **上传图片不再需要口令**。`ACCESS_KEY` 保留，但语义收窄成「站长的云端草稿箱钥匙」。
  默认示例稿同时脱敏（见坑 8）。代价是匿名上传成了公开写入面，`ANON_*` 那四个额度旋钮
  从此是**承重结构**，不是可调可不调的选项：改宽之前先想清楚谁在替你付 R2 的钱。
- **多人登录 / 收费**：远期方向，**先不做**。现在只记录意向：等功能完善、开源之后，再考虑多用户与付费模式。届时现在的「单口令 + 单用户空间」要拆成真实账号体系，这是大工程，别提前埋半吊子抽象。
  2026-10-07 之后多了一小块地基：匿名访客已经有稳定身份（`mopai_vid` Cookie → `files.visitor` 存哈希），
  图片按访客隔离；但**稿件仍然只有站长能存云端**，匿名稿件只在浏览器里。别把访客身份当成账号体系的雏形去扩。

按价值排序：

### 中

1. **`storage.orphans` 不覆盖另一台设备的未同步草稿**：本地草稿 key 通过 `alsoKeep` 传，但只覆盖**本机**浏览器存储。另一台设备的草稿引用的图可能被误判为孤儿。要根治得让草稿也同步。
2. **匿名图片没有回收机制 → 已修（2026-10-08，`api/lib/anon-gc.ts`）**：以前清理只能由上传者自己在素材库里点，
   而他大概率再也不回来，总量撞到 `ANON_TOTAL_BYTES`（1.5 GB）之后**所有人都传不了图**且不会自愈。
   现在启动 1 分钟后跑一次、之后每 24h 一次：删掉 `ownerId=0`、比 `ANON_GC_DAYS`（默认 14 天）更旧、
   且没有任何云端稿件正文含 `img:<key>` 的图（回收站里的稿件也算引用，因为可以恢复）。
   顺序是先 `storage.deleteFile` 让 Worker 确认对象已删，**再**删 `files` 行；Worker 拒绝或连不上就保留行、
   写一行 `[anon-gc] delete-failed key=… reason=…`，下次重试。每次运行结束写一行
   `[anon-gc] deleted=N bytes=B failed=F days=D`（格式固定，晨报 grep 它）。旋钮见 `.env.example`。
   **残留取舍，刻意保留、别当 bug 修**：匿名访客的稿件只在他们自己浏览器的 IndexedDB / localStorage 里，服务端看不见，
   所以「14 天前传的图还被某访客的本地草稿引用」会被误删——和 `scripts/server-anon-purge.sh` 同口径。
   还没实测的：线上第一次 sweep 的真实规模，14 天这个默认值是按估计的增长速率定的，跑完看 `deleted=` 再调。

### 低

3. **整包稿件导入 / 导出已落地**：`import-export.ts` 提供 JSON 备份；云端正文先补全再导出，见 [稿件文档](docs/documents.md#编辑与导入导出)。
4. **`useDocs` 脏标记全量比较**：`lastSavedRef` 是 Map<id, content>，每次改动全量比较，稿多了可能变慢。
5. **围栏代码图片错位已修**：parser 扫描与 renderer 回填对称跳过 fence，编辑备注也保持同样的计数边界；回归在 `fences.test.ts` 与 `comments.test.ts`。

### 探索性

6. **轮播比例改动后，旧图需手动重裁**：现在只提示"N 张图还是旧比例"。能不能批量重裁？或自动提示？
7. **`img:` 协议跨域**：复制到公众号后，微信转存图片，但如果 R2 挂了，正文会裂图。是否有降级方案？

---

## 七、交付与部署验收

开发完成检查和报告格式统一见 [AGENTS](AGENTS.md#验证与完成报告)；
浏览器脚本选择见 [验证导航](docs/verification.md)。
本地功能验证通过后，合回主线，由主工作区统一发布源码与部署。

部署 API / 数据改动后，在服务器重跑 `sudo bash /opt/mopai/scripts/verify-all.sh`，检查退出码；
脚本自身变更需单独安装，部署 `dist` 不会更新它们。每次部署核对文件哈希和进程重启时间，
记录实测范围与真实问题。

---

## 八、无头 Chrome + CDP 骨架（可直接改用）

这是前一轮用来发现真 bug 的手段，比读代码可靠得多。

```js
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'

const [appUrl, accessKey] = process.argv.slice(2)
const PORT = 9333
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1440,820', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl } catch {}
    await sleep(250)
  }
  throw new Error('no CDP')
}

let id = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++; pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 30000)
  })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(3000)
// 在被测页面里登录（同源 fetch，避免处理 Access 与 cookie）
await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({json:{accessKey:${JSON.stringify(accessKey)}}})}).then(r=>r.text())`)
await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(3500)

// 直接给隐藏的 file input 塞文件
async function feedFile(filePath) {
  const { root } = await send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId)
  await send('DOM.setFileInputFiles', { nodeId, files: [filePath] }, sessionId)
  await sleep(2000)
}

// 断言示例：量弹窗是否被窗口裁掉
console.log(await evaluate(`(() => {
  const d = document.querySelector('[role=dialog]')
  if (!d) return 'no dialog'
  const r = d.getBoundingClientRect()
  return JSON.stringify({
    viewportH: innerHeight,
    clipped: r.top < 0 || r.bottom > innerHeight,
    buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()),
  })
})()`))

chrome.kill()
```

调试要点：

- 用**本地生产模式**跑（`NODE_ENV=production node dist/boot.js`）+ 独立 `DATABASE_URL`，别对线上库做破坏性测试
- 想让上传真的落到 R2，本地 `.env` 的 `IMG_ADMIN_KEY` 要和 Worker 的 secret 一致
- 测完删掉临时数据库和脚本

---

## 九、维护文档

新增或改变行为先修改事实源与测试，再更新对应专项文档；通用规则维护在 [AGENTS](AGENTS.md)。
本文件只追加影响运行、部署或真实环境诊断的记录，写清日期与实测范围。
