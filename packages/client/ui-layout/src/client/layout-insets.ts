/**
 * Shell layout insets — the durable public contract floating workbench
 * plugins (right/bottom overlays, not just xrkh-better-sidebar) read so they
 * can sit beside the in-flow AppFrame columns instead of covering them.
 *
 * AppFrame is the sole publisher ({@link publishLayoutInsets}). Plugins:
 * - CSS: position against {@link LAYOUT_INSET_CSS} on `document.documentElement`
 * - JS: subscribe to `ctx.layout.insets`
 *
 * New reserved regions add optional fields here and matching CSS custom
 * properties — do not invent per-plugin body stamps.
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
  /** Left `sidebar` rail (compact or open width as rendered). */
  readonly sidebar: number
  /** True on the phone shell — floating workbenches should not assume desktop push. */
  readonly phone: boolean
}

/** Empty / pre-mount insets. */
export const EMPTY_LAYOUT_INSETS: LayoutInsets = Object.freeze({
  details: 0,
  sidebar: 0,
  phone: false,
})

/**
 * CSS custom-property names written on `document.documentElement`.
 * Values are always `${n}px` (including `0px`).
 */
export const LAYOUT_INSET_CSS = Object.freeze({
  details: '--xrk-layout-inset-details',
  sidebar: '--xrk-layout-inset-sidebar',
} as const)

/**
 * `document.documentElement` attributes stamped when the named inset is > 0.
 * Prefer the CSS variables for geometry; attributes are for selectors.
 */
export const LAYOUT_INSET_ATTR = Object.freeze({
  details: 'data-xrk-layout-details',
  phone: 'data-xrk-layout-phone',
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
  if (insets.details > 0) root.setAttribute(LAYOUT_INSET_ATTR.details, '')
  else root.removeAttribute(LAYOUT_INSET_ATTR.details)
  if (insets.phone) root.setAttribute(LAYOUT_INSET_ATTR.phone, '')
  else root.removeAttribute(LAYOUT_INSET_ATTR.phone)
}

/** Clear inset CSS / attributes (unmount / dispose). */
export function clearLayoutInsetsDom(): void {
  const root = document.documentElement
  root.style.removeProperty(LAYOUT_INSET_CSS.details)
  root.style.removeProperty(LAYOUT_INSET_CSS.sidebar)
  root.removeAttribute(LAYOUT_INSET_ATTR.details)
  root.removeAttribute(LAYOUT_INSET_ATTR.phone)
}

/** True when two inset snapshots are equal for publish short-circuit. */
export function layoutInsetsEqual(a: LayoutInsets, b: LayoutInsets): boolean {
  return a.details === b.details && a.sidebar === b.sidebar && a.phone === b.phone
}
