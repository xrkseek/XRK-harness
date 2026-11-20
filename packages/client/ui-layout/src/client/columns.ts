/**
 * Pure concession-chain column solver for the three-column AppFrame.
 * Chain order (protect center as long as possible):
 * 1. Prefer preferred sidebar + details widths.
 * 2. Shrink details toward DETAILS_MIN while center >= CENTER_MIN.
 * 3. Keep the open sidebar at its preferred width, or snap to the
 *    SIDEBAR_COLLAPSED icon rail (no labeled shrink) while center >= CENTER_MIN.
 * 4. Keep Overview (>= DETAILS_MIN) + rail while center >= CHAT_FLOOR.
 * 5. Force details track to 0 (visual Overview close; preferences untouched).
 * 6. Final fallback: center takes the remainder.
 * Preferences are never rewritten, so re-widening restores preferred widths.
 * Inputs are the layout store's plain width preferences (0 = closed); a
 * closed sidebar resolves to SIDEBAR_COLLAPSED while closed details resolve
 * to zero. SIDEBAR_AUTO_COLLAPSE is consumed by AppFrame before solving.
 *
 * Desktop coexistence target (left rail + Overview + chat) is
 * {@link DESKTOP_COEXIST_FLOOR}. Workbench plugins that push `#root` should
 * leave at least that much window width so fullscreen「概况 + 侧栏」stays usable.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 220
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag — kept slim so Overview can coexist. */
export const SIDEBAR_DEFAULT = 240
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Window width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). Enter threshold — see {@link SIDEBAR_AUTO_EXPAND}. */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Hysteresis exit for narrow chrome: stay narrow until the window is this
 * wide again so resize jitter around 1024 cannot snap a manual re-expand shut. */
export const SIDEBAR_AUTO_EXPAND = 1088
/** Window width below which AppFrame switches to phone chrome: full-bleed
 * center, zero in-flow rail, sidebar/details as overlays (drawer / sheet).
 * Measured from the window (not the workbench-squeezed frame). Stays below
 * SIDEBAR_AUTO_COLLAPSE so phone inherits narrow toggle semantics. */
export const PHONE_MAX = 768
/** Hysteresis exit for phone chrome — same jitter guard as narrow. */
export const PHONE_EXPAND = 816
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/**
 * Soft center floor used before Overview is forced closed. Below
 * {@link CENTER_MIN} but still a usable chat strip; matches the chat term in
 * {@link DESKTOP_COEXIST_FLOOR}.
 */
export const CHAT_FLOOR = 280
/**
 * Minimum Host `#root` width that still fits default left rail + Overview + a
 * usable chat strip (not full {@link CENTER_MIN} — workbench would starve).
 * Floating workbench plugins that push `#root` should leave at least this much.
 * Author-facing mirror: `XRK_PLUG.layoutFloors.desktopCoexist` (must stay equal).
 */
export const DESKTOP_COEXIST_FLOOR = SIDEBAR_DEFAULT + DETAILS_DEFAULT + CHAT_FLOOR

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Fit an open sidebar into the room the concession chain still grants.
 * Labeled chrome does **not** compress: either the full preferred width, or
 * the icon rail. Never an in-between that clips「新会话」to「新」.
 * @param preferred - open preference already clamped into SIDEBAR_MIN..MAX.
 * @param room - pixels left after protecting center (and details when open).
 * @returns preferred width when it fits, else {@link SIDEBAR_COLLAPSED}.
 */
export function fitLabeledOrRail(preferred: number, room: number): number {
  const want = Math.round(preferred)
  if (Math.max(0, Math.round(room)) >= want) return want
  return SIDEBAR_COLLAPSED
}

/**
 * Latch a width breakpoint with enter/exit hysteresis.
 * @param wasActive - previous latched state.
 * @param width - live window/chrome width.
 * @param enterBelow - become active when width &lt; this (while inactive).
 * @param exitBelow - stay active while width &lt; this (while already active).
 */
export function latchWidthBreakpoint(
  wasActive: boolean,
  width: number,
  enterBelow: number,
  exitBelow: number,
): boolean {
  return wasActive ? width < exitBelow : width < enterBelow
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  const preferOpen = sidebar !== 0
  const s0 = preferOpen ? clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX) : SIDEBAR_COLLAPSED
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  const vp = Math.max(0, Math.round(viewport))

  // Step 1: everything fits at preferred widths.
  if (s0 + d0 + CENTER_MIN <= vp) {
    return { sidebar: s0, center: vp - s0 - d0, details: d0 }
  }

  // Closed details: shrink open sidebar toward the rail, then yield center.
  if (d0 === 0) {
    if (!preferOpen) {
      return { sidebar: SIDEBAR_COLLAPSED, center: Math.max(0, vp - SIDEBAR_COLLAPSED), details: 0 }
    }
    const room = vp - CENTER_MIN
    if (room >= SIDEBAR_COLLAPSED) {
      return { sidebar: fitLabeledOrRail(s0, room), center: CENTER_MIN, details: 0 }
    }
    return { sidebar: SIDEBAR_COLLAPSED, center: Math.max(0, vp - SIDEBAR_COLLAPSED), details: 0 }
  }

  // Step 2: shrink details toward DETAILS_MIN while protecting CENTER_MIN.
  const d1 = Math.max(DETAILS_MIN, vp - s0 - CENTER_MIN)
  if (s0 + d1 + CENTER_MIN <= vp) {
    return { sidebar: s0, center: CENTER_MIN, details: d1 }
  }

  // Step 3: shrink sidebar toward the rail while details stay at least DETAILS_MIN.
  // Below SIDEBAR_MIN the track snaps to the icon rail (no truncated labels).
  if (preferOpen) {
    const room = vp - DETAILS_MIN - CENTER_MIN
    if (room >= SIDEBAR_COLLAPSED) {
      return {
        sidebar: fitLabeledOrRail(s0, room),
        center: CENTER_MIN,
        details: DETAILS_MIN,
      }
    }
  } else if (SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN <= vp) {
    return { sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: DETAILS_MIN }
  }

  // Step 4: keep Overview open down to CHAT_FLOOR before forcing it closed.
  const sRail = SIDEBAR_COLLAPSED
  if (s0 + d0 + CHAT_FLOOR <= vp) {
    return { sidebar: s0, center: vp - s0 - d0, details: d0 }
  }
  const dChat = Math.max(DETAILS_MIN, vp - s0 - CHAT_FLOOR)
  if (s0 + dChat + CHAT_FLOOR <= vp) {
    return { sidebar: s0, center: CHAT_FLOOR, details: dChat }
  }
  if (sRail + DETAILS_MIN + CHAT_FLOOR <= vp) {
    const dKeep = Math.min(d0, Math.max(DETAILS_MIN, vp - sRail - CHAT_FLOOR))
    return { sidebar: sRail, center: Math.max(CHAT_FLOOR, vp - sRail - dKeep), details: dKeep }
  }

  // Step 5: force Overview track to 0 (visual close); keep rail; protect CENTER_MIN if possible.
  if (sRail + CENTER_MIN <= vp) {
    return { sidebar: sRail, center: CENTER_MIN, details: 0 }
  }

  // Step 6: final fallback — center takes the remainder.
  return {
    sidebar: sRail,
    center: Math.max(0, vp - sRail),
    details: 0,
  }
}

/**
 * Map a concession solve onto the CSS grid tracks AppFrame actually paints.
 * Phone chrome is decided by the caller (window width + hysteresis), not by
 * the workbench-squeezed frame box.
 * @param frameWidth - available AppFrame box width in px (may be workbench-squeezed).
 * @param solved - output of {@link computeColumns} for that frame width.
 * @param phone - whether phone chrome applies.
 * @returns grid tracks plus whether phone chrome applies.
 */
export function resolveShellTracks(
  frameWidth: number,
  solved: Columns,
  phone: boolean,
): { tracks: Columns; phone: boolean } {
  if (phone) return { tracks: { sidebar: 0, center: frameWidth, details: 0 }, phone: true }
  return { tracks: solved, phone: false }
}

/**
 * Drawer width for phone sidebar overlay: contract default, clamped into the
 * sidebar range and leaving a finger-width of scrim when the viewport is tight.
 * @param viewport - available frame width in px.
 * @returns drawer width in px.
 */
export function phoneDrawerWidth(viewport: number): number {
  return Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_DEFAULT, Math.max(0, viewport - 48))),
  )
}
