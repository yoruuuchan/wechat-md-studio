import { Link } from 'react-router'

/**
 * Renders the light inline markup used by the long-form pages (Terms,
 * References): `**bold**`, `` `code` `` and internal links `[text](/path)`.
 * The text comes from the i18n dictionaries and is rendered as React nodes, so
 * there is no HTML-injection surface.
 */
export function RichText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((\/[^\s)]*)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(<strong key={m.index} style={{ color: 'var(--ink-1)' }}>{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(
        <code key={m.index} style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--ink-1)' }}>
          {m[2]}
        </code>,
      )
    } else if (m[3] !== undefined && m[4] !== undefined) {
      nodes.push(
        <Link key={m.index} to={m[4]} className="underline decoration-1 underline-offset-2" style={{ color: 'var(--primary-600)' }}>
          {m[3]}
        </Link>,
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes}</>
}
