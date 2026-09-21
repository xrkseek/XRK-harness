import type { PreHandler } from "@xrkseek/core-tools";

/** Tools that mutate the workspace / run arbitrary code. */
export const READ_ONLY_DENIED_TOOLS = new Set([
  "apply_edit",
  "write_file",
  "bash",
  "job_kill",
  "run_code",
  "terminal_open",
  "terminal_send",
  "terminal_signal",
  "terminal_close",
]);

/** Pre-execute: deny write/shell tools under `sandbox/mode: read-only`. */
export function createReadOnlyToolPre(
  denyNames: ReadonlySet<string> = READ_ONLY_DENIED_TOOLS,
): PreHandler {
  return (ctx) => {
    if (!denyNames.has(ctx.call.name)) {
      return { action: "continue", args: ctx.args };
    }
    return {
      action: "deny",
      reason: `permission: read-only denies ${ctx.call.name}`,
    };
  };
}

/**
 * Live sandbox gate: re-reads mode on every tool call so `/permission` /
 * Settings live defaultPreset take effect without relying solely on agent
 * rebuild timing (stale create-time `createReadOnlyToolPre` kept asking /
 * denying against the wrong preset).
 */
export function createSessionReadOnlyToolPre(
  isReadOnly: () => boolean,
  denyNames: ReadonlySet<string> = READ_ONLY_DENIED_TOOLS,
): PreHandler {
  const staticDeny = createReadOnlyToolPre(denyNames);
  return (ctx) => {
    if (!isReadOnly()) return { action: "continue", args: ctx.args };
    return staticDeny(ctx);
  };
}
