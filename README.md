# 公众号排版助手 by Yoru

把 Markdown 写成**可以直接粘进微信公众号后台**的排版。左侧写稿、右侧 375 / 677 实时预览、
一键复制富文本；图片上传后走图床，正文里留下稳定绝对地址，微信粘贴时自行转存。

线上实例：<https://wechat.yoru-and-akari.dev>

## 它能做什么

- **两百余套排版主题**：按风格（商务 / 政务 / 科技 / 杂志 / 中国风 / 暗色 …）、复杂度、色系、
  来源项目筛选；所有主题渲染同一份样例，视觉差异直接可比。每套主题都标注原项目、原作者、
  许可证与 lineage，点「来源」可查完整署名。
- **为公众号而生的 Markdown 方言**：关键词下划线、带序号的章节标题、金句卡片、引文框、
  居中强调句、多图轮播、署名块、GFM 表格，全部映射成全内联样式的 `<section>` 结构。
- **轮播画幅真裁切**：同一轮播里的图在上传前就在浏览器里裁成统一比例（4:3 / 3:4 / 16:9 /
  9:16 / 1:1），不靠 `object-fit` 或固定高度伪造——公众号会丢掉那些写法。
- **稿件双写**：浏览器 localStorage 每次改动防丢；云端数据库跨设备可见，「保存到草稿箱」
  才进归档。草稿箱支持搜索、续写、复制 Markdown、删除。
- **素材库**：存储用量、没在用的旧图批量清理、最近 200 张图在用状态一览。
- **不用注册也不用登录**：排版、上传图片、复制、导出全都直接可用；口令只用来打开站长自己的
  云端草稿箱。匿名上传有额度与内容校验，见「公开之后靠什么挡滥用」。

## 快速开始

```bash
npm ci
cp .env.example .env      # 填好「环境变量」一节的六项
npm run dev               # 本地开发
npm run build && npm start  # 生产模式
```

## 核心设计

语义与视觉分离，这条线不能破：

```
Markdown → 语义 AST（src/lib/parse.ts）→ 主题模板（src/lib/theme-kit.ts）→ 全内联样式 HTML
```

主题库由 `scripts/themes/import.ts` 从多个开源项目聚合生成（`src/lib/themes-imported/`），
来源、授权与移植损耗的完整审计见 [`THEME-SOURCES.md`](./THEME-SOURCES.md)。

## 公众号专用语法

| 语法 | 效果 |
|---|---|
| `==重点==` | 关键词标记 |
| `## KICKER \| 标题` | 章节标题，序号自动编号 |
| `> 金句卡片` | 金句卡片 |
| `:::quote` … `:::` | 引文框 |
| `:::center` … `:::` | 居中强调句 |
| `![图注](src)` | 图片；`src` 留空 = 占位，图号自动编排 |
| `:::carousel 4:3 标题` … `:::` | 轮播，内部每行一张 `![](…)` |
| `:::gallery 3 1:1 标题` … `:::` | 多图网格；列数 `2`/`3`/`4` 与比例都可省略 |
| `$$ … $$` | 数学公式，独占一段，渲染成内联 SVG |
| ` ```mermaid 图注 ` … ` ``` ` | 流程图/时序图，栅格化成 PNG 后作为插图上传 |
| `@signature` | 署名块 |
| front matter `titles` / `cover` | 标题候选与封面建议，只进侧栏，不进正文 |

### 公式

`$$…$$` 独占一段就是一个块级公式（也接受写成一行）。MathJax 用 `liteAdaptor` + `fontCache: 'none'`
在浏览器里把 TeX 转成内联 SVG——每个 SVG 自带完整 `<path>`，不引用共享 `<defs>`、不依赖外部
字体或 CSS，这是它能活过公众号粘贴的前提（2026-10-07 实粘验证过三种写法）。

mathjax-full 有几 MB，所以**按需加载**：首屏不含它，只有文档里真的出现 `$$` 才拉分包，每个公式
的结果按内容缓存。加载完成前显示 TeX 占位；TeX 编译不过时显示「公式无法编译」+ 源码，而不是
MathJax 默认的红色错误盒子（那个盒子带 `data-mjx-error` 和一个镜像的 `<text>`，会被原样粘进正文）。

### 图表

` ```mermaid ` 代码块会在作者停手约 1.2 秒后渲染成 PNG，走和普通图片完全相同的上传链路，正文里
最终是一个 `<img>`，图号一起编排。围栏后面可以跟图注：` ```mermaid 渲染链路 `。

**为什么不是内联 SVG**：mermaid 的 SVG 带 `<style>`、`class`、`id` 和 `<foreignObject>` 里的 HTML
标签，几乎撞上每一条公众号红线。doocs/md 靠 1400 多行消毒逻辑把它救回来，但那套逻辑依赖
`getBBox` / `getComputedStyle` 这类只有活 DOM 才有的 API，而我们的渲染链是纯函数返回字符串。
栅格化成图片之后，输出就是一张普通插图：红线天然满足，还自动进素材库、能被统计和重裁。代价是
图里文字不可选、深色模式不跟随、改一个字要重新上传（源码即缓存键，改了就重渲）。

图表要上传，所以**需要登录**；没登录时正文里保留 mermaid 源码。源码永远是真相源，PNG 只是它的
缓存，映射存在浏览器本地（`mopai.diagrams.v1`，最多 50 条），换设备会重新生成一次。

### 轮播画幅比例

`:::carousel` 后面可以跟一个比例：`4:3`（默认）、`3:4`、`16:9`、`9:16`、`1:1`。省略就用 4:3，老稿件不用改。

一个轮播里所有图片必须同比例——混比例就不叫统一了。所以流程是：在轮播里点第一张图的「上传」，先选比例，图片会**在浏览器里居中裁切**成该比例再上传，之后这个轮播里剩下的图自动沿用同一比例。

裁切发生在上传前，因为公众号会丢掉 `object-fit` 和固定高度那类"假装统一"的写法。真正进 R2 的已经是裁好的图，正文里按属性给出确定宽高，微信把宽度压小后高度按固有比例走，画框比例任何宽度下都不变。

裁掉的部分不保留。想换比例要重新上传原图——这是刻意的取舍，换的是存储干净。

### 多图网格

```md
:::gallery 3 4:3 现场花絮
![第一张]()
![第二张]()
![第三张]()
![第四张]()
:::
```

列数和比例都可省略：`:::gallery 3` 是三列正方形，`:::gallery 现场花絮` 是两列正方形带标题。两者的区分规则是**裸整数算列数、带冒号的算比例**，所以 `:::gallery 4:3 标题` 读作「默认两列 + 4:3」而不是「4 列」。列数只吃 `2`/`3`/`4`；写成别的（比如 `:::gallery 7 张现场图`）不会被当成列数，而是原样留在标题里——宁可标题怪一点，也不要静默改用户的意图。

和轮播的区别是**读者一次看到几张**：轮播一次一张、左右滑；网格一眼看全，适合并列的现场图、对比图、步骤图。两者共用同一套「上传前真实裁切到统一画框」的机制，所以网格里每一格也是同比例的。

**行齐靠的是裁切，不是标记。** 格子的 `width`/`height` 属性只在图片加载前占住位置、防止页面跳动；实测下来，一张自身比例和属性不符的图仍然按它自己的比例渲染（4:3 的格子里塞一张 1:2 的图，它比邻居高出两倍多）。所以只要图是走右侧面板上传的，就会被裁成 fence 里写的比例，行自然是齐的；而**绕过裁切进到格子里的图**（手写的外链，或者 Agent 通过 API 推进来的）会保留自己的形状，那一行就不齐。这在平台规则内没有标记层的解法——能用的两招正好就是 `object-fit` 和固定高度，一个会裁掉画面内容，一个会把不同形状的图压出白边，而这两样公众号都会丢掉。

比例写在 fence 那一行，不在右侧面板里选（面板的比例选择器只属于轮播）。改了比例意味着已经传上去的图不再匹配新画框，需要重新上传——这一点和轮播一致，只是轮播会在改比例时主动提醒你。

布局用的是**百分比宽度的 inline-block 格子** + 图片 `width:100%;height:auto`，不是 `display:grid`：公众号编辑器会丢掉 grid 和 float，`object-fit` 会把图片内容裁掉，固定高度又会把不同形状的图压出白边。格子宽度向下取整，因为一行百分比加起来只要超过 100，最后一格就会掉到下一行，看起来像网格坏了而不是间距紧了一点。

## 图片链路

```
上传（编辑器拖拽 / 右侧素材清单按钮）
  → tRPC storage.upload → mopai-images Worker → R2 桶 mopai-assets
  → Markdown 回填 img:<key>
渲染时 resolveImg 把 img:<key> 展开为 https://wechat.yoru-and-akari.dev/api/img/<key>
  → 站点 302 → https://mopai-img.yoru-and-akari.dev/img/<key>（R2 真图）
```

复制/导出的 HTML 里是**稳定绝对地址**，微信粘贴时自行转存。key 永不过期，所以这个地址可以一直用。

## 部署形态

| 部件 | 位置 |
|---|---|
| 站点 | cc-tokyo-01 `/opt/mopai/app`，Node 直跑 `dist/boot.js`，监听 127.0.0.1:3100 |
| 进程 | `mopai.service`（systemd，内存上限 384M）+ `cloudflared-mopai.service` |
| 入口 | Cloudflare Tunnel → `wechat.yoru-and-akari.dev` |
| 门禁 | **站点公开**，谁都能打开用；`ACCESS_KEY` 只决定谁能用云端草稿箱。曾经的 Cloudflare Access 邮箱验证已于 2026-10-08 撤掉（当时借已登录的 dashboard 会话删的，因为本机 token 只读；`scripts/cf-open-public.sh` 是可复现路径），要关回去跑 `scripts/cf-create-access.sh` |
| 图片公网读 | `/api/img/*` **必须能匿名访问**，微信重新托管图片时要抓得到，否则粘贴进公众号后图全丢。站点公开时天然满足；若将来加上 Access，要同时给它建一个 bypass 应用，且绝不能连带放行 `/api/trpc/*` |
| 图片 | Worker `mopai-images` → R2 `mopai-assets`；Worker 持有 R2 binding，**服务器上不存在任何 S3 凭证** |
| 数据 | SQLite（Node 内置 `node:sqlite`），文件在 `/opt/mopai/app/data/mopai.db` |

### 公开之后靠什么挡滥用

站点没有门禁、上传不用登录，所以防护是分层的，每一层都写清楚它挡什么：

| 层 | 措施 | 位置 |
|---|---|---|
| 应用 | 每 IP 每分钟 12 次上传（内存计数，重启即清） | `api/lib/burst.ts` |
| 应用 | 每 IP 每 UTC 日 100 张（内存计数）——访客额度挂在可删的 Cookie 上，这条让换 Cookie 慢灌变贵 | 同上，`ANON_IP_DAILY_IMAGES` |
| 应用 | 每访客滚动 24 小时 30 张 / 100 MB | `api/lib/anon-quota.ts` |
| 应用 | 全部匿名上传合计 1.5 GB 封顶 | 同上，`ANON_TOTAL_BYTES` |
| 应用 | 匿名图回收（GC）：`ownerId=0`、超过 `ANON_GC_DAYS`（默认 14 天）、且没有任何云端稿件引用（正文里搜不到 `img:<key>`）的图删掉——上面那个 1.5 GB 池子因此是循环的，不会填满一次就永久拒客。启动 1 分钟后跑一次，之后每 24 小时一次；先让 Worker 确认对象已删，再删账本行，Worker 失败就留着下次重试 | `api/lib/anon-gc.ts` |
| 应用 | 只认字节头是 jpeg / png / gif / webp 的图；**对外提供的 Content-Type 由字节决定，不信请求头** | `api/lib/image-type.ts` |
| 应用 | 匿名图片按访客 Cookie 的哈希归属，别人列不出也删不掉 | `api/lib/visitor.ts` |
| 运维 | 每次拒收写一行 `[upload-deny] 原因 key=value` 到服务日志（burst / ip-daily / quota / bad-magic，两扇门都写），晨报定时任务 grep 它 | `api/lib/deny-log.ts` |
| 运维 | 每次 GC 跑完写一行 `[anon-gc] deleted=N bytes=B failed=F days=D` 到服务日志（删不掉的另写 `[anon-gc] delete-failed key=… reason=…`）。格式固定，晨报定时任务一起 grep | `api/lib/anon-gc.ts` |
| 运维 | 匿名池应急清理：`sudo bash /opt/mopai/scripts/server-anon-purge.sh --days N` 先干跑、`--apply` 才删，只碰 ownerId=0 | `scripts/server-anon-purge.sh` |
| 既定 | agent 门上传落 ownerId=1，**不计入**匿名池封顶——它是站长自己的流量，匿名池只度量陌生人；agent 门默认关（`AGENT_TOKENS` 留空），开不开由站长配令牌决定 | 2026-10-08 拍板 |
| 边缘 | 高威胁分数请求走 managed challenge、扫描器 UA 直接拦、路径穿越与危险方法拦掉 | zone 上已有的 WAF 自定义规则 |
| 边缘 | AI 爬虫保护 = block | Cloudflare 账户设置 |

GC 有一个**明知且接受**的漏洞：匿名访客的稿件只存在他们自己浏览器的 localStorage 里，服务端看不见，所以「14 天前传的图，某个访客的本地草稿还在引用」这种情况会被误删。这和应急脚本 `server-anon-purge.sh` 是同一个口径，不是遗漏——匿名图本来就是用完即走的，而池子填满会让**所有**真实访客传不了图，两边权衡之后选择让池子循环。有了 GC 之后那个脚本降级成手动超驰（想立刻收回空间、或想把阈值临时改小时用），不再是唯一的清理入口。要图片长期有效就走登录后的云端草稿箱：站长的图 `ownerId≠0`，GC 永远不碰。

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

## 稿件存储

写盘分两条路，刻意分开：

| 存在哪 | 什么时候写 | 作用 |
|---|---|---|
| 浏览器 localStorage | 每次改动 | 防丢。关页面、断电，回来内容还在 |
| 云端数据库 | 分两种，见下 | 跨设备可见 |

云端只在两种情况下写：

1. **自动同步**：这篇已经被保存过（`savedAt` 有值），编辑后 900ms 防抖更新同一条记录
2. **手动保存**：点顶栏「保存到草稿箱」，写内容并把 `savedAt` 打上时间戳

`docs.savedAt` 为 null 表示只是编辑中的工作稿。**草稿箱只列 `savedAt` 有值的**，所以自动同步的工作稿不会混进归档，一篇稿件也永远只占一条记录（不会因为多存几次就多出几条）。

- 登录后首次打开：如果云端一篇都没有、浏览器里有，会把浏览器里的一次性推上云（`docs.importLocal`），**但不会标记成已保存**——要进草稿箱得你点保存。
- 顶栏状态：`已保存` / `保存中` / `未保存`（有改动还没进草稿箱，按钮会变蓝）/ `仅本机`（未登录）。
- 未登录照样能编辑、上传图片、复制和导出，只是稿件内容留在这个浏览器里；云端草稿箱才需要口令。

## 草稿箱

`/drafts`（顶栏「草稿箱」按钮）。按保存时间倒序列出所有保存过的文章，显示保存时间、字数、图片数、轮播数、前三个小标题。

支持：搜索标题或正文、打开继续编辑、复制 Markdown、删除。

一篇文章一条记录，没有版本历史——点保存是更新那一条，不会堆出多个版本。

## 编辑器补全

按 `Ctrl/⌘ + Space` 主动唤出，或在行首、`:::`、`@`、`#`、`>`、`![`、`==` 之后自动出现。覆盖全部公众号语法，插图模板会把光标停在图注位置。

## 素材库

`/materials`（顶栏「素材库」按钮）。看得到：

- **存储用量**：登录时显示张数、总字节与上限进度条，上限由 `STORAGE_QUOTA_BYTES` 控制，默认 2 GB——R2 免费额度是 10 GB 且桶与其他项目共用。未登录时这里换成「这台浏览器上传的图」，列出本浏览器的张数、字节和 24 小时额度。
- **没在用的旧图**：不再被任何一篇云端稿件引用的图，勾选后批量清理。删除前会把勾选列表原样回传，界面上看到的就是会被删的。未登录时判据只有浏览器里的本地稿件（云端稿件本来也读不到）。
- **全部图片**：最近 200 张，标注「在用 / 没在用」，可单张删除。

匿名上传的图片归属那个浏览器 Cookie（服务端只存它的哈希），清掉站点数据就再也列不出来。已经回填进正文的 `img:<key>` 地址在被回收之前照旧可用，但**不是永久的**：超过 `ANON_GC_DAYS`（默认 14 天）又没有任何云端稿件引用的匿名图会被 GC 删掉（见「公开之后靠什么挡滥用」）。要图长期有效，就用 `ACCESS_KEY` 登录后把稿件存进云端草稿箱——站长的图 GC 永远不碰。

删图不影响已经粘贴到公众号的文章——微信发布时已把图转存到它自己的服务器。

## Agent 接入

给 coding agent（Claude Code / Qoder / Codex / 一个定时任务）用的门。完整往返是三步：

```
agent 推初稿 → 拿回 editorUrl 交给人 → 人在浏览器里排版精修 → agent 读回精修结果
```

它是**独立于浏览器的另一扇门**：浏览器走 tRPC + cookie session，agent 走 `/api/agent/*` 的朴素 REST + Bearer 令牌。这样一行 curl 就能验证，也能写一个零依赖的客户端脚本（superjson 的 wire format 做不到这一点）。两扇门共用同一张 `docs` 表，所以 agent 推的稿子在网页里就是普通一篇。

```bash
curl -H "Authorization: Bearer mopai_xxx" https://<你的域名>/api/agent/whoami
```

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/agent/whoami` | read | 凭证自检，返回令牌名、scope、服务端时间 |
| GET | `/api/agent/docs?limit=&offset=&q=&saved=1` | read | 列表，**不含正文**，只给 `chars` |
| POST | `/api/agent/docs` | write | 建稿，返回 `id` / `hash` / `editorUrl` |
| GET | `/api/agent/docs/:id` | read | 读回 Markdown 与 `hash` |
| PUT | `/api/agent/docs/:id` | write | 改稿，带 `baseHash` 时是乐观锁 |
| POST | `/api/agent/images` | write | multipart `file`，返回 `img:<key>` |
| GET | `/api/agent/themes` | read | 实时主题表，客户端不必硬编码 |

几条刻意的设计：

- **agent 不能删稿。** 没有 DELETE 端点，回收站里的稿子它也看不到、改不动（404）。删除始终是人在网页里做的动作。
- **推上来的稿子天生就是「已保存」的**（`savedAt = now`）。这不是装饰：浏览器的自动同步只回写 `savedAt` 有值的稿件，如果留空，人在网页里改的东西刷新一次就变回 agent 推的原文——静默丢稿。
- **乐观锁用内容 hash，不用时间戳。** `updatedAt` 落库是秒级精度、带的还是客户端时钟，同一秒内的两次写入分不出来，agent 会在毫无察觉的情况下冲掉人工精修。`hash` 是正文 sha256 的前 16 位；对不上就 **409**，响应里带服务端的当前正文和新 hash，「重读再决定」而不是盲目重试。不带 `baseHash` 就是无条件覆盖。
- **图片引用改写成 `img:<key>`**，不是绝对 URL。网页会把它展开成自己的稳定图片地址，那个地址才是能粘进公众号的。
- 每篇稿子记着是谁推的（`source = agent:<令牌名>`），草稿箱里会标出来。

### 用随仓库发的 Skill

`skills/wechat-typesetter/` 是一个零依赖的 Python 3 客户端（`scripts/mopai.py`，标准库而已，Windows / Linux 通用）。把它拷进你的技能目录，或直接在仓库里跑：

```bash
python skills/wechat-typesetter/scripts/mopai.py set-token mopai_xxx
python skills/wechat-typesetter/scripts/mopai.py push --file draft.md
# → {"ok":true,"id":"…","editorUrl":"https://…/?doc=…","hash":"…", …}
python skills/wechat-typesetter/scripts/mopai.py get <id> --out draft.md   # 读回人工精修的结果
```

推送时它会扫正文里的本地图片、逐张上传、把引用换成 `img:<key>`；单张失败不中断，原因进 `warnings`。细则见 `skills/wechat-typesetter/SKILL.md`。

### 令牌

在服务端 `.env` 里配 `AGENT_TOKENS=<名字>:<令牌>[:read]`，逗号分隔多个，一个 agent 一条（删掉那行就等于吊销它，不影响别人）。生成一条：

```bash
python -c "import secrets,base64;print('mopai_'+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
```

`AGENT_TOKENS` 留空（默认）时，`/api/agent/*` 全部 401——这个功能是关着的。它**不是**浏览器的凭证，`ACCESS_KEY` 仍然是人类登录口令。

当前这个域名**没有** Cloudflare Access 门禁（2026-10-08 实测），所以配好令牌之后远程 agent 直接就能用，不需要额外放行。将来若给整站加上 Access，则要单独给 `/api/agent/*` 建一个 bypass 应用（认证交给 Bearer 令牌），并且**绝不能把 `/api/trpc/*` 一起放进去**——那个前缀里有 `auth.login`，放开等于把口令暴露给公网爆破。

## 环境变量

复制 `.env.example` 为 `.env`。生产环境必需的六项：

| 变量 | 用途 |
|---|---|
| `NODE_ENV` | 生产下必须为 `production` |
| `PORT` | 默认 3100 |
| `DATABASE_URL` | `file:./data/mopai.db` |
| `ACCESS_KEY` | 站长口令：登录后才有云端草稿箱。**上传图片不需要它**。`openssl rand -hex 24` |
| `SESSION_SECRET` | 会话签名。`openssl rand -hex 32` |
| `IMG_BASE_URL` | 图片 Worker 地址 |
| `IMG_ADMIN_KEY` | 与 Worker secret 同值。`openssl rand -hex 32` |

可选项，用来收紧「不登录也能上传」的额度、以及决定这个池子怎么回收（默认值就是线上跑的）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `ANON_DAILY_IMAGES` | 30 | 每个访客（按浏览器 Cookie 认）滚动 24 小时内的张数 |
| `ANON_DAILY_BYTES` | 100 MB | 同上，字节数 |
| `ANON_TOTAL_BYTES` | 1.5 GB | 所有匿名上传加起来的总上限——桶是共享免费额度 |
| `ANON_BURST_PER_MINUTE` | 12 | 每个来源 IP 每分钟，内存计数，用来挡住灌水 |
| `ANON_IP_DAILY_IMAGES` | 100 | 每个来源 IP 每 UTC 日，内存计数；访客额度挂在可删的 Cookie 上，这条让换 Cookie 慢灌变贵 |
| `ANON_GC_DAYS` | 14 | 回收的年龄阈值（天）：`ownerId=0`、比这更旧、又没有云端稿件引用的图会被删。写 `0` 等于「只要没被引用就删」 |
| `ANON_GC_ENABLED` | `true` | 只有写成字符串 `false` 才关闭回收；关掉之后池子只进不出，回到 2026-10-08 之前那个填满即拒客的行为 |

其它可选项：

| 变量 | 用途 |
|---|---|
| `AGENT_TOKENS` | `/api/agent/*` 的令牌，`名字:令牌[:read]` 逗号分隔。留空则该功能关闭 |
| `PUBLIC_BASE_URL` | 拼 `editorUrl` 用的绝对源。留空则取请求自己的 origin（在 Tunnel 后面就是公网地址） |
| `STORAGE_QUOTA_BYTES` | 素材库显示的用量上限，默认 2 GB |
| `HOST` | 监听地址，默认 `127.0.0.1` |

## 本地开发

```bash
npm ci
cp .env.example .env      # 填好上面的变量
npm run dev               # Vite + Hono 同端口 3000
```

## 常用命令

```bash
npm run check             # tsc -b，零错误
npm run build             # 产出 dist/boot.js（自包含）+ dist/public/
npm start                 # 生产模式跑 dist/boot.js
npm run verify:themes     # 全部主题渲染 + 公众号红线 + catalog 完整性/许可证校验
npm test                  # vitest：解析、渲染、上传额度、数据库升级
node scripts/cdp-verify-public-access.mjs http://127.0.0.1:3201 9335
                          # 真浏览器验收：以「从未登录的访客」身份走一遍上传全链路
```

`npm run verify:themes` 会把每套主题的干净正文与预览页写到 `verify-out/`，可直接用浏览器打开检查排版；同时校验 catalog 里每套主题的来源档案齐全、许可证文件真实存在。

`scripts/` 下还有一组真实浏览器验收脚本（headless Chrome + CDP），需要 `npm run build` 之后跑：

```bash
node scripts/cdp-verify-agent.mjs      # Agent 推稿 → 浏览器打开 → 人工精修 → agent 读回
node scripts/verify-agent-skill.mjs    # 直接驱动 skills/wechat-typesetter 的 Python 客户端
node scripts/cdp-verify-diagram.mjs    # mermaid fence → 上传插图
node scripts/cdp-verify-trash.mjs      # 回收站（含未登录路径）
```

前两个自带内存里的假图床（`PUT /api/upload` + `GET /img/:key`），整条上传链路真跑，但一个字节都不会写进生产 R2。`verify-agent-skill.mjs` 在没装 Python 3 的机器上会明确 SKIP 并以 0 退出。

## 部署

构建产物是自包含的，**服务器上不需要 `npm ci`**（Tokyo 机器只有 2 GB 内存，装依赖会 OOM）：

```bash
# 本地
npm run build
tar -czf /tmp/mopai-release.tar.gz dist
scp /tmp/mopai-release.tar.gz cc-tokyo-01:/tmp/

# 服务器
bash scripts/server-install-release.sh
```

`scripts/` 下的脚本按用途分三类，都是幂等的：

- `cf-create-bucket.sh` / `cf-create-tunnel.sh` / `cf-create-access.sh` / `cf-open-public.sh` — Cloudflare 侧资源与门禁开关
- `server-bootstrap.sh` — 用户、目录、systemd 单元、cloudflared 配置
- `server-install-release.sh` — 解包、安装、重启
- `server-acceptance-test.sh` — 服务器上跑一遍上传回路验收

Cloudflare 脚本要一个**有写权限**的 token（`Zone → Rulesets Edit`、`Account → Access → Apps and Policies Edit`），自己 export 进环境：

```bash
export CLOUDFLARE_API_TOKEN=...
bash scripts/cf-open-public.sh --check
```

只读 token 不会报「权限不足」，而是写操作统一返回 **HTTP 405 / 错误码 10405 `Method not allowed for this authentication scheme`**——看到它就说明该换 token 了。

往服务器推脚本时用 `scripts/stage-to-tokyo.sh`，不要直接用 PowerShell 管道：

```bash
wsl -e bash scripts/stage-to-tokyo.sh 'E:\...\scripts\server-install-release.sh' /tmp/install.sh
```

PowerShell 管道会把末尾换行转成 CRLF，bash 会在最后一行报 `$'\r': command not found`。上面的脚本走 Windows → WSL → ssh，字节原样过去，并在远端复查 CR 数量。

## 公众号兼容红线

改动渲染层时必须守住，`npm run verify:themes` 会逐条机器校验：

- 正文根节点唯一 `<section>`（嵌套 `<section>` 允许，顶层只能一个）
- 全内联样式；所有文字节点包在 `<span leaf="">` 里
- 不用 `class` / `id` / `<script>` / `<style>` / `<div>`
- 不用 `position:fixed|absolute|sticky`、`float`、`display:grid`、`@media`、`@keyframes`
- 卡片 / 引文框 / 轮播等盒式模块前后自动插独立空行 `<p style="margin:0;"><span leaf="">&nbsp;</span></p>`
- 无 `src` 的图片占位渲染为独立普通段落（`图N 说明`），删掉即可在公众号后台直接插图
- `img:<key>` 协议形状不变

golden 主题的每个组件样式与示范稿 `公众号排版示范稿_GoldenSample_修正版.html` 逐段一致（该文件如另有提供，以提供版本为准）。

## 许可证与第三方主题署名

本仓库以 **AGPL-3.0-or-later** 授权，正文见根目录 `LICENSE`。线上服务按 AGPL 第 13 条
向使用者提供完整对应源码：仓库公开、部署分支可对应到公开提交即满足；在仓库公开之前
部署含 copyleft 主题的构建，属于尚未履行该义务的状态。

主题库聚合了多个开源项目，共 219 套。每套主题在模板库卡片上点「来源」可看到原项目、
原作者、许可证、lineage 与移植改动；上游许可证原文留存在 `app/licenses/`；完整来源审计、
未接入清单与移植中的有损转换见 [`THEME-SOURCES.md`](./THEME-SOURCES.md)。

按上游许可证分组：MIT 207 · AGPL-3.0-or-later 6 · GPL-3.0-only 2 · Apache-2.0 1 · 本项目自研 3。

- 6 套 gzh-design-skill 主题（AGPL-3.0-or-later）与 2 套 mdnice 派生主题（GPL-3.0-only）
  是本仓库选择 AGPL 的直接原因：前者有传染性且第 13 条覆盖网络服务，后者依
  AGPL 第 13 条第二段允许与 AGPL 作品组合。
- MIT / Apache-2.0 / WTFPL 来源可单向并入 AGPL 项目，各自的版权声明与许可文本已按要求保留。

界面字体自托管：Geist / Geist Mono 与 Noto Sans SC（后者按 google 式 unicode-range 切片，
浏览器只下载当页用到的切片），三者均为 SIL Open Font License 1.1；许可正文见
`app/public/fonts/OFL-NotoSansSC.txt` 与 Geist 随附许可。预览纸与复制出去的 HTML 不使用
webfont——读者端字体由微信决定，屏幕所见必须等于发出去的样子。

## Acknowledgements / 致谢

这个工具的能力有一大部分是站在别人的开源工作上长出来的。下面按「我们到底拿了多少」分组，每条都写清具体是哪个文件的哪套机制，以及——同样重要——我们评估过但主动放弃的部分和放弃的理由。

唯一事实来源是 `src/lib/credits.ts`；站内的 `/references` 页面直接读它，本节是它的人读版本。三处如有出入，改数据文件。

### 许可证核实

2026-10-07 逐个打开上游 LICENSE 文件核对（不是从 README 或 `package.json` 的 `license` 字段推的），核对的 commit 与副本 md5 记在 `LICENSES/NOTICE.md`。

| 上游 | LICENSE | LICENSE 里的版权行 | 副本 |
|---|---|---|---|
| [doocs/md](https://github.com/doocs/md) | **WTFPL v2** | `Copyright (C) 2025 Doocs <admin@doocs.org>` | `LICENSES/doocs-md-LICENSE.txt` |
| [laogou717/md-wechat](https://github.com/laogou717/md-wechat) | MIT | `Copyright (c) 2026 字间排版` | `LICENSES/laogou717-md-wechat-LICENSE.txt` |
| [alchaincyf/huasheng_editor](https://github.com/alchaincyf/huasheng_editor) | MIT | `Copyright (c) 2024 花生 (alchaincyf)` | `LICENSES/alchaincyf-huasheng_editor-LICENSE.txt` |
| [din4e/MDInline](https://github.com/din4e/MDInline) | MIT | `Copyright (c) 2026 din4e` | `LICENSES/din4e-MDInline-LICENSE.txt` |
| [caol64/wenyan-core](https://github.com/caol64/wenyan-core) | Apache-2.0 | 标准附录，未填具体版权人（`package.json` author: Lei） | `LICENSES/caol64-wenyan-core-LICENSE.txt` |
| [caol64/wenyan-ui](https://github.com/caol64/wenyan-ui) | Apache-2.0 | 同上 | `LICENSES/caol64-wenyan-ui-LICENSE.txt` |
| [caol64/wenyan](https://github.com/caol64/wenyan) | Apache-2.0 | 同上 | `LICENSES/caol64-wenyan-LICENSE.txt` |
| [foolgry/editor](https://github.com/foolgry/editor) | MIT | `Copyright (c) 2024 花生 (alchaincyf)`（继承自 huasheng_editor） | `LICENSES/foolgry-editor-LICENSE.txt` |

八个上游全部是宽松许可：WTFPL v2 × 1、MIT × 4、Apache-2.0 × 3。**没有 GPL / AGPL / SSPL 一类 copyleft，也没有任何项目缺失 LICENSE 文件**，因此它们对本项目自己选开源许可证不构成传染性约束。三点需要留意：

1. **doocs/md 是 WTFPL v2，不是 MIT。** 许可极度宽松、无传染性，但正式名称含粗口，致谢文案里怎么写要定一个口径（原样标注 `WTFPL v2`，或写成 "a permissive public-domain-style license"）。
2. **foolgry/editor 是 huasheng_editor 的 fork**（其 README 第 13 行明说），LICENSE 字节与上游相同、版权行都写「花生 (alchaincyf)」；foolgry 自己新增的分享服务、Go 后端、Mermaid 和发布 Skill 没有单独版权行，沿用同一份 MIT 条款。
3. **wenyan / wenyan-core / wenyan-ui 三个仓库的 LICENSE 字节完全相同，都是 Apache-2.0**，带专利授权和 NOTICE 义务。目前我们只借鉴思路、代码自己写；一旦直接复制它的代码，就要保留版权声明并注明改动。

### 移植（ported）

机制已经落在我们的代码里，实现与上游高度对应。

**[laogou717/md-wechat](https://github.com/laogou717/md-wechat)**（MIT，字间排版）

- 外链转脚注。公众号只保留 `mp.weixin.qq.com` 域名的可点击链接，其余外链粘贴时会被剥掉、只剩文字。上游 `src/lib/renderer.js:523` 的 `link_footnote` 规则把 `link_open` 换成 `span_open`、链接文字后补上标 `[n]`、网址收进文末【参考资料】。我们落在 `src/lib/render.ts` 的渲染层（`isFootnotable` + `createLinkRegistry` + 主题的 `footnotes()`），因为我们有自己的语义 IR，不需要动 markdown-it 的 token 流。
- 富文本复制的降级路径。上游 `src/lib/clipboard.js` 的 `legacyCopy`：离屏 `contentEditable` div + `Range.selectNodeContents` + `execCommand('copy')` + 用完移除。我们的 `src/lib/clipboard.ts` 是同一套兜底，主路径同样是 `ClipboardItem` 的 `text/html` + `text/plain` 双通道。
- *没采用*：IndexedDB 图片短引用链路（`src/lib/imagedb.js`，复制前还原成 data URI）——我们的图走 R2 + `img:<key>`，data URI 会把几 MB base64 塞进正文；`justifiedWidths` 两端对齐多图网格和 `object-fit:cover` 裁切——按固定比例裁切会切掉图片内容，违反公众号红线；它的 markdown-it core ruler 改写体系（`list_flat` / `block_context` / `gallery`）——我们的解析器直接产出语义 IR，没有 token 流可改。

**[alchaincyf/huasheng_editor](https://github.com/alchaincyf/huasheng_editor)**（MIT，花生）

- 富文本粘贴前的四道闸门（上游 `app.js:2679-2852`）：`[Image #N]` 占位符直接拒绝并提示改用截图工具/浏览器复制/拖拽 → `isMarkdown(text)` 命中就原文插入不做转换 → `isIDEFormattedHTML` 识别 VS Code / Ace 签名 → `isMainlyCode` 识别整段代码。这是防止「从别的 Markdown 编辑器复制过来，Turndown 把 `**粗体**` 转义成 `\*\*粗体\*\*`」的关键。已落在 `src/lib/rich-paste.ts`（gate 1-4，聚合出口 `shouldConvertHtml`）。我们改了计分方式：上游是「13 个模式命中 ≥2」的扁平计数，两个弱信号就能定案；我们按强/弱加权，块级结构单独定案、纯内联线索必须有搭档。
- Turndown 的配置方式（上游 `app.js:2557-2629` 的 `keep([...table tags])` + `addRule('table')` + `addRule('image')`）。已落在 `src/lib/rich-paste.ts` 的 `createService`：`addRule` 铺出 `dialectHeading` / `dialectMark` / `dialectImage` / `dialectTable*` / `dialectBlockquote` / `dialectCenter` 等一整套规则，直接产出我们的公众号方言；转换前先跑 `cleanHtmlSource` 清掉 Word 条件注释与 VML、Office 命名空间标签、`Mso*` class、`data-*`/`aria-*` 属性。上游运行时从 jsDelivr 拉 turndown，我们打进包。
- 图片压缩（上游 `app.js:243-330` 的 `ImageCompressor` + `:2195-2230` 的 `recompressForClipboard`）。已落在 `src/lib/image-compress.ts` 并做了推广：最长边从固定 1920 改成按公众号正文实宽推出来的 2048（677px 容器 − 20px padding = 657 CSS px，× 3 DPR ≈ 1971，取 2 的幂），两段固定档改成「800 KB 目标体积 + quality 从 0.9 每次减 0.1 走到 0.6」的阶梯。上游那条「压完更大就用原图」的判断保留成 `grew` 标志。目标体积这一维上游没有，是我们加的。
- *没采用*：多图网格的 360px 固定高 + `object-fit:contain` + 灰底（`app.js:1676-1722`），竖图两侧会留大片灰底；「markdown-it → HTML 字符串 → DOMParser → 按选择器追加 style」的渲染路线（`applyInlineStyles`），主题是查表而我们是模板函数；无构建的单文件工程形态。

### 适配（adapted）

思路已经落地，但围绕我们自己的语义 IR 重写过，不是逐行搬运。

**[doocs/md](https://github.com/doocs/md)**（WTFPL v2，Doocs）

- 双向同步滚动改用「块映射」而不是总高度百分比。上游 `apps/web/src/composables/useScrollSync.ts` 的注释原文就是 "Uses block-based mapping (not simple pixel ratio) so large content skew between panes stays accurate"，配套 `apps/web/src/lib/preview/scroll-sync-blocks.ts` 负责切块和映射。我们的 `src/lib/sync-scroll.ts` 是同一思路的独立实现：块边界取自解析器语义 IR 的 `line`/`lineEnd`，块内用进度插值（`progressInBlock` / `lineAtProgress`），再加 `fillBlockOffsets` 补上「这个块没渲染出元素」的空洞。
- 滚动事件用一次 `requestAnimationFrame` 收口再做映射计算。上游用 rAF 清 `isSyncingFromEditor` / `isSyncingFromPreview` 标志来吞掉自己那次程序化滚动的回声；我们的 `src/hooks/useSyncScroll.ts` 把整次映射放进 rAF，配合 110ms 空闲窗口决定哪一侧拥有同步权。
- 公式的产出形态。上游和 wenyan-core 走的是同一条 MathJax tex-svg + `fontCache: 'none'` 的路（`packages/core/src/utils/mathjax.ts:56`），两家独立佐证了「这样产出的 SVG 能活过公众号粘贴」；我们照这条路线实现在 `src/lib/math.ts`。
- *没采用*：mermaid 走内联 SVG（`extensions/mermaid.ts` 147 行 + `utils/wechat-svg.ts` 1434 行）。为了让图表 SVG 活过粘贴，上游把 `<foreignObject>` 里的 HTML 标签手工重写成真正的 SVG `<text>`/`<tspan>`、推开重叠的边标签、夹住最小字号、把真实像素宽高写进属性并封顶 677px；这套消毒依赖 `getComputedStyle` / `getBBox` / `getTotalLength`，全是只有活 DOM 才有的 API，渲染时机也是异步回填（先返回占位 div，渲染完 `getElementById(id).innerHTML = svg`）。我们的渲染链是纯函数返回字符串、`dangerouslySetInnerHTML` 一次性替换，接这套等于放弃「预览就是复制出去的那份字符串」。所以图表改走 mermaid → SVG → canvas → PNG → 现成的图片上传链路 → 普通 `<img>`，红线天然满足，还自动进素材库。代价是图里文字不可选、深色模式不跟随。
- *没采用*：它的持久化分层（`apps/web/src/storage/`：IndexedDB 引擎 + repositories + quota + migrate）——我们已经是 localStorage 草稿 + 服务端 SQLite 双写，再插一层只会多一个要保持一致的真相源；monorepo 多端分包（web / vscode / utools / api + core / md-cli / mcp-server）——我们是单一 Vite 应用。它把输入和重渲染解耦用的是 debounce，我们是 React，用 `useDeferredValue` + `useMemo` 达到同样效果，机制无关所以记作参考。

**[din4e/MDInline](https://github.com/din4e/MDInline)**（MIT，din4e）

- DOCX 导入的库选择和加载时机。上游 `frontend/src/lib/import/docx.ts` 用 mammoth 转 HTML，并且刻意动态 import（注释理由：mammoth 很大，只有真的导入 .docx 时才需要）。已落在 `src/lib/import-export.ts` 的 `docxToDocxImport`，理由一模一样——静态 import 会把约 600 KB 的 DOCX/XML 机制塞进入口 chunk。图片那一半是我们自己的：用 `convertImage` 覆盖 mammoth 默认的 base64 内联，把每张图收进 `images[]`、Markdown 里留 `![alt](docx-import:N)` 占位，之后按名字而不是按位置替换；另叠一层 `styleMap` 把 Word 的 Title → `h1`、Quote / Intense Quote → `blockquote`，好接上我们的文章标题和金句卡。
- *计划参考*：`useClampedNumber`（`frontend/src/components/controls.tsx:36`）——滑块和数字框共用一个夹取值，输入过程中允许越界中间态、失焦才夹回 `[min, max]`。我们的排版参数面板还没有这类联动控件。
- *没采用*：`ThemeConfig` + 运行时 CSS 字符串主题（`lib/theme.ts` + `lib/css.ts`，选择器全挂在 `.mdcss` 下）——数据驱动只能表达字号/颜色/间距这类标量，表达不了金句卡、引文框、自动编号章节、轮播画框这些结构性差异；`juice` 的事后 CSS 内联（`lib/inline.ts`）——它的复制根节点是 `<div class="mdcss">`，公众号会剥掉 class 和非白名单标签，我们的主题函数直接输出 `<section>`/`<p>` + 内联 style，从根上不需要这一步；它 `frontend/src/lib/word/` 那套自研 DOCX/RTF 解析器（约 820 行）——mammoth 已经覆盖我们要的保真度。

**[caol64/wenyan-core](https://github.com/caol64/wenyan-core)**（Apache-2.0，Lei）

- MathJax SVG 数学公式，`src/core/parser/mathjaxParser.ts`：`mathjax-full` + `liteAdaptor()` 在纯 JS 环境跑 tex2svg，关键配置是 `fontCache: 'none'`——让每个 SVG 自带完整 path 定义，不引用共享 `<defs>`、不依赖外部字体或 CSS。这是公式能活过公众号粘贴路径的前提。doocs/md 走的是同一条路（`packages/core/src/utils/mathjax.ts:56` 同样 `fontCache: 'none'`），两个独立上游互相印证。已落地在 `src/lib/math.ts`，公众号端的实际行为在 2026-10-07 实粘验证过。
- *没采用*：微信 HTML 清洗规则，`src/core/renderer/wechatPostRender.ts`（103 行）——把 `mjx-container` 拆出裸 SVG 并把 `width`/`height` 搬进 style、每个 `<li>` 的子节点包进一层 `<section>`。这两条实测下来是不必要的：MathJax 原样输出（`ex` 单位 + `currentColor`）三种写法全部存活，带内联样式 run 的裸 `<li>` 也没有被拆行，所以我们只在 wrapper 上补一个显式 `color`，SVG 尺寸一个字都不改（手算 `ex`→`px` 会小约 10%）。剩下两条我们本来就有：块级公式父节点居中在 `theme-fallbacks.ts` 的 `defaultMath`，代码块保持缩进靠 `white-space:pre-wrap`，没有做 `\n` → `<br>` 的替换。
- *没采用*：core / ui / cli / mcp 四仓库分包 + `package.json` 五路 exports——它拆包是因为有五个独立分发的产品，我们只有一个 Vite 应用。真正值得学的是它「环境适配走注入」的边界划法（`HttpAdapter` / `TokenStorageAdapter` / `MermaidRenderer`），这一点我们的 `resolveImg` / `resolveMath` / `resolveDiagram` 已经是同构做法。

**[foolgry/editor](https://github.com/foolgry/editor)**（MIT，fork 自 huasheng_editor）

- Skill 的工程写法，上游 `skills/wechat-markdown-editor/SKILL.md`（267 行）→ 已落在 `skills/wechat-typesetter/`（`SKILL.md` + `scripts/mopai.py`，Python 3 标准库零依赖）。照做的约定：令牌只放技能目录下的 `.env`（被 gitignore、`set-token` 会把权限收到 600，Windows 上失败被吞掉）；`set-token` 幂等，原地替换而不是堆行，也支持从 stdin 读；「不预检直接调、报错再配」——明确禁止每次推送前跑 `token-status` 或 `cat .env`，理由是正常路径不该多一轮往返；报错信息里自带 `.env` 绝对路径和 `set-token` 命令；`token-status` 只显示掩码；同步到全局技能目录时必须排除 `.env`，否则仓库里的模板会覆盖用户真令牌（表现为「昨天还能发，今天突然说需要令牌」）。段落顺序也照抄：先给报错原文，再讲怎么配。
- 本地图片上传的客户端做法，上游 `scripts/publish.py:300-339`（手写 multipart）、`:342-358`（相对路径按 Markdown 所在目录解析而不是 cwd）、`:361-403`（同一路径只传一次、单张失败不中断而是进 `warnings`）→ 已落在 `scripts/mopai.py` 的 `upload_image` / `resolve_local_ref` / `process_images`。改写目标换成我们的 `img:<key>`（上游写绝对 URL）；跳过前缀里加了 `img:` 和 `docx-import:`，这两个协议后面没有斜杠，按上游 `img://` 那样判断会漏掉。
- 令牌的服务端模型，上游 `server/main.go`：库里只存摘要、明文只在签发那一次返回（`:1426`、`:1742-1744`）；吊销是软删除而不是 `DELETE`（`:1479-1498`）；凭证校验失败绝不降级为匿名（`:335`）；401 响应体自带自助入口，并区分「没带凭证」和「凭证无效」两种措辞（`:1345-1363`）→ 已落在 `api/lib/agent-auth.ts`（常量时间比较，401 与 403 分开）和 `api/agent-router.ts`（每个错误体都是 `{error, hint}`）。P0 阶段令牌来自环境变量 `AGENT_TOKENS=name:token[:scope]`，删掉一行即等于吊销，所以还没有 tokens 表；那张表和前端管理面板留作开源后的 P1。
- *没采用*：浏览器和 Agent 共用同一组端点、同一套 Bearer 令牌（上游不区分内外，区别只在凭证存哪）。我们刻意分成两扇门：浏览器继续走 tRPC + cookie session，agent 走 `/api/agent/*` 的朴素 REST + Bearer。理由是 superjson 的 wire format 对第三方客户端极不友好（`Date` 字段要手写元信息、错误包在 JSON-RPC 信封里），而 Skill 要能被任何 harness 用一行 `curl` 验证；顺带也让两种凭证能有不同的权限和生命周期。同理也没有把人类登录口令 `ACCESS_KEY` 兼作 API 令牌（上游的 `WXMD_LIST_PASSWORD` 回退，`main.go:1704-1728`）——那会让「它到底是什么」变含糊，而且泄露一次就得让所有 agent 一起失效。
- *没采用*：用时间戳做乐观锁。原打算照上游那样比对 `updatedAt`，实测发现这一列落库是秒级精度、带的还是客户端时钟，同一秒内的两次写入分不出来——agent 会在毫无察觉的情况下冲掉人工精修。改成内容 sha256 的前 16 位（`hash` / `baseHash`），顺带让「重推同样内容」变成幂等成功而不是假冲突。
- *没采用*：Project 聚合与 `attach`/`detach` 那一整套（约 250 行，我们的对应物是扁平稿件库）；给令牌删除权（`main.go:585-645`，我们的 agent 只能读写，删除和回收站都归人管）；把样式表硬编码进脚本和 SKILL.md 两处（`publish.py:51-79` 的 27 个 key，我们一律现拉 `GET /api/agent/themes`，脚本里一个主题名都没有）；MCP server（上游也没有，我们的 agent 能用 shell，零依赖脚本更普适）。
- *没采用*：匿名可读的分享页（`/s/<id>`、`/p/<id>/<sid>`）——云端草稿箱需登录才能读写，稿件按 owner 隔离，匿名访客从 API 一个字都读不到，而成稿的去处是公众号后台，不是一个给人网页阅读的地址；做匿名分享页等于自己开始托管公开内容、还要防 id 枚举和爬虫。需要说明的是它自己也不开放匿名*发布*，我们分歧的只是「读」这一侧。

### 参考（reference）

读过、比较过，用来印证或排除方案，代码里没有对应实现。

**[caol64/wenyan-ui](https://github.com/caol64/wenyan-ui)**（Apache-2.0，Lei）——「注入点」而不是继承的宿主/UI 边界：`src/lib/hooks/*.ts` 全是 `setContext`/`getContext` 对（`setUploadImage`、`setExportImageClick`、`setHandleFileOpen`、`setPublishArticleClick`……），每个 get 都带网页版降级默认值。我们将来给 Agent 或非浏览器入口开同一条渲染链路时可以借鉴这套边界划法。SvelteKit 组件库本身无法复用，我们是 React。

**[caol64/wenyan](https://github.com/caol64/wenyan)**（Apache-2.0，Lei）——宿主侧的一次性接线写法：`src/lib/setHooks.ts` 在应用启动时把 Swift 桥实现集中塞进 wenyan-ui 的注入点，业务组件对此完全无感。桌面壳的产品形态与我们无关。

### 依赖层面

上面只列**我们直接参考过源码**的项目。通过 npm 引入的第三方依赖（turndown、turndown-plugin-gfm、mammoth、markdown-it、CodeMirror、Radix UI、React 等）各有自己的许可证，由 `package.json` / `package-lock.json` 记录，不在 `LICENSES/` 重复收录。

发现归属写错、漏了某个上游，或者某条其实已经落地了——开个 issue，改数据只要动 `src/lib/credits.ts` 一个文件。
