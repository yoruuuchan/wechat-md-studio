/**
 * First-run onboarding state: one flag per browser, written only when the
 * user finishes or dismisses the tour. The settings entry that replays the
 * tour deliberately does not consult or clear it - the flag controls the
 * automatic first visit only.
 *
 * Only "done" counts as seen, so anything unreadable (private mode, a value
 * from a future version) falls back to showing the tour once more - the
 * harmless direction to fail in.
 */

const ONBOARDING_KEY = 'mopai.onboarding.v1'

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'done'
  } catch {
    // Private mode: cannot tell, so treat it as a first visit.
    return false
  }
}

/** Called when the tour ends for any reason the user chose. */
export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'done')
  } catch {
    // Not sticking only costs one more tour next visit.
  }
}
