/**
 * Packaged ripgrep backend for `glob` / `grep`.
 *
 * Provenance (adapted, not Cordis-coupled):
 * - DSH `@deepseek-ai/dsh-tool-fs-search` `search-core` / `glob` / `grep`
 *   (resolveRgPath, `--no-config`, `--files` / `--json`, VCS excludes, error codes)
 * - pi `@mariozechner/pi-coding-agent` grep (stream `--json`, kill at match limit)
 * - Codex bundled `rg` (packaged binary, no system install)
 *
 * Better than a pure JS walk on monorepos: native ignore rules, mmap search,
 * early kill at `maxResults`. Falls back only when the binary is missing.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import { resolveWithinRoot } from "./paths.js";
import type { FsGrepHit, FsGrepOptions, FsGlobOptions } from "./search.js";

/** Cooperative search budget (ms) — DSH / Claude Code default. */
export const FS_SEARCH_TIMEOUT_MS = 30_000;
/** Cap on raw `rg --files` stdout we parse — DSH `RAW_OUTPUT_MAX_BYTES`. */
export const FS_SEARCH_RAW_OUTPUT_MAX_BYTES = 20_000_000;

/** DSH `GLOB_VCS_EXCLUDES` — prune VCS stores under `--hidden`. */
export const FS_GLOB_VCS_EXCLUDES = [
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  ".jj",
  ".sl",
] as const;

/**
 * Extra prune set beyond DSH (DSH glob uses `--no-ignore` and would scrape
 * `node_modules`). We keep gitignore (pi) AND hard-exclude these basenames.
 */
export const FS_GLOB_HEAVY_EXCLUDES = [
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".idea",
  ".gradle",
  ".codegraph",
  ".scratch-opus",
  "Pods",
] as const;

export class RipgrepUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RipgrepUnavailableError";
  }
}

/** Reject reasons must be Errors; a `catch` binding is typed `unknown`. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let rgPathMemo: Promise<string> | undefined;

/** DSH `resolveRgPath` — packaged `@vscode/ripgrep`, Electron asar unpack. */
export function resolveRgPath(): Promise<string> {
  rgPathMemo ??= (async () => {
    try {
      const mod = await import("@vscode/ripgrep");
      const p = mod.rgPath;
      if (typeof p !== "string" || !p || !existsSync(p)) {
        throw new RipgrepUnavailableError("packaged ripgrep path missing on disk");
      }
      return process.versions.electron === undefined
        ? p
        : p.replace(/\.asar(?=[\\/])/u, ".asar.unpacked");
    } catch (err) {
      if (err instanceof RipgrepUnavailableError) throw err;
      throw new RipgrepUnavailableError(
        "packaged ripgrep (@vscode/ripgrep) unavailable",
        { cause: err },
      );
    }
  })();
  return rgPathMemo;
}

/** Test hook. */
export function clearRgPathCache(): void {
  rgPathMemo = undefined;
}

function excludeGlobs(names: readonly string[]): string[] {
  // DSH: bare form prunes during traversal; /** form covers root-at-dir.
  return names.flatMap((name) => [
    `--glob=!**/${name}`,
    `--glob=!**/${name}/**`,
  ]);
}

/**
 * DSH `buildGlobCommand` + heavy excludes.
 * Unlike DSH we omit `--no-ignore` (pi: respect `.gitignore`) and still prune
 * generated trees when ignore files are missing.
 */
export function buildGlobCommand(input: {
  readonly pattern: string;
  readonly path?: string;
}): string[] {
  const parts = [
    "--no-config",
    "--files",
    `--glob=${input.pattern}`,
    "--sort=modified",
    "--hidden",
    ...excludeGlobs(FS_GLOB_VCS_EXCLUDES),
    ...excludeGlobs(FS_GLOB_HEAVY_EXCLUDES),
  ];
  if (input.path !== undefined) parts.push("--", input.path);
  return parts;
}

/**
 * DSH `buildGrepCommand` (+ heavy excludes, optional `-i`).
 * Pattern / include as `--flag=value`; scope behind `--`.
 */
export function buildGrepCommand(input: {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly caseInsensitive?: boolean;
}): string[] {
  const parts = [
    "--no-config",
    "--json",
    `--regexp=${input.pattern}`,
    "--hidden",
  ];
  if (input.caseInsensitive) parts.push("--ignore-case");
  if (input.glob !== undefined) parts.push(`--glob=${input.glob}`);
  parts.push(
    ...excludeGlobs(FS_GLOB_VCS_EXCLUDES),
    ...excludeGlobs(FS_GLOB_HEAVY_EXCLUDES),
  );
  if (input.path !== undefined) parts.push("--", input.path);
  return parts;
}

function malformedRecord(detail: string, cause?: unknown): Error {
  return new Error(
    `grep received malformed ripgrep --json output (${detail})`,
    { cause },
  );
}

/** DSH `parseRecord` → our `FsGrepHit`. */
export function parseGrepJsonRecord(line: string): FsGrepHit | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error: unknown) {
    throw malformedRecord("a line is not JSON", error);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw malformedRecord("a record is not an object");
  }
  const record = parsed as { type?: unknown; data?: unknown };
  if (record.type !== "match") return undefined;
  if (typeof record.data !== "object" || record.data === null) {
    throw malformedRecord("a match record has no data");
  }
  const data = record.data as {
    path?: unknown;
    line_number?: unknown;
    lines?: unknown;
  };
  const pathText =
    typeof data.path === "object" && data.path !== null
      ? (data.path as { text?: unknown }).text
      : undefined;
  if (typeof pathText !== "string") {
    throw malformedRecord("a match record has no path text");
  }
  if (typeof data.line_number !== "number") {
    throw malformedRecord("a match record has no line number");
  }
  if (typeof data.lines !== "object" || data.lines === null) {
    throw malformedRecord("a match record has no line content");
  }
  const lines = data.lines as { text?: unknown; bytes?: unknown };
  let text: string;
  if (typeof lines.text === "string") {
    text = lines.text.replace(/\r?\n$/, "");
  } else if (typeof lines.bytes === "string") {
    text = "(line is not valid UTF-8)";
  } else {
    throw malformedRecord("a match record has neither line text nor bytes");
  }
  return {
    path: pathText.replace(/\\/g, "/"),
    line: data.line_number,
    text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
  };
}

export function parseGrepMatches(stdout: string): FsGrepHit[] {
  const hits: FsGrepHit[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const hit = parseGrepJsonRecord(line);
    if (hit !== undefined) hits.push(hit);
  }
  return hits;
}

function classifyRgFailure(
  tool: string,
  exitCode: number,
  stderr: string,
): Error {
  const excerpt = stderr.trim().slice(0, 400);
  if (/regex parse error|error parsing glob/i.test(excerpt)) {
    return new Error(
      `${tool} pattern rejected by ripgrep${excerpt ? `: ${excerpt}` : ""}`,
    );
  }
  return new Error(
    `${tool} ripgrep failed (exit ${exitCode})${excerpt ? `: ${excerpt}` : ""}`,
  );
}

function toDisplayPath(p: string, rootAbs: string): string {
  const norm = p.replace(/\\/g, "/");
  if (!path.isAbsolute(p)) return norm.replace(/^\.\//, "");
  const rel = path.relative(rootAbs, p).replace(/\\/g, "/");
  if (rel === "" || rel === ".") return ".";
  if (rel.startsWith("..")) return norm;
  return rel;
}

/** Glob via packaged rg `--files` (DSH). */
export async function globWithRipgrep(
  root: string,
  pattern: string,
  options?: FsGlobOptions,
): Promise<readonly string[]> {
  const rootAbs = path.resolve(root);
  const maxResults = options?.maxResults ?? 200;
  const bin = await resolveRgPath();
  const subprocess = createLocalSubprocess();
  const result = await subprocess.spawn(
    [bin, ...buildGlobCommand({ pattern })],
    {
      cwd: rootAbs,
      timeoutMs: FS_SEARCH_TIMEOUT_MS,
      // Search never needs disk spill; keep the Host loop free of writeSync.
      spill: false,
    },
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw classifyRgFailure("glob", result.exitCode ?? -1, result.stderr);
  }
  if (Buffer.byteLength(result.stdout, "utf8") > FS_SEARCH_RAW_OUTPUT_MAX_BYTES) {
    throw new Error(
      `glob produced more than ${FS_SEARCH_RAW_OUTPUT_MAX_BYTES} bytes of raw output; narrow pattern`,
    );
  }
  const out: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) continue;
    out.push(toDisplayPath(line, rootAbs));
    if (out.length >= maxResults) break;
  }
  return out;
}

/**
 * Grep via packaged rg `--json`, streaming + early kill at `maxResults`
 * (pi coding-agent). Avoids buffering multi-MB stdout on hot repos.
 */
export async function grepWithRipgrep(
  root: string,
  pattern: string,
  options?: FsGrepOptions,
): Promise<readonly FsGrepHit[]> {
  const rootAbs = path.resolve(root);
  const maxResults = options?.maxResults ?? 100;
  const scope = options?.path;
  let scopedPath: string | undefined;
  if (scope !== undefined && scope !== "." && scope !== "") {
    resolveWithinRoot(rootAbs, scope);
    scopedPath = scope;
  }
  const bin = await resolveRgPath();
  const argv = buildGrepCommand({
    pattern,
    ...(scopedPath !== undefined ? { path: scopedPath } : {}),
    ...(options?.glob !== undefined ? { glob: options.glob } : {}),
    ...(options?.caseInsensitive ? { caseInsensitive: true } : {}),
  });

  return await new Promise<readonly FsGrepHit[]>((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd: rootAbs,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const hits: FsGrepHit[] = [];
    let stderr = "";
    let settled = false;
    let killedForLimit = false;
    const timer = setTimeout(() => {
      killedForLimit = false;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, FS_SEARCH_TIMEOUT_MS);

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk;
    });

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (settled || hits.length >= maxResults) return;
      if (!line.trim()) return;
      let hit: FsGrepHit | undefined;
      try {
        hit = parseGrepJsonRecord(line);
      } catch (err) {
        finish(() =>
          reject(
            new Error(`ripgrep --json parse failed: ${errorText(err)}`, {
              cause: err,
            }),
          ),
        );
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        return;
      }
      if (hit === undefined) return;
      hits.push({
        ...hit,
        path: toDisplayPath(hit.path, rootAbs),
      });
      if (hits.length >= maxResults) {
        killedForLimit = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    });

    child.on("error", (err) => {
      finish(() =>
        reject(
          new RipgrepUnavailableError(`Failed to run ripgrep: ${err.message}`, {
            cause: err,
          }),
        ),
      );
    });

    child.on("close", (code) => {
      rl.close();
      finish(() => {
        if (killedForLimit) {
          resolve(hits);
          return;
        }
        if (code !== 0 && code !== 1 && code !== null) {
          reject(classifyRgFailure("grep", code, stderr));
          return;
        }
        resolve(hits);
      });
    });
  });
}

/** True when callers should skip ripgrep (`XRK_FS_SEARCH=js`). */
export function preferJsSearch(): boolean {
  const raw = process.env.XRK_FS_SEARCH?.trim().toLowerCase();
  return raw === "js" || raw === "walk" || raw === "javascript";
}
