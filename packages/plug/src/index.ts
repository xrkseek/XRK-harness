/**
 * XRK Plug — author-facing facade over the in-tree plugin runtime.
 *
 * Authors and first-party docs should say **XRK Plug** / `@xrkseek/plug`.
 * The implementation currently re-exports `@xrkseek/cordis`; a later slice
 * may rename the physical package without changing this author contract.
 */

export * from '@xrkseek/cordis'

/** Stable product identity for authors and diagnostics. */
export const XRK_PLUG = Object.freeze({
  name: 'XRK Plug',
  package: '@xrkseek/plug',
  /** Process plugin kinds the Host discover path accepts. */
  processKinds: Object.freeze([
    'tools',
    'prompt',
    'commands',
    'hooks',
    'host',
    'channel',
    'policy',
    'llm',
  ] as const),
  /** Client half marker in package.json (`xrk.client` / `xrk.client` nest). */
  clientMarker: 'xrk.client',
  /** Product UI locales first-party plugins must ship. */
  locales: Object.freeze(['zh', 'en', 'ja'] as const),
  /** Canonical frame attr plugins should select (Host may dual-stamp inbound). */
  frameAttr: 'data-xrk-frame',
  /**
   * Compat workbench CSS vars. Prefer `ctx.layout.reserveSide` /
   * `ctx.layout.reserveBottom` — Host stamps these and yields the frame.
   */
  workbenchCssVars: Object.freeze({
    width: '--xrkh-workbench-width',
    height: '--xrkh-workbench-height',
  } as const),
  /**
   * Public shell LayoutInsets CSS vars (read-only for workbench plugins).
   * Prefer `ctx.layout.insets`; CSS is the zero-dep fallback.
   */
  layoutInsetCssVars: Object.freeze({
    sidebar: '--xrk-layout-inset-sidebar',
    details: '--xrk-layout-inset-details',
    bottom: '--xrk-layout-inset-bottom',
  } as const),
  /** Soft-keyboard CSS var (wide / desktop Host keeps `0`). */
  keyboardInsetCss: '--xrk-keyboard-inset',
  /**
   * DocumentElement attributes the shell stamps for selectors.
   * Keep names equal to `@xrkseek/client-ui-layout` `LAYOUT_INSET_ATTR`.
   */
  layoutAttrs: Object.freeze({
    phone: 'data-xrk-layout-phone',
    detailsOpen: 'data-xrk-layout-details-open',
    details: 'data-xrk-layout-details',
    status: 'data-xrk-layout-status',
    /** `ctx.layout.reserveSide(px)` with px &gt; 0 — Host header / PresenceDock select this. */
    side: 'data-xrk-layout-side',
    /** `ctx.layout.reserveBottom(px)` with px &gt; 0. */
    bottom: 'data-xrk-layout-bottom',
  } as const),
  /**
   * Advisory coexistence floors (px) for floating workbenches that push the shell.
   * Shell may yield columns below these; plugins should still leave this much
   * so rail + Overview + chat can coexist. See docs/sidebar-workbench.md.
   */
  layoutFloors: Object.freeze({
    /** Default rail + Overview + soft chat (240 + 360 + 280). */
    desktopCoexist: 880,
    /** Soft chat strip after shell-occupied width. */
    chatStrip: 280,
    /**
     * Labeled side-panel floor (px). Below this room, fit snaps to 0
     * (same policy as first-party workbench `WORKBENCH_PANEL_MIN`).
     */
    workbenchPanelMin: 280,
  } as const),
  /**
   * Phone chrome enter width (px) — keep equal to Host `PHONE_MAX` (ui-layout).
   * Wide / desktop keyboard inset is gated at this floor.
   */
  phoneMaxPx: 768,
  /** Common author slots (not exhaustive — see plugin-surface-map). */
  slots: Object.freeze([
    'shell.overlay',
    'conversation.session.header.utilities',
    'conversation.input.right',
    'settings.plugin.item',
  ] as const),
} as const)

export type XrkPlugProcessKind = (typeof XRK_PLUG.processKinds)[number]
export type XrkPlugLocale = (typeof XRK_PLUG.locales)[number]
export type XrkPlugSlot = (typeof XRK_PLUG.slots)[number]

export interface XrkPlugPushFloorInput {
  /** Shell-occupied width (rail + Overview). Prefer `ctx.layout.insets`. */
  shellOccupied?: number
  /** Override {@link XRK_PLUG.layoutFloors.desktopCoexist}. */
  baseFloor?: number
  /** Override {@link XRK_PLUG.layoutFloors.chatStrip}. */
  chatStrip?: number
}

/**
 * Effective floor a floating workbench must leave when pushing `#root`.
 * `max(baseFloor, shellOccupied + chatStrip)`. Shell-agnostic — any shell
 * that publishes LayoutInsets can feed `shellOccupied`.
 */
export function xrkPlugPushFloor(input: XrkPlugPushFloorInput = {}): number {
  const base = finiteNonNegative(input.baseFloor ?? XRK_PLUG.layoutFloors.desktopCoexist)
  const strip = finiteNonNegative(input.chatStrip ?? XRK_PLUG.layoutFloors.chatStrip)
  const occupied = finiteNonNegative(input.shellOccupied ?? 0)
  return Math.max(base, occupied + strip)
}

/** Sum rail + Overview from a LayoutInsets-shaped object. */
export function xrkPlugShellOccupied(
  insets: { readonly sidebar?: number; readonly details?: number },
): number {
  return finiteNonNegative(insets.sidebar) + finiteNonNegative(insets.details)
}

/**
 * Pixels left for a floating side workbench after the conversation floor.
 * 0 when the viewport cannot host the floor.
 */
export function xrkPlugWorkbenchRoom(
  viewportWidth: number,
  shellOccupied: number = 0,
): number {
  const vp = finiteNonNegative(viewportWidth)
  const floor = xrkPlugPushFloor({ shellOccupied })
  return Math.max(0, vp - Math.min(floor, vp))
}

/**
 * Fit an open side panel into the room. Labeled chrome does not compress
 * below {@link XRK_PLUG.layoutFloors.workbenchPanelMin}: preferred (capped) or 0.
 */
export function xrkPlugFitWorkbenchWidth(
  preferred: number,
  room: number,
  panelOpen: boolean,
  minWidth: number = XRK_PLUG.layoutFloors.workbenchPanelMin,
): number {
  if (!panelOpen) return 0
  const want = finiteNonNegative(preferred)
  const avail = finiteNonNegative(room)
  const min = finiteNonNegative(minWidth)
  if (avail < min) return 0
  return Math.min(want, avail)
}

/**
 * Cap a bottom strip so at least {@link XRK_PLUG.layoutFloors.workbenchPanelMin}
 * remains for conversation (same policy as the first-party workbench).
 */
export function xrkPlugFitWorkbenchHeight(
  preferred: number,
  viewportHeight: number,
  bottomOpen: boolean,
  leaveMin: number = XRK_PLUG.layoutFloors.workbenchPanelMin,
): number {
  if (!bottomOpen) return 0
  const vp = finiteNonNegative(viewportHeight)
  const leave = Math.min(finiteNonNegative(leaveMin), vp)
  const maxHeight = Math.max(0, vp - leave)
  return Math.min(finiteNonNegative(preferred), maxHeight)
}

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
}
