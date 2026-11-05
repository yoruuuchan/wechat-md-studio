// Shared browser-side guard against "AI decoration" in cards.
//
// AGENTS.md bans three decorations in visual work: short decorative rules of
// any thickness (above a title, before an author, around a page number),
// decorative dashes in short standalone text ("— author", "— 02 —"), and the
// old thick short bar. Full-width separators and thin rules that separate a
// title from its subtitle are allowed. The scan below looks at every rendered
// card (cover, body, end), every visible element and every generated
// ::before / ::after box, and reports:
//
//   1. thick short rules: 2–16px tall, at least three times as wide as tall,
//      at most 160px wide, with a visible fill (alpha >= 0.3);
//   2. thin short rules: 1–2px tall under the same width ratio and cap, with a
//      visible fill (alpha >= 0.1) or a >= 1px top / bottom border;
//   3. decorative dashes: short text (<= 16 characters after removing
//      whitespace) that starts or ends with one or more dash characters,
//      checked on text outside `.xhs-body` and on every ::before / ::after
//      content value. Article body text itself is not checked.
//
// A selector whitelist exists only for things that match a rule's geometry or
// text but are not decorations (a block, tape, a border around text). Each
// entry must state why.
export const SHORT_BAR_RULE = Object.freeze({
  minHeight: 2,
  maxHeight: 16,
  minWidthRatio: 3,
  maxWidth: 160,
  minFillAlpha: 0.3,
})

export const THIN_RULE = Object.freeze({
  minHeight: 1,
  maxHeight: 2,
  maxExclusive: true,
  minWidthRatio: 3,
  maxWidth: 160,
  minFillAlpha: 0.1,
})

export const DECOR_DASH_RULE = Object.freeze({
  maxChars: 16,
  chars: '—–―─－',
})

export function cardDecorScanExpression(whitelist = []) {
  return `(() => {
  const THICK = ${JSON.stringify(SHORT_BAR_RULE)};
  const THIN = ${JSON.stringify(THIN_RULE)};
  const DASH = ${JSON.stringify(DECOR_DASH_RULE)};
  const RULES = { thick: THICK, thin: THIN };
  const WHITELIST = ${JSON.stringify(whitelist)};
  const EPS = 0.01;
  const hits = [];
  const whitelisted = [];
  const seen = new Set();
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function alphaOf(color) {
    if (!color || color === 'transparent') return 0;
    const rgb = color.match(/^rgba?\\(([^)]+)\\)$/i);
    if (rgb) {
      const parts = rgb[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
      return parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
    }
    if (!ctx) return 0;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
  }

  function cssPx(value) {
    if (typeof value === 'number') return value;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sizeFor(width, height, rule) {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (h < rule.minHeight - EPS) return null;
    if (rule.maxExclusive ? h >= rule.maxHeight - EPS : h > rule.maxHeight + EPS) return null;
    if (w < rule.minWidthRatio * h - EPS || w > rule.maxWidth + EPS) return null;
    return { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
  }

  function baseSelector(el) {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].map((name) => '.' + name).join('');
    return tag + classes;
  }

  function record(card, el, selector, rule, source, size, fill) {
    const key = card.dataset.cardIndex + '|' + rule + '|' + selector + '|' + fill + '|' + source;
    if (seen.has(key)) return;
    seen.add(key);
    const hit = {
      template: card.dataset.template,
      variant: card.dataset.variant,
      ratio: card.dataset.cardAspect,
      page: Number(card.dataset.cardIndex) + 1,
      kind: card.dataset.cardKind,
      rule,
      source,
      selector,
      width: size.width,
      height: size.height,
      fill,
    };
    const entry = WHITELIST.find((item) =>
      item.selector === selector ||
      item.selector === baseSelector(el) ||
      selector.startsWith(item.selector + '::'));
    if (entry) whitelisted.push({ ...hit, reason: entry.reason });
    else hits.push(hit);
  }

  function recordDash(card, el, selector, source, text) {
    const key = card.dataset.cardIndex + '|dash|' + selector + '|' + text;
    if (seen.has(key)) return;
    seen.add(key);
    const hit = {
      template: card.dataset.template,
      variant: card.dataset.variant,
      ratio: card.dataset.cardAspect,
      page: Number(card.dataset.cardIndex) + 1,
      kind: card.dataset.cardKind,
      rule: 'dash',
      source,
      selector,
      text,
      length: [...text].length,
    };
    const entry = WHITELIST.find((item) =>
      item.selector === selector ||
      item.selector === baseSelector(el) ||
      selector.startsWith(item.selector + '::'));
    if (entry) whitelisted.push({ ...hit, reason: entry.reason });
    else hits.push(hit);
  }

  function isVisible(style) {
    return Boolean(style) && style.display !== 'none' && style.visibility === 'visible' &&
      Number.parseFloat(style.opacity) !== 0;
  }

  function intersectsCard(el, card) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const frame = card.getBoundingClientRect();
    return !(rect.right <= frame.left || rect.left >= frame.right ||
      rect.bottom <= frame.top || rect.top >= frame.bottom);
  }

  function contentText(value) {
    if (!value || value === 'none' || value === 'normal') return '';
    if (/^(url|counter|counters|image-set)\\(/i.test(value)) return '';
    const attr = value.match(/^attr\\(\\s*([^)\\s]+)\\s*\\)$/i);
    if (attr) return value;
    const quoted = value.match(/^(["'])([\\s\\S]*)\\1$/);
    if (quoted) return quoted[2];
    return value;
  }

  function pseudoAttrValue(el, value) {
    const attr = String(value).match(/^attr\\(\\s*([^)\\s]+)\\s*\\)$/i);
    return attr ? (el.getAttribute(attr[1]) || '') : value;
  }

  function dashText(value) {
    const compact = String(value || '').replace(/\\s+/g, '');
    if (!compact) return null;
    if ([...compact].length > DASH.maxChars) return null;
    const edge = new RegExp('^[' + DASH.chars + ']+|[' + DASH.chars + ']+$');
    return edge.test(compact) ? compact : null;
  }

  function inspectGeometry(card, el, pseudo) {
    const style = getComputedStyle(el, pseudo);
    if (!isVisible(style)) return;
    const content = pseudo ? style.content : null;
    if (pseudo) {
      // A generated box exists only when content is not none/normal; one that
      // paints text (a label or a number) is not a bare rule.
      if (!content || content === 'none' || content === 'normal') return;
      if (contentText(content) !== '') return;
    } else if ((el.textContent || '').trim().length > 0) return;

    const selector = baseSelector(el) + (pseudo || '');
    const frame = card.getBoundingClientRect();
    const scale = frame.width / 540;
    let elementWidth;
    let elementHeight;
    if (pseudo) {
      elementWidth = cssPx(style.width);
      elementHeight = cssPx(style.height);
    } else {
      if (!intersectsCard(el, card)) return;
      const rect = el.getBoundingClientRect();
      elementWidth = rect.width / scale;
      elementHeight = rect.height / scale;
    }
    if (elementWidth === null || elementHeight === null) return;

    for (const ruleName of ['thick', 'thin']) {
      const rule = RULES[ruleName];
      const size = sizeFor(elementWidth, elementHeight, rule);
      if (!size) continue;
      if (alphaOf(style.backgroundColor) >= rule.minFillAlpha ||
        (style.backgroundImage && style.backgroundImage !== 'none')) {
        record(card, el, selector, ruleName, 'background', size, 'background');
      }
    }

    for (const ruleName of ['thick', 'thin']) {
      const rule = RULES[ruleName];
      // A checkbox or a framed box has borders on both sides; its top border is
      // part of a square, not a standalone horizontal rule.
      const left = Number.parseFloat(style.borderLeftWidth) || 0;
      const right = Number.parseFloat(style.borderRightWidth) || 0;
      if (left >= rule.minHeight - EPS && right >= rule.minHeight - EPS) continue;
      for (const side of ['Top', 'Bottom']) {
        const width = Number.parseFloat(style['border' + side + 'Width']);
        if (!Number.isFinite(width) || width < rule.minHeight - EPS) continue;
        if (style['border' + side + 'Style'] === 'none' || style['border' + side + 'Style'] === 'hidden') continue;
        if (alphaOf(style['border' + side + 'Color']) < rule.minFillAlpha) continue;
        const size = sizeFor(elementWidth, width, rule);
        if (size) {
          record(card, el, selector, ruleName, 'border-' + side.toLowerCase(), size, 'border-' + side.toLowerCase());
        }
      }
    }
  }

  function inspectPseudoDash(card, el, pseudo) {
    const style = getComputedStyle(el, pseudo);
    if (!isVisible(style)) return;
    const text = pseudoAttrValue(el, contentText(style.content));
    const compact = dashText(text);
    if (!compact) return;
    recordDash(card, el, baseSelector(el) + pseudo, 'pseudo', compact);
  }

  function inspectTextDash(card, el) {
    if (el.closest('.xhs-body')) return;
    const style = getComputedStyle(el);
    if (!isVisible(style)) return;
    if (!intersectsCard(el, card)) return;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;
      const compact = dashText(node.textContent);
      if (!compact) continue;
      recordDash(card, el, baseSelector(el), 'text', compact);
    }
  }

  const cards = [...document.querySelectorAll('.xhs-card')];
  for (const card of cards) {
    inspectGeometry(card, card, null);
    const elements = [card, ...card.querySelectorAll('*')];
    for (const el of elements) {
      inspectGeometry(card, el, null);
      inspectGeometry(card, el, '::before');
      inspectGeometry(card, el, '::after');
      inspectPseudoDash(card, el, '::before');
      inspectPseudoDash(card, el, '::after');
      inspectTextDash(card, el);
    }
  }
  return {
    cards: cards.length,
    hits,
    whitelisted,
    rules: { thick: THICK, thin: THIN, dash: DASH },
  };
})()`
}