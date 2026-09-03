/**
 * Face permission presets — DSH permission-presets over session knobs.
 * Projection `permissions` + `/permission` write path; approval `never` auto-allows.
 */

import { readSessionEvents, type SessionStore } from "@xrkseek/core-session";
import {
  foldPermissionKnobs,
  type ApprovalPolicy,
  type PermissionKnobState,
  type SandboxMode,
  type SessionEvent,
} from "@xrkseek/protocol";
import {
  FACE_PERMISSION_PRESETS,
  isFacePermissionPreset,
  type FacePermissionPreset,
} from "./face-schema.js";
import type { FaceRuntime } from "./context.js";

export const CUSTOM_PERMISSION_PRESET = "custom" as const;

export interface PermissionPresetSpec {
  readonly sandbox: SandboxMode;
  readonly approval: ApprovalPolicy;
  readonly name: string;
  readonly description: string;
}

export interface PermissionSelectOption {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}

export interface PermissionSelect {
  readonly options: readonly PermissionSelectOption[];
  readonly currentValue: string;
}

/** Same table ids as settings `permission.defaultPreset`. */
export const FACE_PERMISSION_TABLE: Readonly<
  Record<FacePermissionPreset, PermissionPresetSpec>
> = {
  "read-only": {
    sandbox: "read-only",
    approval: "ask",
    name: "read-only",
    description:
      "Read tools only. Writes, bash, and mutating terminals are denied.",
  },
  "workspace-write": {
    sandbox: "workspace-write",
    approval: "ask",
    name: "workspace-write",
    description:
      "Write inside the workspace; shell stays confined. Wider retries need approval.",
  },
  "danger-full-access": {
    sandbox: "danger-full-access",
    approval: "never",
    name: "danger-full-access",
    description:
      "No approval prompts; shell is not sandboxed. File tools still cannot leave the workspace root.",
  },
};

function optionOf(name: string): PermissionSelectOption {
  if (name === CUSTOM_PERMISSION_PRESET) {
    return {
      value: CUSTOM_PERMISSION_PRESET,
      name: "Custom",
      description:
        "Current sandbox and approval settings do not match a preset.",
    };
  }
  const spec = FACE_PERMISSION_TABLE[name as FacePermissionPreset];
  if (!spec) {
    throw new Error(`permission: unknown preset "${name}"`);
  }
  return {
    value: name,
    name: spec.name,
    description: spec.description,
  };
}

function matches(
  spec: PermissionPresetSpec,
  sandbox: SandboxMode,
  approval: ApprovalPolicy,
): boolean {
  return spec.sandbox === sandbox && spec.approval === approval;
}

/**
 * Derive select currentValue from folded knobs + composition defaults.
 * Defaults match a coding harness (workspace-write + ask).
 */
export function derivePermissionSelect(
  state: PermissionKnobState,
  defaults: {
    readonly sandbox?: SandboxMode;
    readonly approval?: ApprovalPolicy;
  } = {},
): PermissionSelect {
  const sandbox = state.sandbox ?? defaults.sandbox ?? "workspace-write";
  const approval = state.approval ?? defaults.approval ?? "ask";
  let currentValue: string = CUSTOM_PERMISSION_PRESET;
  if (state.preset !== null) {
    const spec = FACE_PERMISSION_TABLE[state.preset as FacePermissionPreset];
    if (spec && matches(spec, sandbox, approval)) currentValue = state.preset;
  }
  if (currentValue === CUSTOM_PERMISSION_PRESET) {
    for (const name of FACE_PERMISSION_PRESETS) {
      if (matches(FACE_PERMISSION_TABLE[name], sandbox, approval)) {
        currentValue = name;
        break;
      }
    }
  }
  return {
    options: [
      ...FACE_PERMISSION_PRESETS.map((n) => optionOf(n)),
      ...(currentValue === CUSTOM_PERMISSION_PRESET
        ? [optionOf(CUSTOM_PERMISSION_PRESET)]
        : []),
    ],
    currentValue,
  };
}

export function permissionSelectFromEvents(
  events: readonly SessionEvent[],
): PermissionSelect {
  return derivePermissionSelect(foldPermissionKnobs(events));
}

export function defaultPermissionPreset(runtime: FaceRuntime): FacePermissionPreset {
  const viewed = runtime.settingsNamespaces.view(
    "permission",
    { defaultPreset: "workspace-write" },
  );
  const raw = (viewed.value as { defaultPreset?: unknown }).defaultPreset;
  return isFacePermissionPreset(raw) ? raw : "workspace-write";
}

function now(): number {
  return Date.now();
}

function hasAnyKnob(events: readonly SessionEvent[]): boolean {
  return events.some(
    (e) =>
      e.type === "permission/preset" ||
      e.type === "sandbox/mode" ||
      e.type === "approval/policy",
  );
}

/** Pin durable knobs on a fresh session (settings defaultPreset). */
export function pinInitialPermission(
  store: SessionStore,
  sessionId: string,
  preset: FacePermissionPreset,
): void {
  const events = readSessionEvents(store, sessionId);
  if (hasAnyKnob(events)) return;
  const spec = FACE_PERMISSION_TABLE[preset];
  const ts = now();
  store.append(sessionId, {
    type: "permission/preset",
    ts,
    preset,
  });
  store.append(sessionId, {
    type: "sandbox/mode",
    ts: ts + 1,
    mode: spec.sandbox,
  });
  store.append(sessionId, {
    type: "approval/policy",
    ts: ts + 2,
    policy: spec.approval,
  });
}

/**
 * Switch preset: append changed knobs only. Selecting the effective preset
 * again appends nothing.
 *
 * Optional `hasPtyActivity` fences sandbox mode changes while PTY sessions are
 * open or spawning (CV DSH terminal-bash `ensureSandboxModeFence`).
 */
export function applyPermissionPreset(
  store: SessionStore,
  sessionId: string,
  name: string,
  options?: { readonly hasPtyActivity?: () => boolean },
):
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly message: string } {
  if (!isFacePermissionPreset(name)) {
    return {
      ok: false,
      message: `unknown preset "${name}" (available: ${FACE_PERMISSION_PRESETS.join(", ")})`,
    };
  }
  const events = readSessionEvents(store, sessionId);
  const current = permissionSelectFromEvents(events).currentValue;
  if (current === name) return { ok: true, changed: false };
  const spec = FACE_PERMISSION_TABLE[name];
  const knobs = foldPermissionKnobs(events);
  const currentSandbox =
    knobs.sandbox ?? FACE_PERMISSION_TABLE["workspace-write"].sandbox;
  if (
    knobs.sandbox !== spec.sandbox &&
    options?.hasPtyActivity?.() === true
  ) {
    return {
      ok: false,
      message: `cannot change sandbox mode from "${currentSandbox}" to "${spec.sandbox}" while persistent terminal sessions are open or being created; wait for creation to settle and close them first`,
    };
  }
  const ts = now();
  if (knobs.preset !== name) {
    store.append(sessionId, {
      type: "permission/preset",
      ts,
      preset: name,
    });
  }
  if (knobs.sandbox !== spec.sandbox) {
    store.append(sessionId, {
      type: "sandbox/mode",
      ts: ts + 1,
      mode: spec.sandbox,
    });
  }
  if (knobs.approval !== spec.approval) {
    store.append(sessionId, {
      type: "approval/policy",
      ts: ts + 2,
      policy: spec.approval,
    });
  }
  return { ok: true, changed: true };
}
