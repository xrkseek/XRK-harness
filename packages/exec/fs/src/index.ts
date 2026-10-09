import {
  mkdir,
  open as fsOpen,
  readFile as fsReadFile,
  rm,
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
import { isDocumentExtractPath, textFromReadBuffer } from "./document-extract.js";
import { formatReadWindow } from "./read-window.js";
import {
  PathEscapeError,
  resolveOpenPath,
  resolveUnderHostRoots,
  resolveWritablePath,
  resolveWithinRoot,
} from "./paths.js";
import type { PathAccessMode } from "@xrkseek/protocol";
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
  presentPatchCall,
  presentPatchResult,
  presentReadCall,
  presentReadResult,
  presentWriteCall,
  presentWriteResult,
} from "./present.js";
import { applyPatchToFs } from "./apply-patch.js";
import { PatchParseError } from "./apply-patch-parser.js";
import { ApplyPatchError } from "./apply-patch-apply.js";
import { createPresentTool } from "./present-deliverable.js";

export {
  PathEscapeError,
  isLexicallyInside,
  resolveOpenPath,
  resolveUnderHostRoots,
  resolveWritablePath,
  resolveWithinRoot,
} from "./paths.js";
export {
  PATH_OVERREACH_REASON_PREFIX,
  createPathOverreachPre,
  type PathOverreachPreOptions,
} from "./path-overreach-pre.js";
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
  DOCUMENT_EXTRACT_MAX_BYTES,
  extractDocumentText,
  isDocumentExtractPath,
  textFromReadBuffer,
} from "./document-extract.js";
export {
  FS_ROUTING_PROMPT_TEXT,
  SHELL_ROUTING_PROMPT_TEXT,
  formatFsRoutingPrompt,
  formatShellRoutingPrompt,
  type ToolNameSet as FsRoutingToolNameSet,
} from "./routing-prompt.js";
export {
  createReadImageTool,
  formatImageReadOutput,
  imageMediaTypeForPath,
  parseAttachmentFilePath,
  type CreateReadImageToolOptions,
  type ImageReadValue,
  type ReadImageFs,
} from "./read-image.js";
export {
  FS_GREP_MAX_FILE_BYTES,
  FS_SEARCH_SKIP_DIR_NAMES,
  FS_SEARCH_WALK_CAP,
  forEachLine,
  globToRegExp,
  globWalkUnderRoot,
  grepWalkUnderRoot,
  matchGlob,
  type FsGlobOptions,
  type FsGrepHit,
  type FsGrepOptions,
} from "./search.js";
export {
  FS_GLOB_HEAVY_EXCLUDES,
  FS_GLOB_VCS_EXCLUDES,
  FS_SEARCH_RAW_OUTPUT_MAX_BYTES,
  FS_SEARCH_TIMEOUT_MS,
  RipgrepUnavailableError,
  buildGlobCommand,
  buildGrepCommand,
  clearRgPathCache,
  parseGrepJsonRecord,
  parseGrepMatches,
  preferJsSearch,
  resolveRgPath,
} from "./ripgrep.js";
export {
  langFromPath,
  presentEditCall,
  presentEditResult,
  presentGlobCall,
  presentGlobResult,
  presentGrepCall,
  presentGrepResult,
  presentPatchCall,
  presentPatchResult,
  presentReadCall,
  presentReadResult,
  presentWriteCall,
  presentWriteResult,
} from "./present.js";
export {
  parsePatch,
  patchPathsRequiringRead,
  patchTouchedPaths,
  PatchParseError,
  type PatchHunk,
  type ParsedPatch,
  type UpdateFileChunk,
} from "./apply-patch-parser.js";
export {
  applyPatchToFs,
  type ApplyPatchResult,
} from "./apply-patch.js";
export {
  ApplyPatchError,
  deriveUpdatedContents,
  planPatchApplication,
  seekSequence,
} from "./apply-patch-apply.js";
export {
  createPresentTool,
  PRESENT_MAX_FILES,
  type PresentFileArg,
  type PresentToolOptions,
} from "./present-deliverable.js";

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
  /** Remove a file (not a directory). Used by `apply_patch` Delete/Move. */
  remove(userPath: string): Promise<void>;
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
  /**
   * Absolute directories whose files may be WRITTEN by absolute path, in
   * addition to `root` (Settings `permission.extraWritableRoots`). Relative
   * paths always resolve under `root`. Symlink escape denied.
   * Ignored when `pathAccessMode` is `open` or `jailed`.
   */
  readonly extraWritableRoots?: readonly string[];
  /**
   * Absolute host directories whose files may be read by absolute path
   * (`hostReadableRoots`). Host default is product home (`{XRK_HOME}`).
   * Containment is lexical + realpath (symlink escape denied).
   * Ignored when `pathAccessMode` is `open`.
   */
  readonly hostReadableRoots?: readonly string[];
  /**
   * Path gate. Default `allowlisted` (workspace + extra/host roots).
   * `open` skips the jail (danger-full-access / Auto).
   */
  readonly pathAccessMode?: PathAccessMode;
  /**
   * Live session object-path allowlist (Once / Whitelist overreach grants).
   * Merged into readable + writable roots on every resolve.
   */
  readonly readSessionPathAllowlist?: () => readonly string[];
}

function resolveReadablePath(
  root: string,
  hostReadableRoots: readonly string[],
  writableRoots: readonly string[],
  userPath: string,
  mode: PathAccessMode,
): string {
  if (mode === "open") return resolveOpenPath(root, userPath);
  try {
    return resolveWithinRoot(root, userPath);
  } catch (error) {
    if (!(error instanceof PathEscapeError) || !path.isAbsolute(userPath)) {
      throw error;
    }
    if (mode === "jailed") throw error;
    // A configured extra writable root is readable too — the user granted the
    // agent that directory for file work; denying the read-back would make it
    // write-only and useless. Containment is the same lexical + realpath gate.
    const readableRoots = [...hostReadableRoots, ...writableRoots];
    if (readableRoots.length === 0) throw error;
    try {
      return resolveUnderHostRoots(readableRoots, userPath);
    } catch {
      throw error;
    }
  }
}

function resolveWritePath(
  root: string,
  extraWritableRoots: readonly string[],
  userPath: string,
  mode: PathAccessMode,
): string {
  if (mode === "open") return resolveOpenPath(root, userPath);
  if (mode === "jailed") return resolveWithinRoot(root, userPath);
  return resolveWritablePath(root, extraWritableRoots, userPath);
}

/** Provider — local disk bound to workspace root. */
export function createFsLocalProvider(options: FsLocalOptions): FsService {
  const root = path.resolve(options.root);
  const pathAccessMode = options.pathAccessMode ?? "allowlisted";
  const extraWritableRoots = (options.extraWritableRoots ?? []).map((r) =>
    path.resolve(r),
  );
  const hostReadableRoots = (options.hostReadableRoots ?? []).map((r) =>
    path.resolve(r),
  );
  const defaultMaxBytes = options.defaultMaxBytes ?? 512_000;
  const intentHandlers = new Set<FsIntentHandler>();

  const emit = (
    kind: "fs/read-intent" | "fs/write-intent",
    userPath: string,
  ) => {
    for (const h of intentHandlers) h(kind, userPath);
  };

  const sessionRoots = (): readonly string[] =>
    (options.readSessionPathAllowlist?.() ?? []).map((r) => path.resolve(r));

  const readPath = (userPath: string) =>
    resolveReadablePath(
      root,
      hostReadableRoots,
      [...extraWritableRoots, ...sessionRoots()],
      userPath,
      pathAccessMode,
    );
  const writePath = (userPath: string) =>
    resolveWritePath(
      root,
      [...extraWritableRoots, ...sessionRoots()],
      userPath,
      pathAccessMode,
    );

  return {
    root,
    resolvePath(userPath) {
      return readPath(userPath);
    },
    async read(userPath, maxBytes = defaultMaxBytes) {
      emit("fs/read-intent", userPath);
      const abs = readPath(userPath);
      // Office/notebook extractors need the whole package; plain text reads
      // only the leading maxBytes so a multi-MB source file cannot stall Host.
      if (isDocumentExtractPath(userPath)) {
        const buf = await fsReadFile(abs);
        return textFromReadBuffer(buf, userPath, maxBytes);
      }
      const fh = await fsOpen(abs, "r");
      try {
        const st = await fh.stat();
        if (st.size === 0) return { content: "" };
        const want = Math.min(st.size, maxBytes);
        const buf = Buffer.allocUnsafe(want);
        const { bytesRead } = await fh.read(buf, 0, want, 0);
        const slice = buf.subarray(0, bytesRead);
        const out = textFromReadBuffer(slice, userPath, maxBytes);
        if (st.size > maxBytes) {
          return { content: out.content, truncated: true };
        }
        return out;
      } finally {
        await fh.close();
      }
    },
    async readBytes(userPath, maxBytes = defaultMaxBytes) {
      emit("fs/read-intent", userPath);
      const abs = readPath(userPath);
      const fh = await fsOpen(abs, "r");
      try {
        const st = await fh.stat();
        if (st.size > maxBytes) {
          throw new Error(
            `file exceeds read byte limit (${st.size} > ${maxBytes})`,
          );
        }
        if (st.size === 0) return new Uint8Array();
        const buf = Buffer.allocUnsafe(st.size);
        const { bytesRead } = await fh.read(buf, 0, st.size, 0);
        return new Uint8Array(buf.subarray(0, bytesRead));
      } finally {
        await fh.close();
      }
    },
    async write(userPath, content) {
      emit("fs/write-intent", userPath);
      const abs = writePath(userPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    },
    async edit(userPath, oldContent, newContent, options) {
      if (oldContent === undefined || oldContent === null) {
        throw new EditWithoutOldError("edit requires oldContent");
      }
      emit("fs/write-intent", userPath);
      const abs = writePath(userPath);
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
    async remove(userPath) {
      emit("fs/write-intent", userPath);
      const abs = writePath(userPath);
      const st = await fsStat(abs);
      if (st.isDirectory()) {
        throw new Error(`cannot delete directory via apply_patch: ${userPath}`);
      }
      await rm(abs);
    },
    async stat(userPath) {
      const abs = readPath(userPath);
      const st = await fsStat(abs);
      return {
        size: st.size,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
      };
    },
    async mkdir(userPath) {
      emit("fs/write-intent", userPath);
      const abs = writePath(userPath);
      await mkdir(abs, { recursive: true });
    },
    async glob(pattern, options) {
      return globUnderRoot(root, pattern, options);
    },
    async grep(pattern, options) {
      return grepUnderRoot(root, pattern, options);
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
        "Read a UTF-8 file with 1-based line numbers (`N|line`). " +
        "PDF, DOCX, XLSX, and ipynb are converted to text inside this tool. " +
        "Use offset/limit for large files. Path may be workspace-relative, " +
        "absolute under the workspace, or absolute under host-readable roots " +
        "(product home `{XRK_HOME}` by default — spill, attachments, memories).",
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
        "Create or fully overwrite a UTF-8 file. Read the path in this turn first (write-intent). " +
        "Workspace-relative paths stay under the workspace; absolute paths may use " +
        "Settings → Permissions → extra writable roots (defaults include product home).",
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
        "Copy old_content verbatim from the file (exact indentation, no elided lines) — " +
        "if you did not just read that exact text in this turn, read the file first. " +
        "Use replace_all when the snippet appears more than once; prefer write_file for whole-file overwrite. " +
        "Absolute paths may use Settings → Permissions → extra writable roots (defaults include product home).",
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
            throw new EditWithoutOldError(
              "old_content is required: pass the exact text to replace (copy it verbatim from the file you read, including indentation).",
            );
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
      name: "apply_patch",
      description:
        "Apply a multi-file Codex-format patch (`*** Begin Patch` … `*** End Patch`). " +
        "Use for large or multi-file edits; `apply_edit` for a single unique snippet. " +
        "Update/Delete paths must be read in this turn first (write-intent). " +
        "Absolute paths may use Settings → Permissions → extra writable roots (defaults include product home).",
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description:
              "Full patch text beginning with *** Begin Patch and ending with *** End Patch.",
          },
        },
        required: ["patch"],
      },
      async execute(args) {
        const patch = String(
          (args as { patch?: string })?.patch ?? "",
        ).trim();
        if (!patch) {
          return {
            content: "Error: patch must be a non-empty string",
            isError: true,
          };
        }
        try {
          const result = await applyPatchToFs(fs, patch);
          const summary = result.ops
            .map((op) =>
              op.action === "move"
                ? `move ${op.fromPath} → ${op.path}`
                : `${op.action} ${op.path}`,
            )
            .join("\n");
          return {
            content: `applied ${result.hunkCount} hunk(s)\n${summary}`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const code =
            err instanceof PatchParseError
              ? "APPLY_PATCH_PARSE"
              : err instanceof ApplyPatchError
                ? "APPLY_PATCH_APPLY"
                : "APPLY_PATCH";
          return {
            content: `Error: ${message}`,
            isError: true,
            error: { name: "ApplyPatchError", code },
            meta: { code },
          };
        }
      },
      presentCall: presentPatchCall,
      presentResult: presentPatchResult,
    },
    {
      name: "glob",
      description:
        "List workspace-relative paths matching a glob (ripgrep --files, mtime order). " +
        "Respects .gitignore; skips node_modules/dist/VCS. " +
        "`*.ts` matches basenames; use `**/*.ts` or a path prefix to scope.",
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
        "Search file contents with ripgrep (path:line:text). Respects .gitignore; " +
        "skips node_modules/dist/VCS. Optional path scopes a file/dir; glob filters names (e.g. **/*.ts). " +
        "Default cap ~100 hits.",
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
    createPresentTool(fs),
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
