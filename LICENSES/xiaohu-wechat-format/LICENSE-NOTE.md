# xiaohu-wechat-format — 授权状态记录

上游仓库：https://github.com/xiaohuailabs/xiaohu-wechat-format
核实时间：2026-10-07（浅克隆 HEAD 实测）

## 事实

上游**没有 LICENSE 文件**。授权声明只出现在 README 里：

- `README.md` 第 191–193 行：

  ```
  ## License

  MIT
  ```

- `README_CN.md` 末尾有同样的 `## License` / `MIT` 声明。
- `themes/` 目录内没有单独 LICENSE，也没有更窄的授权说明。
- 仓库 698 stars / 95 forks，社区按开源项目对待。

## 本项目的处理

按版权人在 README 的明示声明，将 85 套主题 JSON 视为 **MIT** 授权接入：保留署名、
记录原始文件路径（每套主题的 `meta.origin.upstream`），并在主题详情里展示来源与授权状态。

## 待办

上游缺少正式 LICENSE 文件与版权行，属于授权凭证不完整。建议向上游提 issue 请求补
LICENSE，补齐后把本文件替换为许可证原文。在补齐之前，这部分主题的再分发权利依赖
README 声明，而非标准许可证文件——这一限制已记录在 `THEME-SOURCES.md` 的审计结论里。

## 署名

```
Themes from xiaohuailabs/xiaohu-wechat-format.
The upstream README declares "## License — MIT"; the repository ships no LICENSE file.
Copyright belongs to the xiaohu-wechat-format authors.
```
