/**
 * Shell layout insets — the durable public contract floating workbench
 * plugins (right/bottom overlays, not just xrkh-better-sidebar) read so they
 * can sit beside the in-flow AppFrame columns instead of covering them.
 *
 * ## Author contract (multi-end)
 *
 * 1. **Bottom strip (canonical):** `ctx.layout.reserveBottom(px)` (0 = closed).
 *    Updates `--xrk-layout-inset-bottom`, stamps `--xrkh-workbench-height`,
 *    survives AppFrame column republish.
 * 2. **Side strip (canonical):** `ctx.layout.reserveSide(px)` (0 = closed).
 *    Stamps `--xrkh-workbench-width`; the shell frame yields via `margin-right`
 *    (product Host — not a missing community `layout.css`).
 * 3. **Position a bottom strip:** prefer public CSS —
 *    `left: var(--xrk-layout-inset-sidebar)`;
 *    `right: calc(var(--xrk-layout-inset-details) + var(--xrkh-workbench-width, 0px))`.
 *    `--xrkh-center-*` is optional first-party measure; third parties must not
 *    require it.
 * 4. **Phone (`insets.phone` / `data-xrk-layout-phone`):** shell forces
 *    `bottom = 0` and zeros workbench width/height CSS. Collapse drawers / hide
 *    expand FABs when `detailsOpen` on phone.
 * 5. **Keyboard:** Host publishes `--xrk-keyboard-inset` for sticky composers.
 *    Wide / desktop windows keep it at 0. Phone chrome / narrow web may lift.
 *    Flutter shells that set `SHELL_KEYBOARD_ATTR` force the binder to 0.
 *
 * AppFrame publishes column insets ({@link LayoutController.publishInsets}).
 * Plugins position against {@link LAYOUT_INSET_CSS} and subscribe to
 * `ctx.layout.insets`.
 *
 * @module
 */
import type { ObservableSnapshot } from '@xrkseek/client-runtime/client'

/** Live inset widths in CSS pixels (0 = that chrome is closed / absent). */
export interface LayoutInsets {
  /**
   * Right `details` column (session overview). 0 when closed or phone overlay
   * mode (phone sheets do not reserve a desktop strip).
   */
  readonly details: number
  /**
   * True while Overview / Status is open — including phone full-screen sheet
   * where {@link details} stays 0 (no desktop strip). Floating workbenches
   * hide their expand FAB so it does not collide with the sheet close control.
   */
  readonly detailsOpen: boolean
  /** Left `sidebar` rail (compact or open width as rendered). */
  readonly sidebar: number
  /**
   * Bottom floating workbench strip. 0 when closed or on phone chrome.
   * Plugins call {@link LayoutController.reserveBottom}; do not rely on
   * AppFrame inventing a height from private CSS alone.
   */
  readonly bottom: number
  /** True on the phone shell — floating workbenches should not assume desktop push. */
  readonly phone: boolean
}

/** Empty / pre-mount insets. */
export const EMPTY_LAYOUT_INSETS: LayoutInsets = Object.freeze({
  details: 0,
  detailsOpen: false,
  sidebar: 0,
  bottom: 0,
  phone: false,
})

/**
 * CSS custom-property names written on `document.documentElement`.
 * Values are always `${n}px` (including `0px`).
 */
export const LAYOUT_INSET_CSS = Object.freeze({
  details: '--xrk-layout-inset-details',
  sidebar: '--xrk-layout-inset-sidebar',
  bottom: '--xrk-layout-inset-bottom',
} as const)

/**
 * `document.documentElement` attributes stamped when the named inset is > 0.
 * Prefer the CSS variables for geometry; attributes are for selectors.
 */
export const LAYOUT_INSET_ATTR = Object.freeze({
  details: 'data-xrk-layout-details',
  /** Overview / Status sheet open (desktop strip or phone overlay). */
  detailsOpen: 'data-xrk-layout-details-open',
  phone: 'data-xrk-layout-phone',
  /** Settled Session can open Overview / Status (AppFrame stamps; blank clears). */
  status: 'data-xrk-layout-status',
} as const)

/** Observable face plugins read via `ctx.layout.insets`. */
export type LayoutInsetsFace = ObservableSnapshot<LayoutInsets>

/**
 * Write insets to the document root and return a disposer that clears them.
 * Idempotent for equal values (callers may publish every frame of a drag).
 */
export function applyLayoutInsetsDom(insets: LayoutInsets): void {
  const root = document.documentElement
  root.style.setProperty(LAYOUT_INSET_CSS.details, `${Math.max(0, insets.details)}px`)
  root.style.setProperty(LAYOUT_INSET_CSS.sidebar, `${Math.max(0, insets.sidebar)}px`)
  root.style.setProperty(LAYOUT_INSET_CSS.bottom, `${Math.max(0, insets.bottom)}px`)
  if (insets.details > 0) root.setAttribute(LAYOUT_INSET_ATTR.details, '')
  else root.removeAttribute(LAYOUT_INSET_ATTR.details)
  if (insets.detailsOpen) root.setAttribute(LAYOUT_INSET_ATTR.detailsOpen, '')
  else root.removeAttribute(LAYOUT_INSET_ATTR.detailsOpen)
  if (insets.phone) root.setAttribute(LAYOUT_INSET_ATTR.phone, '')
  else root.removeAttribute(LAYOUT_INSET_ATTR.phone)
}

/** Clear inset CSS / attributes (unmount / dispose). */
export function clearLayoutInsetsDom(): void {
  const root = document.documentElement
  root.style.removeProperty(LAYOUT_INSET_CSS.details)
  root.style.removeProperty(LAYOUT_INSET_CSS.sidebar)
  root.style.removeProperty(LAYOUT_INSET_CSS.bottom)
  root.removeAttribute(LAYOUT_INSET_ATTR.details)
  root.removeAttribute(LAYOUT_INSET_ATTR.detailsOpen)
  root.removeAttribute(LAYOUT_INSET_ATTR.phone)
  root.removeAttribute(LAYOUT_INSET_ATTR.status)
}

/** True when two inset snapshots are equal for publish short-circuit. */
export function layoutInsetsEqual(a: LayoutInsets, b: LayoutInsets): boolean {
  return a.details === b.details
    && a.detailsOpen === b.detailsOpen
    && a.sidebar === b.sidebar
    && a.bottom === b.bottom
    && a.phone === b.phone
}

/**
 * Horizontal width already claimed by the in-flow shell (left rail + Overview).
 * Floating workbenches use this for push floors — do not invent a third sum.
 */
export function shellOccupiedWidth(
  insets: Pick<LayoutInsets, 'sidebar' | 'details'>,
): number {
  const sidebar = Number.isFinite(insets.sidebar) ? Math.max(0, insets.sidebar) : 0
  const details = Number.isFinite(insets.details) ? Math.max(0, insets.details) : 0
  return sidebar + details
}

/**
 * AppFrame column republish: map inline `--xrkh-workbench-height` to bottom.
 *
 * - Property **absent** → preserve the last {@link LayoutController.reserveBottom}
 *   value (omit `bottom` on publish). Third parties that only call the JS API
 *   must not be wiped when Overview width ticks.
 * - Property **present** (including `0px`) → that value is live truth so CSS-only
 *   writers and `reserveBottom` stamps stay coherent.
 */
export function resolveWorkbenchBottomForPublish(
  workbenchHeightCss: string,
): { readonly bottom: number } | { readonly preserve: true } {
  const raw = workbenchHeightCss.trim()
  if (raw === '') return { preserve: true }
  const n = Number.parseFloat(raw)
  return { bottom: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 }
}
