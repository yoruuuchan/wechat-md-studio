# NOTICE — Third-party license copies and attribution

本目录收录「公众号排版助手 by Yoru」在开发过程中参考、适配或计划移植的上游开源项目的
LICENSE 全文副本，以及我们对各自的使用性质说明。

- **抓取日期**：2026-10-07
- **抓取方式**：从本地 shallow clone（`git clone --depth 1`）逐字复制 LICENSE 文件，未经任何修改、截断或重新排版。
- **结构化数据**：机器可读的版本在 `src/lib/credits.ts`，页面上的版本在 `/references`，README 的 `## Acknowledgements / 致谢` 一节由 `npm run sync:docs` 从同一份数据生成。三处内容如有出入，以 `src/lib/credits.ts` 为准；本文件与数据的对应关系由 `npm run verify:sources` 校验（每个 credit 的仓库、许可证副本、版权行都必须能在下表里找到）。

## 一、上游清单与核实结果

下表里的 **LICENSE 类型** 和 **版权行** 都是打开文件读出来的原文，不是从 README 或记忆里推的。
**核对的 commit** 是本地 shallow clone 的 HEAD。

| 副本文件 | 上游仓库 | LICENSE 类型 | LICENSE 里的版权行 | 核对的 commit | md5 |
|---|---|---|---|---|---|
| `doocs-md-LICENSE.txt` | github.com/doocs/md | **WTFPL**（DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE, Version 2, December 2004） | `Copyright (C) 2025 Doocs <admin@doocs.org>` | `a7c17fc`（2026-09-29） | `3bb7c32637627c1ab12bc7cd873b7aa0` |
| `laogou717-md-wechat-LICENSE.txt` | github.com/laogou717/md-wechat | MIT | `Copyright (c) 2026 字间排版` | `8a21962`（2026-09-02） | `23972954ac1a477e76be78b98dfd25a2` |
| `alchaincyf-huasheng_editor-LICENSE.txt` | github.com/alchaincyf/huasheng_editor | MIT | `Copyright (c) 2024 花生 (alchaincyf)` | `433819c`（2026-10-03） | `402e260d672920057369ceeaf718f6a2` |
| `din4e-MDInline-LICENSE.txt` | github.com/din4e/MDInline | MIT | `Copyright (c) 2026 din4e` | `080d45d`（2026-07-26） | `119da269533d04cd887f8e26e28f0c3d` |
| `caol64-wenyan-core-LICENSE.txt` | github.com/caol64/wenyan-core | Apache-2.0 | 标准 Apache 2.0 附录，未填写具体版权人（package.json `author`: `Lei <caol64@gmail.com>`，`license`: `Apache-2.0`） | `b1c9edc`（2026-09-20） | `d229da563da18fe5d58cd95a6467d584` |
| `caol64-wenyan-ui-LICENSE.txt` | github.com/caol64/wenyan-ui | Apache-2.0 | 同上（package.json `author`: `Lei <caol64@gmail.com>`） | `d5426c5`（2026-04-28） | `d229da563da18fe5d58cd95a6467d584` |
| `caol64-wenyan-LICENSE.txt` | github.com/caol64/wenyan | Apache-2.0 | 同上 | `eeb8d4f`（2026-04-29） | `d229da563da18fe5d58cd95a6467d584` |
| `foolgry-editor-LICENSE.txt` | github.com/foolgry/editor | MIT | `Copyright (c) 2024 花生 (alchaincyf)` | `ab95fbe`（2026-09-15） | `402e260d672920057369ceeaf718f6a2` |

### 三点需要特别说明

1. **doocs/md 不是 MIT，是 WTFPL v2。**
   许可极度宽松（"0. You just DO WHAT THE FUCK YOU WANT TO."），没有任何传染性或署名要求，
   对我们的开源许可选择不构成限制。但它有两个实际影响：
   - 我们的致谢文案不能写成 "doocs/md (MIT)"，那是错的；
   - 许可证正式名称含粗口。是否在产品页面和 README 里原样写出这个名称，需要主 Agent 决策。
     可选措辞：原样标注 `WTFPL v2`，或写成 "a permissive public-domain-style license (WTFPL v2)"。
     LICENSE 全文副本已经放在本目录，无论选哪种措辞，可追溯性都成立。

2. **foolgry/editor 的 LICENSE 与 alchaincyf/huasheng_editor 字节完全相同**（md5 同为 `402e260d…`），
   版权行都写的是「花生 (alchaincyf)」。原因在该仓库 README 第 13 行：
   「本项目 Fork 自 alchaincyf/huasheng_editor」。LICENSE 原样继承，foolgry 自己新增的部分
   （分享服务、Go 后端、Mermaid 渲染、发布 Skill）没有单独加版权行，沿用同一份 MIT 条款。
   致谢时应当同时点出 fork 关系和原始版权人。

3. **wenyan / wenyan-core / wenyan-ui 三个仓库的 LICENSE 字节完全相同**（md5 同为 `d229da56…`），
   都是标准 Apache License 2.0 全文，许可一致。
   Apache-2.0 附带专利授权条款和 NOTICE 义务：**如果我们将来直接复制它的代码**
   （而不只是像现在这样借鉴思路后自己重写），必须在发行物里保留 LICENSE 全文和版权声明，
   并说明我们改动了哪些文件。本目录的副本就是为履行这个义务准备的。

### 许可传染性结论

<!-- BEGIN GENERATED: notice-license-tally — npm run sync:docs -->
**八个上游项目全部是宽松许可：MIT × 4、Apache-2.0 × 3、WTFPL v2 × 1。
没有任何 GPL / LGPL / AGPL / MPL / SSPL / BUSL 等 copyleft 或 source-available 许可，
也没有任何项目缺失 LICENSE 文件。**
<!-- END GENERATED: notice-license-tally -->

因此这些上游对本项目选择自己的开源许可证（MIT / Apache-2.0 / 其它）不构成传染性约束。
唯一需要留意的是 Apache-2.0 的 NOTICE/署名义务，只在我们从 wenyan 系复制实际代码时才触发。

## 二、我们对各上游的使用性质

分类口径：

- **移植（ported）**：机制已经落在我们的代码里，实现与上游高度对应。
- **适配（adapted）**：思路已经落地，但围绕我们自己的语义 IR 重写过，不是逐行搬运。
- **计划参考（planned）**：已经选定方案、还没有落地。提前记下来，是为了在写第一行代码之前就把归属固定住。
- **参考（reference）**：读过、比较过，用来印证或排除方案，代码里没有对应实现。

逐条明细（含具体文件路径和行号）见 `src/lib/credits.ts`。摘要如下：

| 上游 | 性质 | 我们做了什么 / 打算做什么 |
|---|---|---|
| laogou717/md-wechat | 移植 | 外链转脚注（落在 `src/lib/render.ts` 渲染层，上游是 markdown-it core rule）；富文本复制的离屏 `contentEditable` + `execCommand` 降级路径（`src/lib/clipboard.ts`）。 |
| alchaincyf/huasheng_editor | 移植 | 富文本粘贴前的四道闸门（`src/lib/rich-paste.ts`，gate 1 的计分从上游的扁平计数改成强/弱加权）；Turndown 的 `addRule` 规则集 + 转换前的 HTML 源清洗（同上）；图片压缩（`src/lib/image-compress.ts`，把上游的两段固定档推广成「最长边 2048 + 800 KB 目标体积 + quality 递减阶梯」，目标体积这一维是我们加的）。 |
| doocs/md | 适配 | 双向同步滚动改用块映射而不是总高度百分比（`src/lib/sync-scroll.ts`、`src/hooks/useSyncScroll.ts`）。思路来自上游，代码是按我们解析器的语义 IR 独立重写的。 |
| din4e/MDInline | 适配 | DOCX 导入用 mammoth + 刻意延迟的动态 import（`src/lib/import-export.ts`）。图片抽取、`docx-import:N` 占位协议和 mammoth styleMap 是我们自己加的，上游的 `extractDocxHtml` 只返回 HTML 字符串。`useClampedNumber` 那条仍是计划参考。 |
| caol64/wenyan-core | 适配 | MathJax SVG 公式（`mathjax-full` + `liteAdaptor` + `fontCache:'none'`，让 SVG 自带 path）已落在 `src/lib/math.ts`，配置路线与上游 `mathjaxParser.ts` 一致，公众号端行为 2026-10-07 实粘验证过。上游的微信 HTML 清洗规则实测下来不必要（MathJax 原样输出就能存活），已记为未采用。 |
| caol64/wenyan-ui | 参考 | 「注入点」而不是继承的宿主/UI 边界划法（`setContext`/`getContext` 对 + 网页版降级默认值）。 |
| caol64/wenyan | 参考 | 宿主侧一次性接线写法（`setHooks.ts` 集中注册 Swift 桥实现）。 |
| foolgry/editor | 适配 | Agent→Web 接入。Skill 工程写法（`.env` 约定、幂等 `set-token`、「不预检直接调、报错再配」、报错自带自助入口、全局同步时排除 `.env`）已落在 `skills/wechat-typesetter/`；令牌模型（只存摘要、软吊销、校验失败不降级为匿名、401 带 hint）已落在 `api/lib/agent-auth.ts` + `api/agent-router.ts`。乐观锁我们从「比对 updatedAt」改成内容 sha256，理由记在 `credits.ts` 的 declined 里。 |

分类以 `src/lib/credits.ts` 的 `usage` 字段为准；本表是它的人读版本，两边不一致时改数据文件。

### 明确评估过但没有采用的部分

同样记录在 `src/lib/credits.ts` 的 `declined` 字段里，公开可见。这一栏的存在是为了说明：
哪些上游能力是我们比较过之后主动放弃的，放弃的理由是什么（通常是与公众号粘贴路径的
实际约束冲突，或与本产品已有的架构定位冲突），而不是「没看见」或「没做完」。
所有表述都针对机制，不评价上游作者或项目质量。

## 三、依赖层面的说明

本目录只收录**我们直接参考过源码**的上游项目。通过 npm 引入的第三方依赖
（turndown、turndown-plugin-gfm、mammoth、markdown-it、CodeMirror、Radix UI、React 等）
各有自己的许可证，由 `package.json` / `package-lock.json` 记录，不在本目录重复收录。
如需生成完整的依赖许可清单，可在发布前用 `npm ls --all` 配合 license 检查工具补一份。

两个撑起整块功能的依赖单独点一下，因为读者查归属时会找它们：

- **mathjax-full**（Apache-2.0）——公式渲染。`src/lib/math.ts` 用它的 `liteAdaptor` + `tex2svg`
  在浏览器里把 TeX 转成内联 SVG，配置路线与 wenyan-core 的 `mathjaxParser.ts` 一致（见
  `src/lib/credits.ts`）。我们只调用它的公开 API，没有复制它的代码，也没有改它。
- **mermaid**（MIT）——图表渲染。`src/lib/diagram-raster.ts` 调它的 `render()` 拿到 SVG，
  随后在 canvas 上栅格化成 PNG 走图片上传链路；进公众号的是一个普通 `<img>`，不是它的 SVG。

两者都是**按需动态 import**：首屏不包含它们，只有文档里真的出现 `$$…$$` 或 ```` ```mermaid ````
时才会下载对应分包。

## 四、维护约定

- 新增或改动 `src/lib/credits.ts` 里的条目时：在本文件第一节的审计表里补一行（记录 commit、
  版权行、md5，`npm run verify:sources` 会点名缺了哪一行），再跑 `npm run sync:docs`
  重新生成 README 的致谢一节与统计区块。`/references` 页面直接读数据，通常无需改动。
- 每次从上游取用新代码，把 LICENSE 副本重新核对一遍：上游可能换许可证。
  核对方式就是重新读 LICENSE 文件并比对 md5，不要信 README 或 package.json 的 `license` 字段。
- 从 Apache-2.0 上游复制实际代码时，在对应文件头部保留版权声明，并在本文件里记下改动了什么。
