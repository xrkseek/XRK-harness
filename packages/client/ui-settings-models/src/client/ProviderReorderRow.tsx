/**
 * Long-press reorder chrome for one Models provider row (same gesture as
 * Workspace sidebar folders: hold ~420ms, then drag; insert line by row half).
 *
 * Touch / Android WebView cannot rely on HTML5 DnD — after the hold we
 * `setPointerCapture` and hit-test with `elementFromPoint` so the finger can
 * leave the source row without losing move/up events. Desktop mouse keeps
 * HTML5 DnD only (see `useLongPressReorder`).
 */

import { useMemo, type ReactNode, type RefObject } from 'react'
import {
  dropHalfFromClientY,
  hitTestReorderTarget,
  useLongPressReorder,
} from '@xrkseek/client-ui-primitives'
import styles from './ModelsSection.module.css'

export type ProviderDropHalf = 'before' | 'after'

export interface ProviderRowDragProps {
  start: () => void
  hover: (providerId: string, half: ProviderDropHalf) => void
  end: () => void
}

export interface ProviderReorderRowProps {
  /** Stable provider route id (`data-provider-id`). */
  providerId: string
  /** Whether this row is the long-press drag source. */
  dragging: boolean
  /** Insert-line half while another row is dragged over this one. */
  dropHalf: ProviderDropHalf | null
  /** Drag wiring; omit when the row cannot reorder (editor open / read-only). */
  drag?: ProviderRowDragProps | undefined
  children: ReactNode
}

/**
 * Outlined provider card with optional long-press + HTML5 drag reorder.
 */
export function ProviderReorderRow({
  providerId,
  dragging,
  dropHalf,
  drag,
  children,
}: ProviderReorderRowProps): ReactNode {
  const callbacks = useMemo(() => ({
    onStart: () => { drag?.start() },
    onMove: (clientX: number, clientY: number) => {
      if (drag === undefined) return
      const hit = hitTestReorderTarget(clientX, clientY, 'provider-id')
      if (hit === null) return
      drag.hover(hit.id, hit.half)
    },
    onEnd: () => { drag?.end() },
  }), [drag])

  const gesture = useLongPressReorder(drag !== undefined, callbacks)

  const className = [
    styles['rowCard'],
    gesture.armed || dragging ? styles['rowLongPress'] : '',
    dropHalf === 'before' ? styles['dropBefore'] : '',
    dropHalf === 'after' ? styles['dropAfter'] : '',
  ].filter(Boolean).join(' ')

  return (
    <li
      ref={gesture.rowRef as RefObject<HTMLLIElement | null>}
      className={className}
      style={gesture.touchAction === undefined ? undefined : { touchAction: gesture.touchAction }}
      data-provider-id={providerId}
      draggable={gesture.draggable}
      onDragStart={gesture.onHtml5DragStart === undefined
        ? undefined
        : (e) => {
          try {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', providerId)
          } catch {
            // jsdom DataTransferPolyfill: effectAllowed may be read-only.
          }
          gesture.onHtml5DragStart?.()
        }}
      onDragEnd={gesture.onHtml5DragEnd}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          e.preventDefault()
          drag.hover(
            providerId,
            dropHalfFromClientY(e.clientY, e.currentTarget.getBoundingClientRect()),
          )
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          e.preventDefault()
          drag.end()
        }}
      onPointerDown={gesture.onPointerDown}
      onPointerMove={gesture.onPointerMove}
      onPointerUp={gesture.onPointerUp}
      onPointerCancel={gesture.onPointerCancel}
      onLostPointerCapture={gesture.onLostPointerCapture}
      onContextMenu={gesture.onContextMenu}
      onClickCapture={(e) => {
        if (gesture.consumeClickSuppression()) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      {children}
    </li>
  )
}

/**
 * Resolve insert-before anchor from a drop half over a configured id list.
 * @returns beforeId (undefined = append), or null when the drop is a no-op.
 */
export function providerReorderAnchor(
  ids: readonly string[],
  movedId: string,
  overId: string,
  half: ProviderDropHalf,
): string | undefined | null {
  const from = ids.indexOf(movedId)
  const over = ids.indexOf(overId)
  if (from < 0 || over < 0) return null
  const beforeId = half === 'before' ? overId : ids[over + 1]
  // Already immediately before the anchor (or already last when appending).
  if (beforeId === undefined) {
    if (from === ids.length - 1) return null
    return undefined
  }
  if (ids[from + 1] === beforeId) return null
  if (movedId === beforeId) return null
  return beforeId
}
