/**
 * Same-session goal round driver helpers (dsh goal-round-driver semantics,
 * without Cordis). FaceGoalStore owns state; this module owns the retained
 * continuation prompt and turn/end scheduling decisions.
 */

/** Minimal goal fields the driver needs. */
export interface GoalRoundSnapshot {
  readonly objective: string;
  readonly phase: "active" | "paused" | "blocked" | "complete";
  readonly activation: "armed" | "disarmed";
  readonly maxGoalRounds: number;
  readonly roundsStarted: number;
}

export type GoalTurnEndDecision =
  | { readonly kind: "noop" }
  | { readonly kind: "wake-pending" }
  | { readonly kind: "continue"; readonly round: number; readonly prompt: string }
  | {
      readonly kind: "block";
      readonly code: string;
      readonly message: string;
    }
  | { readonly kind: "disarm"; readonly code: string; readonly message: string };

/**
 * Render the retained `<goal_round>` user prompt for one automatic round.
 * Round is 1-based and must equal `roundsStarted + 1` at admission time.
 */
export function renderGoalRoundPrompt(
  goal: Pick<GoalRoundSnapshot, "objective" | "maxGoalRounds">,
  round: number,
): string {
  return (
    "<goal_round>\n" +
    `Objective: ${JSON.stringify(goal.objective)}\n` +
    `Round: ${round}/${goal.maxGoalRounds}\n\n` +
    "Continue working toward the objective in this same session. Treat the current workspace, " +
    "tool results, and durable session state as authoritative; inspect them instead of assuming " +
    "earlier narration is still current. Make concrete progress and verify the result. Before " +
    "claiming completion, gather evidence that the whole objective is achieved, read the current " +
    "goal via get_goal, and mark it complete with update_goal. If work remains, leave the goal " +
    "active for the next round. Use update_goal to report a blocker when progress is impossible.\n" +
    "</goal_round>"
  );
}

/** First-round / resume prompt (still tags `<goal_round>` for model consistency). */
export function renderGoalStartPrompt(
  goal: Pick<GoalRoundSnapshot, "objective" | "maxGoalRounds">,
  round: number,
  lead: "start" | "resume",
): string {
  const leadLine =
    lead === "resume"
      ? "Resume the current goal in this same session."
      : "Begin working toward the objective in this same session.";
  return (
    "<goal_round>\n" +
    `Objective: ${JSON.stringify(goal.objective)}\n` +
    `Round: ${round}/${goal.maxGoalRounds}\n\n` +
    `${leadLine} Treat the current workspace, tool results, and durable session state as ` +
    "authoritative. Make concrete progress and verify the result. Before claiming completion, " +
    "read get_goal and mark the goal complete with update_goal.\n" +
    "</goal_round>"
  );
}

/**
 * Decide what happens after `turn/end` for an armed active goal.
 * @param hasPendingAdmits - session already has queued admits (wake only).
 * @param turnReasonKind - `turn/end.reason.kind` when present.
 */
export function decideGoalTurnEnd(input: {
  readonly goal: GoalRoundSnapshot;
  readonly hasPendingAdmits: boolean;
  readonly turnReasonKind?: string;
}): GoalTurnEndDecision {
  const { goal } = input;
  if (goal.phase !== "active" || goal.activation !== "armed") {
    return { kind: "noop" };
  }
  if (input.turnReasonKind === "max-tokens") {
    return {
      kind: "disarm",
      code: "max-tokens",
      message: "goal disarmed after max-tokens turn end; resume to continue",
    };
  }
  if (input.hasPendingAdmits) {
    return { kind: "wake-pending" };
  }
  if (goal.roundsStarted >= goal.maxGoalRounds) {
    return {
      kind: "block",
      code: "max-rounds",
      message: `goal reached maxGoalRounds (${goal.maxGoalRounds})`,
    };
  }
  const round = goal.roundsStarted + 1;
  return {
    kind: "continue",
    round,
    prompt: renderGoalRoundPrompt(goal, round),
  };
}
