/**
 * Long-press reorder chrome for one Models provider row (same gesture as
 * Workspace sidebar folders: hold ~420ms, then drag; insert line by row half).
 */

import { useRef, useState, type ReactNode } from 'react'
import styles from './ModelsSection.module.css'

/** Hold duration before a pointer gesture starts provider reorder. */
const PROVIDER_LONG_PRESS_MS = 420
/** Pointer movement that cancels a pending long-press (px). */
const PROVIDER_LONG_PRESS_MOVE_PX = 10

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
  const [longPressArmed, setLongPressArmed] = useState(false)
  const suppressClick = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null)
  const clearLongPress = (): void => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressOrigin.current = null
  }

  const className = [
    styles['rowCard'],
    longPressArmed || dragging ? styles['rowLongPress'] : '',
    dropHalf === 'before' ? styles['dropBefore'] : '',
    dropHalf === 'after' ? styles['dropAfter'] : '',
  ].filter(Boolean).join(' ')

  return (
    <li
      className={className}
      data-provider-id={providerId}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          clearLongPress()
          suppressClick.current = true
          try {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', providerId)
          } catch {
            // jsdom DataTransferPolyfill: effectAllowed may be read-only.
          }
          drag.start()
        }}
      onDragEnd={drag === undefined
        ? undefined
        : () => {
          setLongPressArmed(false)
          drag.end()
        }}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const half: ProviderDropHalf =
            e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
          drag.hover(providerId, half)
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          e.preventDefault()
          drag.end()
        }}
      onPointerDown={drag === undefined
        ? undefined
        : (e) => {
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest('button')) return
          clearLongPress()
          longPressOrigin.current = { x: e.clientX, y: e.clientY }
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null
            suppressClick.current = true
            setLongPressArmed(true)
            drag.start()
          }, PROVIDER_LONG_PRESS_MS)
        }}
      onPointerMove={drag === undefined
        ? undefined
        : (e) => {
          const origin = longPressOrigin.current
          if (origin !== null && longPressTimer.current !== null) {
            if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > PROVIDER_LONG_PRESS_MOVE_PX) {
              clearLongPress()
            }
            return
          }
          if (!longPressArmed) return
          const el = document.elementFromPoint(e.clientX, e.clientY)
          const section = el?.closest('[data-provider-id]') as HTMLElement | null
          const overId = section?.dataset.providerId
          if (overId === undefined || section === null) return
          const rect = section.getBoundingClientRect()
          const half: ProviderDropHalf =
            e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
          drag.hover(overId, half)
        }}
      onPointerUp={() => {
        const wasArmed = longPressArmed
        clearLongPress()
        if (wasArmed) {
          setLongPressArmed(false)
          drag?.end()
        }
      }}
      onPointerCancel={() => {
        clearLongPress()
        if (longPressArmed) {
          setLongPressArmed(false)
          drag?.end()
        }
      }}
      onClickCapture={(e) => {
        if (suppressClick.current || longPressArmed) {
          suppressClick.current = false
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
