// 扩展主题库：移植自本机 gzh-design skill（D:\AGENT-SKILLS\library\design-ui\gzh-design）
// 的六套组件库——摸鱼绿 / 红与白 / 石墨极简 / 留白禅意 / 摸鱼票据 / 橄榄手记。
// 每套只取该库的「设计变量 + 章节标题 + 正文 + 行内 + 引用 + 列表 + 签名」核心语言，
// 映射到 Theme 接口的 13 个语义节点；装饰性空元素一律带 <span leaf=""><br></span> 占位
// （微信会剥掉空元素样式，这是 gzh-design 的兼容铁律）。

import { baseTableBlock, esc, makeCarousel, makeImageBlock, type Theme } from './theme-kit'
import type { ThemeMeta, ThemeOrigin } from './theme-meta'
import type { InlineSeg } from './types'

/**
 * 这六套主题移植自 gzh-design-skill 的主题组件库，上游是 AGPL-3.0-or-later。
 * AGPL 有传染性且第 13 条覆盖网络服务：本项目把它们的组件语言编进产物，
 * 整体就必须继续以 AGPL 提供源码。许可证文本留存在 LICENSES/ 下。
 */
const GZH_DESIGN: Omit<ThemeOrigin, 'upstream' | 'adapted'> = {
  kind: 'ported',
  project: 'gzh-design-skill',
  author: '甲木 (Jiamu) × 摸鱼小李 (Moyu Xiaoli)',
  repo: 'https://github.com/isjiamu/gzh-design-skill',
  license: 'AGPL-3.0-or-later',
  licenseFile: 'LICENSES/gzh-design-skill/LICENSE',
  attribution:
    '主题组件库来自 gzh-design-skill，Copyright (C) 2026 甲木 (Jiamu) × 摸鱼小李 (Moyu Xiaoli)，依据 AGPL-3.0-or-later 使用并修改。',
}

function gzh(file: string, meta: Omit<ThemeMeta, 'origin'>, adapted: string): ThemeMeta {
  return { ...meta, origin: { ...GZH_DESIGN, upstream: `references/theme-${file}.md`, adapted } }
}

const GZH_ADAPTED =
  '取上游的设计变量与组件语言，映射到本项目的语义节点接口；补 <span leaf=""> 包裹、去掉 class/id、改为全内联样式以符合公众号平台红线。'

// ============================================================
// 摸鱼绿（活力）：emerald 杂志风，卡片丰富、信息密度高，适合教程/测评/清单
// ============================================================

function moyuGreenSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="background:#F3F4F6;color:#1F2937;padding:2px 6px;border-radius:4px;font-size:13px;font-weight:600;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="background:#F3F4F6;color:#6B7280;padding:2px 6px;border-radius:4px;font-size:13px;text-decoration:line-through;font-weight:600;">${inner}</span>`
  if (s.link) inner = `<span style="color:#059669;border-bottom:1px solid #A7F3D0;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="color:#059669;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #A7F3D0;font-weight:600;color:#111827;">${inner}</span>`
  return inner
}

export const moyuGreenTheme: Theme = {
  id: 'moyu-green',
  name: '摸鱼绿',
  desc: '翠绿杂志风 · 教程/清单/盘点',
  category: '活力',
  ui: { accent: '#059669', soft: '#A7F3D0', ink: '#111827' },
  meta: gzh('moyu-green', { styles: ['杂志', '科技'], complexity: 3, color: '冷色' }, GZH_ADAPTED),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#374151;line-height:1.75;letter-spacing:0.5px;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: moyuGreenSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 16px;font-size:14px;line-height:1.9;letter-spacing:0.5px;text-align:justify;color:#374151;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const numHtml =
      num != null
        ? `<section style="text-align:center;flex-shrink:0;"><p style="margin:0;font-size:28px;font-weight:900;color:#059669;line-height:1;letter-spacing:-2px;"><span leaf="">${String(num).padStart(2, '0')}</span></p><p style="margin:0;font-size:8px;font-weight:700;color:#D1D5DB;letter-spacing:2px;"><span leaf="">PART</span></p></section><span style="width:1px;height:36px;background:#E5E7EB;flex-shrink:0;"><span leaf=""><br></span></span>`
        : ''
    const kickerHtml = kicker
      ? `<p style="margin:0;font-size:11px;font-weight:600;color:#9CA3AF;letter-spacing:1.5px;"><span leaf="">${esc(kicker)}</span></p>`
      : ''
    return `<section style="margin:48px 20px 32px;"><section style="display:flex;align-items:center;gap:16px;">${numHtml}<section><p style="margin:0 0 1px;font-size:17px;font-weight:900;color:#111827;letter-spacing:0.3px;"><span leaf="">${esc(title)}</span></p>${kickerHtml}</section></section></section>`
  },

  subheading: (title) =>
    `<p style="margin:32px 20px 16px;font-size:15px;font-weight:900;color:#111827;"><span style="background:linear-gradient(180deg,transparent 65%,#FDE68A 65%);padding:0 4px;"><span leaf="">${esc(title)}</span></span></p>`,

  center: (inner) =>
    `<p style="margin:0 20px 20px;font-size:14px;text-align:center;color:#059669;font-weight:700;letter-spacing:1px;border-top:1px solid #F3F4F6;border-bottom:1px solid #F3F4F6;padding:12px 0;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;background:#FFFFFF;border:1px dashed #BBF7D0;border-radius:8px;padding:14px 16px;text-align:center;"><p style="margin:0;line-height:1.6;"><span style="font-size:15px;color:#059669;font-weight:bold;border-bottom:3px solid #FDE68A;padding-bottom:2px;">${inner}</span></p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:8px;padding:12px 16px;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:13px;line-height:1.6;text-align:justify;color:#374151;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: makeImageBlock({ imgStyle: 'border-radius:12px;', captionColor: '#9CA3AF' }),

  carousel: makeCarousel({
    titleStyle:
      'font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#059669;font-weight:700;',
    hintColor: '#9CA3AF',
    captionColor: '#9CA3AF',
    placeholderBorder: '#BBF7D0',
    placeholderBg: '#F0FDF4',
  }),

  signature: (cfg) =>
    `<section style="margin:36px 20px 0;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:16px;padding:24px 20px;text-align:center;"><p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#111827;"><span leaf="">排版 ${esc(cfg.layout)} · 校对 ${esc(cfg.proof)} · 审核 ${esc(cfg.review)}</span></p><p style="margin:0;font-size:10px;color:#9CA3AF;letter-spacing:1px;"><span leaf="">THANKS FOR READING</span></p></section>`,

  listBlock: (ordered, items) => {
    if (ordered) {
      return `<section style="margin:0 20px 24px;">${items
        .map(
          (it, i) =>
            `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#059669;color:#FFFFFF;font-size:11px;font-weight:700;border-radius:50%;flex-shrink:0;margin-top:2px;"><span leaf="">${i + 1}</span></span><p style="font-size:14px;color:#374151;margin:0;line-height:1.9;flex:1;">${it}</p></section>`,
        )
        .join('')}</section>`
    }
    return `<section style="margin:0 20px 24px;">${items
      .map(
        (it) =>
          `<p style="margin:0 0 10px;"><span style="display:inline-block;font-size:13px;font-weight:700;color:#059669;background:rgba(5,150,105,0.08);padding:3px 10px;border-radius:999px;"><span style="display:inline-block;width:6px;height:6px;background:#059669;border-radius:50%;margin-right:5px;vertical-align:middle;"><span leaf=""><br></span></span>${it}</span></p>`,
      )
      .join('')}</section>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#059669', border: '#E5E7EB', headBg: '#F9FAFB', text: '#374151' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:14px 16px;background:#111827;border-radius:8px;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#E5E7EB;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:32px 20px;"><section style="height:1px;background:linear-gradient(to right,transparent,#A7F3D0,transparent);"><span leaf=""><br></span></section></section>`,
}

// ============================================================
// 红与白（商务）：正红克制点睛，淡粉下划线为主标记，经典编辑骨架
// ============================================================

function redWhiteSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="background:#F3F4F6;color:#1F2937;padding:2px 6px;border-radius:4px;font-size:14px;font-weight:600;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#DC2626;border-bottom:1px solid #FECACA;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="color:#1C1917;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #FECACA;font-weight:600;color:#1C1917;">${inner}</span>`
  return inner
}

export const redWhiteTheme: Theme = {
  id: 'red-white',
  name: '红与白',
  desc: '正红编辑风 · 观点/深度分析',
  category: '商务',
  ui: { accent: '#DC2626', soft: '#FECACA', ink: '#1C1917' },
  meta: gzh('red-white', { styles: ['商务', '杂志'], complexity: 2, color: '暖色' }, GZH_ADAPTED),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#374151;line-height:1.75;letter-spacing:0.5px;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: redWhiteSeg,

  paragraph: (inner) =>
    `<p style="margin:0 10px 20px;font-size:15px;line-height:1.8;letter-spacing:0.5px;text-align:justify;color:#374151;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const numHtml =
      num != null
        ? `<span style="display:inline-block;background:#DC2626;color:#FFFFFF;font-size:18px;font-weight:900;padding:4px 14px;border-radius:6px;margin-right:14px;line-height:1.3;"><span leaf="">${String(num).padStart(2, '0')}</span></span>`
        : ''
    const kickerHtml = kicker
      ? `<p style="font-size:10px;color:#DC2626;font-weight:700;letter-spacing:3px;margin:0 0 2px;text-transform:uppercase;"><span leaf="">${esc(kicker)}</span></p>`
      : ''
    return `<section style="margin:48px 10px 28px;"><section style="display:flex;align-items:center;padding-bottom:14px;border-bottom:3px solid #DC2626;">${numHtml}<section>${kickerHtml}<h3 style="font-size:18px;font-weight:800;color:#1C1917;margin:0;letter-spacing:0.5px;"><span leaf="">${esc(title)}</span></h3></section></section></section>`
  },

  subheading: (title) =>
    `<p style="font-size:15px;font-weight:800;color:#1C1917;margin:28px 10px 14px;padding-left:10px;border-left:3px solid #DC2626;line-height:1.4;"><span leaf="">${esc(title)}</span></p>`,

  center: (inner) =>
    `<p style="margin:0 10px 24px;font-size:15px;text-align:center;color:#DC2626;font-weight:700;letter-spacing:1px;border-top:1px solid #FEE2E2;border-bottom:1px solid #FEE2E2;padding:14px 10px;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 10px;background:#FEF2F2;border-radius:0 10px 10px 0;border-left:4px solid #DC2626;padding:18px 22px;"><p style="margin:0;font-size:16px;font-weight:800;color:#991B1B;line-height:1.8;text-align:center;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 10px;background:#FEF2F2;border-radius:10px;padding:18px 20px;border:1px solid #FECACA;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:15px;line-height:1.8;text-align:justify;color:#374151;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: makeImageBlock({ imgStyle: 'border-radius:10px;', captionColor: '#9CA3AF' }),

  carousel: makeCarousel({
    titleStyle:
      'font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#DC2626;font-weight:700;',
    hintColor: '#9CA3AF',
    captionColor: '#9CA3AF',
    placeholderBorder: '#FECACA',
    placeholderBg: '#FEF2F2',
  }),

  signature: (cfg) =>
    `<section style="margin:40px 10px 0;padding:20px 0 0;border-top:1px solid #FEE2E2;text-align:center;"><p style="margin:0 0 4px;font-size:13px;color:#9CA3AF;"><span leaf="">排版 ${esc(cfg.layout)} · 校对 ${esc(cfg.proof)} · 审核 ${esc(cfg.review)}</span></p><p style="margin:0;font-size:10px;color:#FCA5A5;letter-spacing:2px;"><span leaf="">THE END</span></p></section>`,

  listBlock: (ordered, items) => {
    if (ordered) {
      return `<section style="margin:0 10px 24px;">${items
        .map(
          (it, i) =>
            `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;"><span style="display:inline-block;background:#DC2626;color:#FFFFFF;font-size:12px;font-weight:800;padding:1px 9px;border-radius:4px;flex-shrink:0;margin-top:2px;"><span leaf="">${String(i + 1).padStart(2, '0')}</span></span><p style="font-size:15px;color:#374151;margin:0;line-height:1.8;flex:1;">${it}</p></section>`,
        )
        .join('')}</section>`
    }
    return `<section style="margin:0 10px 24px;">${items
      .map(
        (it) =>
          `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;"><span style="width:6px;height:6px;background:#DC2626;border-radius:50%;flex-shrink:0;margin-top:10px;"><span leaf=""><br></span></span><p style="font-size:15px;color:#374151;margin:0;line-height:1.8;flex:1;">${it}</p></section>`,
      )
      .join('')}</section>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#991B1B', border: '#FECACA', headBg: '#FEF2F2', text: '#374151' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0 10px;padding:14px 16px;background:#1C1917;border-radius:10px;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#F3F4F6;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:36px 10px;"><section style="height:1px;background:linear-gradient(to right,transparent,#FCA5A5,#DC2626,#FCA5A5,transparent);"><span leaf=""><br></span></section></section>`,
}

// ============================================================
// 石墨极简（简约）：全灰阶 + 1px 细线 + 超大水印编号，克制理性
// ============================================================

function graphiteSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="background:#F4F4F5;color:#27272A;padding:2px 6px;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:14px;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#27272A;border-bottom:1px solid #52525B;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="color:#27272A;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #52525B;font-weight:600;color:#27272A;">${inner}</span>`
  return inner
}

export const graphiteTheme: Theme = {
  id: 'graphite',
  name: '石墨极简',
  desc: '全灰阶 · 设计/科技评论',
  category: '简约',
  ui: { accent: '#52525B', soft: '#E4E4E7', ink: '#27272A' },
  meta: gzh('graphite-minimal', { styles: ['科技', '学术'], complexity: 1, color: '中性' }, GZH_ADAPTED),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#52525B;line-height:1.8;letter-spacing:0.3px;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: graphiteSeg,

  paragraph: (inner) =>
    `<p style="margin:0 10px 22px;font-size:15px;line-height:1.8;letter-spacing:0.3px;text-align:justify;color:#52525B;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const numHtml =
      num != null
        ? `<p style="font-size:48px;font-weight:900;color:#E4E4E7;margin:0;line-height:1;letter-spacing:-2px;"><span leaf="">${String(num).padStart(2, '0')}</span></p>`
        : ''
    const kickerHtml = kicker
      ? `<p style="font-size:10px;color:#A1A1AA;font-weight:500;letter-spacing:3px;margin:0 0 6px;text-transform:uppercase;"><span leaf="">${esc(kicker)}</span></p>`
      : ''
    return `<section style="margin:56px 10px 32px;"><section style="position:relative;padding-bottom:20px;border-bottom:1px solid #E4E4E7;">${numHtml}<section style="margin-top:${num != null ? '-8px' : '0'};">${kickerHtml}<h3 style="font-size:20px;font-weight:800;color:#27272A;margin:0;letter-spacing:0.5px;line-height:1.4;"><span leaf="">${esc(title)}</span></h3></section></section></section>`
  },

  subheading: (title) =>
    `<p style="font-size:15px;font-weight:800;color:#27272A;margin:28px 10px 14px;padding-left:12px;border-left:3px solid #52525B;line-height:1.4;"><span leaf="">${esc(title)}</span></p>`,

  center: (inner) =>
    `<p style="margin:0 10px 24px;font-size:15px;text-align:center;color:#27272A;font-weight:700;letter-spacing:1px;border-top:1px solid #E4E4E7;border-bottom:1px solid #E4E4E7;padding:14px 10px;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 10px;border-left:3px solid #52525B;padding:16px 0 16px 24px;"><p style="margin:0;font-size:16px;font-weight:700;color:#27272A;line-height:1.7;letter-spacing:0.5px;text-align:center;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 10px;background:#FAFAFA;border:1px solid #E4E4E7;padding:20px 22px;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:15px;line-height:1.8;text-align:justify;color:#3F3F46;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: makeImageBlock({ imgStyle: '', captionColor: '#A1A1AA' }),

  carousel: makeCarousel({
    titleStyle:
      'font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#27272A;font-weight:700;',
    hintColor: '#A1A1AA',
    captionColor: '#A1A1AA',
    placeholderBorder: '#E4E4E7',
    placeholderBg: '#FAFAFA',
  }),

  signature: (cfg) =>
    `<section style="margin:48px 10px 0;padding:24px 0 0;border-top:1px solid #E4E4E7;text-align:center;"><p style="margin:0;font-size:13px;color:#A1A1AA;letter-spacing:1px;"><span leaf="">排版 ${esc(cfg.layout)} · 校对 ${esc(cfg.proof)} · 审核 ${esc(cfg.review)}</span></p></section>`,

  listBlock: (ordered, items) => {
    if (ordered) {
      return `<section style="margin:0 10px 24px;">${items
        .map(
          (it, i) =>
            `<section style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px;"><span style="font-size:13px;color:#A1A1AA;font-weight:500;flex-shrink:0;"><span leaf="">${String(i + 1).padStart(2, '0')}</span></span><p style="font-size:15px;color:#52525B;margin:0;line-height:1.8;flex:1;">${it}</p></section>`,
        )
        .join('')}</section>`
    }
    return `<section style="margin:0 10px 24px;">${items
      .map(
        (it) =>
          `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;"><span style="width:5px;height:5px;background:#52525B;border-radius:50%;flex-shrink:0;margin-top:11px;"><span leaf=""><br></span></span><p style="font-size:15px;color:#52525B;margin:0;line-height:1.8;flex:1;">${it}</p></section>`,
      )
      .join('')}</section>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#27272A', border: '#E4E4E7', headBg: '#FAFAFA', text: '#52525B' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0 10px;padding:16px 18px;background:#FAFAFA;border:1px solid #E4E4E7;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#27272A;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:48px 10px;"><section style="height:1px;background:#E4E4E7;"><span leaf=""><br></span></section></section>`,
}

// ============================================================
// 留白禅意（简约）：衬线 + 墨绿 + 超大留白，呼吸感最强
// ============================================================

const ZEN_SERIF = `'Noto Serif SC',Georgia,'Times New Roman',serif`

function zenSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="background:#EEF3F0;color:#3D5046;padding:2px 6px;border-radius:2px;font-size:13px;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#3D5046;border-bottom:1px solid #4A5D52;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="color:#2B2B2B;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:1.5px solid #B5C8BC;font-weight:500;color:#2B2B2B;">${inner}</span>`
  return inner
}

export const zenTheme: Theme = {
  id: 'zen',
  name: '留白禅意',
  desc: '衬线墨绿 · 深度随笔/艺术',
  category: '简约',
  ui: { accent: '#4A5D52', soft: '#B5C8BC', ink: '#2B2B2B' },
  meta: gzh('zen-whitespace', { styles: ['文艺复古', '治愈'], complexity: 1, color: '中性' }, GZH_ADAPTED),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#525252;line-height:1.9;letter-spacing:0.3px;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: zenSeg,

  paragraph: (inner) =>
    `<p style="margin:0 16px 26px;font-size:15px;line-height:1.9;letter-spacing:0.3px;text-align:justify;color:#525252;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const label = `${num != null ? String(num).padStart(2, '0') + ' · ' : ''}${kicker ? esc(kicker) : 'CHAPTER'}`
    return `<section style="margin:64px 16px 32px;"><p style="font-size:10px;color:#4A5D52;font-weight:600;letter-spacing:4px;margin:0 0 10px;text-transform:uppercase;"><span leaf="">${label}</span></p><h3 style="font-family:${ZEN_SERIF};font-size:22px;font-weight:700;color:#2B2B2B;margin:0 0 16px;letter-spacing:0.5px;line-height:1.4;"><span leaf="">${esc(title)}</span></h3><section style="width:40px;height:2px;background:#4A5D52;"><span leaf=""><br></span></section></section>`
  },

  subheading: (title) =>
    `<p style="margin:32px 16px 18px;font-family:${ZEN_SERIF};font-size:17px;font-weight:700;color:#2B2B2B;letter-spacing:0.5px;line-height:1.5;"><span leaf="">${esc(title)}</span></p>`,

  center: (inner) =>
    `<p style="margin:0 16px 26px;font-family:${ZEN_SERIF};font-size:16px;text-align:center;color:#2B2B2B;font-weight:600;letter-spacing:0.8px;line-height:1.9;border-top:1px solid #E8E8E8;border-bottom:1px solid #E8E8E8;padding:20px 10px;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 16px;padding:36px 20px;border-top:1px solid #E8E8E8;border-bottom:1px solid #E8E8E8;text-align:center;"><p style="margin:0;font-family:${ZEN_SERIF};font-size:17px;font-weight:600;color:#2B2B2B;line-height:1.9;letter-spacing:0.8px;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 16px;border-left:2px solid #4A5D52;padding:10px 20px;background:#FFFFFF;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:14px;line-height:1.9;text-align:justify;color:#525252;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: makeImageBlock({ imgStyle: '', captionColor: '#A3A3A3' }),

  carousel: makeCarousel({
    titleStyle: `font-family:${ZEN_SERIF};font-size:16px;line-height:1.8;letter-spacing:1px;text-align:center;text-indent:0;color:#2B2B2B;font-weight:600;`,
    hintColor: '#A3A3A3',
    captionColor: '#A3A3A3',
    placeholderBorder: '#E8E8E8',
    placeholderBg: '#FFFFFF',
  }),

  signature: (cfg) =>
    `<section style="margin:56px 16px 0;padding:24px 0 0;border-top:1px solid #E8E8E8;text-align:center;"><p style="margin:0;font-family:${ZEN_SERIF};font-size:13px;color:#A3A3A3;letter-spacing:1.5px;"><span leaf="">排版 ${esc(cfg.layout)} · 校对 ${esc(cfg.proof)} · 审核 ${esc(cfg.review)}</span></p></section>`,

  listBlock: (ordered, items) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<section style="margin:0 16px 26px;"><${tag} style="margin:0;padding-left:1.5em;line-height:1.9;font-size:15px;color:#525252;">${items
      .map((it) => `<li style="margin:8px 0;">${it}</li>`)
      .join('')}</${tag}></section>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#2B2B2B', border: '#E8E8E8', headBg: '#F5F5F4', text: '#525252' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0 16px;padding:16px 18px;background:#F5F5F4;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#3D5046;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:56px 16px;"><section style="height:1px;background:#E8E8E8;"><span leaf=""><br></span></section></section>`,
}

// ============================================================
// 摸鱼票据（活力）：门票/凭证隐喻，撕票线 + 硬阴影，测评/对比
// ============================================================

function ticketSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="background:#F3F4F6;color:#1F2937;padding:2px 6px;border-radius:4px;font-size:13px;font-weight:600;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="color:#999999;text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#059669;border-bottom:1px solid #A7F3D0;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<span style="color:#059669;font-weight:700;">${inner}</span>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #A7F3D0;font-weight:600;color:#111111;">${inner}</span>`
  return inner
}

export const moyuTicketTheme: Theme = {
  id: 'moyu-ticket',
  name: '摸鱼票据',
  desc: '门票硬阴影 · 测评/对比',
  category: '活力',
  ui: { accent: '#059669', soft: '#A7F3D0', ink: '#1A1A1A' },
  meta: gzh('moyu-ticket', { styles: ['杂志', '卡通'], complexity: 3, color: '暖色' }, GZH_ADAPTED),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#555555;line-height:1.75;letter-spacing:0.5px;overflow-x:hidden;box-sizing:border-box;">${inner}</section>`,

  seg: ticketSeg,

  paragraph: (inner) =>
    `<p style="margin:0 20px 16px;font-size:14px;line-height:1.9;letter-spacing:0.5px;text-align:justify;color:#555555;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const numHtml =
      num != null
        ? `<section style="background:#059669;color:#FFFFFF;font-size:12px;font-weight:800;padding:6px 12px;letter-spacing:2px;flex-shrink:0;"><span leaf="">${String(num).padStart(2, '0')}</span></section>`
        : ''
    const kickerHtml = kicker
      ? `<section style="font-size:12px;color:#888888;"><span leaf="">/ ${esc(kicker)}</span></section>`
      : ''
    return `<section style="margin:40px 20px 24px;"><section style="display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:2px solid #1A1A1A;">${numHtml}<section style="font-size:18px;font-weight:800;color:#1A1A1A;letter-spacing:1px;"><span leaf="">${esc(title)}</span></section>${kickerHtml}</section></section>`
  },

  subheading: (title) =>
    `<section style="margin:28px 20px 16px;display:flex;align-items:center;gap:8px;"><section style="width:4px;height:16px;background:#059669;flex-shrink:0;"><span leaf=""><br></span></section><p style="margin:0;font-size:15px;font-weight:700;color:#1A1A1A;"><span leaf="">${esc(title)}</span></p></section>`,

  center: (inner) =>
    `<p style="margin:0 20px 20px;font-size:14px;text-align:center;color:#059669;font-weight:700;letter-spacing:1px;border-top:2px dashed #A7F3D0;border-bottom:2px dashed #A7F3D0;padding:12px 0;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0 20px;background:#FFFEF8;border:2px solid #1A1A1A;box-shadow:4px 4px 0 #1A1A1A;padding:16px 18px;text-align:center;"><p style="margin:0;font-size:15px;font-weight:800;color:#1A1A1A;line-height:1.7;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0 20px;background:#F0FDF4;border:1px dashed #A7F3D0;padding:12px 16px;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:13px;line-height:1.7;text-align:justify;color:#555555;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: makeImageBlock({ imgStyle: 'border:2px solid #1A1A1A;', captionColor: '#999999' }),

  carousel: makeCarousel({
    titleStyle:
      'font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#1A1A1A;font-weight:800;',
    hintColor: '#999999',
    captionColor: '#999999',
    placeholderBorder: '#A7F3D0',
    placeholderBg: '#F0FDF4',
  }),

  signature: (cfg) =>
    `<section style="margin:36px 20px 0;background:#FFFEF8;border:2px solid #1A1A1A;box-shadow:4px 4px 0 #1A1A1A;padding:14px 16px;text-align:center;"><p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1A1A1A;"><span leaf="">排版 ${esc(cfg.layout)} · 校对 ${esc(cfg.proof)} · 审核 ${esc(cfg.review)}</span></p><p style="margin:0;font-size:10px;color:#999999;letter-spacing:1px;"><span leaf="">VALID FOR ONE READ · ADMIT ONE</span></p></section>`,

  listBlock: (ordered, items) => {
    if (ordered) {
      return `<section style="margin:0 20px 24px;">${items
        .map(
          (it, i) =>
            `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;"><span style="display:inline-block;background:#1A1A1A;color:#FFFFFF;font-size:11px;font-weight:800;padding:2px 8px;flex-shrink:0;margin-top:2px;letter-spacing:1px;"><span leaf="">${String(i + 1).padStart(2, '0')}</span></span><p style="font-size:14px;color:#555555;margin:0;line-height:1.9;flex:1;">${it}</p></section>`,
        )
        .join('')}</section>`
    }
    return `<section style="margin:0 20px 24px;">${items
      .map(
        (it) =>
          `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;"><span style="width:8px;height:8px;background:#059669;flex-shrink:0;margin-top:8px;"><span leaf=""><br></span></span><p style="font-size:14px;color:#555555;margin:0;line-height:1.9;flex:1;">${it}</p></section>`,
      )
      .join('')}</section>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#1A1A1A', border: '#1A1A1A', headBg: '#F0FDF4', text: '#555555' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0 20px;padding:14px 16px;background:#1A1A1A;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#F3F4F6;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:28px 20px;display:flex;align-items:center;"><section style="flex:1;border-top:2px dashed #A7F3D0;"><span leaf=""><br></span></section><span style="padding:0 8px;font-size:12px;color:#A7F3D0;"><span leaf="">✂</span></span><section style="flex:1;border-top:2px dashed #A7F3D0;"><span leaf=""><br></span></section></section>`,
}

// ============================================================
// 橄榄手记（杂志）：编辑部内刊质感，米白纸面 + 橙色点睛
// ============================================================

function oliveSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="background:#EEEFE9;color:#23251D;padding:2px 6px;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:13px;border:1px solid #B6B7AF;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="color:#9EA096;text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#ED7B2F;border-bottom:1px solid #ED7B2F;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="color:#23251D;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #ED7B2F;font-weight:600;color:#23251D;">${inner}</span>`
  return inner
}

export const oliveTheme: Theme = {
  id: 'olive',
  name: '橄榄手记',
  desc: '内刊纸感 · 复盘/案例/评测',
  category: '杂志',
  ui: { accent: '#ED7B2F', soft: '#E5E7E0', ink: '#23251D' },
  meta: gzh('olive-journal', { styles: ['杂志', '文艺复古'], complexity: 3, color: '暖色' }, GZH_ADAPTED),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;padding:8px;box-sizing:border-box;background:#FDFDF8;color:#4D4F46;line-height:1.75;overflow-x:hidden;">${inner}</section>`,

  seg: oliveSeg,

  paragraph: (inner) =>
    `<p style="margin:24px 8px 0;font-size:14px;line-height:1.9;text-align:justify;color:#4D4F46;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const numHtml =
      num != null
        ? `<section style="text-align:center;flex-shrink:0;"><p style="margin:0;font-size:24px;font-weight:800;color:#23251D;line-height:1;letter-spacing:-2px;"><span leaf="">${String(num).padStart(2, '0')}</span></p><p style="margin:0;font-size:8px;font-weight:700;color:#9EA096;letter-spacing:2px;"><span leaf="">PART</span></p></section><span style="width:1px;height:36px;background:#BFC1B7;flex-shrink:0;"><span leaf=""><br></span></span>`
        : ''
    const kickerHtml = kicker
      ? `<p style="margin:0;font-size:11px;font-weight:600;color:#65675E;letter-spacing:1.2px;"><span leaf="">${esc(kicker)}</span></p>`
      : ''
    return `<section style="margin:32px 8px 0;"><section style="display:flex;align-items:center;gap:14px;">${numHtml}<section><p style="margin:0 0 1px;font-size:17px;font-weight:800;color:#23251D;letter-spacing:0.2px;"><span leaf="">${esc(title)}</span></p>${kickerHtml}</section></section></section>`
  },

  subheading: (title) =>
    `<p style="margin:24px 8px 0;"><span style="font-size:16px;font-weight:700;color:#23251D;box-shadow:inset 0 -0.5em 0 rgba(237,123,47,0.18);"><span leaf="">${esc(title)}</span></span></p>`,

  center: (inner) =>
    `<p style="margin:24px 8px 0;text-align:center;font-size:14px;color:#23251D;font-weight:700;border-top:1px solid #BFC1B7;border-bottom:1px solid #BFC1B7;padding:12px 0;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:24px 8px 0;background:#FDFDF8;border-radius:6px;padding:16px 18px;border:1px solid #BFC1B7;"><p style="margin:0;font-size:14px;color:#4D4F46;line-height:1.8;text-align:center;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:24px 8px 0;background:#FDFDF8;border:1px solid #BFC1B7;border-radius:6px;overflow:hidden;"><section style="padding:10px 16px;background:#1E1F23;"><p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;color:#FFFFFF;"><span leaf="">QUOTE</span></p></section><section style="padding:16px 18px;background:#EEEFE9;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:14px;line-height:1.9;text-align:justify;color:#4D4F46;">${p}</p>`,
      )
      .join('')}</section></section>`,

  imageBlock: makeImageBlock({ imgStyle: 'border-radius:6px;border:1px solid #BFC1B7;', captionColor: '#9EA096' }),

  carousel: makeCarousel({
    titleStyle:
      'font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#23251D;font-weight:700;',
    hintColor: '#9EA096',
    captionColor: '#9EA096',
    placeholderBorder: '#BFC1B7',
    placeholderBg: '#EEEFE9',
  }),

  signature: (cfg) =>
    `<section style="margin:32px 8px 0;background:#EEEFE9;border:1px solid #BFC1B7;border-radius:6px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;"><p style="margin:0;font-size:10px;font-weight:800;letter-spacing:3px;color:#23251D;"><span leaf="">COLOPHON</span></p><p style="margin:0;font-size:11px;color:#65675E;"><span leaf="">排版 ${esc(cfg.layout)} · 校对 ${esc(cfg.proof)} · 审核 ${esc(cfg.review)}</span></p></section>`,

  listBlock: (ordered, items) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<section style="margin:24px 8px 0;"><${tag} style="margin:0;padding-left:22px;line-height:1.8;list-style-position:outside;font-size:15px;color:#4D4F46;">${items
      .map((it) => `<li style="margin-bottom:8px;">${it}</li>`)
      .join('')}</${tag}></section>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#23251D', border: '#BFC1B7', headBg: '#EEEFE9', text: '#4D4F46' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:24px 8px 0;padding:14px 16px;background:#EEEFE9;border:1px solid #BFC1B7;border-radius:6px;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#23251D;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<section style="margin:24px 8px 0;height:2px;background:#BFC1B7;"><span leaf=""><br></span></section>`,
}

export const EXTRA_THEMES: Theme[] = [
  moyuGreenTheme,
  redWhiteTheme,
  graphiteTheme,
  zenTheme,
  moyuTicketTheme,
  oliveTheme,
]
