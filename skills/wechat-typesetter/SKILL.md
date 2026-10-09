---
name: wechat-typesetter
description: 墨排（mopai）公众号排版线上协作技能。当用户要把写好的 Markdown 稿件推进公众号排版编辑器、要一个能直接发给人的编辑链接、要把浏览器里润色过的稿子读回来、要查/搜线上稿件、要列出可用排版主题，或者说"推到墨排""发给我改""排版这篇公众号文章""看看草稿箱里的稿子"时使用。纯线上流程：脚本不做任何本地渲染，只通过 REST（`/api/agent/*`，Bearer 令牌）把 Markdown 写进线上编辑器，返回 `editorUrl` 交给人去浏览器里排版、换主题、复制成公众号格式，之后再用 `get` 读回润色结果；稿件里的本地图片（Markdown `![]()` 与 HTML `<img src>`）在推送时自动上传到图床并把引用改写成 `img:<key>`，无需人工处理。配置只来自本技能目录下的 `.env`（`MOPAI_API_URL` 与 `MOPAI_TOKEN`，脚本不读环境变量）；正常路径不需要预先检查 `.env`，直接推送，报缺令牌再按本文「令牌」一节补。零依赖，Python 3 标准库，Windows 与 Linux 通用。
---

# 墨排 wechat-typesetter — 把 Markdown 交给人在浏览器里排完

## 概述

`scripts/mopai.py` 是墨排（公众号 Markdown 排版 Web 应用）的 agent 客户端：把 Markdown 稿件推进线上编辑器，拿回一个 `editorUrl`，交给人在浏览器里排版、选主题、微调，最后把润色过的稿子读回来。**脚本本身不做任何渲染和排版**——排版只发生在网页里，人也在网页里完成这篇文章。所以这个技能的正确用法是"推上去 → 把链接给人 → 等改完再读回来"，而不是"在本地生成公众号 HTML"。

脚本是零依赖的 Python 3 标准库实现，Windows 和 Linux 都能直接跑，不用装任何东西。下面命令里的 `mopai.py` 指 `<技能目录>/scripts/mopai.py`（`<技能目录>` 就是本 `SKILL.md` 所在目录）；Windows 用 `python`，Linux/macOS 用 `python3`。**每条错误信息里都带 `script` 和 `envFile` 的绝对路径**，不用猜文件在哪，直接从那句报错里复制。

## 直接推送就行，不要预先检查 .env

**不要为了"保险"在推送前先跑 `token-status`、`cat .env` 或判断 `.env` 存不存在。** 直接调 `push`：令牌配好了就成功，没配好脚本会立刻失败，错误信息里已经带上 `.env` 的绝对路径、`set-token` 命令和令牌的生成方式。**只有看到那句报错时**，才去处理令牌（见下一节）。

理由很实在：预先检查是正常路径上一次纯浪费的往返——令牌 99% 的时候是好的，那次检查什么也没换来；而令牌真出问题时，`push` 自己会告诉你，且告诉得更准（它知道你在跑哪条命令、读的是哪个文件）。

## 令牌：报错后再看这一节

### 报错长什么样

没配令牌时脚本立刻失败，不会上传图片传到一半才断（stderr，退出码 1）：

```json
{"error":"缺少令牌：这个命令要带 Authorization: Bearer mopai_… 才能调用。请在 <技能目录>\\.env 里写 MOPAI_TOKEN=mopai_xxx，或执行 python <技能目录>\\scripts\\mopai.py set-token mopai_xxx。令牌在服务端 .env 的 AGENT_TOKENS=name:token 里配置，生成方法见 SKILL.md「令牌：报错后再看这一节」。","script":"<技能目录>\\scripts\\mopai.py","envFile":"<技能目录>\\.env"}
```

令牌配了但不对，是服务端回的 **401**：

```json
{"error":"令牌无效或已被吊销","hint":"带上 Authorization: Bearer mopai_… ；令牌在服务端 .env 的 AGENT_TOKENS 里配置"}
```

看到这两句之一，才需要往下走。

### 写进 .env

`<技能目录>/.env` 是配置的唯一来源（脚本刻意不读环境变量：技能的配置属于技能目录，这样不管哪个 shell、哪个 harness、哪个定时任务来调，用的都是同一个令牌）。文件已被 `.gitignore` 忽略，不会进仓库。

手动设置：把 `.env.example` 复制成 `.env`，填 `MOPAI_TOKEN=` 那一行。

Agent 代为设置（二选一，脚本会顺手把权限收到 600，Windows 上忽略）：

```bash
python <技能目录>/scripts/mopai.py set-token mopai_你的令牌

# 或从管道传入，令牌不留在 shell 历史里
echo 'mopai_你的令牌' | python <技能目录>/scripts/mopai.py set-token
```

`set-token` 是幂等的：原地替换 `MOPAI_TOKEN` 的值（`.env` 不存在就从 `.env.example` 建一个），不会堆出多行。换令牌也走它。

确认脚本到底读到了什么（只在排查时用，别当推送前的例行检查）：

```bash
python <技能目录>/scripts/mopai.py token-status
```

### 怎么造一个令牌

令牌在**服务端**签发，写进部署机上应用自己的 `.env`：

```
AGENT_TOKENS=<名字>:<令牌>            # 默认 read+write
AGENT_TOKENS=<名字>:<令牌>:read       # 只读
AGENT_TOKENS=claude-code:mopai_aaa,reviewer:mopai_bbb:read   # 逗号分隔多个
```

令牌格式是 `mopai_` + 32 字节随机数的 base64url（不带 `=` 填充）。生成一条：

```bash
python -c "import secrets,base64;print('mopai_'+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
```

```bash
echo "mopai_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
```

`<名字>` 不是秘密，它会写进稿件的 `source`（`agent:<名字>`）和日志，用来分辨是哪个 agent 推的；只有令牌本身是秘密。一个 agent 一条，吊销时不影响别人。改完服务端 `.env` 要重启应用进程才生效。

## 使用方式

典型流程是这三步：推上去 → 把 `editorUrl` 给人 → 人改完之后读回来。

```bash
# 1. 推一篇本地 Markdown（最常用）。输出 JSON 里的 editorUrl 就是给人的链接
python <技能目录>/scripts/mopai.py push --file draft.md

# 指定标题（不给就由服务端推导：front matter 的 titles 第一项 → 第一个标题 → 未命名稿件）
python <技能目录>/scripts/mopai.py push --file draft.md --name "十月复盘"

# 推纯文本 / 管道输入（注意 --text 里的 \n 不会被转义，长文本请用 --file 或 stdin）
python <技能目录>/scripts/mopai.py push --text "# 标题"$'\n\n'"正文"
cat draft.md | python <技能目录>/scripts/mopai.py push

# 推完顺手在浏览器打开
python <技能目录>/scripts/mopai.py push --file draft.md --open
```

`push` 的输出（stdout，紧凑 JSON）：

```json
{"ok":true,"id":"abc123","name":"十月复盘","editorUrl":"https://wechat.yoru-and-akari.dev/?doc=abc123","hash":"9f2c1a7b4d5e6f80","savedAt":1730000000000,"source":"agent:claude-code","uploadedImages":2}
```

把 `editorUrl` 原样交给用户——那是唯一能让人接着排版的入口。`hash` 存下来，回推时用得上（见「关于稿件的改动与冲突」）。图片没全传上去时多一个 `warnings` 数组，同时逐条打到 stderr，但推送本身算成功。

```bash
# 2. 读回人工润色过的稿子
python <技能目录>/scripts/mopai.py get abc123                 # Markdown 原文打到 stdout
python <技能目录>/scripts/mopai.py get abc123 --out draft.md  # 写文件，stdout 改成元信息 JSON（含 hash）
python <技能目录>/scripts/mopai.py get abc123 --meta          # 只要元信息，不要正文

# 3. 回推改过的版本（带锁，人在浏览器里改过就 409）
python <技能目录>/scripts/mopai.py update abc123 --file draft.md
python <技能目录>/scripts/mopai.py update abc123 --file draft.md --base-hash 9f2c1a7b4d5e6f80
python <技能目录>/scripts/mopai.py update abc123 --file draft.md --name "十月复盘（终稿）"
python <技能目录>/scripts/mopai.py update abc123 --file draft.md --force   # 无条件覆盖，慎用
```

```bash
# 列稿件（只有摘要，不含正文；--saved 只看已进草稿箱的）
python <技能目录>/scripts/mopai.py list
python <技能目录>/scripts/mopai.py list --saved --limit 20 --offset 0
python <技能目录>/scripts/mopai.py search 排版          # 等价于 list --q 排版
python <技能目录>/scripts/mopai.py list --q 排版 --saved

# 主题表（实时从服务端拉，脚本里不存副本）
python <技能目录>/scripts/mopai.py themes

# 我是谁、有什么权限、服务端时间
python <技能目录>/scripts/mopai.py whoami

# 令牌相关
python <技能目录>/scripts/mopai.py set-token mopai_xxx
python <技能目录>/scripts/mopai.py token-status
```

通用参数（放在子命令前后都行）：`--base-url` 临时换地址（不改 `.env`）、`--timeout` 换超时秒数、`--pretty` 让 stdout 输出缩进 JSON 并在 stderr 附一份给人看的摘要。

**默认输出是 stdout 上的紧凑 JSON**，因为调用方通常是要解析结果的 agent；人手动跑时加 `--pretty`。`get` 例外：它默认把 Markdown 原文打到 stdout（那就是它的"数据"），要元信息就加 `--meta` 或 `--out`。

退出码：`0` 成功，`1` 错误（服务端报错、连不上、缺令牌、409 冲突），`2` 用法错误（参数不对、文件不存在、`delete`）。

**没有 `delete`。** agent 不能删稿件：删除是人在网页里做的动作。脚本收到 `delete` 会直接说明这件事并以退出码 2 结束，不会去碰服务端。

## 图片处理

推送（`push` / `update`）时脚本会扫正文里的图片引用，把本地图片逐个传到 `POST /api/agent/images`，再把引用改写成服务端返回的 `ref`：

- 扫两种语法：Markdown `![alt](path)`（含 `![alt](<带空格的路径>)` 和 `"title"`）与 HTML `<img src="path">`。
- **改写结果是 `img:<key>`，不是那个 `url`。** 网页会把 `img:<key>` 展开成自己的稳定图片地址；直接写绝对 URL 的话，公众号重新托管图片时会失效。上传响应里的 `url` 只是给人点开看的。
- 跳过一切带 scheme 的引用（不是本地路径，没什么可传）：`http://`、`https://`、`//`、`data:`、`blob:`、`mailto:`，以及本应用自己的两个协议 `img:`（图床短引用，网页会展开成稳定图片地址）和 `docx-import:`（导入 DOCX 时留下的待上传占位）。**这两个后面都没有斜杠**，所以按 `img://` 那样判断会漏掉它们、把一串不是路径的字符串当文件去上传。
- 相对路径按 **Markdown 文件所在目录**解析，不是当前工作目录。`--text` / stdin 没有"所在目录"，按 cwd 解析。
- 白名单：`.png .jpg .jpeg .gif .webp .svg`。单张上限 **20MB**（超了本地就拦下，不浪费一次上传）。
- 同一张图在一篇里引用多次只上传一次（按解析后的绝对路径缓存）。
- **单张失败不中断推送**：原引用保留，原因进输出的 `warnings` 数组，稿件照常创建。图片不存在、格式不支持、太大、图床报错都是这一类。

## 关于稿件的改动与冲突

推上去之后到读回来之前，**人会在浏览器里改这篇稿子**——这是设计好的流程，不是意外。所以覆盖写入必须带锁。

- `GET` 一篇稿件会返回 `hash`：正文 sha256 的前 16 位。它不是时间戳，所以不受客户端时钟和秒级精度影响，内容一样 hash 就一样（重推同样的文本不会假冲突）。
- `PUT` 时把它作为 `baseHash` 带上，服务端发现当前 hash 对不上就拒绝写入，回 **409** 和 `current`（现在的 `name` / `content` / `updatedAt` / `source` / `hash`）。
- **服务端不接受"什么都不带"的写法**：没有 `baseHash` 又没有 `force: true` 的更新会被 **400** 拒绝（提示写明要 baseHash 还是要 force）。这是刻意的——盲覆盖会把人在浏览器里的修改直接冲掉，覆盖必须是一次显式声明。
- **409 的意思是"重新读一遍再决定"**，不是失败重试。stdout 上会给出完整的 `current`，`hint` 里直接写好下一步：把人的版本作为基础改，然后 `--base-hash <current.hash>` 重试。默认退出码 1。
- `--force` 会发送 `force: true`（不带 `baseHash`），无条件覆盖最新版，**会把人在浏览器里的修改直接冲掉**。所以它必须是一次明确的决定，不要当默认。
- 不带 `--base-hash` 也不带 `--force` 时，脚本会先 `GET` 一次拿当前 hash 再写：这把锁只保护"读和写之间"那一小段，防不住更早之前的人工修改。要真正不覆盖人的劳动，**把上次 `push` / `get` 拿到的 hash 用 `--base-hash` 传进来**。`get --out` 就是为这个流程准备的：正文进文件，hash 进 stdout。

推荐的往返：

```bash
python <技能目录>/scripts/mopai.py get abc123 --out draft.md   # stdout 里有 hash
# …在 draft.md 上改…
python <技能目录>/scripts/mopai.py update abc123 --file draft.md --base-hash <上一步的 hash>
```

## 令牌安全

- `.env` 被 `<技能目录>/.gitignore` 忽略，只有 `.env.example` 进仓库。**不要**为了省事把令牌写进 `SKILL.md`、脚本、命令历史或文章正文。
- 所有输出里的令牌都是掩码：`mopai_abcd…wxyz（共 42 字符）`，完整令牌不会被打进日志。
- `set-token` 会尝试把 `.env` 权限收到 600（Windows 上没有意义，失败会被吞掉，不影响命令）。
- 同步这个技能到别的位置（比如全局技能目录）时**必须排除 `.env`**：仓库里那份是模板，落地位置那份是真配置，覆盖掉的表现是"昨天还能推，今天突然说缺令牌"。
- 吊销：在服务端 `.env` 的 `AGENT_TOKENS` 里删掉那一行并重启应用即可，其他 agent 不受影响。已经推进去的稿件不会因此消失，`source` 里还留着它的名字。

## 故障排查

一行一条：现象 → 原因 → 动作。

- **`缺少令牌`（退出码 1）** → `.env` 里没有 `MOPAI_TOKEN` → `python <技能目录>/scripts/mopai.py set-token mopai_xxx`。
- **HTTP 401 `这个端点需要令牌`** → 请求根本没带 Authorization → 同上，`set-token` 写进去。
- **HTTP 401 `令牌无效或已被吊销`** → 令牌抄错了、少字符，或服务端 `AGENT_TOKENS` 里那行被删了 → 核对令牌；必要时重新生成并让站长加回服务端 `.env`，重启应用。
- **HTTP 403 `令牌 X 只有 read 权限`** → 令牌有效但权限不够（401 是"不认识你"，403 是"认识你但这件事不许做"）→ 在服务端把那行改成 `name:token`（默认 read+write），或换一个可写令牌。
- **HTTP 404（`get` / `update`）** → 稿件 id 不对，**或者它已经被删进回收站**。agent 看不到也不能复活回收站里的稿件 → `list` 找 id；确实被删了就重新 `push` 一篇，别指望 `update`。
- **HTTP 409 `conflict`** → 你上次读到之后有人在浏览器里改了 → 读 stdout 的 `current.content`，在它基础上改，再 `--base-hash <current.hash>` 重试；确认要覆盖才 `--force`。
- **HTTP 400 `缺少 baseHash：不能盲覆盖`** → 直接 `PUT` 时既没有 `baseHash` 也没有 `force: true`。用脚本不会遇到（脚本会自动补一个：先 GET 再写，或 `--force`）；手写 curl 时按提示二选一。
- **HTTP 413** → 正文超 200 万字符，或单张图超 20MB → 拆篇；图片先压缩。
- **HTTP 400 `参数不对`** → `content` 空了或缺了 → 检查文件路径和文件内容。
- **HTTP 500 `图床未配置` / `图片上传失败`** → 服务端到图床（R2 worker）不通或 `IMG_BASE_URL` / `IMG_ADMIN_KEY` 没配 → 这是服务端问题，把报错原样转给站长；稿件本身已经推进去了，图留在 `warnings` 里。
- **`返回的不是 JSON（…）`** → 命中的是 Cloudflare Access 拦截页或反代错误页，不是应用 → 见下一条。
- **`连不上 <url>` / 超时 / 403 HTML 页** → 部署在 Cloudflare Access 后面，`/api/agent/*` 没被放行。Access 是按路径策略工作的，需要在 Access 应用里给 `/api/agent/*` 加一条 **Bypass** 策略（认证交给脚本的 Bearer 令牌）。**这是运维在 Cloudflare 控制台做的动作，脚本改不了**；改完用 `curl -s -o /dev/null -w '%{http_code}' <base>/api/agent/whoami` 应返回 401 而不是 302/403。
- **改了 `.env` 却不生效** → 文件位置不对，`.env` 必须和 `SKILL.md` 同级，丢进 `scripts/` 不会被读 → `token-status` 看 `envFile` 指的是哪个路径。
- **`editorUrl` 打开是另一个域名 / 相对地址不对** → 服务端 `PUBLIC_BASE_URL` 没配，`editorUrl` 会退回用请求的 origin 拼 → 在服务端 `.env` 里配 `PUBLIC_BASE_URL` 并重启。
- **中文输出乱码或 `UnicodeEncodeError`** → cp936 控制台的老问题；脚本启动时已把 stdout/stderr 重配成 UTF-8，并对写不出的字符降级替换 → 如果仍然乱码，是终端字体/代码页的问题，`chcp 65001` 或换 Windows Terminal。
- **推送卡住不动** → 大图在慢链路上，或 `--text`/stdin 在等输入（不是 tty 就会读 stdin）→ 加 `--timeout`，或改用 `--file`。
