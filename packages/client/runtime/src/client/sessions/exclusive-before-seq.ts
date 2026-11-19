/**
 * Map a Face **wire / mux** seq onto an exclusive durable-log `beforeSeq`.
 *
 * Face `session.truncate` / fork-cut treat `beforeSeq` as a 0-based exclusive
 * offset into the logical session log (`events.slice(0, beforeSeq)`). Chat
 * nodes expose the mux seq stamped on live `session/event` frames. Those two
 * clocks match while the mux watermark advances 1:1 with appends, but Face's
 * mux clock is intentionally monotonic across in-place truncate — after a cut
 * the next admits jump above the pre-cut watermark while the durable log is
 * short again. `wireSeq - 1` then clamps to `events.length` and keeps the
 * completed turn (regenerate stacks a second round).
 *
 * Prefer the loaded window's array index (absolute when the window starts at
 * the log head, or `baseSeq`-anchored for a history suffix).
 */
export function exclusiveBeforeSeqForWireSeq(opts: {
  readonly wireSeq: number
  readonly eventSeqs: readonly number[]
  readonly hasMore: boolean
  readonly baseSeq: number
}): number {
  const wireSeq = Math.floor(opts.wireSeq)
  if (!Number.isSafeInteger(wireSeq) || wireSeq < 0) return 0
  const index = opts.eventSeqs.findIndex((seq) => seq === wireSeq)
  if (index < 0) return Math.max(0, wireSeq - 1)
  // Full window from log head: index === durable offset.
  if (!opts.hasMore || opts.baseSeq <= 1) return index
  // History suffix: baseSeq is the 1-based absolute start of events[0].
  return Math.max(0, (opts.baseSeq - 1) + index)
}
