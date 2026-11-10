/**
 * Where the motion composer lives, or null when this build did not pack it.
 *
 * The composer is a static page of its own (public/motion/, copied in by
 * scripts/motion/pack-motion.mjs), not part of the React app: the top bar
 * links to it and the browser leaves the editor. `__REED_MOTION__` is set by
 * vite.config.ts from whether that page exists at build time; it is undefined
 * under vitest, which does not read the Vite config.
 */
export const MOTION_URL: string | null =
  typeof __REED_MOTION__ !== 'undefined' && __REED_MOTION__ ? '/motion/' : null
