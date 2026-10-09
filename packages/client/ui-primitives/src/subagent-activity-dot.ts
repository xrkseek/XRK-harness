/**
 * Shared subagent live → {@link StateDotState} mapping for top-bar catalog,
 * Overview delegation board, and any surface that paints child activity.
 *
 * Two axes:
 * - `activity` — live (running chase vs idle)
 * - `outcomeKind` — terminal verdict when idle (aborted/error must not read as done)
 */
import type { StateDotState } from './StateDot.tsx'

/** Terminal kinds mirrored from Face `ChildOutcome.kind` / apiproxy `SubagentOutcome`. */
export type SubagentOutcomeKind =
  | 'completed'
  | 'aborted'
  | 'error'
  | 'max-tokens'
  | 'interrupted'
  | 'blocked'
  | 'none'

/**
 * Map live activity + optional terminal outcome to a StateDot.
 * Running always wins; abnormal terminals → error; else done (idle / completed / none).
 */
export function subagentActivityDot(
  activity: 'running' | 'inactive' | undefined,
  outcomeKind?: SubagentOutcomeKind | undefined,
): StateDotState {
  if (activity === 'running') return 'ongoing'
  if (
    outcomeKind === 'aborted'
    || outcomeKind === 'error'
    || outcomeKind === 'interrupted'
    || outcomeKind === 'max-tokens'
    || outcomeKind === 'blocked'
  ) {
    return 'error'
  }
  return 'done'
}
