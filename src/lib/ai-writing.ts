import { WRITING_SKILL_URL } from '@contracts/remote-mcp'

export const AI_WRITING_PROMPT = `请根据下面的主题和资料，帮我写一篇可直接在墨排使用的公众号文章。

先读取写作 Skill：${WRITING_SKILL_URL}
按 Skill 前半部分的 Markdown 方言与图片规则写稿。只需写稿，无需登录、调用 API 或配置模型。若无法读取链接，请告诉我，我会粘贴完整 Skill。

主题 / 目标读者 / 目的：
[在这里补充]

参考资料 / 需要保留的事实与图片：
[在这里粘贴]

篇幅 / 语气 / 其他要求：
[在这里补充]

请只输出可直接粘贴到墨排左侧编辑器的 Markdown 源稿，不加解释，不把整篇包进代码块。不要编造事实、引用或图片地址；缺图片时用带图注的空地址占位。`
