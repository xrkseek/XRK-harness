import {
  mkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import { resolveWithinRoot } from "./paths.js";
import {
  globUnderRoot,
  grepUnderRoot,
  type FsGlobOptions,
  type FsGrepHit,
  type FsGrepOptions,
} from "./search.js";
import {
  presentEditCall,
  presentEditResult,
  presentGlobCall,
  presentGlobResult,
  presentGrepCall,
  presentGrepResult,
  presentReadCall,
  presentReadResult,
  presentWriteCall,
  presentWriteResult,
} from "./present.js";

export { PathEscapeError, resolveWithinRoot } from "./paths.js";
export {
  globToRegExp,
  matchGlob,
  type FsGlobOptions,
  type FsGrepHit,
  type FsGrepOptions,
} from "./search.js";
export {
  langFromPath,
  presentEditCall,
  presentEditResult,
  presentGlobCall,
  presentGlobResult,
  presentGrepCall,
  presentGrepResult,
  presentReadCall,
  presentReadResult,
  presentWriteCall,
  presentWriteResult,
} from "./present.js";

export class EditWithoutOldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditWithoutOldError";
  }
}

export class EditMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditMismatchError";
  }
}

export interface FsReadResult {
  readonly content: string;
  readonly truncated?: boolean;
}

export interface FsStatResult {
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export type FsIntentHandler = (
  kind: "fs/read-intent" | "fs/write-intent",
  path: string,
) => void;

/** Definition — tools depend on this, not a concrete provider. */
export interface FsService {
  readonly root: string;
  resolvePath(userPath: string): string;
  read(userPath: string, maxBytes?: number): Promise<FsReadResult>;
  write(userPath: string, content: string): Promise<void>;
  /** Replace only when on-disk content matches `oldContent`. */
  edit(
    userPath: string,
    oldContent: string,
    newContent: string,
  ): Promise<void>;
  stat(userPath: string): Promise<FsStatResult>;
  mkdir(userPath: string): Promise<void>;
  /** List relative paths matching a glob (`*`, `**`). */
  glob(pattern: string, options?: FsGlobOptions): Promise<readonly string[]>;
  /** Regex search over UTF-8 text files under the workspace. */
  grep(
    pattern: string,
    options?: FsGrepOptions,
  ): Promise<readonly FsGrepHit[]>;
  onIntent(handler: FsIntentHandler): () => void;
}

export interface FsLocalOptions {
  readonly root: string;
  readonly defaultMaxBytes?: number;
}

/** Provider — local disk bound to workspace root. */
export function createFsLocalProvider(options: FsLocalOptions): FsService {
  const root = path.resolve(options.root);
  const defaultMaxBytes = options.defaultMaxBytes ?? 512_000;
  const intentHandlers = new Set<FsIntentHandler>();

  const emit = (
    kind: "fs/read-intent" | "fs/write-intent",
    userPath: string,
  ) => {
    for (const h of intentHandlers) h(kind, userPath);
  };

  return {
    root,
    resolvePath(userPath) {
      return resolveWithinRoot(root, userPath);
    },
    async read(userPath, maxBytes = defaultMaxBytes) {
      emit("fs/read-intent", userPath);
      const abs = resolveWithinRoot(root, userPath);
      const buf = await fsReadFile(abs);
      if (buf.byteLength > maxBytes) {
        return {
          content: buf.subarray(0, maxBytes).toString("utf8"),
          truncated: true,
        };
      }
      return { content: buf.toString("utf8") };
    },
    async write(userPath, content) {
      emit("fs/write-intent", userPath);
      const abs = resolveWithinRoot(root, userPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    },
    async edit(userPath, oldContent, newContent) {
      if (oldContent === undefined || oldContent === null) {
        throw new EditWithoutOldError("edit requires oldContent");
      }
      emit("fs/write-intent", userPath);
      const abs = resolveWithinRoot(root, userPath);
      const current = await fsReadFile(abs, "utf8");
      if (current !== oldContent) {
        throw new EditMismatchError(
          `edit mismatch for ${userPath}: on-disk content differs from oldContent`,
        );
      }
      await writeFile(abs, newContent, "utf8");
    },
    async stat(userPath) {
      const abs = resolveWithinRoot(root, userPath);
      const s = await fsStat(abs);
      return {
        size: s.size,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
      };
    },
    async mkdir(userPath) {
      const abs = resolveWithinRoot(root, userPath);
      await mkdir(abs, { recursive: true });
    },
    async glob(pattern, opts) {
      return globUnderRoot(root, pattern, opts);
    },
    async grep(pattern, opts) {
      return grepUnderRoot(root, pattern, opts);
    },
    onIntent(handler) {
      intentHandlers.add(handler);
      return () => {
        intentHandlers.delete(handler);
      };
    },
  };
}

/** Consumer — tools talk only to FsService. */
export function createFsTools(fs: FsService): ToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read a UTF-8 file relative to the workspace root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      async execute(args) {
        const p = String((args as { path?: string }).path ?? "");
        try {
          const out = await fs.read(p);
          const suffix = out.truncated ? "\n[truncated]" : "";
          return { content: out.content + suffix };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: presentReadCall,
      presentResult: presentReadResult,
      isConcurrencySafe: () => true,
    },
    {
      name: "write_file",
      description: "Write/create a UTF-8 file (full replace).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      async execute(args) {
        const a = args as { path?: string; content?: string };
        const p = String(a.path ?? "");
        try {
          await fs.write(p, String(a.content ?? ""));
          return { content: `wrote ${p}` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: presentWriteCall,
      presentResult: presentWriteResult,
    },
    {
      name: "apply_edit",
      description:
        "Replace file content only if old_content matches on disk.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_content: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "old_content", "content"],
      },
      async execute(args) {
        const a = args as {
          path?: string;
          old_content?: string;
          content?: string;
        };
        const p = String(a.path ?? "");
        try {
          if (a.old_content === undefined) {
            throw new EditWithoutOldError("old_content is required");
          }
          await fs.edit(p, String(a.old_content), String(a.content ?? ""));
          return { content: `edited ${p}` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: presentEditCall,
      presentResult: presentEditResult,
    },
    {
      name: "glob",
      description:
        "List workspace-relative file paths matching a glob (`*`, `**`).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          max_results: { type: "number" },
        },
        required: ["pattern"],
      },
      async execute(args) {
        const a = args as { pattern?: string; max_results?: number };
        try {
          const files = await fs.glob(String(a.pattern ?? ""), {
            ...(typeof a.max_results === "number"
              ? { maxResults: a.max_results }
              : {}),
          });
          return {
            content: files.length ? files.join("\n") : "(no matches)",
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: presentGlobCall,
      presentResult: presentGlobResult,
      isConcurrencySafe: () => true,
    },
    {
      name: "grep",
      description:
        "Search UTF-8 files with a JS RegExp. Optional path + glob filter.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string" },
          case_insensitive: { type: "boolean" },
          max_results: { type: "number" },
        },
        required: ["pattern"],
      },
      async execute(args) {
        const a = args as {
          pattern?: string;
          path?: string;
          glob?: string;
          case_insensitive?: boolean;
          max_results?: number;
        };
        try {
          const hits = await fs.grep(String(a.pattern ?? ""), {
            ...(a.path !== undefined ? { path: String(a.path) } : {}),
            ...(a.glob !== undefined ? { glob: String(a.glob) } : {}),
            ...(a.case_insensitive ? { caseInsensitive: true } : {}),
            ...(typeof a.max_results === "number"
              ? { maxResults: a.max_results }
              : {}),
          });
          if (!hits.length) return { content: "(no matches)" };
          return {
            content: hits
              .map((h) => `${h.path}:${h.line}:${h.text}`)
              .join("\n"),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: presentGrepCall,
      presentResult: presentGrepResult,
      isConcurrencySafe: () => true,
    },
  ];
}

/** @deprecated Prefer createFsLocalProvider + createFsTools(fs). */
export function createFsToolsForRoot(root: string): ToolDefinition[] {
  return createFsTools(createFsLocalProvider({ root }));
}

/** Back-compat helpers used by older tests. */
export async function readFile(
  root: string,
  userPath: string,
): Promise<string> {
  const fs = createFsLocalProvider({ root });
  const out = await fs.read(userPath);
  return out.content;
}

export async function applyEdit(
  root: string,
  userPath: string,
  content: string,
): Promise<void> {
  const fs = createFsLocalProvider({ root });
  await fs.write(userPath, content);
}
