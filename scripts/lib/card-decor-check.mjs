// Shared browser-side guard against short, thick decorative rules in cards.
//
// AGENTS.md bans the "AI decoration" of a short thick rule above a title or
// before an author / page number. 1px hairlines and full-width separators are
// allowed. The scan below looks at every rendered card (cover, body, end) and
// at generated ::before / ::after boxes, then reports anything that is at most
// 16 CSS px tall and 160 CSS px wide while being at least three times as wide
// as it is tall. A hit fails the caller.
//
// A selector whitelist exists only for things that match the geometry but are
// not rules (a block, tape, a border around text). Each entry must state why.
export const SHORT_BAR_RULE = Object.freeze({
  minHeight: 2,
  maxHeight: 16,
  minWidthRatio: 3,
  maxWidth: 160,
  minFillAlpha: 0.3,
})

export function shortBarScanExpression(whitelist = []) {
  return `(() => {
  const RULE = ${JSON.stringify(SHORT_BAR_RULE)};
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

  function dimensions(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (h < RULE.minHeight - EPS || h > RULE.maxHeight + EPS) return null;
    if (w < RULE.minWidthRatio * h - EPS || w > RULE.maxWidth + EPS) return null;
    return { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
  }

  function baseSelector(el) {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].map((name) => '.' + name).join('');
    return tag + classes;
  }

  function record(card, el, pseudo, selector, size, fill) {
    const key = card.dataset.cardIndex + '|' + selector + '|' + fill;
    if (seen.has(key)) return;
    seen.add(key);
    const hit = {
      template: card.dataset.template,
      variant: card.dataset.variant,
      ratio: card.dataset.cardAspect,
      page: Number(card.dataset.cardIndex) + 1,
      kind: card.dataset.cardKind,
      selector,
      width: size.width,
      height: size.height,
      fill,
    };
    const rule = WHITELIST.find((entry) =>
      entry.selector === selector ||
      entry.selector === baseSelector(el) ||
      selector.startsWith(entry.selector + '::'));
    if (rule) whitelisted.push({ ...hit, reason: rule.reason });
    else hits.push(hit);
  }

  function inspect(card, el, pseudo) {
    const style = getComputedStyle(el, pseudo);
    if (!style || style.display === 'none' || style.visibility !== 'visible') return;
    if (Number.parseFloat(style.opacity) === 0) return;
    const content = pseudo ? style.content : null;
    if (pseudo && (!content || content === 'none' || content === 'normal')) return;
    const hasText = pseudo
      ? !(content === '""' || content === "''")
      : (el.textContent || '').trim().length > 0;
    if (hasText) return;

    const selector = baseSelector(el) + (pseudo || '');

    if (!pseudo) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const frame = card.getBoundingClientRect();
      if (rect.right <= frame.left || rect.left >= frame.right ||
        rect.bottom <= frame.top || rect.top >= frame.bottom) return;
      const scale = frame.width / 540;
      const size = dimensions(rect.width / scale, rect.height / scale);
      if (size) {
        if (alphaOf(style.backgroundColor) >= RULE.minFillAlpha ||
          (style.backgroundImage && style.backgroundImage !== 'none')) {
          record(card, el, pseudo, selector, size, 'background');
          return;
        }
      }
    } else {
      const size = dimensions(style.width, style.height);
      if (size) {
        if (alphaOf(style.backgroundColor) >= RULE.minFillAlpha ||
          (style.backgroundImage && style.backgroundImage !== 'none')) {
          record(card, el, pseudo, selector, size, 'background');
          return;
        }
      }
    }

    const box = !pseudo ? el.getBoundingClientRect() : null;
    const frame = card.getBoundingClientRect();
    const scale = frame.width / 540;
    const elementWidth = pseudo ? Number.parseFloat(style.width) : (box.width / scale);
    const elementHeight = pseudo ? Number.parseFloat(style.height) : (box.height / scale);
    if (!Number.isFinite(elementWidth) || !Number.isFinite(elementHeight) ||
      elementHeight > RULE.maxHeight + EPS) return;
    // A checkbox or a framed box has thick borders on all four sides; its top
    // border is part of a square, not a standalone horizontal rule.
    const sideBorder = Math.max(
      Number.parseFloat(style.borderLeftWidth) || 0,
      Number.parseFloat(style.borderRightWidth) || 0,
    );
    if (sideBorder >= RULE.minHeight - EPS) return;
    for (const side of ['Top', 'Bottom']) {
      const width = Number.parseFloat(style['border' + side + 'Width']);
      if (!Number.isFinite(width) || width < RULE.minHeight - EPS) continue;
      if (style['border' + side + 'Style'] === 'none' || style['border' + side + 'Style'] === 'hidden') continue;
      if (alphaOf(style['border' + side + 'Color']) < RULE.minFillAlpha) continue;
      const size = dimensions(elementWidth, width);
      if (size) {
        record(card, el, pseudo, selector, size, 'border-' + side.toLowerCase());
        return;
      }
    }
  }

  const cards = [...document.querySelectorAll('.xhs-card')];
  for (const card of cards) {
    inspect(card, card, null);
    for (const el of card.querySelectorAll('*')) {
      inspect(card, el, null);
      inspect(card, el, '::before');
      inspect(card, el, '::after');
    }
  }
  return {
    cards: cards.length,
    hits,
    whitelisted,
    rule: RULE,
  };
})()`
}