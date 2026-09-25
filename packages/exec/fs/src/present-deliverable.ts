import type { ToolDefinition, ToolExecuteExtras } from "@xrkseek/core-tools";
import type { FsService } from "./index.js";

/**
 * Per-call delivery limit, aligned with DSH `tool-present` (default 8).
 */
export const PRESENT_MAX_FILES = 8;

export interface PresentFileArg {
  readonly path: string;
  readonly description?: string;
}

export interface PresentToolOptions {
  /** Maximum files per call. Must be a positive safe integer. */
  readonly maxFiles?: number;
}

/**
 * `present` — model-declared final deliverables (DSH `tool-present`).
 *
 * Declares existing files as outputs the user asked to receive. Unlike the
 * turn-end `workspace/changes` diff capture (which only sees write/edit/patch
 * paths), `present` lets the model declare files created through shell /
 * scripts / downloads as deliverables. Renders through the same produced-files
 * card as diffs (`producedPaths` reads the edit-kind call locations).
 */
export function createPresentTool(
  fs: FsService,
  options: PresentToolOptions = {},
): ToolDefinition {
  const maxFiles = options.maxFiles ?? PRESENT_MAX_FILES;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new Error("present requires a positive integer maxFiles");
  }
  return {
    name: "present",
    description:
      "Declare existing files as final deliverables the user asked to receive. " +
      "When a file you create or update is an output the user asked for — including files created " +
      "through Bash, scripts, or downloads — call present after writing it and before your final response. " +
      "Mentioning the path in your reply does not replace this call. The files must already exist. " +
      "Relative paths resolve against the workspace root; absolute paths may name files under the " +
      "workspace root or Host-readable roots. Their contents are not copied; the user opens the current source files.",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          maxItems: maxFiles,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              description: { type: "string" },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
    },
    async execute(args, _signal, extras?: ToolExecuteExtras) {
      const a = args as { files?: PresentFileArg[] };
      const files = a.files ?? [];
      if (files.length === 0) {
        return { content: "present requires at least one file", isError: true };
      }
      if (files.length > maxFiles) {
        return {
          content: `present accepts at most ${maxFiles} files per call`,
          isError: true,
        };
      }
      const declared: { path: string; description?: string }[] = [];
      for (const file of files) {
        const p = String(file.path ?? "");
        if (!p.trim()) {
          return { content: "present requires a non-empty path", isError: true };
        }
        try {
          const st = await fs.stat(p);
          if (!st.isFile) {
            return {
              content: `present: not a regular file: ${p}`,
              isError: true,
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: `present: cannot access ${p}: ${message}`, isError: true };
        }
        const description =
          typeof file.description === "string" && file.description.trim()
            ? file.description.trim()
            : undefined;
        declared.push(description === undefined ? { path: p } : { path: p, description });
      }
      if (extras) {
        extras.emitToolEvent("deliverables/presented", { files: declared });
      }
      const lines = declared.map((file) => {
        const desc = file.description ? ` (${file.description})` : "";
        return `presented ${file.path}${desc}`;
      });
      return { content: lines.join("\n") };
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => {
      const entries = (args as { files?: PresentFileArg[] }).files ?? [];
      return {
        card: "generic" as const,
        title: "Present delivered files",
        kind: "edit" as const,
        rawInput: entries,
        locations: entries
          .filter((entry) => typeof entry.path === "string" && entry.path.trim())
          .map((entry) => ({ path: entry.path })),
      };
    },
  };
}