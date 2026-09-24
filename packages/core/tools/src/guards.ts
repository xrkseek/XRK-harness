import { TOOL_FS_NOT_OBSERVED } from "@xrkseek/protocol";
import type { GuardVerdict, MonotonicGuard, ToolPipelineContext } from "./types.js";

/** Model-visible FS_NOT_OBSERVED body: path + code + reason. */
export function formatFsNotObservedContent(path: string): string {
  return (
    `Error [${TOOL_FS_NOT_OBSERVED}]: cannot modify "${path}": ` +
    "file has not been read — read the file, then retry"
  );
}

export function fsNotObservedDenyError(): {
  readonly name: string;
  readonly code: string;
} {
  return { name: "FsNotObservedError", code: TOOL_FS_NOT_OBSERVED };
}

/**
 * Fold guard verdicts in registration order.
 * Once `deny` is set, later `allow` cannot upgrade it.
 */
export function foldGuardVerdicts(
  verdicts: readonly GuardVerdict[],
): GuardVerdict {
  let denied = false;
  let allowed = false;
  for (const v of verdicts) {
    if (v === "abstain") continue;
    if (v === "deny") {
      denied = true;
      continue;
    }
    // allow
    if (!denied) {
      allowed = true;
    }
  }
  if (denied) return "deny";
  if (allowed) return "allow";
  return "abstain";
}

export async function runGuards(
  guards: readonly MonotonicGuard[],
  ctx: ToolPipelineContext,
): Promise<GuardVerdict> {
  const verdicts: GuardVerdict[] = [];
  for (const g of guards) {
    verdicts.push(await g(ctx));
  }
  return foldGuardVerdicts(verdicts);
}

/** policy.tool.call — deny if name is in denylist. */
export function createPolicyToolCallGuard(
  denylist: ReadonlySet<string> | readonly string[],
): MonotonicGuard {
  const set = denylist instanceof Set ? denylist : new Set(denylist);
  return (ctx) => (set.has(ctx.call.name) ? "deny" : "abstain");
}

/**
 * fs write-intent: deny listed write tools unless each touched path was read.
 * `apply_patch` observes Update/Delete paths from the patch text (Add File skips).
 * Sets denyReason + denyError (`FS_NOT_OBSERVED`: path + code + reason).
 */
export function createWriteIntentGuard(options: {
  hasRead: (path: string) => boolean;
  writeToolNames?: ReadonlySet<string> | readonly string[];
}): MonotonicGuard {
  const writes =
    options.writeToolNames instanceof Set
      ? options.writeToolNames
      : new Set(
          options.writeToolNames ?? ["apply_edit", "write_file", "apply_patch"],
        );
  return (ctx) => {
    if (!writes.has(ctx.call.name)) return "abstain";
    const paths = extractWritePaths(ctx.call.name, ctx.args);
    if (paths === undefined) {
      ctx.denyReason =
        ctx.call.name === "apply_patch"
          ? "apply_patch requires a patch argument"
          : `${ctx.call.name} requires a path argument`;
      return "deny";
    }
    if (paths.length === 0) {
      // Add-only patch — no prior read required.
      return "allow";
    }
    for (const path of paths) {
      if (!options.hasRead(path)) {
        ctx.denyReason = formatFsNotObservedContent(path);
        ctx.denyError = fsNotObservedDenyError();
        return "deny";
      }
    }
    return "allow";
  };
}

export function extractPathArg(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const p = (args as { path?: unknown }).path;
  return typeof p === "string" ? p : undefined;
}

/**
 * Paths that write-intent must have observed.
 * `undefined` → missing args; empty array → nothing to observe (add-only patch).
 */
export function extractWritePaths(
  toolName: string,
  args: unknown,
): string[] | undefined {
  if (toolName === "apply_patch") {
    if (!args || typeof args !== "object") return undefined;
    const patch = (args as { patch?: unknown }).patch;
    if (typeof patch !== "string" || !patch.trim()) return undefined;
    return extractPatchObservedPaths(patch);
  }
  const path = extractPathArg(args);
  return path === undefined ? undefined : [path];
}

/** Update/Delete paths from a Codex patch (Add File does not require a prior read). */
export function extractPatchObservedPaths(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("*** Update File: ")) {
      const p = trimmed.slice("*** Update File: ".length).trim();
      if (p) out.push(p);
    } else if (trimmed.startsWith("*** Delete File: ")) {
      const p = trimmed.slice("*** Delete File: ".length).trim();
      if (p) out.push(p);
    }
  }
  return out;
}

/** In-memory read tracker for write-intent tests / minimal preset. */
export function createReadTracker(): {
  markRead: (path: string) => void;
  hasRead: (path: string) => boolean;
  asGuardHook: (ctx: ToolPipelineContext) => void;
} {
  const reads = new Set<string>();
  return {
    markRead(path) {
      reads.add(path);
    },
    hasRead(path) {
      return reads.has(path);
    },
    asGuardHook(ctx) {
      if (ctx.call.name === "read_file" && !ctx.skippedBody && ctx.result && !ctx.result.isError) {
        const path = extractPathArg(ctx.args);
        if (path) reads.add(path);
      }
    },
  };
}
