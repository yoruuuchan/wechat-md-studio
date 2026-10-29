import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Where the editor stops trying to show three columns at once.
 *
 * Two constraints set this, and the top bar is the binding one. The panes carry
 * a minimum of 320 + 380 + 240px plus two handles, so below roughly 950px they
 * squeeze each other into unusable slivers. The top bar needs far more than
 * that: measured from 1280 to 1600, the article-name group only stops pushing
 * the theme switcher around at about 1440, and the save status is not readable
 * at all until roughly 1536. Below that flexbox silently collapses the group
 * rather than reporting an overflow, so the article name and save status simply
 * disappear.
 *
 * Switching at 1439 keeps every control readable, and keeps a tablet in one
 * mode through a rotation (portrait 768 and landscape 1024 both stay
 * single-pane), so the panes are never torn down and rebuilt while someone is
 * editing.
 */
const NARROW_EDITOR_MAX = 1439

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
