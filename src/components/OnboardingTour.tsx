import { useEffect } from 'react'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { t } from '@/lib/i18n'
import { markOnboardingSeen } from '@/lib/onboarding'

interface Props {
  /** Bumped by the editor page to (re)start the tour; 0 keeps it idle. */
  run: number
  /** Called when the user finishes or dismisses the tour. Keep it stable. */
  onEnd: () => void
}

/**
 * The first-run tour: five steps over the editor, preview, theme switcher,
 * side panel and copy button. Rendered as an empty element - all overlay
 * DOM is owned by driver.js and attached to <body>.
 *
 * Anchors are data attributes on the panes themselves, so a layout change
 * moves the tour with it; a missing anchor (collapsed side panel) is skipped
 * rather than pointed at nothing. The overlay blocks clicks on everything
 * but the popover, so the tour never triggers a copy, upload or theme change
 * of its own.
 */
export default function OnboardingTour({ run, onEnd }: Props) {
  useEffect(() => {
    if (!run) return
    // Set while this effect tears its own driver down (unmount, StrictMode
    // remount, restart): that teardown is not the user finishing the tour.
    const tearingDown = { current: false }
    const tour: Driver = driver({
      steps: [
        {
          element: '[data-onboarding="editor"]',
          popover: {
            title: t('onboarding.step.editor.title'),
            description: t('onboarding.step.editor.desc'),
            side: 'right',
            align: 'center',
          },
        },
        {
          element: '[data-onboarding="preview"]',
          popover: {
            title: t('onboarding.step.preview.title'),
            description: t('onboarding.step.preview.desc'),
            side: 'right',
            align: 'center',
          },
        },
        {
          element: '[data-theme-switcher]',
          popover: {
            title: t('onboarding.step.theme.title'),
            description: t('onboarding.step.theme.desc'),
            side: 'bottom',
            align: 'center',
          },
        },
        {
          element: '[data-onboarding="sidebar"]',
          popover: {
            title: t('onboarding.step.sidebar.title'),
            description: t('onboarding.step.sidebar.desc'),
            side: 'left',
            align: 'center',
          },
        },
        {
          element: '[data-onboarding="copy"]',
          popover: {
            title: t('onboarding.step.copy.title'),
            description: t('onboarding.step.copy.desc'),
            side: 'bottom',
            align: 'end',
          },
        },
      ],
      showProgress: true,
      progressText: t('onboarding.progress'),
      nextBtnText: t('onboarding.next'),
      prevBtnText: t('onboarding.prev'),
      doneBtnText: t('onboarding.done'),
      closeBtnLabel: t('onboarding.close'),
      // Clicking the dimmed area must not silently dismiss (and mark seen) a
      // tour the user has barely read; the explicit Skip button is right there.
      overlayClickBehavior: 'none',
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 14,
      popoverClass: 'reed-tour',
      disableActiveInteraction: true,
      skipMissingElement: true,
      onPopoverRender: (popover, opts) => {
        const skip = document.createElement('button')
        skip.type = 'button'
        skip.className = 'driver-popover-footer-btn reed-tour-skip'
        skip.textContent = t('onboarding.skip')
        skip.addEventListener('click', () => opts.driver.destroy())
        popover.footerButtons.prepend(skip)
      },
      onDestroyed: () => {
        if (tearingDown.current) return
        markOnboardingSeen()
        onEnd()
      },
    })
    tour.drive()
    return () => {
      tearingDown.current = true
      tour.destroy()
    }
  }, [run, onEnd])

  return null
}
