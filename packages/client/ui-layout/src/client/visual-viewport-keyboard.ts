/**
 * Phone soft-keyboard inset from `visualViewport`.
 *
 * Chrome with `interactive-widget=resizes-content` shrinks `innerHeight`, so
 * the inset stays ~0 and flex/sticky layout already lifts. Overlay keyboards
 * (many Android/iOS builds) leave layout height alone — then
 * `--xrk-keyboard-inset` lifts sticky composers and docks the empty hero.
 *
 * Flutter thin shell owns a fourth path (MediaQuery.viewInsets → CSS). Do NOT
 * combine Activity `adjustResize` / Scaffold resize / `resizes-content` with
 * that CSS inset — each shrinks or lifts the same band and the composer jumps
 * mid-screen. Shell stamps {@link SHELL_KEYBOARD_ATTR}; this binder no-ops.
 */

export const KEYBOARD_INSET_CSS = '--xrk-keyboard-inset' as const
export const KEYBOARD_OPEN_ATTR = 'data-xrk-keyboard' as const
/**
 * Set by the Flutter thin shell when it owns `--xrk-keyboard-inset` via
 * MediaQuery.viewInsets. visualViewport must not overwrite that stamp — the
 * two sources fighting is what makes the composer jump mid-screen.
 */
export const SHELL_KEYBOARD_ATTR = 'data-xrk-shell-keyboard' as const

/** Minimum inset (px) before we stamp "keyboard open" for CSS selectors. */
export const KEYBOARD_OPEN_THRESHOLD_PX = 48

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

function publishKeyboardInset(root: HTMLElement = document.documentElement): number {
  // Flutter LocalHostShell already publishes inset + open attrs.
  if (root.hasAttribute(SHELL_KEYBOARD_ATTR)) return 0
  const vv = window.visualViewport
  const inset = vv === null || vv === undefined
    ? 0
    : computeKeyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
  const px = `${inset}px`
  root.style.setProperty(KEYBOARD_INSET_CSS, px)
  if (inset >= KEYBOARD_OPEN_THRESHOLD_PX) {
    root.setAttribute(KEYBOARD_OPEN_ATTR, '')
  } else {
    root.removeAttribute(KEYBOARD_OPEN_ATTR)
  }
  return inset
}

/**
 * Subscribe to visualViewport + window resize and keep the keyboard CSS var
 * fresh. Returns an unsubscribe that clears the stamp.
 *
 * Also re-publishes on focusin/out with short delays: Via / Edge packaged
 * WebViews often update visualViewport only after the soft-keyboard animation
 * starts, not on the first resize tick.
 */
export function bindVisualViewportKeyboard(
  root: HTMLElement = document.documentElement,
): () => void {
  let raf = 0
  let timerA = 0
  let timerB = 0
  const schedule = (): void => {
    if (raf !== 0) return
    raf = window.requestAnimationFrame(() => {
      raf = 0
      publishKeyboardInset(root)
    })
  }
  const scheduleAfterKeyboardAnim = (): void => {
    schedule()
    window.clearTimeout(timerA)
    window.clearTimeout(timerB)
    timerA = window.setTimeout(schedule, 120)
    timerB = window.setTimeout(schedule, 320)
  }

  publishKeyboardInset(root)
  const vv = window.visualViewport
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('focusin', scheduleAfterKeyboardAnim)
  document.addEventListener('focusout', scheduleAfterKeyboardAnim)

  return () => {
    if (raf !== 0) window.cancelAnimationFrame(raf)
    window.clearTimeout(timerA)
    window.clearTimeout(timerB)
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('focusin', scheduleAfterKeyboardAnim)
    document.removeEventListener('focusout', scheduleAfterKeyboardAnim)
    root.style.removeProperty(KEYBOARD_INSET_CSS)
    root.removeAttribute(KEYBOARD_OPEN_ATTR)
  }
}
