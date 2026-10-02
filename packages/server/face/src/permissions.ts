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
  AUTO_PERMISSION_PRESET,
  FACE_PERMISSION_PRESETS,
  isFacePermissionPreset,
  type FacePermissionPreset,
} from "./face-schema.js";
import type { FacePermissionAutoGate } from "./permission-auto.js";
import type { FaceRuntime } from "./context.js";

export const CUSTOM_PERMISSION_PRESET = "custom" as const;

/** @deprecated Prefer {@link AUTO_PERMISSION_PRESET}; DSH alias. */
export const AUTO_PRESET = AUTO_PERMISSION_PRESET;

export interface PermissionPresetSpec {
  readonly sandbox: SandboxMode;
  readonly approval: ApprovalPolicy;
  readonly name: string;
  readonly description: string;
}

/**
 * Fixed execution bundle for Auto (DSH `AUTO_PRESET_SPEC`): full sandbox with
 * `ask` so reviewer denials still surface to the user.
 */
export const AUTO_PRESET_SPEC: PermissionPresetSpec = {
  sandbox: "danger-full-access",
  approval: "ask",
  // DSH product name; Codex status/permission chrome says "Approve for me".
  name: "Auto review",
  description:
    "Full sandbox access with per-call Auto Review; denials still ask the user.",
};

/**
 * User-facing permission line for `/status` and Status chrome (Codex
 * `Workspace (Approve for me)` class — Auto is a whole preset here).
 * Machine id stays `auto` on the snapshot; only the display string is remapped.
 */
export function formatPermissionStatusLabel(permission: string): string {
  if (permission === AUTO_PERMISSION_PRESET) {
    // Codex "Approve for me" + DSH Auto review; explicit no-sandbox / per-call.
    return "Auto review (Approve for me) · no sandbox · per-call review";
  }
  return permission;
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

/** Resolve a configured table entry or the live Auto bundle. */
export function resolvePermissionPresetSpec(
  name: string,
  autoLive: boolean,
): PermissionPresetSpec | undefined {
  if (isFacePermissionPreset(name)) return FACE_PERMISSION_TABLE[name];
  if (name === AUTO_PERMISSION_PRESET && autoLive) return AUTO_PRESET_SPEC;
  return undefined;
}

function optionOf(name: string): PermissionSelectOption {
  if (name === CUSTOM_PERMISSION_PRESET) {
    return {
      value: CUSTOM_PERMISSION_PRESET,
      name: "Custom",
      description:
        "Current sandbox and approval settings do not match a preset.",
    };
  }
  if (name === AUTO_PERMISSION_PRESET) {
    return {
      value: AUTO_PERMISSION_PRESET,
      name: AUTO_PRESET_SPEC.name,
      description: AUTO_PRESET_SPEC.description,
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
 * `auto` appears in options only while Guardian `registerAuto` is live.
 */
export function derivePermissionSelect(
  state: PermissionKnobState,
  defaults: {
    readonly sandbox?: SandboxMode;
    readonly approval?: ApprovalPolicy;
  } = {},
  options: { readonly autoLive?: boolean } = {},
): PermissionSelect {
  const autoLive = options.autoLive === true;
  const sandbox = state.sandbox ?? defaults.sandbox ?? "workspace-write";
  const approval = state.approval ?? defaults.approval ?? "ask";
  let currentValue: string = CUSTOM_PERMISSION_PRESET;
  if (state.preset !== null) {
    const spec = resolvePermissionPresetSpec(state.preset, autoLive);
    if (spec && matches(spec, sandbox, approval)) currentValue = state.preset;
    // DSH: a stored Auto identity also matches `never` (delegated child pins
    // reviewer denials as final) while sandbox stays danger-full-access.
    if (
      currentValue === CUSTOM_PERMISSION_PRESET &&
      state.preset === AUTO_PERMISSION_PRESET &&
      autoLive &&
      AUTO_PRESET_SPEC.sandbox === sandbox &&
      approval === "never"
    ) {
      currentValue = AUTO_PERMISSION_PRESET;
    }
  }
  if (currentValue === CUSTOM_PERMISSION_PRESET) {
    for (const name of FACE_PERMISSION_PRESETS) {
      if (matches(FACE_PERMISSION_TABLE[name], sandbox, approval)) {
        currentValue = name;
        break;
      }
    }
    if (
      currentValue === CUSTOM_PERMISSION_PRESET &&
      autoLive &&
      matches(AUTO_PRESET_SPEC, sandbox, approval)
    ) {
      currentValue = AUTO_PERMISSION_PRESET;
    }
  }
  const catalog = autoLive
    ? [...FACE_PERMISSION_PRESETS, AUTO_PERMISSION_PRESET]
    : [...FACE_PERMISSION_PRESETS];
  return {
    options: [
      ...catalog.map((n) => optionOf(n)),
      ...(currentValue === CUSTOM_PERMISSION_PRESET
        ? [optionOf(CUSTOM_PERMISSION_PRESET)]
        : []),
    ],
    currentValue,
  };
}

export function permissionSelectFromEvents(
  events: readonly SessionEvent[],
  options: { readonly autoLive?: boolean } = {},
): PermissionSelect {
  return derivePermissionSelect(foldPermissionKnobs(events), {}, options);
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
  options?: { readonly autoGate?: FacePermissionAutoGate },
): void {
  const events = readSessionEvents(store, sessionId);
  const knobs = foldPermissionKnobs(events);
  // DSH: a stored Auto identity requires the live integration + admission
  // before the session may publish; never rewrite the seed.
  if (knobs.preset === AUTO_PERMISSION_PRESET) {
    if (options?.autoGate?.isLive() !== true) {
      throw new Error(
        'permission: cannot restore preset "auto" without its active integration',
      );
    }
    options.autoGate.admit();
    return;
  }
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
 * Move every live Auto session to Full access (DSH dispose migrateAway).
 * Called while Auto is still catalog-live but admission is already closed.
 */
export function migrateAutoSessionsToFullAccess(
  store: SessionStore,
  autoGate: FacePermissionAutoGate,
  options?: { readonly hasPtyActivity?: () => boolean },
): void {
  for (const sessionId of store.list()) {
    const current = permissionSelectFromEvents(
      readSessionEvents(store, sessionId),
      { autoLive: true },
    ).currentValue;
    if (current !== AUTO_PERMISSION_PRESET) continue;
    applyPermissionPreset(store, sessionId, "danger-full-access", {
      autoGate,
      ...(options?.hasPtyActivity
        ? { hasPtyActivity: options.hasPtyActivity }
        : {}),
    });
  }
}

/**
 * Switch preset: record identity when the derived current value changes, then
 * write each changed knob. Auto and Full access share `danger-full-access`
 * sandbox — the switch still appends `permission/preset` and only the
 * differing `approval/policy` (DSH shared-bundle switch). Selecting the
 * effective preset again appends nothing (Auto admission still runs).
 *
 * Optional `hasPtyActivity` fences sandbox mode changes while **Agent**
 * `terminal_*` PTY sessions are open or spawning (CV DSH terminal-bash
 * `ensureSandboxModeFence` / `@xrkseek/exec-pty` `sandboxModeChangeBlockedMessage`).
 * Sidebar user terminals are independent and must not be reported here.
 */
export function applyPermissionPreset(
  store: SessionStore,
  sessionId: string,
  name: string,
  options?: {
    readonly hasPtyActivity?: () => boolean;
    readonly autoGate?: FacePermissionAutoGate;
  },
):
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly message: string } {
  const autoLive = options?.autoGate?.isLive() === true;
  const catalog = options?.autoGate?.catalogNames() ?? FACE_PERMISSION_PRESETS;
  const spec = resolvePermissionPresetSpec(name, autoLive);
  if (!spec) {
    return {
      ok: false,
      message: `unknown preset "${name}" (available: ${catalog.join(", ")})`,
    };
  }
  if (name === AUTO_PERMISSION_PRESET) {
    try {
      options?.autoGate?.admit();
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const events = readSessionEvents(store, sessionId);
  const current = permissionSelectFromEvents(events, { autoLive }).currentValue;
  const knobs = foldPermissionKnobs(events);
  // Effective knobs (composition defaults) — same basis as derivePermissionSelect.
  const effectiveSandbox =
    knobs.sandbox ?? FACE_PERMISSION_TABLE["workspace-write"].sandbox;
  const effectiveApproval = knobs.approval ?? "ask";
  if (
    effectiveSandbox !== spec.sandbox &&
    options?.hasPtyActivity?.() === true
  ) {
    return {
      ok: false,
      message: `cannot change sandbox mode from "${effectiveSandbox}" to "${spec.sandbox}" while Agent terminal_* sessions are open or being created; wait for creation to settle and close them first`,
    };
  }
  // DSH: identity tracks derived current, not the raw last preset event — so
  // Auto↔Full (shared sandbox) still records the new selection.
  let changed = false;
  const ts = now();
  if (current !== name) {
    store.append(sessionId, {
      type: "permission/preset",
      ts,
      preset: name,
    });
    changed = true;
  }
  if (effectiveSandbox !== spec.sandbox) {
    store.append(sessionId, {
      type: "sandbox/mode",
      ts: ts + 1,
      mode: spec.sandbox,
    });
    changed = true;
  }
  if (effectiveApproval !== spec.approval) {
    store.append(sessionId, {
      type: "approval/policy",
      ts: ts + 2,
      policy: spec.approval,
    });
    changed = true;
  }
  return { ok: true, changed };
}

/**
 * Settings `permission.defaultPreset` is `applies: live`. Push the new default
 * onto sessions still on the previous default (not manually customized via
 * Access / `/permission`), then invalidate so sandbox/approval rebuild.
 */
export async function applyLivePermissionDefaultPreset(
  runtime: FaceRuntime,
  previousUser: unknown,
  nextValue: unknown,
): Promise<void> {
  const nextRaw =
    nextValue && typeof nextValue === "object"
      ? (nextValue as { defaultPreset?: unknown }).defaultPreset
      : undefined;
  if (!isFacePermissionPreset(nextRaw)) return;
  const prevRaw =
    previousUser && typeof previousUser === "object"
      ? (previousUser as { defaultPreset?: unknown }).defaultPreset
      : undefined;
  const previousPreset: FacePermissionPreset = isFacePermissionPreset(prevRaw)
    ? prevRaw
    : "workspace-write";
  if (previousPreset === nextRaw) return;

  for (const sessionId of runtime.store.list()) {
    const current = permissionSelectFromEvents(
      readSessionEvents(runtime.store, sessionId),
    ).currentValue;
    if (current !== previousPreset) continue;
    const applied = applyPermissionPreset(runtime.store, sessionId, nextRaw, {
      ...(runtime.hasPtyActivity
        ? { hasPtyActivity: () => runtime.hasPtyActivity!() }
        : {}),
      autoGate: runtime.permissionAuto,
    });
    if (applied.ok && applied.changed) {
      await runtime.invalidateAgent?.(sessionId);
    }
  }
}
