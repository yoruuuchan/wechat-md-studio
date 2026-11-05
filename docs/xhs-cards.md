# 小红书卡片

在编辑页顶栏的模式入口切到「小红书卡片」，同一份 Markdown 会自动分页。卡片先在右栏「模板」标签里选模板：内置的默认模板（Reed）有米白纸、纯白、方格本、主色浅底、夜读五种背景；再选 3:4、1:1、9:16。更多版式通过「我的模板」上传 `.reedcard` 模板文件获得，每套模板的背景由它自己的 manifest 声明。模板列表分成两组：上面「我的」是自己上传的模板（还没上传时不显示），下面「公用」是默认模板和九套公用模板。
右栏同一处还有「我的模板」：可以上传 `.reedcard` 模板文件（zip），文件会保存在本机 IndexedDB，刷新后还在，也可以删除。上传的模板和内置模板一样参与分页、封面标题适配、精确字号导出、字体嵌入、单张 PNG 与整包 ZIP，只支持 manifest 声明的比例；比例不满足时自动切换并提示。每张下方的 PNG 按钮下载单张，顶栏的「导出全部 ZIP」下载整套。格式、slot、CSS 限制与完整示例见 [卡片模板文件格式](card-template-format.md)。
比例、模板与变体在本次编辑会话内保留，切换模板时变体自动换成新模板的第一个，切回公众号文章模式或调整窗口大小后继续沿用。选择会记在本机（`mopai.card-options.v1`），刷新或新开文章继续使用上一套；如果那套模板已被删除、还没同步到这台设备，或属于已下线的旧内置模板，就回到默认的 Reed。文件选择器一次可以选多个 `.reedcard`：成功的加入列表，失败的逐个列出原因，最后汇总添加与失败数量。

- 首个一级标题生成封面，紧接着不超过 60 字的段落作为副标题；没有一级标题时直接生成正文卡片。空稿不生成卡片，只有一级标题时生成一张封面。
- 单独一行 `---` 是卡片的手动分页符。公众号预览、复制、HTML 导出仍按原有分隔线渲染。开头的 YAML front matter 仍由 Reed 的既有解析器处理。
- 正文在隐藏容器内以 540px 宽实测，导出为两倍像素：1080×1440、1080×1080、1080×1920。
- 段落按句拆，过长的单句再分段；代码按行、列表按项、表格按行拆开。拆开的表格重复表头，有序列表的每个条目保留自己的序号。
- 图片先读取并嵌入，确保分页和 PNG 使用相同的图片。跨域限制、浏览器安全策略或坏链接导致读取失败时，视图列出地址并暂停导出；修好后点击重试。未填图片位以明确的占位文字呈现。
- 个别无法再拆且高于整页的内容（如巨大表格单元格、单条嵌套列表）会缩小并提示，可拆短源稿来保持正常字号。
- 背景独立于界面明暗设置。「主色浅底」使用当前文章主题的 `ui.accent`，不可用时使用 Reed 的品牌色 `#4F6CE8`。
- 字体按模板走：默认用 Noto Sans SC / Geist / Geist Mono。上传模板可以按名字引用仓库内置的字体（Noto Serif SC、Zhuque Fangsong、EB Garamond、Inter、JetBrains Mono、Orbitron、VT323、Space Grotesk、DM Serif Display、Rajdhani、Share Tech Mono、Pixelify Sans、Tinos、Instrument Sans、B612 Mono 等），也可以自带 woff2。所有字体文件都保留；分页预载和 PNG 内嵌读同一份声明，PNG 只内嵌当前模板实际字形所需的切片。批量导出固定点击时的卡片内容。
- 导出期间请保持浏览器标签页在前台；Chrome 会暂停后台标签页的图像绘制，回到页面后会继续。
- 卡片视图打开时继续改稿，卡片留在原处、在后台重新分页，正在看的那张不会跳回封面；新分页完成前导出按钮暂不可用。换比例、换模板、换变体或进入 / 离开默认模板的「夜读」会重新排版。每张卡片外还有一层模板 CSS 选不到的 `contain: paint` + `isolation: isolate` 容器，模板里的超大 transform 或 z-index 也盖不到编辑器。

## 参考与取舍

版式 Reference Lock 为 [woodti/mopai](https://github.com/woodti/mopai) 的 `0c2b2f8e983727da7c5b2b10fafb540c5ed70893`：

| Reed 版式 | 可定位参考 | 借用内容 |
|---|---|---|
| 分页 | `src/cards.ts` | 隐藏容器实测、540px 宽、默认模板的页边距与正文宽、分段与标题跟随；上传模板从 manifest 读自己的度量 |
| 封面、页眉页脚 | `src/CardsView.tsx`、`src/styles.css` | 标题字号阶梯、副标题、页码、作者位置；上传模板用自己的页面片段与 CSS |
| 正文 | `src/themes.ts` 的基础样式 | 18px 正文、1.8 行距、引用、代码、列表、表格和图片；上传模板在作用域内覆写 `src/components/cards.css` 的基础规则 |
| 比例、模板、背景、导出 | `src/cards.ts`、`src/components/CardSettings.tsx`、`src/CardsView.tsx`、`src/components/TopBar.tsx` | 三种比例、内置默认模板与上传模板、1080px PNG、ZIP；控件在右栏「模板」，整套导出在顶栏 |
| 界面控件 | Reed `SidePanel.tsx`、`TopBar.tsx`、`PreviewPane.tsx`、`src/index.css` | `ya-well` 凹陷承载、`ya-selected` 1.5px 描边、现有按钮与明暗 token |

围绕 Reed 的语义 AST 重写卡片渲染，未引入 mopai 的 marked。原来的公众号 Theme 和 renderer 无需改变。
卡片内置只有 Reed 默认模板（五种背景）；其他版式以 `.reedcard` 上传模板的形式存在，各有自己的变体。默认模板的主色来自当前文章主题，公众号的 227 套主题不会整体移植到卡片上。
轮播和网格在静态 PNG 中逐图展示，确保每张都可见；原始 Markdown 与公众号多图行为保留。
代码沿用 Reed 的纯文本呈现，不新增语法高亮依赖。封面用已有的 700 字重；极长标题按实测高度缩小。
参考项目导出使用 `skipFonts`；Reed 改为明确内嵌网页字体，并对无法读取的图片给出可见提示。

版权原文保存在 [woodti-mopai-LICENSE.txt](../LICENSES/woodti-mopai-LICENSE.txt)。代码借鉴及两项导出依赖登记在 [credits.ts](../src/lib/credits.ts)，由 `sync:docs` 生成 [NOTICE](../LICENSES/NOTICE.md)。

## 验证

单元测试：[cards.test.ts](../src/lib/cards.test.ts)、模板格式与安全：[card-template.test.ts](../src/lib/card-template.test.ts)、[card-template-store.test.ts](../src/lib/card-template-store.test.ts)。真实 Chrome 验收：

```powershell
npm run build
node scripts/cdp-verify-xhs-cards.mjs 3201 9334
node scripts/cdp-verify-card-template-upload.mjs 3281 9398
```

`cdp-verify-card-template-upload.mjs` 只用仓库里的示例模板（`examples/card-templates/example`，运行时打包成 `.reedcard`），覆盖多文件上传（其中一个坏包被拒绝并逐个提示原因）、选择器、「我的模板」、单张 PNG / 整包 ZIP、预览 DOM 与导出 PNG 像素对比、刷新后仍在、恶意包被拒绝、删除后刷新不再出现；登录状态下还会验证自动上传到云端、全新浏览器 profile 登录后模板自动出现、登录删除两边都消失、访客看不到同步状态，以及两个独立浏览器 profile 的双设备场景：A 删除后 B 同步只删本机并提示、云端与 A 也都没有，B 重新上传后 A 再次同步能重新拿到。模板格式、slot 与限制见 [卡片模板文件格式](card-template-format.md)。

脚本使用当前 worktree 的 `data/test-xhs.db`、本地 mock 图床与独立 Chrome profile。截图、导出 PNG / ZIP、实际字体和像素对比结果写到 `verify-out/xhs/`。它测试 SAMPLE_DOC 和约 3000 字的中文混合稿，遍历比例与默认模板的五种背景，并遍历默认模板每个变体的封面 + 前两张正文（3:4），检查内容边界、下载尺寸 / 张数、中英与明暗界面、图片失败提示、CDP 实际字体与 DOM / PNG 像素对比。默认模板的每个变体 × 三种比例还会扫描封面、正文与结尾的所有可见元素及其 `::before` / `::after`，命中任意一条即失败：① 短粗横线：高 2–16px、宽不小于高 3 倍且不超过 160px、带可见填充；② 细短线：高不小于 1px 且小于 2px、宽度比例与上限同上，背景透明度不小于 0.1、带背景图，或由至少 1px 的上 / 下边框画出；③ 装饰破折号：去掉空白后不超过 16 个字的短文字，开头或结尾带一个或连续几个破折号类字符（— – ― ─ －），扫描 `.xhs-body` 以外的文字节点和所有 `::before` / `::after` 的 content，正文内部文字不查。四边都有边框的表格格子 / 复选框照旧排除，整行分隔线和超过 160px 的线不在此列。默认模板逐个变体检查封面标题、副标题与第 3 页正文的 WCAG 对比度：用文字的计算颜色和导出 PNG 中文字包围盒内的中位色算对比度，普通文字不足 4.5:1 或 24px 以上粗体标题不足 3:1 即失败。

每套模板的每个变体都会把封面与前两张正文导出到 `verify-out/templates/<template>-<variant>-01..03.png`，并生成按模板分组的 `verify-out/templates/index.html`；第 3 页的 DOM / PNG 对照图在 `verify-out/templates/dom-vs-png/`。封面除整页像素对比外，还会取标题元素在预览中的包围盒、换算到导出坐标后检查墨色像素，防止标题被压成 0 像素。Reed 的 PNG 与改动前在本机跑出的基线目录逐像素核对（`verify-out/` 不进 git，基线要在动手前先跑一次验收生成）：

```powershell
pwsh scripts/compare-card-png.ps1 -Baseline verify-out/xhs/<基线目录> -Current verify-out/xhs/<本次目录>
```

封面和正文页都按 `mean < 2`、`bad < 0.025` 比对 DOM 截图与导出 PNG。默认模板在克隆阶段使用预览的精确计算字号，导出的断行与预览一致；上传模板走同一条管线。
