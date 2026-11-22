/**
 * Where a right-click / long-press menu should sit.
 *
 * Policy (multi-end, one place):
 * - Fine pointer (desktop mouse): at the cursor; prefer below, flip above if
 *   the card would not fit — same habit as OS context menus.
 * - Coarse pointer (phone) + live selection: at the *pressed line*, not the
 *   multi-line selection union. Prefer above the line (clear of green
 *   handles); flip below when the top pocket is too small. Horizontally
 *   center on the finger. Off-screen line boxes are ignored when any line
 *   is still visible in the viewport.
 * - Coarse without a selection: same as desktop (finger point, prefer below).
 *
 * Gesture coordinates `(0,0)` (seen on some WebViews) fall back to the line
 * center so the card does not jump to the top-left corner.
 */
import { hasContextMenuSelection } from "./context-menu.ts";
import type { ContextMenuHit } from "./context-menu.ts";

/** Clearance so mobile selection handles stay just outside the card.
 * Keep tight — large pad floated the menu far above the pressed line. */
const HANDLE_CLEARANCE_PX = 10;

/**
 * Rough card height for room checks before the list is measured.
 * Matches Copy+Translate (dense) with a little slack for taller edit menus.
 */
const MENU_ESTIMATE_PX = 96;

/** Matches `.contextMenu { min-width }` — used to center on the finger. */
const MENU_MIN_WIDTH_PX = 148;

/** Viewport edge padding (Menu clamps with the same 12). */
const VIEW_MARGIN_PX = 12;

export interface ContextMenuPlacement {
  readonly rect: DOMRect;
  readonly side: "top" | "bottom";
}

/** Primary pointer is a finger / stylus-first surface. */
export function isCoarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** Non-empty client rects for the live DOM selection (per line box). */
function selectionClientRects(): DOMRect[] {
  const live = window.getSelection();
  if (live === null || live.rangeCount === 0 || live.isCollapsed) return [];
  try {
    return Array.from(live.getRangeAt(0).getClientRects()).filter(
      (box) => box.width > 0 || box.height > 0,
    );
  } catch {
    return [];
  }
}

/** Union bbox of the live selection, if any. */
function selectionUnionRect(): DOMRect | null {
  const live = window.getSelection();
  if (live === null || live.rangeCount === 0 || live.isCollapsed) return null;
  try {
    const box = live.getRangeAt(0).getBoundingClientRect();
    return box.width === 0 && box.height === 0 ? null : box;
  } catch {
    return null;
  }
}

/** Line boxes that intersect the viewport (chat scroll leaves most off-screen). */
function visibleClientRects(rects: readonly DOMRect[]): DOMRect[] {
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  if (vh <= 0) return [...rects];
  return rects.filter((box) => box.bottom > 0 && box.top < vh);
}

/**
 * Line box closest to the gesture point (squared distance to the clamped point).
 * @param rects - per-line selection boxes.
 * @param x - gesture clientX.
 * @param y - gesture clientY.
 */
function nearestRectToPoint(rects: readonly DOMRect[], x: number, y: number): DOMRect | null {
  if (rects.length === 0) return null;
  let best = rects[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const box of rects) {
    const cx = Math.min(Math.max(x, box.left), box.right);
    const cy = Math.min(Math.max(y, box.top), box.bottom);
    const dx = cx - x;
    const dy = cy - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = box;
    }
  }
  return best;
}

/**
 * Pick open side from free space above / below the anchor band.
 * @param prefer - which side wins when both pockets fit the estimate.
 * @param top - viewport Y of the anchor band's top edge.
 * @param bottom - viewport Y of the anchor band's bottom edge.
 */
function pickSide(
  prefer: "top" | "bottom",
  top: number,
  bottom: number,
): "top" | "bottom" {
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const spaceAbove = top - VIEW_MARGIN_PX;
  const spaceBelow = vh > 0 ? vh - bottom - VIEW_MARGIN_PX : Number.POSITIVE_INFINITY;
  const fitsAbove = spaceAbove >= MENU_ESTIMATE_PX;
  const fitsBelow = spaceBelow >= MENU_ESTIMATE_PX;
  if (prefer === "top") {
    if (fitsAbove) return "top";
    if (fitsBelow) return "bottom";
  } else {
    if (fitsBelow) return "bottom";
    if (fitsAbove) return "top";
  }
  return spaceAbove >= spaceBelow ? "top" : "bottom";
}

/**
 * Resolve the line box used as the mobile selection anchor.
 * Prefers a visible line nearest the finger; falls back to union / null.
 */
function resolveSelectionLine(x: number, y: number): DOMRect | null {
  const all = selectionClientRects();
  const visible = visibleClientRects(all);
  return (
    nearestRectToPoint(visible.length > 0 ? visible : all, x, y)
    ?? selectionUnionRect()
  );
}

/**
 * Resolve anchor rect + open side for one context-menu open.
 * @param hit - the right-click / long-press hit.
 */
export function resolveContextMenuPlacement(hit: ContextMenuHit): ContextMenuPlacement {
  const coarse = isCoarsePointer();
  const hasSelection = hasContextMenuSelection(hit) || hit.selectionText !== "";

  // Phone + selected prose: hang beside the pressed (visible) line.
  if (coarse && hasSelection) {
    let x = hit.x;
    let y = hit.y;
    let line = resolveSelectionLine(x, y);

    // Some WebViews fire contextmenu at (0,0); re-anchor to the line center.
    if (x === 0 && y === 0 && line !== null) {
      x = line.left + line.width / 2;
      y = line.top + line.height / 2;
      line = resolveSelectionLine(x, y) ?? line;
    }

    const box = line ?? new DOMRect(x, y, 0, 0);
    const pad = HANDLE_CLEARANCE_PX;
    const top = box.top - pad;
    const height = Math.max(box.height, 0) + pad * 2;
    const rect = new DOMRect(
      x - MENU_MIN_WIDTH_PX / 2,
      top,
      MENU_MIN_WIDTH_PX,
      height,
    );
    return { rect, side: pickSide("top", top, top + height) };
  }

  // Desktop / caret / phone without selection: open from the pointer.
  return {
    rect: new DOMRect(hit.x, hit.y, 0, 0),
    side: pickSide("bottom", hit.y, hit.y),
  };
}
