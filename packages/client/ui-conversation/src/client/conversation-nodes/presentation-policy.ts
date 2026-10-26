/**
 * What one work-details mode enables on the transcript.
 *
 * DSH models this as a `ChatPresentationPolicy`: a mode resolves to a set of
 * capability flags, and renderers read the flags rather than the mode name.
 * The shape is kept here so a new mode is one table row, but the flags are
 * limited to what XRK's renderer can actually honour — a flag nothing reads
 * would be a setting that lies about what it does.
 *
 * Four points on the fold axis (low → high detail):
 * - compact: open while tools run (「过程」+ live shimmer); fold when the burst settles
 * - standard: same fold timing; open chrome keeps tool-name taxonomy
 * - detailed: keep the live run open; fold when the Turn ends
 * - verbose: no grouping and no auto-fold
 *
 * `immediate` remains on the axis for seats that latch while tools still run
 * (tests / future modes); no product mode selects it today.
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

/** Presentation capabilities selected by one work-details mode. */
export interface ChatPresentationPolicy {
  /** Preference identity for diagnostics and stable policy objects. */
  readonly mode: TranscriptViewMode
  /**
   * Whether auto-fold is allowed at all.
   *
   * Derived from {@link foldWhen}; kept so older call sites can still gate on a
   * boolean without learning the four-point axis.
   */
  readonly foldCompletedTurns: boolean
  /** When a grouped run latches closed. */
  readonly foldWhen: ProcessFoldWhen
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
  compact: {
    mode: 'compact',
    // Same timing as standard: open while tools run so「过程」+ live tool
    // stay visible; fold to the activity line once the burst settles.
    foldWhen: 'process',
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    // Quiet settled open chrome (step counts); folded title is always activity.
    detailTitles: false,
    liveProcessDetail: true,
  },
  standard: {
    mode: 'standard',
    foldWhen: 'process',
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    detailTitles: true,
    liveProcessDetail: true,
  },
  detailed: {
    mode: 'detailed',
    foldWhen: 'turn',
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
