/**
 * Face plan-mode — DSH `/plan` + `plan` projection over session knobs.
 * `plan/mode` commits immediately between turns; queued while a turn is open.
 */

import { admitPrompt, type SessionStore } from "@xrkseek/core-session";
import { foldPlanMode, hasOpenTurn, pendingPlanTarget } from "@xrkseek/protocol";

export type PlanSetOutcome = "committed" | "queued" | "cancelled" | "noop";

export function planWantedFromArgs(rawInput: string): boolean {
  return rawInput.trim() !== "off";
}

/**
 * Decide a `/plan` selection against the log *before* this command/run.
 * Caller logs `command/run` first, then appends `plan/mode` only when
 * this returns `committed`.
 */
export function previewPlanSet(
  events: readonly import("@xrkseek/protocol").SessionEvent[],
  active: boolean,
): PlanSetOutcome {
  const logged = foldPlanMode(events);
  const target = pendingPlanTarget(events) ?? logged;
  if (active === target) return "noop";
  if (hasOpenTurn(events)) {
    return logged === active ? "cancelled" : "queued";
  }
  return "committed";
}

export function commitPlanMode(
  store: SessionStore,
  sessionId: string,
  active: boolean,
): void {
  store.append(sessionId, {
    type: "plan/mode",
    ts: Date.now(),
    active,
  });
}

export function narratePlanCommand(
  outcome: PlanSetOutcome,
  wanted: boolean,
  loggedActive: boolean,
): string {
  if (!wanted) {
    switch (outcome) {
      case "committed":
        return "Plan mode off.";
      case "queued":
        return "Leaving plan mode (applies from the next step).";
      case "cancelled":
        return "Plan mode entry cancelled.";
      case "noop":
        return loggedActive
          ? "Leaving plan mode (applies from the next step)."
          : "Plan mode is already inactive.";
    }
  }
  return outcome === "committed"
    ? "Plan mode on. Use /plan off to leave."
    : "Entering plan mode (applies from the next step). Use /plan off to leave.";
}

/** Optional `/plan <message>` suffix becomes the next user prompt. */
export function steerPlanMessage(
  store: SessionStore,
  sessionId: string,
  rawInput: string,
): string | undefined {
  const message = rawInput.trim();
  if (message === "" || message === "off") return undefined;
  admitPrompt(store, sessionId, message, { delivery: "steer" });
  return message;
}
