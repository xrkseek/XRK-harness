/**
 * OpenCode free-lane v2 fingerprint (OFM / upstream.js aligned).
 *
 * Gate facts (OFM live-verified):
 *   - UA must be exact `opencode/latest/2.0.26/cli`
 *   - `read` + `shell` defs must match the official CLI byte-for-byte
 *   - shell description is **Linux bash** (not Windows pwsh)
 *   - do **not** paste a copied OC persona; append `<env>` + placeholder note
 *   - `tool_choice: none` → 403 FreeTierError
 *
 * Model roster lives in `free-models.mjs`.
 */
import { FREE_MODELS as FREE_MODELS_SHARED } from "./free-models.mjs";

export const FINGERPRINT_REVIEWED = "2026-10-31-ofm";

/** Client UA the v2 gate fingerprints (OFM `CLIENT_UA`). */
export const CLIENT_UA = "opencode/latest/2.0.26/cli";

/** Lane current free-model candidates (source: `free-models.mjs`). */
export const FREE_MODELS: readonly string[] = FREE_MODELS_SHARED;

/** OFM `FINGERPRINT_TOOL_DEFINITIONS.read` — verbatim. */
export const READ_TOOL: Record<string, unknown> = {
  type: "function",
  function: {
    name: "read",
    description:
      "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory to read" },
        offset: {
          type: "integer",
          minimum: 0,
          description:
            "The line or directory entry to start reading from (1-based)",
        },
        limit: {
          type: "integer",
          minimum: 0,
          description:
            "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: false,
  },
};

/** OFM `FINGERPRINT_TOOL_DEFINITIONS.shell` — Linux bash, verbatim. */
export const SHELL_TOOL: Record<string, unknown> = {
  type: "function",
  function: {
    name: "shell",
    description:
      "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command string to execute",
        },
        workdir: {
          type: "string",
          description:
            "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
        },
        timeout: {
          type: "integer",
          minimum: 0,
          description:
            "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
        },
        background: {
          type: "boolean",
          description:
            "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    strict: false,
  },
};

/** OFM placeholder note when gate tools are injected. */
export const PLACEHOLDER_NOTE =
  "Do not call the `read` or `shell` tools; they are placeholders that do nothing. Use the other tools you have been given instead.";

export const FINGERPRINT = {
  reviewed: FINGERPRINT_REVIEWED,
  models: FREE_MODELS,
  clientUa: CLIENT_UA,
  readTool: READ_TOOL,
  shellTool: SHELL_TOOL,
  placeholderNote: PLACEHOLDER_NOTE,
} as const;
