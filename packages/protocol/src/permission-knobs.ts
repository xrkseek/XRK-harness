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
  return lastSandboxMode(events) ?? fallback;
}

/**
 * Last explicit `sandbox/mode` in the log.
 *
 * Only `sandbox/mode` writes the sandbox knob (`applyPermissionKnobEvent`
 * leaves it untouched for preset/approval), so a backwards scan is exactly
 * equivalent to folding the whole log — but O(1) instead of O(n). The path gate
 * asks this on every tool call.
 */
export function lastSandboxMode(
  events: readonly SessionEvent[],
): SandboxMode | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "sandbox/mode") return event.mode;
  }
  return undefined;
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

/**
 * Path gate for fs / bash cwd (orthogonal to tool surface).
 * - `jailed` — workspace root only (no extraWritableRoots)
 * - `allowlisted` — workspace + Settings/session object roots
 * - `open` — no path jail (danger-full-access / auto sandbox)
 */
export type PathAccessMode = "jailed" | "allowlisted" | "open";

/** Map session sandbox mode → fs/shell path gate. Auto uses danger-full-access → open. */
export function pathAccessModeFromSandbox(
  mode: SandboxMode | null,
): PathAccessMode {
  if (mode === "danger-full-access") return "open";
  return "allowlisted";
}
