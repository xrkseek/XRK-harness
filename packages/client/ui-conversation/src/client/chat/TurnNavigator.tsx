import {
  memo, useEffect, useId, useRef, useState,
  type CSSProperties, type MouseEvent, type PointerEvent,
} from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnRailItem } from './turn-rail-items.ts'
import css from './TurnNavigator.module.css'

interface TurnNavigatorProps {
  readonly items: readonly TurnRailItem[]
  readonly activeTurn: number | null
  readonly busyTurn: number | null
  readonly onNavigate: (item: TurnRailItem) => void
  readonly t: ChatViewSlotProps['t']
}

/** Fixed pitch between neighbouring marks; overflow scrolls inside the frame. */
const TURN_SPACING_PX = 10
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6

type TurnPositionStyle = CSSProperties & {
  readonly '--turn-natural-position': string
}

type TurnFrameStyle = CSSProperties & {
  readonly '--turn-natural-height': string
  readonly '--turn-rail-inset': string
  readonly '--turn-scroll-top': string
}

function itemPosition(index: number): TurnPositionStyle {
  return { '--turn-natural-position': `${String(index * TURN_SPACING_PX)}px` }
}

function frameStyle(count: number, scrollTop: number): TurnFrameStyle {
  return {
    '--turn-natural-height': `${String((count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX)}px`,
    '--turn-rail-inset': `${String(RAIL_INSET_PX)}px`,
    '--turn-scroll-top': `${String(scrollTop)}px`,
  }
}

function itemAtPointer(
  items: readonly TurnRailItem[],
  frame: HTMLElement,
  scrollTop: number,
  clientY: number,
): TurnRailItem | undefined {
  const rect = frame.getBoundingClientRect()
  const offset = clientY - rect.top + scrollTop - RAIL_INSET_PX
  const index = Math.max(0, Math.min(items.length - 1, Math.round(offset / TURN_SPACING_PX)))
  return items[index]
}

/** Scroll state the mask fades and follow logic read together. */
interface RailScrollState {
  readonly top: number
  readonly canScrollUp: boolean
  readonly canScrollDown: boolean
}

const RAIL_AT_REST: RailScrollState = { top: 0, canScrollUp: false, canScrollDown: false }

function railScrollState(scroller: HTMLElement): RailScrollState {
  const top = scroller.scrollTop
  return {
    top,
    canScrollUp: top > 1,
    canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1,
  }
}

function sameRailScrollState(left: RailScrollState, right: RailScrollState): boolean {
  return left.top === right.top
    && left.canScrollUp === right.canScrollUp
    && left.canScrollDown === right.canScrollDown
}

function TurnNavigatorRail({ items, activeTurn, busyTurn, onNavigate, t }: TurnNavigatorProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  const [scrollState, setScrollState] = useState<RailScrollState>(RAIL_AT_REST)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** While the pointer works the rail, follow must not move it under the hand. */
  const pointerInsideRef = useRef(false)
  const previewId = useId()

  const syncScrollState = (): void => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const next = railScrollState(scroller)
    setScrollState(current => (sameRailScrollState(current, next) ? current : next))
  }

  // Frame resizes (band/composer changes) move the overflow edges without a
  // scroll event; item count changes move the content height the same way.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { syncScrollState() })
    observer.observe(scroller)
    return () => { observer.disconnect() }
  }, [])

  useEffect(syncScrollState, [items.length])

  useEffect(() => {
    if (pointerInsideRef.current) return
    const scroller = scrollerRef.current
    if (scroller === null || activeTurn === null) return
    const index = items.findIndex(item => item.turn === activeTurn)
    if (index < 0) return
    const markCenter = RAIL_INSET_PX + index * TURN_SPACING_PX
    const nextTop = Math.max(0, markCenter - scroller.clientHeight / 2)
    if (Math.abs(scroller.scrollTop - nextTop) > 1) scroller.scrollTop = nextTop
    syncScrollState()
  }, [activeTurn, items])

  if (items.length < 2) return null
  const previewIndex = items.findIndex(item => item.turn === previewTurn)
  const preview = previewIndex < 0 ? undefined : items[previewIndex]
  const previewPosition = previewIndex < 0 ? undefined : itemPosition(previewIndex)

  const previewAtPointer = (event: PointerEvent<HTMLElement>): void => {
    setPreviewTurn(itemAtPointer(items, event.currentTarget, scrollState.top, event.clientY)?.turn ?? null)
  }

  const navigateAtPointer = (event: MouseEvent<HTMLElement>): void => {
    const item = itemAtPointer(items, event.currentTarget, scrollState.top, event.clientY)
    if (item !== undefined) onNavigate(item)
  }

  const fadeClasses = [css.scroller]
  if (scrollState.canScrollUp) fadeClasses.push(css.fadeTop)
  if (scrollState.canScrollDown) fadeClasses.push(css.fadeBottom)
  return (
    <div className={css.slot}>
      <nav
        className={css.frame}
        style={frameStyle(items.length, scrollState.top)}
        aria-label={t('chat.turnNavigation.label')}
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerEnter={() => { pointerInsideRef.current = true }}
        onPointerLeave={() => {
          pointerInsideRef.current = false
          setPreviewTurn(null)
        }}
      >
        <div
          ref={scrollerRef}
          className={fadeClasses.join(' ')}
          onScroll={() => { syncScrollState() }}
        >
          <div className={css.marks}>
            {items.map((item, index) => {
              const classes = [css.mark]
              if (item.turn === activeTurn) classes.push(css.markActive)
              if (item.turn === previewTurn) classes.push(css.markPreview)
              if (item.turn === busyTurn) classes.push(css.markBusy)
              if (item.anchor.kind === 'unloaded') classes.push(css.markUnloaded)
              return (
                <div key={item.turn} className={css.markPosition} style={itemPosition(index)}>
                  <button
                    type="button"
                    className={classes.join(' ')}
                    aria-label={t('chat.turnNavigation.jump', { turn: item.turn })}
                    aria-current={item.turn === activeTurn ? 'true' : undefined}
                    aria-busy={item.turn === busyTurn ? 'true' : undefined}
                    aria-describedby={item.turn === previewTurn ? previewId : undefined}
                    onClick={(event) => {
                      event.stopPropagation()
                      onNavigate(item)
                    }}
                    onFocus={() => { setPreviewTurn(item.turn) }}
                    onBlur={() => { setPreviewTurn(null) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
        {preview !== undefined && previewPosition !== undefined && (
          <div id={previewId} role="tooltip" className={css.preview} style={previewPosition}>
            <div className={css.previewPrompt}>
              {preview.prompt || t('chat.turnNavigation.turn', { turn: preview.turn })}
            </div>
            {preview.response !== '' && <div className={css.previewResponse}>{preview.response}</div>}
          </div>
        )}
      </nav>
    </div>
  )
}

/**
 * Fixed-pitch rail of session Turns (loaded + outline) with hover/focus
 * previews. Overflow scrolls inside the frame; gradient fades mark each
 * scrollable end; the active mark keeps itself in view while the pointer is
 * elsewhere.
 *
 * Memoized because it renders two host elements per Turn while the enclosing
 * view re-renders on every streaming delta: without the guard a long session
 * rebuilds hundreds of marks per commit for a rail that only changes when a
 * Turn is added, removed, or becomes active. Its props must therefore stay
 * referentially stable across those commits.
 */
export const TurnNavigator = memo(TurnNavigatorRail)
