/**
 * Browser soft-keyboard inset from `visualViewport`.
 *
 * Chrome with `interactive-widget=resizes-content` shrinks `innerHeight`, so
 * the inset stays ~0 and flex/sticky layout already lifts. Overlay keyboards
 * leave layout height alone — then `--xrk-keyboard-inset` lifts sticky
 * composers.
 *
 * Flutter LocalHostShell (adjustNothing + overlays-content) pins `#root`
 * bottom from MediaQuery and sets {@link SHELL_KEYBOARD_ATTR} with
 * `--xrk-keyboard-inset: 0`. While that attr is present this binder is a
 * no-op — do not reintroduce optimistic VV guesses or dense focus timers;
 * they fight the shell and stutter.
 *
 * Desktop / wide windows must ignore VV deltas: after OS sleep/wake,
 * Chromium/Electron often reports a collapsed `visualViewport.height` while
 * `innerHeight` stays full. Treating that gap as an OSK lifts the sticky
 * composer above a floating bottom workbench that stays at `bottom: 0`,
 * leaving a blank strip between the input and the panel. Phone overlay
 * keyboards still need the lift — gate on {@link PHONE_MAX} (same floor as
 * AppFrame phone chrome) and drop absurd insets (> {@link KEYBOARD_INSET_MAX_FRACTION}
 * of layout height) that never match a real OSK.
 *
 * Attr name lives in ui-primitives (`shell-frame`) so overlays and this
 * binder cannot drift onto different strings.
 */

import { SHELL_KEYBOARD_ATTR } from '@xrkseek/client-ui-primitives'
import { PHONE_MAX } from './columns.ts'
import { LAYOUT_INSET_ATTR } from './layout-insets.ts'

export { SHELL_KEYBOARD_ATTR }

export const KEYBOARD_INSET_CSS = '--xrk-keyboard-inset' as const
export const KEYBOARD_OPEN_ATTR = 'data-xrk-keyboard' as const

/** Minimum inset (px) before we stamp "keyboard open" for CSS selectors. */
export const KEYBOARD_OPEN_THRESHOLD_PX = 48

/**
 * Reject VV "keyboards" taller than this fraction of `innerHeight`.
 * Post-wake Chromium collapses often report 60–90%; real phone OSK stays under.
 */
export const KEYBOARD_INSET_MAX_FRACTION = 0.45

/**
 * Compute how many CSS pixels of the layout viewport are covered below the
 * visual viewport (typically the soft keyboard).
 */
export function computeKeyboardInsetPx(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): number {
  const covered = innerHeight - visualHeight - visualOffsetTop
  if (!Number.isFinite(covered) || covered <= 0) return 0
  return Math.round(covered)
}

export interface SanitizeKeyboardInsetOptions {
  /**
   * When true (AppFrame stamped `data-xrk-layout-phone`), allow VV lift even
   * if `innerWidth` briefly crosses {@link PHONE_MAX} (landscape hysteresis).
   * Desktop Electron never stamps this — wake-collapse stays zeroed.
   */
  readonly phoneChrome?: boolean
}

/**
 * Apply desktop / sanity gates after the raw VV delta.
 *
 * | Surface | Behaviour |
 * |---|---|
 * | Desktop / wide web (`innerWidth >= PHONE_MAX`, no phone chrome) | 0 — VV wake noise must not lift composer over the bottom workbench |
 * | Phone chrome (`data-xrk-layout-phone`) or narrow web | keep plausible OSK; drop absurd fractions |
 * | Flutter shell (`SHELL_KEYBOARD_ATTR`) | binder no-op (handled upstream) |
 */
export function sanitizeKeyboardInsetPx(
  raw: number,
  innerWidth: number,
  innerHeight: number,
  options: SanitizeKeyboardInsetOptions = {},
): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (!Number.isFinite(innerHeight) || innerHeight <= 0) return 0
  const phoneChrome = options.phoneChrome === true
  if (!phoneChrome && (!Number.isFinite(innerWidth) || innerWidth >= PHONE_MAX)) return 0
  if (raw > innerHeight * KEYBOARD_INSET_MAX_FRACTION) return 0
  return Math.round(raw)
}

function shellOwns(root: HTMLElement): boolean {
  return root.hasAttribute(SHELL_KEYBOARD_ATTR)
}

function applyPublishedInset(
  root: HTMLElement,
  lastPublished: { value: number },
  inset: number,
): number {
  root.style.setProperty(KEYBOARD_INSET_CSS, `${inset}px`)
  if (inset >= KEYBOARD_OPEN_THRESHOLD_PX) {
    root.setAttribute(KEYBOARD_OPEN_ATTR, '')
  } else {
    root.removeAttribute(KEYBOARD_OPEN_ATTR)
  }
  if (inset !== lastPublished.value) {
    lastPublished.value = inset
    window.dispatchEvent(new CustomEvent('xrk-keyboard-inset', { detail: { inset } }))
  }
  return inset
}

function publishKeyboardInset(
  root: HTMLElement,
  lastPublished: { value: number },
): number {
  // Flutter (or any shell) claimed ownership after we may already have
  // published a VV guess — force 0 so sticky composers do not double-lift.
  if (shellOwns(root)) return applyPublishedInset(root, lastPublished, 0)
  const vv = window.visualViewport
  const raw = vv === null || vv === undefined
    ? 0
    : computeKeyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
  const inset = sanitizeKeyboardInsetPx(raw, window.innerWidth, window.innerHeight, {
    phoneChrome: root.hasAttribute(LAYOUT_INSET_ATTR.phone),
  })
  return applyPublishedInset(root, lastPublished, inset)
}

/**
 * Keep `--xrk-keyboard-inset` in sync with visualViewport.
 * One rAF coalesce; no optimistic focus guesses; no multi-timeout sampling.
 */
export function bindVisualViewportKeyboard(
  root: HTMLElement = document.documentElement,
): () => void {
  let raf = 0
  const lastPublished = { value: -1 }
  const schedule = (): void => {
    if (raf !== 0) return
    raf = window.requestAnimationFrame(() => {
      raf = 0
      publishKeyboardInset(root, lastPublished)
    })
  }

  publishKeyboardInset(root, lastPublished)
  const vv = window.visualViewport
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  // Single focus republish — WebViews often update VV one frame after focus.
  document.addEventListener('focusin', schedule)
  document.addEventListener('focusout', schedule)
  // Phone chrome / shell ownership flip without a resize (hysteresis, Flutter
  // attr) must re-sanitize — style-only listeners miss attribute stamps.
  const mo = new MutationObserver(schedule)
  mo.observe(root, {
    attributes: true,
    attributeFilter: [LAYOUT_INSET_ATTR.phone, SHELL_KEYBOARD_ATTR],
  })

  return () => {
    if (raf !== 0) window.cancelAnimationFrame(raf)
    mo.disconnect()
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('focusin', schedule)
    document.removeEventListener('focusout', schedule)
    if (!shellOwns(root)) {
      root.style.removeProperty(KEYBOARD_INSET_CSS)
      root.removeAttribute(KEYBOARD_OPEN_ATTR)
    }
  }
}
