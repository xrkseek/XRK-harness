import {
  mkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import {
  applyLiteralEdit,
  detectLineEndings,
  normalizeLineEndings,
  restoreLineEndings,
  stripCarriageReturn,
  EditAmbiguousError,
} from "./edit-text.js";
import { formatReadWindow } from "./read-window.js";
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
  applyLiteralEdit,
  detectLineEndings,
  normalizeLineEndings,
  restoreLineEndings,
  stripCarriageReturn,
  EditAmbiguousError,
  type LineEndings,
} from "./edit-text.js";
export {
  DEFAULT_READ_LINE_LIMIT,
  formatReadWindow,
} from "./read-window.js";
export {
  FS_ROUTING_PROMPT_TEXT,
  SHELL_ROUTING_PROMPT_TEXT,
} from "./routing-prompt.js";
export {
  createReadImageTool,
  formatImageReadOutput,
  imageMediaTypeForPath,
  type CreateReadImageToolOptions,
  type ImageReadValue,
  type ReadImageFs,
} from "./read-image.js";
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

export type FsEditOptions = {
  /** Replace every match (default: require a unique match). */
  readonly replaceAll?: boolean;
};

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
  /** Read raw bytes (binary files, images). */
  readBytes(userPath: string, maxBytes?: number): Promise<Uint8Array>;
  write(userPath: string, content: string): Promise<void>;
  /**
   * Literal substring replace (DSH-style): match in LF-normalized space,
   * write back preserving on-disk CRLF/LF. `oldContent` is a unique snippet
   * (or the whole file); not a full-file CAS unless the snippet is the file.
   */
  edit(
    userPath: string,
    oldContent: string,
    newContent: string,
    options?: FsEditOptions,
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
    async readBytes(userPath, maxBytes = defaultMaxBytes) {
      emit("fs/read-intent", userPath);
      const abs = resolveWithinRoot(root, userPath);
      const buf = await fsReadFile(abs);
      if (buf.byteLength > maxBytes) {
        throw new Error(
          `file exceeds read byte limit (${buf.byteLength} > ${maxBytes})`,
        );
      }
      return new Uint8Array(buf);
    },
    async write(userPath, content) {
      emit("fs/write-intent", userPath);
      const abs = resolveWithinRoot(root, userPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    },
    async edit(userPath, oldContent, newContent, options) {
      if (oldContent === undefined || oldContent === null) {
        throw new EditWithoutOldError("edit requires oldContent");
      }
      emit("fs/write-intent", userPath);
      const abs = resolveWithinRoot(root, userPath);
      const raw = await fsReadFile(abs, "utf8");
      const endings = detectLineEndings(raw);
      const currentLf = normalizeLineEndings(raw);
      try {
        const { content } = applyLiteralEdit(
          currentLf,
          String(oldContent),
          String(newContent ?? ""),
          options?.replaceAll === true,
          userPath,
        );
        await writeFile(abs, restoreLineEndings(content, endings), "utf8");
      } catch (err) {
        if (err instanceof EditAmbiguousError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("edit mismatch") || message.includes("not found")) {
          throw new EditMismatchError(message);
        }
        throw err;
      }
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
      description:
        "Read a UTF-8 file with 1-based line numbers (`N|line`). Prefer this over shell cat/head. " +
        "Use offset/limit for large files. Path may be workspace-relative or absolute under the workspace root. " +
        "Line endings are normalized to LF in the tool output.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: {
            type: "number",
            description: "1-based start line (default 1).",
          },
          limit: {
            type: "number",
            description: "Max lines to return (default 2000).",
          },
        },
        required: ["path"],
      },
      async execute(args) {
        const a = args as {
          path?: string;
          offset?: number;
          limit?: number;
        };
        const p = String(a.path ?? "");
        try {
          const out = await fs.read(p);
          const body = stripCarriageReturn(out.content);
          const windowed = formatReadWindow(body, {
            ...(typeof a.offset === "number" ? { offset: a.offset } : {}),
            ...(typeof a.limit === "number" ? { limit: a.limit } : {}),
          });
          const suffix = out.truncated ? "\n[byte-truncated]" : "";
          return { content: windowed.content + suffix };
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
      description:
        "Create or fully overwrite a UTF-8 file. Prefer `apply_edit` for surgical changes. " +
        "Read the path in this turn first (write-intent). Path may be workspace-relative or absolute under the workspace root.",
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
        "Replace a unique old_content snippet with content (literal substring edit). " +
        "Read the path in this turn first (write-intent). Paths may be workspace-relative or absolute under the workspace root. " +
        "Line endings are matched in LF space and preserved on write. Use replace_all when the snippet appears more than once. " +
        "For whole-file overwrite prefer write_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_content: { type: "string" },
          content: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_content", "content"],
      },
      async execute(args) {
        const a = args as {
          path?: string;
          old_content?: string;
          content?: string;
          replace_all?: boolean;
        };
        const p = String(a.path ?? "");
        try {
          if (a.old_content === undefined) {
            throw new EditWithoutOldError("old_content is required");
          }
          await fs.edit(p, String(a.old_content), String(a.content ?? ""), {
            replaceAll: a.replace_all === true,
          });
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
        "List workspace-relative file paths matching a glob. Prefer this over shell find/ls. " +
        "`*.ts` matches basenames at any depth; use `**/*.ts` or a path prefix for directory scoping. " +
        "Optional path scopes under a subdirectory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: {
            type: "string",
            description: "Optional subdirectory or file to scope the search (workspace-relative).",
          },
          max_results: { type: "number" },
        },
        required: ["pattern"],
      },
      async execute(args) {
        const a = args as {
          pattern?: string;
          path?: string;
          max_results?: number;
        };
        try {
          const pattern = String(a.pattern ?? "");
          const scoped =
            a.path !== undefined && String(a.path).trim().length > 0
              ? `${String(a.path).replace(/\\/g, "/").replace(/\/+$/, "")}/${pattern.replace(/^\.\//, "")}`
              : pattern;
          const files = await fs.glob(scoped, {
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
        "Search UTF-8 files with a JS RegExp (path:line:text). Prefer this over shell rg/grep. " +
        "Optional path scopes a file/dir; glob filters file names (e.g. **/*.ts). Default cap ~200 hits.",
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
