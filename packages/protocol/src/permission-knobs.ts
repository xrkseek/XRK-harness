import type {
  ApprovalPolicy,
  SandboxMode,
  SessionEvent,
} from "./session-events.js";

/** Folded permission knobs (DSH permission-presets). Null = composition default. */
export interface PermissionKnobState {
  readonly preset: string | null;
  readonly sandbox: SandboxMode | null;
  readonly approval: ApprovalPolicy | null;
}

export const EMPTY_PERMISSION_KNOBS: PermissionKnobState = {
  preset: null,
  sandbox: null,
  approval: null,
};

/** One-event knob transition; same reference when the event is not a knob. */
export function applyPermissionKnobEvent(
  state: PermissionKnobState,
  event: SessionEvent,
): PermissionKnobState {
  switch (event.type) {
    case "permission/preset":
      return { ...state, preset: event.preset };
    case "sandbox/mode":
      return { ...state, sandbox: event.mode };
    case "approval/policy":
      return { ...state, approval: event.policy };
    default:
      return state;
  }
}

/** Whole-log fold of permission knobs. */
export function foldPermissionKnobs(
  events: readonly SessionEvent[],
): PermissionKnobState {
  let state = EMPTY_PERMISSION_KNOBS;
  for (const event of events) state = applyPermissionKnobEvent(state, event);
  return state;
}

export function effectiveSandboxMode(
  events: readonly SessionEvent[],
  fallback: SandboxMode = "workspace-write",
): SandboxMode {
  return foldPermissionKnobs(events).sandbox ?? fallback;
}

export function effectiveApprovalPolicy(
  events: readonly SessionEvent[],
  fallback: ApprovalPolicy = "ask",
): ApprovalPolicy {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "approval/policy") return event.policy;
  }
  return fallback;
}

/** Whether workspace wrap / write-intent should stay on (not danger-full-access). */
export function shouldConfineSandbox(mode: SandboxMode | null): boolean {
  return mode !== "danger-full-access";
}
