# 小红书卡片

在编辑页预览区点击「小红书卡片」，同一份 Markdown 会自动分页。卡片内可选择 3:4、1:1、9:16 和米白纸、纯白、方格本、主色浅底、夜读；每张下方的 PNG 按钮下载单张，「导出全部 ZIP」下载整套。
比例与背景在本次编辑会话内保留，切换公众号预览或调整窗口大小后继续沿用；刷新页面恢复默认。

- 首个一级标题生成封面，紧接着不超过 60 字的段落作为副标题；没有一级标题时直接生成正文卡片。空稿不生成卡片，只有一级标题时生成一张封面。
- 单独一行 `---` 是卡片的手动分页符。公众号预览、复制、HTML 导出仍按原有分隔线渲染。开头的 YAML front matter 仍由 Reed 的既有解析器处理。
- 正文在隐藏容器内以 540px 宽实测，导出为两倍像素：1080×1440、1080×1080、1080×1920。
- 段落按句拆，过长的单句再分段；代码按行、列表按项、表格按行拆开。拆开的表格重复表头，有序列表的每个条目保留自己的序号。
- 图片先读取并嵌入，确保分页和 PNG 使用相同的图片。跨域限制、浏览器安全策略或坏链接导致读取失败时，视图列出地址并暂停导出；修好后点击重试。未填图片位以明确的占位文字呈现。
- 个别无法再拆且高于整页的内容（如巨大表格单元格、单条嵌套列表）会缩小并提示，可拆短源稿来保持正常字号。
- 背景独立于界面明暗设置。「主色浅底」使用当前文章主题的 `ui.accent`，不可用时使用 Reed 的品牌色 `#4F6CE8`。
- 中文用现有 Noto Sans SC，英文与数字用现有 Geist，代码用 Geist Mono；PNG 内嵌实际字形所需的网页字体切片，不添加字体文件。批量导出固定点击时的卡片内容。
- 导出期间请保持浏览器标签页在前台；Chrome 会暂停后台标签页的图像绘制，回到页面后会继续。
- 卡片视图打开时继续改稿，卡片留在原处、在后台重新分页，正在看的那张不会跳回封面；新分页完成前导出按钮暂不可用。换比例或换到 / 换出「夜读」会重新排版。

## 参考与取舍

版式 Reference Lock 为 [woodti/mopai](https://github.com/woodti/mopai) 的 `0c2b2f8e983727da7c5b2b10fafb540c5ed70893`：

| Reed 版式 | 可定位参考 | 借用内容 |
|---|---|---|
| 分页 | `src/cards.ts` | 隐藏容器实测、540px 宽、40/52/76px 页边距、分段与标题跟随 |
| 封面、页眉页脚 | `src/CardsView.tsx`、`src/styles.css` | 标题字号阶梯、色条、副标题、页码、作者位置 |
| 正文 | `src/themes.ts` 的基础样式 | 18px 正文、1.8 行距、引用、代码、列表、表格和图片 |
| 比例、背景、导出 | `src/cards.ts`、`src/CardsView.tsx` | 三种比例、五种背景、1080px PNG、ZIP |
| 界面控件 | Reed `PreviewPane.tsx`、`src/index.css`；Console 的 `preview/buttons.html` | `ya-well` 凹陷承载、`ya-selected` 1.5px 描边、现有按钮与明暗 token |

围绕 Reed 的语义 AST 重写卡片渲染，未引入 mopai 的 marked。原来的公众号 Theme 和 renderer 无需改变。
卡片只有一套基础版式，文章主题提供主色；不将 222 套公众号模板的视觉全部移植到卡片。
轮播和网格在静态 PNG 中逐图展示，确保每张都可见；原始 Markdown 与公众号多图行为保留。
代码沿用 Reed 的纯文本呈现，不新增语法高亮依赖。封面用已有的 700 字重；极长标题按实测高度缩小。
参考项目导出使用 `skipFonts`；Reed 改为明确内嵌网页字体，并对无法读取的图片给出可见提示。

版权原文保存在 [woodti-mopai-LICENSE.txt](../LICENSES/woodti-mopai-LICENSE.txt)。代码借鉴及两项导出依赖登记在 [credits.ts](../src/lib/credits.ts)，由 `sync:docs` 生成 [NOTICE](../LICENSES/NOTICE.md)。

## 验证

单元测试：[cards.test.ts](../src/lib/cards.test.ts)。真实 Chrome 验收：

```powershell
npm run build
node scripts/cdp-verify-xhs-cards.mjs 3201 9334
```

脚本使用当前 worktree 的 `data/test-xhs.db`、本地 mock 图床与独立 Chrome profile。截图、导出 PNG / ZIP、实际字体和像素对比结果写到 `verify-out/xhs/`。它测试 SAMPLE_DOC 和约 3000 字的中文混合稿，遍历比例与背景，检查内容边界、下载尺寸 / 张数、中英与明暗界面、图片失败提示及字体。
