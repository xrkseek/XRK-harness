/**
 * Process-plugin load failure isolation (DSH auditStartupEntries /
 * Codex required MCP servers).
 */

import {
  entriesFromPluginFailures,
  formatStartupDiagnostic,
  StartupError,
} from "./startup-audit.js";

export interface PluginLoadFailure {
  readonly id: string;
  readonly required: boolean;
  readonly message: string;
  /**
   * When set, drives Failed vs Waiting sections in the startup diagnostic.
   * Omit → heuristic from {@link message} (DSH pending wording).
   */
  readonly kind?: "failed" | "pending";
  /** Present when `kind` is `pending` (or inferred). */
  readonly missing?: readonly string[];
}

export interface ReconcileProcessPluginsResult {
  readonly ids: readonly string[];
  /** Optional (and required) load failures collected this pass. */
  readonly failures: readonly PluginLoadFailure[];
  /**
   * After the pass: live ids match enabled discoveries (unload paired with
   * register). `mcp:*` is excluded — MCP reconcile owns that pair.
   */
  readonly pairing?: PluginRegisterUnloadPair;
}

/** Live registry vs disk intent after reconcile. */
export interface PluginRegisterUnloadPair {
  readonly paired: boolean;
  /** Still registered though disabled or gone from disk. */
  readonly stillLoaded: readonly string[];
  /** Enabled and discovered but not registered (and not a recorded failure). */
  readonly notRegistered: readonly string[];
}

/**
 * Pairing check: every enabled discovery is registered, and nothing disabled
 * or missing on disk stays loaded. Does not itself unload or register.
 */
export function checkPluginRegisterUnloadPair(input: {
  readonly liveIds: readonly string[];
  readonly discoveredIds: readonly string[];
  /** Same predicate reconcile uses (alias-aware soft-disable). */
  readonly isDisabled: (id: string) => boolean;
  readonly failedIds?: readonly string[];
}): PluginRegisterUnloadPair {
  const discovered = new Set(input.discoveredIds);
  const failed = new Set(input.failedIds ?? []);
  const live = input.liveIds.filter((id) => !id.startsWith("mcp:"));
  const stillLoaded = live.filter(
    (id) => input.isDisabled(id) || !discovered.has(id),
  );
  const liveSet = new Set(live);
  const notRegistered = input.discoveredIds.filter(
    (id) =>
      !id.startsWith("mcp:") &&
      !input.isDisabled(id) &&
      !failed.has(id) &&
      !liveSet.has(id),
  );
  return {
    paired: stillLoaded.length === 0 && notRegistered.length === 0,
    stillLoaded,
    notRegistered,
  };
}

/** Thrown when at least one `required: true` plugin failed to load. */
export class RequiredPluginLoadError extends StartupError {
  readonly failures: readonly PluginLoadFailure[];

  constructor(failures: readonly PluginLoadFailure[]) {
    const entries = entriesFromPluginFailures(failures);
    super(formatStartupDiagnostic(entries), entries);
    this.name = "RequiredPluginLoadError";
    this.failures = failures;
    Object.defineProperty(this, "failures", { enumerable: false });
  }
}

export function throwIfRequiredPluginFailures(
  failures: readonly PluginLoadFailure[],
): void {
  if (failures.some((f) => f.required)) {
    throw new RequiredPluginLoadError(failures);
  }
}

export function failureFromLoadError(
  id: string,
  required: boolean,
  err: unknown,
): PluginLoadFailure {
  const message = err instanceof Error ? err.message : String(err);
  return {
    id,
    required,
    message,
  };
}
