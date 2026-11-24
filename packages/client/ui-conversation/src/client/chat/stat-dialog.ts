// One trigger-anchored stat dialog seat shared by the Turn-stat pills
// (TurnUsagePanel) and the composer-dock session stats pills (StatsLine);
// the matching dialog surface skin lives in stat-dialog.module.css.

import { useCallback, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import {
  ANCHORED_MEASURE_STYLE,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
  useEscapeLayer,
} from '@xrkseek/client-ui-primitives'

/** Viewport margin the placement clamp keeps (tighter than composer menus). */
const PANEL_MARGIN = 12

/** Distance between the trigger's top edge and the panel's bottom. */
const PANEL_GAP = 8

/** Same as {@link ANCHORED_MEASURE_STYLE} (stat-dialog callers import this name). */
export const MEASURE_STYLE: CSSProperties = ANCHORED_MEASURE_STYLE

/** Open state, refs, and clamped placement for one stat dialog. */
export interface StatDialogSeat {
  open: boolean
  setOpen: (open: boolean) => void
  rootRef: MutableRefObject<HTMLSpanElement | null>
  panelRef: MutableRefObject<HTMLDivElement | null>
  pos: CSSProperties | null
}

/**
 * One trigger-anchored dialog seat: open state, viewport-clamped placement, outside-close.
 * @param controlled - external open state; when given the seat reads and writes
 * it instead of owning its own, letting sibling dialogs share one exclusive slot.
 * @returns the seat; spread `pos ?? MEASURE_STYLE` onto the portaled panel.
 */
export function useStatDialog(controlled?: Pick<StatDialogSeat, 'open' | 'setOpen'>): StatDialogSeat {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlled?.open ?? ownOpen
  const setOpen = controlled?.setOpen ?? setOwnOpen
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const pos = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  const dismiss = useCallback(() => { setOpen(false) }, [setOpen])
  useEscapeLayer(open, dismiss)

  return { open, setOpen, rootRef, panelRef, pos }
}
