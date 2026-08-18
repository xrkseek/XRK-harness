import type { PreHandler } from "@xrkseek/core-tools";

/** Tools that mutate the workspace / run arbitrary code. */
export const READ_ONLY_DENIED_TOOLS = new Set([
  "apply_edit",
  "write_file",
  "bash",
  "bash_jobs",
  "bash_kill",
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
