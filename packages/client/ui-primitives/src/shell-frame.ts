/**
 * Flutter LocalHostShell pins `#root { bottom: keyboardPx }` and forces
 * `--xrk-keyboard-inset: 0` so the composer does not double-lift. Body-portaled
 * overlays (`position: fixed; inset: 0`) would otherwise still cover the IME.
 *
 * Mirror `#root`'s box onto the overlay so APP and browser share one frame
 * contract. Browser (no shell attr) clears the inline edges and relies on
 * CSS `inset: 0` + `--xrk-keyboard-inset` padding instead.
 *
 * Lives in ui-primitives (zero layout/cordis deps) so Modal, Settings,
 * OnboardingSurface, and ImageLightbox share one implementation.
 */

// Namespace import: Vite inlines this hook into Modal/Onboarding callers and a
// named `useLayoutEffect` binding can evaporate into a bare identifier
// (`ReferenceError: useLayoutEffect is not defined`), taking down slot `root`.
import * as React from 'react'
import type { RefObject } from 'react'

/**
 * Same attribute Flutter stamps on `documentElement` while it owns layout.
 * Canonical string — ui-layout's visualViewport binder re-exports this so
 * APP / browser / Desktop never disagree on the ownership flag.
 */
export const SHELL_KEYBOARD_ATTR = 'data-xrk-shell-keyboard' as const

/** Clear inline edges so stylesheet `inset: 0` wins again. */
export function clearOverlayShellFrame(overlay: HTMLElement): void {
  overlay.style.top = ''
  overlay.style.right = ''
  overlay.style.bottom = ''
  overlay.style.left = ''
}

/**
 * Pin a body-portaled overlay to the visible `#root` band while the Flutter
 * shell owns keyboard layout. No-op (and clears) when the shell attr is absent.
 */
export function syncOverlayToAppRoot(overlay: HTMLElement): void {
  const shell = document.documentElement.hasAttribute(SHELL_KEYBOARD_ATTR)
  const appRoot = document.getElementById('root')
  if (!shell || appRoot === null) {
    clearOverlayShellFrame(overlay)
    return
  }
  const rect = appRoot.getBoundingClientRect()
  overlay.style.top = `${Math.max(0, Math.round(rect.top))}px`
  overlay.style.left = `${Math.max(0, Math.round(rect.left))}px`
  overlay.style.right = `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`
  overlay.style.bottom = `${Math.max(0, Math.round(window.innerHeight - rect.bottom))}px`
}

/**
 * Keep `overlayRef` aligned with the Flutter `#root` pin for as long as
 * `active` is true. Safe to call from every body-portaled fullscreen layer.
 */
export function useShellFrameOverlay(
  overlayRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  React.useLayoutEffect(() => {
    if (!active) return
    const overlay = overlayRef.current
    if (overlay === null) return

    const sync = (): void => { syncOverlayToAppRoot(overlay) }
    sync()

    const appRoot = document.getElementById('root')
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
    if (appRoot !== null) ro?.observe(appRoot)
    window.addEventListener('resize', sync)
    window.addEventListener('xrk-keyboard-inset', sync)
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [SHELL_KEYBOARD_ATTR, 'data-xrk-keyboard', 'style'],
    })
    const shellStyle = document.getElementById('xrk-shell-root')
    if (shellStyle !== null) {
      mo.observe(shellStyle, { characterData: true, childList: true, subtree: true })
    }

    return () => {
      ro?.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('xrk-keyboard-inset', sync)
      clearOverlayShellFrame(overlay)
    }
  }, [overlayRef, active])
}
