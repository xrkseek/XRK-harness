/**
 * Short tool-routing rules for the model (injected every turn).
 * Prefer / why only — parameter enums stay on the tools.
 */

export type ToolNameSet = ReadonlySet<string> | Iterable<string>;

function asSet(available: ToolNameSet): ReadonlySet<string> {
  return available instanceof Set ? available : new Set(available);
}

/** File-tool routing; empty when none of the fs tools are available. */
export function formatFsRoutingPrompt(available: ToolNameSet): string {
  const names = asSet(available);
  const bits: string[] = [];
  if (names.has("glob") || names.has("grep")) {
    bits.push("discover=`glob`/`grep` (not find/rg/ls)");
  }
  if (names.has("read_file")) {
    bits.push(
      "`read_file` over cat (offset/limit; uploads=`sha256:`/`attachment:sha256:`)",
    );
  }
  if (names.has("read_image")) {
    bits.push(
      "`read_image` for PNG/JPEG/WebP/GIF or `sha256:` — text-only routes soft-guide, no pixels",
    );
  }
  if (names.has("apply_edit") || names.has("write_file") || names.has("apply_patch")) {
    bits.push(
      "edit=`apply_edit` unique · `apply_patch` multi · `write_file` create/replace " +
        "(keep write_file bodies small; max-tokens drops unfinished calls)",
    );
  }
  if (
    names.has("read_file") &&
    (names.has("apply_edit") ||
      names.has("write_file") ||
      names.has("apply_patch"))
  ) {
    bits.push("read path this turn before write-intent");
  }
  if (names.has("present")) {
    bits.push("`present` user-facing paths before final reply");
  }
  if (bits.length === 0) return "";
  const pathGate = names.has("read_file")
    ? "paths workspace-relative; absolute ok when path open / host-readable (`grep`/`glob` same gate)"
    : "paths workspace-relative; absolute ok when path open / host-readable";
  return `File tools: ${bits.join("; ")}. ${pathGate}.`;
}

/** Shell / terminal / jobs routing; empty when none of those tools are available. */
export function formatShellRoutingPrompt(available: ToolNameSet): string {
  const names = asSet(available);
  const bits: string[] = [];
  if (names.has("bash")) {
    bits.push(
      "`bash` in workspace (confine off when path open) for builds/git/pkg one-shots",
    );
    bits.push(
      "screenshots/downloads → workspace then `read_image`/`present` (not Desktop/Host cwd)",
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
    bits.push("`terminal_*` only for persistent interactive shells");
  }
  if (
    names.has("bash") &&
    (names.has("job_list") ||
      names.has("job_output") ||
      names.has("job_kill"))
  ) {
    bits.push(
      "background=`bash` background=true → track job ids; Host notifies on finish — no busy-poll; before final `job_output` (wait:true only if blocked) / `job_kill` unused",
    );
  }
  if (bits.length === 0) return "";
  return `Shell: ${bits.join("; ")}.`;
}

/** Full-surface defaults (all fs tools present). */
export const FS_ROUTING_PROMPT_TEXT = formatFsRoutingPrompt([
  "glob",
  "grep",
  "read_file",
  "apply_edit",
  "apply_patch",
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
