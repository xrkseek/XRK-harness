/**
 * Model tools for session working directory and optional create_worktree.
 * Host / Face supply get/set/create via closures (per-session composition).
 */
import type { ToolDefinition } from "./definition.js";

export const WORKING_DIRECTORY = "working_directory";
export const CREATE_WORKTREE = "create_worktree";

export interface WorkingDirectoryToolsOptions {
  get: () => string;
  set: (
    cd: string,
  ) => Promise<
    | { readonly ok: true; readonly cwd: string; readonly changed: boolean }
    | { readonly ok: false; readonly error: string }
  >;
}

export interface CreateWorktreeToolsOptions {
  create: (request: {
    readonly name?: string;
    readonly from?: string;
  }) => Promise<
    | {
        readonly ok: true;
        readonly path: string;
        readonly branch: string;
        readonly baseCommit: string;
        readonly repositoryRoot: string;
        readonly cwd: string;
      }
    | { readonly ok: false; readonly error: string }
  >;
}

/** Read `{}` or change `{ cd }` the Session's current working directory. */
export function createWorkingDirectoryTool(
  options: WorkingDirectoryToolsOptions,
): ToolDefinition {
  return {
    name: WORKING_DIRECTORY,
    description:
      "Read the Session's current working directory or enter an existing directory. " +
      "Omit cd to read; pass cd (absolute or relative to the current directory) to change. " +
      "Returns the absolute cwd. Leaving a git worktree uses this tool; the checkout is retained.",
    parameters: {
      type: "object",
      properties: {
        cd: {
          type: "string",
          description:
            "Directory to enter (absolute or relative). Omit to only read the current cwd.",
        },
      },
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title:
        typeof (args as { cd?: string }).cd === "string" &&
        (args as { cd?: string }).cd!.trim()
          ? `cd ${(args as { cd: string }).cd}`
          : "pwd",
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: "Working directory",
      content: [{ type: "text" as const, text: result.content }],
    }),
    async execute(args) {
      const cdRaw = (args as { cd?: unknown }).cd;
      if (cdRaw === undefined || cdRaw === null || cdRaw === "") {
        return { content: JSON.stringify({ cwd: options.get() }) };
      }
      if (typeof cdRaw !== "string") {
        return { content: "cd must be a string", isError: true };
      }
      const out = await options.set(cdRaw);
      if (!out.ok) return { content: out.error, isError: true };
      return {
        content: JSON.stringify({ cwd: out.cwd, changed: out.changed }),
      };
    },
  };
}

/** Create a git worktree under `.xrk/worktrees/<name>` and enter it. */
export function createCreateWorktreeTool(
  options: CreateWorktreeToolsOptions,
): ToolDefinition {
  return {
    name: CREATE_WORKTREE,
    description:
      "Create a new Git branch and linked worktree checkout, then enter it as the Session working directory. " +
      "Optional name (new branch) and from (local revision; default HEAD). " +
      "Uncommitted files stay in the source checkout. Leave with working_directory({ cd }); the checkout is retained.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "New branch name and relative checkout directory under .xrk/worktrees/. Omission generates a name.",
        },
        from: {
          type: "string",
          description:
            "Local commit, branch, or tag to pin before creation. Omission selects HEAD.",
        },
      },
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: `create_worktree${
        typeof (args as { name?: string }).name === "string" &&
        (args as { name?: string }).name!.trim()
          ? `: ${(args as { name: string }).name}`
          : ""
      }`,
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: "Worktree",
      content: [{ type: "text" as const, text: result.content }],
    }),
    async execute(args) {
      const a = args as { name?: unknown; from?: unknown };
      const name =
        typeof a.name === "string" && a.name.trim() ? a.name.trim() : undefined;
      const from =
        typeof a.from === "string" && a.from.trim() ? a.from.trim() : undefined;
      const out = await options.create({
        ...(name !== undefined ? { name } : {}),
        ...(from !== undefined ? { from } : {}),
      });
      if (!out.ok) return { content: out.error, isError: true };
      return {
        content: JSON.stringify({
          path: out.path,
          branch: out.branch,
          baseCommit: out.baseCommit,
          repositoryRoot: out.repositoryRoot,
          cwd: out.cwd,
        }),
      };
    },
  };
}
