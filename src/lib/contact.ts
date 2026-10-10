// 公开联系邮箱的来源。地址以分片保存、只在运行时拼装：构建产物里搜不到
// 完整的一串，纯文本爬虫拿不到。改邮箱时改 PARTS 的切法，别写成整串；
// README 与界面文案随地址一起更新。
// 测试 contact.test.ts 会兜底扫描 src/，防止有人把它改回明文。

const PARTS = ['yoruand', 'akari', 'duck', 'com'] as const

export function contactEmail(): string {
  return `${PARTS[0]}${PARTS[1]}@${PARTS[2]}.${PARTS[3]}`
}
