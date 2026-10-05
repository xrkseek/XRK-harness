/**
 * Which rail mark is "here": the Turn covering the reading line, except at
 * the flow floor (last message against the composer) which always owns the
 * newest offered Turn. Defaulting a missed hit to Turn 1 made a bottom
 * viewport claim it was still the opening round.
 */

export function resolveActiveTurn(input: {
  readonly readingTurn: number | null
  readonly offeredTurns: readonly number[]
  readonly atFlowFloor: boolean
}): number | null {
  const offered = input.offeredTurns
  if (offered.length === 0) return null
  const newest = offered[offered.length - 1]!
  if (input.atFlowFloor) return newest
  if (input.readingTurn === null) return offered[0]!
  let next = offered[0]!
  for (const turn of offered) {
    if (turn > input.readingTurn) break
    next = turn
  }
  return next
}

/** Visible conversation band: scrollport top → composer (or viewport bottom). */
export function visibleBandBottom(scrollport: HTMLElement): number {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const composerTop = composer?.getBoundingClientRect().top
  return composerTop === undefined ? viewport.bottom : Math.min(viewport.bottom, composerTop)
}

/**
 * Reading line in viewport Y. Chat eyes sit in the lower band (newest), not
 * a 96px strip under the header — that strip stays on Turn 1 for a long
 * first round even when the floor is the latest answer.
 */
export function readingLineY(scrollport: HTMLElement): number {
  const viewport = scrollport.getBoundingClientRect()
  const bottom = visibleBandBottom(scrollport)
  const band = Math.max(0, bottom - viewport.top)
  return viewport.top + band * 0.62
}

/** Last turn row sits on the composer / viewport floor (sticky docks included). */
export function isAtFlowFloor(
  list: HTMLElement,
  scrollport: HTMLElement,
  threshold: number,
): boolean {
  const bottom = visibleBandBottom(scrollport)
  const rows = list.querySelectorAll<HTMLElement>('[data-chat-turn]')
  const last = rows[rows.length - 1]
  if (last !== undefined) {
    return last.getBoundingClientRect().bottom <= bottom + threshold
  }
  return scrollport.scrollHeight - scrollport.scrollTop - scrollport.clientHeight <= threshold + 1
}
