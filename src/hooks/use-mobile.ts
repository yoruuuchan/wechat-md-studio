import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Editor layout thresholds.
 *
 * Phone (<640): one pane at a time. This is the only mode where a single column
 * is all that fits, and it keeps the existing switcher behavior.
 *
 * Medium (640–1199): editor and preview side by side, with the images/settings
 * column moved into a drawer. At 640 the two columns' 240 + 360px minimums and
 * the divider still fit; 1199 keeps a half-screen laptop window out of the
 * cramped three-column range.
 *
 * Wide (>=1200): the original three columns. Their minimums total 940px plus
 * dividers, so 1200 leaves roughly 260px of slack instead of squeezing every
 * pane to its floor. The three columns are not tied to the top bar's own
 * threshold: the bar needs about 1440px to show every action in one row, so
 * 1200–1439 keeps the compact bar while the panes are already wide.
 */
export const PHONE_EDITOR_MAX = 639
export const WIDE_EDITOR_MIN = 1200
export const COMPACT_BAR_MAX = 1439

export type EditorLayoutMode = "phone" | "medium" | "wide"

export interface EditorLayout {
  mode: EditorLayoutMode
  /** The full one-row top bar needs this much room; below it the bar is compact. */
  compactBar: boolean
}

function readEditorLayout(): EditorLayout {
  const width = window.innerWidth
  return {
    mode: width <= PHONE_EDITOR_MAX ? "phone" : width < WIDE_EDITOR_MIN ? "medium" : "wide",
    compactBar: width <= COMPACT_BAR_MAX,
  }
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/**
 * Where the editor's three panes are placed, plus whether the top bar has room
 * for all of its actions. Read the media queries during the first render rather
 * than correcting after mount: starting on the desktop layout would paint one
 * frame of squeezed panes on a phone before the effect switched it over.
 */
export function useEditorLayout(): EditorLayout {
  const [layout, setLayout] = React.useState<EditorLayout>(readEditorLayout)

  React.useEffect(() => {
    const queries = [
      window.matchMedia(`(max-width: ${PHONE_EDITOR_MAX}px)`),
      window.matchMedia(`(max-width: ${WIDE_EDITOR_MIN - 1}px)`),
      window.matchMedia(`(max-width: ${COMPACT_BAR_MAX}px)`),
    ]
    const onChange = () => setLayout(readEditorLayout())
    for (const mql of queries) mql.addEventListener("change", onChange)
    setLayout(readEditorLayout())
    return () => {
      for (const mql of queries) mql.removeEventListener("change", onChange)
    }
  }, [])

  return layout
}
