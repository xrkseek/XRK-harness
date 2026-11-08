/**
 * Short tool-routing rules for the model (injected every turn).
 * Human sentences; omit lines for tools not in the available set.
 * Empty when no related tools remain.
 *
 * Copy standard: say what to prefer and why; leave parameter enums on the tools.
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
    lines.push("- Discover files with `glob` / `grep` instead of shell find/rg/ls.");
  }
  if (names.has("read_file")) {
    lines.push(
      "- Prefer `read_file` over cat/head/sed (use offset/limit on large files). Uploaded files use `sha256:…` / `attachment:sha256:…` — do not hunt the disk for them.",
    );
  }
  if (names.has("read_image")) {
    lines.push(
      "- Images: `read_image` for workspace PNG/JPEG/WebP/GIF paths, or `sha256:…` / `attachment:sha256:…` from `image_generate`. On a text-only model it returns the path/id plus guidance (OCR, ask the user, or switch to vision) — it does not error, and pixels stay off the wire.",
    );
  }
  if (names.has("apply_edit") || names.has("write_file") || names.has("apply_patch")) {
    lines.push(
      "- Prefer `apply_edit` for a unique snippet, `apply_patch` for multi-file or structured hunks, and `write_file` only to create or fully replace a file.",
    );
  }
  if (
    names.has("read_file") &&
    (names.has("apply_edit") ||
      names.has("write_file") ||
      names.has("apply_patch"))
  ) {
    lines.push(
      "- Read a path in this turn before `apply_edit` / `write_file` / `apply_patch` Update|Delete (write-intent).",
    );
  }
  if (names.has("present")) {
    lines.push(
      "- After creating user-facing files (including via bash), call `present` with their paths before the final reply.",
    );
  }
  if (
    names.has("glob") ||
    names.has("grep") ||
    names.has("read_file") ||
    names.has("read_image") ||
    names.has("apply_edit") ||
    names.has("write_file") ||
    names.has("apply_patch") ||
    names.has("present")
  ) {
    lines.push(
      names.has("read_file")
        ? "- Paths are workspace-relative by default. Absolute paths are allowed when path access is open (full access / auto) or under host-readable roots — `grep` / `glob` share the same gate as `read_file`."
        : "- Paths are workspace-relative by default. Absolute paths are allowed when path access is open (full access / auto) or under host-readable roots.",
    );
  }
  if (lines.length === 0) return "";
  return ["File tools:", ...lines].join("\n");
}

/** Shell / terminal / jobs routing; empty when none of those tools are available. */
export function formatShellRoutingPrompt(available: ToolNameSet): string {
  const names = asSet(available);
  const lines: string[] = [];
  if (names.has("bash")) {
    lines.push(
      "- `bash` starts in the session workspace. When path access is open, shell confine is off (Sandbox Provider idle); when allowlisted, confine stays on through that Provider.",
    );
    lines.push(
      "- Use `bash` for builds, git, package managers, and other one-shot commands.",
    );
    lines.push(
      "- Write tool screenshots/downloads under the workspace (or an absolute path you control), then `read_image` / `present` — not the Desktop or Host cwd.",
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
      "- Use `terminal_*` only when you need a persistent interactive shell across tool calls.",
    );
  }
  if (
    names.has("bash") &&
    (names.has("job_list") ||
      names.has("job_output") ||
      names.has("job_kill"))
  ) {
    lines.push(
      "- For background work: `bash` with background=true, then `job_list` / `job_output` / `job_kill`.",
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
