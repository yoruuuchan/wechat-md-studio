// CSS 文件型主题的解析：wenyan-core 与 xedit 都把主题写成一段带根选择器的 CSS
// （`#wenyan …` / `#nice …`），这里把它摊成「语义元素 → 内联 CSS 串」，
// 顺带做三件上游没做、但进微信必须做的事：展开 CSS 变量、求值 calc()、丢掉伪元素规则。

import postcss from 'postcss'

/** 选择器（去掉根前缀之后）→ 内部 ThemeStyles 字段。 */
const SELECTOR_MAP: Record<string, string> = {
  '': 'wrapper',
  p: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  'h1 span': 'h1Span',
  'h1 .content': 'h1Span',
  'h2 span': 'h2Span',
  'h2 .content': 'h2Span',
  'h3 span': 'h3Span',
  'h3 .content': 'h3Span',
  blockquote: 'blockquote',
  'blockquote p': 'blockquoteP',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  'li p': 'listItemText',
  table: 'table',
  th: 'th',
  td: 'td',
  code: 'code',
  pre: 'codeBlock',
  'pre code': 'pre',
  img: 'img',
  figure: 'imgWrapper',
  figcaption: 'figcaption',
  '.md-figcaption': 'figcaption',
  hr: 'hr',
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  del: 'del',
  s: 'del',
  mark: 'mark',
  '.markup-highlight': 'mark',
  a: 'a',
}

/**
 * `calc()` 的最小求值器：数字（可带单位）与 + - * / 和括号。
 * 加减要求单位一致或其中一边无量纲；乘除只允许一边带单位。
 * 求不出来就返回 null，调用方把整条声明丢掉——比留一个微信算不出来的值安全。
 */
export function evalCalc(expr: string): string | null {
  const src = expr.trim()
  let pos = 0
  type Num = { n: number; unit: string }
  const ws = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos++
  }
  function parseAtom(): Num | null {
    ws()
    if (src[pos] === '(') {
      pos++
      const inner = parseExpr()
      ws()
      if (src[pos] !== ')') return null
      pos++
      return inner
    }
    const m = /^(-?\d*\.?\d+)([a-z%]*)/.exec(src.slice(pos))
    if (!m) return null
    pos += m[0].length
    return { n: Number(m[1]), unit: m[2] }
  }
  function parseExpr(): Num | null {
    let left = parseTerm()
    if (!left) return null
    for (;;) {
      ws()
      const op = src[pos]
      if (op !== '+' && op !== '-') break
      pos++
      const right = parseTerm()
      if (!right) return null
      if (left.unit && right.unit && left.unit !== right.unit) return null
      left = { n: op === '+' ? left.n + right.n : left.n - right.n, unit: left.unit || right.unit }
    }
    return left
  }
  function parseTerm(): Num | null {
    let left = parseAtom()
    if (!left) return null
    for (;;) {
      ws()
      const op = src[pos]
      if (op !== '*' && op !== '/') break
      pos++
      const right = parseAtom()
      if (!right) return null
      if (op === '*') {
        if (left.unit && right.unit) return null
        left = { n: left.n * right.n, unit: left.unit || right.unit }
      } else {
        if (right.n === 0 || right.unit) return null
        left = { n: left.n / right.n, unit: left.unit }
      }
    }
    return left
  }
  const out = parseExpr()
  ws()
  if (!out || pos !== src.length) return null
  return `${Math.round(out.n * 1000) / 1000}${out.unit}`
}

/** 展开 var()：支持 fallback 与嵌套，最多迭代 8 轮收敛。 */
export function resolveVars(css: string, vars: Record<string, string>): string {
  let out = css
  for (let round = 0; round < 8; round++) {
    const next = out.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?)\s*)?\)/g,
      (_m, name: string, fallback?: string) => vars[name] ?? fallback ?? '',
    )
    if (next === out) break
    out = next
  }
  return out
}

/** 求值一条值里的所有 calc()；有求不出来的就整条返回 null。 */
function resolveCalcIn(value: string): string | null {
  if (!/calc\(/i.test(value)) return value
  const parts: string[] = []
  let rest = value
  for (;;) {
    const at = rest.search(/calc\(/i)
    if (at < 0) {
      parts.push(rest)
      break
    }
    parts.push(rest.slice(0, at))
    // 找到与这个 calc( 配对的右括号
    let depth = 0
    let end = -1
    for (let i = at; i < rest.length; i++) {
      if (rest[i] === '(') depth++
      else if (rest[i] === ')') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) return null
    const v = evalCalc(rest.slice(at + 5, end))
    if (v === null) return null
    parts.push(v)
    rest = rest.slice(end + 1)
  }
  return parts.join('')
}

/** 把根选择器前缀与子代组合符去掉，得到可用于映射的规范选择器。 */
function normalizeSelector(sel: string, root: string): string | null {
  let s = sel.trim()
  if (root && s.startsWith(root)) s = s.slice(root.length)
  s = s.replace(/\s*>\s*/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

export interface CssParseResult {
  styles: Record<string, string>
  /** 被丢掉的规则数，供导入日志核对移植损失 */
  skipped: { pseudo: number; unmapped: number; unresolvable: number }
}

/**
 * 解析一段主题 CSS。
 * - `:root` 里的变量先收集，供 var() 展开
 * - 任何含伪类/伪元素的选择器整条丢弃（微信不支持，wenyan 自己也是这么处理的）
 * - 未映射的选择器丢弃并计数
 */
export function parseCssTheme(cssText: string, root: string): CssParseResult {
  const ast = postcss.parse(cssText)
  const vars: Record<string, string> = {}
  ast.walkRules((rule) => {
    if (rule.selector.trim() !== ':root') return
    rule.walkDecls((d) => {
      if (d.prop.startsWith('--')) vars[d.prop] = d.value.trim()
    })
  })

  const styles: Record<string, string> = {}
  const skipped = { pseudo: 0, unmapped: 0, unresolvable: 0 }

  ast.walkRules((rule) => {
    const sel = rule.selector.trim()
    if (sel === ':root') return
    for (const part of sel.split(',')) {
      if (/::|:(?!root)/.test(part)) {
        skipped.pseudo++
        continue
      }
      const key = normalizeSelector(part, root)
      if (key === null) continue
      const internal = SELECTOR_MAP[key]
      if (!internal) {
        skipped.unmapped++
        continue
      }
      const decls: string[] = []
      rule.walkDecls((d) => {
        const value = resolveVars(d.value.trim(), vars)
        if (/var\(/.test(value)) {
          skipped.unresolvable++
          return
        }
        const calc = resolveCalcIn(value)
        if (calc === null) {
          skipped.unresolvable++
          return
        }
        decls.push(`${d.prop}:${calc}`)
      })
      if (!decls.length) continue
      const prev = styles[internal]
      styles[internal] = prev ? `${prev};${decls.join(';')}` : decls.join(';')
    }
  })

  return { styles, skipped }
}

/** wenyan 的 CSS 头注释是 lineage 的一手证据：Typora 主题名、作者、仓库地址。 */
export function parseCssHeader(cssText: string): { title: string; author: string; repo: string } | null {
  const m = cssText.match(/\/\*([\s\S]*?)\*\//)
  if (!m) return null
  const head = m[1]
  const title = head.match(/Typora Theme\s*-\s*([^\n/]+)/i)?.[1]?.trim() ?? ''
  const author = head.match(/Author\s*-\s*(\S+)/i)?.[1]?.trim() ?? ''
  const repo = head.match(/(https?:\/\/github\.com\/\S+)/i)?.[1]?.trim() ?? ''
  if (!title && !author && !repo) return null
  return { title, author, repo }
}
