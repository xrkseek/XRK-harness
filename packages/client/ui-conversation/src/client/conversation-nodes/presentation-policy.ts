/**
 * What one work-details mode enables on the transcript.
 *
 * DSH models this as a `ChatPresentationPolicy`: a mode resolves to a set of
 * capability flags, and renderers read the flags rather than the mode name.
 * The shape is kept here so a new mode is one table row, but the flags are
 * limited to what XRK's renderer can actually honour — a flag nothing reads
 * would be a setting that lies about what it does.
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

/** Presentation capabilities selected by one work-details mode. */
export interface ChatPresentationPolicy {
  /** Preference identity for diagnostics and stable policy objects. */
  readonly mode: TranscriptViewMode
  /** Whether a normally completed Turn folds its process run. */
  readonly foldCompletedTurns: boolean
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
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    detailTitles: false,
    liveProcessDetail: false,
  },
  standard: {
    mode: 'standard',
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    detailTitles: true,
    liveProcessDetail: true,
  },
  detailed: {
    mode: 'detailed',
    foldCompletedTurns: true,
    stepGrouping: 'history',
    detailTitles: true,
    liveProcessDetail: true,
  },
  verbose: {
    mode: 'verbose',
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
