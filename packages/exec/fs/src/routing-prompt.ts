/**
 * Short tool-routing rules for the model (DSH / Codex progressive disclosure).
 * Keep terse — this is injected every turn.
 */

export const FS_ROUTING_PROMPT_TEXT = [
  "File tools:",
  "- Discover: prefer `glob` / `grep` over shell find/rg/ls.",
  "- Inspect: prefer `read_file` (use offset/limit on large files) over cat/head/sed.",
  "- Edit: prefer `apply_edit` with a unique snippet; use `write_file` only to create or fully replace.",
  "- Read a path in this turn before `apply_edit` / `write_file` (write-intent).",
  "- Paths may be workspace-relative or absolute under the workspace root.",
].join("\n");

export const SHELL_ROUTING_PROMPT_TEXT = [
  "Shell / terminal:",
  "- `bash` runs in the session workspace cwd by default (pwd should be the workspace).",
  "- Use `bash` for builds, git, package managers, and one-shot commands.",
  "- Use `terminal_*` only when you need a persistent interactive shell.",
  "- Background work: `bash` with background=true, then `job_list` / `job_output` / `job_kill`.",
].join("\n");
