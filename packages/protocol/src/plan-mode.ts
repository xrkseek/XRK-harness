import type { SessionEvent } from "./session-events.js";

/** Folded plan projection unit (DSH `plan` key). */
export interface PlanUnitState {
  readonly active: boolean;
  /** Target of the latest `/plan` `command/run` not yet cleared by `plan/mode`. */
  readonly wanted: boolean | null;
}

export interface PlanProjection {
  readonly active: boolean;
  readonly pending: boolean;
}

export const EMPTY_PLAN_UNIT: PlanUnitState = {
  active: false,
  wanted: null,
};

/**
 * Last `plan/mode` wins; a prefix with none is inactive.
 * `end` folds `events[0, end)`.
 */
export function foldPlanMode(
  events: readonly SessionEvent[],
  end = events.length,
): boolean {
  const limit = Math.min(end, events.length);
  for (let i = limit - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "plan/mode") return event.active;
  }
  return false;
}

export function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false;
  for (const event of events) {
    if (event.type === "turn/start") open = true;
    else if (event.type === "turn/end") open = false;
  }
  return open;
}

/**
 * `command/run` name `plan` with recorded `args` sets wanted (`off` → false,
 * anything else including `""` → true). Omitted `args` does not touch state.
 * `plan/mode` commits and clears wanted.
 */
export function applyPlanUnitEvent(
  state: PlanUnitState,
  event: SessionEvent,
): PlanUnitState {
  if (event.type === "command/run" && event.name === "plan") {
    if (event.args === undefined) return state;
    const wanted = event.args.trim() !== "off";
    return wanted === state.wanted ? state : { active: state.active, wanted };
  }
  if (event.type === "plan/mode") {
    return { active: event.active, wanted: null };
  }
  return state;
}

export function foldPlanUnit(
  events: readonly SessionEvent[],
): PlanUnitState {
  let state = EMPTY_PLAN_UNIT;
  for (const event of events) state = applyPlanUnitEvent(state, event);
  return state;
}

export function viewPlanProjection(state: PlanUnitState): PlanProjection {
  return {
    active: state.active,
    pending: state.wanted !== null && state.wanted !== state.active,
  };
}

/** Outstanding `/plan` target waiting for an in-turn `plan/mode` commit. */
export function pendingPlanTarget(
  events: readonly SessionEvent[],
): boolean | null {
  const state = foldPlanUnit(events);
  if (state.wanted === null || state.wanted === state.active) return null;
  return state.wanted;
}

/** Guidance rendered while plan mode is in force (DSH `plan:policy`). */
export const DEFAULT_PLAN_POLICY_SECTION =
  "You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.";
