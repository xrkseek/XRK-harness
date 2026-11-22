/**
 * Where a right-click / long-press menu should sit.
 *
 * Fine pointer (desktop): at the cursor — matches OS context menus.
 * Coarse pointer (phone) with a live selection: above the highlight with
 * handle clearance — matches native selection toolbars and keeps green
 * handles readable.
 */
import { hasContextMenuSelection } from "./context-menu.ts";
import type { ContextMenuHit } from "./context-menu.ts";

/** Clearance so mobile selection handles stay outside the card. */
const HANDLE_CLEARANCE_PX = 32;

/** Rough card height for room-above checks (Copy + Translate, dense). */
const MENU_ESTIMATE_PX = 84;

export interface ContextMenuPlacement {
  readonly rect: DOMRect;
  readonly side: "top" | "bottom";
}

/** Primary pointer is a finger / stylus-first surface. */
export function isCoarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** Bounding box of the live DOM selection, if any. */
function selectionRect(): DOMRect | null {
  const live = window.getSelection();
  if (live === null || live.rangeCount === 0 || live.isCollapsed) return null;
  try {
    const box = live.getRangeAt(0).getBoundingClientRect();
    return box.width === 0 && box.height === 0 ? null : box;
  } catch {
    return null;
  }
}

/**
 * Resolve anchor rect + open side for one context-menu open.
 * @param hit - the right-click / long-press hit.
 */
export function resolveContextMenuPlacement(hit: ContextMenuHit): ContextMenuPlacement {
  const coarse = isCoarsePointer();
  const hasSelection = hasContextMenuSelection(hit) || hit.selectionText !== "";

  // Phone + selected prose: float above the highlight (native habit).
  if (coarse && hasSelection) {
    const box = selectionRect() ?? new DOMRect(hit.x, hit.y, 0, 0);
    const pad = HANDLE_CLEARANCE_PX;
    const rect = new DOMRect(
      box.left,
      box.top - pad,
      Math.max(box.width, 1),
      box.height + pad * 2,
    );
    const side = rect.top >= MENU_ESTIMATE_PX + 12 ? "top" : "bottom";
    return { rect, side };
  }

  // Desktop / caret / no selection: open below the pointer.
  return {
    rect: new DOMRect(hit.x, hit.y, 0, 0),
    side: "bottom",
  };
}
