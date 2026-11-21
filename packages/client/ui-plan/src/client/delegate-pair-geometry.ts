/**
 * Overview 委派 pair geometry — pure numbers for CSS contracts + unit tests.
 *
 * Contract (PC details strip + phone full-bleed):
 * 1. Lead 委派方 + 被委派方 always share one stage size (isometric pair).
 * 2. With one left ball, the two seat tracks split the row equally — no
 *    pre-reserved left gutter and no 1.35fr bias that only crushed the right.
 * 3. Extra left parents fan behind the lead; they consume left-track room via
 *    overlap (negative margin). Stage shrinks a step; tracks stay 1fr|1fr so
 *    the arrow sits closer to the visual mass on the right of the left cell.
 * 4. Arrow↔card gaps stay equal because both seats hug the arrow column.
 */

/** Desktop stage caps by left-stack count (1 = solo lead). */
export const DELEGATE_STAGE_CAP_PX = Object.freeze({
  1: 118,
  2: 100,
  3: 88,
  4: 88,
} as const)

/** Phone / narrow caps (match PreviewTabs.module.css media + layout-phone). */
export const DELEGATE_STAGE_CAP_PHONE_PX = Object.freeze({
  1: 104,
  2: 92,
  3: 80,
  4: 80,
} as const)

/** Fraction of stage reserved as left pad so peek rims stay inside the cell. */
export const DELEGATE_PEEK_PAD_RATIO = 0.42

/** Phone peek-pad ratio (slightly tighter — matches CSS 0.38). */
export const DELEGATE_PEEK_PAD_RATIO_PHONE = 0.38

/** Default middle column (arrow + caption) width. */
export const DELEGATE_ARROW_COL_PX = 52

/** Default horizontal grid gap on each side of the arrow. */
export const DELEGATE_GAP_PX = 14

/** Phone horizontal grid gap. */
export const DELEGATE_GAP_PHONE_PX = 10

export interface DelegatePairGeometryInput {
  /** Inner width of `.delegatePair` (px). */
  readonly containerWidth: number
  /** Face parents painted on the left (1..4). */
  readonly stackCount: number
  readonly arrowColPx?: number
  readonly gapPx?: number
  /** Use phone caps / peek ratio / default gap. */
  readonly phone?: boolean
}

export interface DelegatePairGeometry {
  /** Shared stage width for lead + 被委派方 (px). */
  readonly stagePx: number
  /** Equal seat-track width after arrow + gaps (px). */
  readonly seatTrackPx: number
  /** Left pad only when peeks exist; 0 for a solo lead. */
  readonly leftPadPx: number
  /** Always equal fr tracks — peeks never invent a wider left column. */
  readonly gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)'
}

function clampStackCount(n: number): 1 | 2 | 3 | 4 {
  if (!Number.isFinite(n) || n <= 1) return 1
  if (n === 2) return 2
  if (n === 3) return 3
  return 4
}

/**
 * Resolve isometric pair geometry for a given Overview rail width.
 * @param input - container width + left stack count.
 */
export function resolveDelegatePairGeometry(
  input: DelegatePairGeometryInput,
): DelegatePairGeometry {
  const stack = clampStackCount(input.stackCount)
  const phone = Boolean(input.phone)
  const arrow = Math.max(0, input.arrowColPx ?? DELEGATE_ARROW_COL_PX)
  const gap = Math.max(
    0,
    input.gapPx ?? (phone ? DELEGATE_GAP_PHONE_PX : DELEGATE_GAP_PX),
  )
  const usable = Math.max(0, input.containerWidth - arrow - 2 * gap)
  const seatTrackPx = usable / 2
  const caps = phone ? DELEGATE_STAGE_CAP_PHONE_PX : DELEGATE_STAGE_CAP_PX
  const padRatio = phone ? DELEGATE_PEEK_PAD_RATIO_PHONE : DELEGATE_PEEK_PAD_RATIO
  const cap = caps[stack]
  // Solo: stage fills the equal track up to the cap.
  // Stacked: leave peek-pad room inside the same equal track (compress, do
  // not widen the left column).
  const fit = stack === 1
    ? seatTrackPx
    : seatTrackPx / (1 + padRatio)
  const stagePx = Math.max(0, Math.min(cap, fit))
  const leftPadPx = stack === 1 ? 0 : stagePx * padRatio
  return {
    stagePx,
    seatTrackPx,
    leftPadPx,
    gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  }
}
