import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Where the editor stops trying to show three columns at once.
 *
 * The three panes carry a minimum of 320 + 380 + 240px plus two handles, so
 * below roughly 950px they squeeze each other into unusable slivers instead of
 * wrapping. Switching at 1024 leaves that margin and keeps a tablet in one mode
 * through a rotation (portrait 768 and landscape 1024 both stay single-pane),
 * so the panes are never torn down and rebuilt while someone is editing.
 */
const NARROW_EDITOR_MAX = 1024

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

/** True while the editor must show one pane at a time. */
export function useIsNarrowEditor() {
  const query = `(max-width: ${NARROW_EDITOR_MAX}px)`
  // Read the media query during the first render rather than correcting after
  // mount: starting on the three-column layout would paint one frame of the
  // squeezed panes on a phone before the effect switched it over.
  const [narrow, setNarrow] = React.useState<boolean>(() => window.matchMedia(query).matches)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => {
      setNarrow(mql.matches)
    }
    mql.addEventListener('change', onChange)
    setNarrow(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return narrow
}
