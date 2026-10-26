/**
 * Whether a ResizeObserver growth should re-pin the conversation scrollport.
 * Sticky composer docks (jobs / todo / queue / better-sidebar bottom chrome)
 * grow in-flow height; the reader then sits above the new floor by roughly
 * that growth even when still "at bottom" in intent. Recover that case
 * without stealing a far scroll-away.
 *
 * Process-group collapse uses `hidden` (DSH searchable-hidden), so height
 * drops in one layout. A no-op `scrollTop = scrollHeight` while already on
 * the clamped floor can hitch sticky composer placement — skip that write.
 */

export function shouldFollowContentGrowth(options: {
  readonly atBottom: boolean
  readonly distanceFromBottom: number
  readonly growth: number
  readonly threshold: number
}): boolean {
  if (options.atBottom) {
    // Shrink past the new floor (distance negative / large) still needs a pin.
    // Already-clamped shrink (distance ≈ 0) is a no-op that can lift the seat.
    if (options.growth < 0) {
      return options.distanceFromBottom < -0.5
        || options.distanceFromBottom > options.threshold + 1
    }
    return true
  }
  if (options.growth <= 0) return false
  return options.distanceFromBottom <= options.growth + options.threshold + 1
}
