/**
 * Short tool-routing rules for the model (DSH / Codex progressive disclosure).
 * Keep terse — this is injected every turn.
 *
 * Sections omit lines for tools absent from the available set (agent restriction /
 * catalog filter / subagent tool filter). Empty when no related tools remain.
 */

export type ToolNameSet = ReadonlySet<string> | Iterable<string>;

function asSet(available: ToolNameSet): ReadonlySet<string> {
  return available instanceof Set ? available : new Set(available);
}

/** File-tool routing; empty when none of the fs tools are available. */
export function formatFsRoutingPrompt(available: ToolNameSet): string {
  const names = asSet(available);
  const lines: string[] = [];
  if (names.has("glob") || names.has("grep")) {
    lines.push("- Discover: prefer `glob` / `grep` over shell find/rg/ls.");
  }
  if (names.has("read_file")) {
    lines.push(
      "- Inspect: prefer `read_file` (use offset/limit on large files) over cat/head/sed.",
    );
  }
  if (names.has("apply_edit") || names.has("write_file")) {
    lines.push(
      "- Edit: prefer `apply_edit` with a unique snippet; use `write_file` only to create or fully replace.",
    );
  }
  if (
    names.has("read_file") &&
    (names.has("apply_edit") || names.has("write_file"))
  ) {
    lines.push(
      "- Read a path in this turn before `apply_edit` / `write_file` (write-intent).",
    );
  }
  if (
    names.has("glob") ||
    names.has("grep") ||
    names.has("read_file") ||
    names.has("apply_edit") ||
    names.has("write_file")
  ) {
    lines.push(
      "- Paths may be workspace-relative or absolute under the workspace root.",
    );
  }
  if (lines.length === 0) return "";
  return ["File tools:", ...lines].join("\n");
}

/** Shell / PTY / jobs routing; empty when none of those tools are available. */
export function formatShellRoutingPrompt(available: ToolNameSet): string {
  const names = asSet(available);
  const lines: string[] = [];
  if (names.has("bash")) {
    lines.push(
      "- `bash` runs in the session workspace cwd by default (pwd should be the workspace).",
    );
    lines.push(
      "- Use `bash` for builds, git, package managers, and one-shot commands.",
    );
  }
  const hasTerminal =
    names.has("terminal_open") ||
    names.has("terminal_send") ||
    names.has("terminal_read") ||
    names.has("terminal_list") ||
    names.has("terminal_close") ||
    names.has("terminal_signal");
  if (hasTerminal) {
    lines.push(
      "- Use `terminal_*` only when you need a persistent interactive shell.",
    );
  }
  if (
    names.has("bash") &&
    (names.has("job_list") ||
      names.has("job_output") ||
      names.has("job_kill"))
  ) {
    lines.push(
      "- Background work: `bash` with background=true, then `job_list` / `job_output` / `job_kill`.",
    );
  }
  if (lines.length === 0) return "";
  return ["Shell / terminal:", ...lines].join("\n");
}

/** Full-surface defaults (all fs tools present). */
export const FS_ROUTING_PROMPT_TEXT = formatFsRoutingPrompt([
  "glob",
  "grep",
  "read_file",
  "apply_edit",
  "write_file",
]);

/** Full-surface defaults (bash + terminal + jobs). */
export const SHELL_ROUTING_PROMPT_TEXT = formatShellRoutingPrompt([
  "bash",
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_list",
  "terminal_close",
  "terminal_signal",
  "job_list",
  "job_output",
  "job_kill",
]);
