/**
 * What one work-details mode enables on the transcript.
 *
 * DSH models this as a `ChatPresentationPolicy`: a mode resolves to a set of
 * capability flags, and renderers read the flags rather than the mode name.
 * The shape is kept here so a new mode is one table row, but the flags are
 * limited to what XRK's renderer can actually honour — a flag nothing reads
 * would be a setting that lies about what it does.
 *
 * Three points on the fold axis (low → high detail):
 * - standard: open while tools run (「过程」+ live shimmer); fold when the burst settles
 * - detailed: keep the live run open; fold when the Turn ends
 * - verbose: no grouping and no auto-fold
 *
 * `immediate` remains on the axis for seats that latch while tools still run
 * (tests / future modes); no product mode selects it today.
 *
 * `next-input` collapse timing stays on the axis for the same reason: every
 * product mode folds on completion, but the renderer honours a policy that
 * holds the just-finished run open until the reader sends again.
 */

import type { TranscriptViewMode } from '../../submission-settings.ts'

/** How process runs are grouped in the flow. */
export type StepGrouping =
  /** Every Turn's consecutive process rows fold into one run. */
  | 'collapsed'
  /** Only Turns the reader has already left group; the live Turn stays flat. */
  | 'history'
  /** No grouping at all — every process row renders inline. */
  | 'none'

/**
 * When a grouped process run auto-folds.
 *
 * Ordered from the quietest transcript to the most expanded.
 */
export type ProcessFoldWhen =
  /** Latch folded as soon as the group exists (even while tools still run). */
  | 'immediate'
  /** Fold once every tool in the burst has settled (answer may still stream). */
  | 'process'
  /** Fold only after the Turn closes (or the session idles with tools settled). */
  | 'turn'
  /** Never auto-fold. */
  | 'never'

/**
 * When a settled run is allowed to fold, on the reader's clock.
 *
 * The `foldWhen` axis says *what* counts as settled; this says whether the
 * settled run is allowed to disappear yet. DSH splits the two for the same
 * reason: "the Turn ended" and "the reader has moved on" are different events.
 */
export type CollapseTiming =
  /** Fold the moment the run settles (every product mode today). */
  | 'completion'
  /** Keep the just-finished run open until the reader sends the next input. */
  | 'next-input'

/** Presentation capabilities selected by one work-details mode. */
export interface ChatPresentationPolicy {
  /** Preference identity for diagnostics and stable policy objects. */
  readonly mode: TranscriptViewMode
  /**
   * Whether auto-fold is allowed at all.
   *
   * Derived from {@link foldWhen}; kept so older call sites can still gate on a
   * boolean without learning the foldWhen axis.
   */
  readonly foldCompletedTurns: boolean
  /** When a grouped run latches closed. */
  readonly foldWhen: ProcessFoldWhen
  /**
   * Whether a settled run folds at once, or waits for the reader's next input.
   *
   * Resolved per run by {@link processGroupDeferred}; only `next-input`
   * defers, and only for the newest Turn with nothing new in flight.
   */
  readonly collapseTiming: CollapseTiming
  /** Where a group may appear at all. */
  readonly stepGrouping: StepGrouping
  /**
   * Whether a settled run header names what ran (`bash · Read · 思考 1 次`)
   * or only counts steps (`4 步`). Quiet modes drop the taxonomy, not the count.
   */
  readonly detailTitles: boolean
  /**
   * Whether a still-open run's header shows the live tool / reasoning detail
   * (and the running shimmer). Mirrors DSH `liveProcessDetail`.
   */
  readonly liveProcessDetail: boolean
}

const POLICIES: Readonly<Record<TranscriptViewMode, ChatPresentationPolicy>> = {
  standard: {
    mode: 'standard',
    foldWhen: 'process',
    collapseTiming: 'completion',
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    detailTitles: true,
    liveProcessDetail: true,
  },
  detailed: {
    mode: 'detailed',
    foldWhen: 'turn',
    collapseTiming: 'completion',
    foldCompletedTurns: true,
    // Live Turn stays grouped so the fold animation has a run to collapse when
    // the Turn ends — history-only grouping left detailed looking like "never
    // folds" for the turn the reader is watching.
    stepGrouping: 'collapsed',
    detailTitles: true,
    liveProcessDetail: true,
  },
  verbose: {
    mode: 'verbose',
    foldWhen: 'never',
    collapseTiming: 'completion',
    foldCompletedTurns: false,
    stepGrouping: 'none',
    detailTitles: true,
    // Rows stay flat; live detail lives on each tool / think row, not a group header.
    liveProcessDetail: false,
  },
}

/**
 * Resolve the stable policy for one persisted mode.
 * @param mode - saved work-details mode.
 * @returns the same policy object for the same mode.
 */
export function presentationPolicyFor(mode: TranscriptViewMode): ChatPresentationPolicy {
  return POLICIES[mode]
}

/**
 * Whether a process group should latch closed under one fold policy.
 * @param foldWhen - mode's fold timing.
 * @param entry - closed flag and running summary for the group.
 * @param idleSettled - Host idle with every tool settled (lost turn/end).
 */
export function processGroupSettled(
  foldWhen: ProcessFoldWhen,
  entry: { readonly closed: boolean; readonly summary: { readonly running: boolean; readonly tools: number } },
  idleSettled: boolean,
): boolean {
  switch (foldWhen) {
    case 'immediate':
      return true
    case 'process': {
      const toolsBurstDone = !entry.summary.running && entry.summary.tools > 0
      return entry.closed || idleSettled || toolsBurstDone
    }
    case 'turn':
      return entry.closed || idleSettled
    case 'never':
      return false
  }
}

/**
 * Whether a settled run must keep its rows visible until the reader sends.
 *
 * DSH `collapseTiming: 'next-input'`: the run the reader just watched stays
 * open through the end of the Turn, and folds when the next input arrives —
 * a send either replaces the Turn (a newer Turn exists) or is already in
 * flight (its transcript echo is pending). Both facts are monotone for one
 * run, so a fold once taken is never undone by this predicate.
 * @param collapseTiming - mode's collapse timing.
 * @param run - whether this run is the newest Turn, and whether a next send is in flight.
 * @returns true while the run should stay open past settlement.
 */
export function processGroupDeferred(
  collapseTiming: CollapseTiming,
  run: {
    /** The run belongs to the newest Turn — no later Turn has started. */
    readonly newestTurn: boolean
    /** The reader has already sent the next input; its echo has not landed yet. */
    readonly nextInputPending: boolean
  },
): boolean {
  if (collapseTiming !== 'next-input') return false
  return run.newestTurn && !run.nextInputPending
}
