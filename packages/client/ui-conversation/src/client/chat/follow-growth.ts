/**
 * Whether a ResizeObserver growth should re-pin the conversation scrollport.
 * Sticky composer docks (jobs / todo / queue) grow in-flow height; the reader
 * then sits above the new floor by roughly that growth even when still "at
 * bottom" in intent. Recover that case without stealing a far scroll-away.
 */

export function shouldFollowContentGrowth(options: {
  readonly atBottom: boolean
  readonly distanceFromBottom: number
  readonly growth: number
  readonly threshold: number
}): boolean {
  if (options.atBottom) return true
  if (options.growth <= 0) return false
  return options.distanceFromBottom <= options.growth + options.threshold + 1
}
