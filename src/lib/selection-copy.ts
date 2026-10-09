/**
 * Turn a selection inside the preview article into a self-contained fragment
 * that survives the trip into WeChat.
 *
 * A browser copies a selection by serializing the DOM Range itself: nodes the
 * range only partly covers are rebuilt from just the covered content, and
 * every ancestor above the range's common ancestor is dropped. That is exactly
 * the wrong shape for WeChat - select a few words inside a paragraph and the
 * pasted fragment arrives without the `<p>` and without the article root
 * `<section>`, so all the inline styles those two carry (root background and
 * line-height, paragraph metrics and justification) are gone.
 *
 * This rebuilds the missing shell: from the range's common ancestor up to (and
 * including) the article root, every level is cloned shallowly - attributes
 * and inline styles only - and the selected fragment is re-wrapped in that
 * chain. The selection itself is never widened; a range that stops in the
 * middle of a paragraph stays in the middle of the paragraph.
 *
 * Returns null for any selection this must not own: no range, a collapsed
 * range, or an endpoint outside `root` (a drag that left the article, or a
 * selection elsewhere in the app). The caller keeps the browser's own copy
 * behaviour for those.
 */
export function serializeWechatSelection(
  root: Element,
  selection: Selection | null,
): { html: string; plainText: string } | null {
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed) return null

  const { startContainer, endContainer, commonAncestorContainer } = range
  // Both endpoints inside the root also guarantees the common ancestor is:
  // it is the deepest node containing both, and the root already contains both.
  if (!root.contains(startContainer) || !root.contains(endContainer)) return null

  // Exactly what was dragged over - cloneContents keeps partial blocks partial
  // instead of rounding the selection up to whole elements.
  const fragment = range.cloneContents()

  // Ancestors between the common ancestor and the root, outermost first. The
  // common ancestor itself is included: cloneContents drops it from the top of
  // the fragment even when it is the deepest node the range touches.
  const chain: Element[] = []
  let node: Node | null = commonAncestorContainer
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE) chain.push(node as Element)
    node = node.parentNode
  }
  // The walk must land on the root; anywhere else means the live DOM and the
  // selection have drifted apart, and the native copy is the safe answer.
  if (node !== root) return null
  chain.reverse()

  // Root first, then each ancestor going in, then the selected content at the
  // bottom. cloneNode(false) copies the attributes (the inline styles) without
  // pulling in siblings the user did not select.
  const article = root.cloneNode(false) as Element
  let cursor = article
  for (const ancestor of chain) {
    const clone = ancestor.cloneNode(false)
    cursor.appendChild(clone)
    cursor = clone as Element
  }
  cursor.appendChild(fragment)

  // textContent mirrors plainTextOf() in the full-document copy: the visible
  // text only, no markup. It reads the wrapped tree, which contributes nothing
  // of its own, so it equals the selected text exactly.
  return { html: article.outerHTML, plainText: article.textContent ?? '' }
}
