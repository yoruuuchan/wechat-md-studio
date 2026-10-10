import type { CarouselRatio, InlineSeg } from './types'
import { ORIGINAL_LICENSE, type ThemeMeta, type ThemeOrigin } from './theme-meta'
import { APP_BYLINE, APP_NAME, REPO_URL } from './brand'
import { baseTableBlock, carouselFrame, esc, type Theme } from './theme-kit'
import { EXTRA_THEMES } from './themes-extra'
import { IMPORTED_THEMES } from './themes-imported'
import { t } from './i18n'

// 主题 = 一组「语义节点 → 内联样式 HTML」的模板函数。
// 契约、渲染原语、微信红线消毒与导入主题的装配器都在 theme-kit.ts，
// 本文件只放手写主题与 catalog 汇总；新增主题不改稿件与解析层。

export { BLANK, baseTableBlock, carouselFrame, esc, sanitizeStyle } from './theme-kit'
export type { CarouselFrame, Theme, ThemeCategory, ThemePalette, ThemeStyles } from './theme-kit'
export type { ColorFamily, Complexity, StyleTag, ThemeMeta, ThemeOrigin } from './theme-meta'
export { COMPLEXITY_LEVELS, COLOR_FAMILIES, STYLE_TAGS, complexityLabel } from './theme-meta'

/** 自研主题的来源档案：仓库地址跟着 brand.ts 走，开源后自动填上。 */
const ORIGINAL_ORIGIN: ThemeOrigin = {
  kind: 'original',
  project: APP_NAME,
  author: APP_BYLINE.replace(/^by\s*/, ''),
  repo: REPO_URL,
  license: ORIGINAL_LICENSE,
  attribution: `${APP_NAME} ${APP_BYLINE} 自研主题`,
}

function original(meta: Omit<ThemeMeta, 'origin'>): ThemeMeta {
  return { ...meta, origin: ORIGINAL_ORIGIN }
}

// ---------- golden：亮蓝科技风，与示范稿逐段一致 ----------

function goldenSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) {
    inner = `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#F3F6FA;padding:1px 5px;border-radius:4px;color:#17365D;">${inner}</span>`
  }
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#1677FF;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #B9DAFF;font-weight:700;color:#1677FF;">${inner}</span>`
  return inner
}

function goldenCarouselItem(it: { src: string; alt: string }, last: boolean, ratio: CarouselRatio): string {
  const f = carouselFrame(ratio)
  const frame = `width:${f.width}px;height:${f.height}px`
  const img = it.src
    ? `<img src="${esc(it.src)}" width="${f.width}" height="${f.height}" style="display:block;width:${f.width}px;height:auto;border-radius:8px;border:1px solid #E6EDF6;background:#F6FAFF;" />`
    : `<section style="${frame};box-sizing:border-box;border:1px dashed #B9DAFF;background:#F6FAFF;display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:#888888;text-indent:0;text-align:center;"><span leaf="">${t('theme.pendingImage')}</span></p></section>`
  const cap = it.alt
    ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;letter-spacing:0.5px;text-align:center;text-indent:0;color:#888888;"><span leaf="">${esc(it.alt)}</span></p>`
    : ''
  return `<section style="display:inline-block;vertical-align:top;width:${f.width}px;margin-right:${last ? 0 : 10}px;white-space:normal;">${img}${cap}</section>`
}

export const goldenTheme: Theme = {
  id: 'golden',
  name: 'Golden Sample',
  desc: '亮蓝科技风 · 日常默认',
  category: '杂志',
  ui: { accent: '#1677FF', soft: '#B9DAFF', ink: '#17365D' },
  meta: original({
    styles: ['科技', '商务'],
    complexity: 2,
    color: '冷色',
  }),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#333333;line-height:1.75;letter-spacing:1px;overflow-x:hidden;padding:0 10px;box-sizing:border-box;">${inner}</section>`,

  seg: goldenSeg,

  paragraph: (inner) =>
    `<p style="margin:24px 0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:justify;text-indent:2em;color:#333333;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const label = num != null ? `${String(num).padStart(2, '0')}${kicker ? ' / ' + esc(kicker) : ''}` : esc(kicker)
    const kickerHtml = label
      ? `<p style="margin:0 0 7px;font-size:11px;line-height:1.4;letter-spacing:2px;color:#1677FF;font-weight:700;text-indent:0;"><span leaf="">${label}</span></p>`
      : ''
    return `<section style="margin:38px 0 24px;">${kickerHtml}<h3 style="margin:0;padding-left:10px;border-left:3px solid #1677FF;font-size:20px;line-height:1.45;letter-spacing:.5px;font-weight:800;color:#1F2937;"><span leaf="">${esc(title)}</span></h3></section>`
  },

  subheading: (title) =>
    `<p style="margin:30px 0 18px;font-size:16px;line-height:1.6;letter-spacing:1px;font-weight:700;color:#1F2937;text-indent:0;"><span leaf="">${esc(title)}</span></p>`,

  center: (inner) =>
    `<p style="margin:24px 0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#1677FF;font-weight:700;"><span style="border-bottom:2px solid #B9DAFF;">${inner}</span></p>`,

  quoteCard: (inner) =>
    `<section style="margin:0;padding:16px 18px;background:#F6FAFF;border-left:3px solid #1677FF;"><p style="margin:0;font-size:16px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#17365D;font-weight:700;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0;padding:14px 0 14px 18px;border-left:3px solid #1677FF;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:15px;line-height:1.75;letter-spacing:1px;text-align:justify;text-indent:0;color:#17365D;font-weight:700;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) =>
    src
      ? `<p style="margin:24px 0 8px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;height:auto;border-radius:8px;border:1px solid #E6EDF6;" /></p><p style="margin:8px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#888888;"><span leaf="">${esc(caption)}</span></p>`
      : `<p style="margin:24px 0;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#888888;"><span leaf="">${esc(caption)}</span></p>`,

  carousel: (title, caption, items, ratio) => {
    const head = `<section style="margin:0;">${
      title
        ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#1677FF;font-weight:700;"><span style="border-bottom:2px solid #B9DAFF;"><span leaf="">${esc(title)}</span></span></p>`
        : ''
    }<p style="margin:0 0 14px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#888888;"><span leaf="">← 左右滑动查看图片 →</span></p></section>`
    const body = `<section style="margin:0;padding:0 0 6px;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;">${items
      .map((it, i) => goldenCarouselItem(it, i === items.length - 1, ratio))
      .join('')}</section>`
    const cap = `<p style="margin:12px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#888888;"><span leaf="">${esc(caption)}</span></p>`
    return head + body + cap
  },

  signature: (cfg) =>
    `<section style="margin:36px 0 0;padding:8px 0 0;"><p style="margin:0 0 6px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;color:#888888;text-indent:0;"><span leaf="">${t('render.sigLayout')} | ${esc(cfg.layout)}</span></p><p style="margin:0 0 6px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;color:#888888;text-indent:0;"><span leaf="">${t('render.sigProof')} | ${esc(cfg.proof)}</span></p><p style="margin:0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;color:#888888;text-indent:0;"><span leaf="">${t('render.sigReview')} | ${esc(cfg.review)}</span></p></section>`,

  listBlock: (ordered, items) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} style="margin:24px 0;padding-left:1.5em;font-size:15px;line-height:1.75;letter-spacing:1px;color:#333333;">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#17365D', border: '#E6EDF6', headBg: '#F6FAFF', text: '#333333' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0;padding:14px 16px;background:#F6FAFF;border-radius:8px;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#17365D;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<p style="margin:32px 0;text-align:center;text-indent:0;font-size:12px;letter-spacing:4px;color:#B9DAFF;"><span leaf="">· · ·</span></p>`,
}

// ---------- minimal：极简，层级只靠字号/字重/间距/细线 ----------

function minimalSeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#F5F5F5;padding:1px 5px;border-radius:4px;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="border-bottom:1px solid #111111;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;color:#111111;">${inner}</strong>`
  if (s.mark) inner = `<span style="font-weight:700;color:#111111;border-bottom:1px solid #111111;">${inner}</span>`
  return inner
}

export const minimalTheme: Theme = {
  id: 'minimal',
  name: '极简',
  desc: '无装饰 · 纯文字层级',
  category: '简约',
  ui: { accent: '#111111', soft: '#E5E5E5', ink: '#111111' },
  meta: original({
    styles: ['学术', '杂志'],
    complexity: 1,
    color: '中性',
  }),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#333333;line-height:1.75;letter-spacing:1px;overflow-x:hidden;padding:0 10px;box-sizing:border-box;">${inner}</section>`,

  seg: minimalSeg,

  paragraph: (inner) =>
    `<p style="margin:24px 0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:justify;text-indent:2em;color:#333333;">${inner}</p>`,

  heading: (num, _kicker, title) =>
    `<p style="margin:40px 0 20px;padding-bottom:10px;border-bottom:1px solid #EAEAEA;font-size:18px;line-height:1.5;letter-spacing:0.5px;font-weight:700;color:#111111;text-indent:0;">${
      num != null ? `<span style="color:#9A9A9A;font-weight:400;">${String(num).padStart(2, '0')}&nbsp;&nbsp;</span>` : ''
    }<span leaf="">${esc(title)}</span></p>`,

  subheading: (title) =>
    `<p style="margin:30px 0 16px;font-size:15px;line-height:1.6;letter-spacing:1px;font-weight:700;color:#111111;text-indent:0;"><span leaf="">${esc(title)}</span></p>`,

  center: (inner) =>
    `<p style="margin:28px 0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#111111;font-weight:700;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0;padding:18px 0;border-top:1px solid #EAEAEA;border-bottom:1px solid #EAEAEA;"><p style="margin:0;font-size:16px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#111111;font-weight:700;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0;padding:2px 0 2px 16px;border-left:2px solid #DDDDDD;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:14px;line-height:1.8;letter-spacing:1px;text-align:justify;text-indent:0;color:#666666;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) =>
    src
      ? `<p style="margin:28px 0 8px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;height:auto;" /></p><p style="margin:8px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#9A9A9A;"><span leaf="">${esc(caption)}</span></p>`
      : `<p style="margin:24px 0;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#9A9A9A;"><span leaf="">${esc(caption)}</span></p>`,

  carousel: (title, caption, items, ratio) => {
    const f = carouselFrame(ratio)
    const head = `<section style="margin:0;">${
      title
        ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;text-indent:0;color:#111111;font-weight:700;"><span leaf="">${esc(title)}</span></p>`
        : ''
    }<p style="margin:0 0 14px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#9A9A9A;"><span leaf="">← 左右滑动查看图片 →</span></p></section>`
    const body = `<section style="margin:0;padding:0 0 6px;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;">${items
      .map((it, i) => {
        const img = it.src
          ? `<img src="${esc(it.src)}" width="${f.width}" height="${f.height}" style="display:block;width:${f.width}px;height:auto;" />`
          : `<section style="width:${f.width}px;height:${f.height}px;box-sizing:border-box;border:1px dashed #DDDDDD;display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:#9A9A9A;text-indent:0;text-align:center;"><span leaf="">${t('theme.pendingImage')}</span></p></section>`
        const cap = it.alt
          ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;letter-spacing:0.5px;text-align:center;text-indent:0;color:#9A9A9A;"><span leaf="">${esc(it.alt)}</span></p>`
          : ''
        return `<section style="display:inline-block;vertical-align:top;width:${f.width}px;margin-right:${i === items.length - 1 ? 0 : 10}px;white-space:normal;">${img}${cap}</section>`
      })
      .join('')}</section>`
    const cap = `<p style="margin:12px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#9A9A9A;"><span leaf="">${esc(caption)}</span></p>`
    return head + body + cap
  },

  signature: (cfg) =>
    `<section style="margin:40px 0 0;padding:16px 0 0;border-top:1px solid #EAEAEA;"><p style="margin:0 0 6px;font-size:14px;line-height:1.75;letter-spacing:1px;text-align:center;color:#9A9A9A;text-indent:0;"><span leaf="">${t('render.sigLayout')} | ${esc(cfg.layout)}</span></p><p style="margin:0 0 6px;font-size:14px;line-height:1.75;letter-spacing:1px;text-align:center;color:#9A9A9A;text-indent:0;"><span leaf="">${t('render.sigProof')} | ${esc(cfg.proof)}</span></p><p style="margin:0;font-size:14px;line-height:1.75;letter-spacing:1px;text-align:center;color:#9A9A9A;text-indent:0;"><span leaf="">${t('render.sigReview')} | ${esc(cfg.review)}</span></p></section>`,

  listBlock: (ordered, items) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} style="margin:24px 0;padding-left:1.5em;font-size:15px;line-height:1.75;letter-spacing:1px;color:#333333;">${items
      .map((it) => `<li style="margin:6px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#111111', border: '#EAEAEA', headBg: '#FAFAFA', text: '#333333' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0;padding:14px 16px;background:#F7F7F7;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#333333;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<p style="margin:32px 0;text-align:center;text-indent:0;font-size:12px;letter-spacing:4px;color:#CCCCCC;"><span leaf="">—</span></p>`,
}

// ---------- steady：稳重政务，藏青 + 中文序号 ----------

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function steadySeg(s: InlineSeg): string {
  let inner = `<span leaf="">${esc(s.text)}</span>`
  if (s.code) inner = `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#F2F5F9;padding:1px 5px;border-radius:4px;color:#1B3A6B;">${inner}</span>`
  if (s.italic) inner = `<em>${inner}</em>`
  if (s.strike) inner = `<span style="text-decoration:line-through;">${inner}</span>`
  if (s.link) inner = `<span style="color:#1F4E8C;">${inner}</span>`
  if (s.bold && !s.mark) inner = `<strong style="font-weight:700;">${inner}</strong>`
  if (s.mark) inner = `<span style="border-bottom:2px solid #C7D8EC;font-weight:700;color:#1F4E8C;">${inner}</span>`
  return inner
}

export const steadyTheme: Theme = {
  id: 'steady',
  name: '稳重',
  desc: '藏青政务风 · 成果宣传',
  category: '商务',
  ui: { accent: '#1F4E8C', soft: '#C7D8EC', ink: '#1B3A6B' },
  meta: original({
    styles: ['政务', '商务'],
    complexity: 2,
    color: '冷色',
  }),

  root: (inner) =>
    `<section style="max-width:677px;margin:0 auto;background:#FFFFFF;color:#333333;line-height:1.75;letter-spacing:1px;overflow-x:hidden;padding:0 10px;box-sizing:border-box;">${inner}</section>`,

  seg: steadySeg,

  paragraph: (inner) =>
    `<p style="margin:24px 0;font-size:15px;line-height:1.8;letter-spacing:1px;text-align:justify;text-indent:2em;color:#333333;">${inner}</p>`,

  heading: (num, kicker, title) => {
    const cn = num != null ? CN_NUM[num - 1] || String(num) : ''
    const label = kicker ? `${cn ? cn + ' / ' : ''}${esc(kicker)}` : cn ? `第${cn}部分` : ''
    const kickerHtml = label
      ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.4;letter-spacing:3px;color:#8C9BB3;font-weight:700;text-indent:0;"><span leaf="">${label}</span></p>`
      : ''
    return `<section style="margin:40px 0 24px;">${kickerHtml}<h3 style="margin:0;padding-left:12px;border-left:4px solid #1F4E8C;font-size:19px;line-height:1.5;letter-spacing:1px;font-weight:700;color:#1B3A6B;"><span leaf="">${esc(title)}</span></h3></section>`
  },

  subheading: (title) =>
    `<p style="margin:30px 0 16px;font-size:16px;line-height:1.6;letter-spacing:1px;font-weight:700;color:#1B3A6B;text-indent:0;"><span leaf="">${esc(title)}</span></p>`,

  center: (inner) =>
    `<p style="margin:26px 0;font-size:15px;line-height:1.8;letter-spacing:2px;text-align:center;text-indent:0;color:#1F4E8C;font-weight:700;">${inner}</p>`,

  quoteCard: (inner) =>
    `<section style="margin:0;padding:18px 20px;background:#F4F7FB;border-left:4px solid #1F4E8C;"><p style="margin:0;font-size:16px;line-height:1.8;letter-spacing:1px;text-align:center;text-indent:0;color:#1B3A6B;font-weight:700;">${inner}</p></section>`,

  quoteBox: (paras) =>
    `<section style="margin:0;padding:14px 16px;background:#F7F8FA;border:1px solid #E4E9F0;">${paras
      .map(
        (p, i) =>
          `<p style="margin:${i === paras.length - 1 ? 0 : '8px 0 0'};font-size:14px;line-height:1.8;letter-spacing:1px;text-align:justify;text-indent:0;color:#5A6B80;">${p}</p>`,
      )
      .join('')}</section>`,

  imageBlock: (src, caption) =>
    src
      ? `<p style="margin:26px 0 8px;text-align:center;text-indent:0;"><img src="${esc(src)}" style="display:block;width:100%;height:auto;border:1px solid #E4E9F0;" /></p><p style="margin:8px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#8C9BB3;"><span leaf="">${esc(caption)}</span></p>`
      : `<p style="margin:24px 0;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#8C9BB3;"><span leaf="">${esc(caption)}</span></p>`,

  carousel: (title, caption, items, ratio) => {
    const f = carouselFrame(ratio)
    const head = `<section style="margin:0;">${
      title
        ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.8;letter-spacing:2px;text-align:center;text-indent:0;color:#1F4E8C;font-weight:700;"><span leaf="">${esc(title)}</span></p>`
        : ''
    }<p style="margin:0 0 14px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#8C9BB3;"><span leaf="">← 左右滑动查看图片 →</span></p></section>`
    const body = `<section style="margin:0;padding:0 0 6px;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;">${items
      .map((it, i) => {
        const img = it.src
          ? `<img src="${esc(it.src)}" width="${f.width}" height="${f.height}" style="display:block;width:${f.width}px;height:auto;border:1px solid #E4E9F0;" />`
          : `<section style="width:${f.width}px;height:${f.height}px;box-sizing:border-box;border:1px dashed #C7D8EC;background:#F7F8FA;display:flex;align-items:center;justify-content:center;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:#8C9BB3;text-indent:0;text-align:center;"><span leaf="">${t('theme.pendingImage')}</span></p></section>`
        const cap = it.alt
          ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;letter-spacing:0.5px;text-align:center;text-indent:0;color:#8C9BB3;"><span leaf="">${esc(it.alt)}</span></p>`
          : ''
        return `<section style="display:inline-block;vertical-align:top;width:${f.width}px;margin-right:${i === items.length - 1 ? 0 : 10}px;white-space:normal;">${img}${cap}</section>`
      })
      .join('')}</section>`
    const cap = `<p style="margin:12px 0 24px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;text-indent:0;color:#8C9BB3;"><span leaf="">${esc(caption)}</span></p>`
    return head + body + cap
  },

  signature: (cfg) =>
    `<section style="margin:40px 0 0;padding:16px 0 0;border-top:1px solid #E4E9F0;"><p style="margin:0 0 6px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;color:#8C9BB3;text-indent:0;"><span leaf="">${t('render.sigLayout')} | ${esc(cfg.layout)}</span></p><p style="margin:0 0 6px;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;color:#8C9BB3;text-indent:0;"><span leaf="">${t('render.sigProof')} | ${esc(cfg.proof)}</span></p><p style="margin:0;font-size:15px;line-height:1.75;letter-spacing:1px;text-align:center;color:#8C9BB3;text-indent:0;"><span leaf="">${t('render.sigReview')} | ${esc(cfg.review)}</span></p></section>`,

  listBlock: (ordered, items) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} style="margin:24px 0;padding-left:1.5em;font-size:15px;line-height:1.8;letter-spacing:1px;color:#333333;">${items
      .map((it) => `<li style="margin:8px 0;">${it}</li>`)
      .join('')}</${tag}>`
  },

  tableBlock: (head, rows, align) =>
    baseTableBlock(head, rows, align, { accent: '#1B3A6B', border: '#E4E9F0', headBg: '#F4F7FB', text: '#333333' }),

  codeBlock: (_lang, code) =>
    `<section style="margin:0;padding:14px 16px;background:#F7F8FA;border:1px solid #E4E9F0;overflow-x:auto;"><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.7;letter-spacing:0;text-indent:0;color:#1B3A6B;white-space:pre-wrap;"><span leaf="">${esc(code)}</span></p></section>`,

  hr: () =>
    `<p style="margin:32px 0;text-align:center;text-indent:0;font-size:12px;letter-spacing:4px;color:#C7D8EC;"><span leaf="">· · ·</span></p>`,
}

export const THEMES: Theme[] = [goldenTheme, minimalTheme, steadyTheme, ...EXTRA_THEMES, ...IMPORTED_THEMES]

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) || goldenTheme
}
