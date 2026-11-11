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
 */

export const KEYBOARD_INSET_CSS = '--xrk-keyboard-inset' as const
export const KEYBOARD_OPEN_ATTR = 'data-xrk-keyboard' as const
/**
 * Set by the Flutter shell while it owns layout via `#root` bottom.
 * While present, visualViewport must not overwrite.
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

function shellOwns(root: HTMLElement): boolean {
  return root.hasAttribute(SHELL_KEYBOARD_ATTR)
}

function publishKeyboardInset(
  root: HTMLElement,
  lastPublished: { value: number },
): number {
  if (shellOwns(root)) return lastPublished.value
  const vv = window.visualViewport
  const inset = vv === null || vv === undefined
    ? 0
    : computeKeyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
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

  return () => {
    if (raf !== 0) window.cancelAnimationFrame(raf)
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
