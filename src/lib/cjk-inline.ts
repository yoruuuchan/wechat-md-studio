import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance, StateInline } from 'markdown-it'

/**
 * CJK-aware delimiter flanking for markdown-it.
 *
 * CommonMark decides whether a run of `*`, `_`, `~~` or `==` may open or close
 * emphasis from the characters around it, and it counts East Asian punctuation
 * as punctuation:
 *
 *     left-flanking  = not followed by whitespace
 *                      and (not followed by punctuation
 *                           or preceded by whitespace or punctuation)
 *
 * Chinese prose has no spaces and uses full-width punctuation glued to the word
 * on both sides, so `这是**“重点”**内容` scores as "opener followed by
 * punctuation, not preceded by whitespace or punctuation" and the run is
 * refused: the `**` stays visible in the article and nothing is bold. The same
 * happens to any closer whose left neighbour is `”`, `》` or `）`, to `==`
 * (markdown-it-mark asks the very same question), to `~~`, and to `_`.
 *
 * Chinese authors put a marker next to punctuation constantly, so this plugin
 * recomputes flanking with CJK punctuation counted as an ordinary character -
 * a word character. A run next to `“”《》（）—…` then opens and closes exactly
 * like a run next to a letter, while everything else keeps the standard rule:
 *
 *   - ASCII punctuation keeps the CommonMark meaning, so `**bold.**` and
 *     `a**b**c` behave as they always did.
 *   - The canSplitWord tie-breakers keep the *standard* punctuation set, so the
 *     rule that stops `_` from opening inside a word still sees a full-width
 *     neighbour as punctuation: `（_重点_）` and `_重点_。` keep working.
 *
 * Markdown's own marker characters (`*`, `_`, `~`, `=`, backtick) count as word
 * characters as well, because a run standing next to another element is not
 * punctuation inside a word: without it the closing `==` of
 * `这是==标记中包含**加粗**==的测试` is preceded by `*` and is refused, leaving
 * the `==` in the article.
 */

/** Preview of what a delimiter run can do, as markdown-it's own scan returns it. */
export type DelimScan = ReturnType<StateInline['scanDelims']>

/**
 * East Asian punctuation, quotes and dashes: the characters that a Chinese
 * sentence glues to a marker. Ranges rather than a listed set because the point
 * is the blocks - CJK Symbols and Punctuation (`、。“”《》「」`), the full-width
 * forms (`！？，：；（）【】` and halfwidth katakana punctuation), the vertical and
 * compatibility forms, and the punctuation that CJK text shares with Western
 * typography (curly quotes, en/em dash, ellipsis, middle dot).
 */
export function isCjkPunct(code: number): boolean {
  return (
    (code >= 0x3001 && code <= 0x303f) || // 、。〈〉《》「」『』【】〜
    (code >= 0xfe10 && code <= 0xfe19) || // 竖排标点
    (code >= 0xfe30 && code <= 0xfe4f) || // 兼容形式
    (code >= 0xfe50 && code <= 0xfe6b) || // 小型变体
    (code >= 0xff01 && code <= 0xff65) || // ！＂＃…（）［］｛｝～、。「」
    (code >= 0xffe0 && code <= 0xffe6) || // ￠￡￤￥￦
    (code >= 0x2e00 && code <= 0x2e7f) || // 补充标点
    code === 0x2018 ||
    code === 0x2019 || // ‘ ’
    code === 0x201c ||
    code === 0x201d || // “ ”
    code === 0x2013 ||
    code === 0x2014 || // – —
    code === 0x2025 ||
    code === 0x2026 || // ‥ …
    code === 0x00b7 ||
    code === 0x30fb // · ・
  )
}

/**
 * Characters a Markdown delimiter run is made of: `*`, `_`, `~`, `=` and the
 * code span's backtick. A run sitting directly against one of these is nested in
 * another element, so for flanking it reads as a word character - see the note
 * at the top of the file.
 */
export function isMarker(code: number): boolean {
  return code === 0x2a || code === 0x5f || code === 0x7e || code === 0x3d || code === 0x60
}

/** The character before `start` as a code point; a space at the string start. */
function charBefore(src: string, start: number): number {
  if (start <= 0) return 0x20
  const code = src.charCodeAt(start - 1)
  if (code >= 0xdc00 && code <= 0xdfff) {
    const high = src.charCodeAt(start - 2)
    return high >= 0xd800 && high <= 0xdbff
      ? (high - 0xd800) * 0x400 + (code - 0xdc00) + 0x10000
      : 0xfffd
  }
  return code
}

/** The character after `end` as a code point; a space at the string end. */
function charAfter(src: string, end: number): number {
  if (end >= src.length) return 0x20
  const code = src.charCodeAt(end)
  if (code >= 0xd800 && code <= 0xdbff) {
    const low = src.charCodeAt(end + 1)
    return low >= 0xdc00 && low <= 0xdfff
      ? (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
      : 0xfffd
  }
  return code
}

/** Marks our parsers, so the shared prototype change applies to them alone. */
const OPTED_IN = Symbol.for('wechat-md-studio.cjk-flanking')
let installed = false

/**
 * Install the CJK-aware scan on markdown-it's inline state.
 *
 * markdown-it exposes no hook for the flanking test - it is baked into the
 * `scanDelims` method that the emphasis, strikethrough and mark rules all call -
 * so the method is replaced once on the prototype, and only acts for parsers
 * that used this plugin. Reimplementing emphasis instead would mean copying its
 * delimiter matching, which is the part that is already right.
 */
export function cjkFlanking(md: MarkdownItInstance): void {
  ;(md as MarkdownItInstance & { [OPTED_IN]?: boolean })[OPTED_IN] = true
  if (installed) return
  installed = true

  const proto = MarkdownIt.StateInline.prototype as StateInline
  const base = proto.scanDelims
  proto.scanDelims = function scanDelims(start: number, canSplitWord: boolean): DelimScan {
    const scanned = base.call(this, start, canSplitWord)
    const enabled = (this.md as MarkdownItInstance & { [OPTED_IN]?: boolean })[OPTED_IN]
    if (!enabled) return scanned

    const utils = this.md.utils
    const last = charBefore(this.src, start)
    const next = charAfter(this.src, start + scanned.length)
    const char = (code: number) => String.fromCodePoint(code)
    const isLastPunct = utils.isMdAsciiPunct(last) || utils.isPunctChar(char(last))
    const isNextPunct = utils.isMdAsciiPunct(next) || utils.isPunctChar(char(next))
    const isLastWS = utils.isWhiteSpace(last)
    const isNextWS = utils.isWhiteSpace(next)
    // The flanking test only, with CJK punctuation and Markdown's own markers
    // read as word characters.
    const isWordLike = (code: number) => !isCjkPunct(code) && !isMarker(code)
    const lastBlocks = isLastPunct && isWordLike(last)
    const nextBlocks = isNextPunct && isWordLike(next)

    const left = !isNextWS && (!nextBlocks || isLastWS || lastBlocks)
    const right = !isLastWS && (!lastBlocks || isNextWS || nextBlocks)
    return {
      // The canSplitWord tie-breakers keep the standard punctuation set, which is
      // what keeps the underscore rules about words intact.
      can_open: left && (canSplitWord || !right || isLastPunct),
      can_close: right && (canSplitWord || !left || isNextPunct),
      length: scanned.length,
    }
  }
}
