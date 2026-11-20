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
  /** Canonical workbench geometry vars (Host mirrors inbound aliases). */
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
  /**
   * Advisory coexistence floors (px) for floating workbenches that push `#root`.
   * Shell may yield columns below these; plugins should still leave this much
   * so rail + Overview + chat can coexist. See docs/sidebar-workbench.md.
   */
  layoutFloors: Object.freeze({
    /** Default rail + Overview + soft chat (240 + 360 + 280). */
    desktopCoexist: 880,
    /** Soft chat strip after shell-occupied width. */
    chatStrip: 280,
  } as const),
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

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
}
