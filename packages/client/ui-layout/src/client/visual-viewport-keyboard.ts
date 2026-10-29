/**
 * Phone soft-keyboard inset from `visualViewport`.
 *
 * Chrome with `interactive-widget=resizes-content` shrinks `innerHeight`, so
 * the inset stays ~0 and flex/sticky layout already lifts. Overlay keyboards
 * (many Android/iOS builds) leave layout height alone — then
 * `--xrk-keyboard-inset` lifts sticky composers and docks the empty hero.
 */

export const KEYBOARD_INSET_CSS = '--xrk-keyboard-inset' as const
export const KEYBOARD_OPEN_ATTR = 'data-xrk-keyboard' as const

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
  const vv = window.visualViewport
  const inset = vv === null || vv === undefined
    ? 0
    : computeKeyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
  root.style.setProperty(KEYBOARD_INSET_CSS, `${inset}px`)
  if (inset >= KEYBOARD_OPEN_THRESHOLD_PX) root.setAttribute(KEYBOARD_OPEN_ATTR, '')
  else root.removeAttribute(KEYBOARD_OPEN_ATTR)
  return inset
}

/**
 * Subscribe to visualViewport + window resize and keep the keyboard CSS var
 * fresh. Returns an unsubscribe that clears the stamp.
 */
export function bindVisualViewportKeyboard(
  root: HTMLElement = document.documentElement,
): () => void {
  let raf = 0
  const schedule = (): void => {
    if (raf !== 0) return
    raf = window.requestAnimationFrame(() => {
      raf = 0
      publishKeyboardInset(root)
    })
  }

  publishKeyboardInset(root)
  const vv = window.visualViewport
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)

  return () => {
    if (raf !== 0) window.cancelAnimationFrame(raf)
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    root.style.removeProperty(KEYBOARD_INSET_CSS)
    root.removeAttribute(KEYBOARD_OPEN_ATTR)
  }
}
