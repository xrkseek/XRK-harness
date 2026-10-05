import { readdir, readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { scheduler } from "node:timers/promises";
import { resolveWithinRoot } from "./paths.js";

export interface FsGlobOptions {
  readonly maxResults?: number;
}

export interface FsGrepHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface FsGrepOptions {
  /** Directory or file relative to root (default `.`). */
  readonly path?: string;
  /** Optional file-name glob filter (e.g. ** / *.ts without spaces). */
  readonly glob?: string;
  readonly maxResults?: number;
  readonly caseInsensitive?: boolean;
}

/** Skip heavy / generated trees so grep/glob stay interactive on monorepos. */
export const FS_SEARCH_SKIP_DIR_NAMES = new Set([
  ".git",
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
]);

/** Soft walk ceiling (still high enough for late-sorted paths). */
export const FS_SEARCH_WALK_CAP = 100_000;
/** Skip individual files larger than this for content grep. */
export const FS_GREP_MAX_FILE_BYTES = 1_000_000;
/** Yield the event loop this often while walking / grepping. */
const YIELD_EVERY = 48;

/** Convert a posix-ish glob to a RegExp. Supports * and ** segments. */
export function globToRegExp(pattern: string): RegExp {
  const norm = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
  let i = 0;
  let out = "^";
  while (i < norm.length) {
    const c = norm[i]!;
    if (c === "*" && norm[i + 1] === "*") {
      if (norm[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
      continue;
    }
    if (c === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if ("\\.[]{}()+-^$|".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

export function matchGlob(relPosix: string, pattern: string): boolean {
  const rel = relPosix.replace(/\\/g, "/").replace(/^\.\//, "");
  return globToRegExp(pattern).test(rel);
}

type WalkVisitor = (relPosix: string) => boolean | void | Promise<boolean | void>;

/**
 * Depth-first walk under `absDir`. Skips junk dir basenames. Invokes `visit`
 * for each file (posix path relative to `rootAbs`). Stop when visit returns
 * false or `cap` files have been visited. Yields periodically so Host LLM /
 * mux work can interleave.
 */
export async function walkFilesUnder(
  absDir: string,
  rootAbs: string,
  visit: WalkVisitor,
  cap: number = FS_SEARCH_WALK_CAP,
): Promise<void> {
  let visited = 0;
  let sinceYield = 0;

  const walk = async (dir: string): Promise<boolean> => {
    if (visited >= cap) return false;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const ent of entries) {
      if (visited >= cap) return false;
      if (ent.isDirectory()) {
        if (FS_SEARCH_SKIP_DIR_NAMES.has(ent.name)) continue;
        const abs = path.join(dir, ent.name);
        if (!(await walk(abs))) return false;
        continue;
      }
      if (!ent.isFile()) continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(rootAbs, abs).replace(/\\/g, "/");
      visited += 1;
      sinceYield += 1;
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        await scheduler.yield();
      }
      const cont = await visit(rel);
      if (cont === false) return false;
    }
    return true;
  };

  await walk(absDir);
}

/**
 * In-process glob walk (fallback when packaged ripgrep is unavailable).
 * Matches during the walk and stops at `maxResults`.
 */
export async function globWalkUnderRoot(
  root: string,
  pattern: string,
  options?: FsGlobOptions,
): Promise<readonly string[]> {
  const rootAbs = path.resolve(root);
  const maxResults = options?.maxResults ?? 200;
  if (!pattern || typeof pattern !== "string") {
    throw new Error("glob pattern required");
  }
  const matched: string[] = [];
  await walkFilesUnder(rootAbs, rootAbs, (rel) => {
    if (!matchGlob(rel, pattern)) return;
    matched.push(rel);
    if (matched.length >= maxResults) return false;
  });
  return matched;
}

/**
 * Collect files under `root` matching `pattern` (posix paths relative to root).
 * Prefers packaged ripgrep (`@vscode/ripgrep`, Codex / pi / DSH); falls back
 * to {@link globWalkUnderRoot} when the binary is missing. Set `XRK_FS_SEARCH=js`
 * to force the walk.
 */
export async function globUnderRoot(
  root: string,
  pattern: string,
  options?: FsGlobOptions,
): Promise<readonly string[]> {
  if (!pattern || typeof pattern !== "string") {
    throw new Error("glob pattern required");
  }
  const { preferJsSearch, RipgrepUnavailableError, globWithRipgrep } =
    await import("./ripgrep.js");
  if (!preferJsSearch()) {
    try {
      return await globWithRipgrep(root, pattern, options);
    } catch (err) {
      if (!(err instanceof RipgrepUnavailableError)) throw err;
    }
  }
  return globWalkUnderRoot(root, pattern, options);
}

/** Line scan without allocating a full `split` array (hot for large files). */
export function forEachLine(
  text: string,
  fn: (line: string, lineNo: number) => boolean,
): void {
  let start = 0;
  let lineNo = 1;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!fn(line, lineNo)) return;
    if (end === text.length) break;
    start = end + 1;
    lineNo += 1;
  }
}

/**
 * In-process content search (fallback when packaged ripgrep is unavailable).
 */
export async function grepWalkUnderRoot(
  root: string,
  pattern: string,
  options?: FsGrepOptions,
): Promise<readonly FsGrepHit[]> {
  if (!pattern || typeof pattern !== "string") {
    throw new Error("grep pattern required");
  }
  const rootAbs = path.resolve(root);
  const maxResults = options?.maxResults ?? 100;
  const scope = options?.path ?? ".";
  const fileGlob = options?.glob;

  let flags = "g";
  if (options?.caseInsensitive) flags += "i";
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid grep pattern: ${message}`, { cause: err });
  }

  const hits: FsGrepHit[] = [];

  const scanFile = async (rel: string): Promise<boolean> => {
    if (fileGlob && !matchGlob(rel, fileGlob)) return true;
    const abs = resolveWithinRoot(rootAbs, rel);
    let st;
    try {
      st = await fsStat(abs);
    } catch {
      return true;
    }
    if (!st.isFile() || st.size > FS_GREP_MAX_FILE_BYTES) return true;
    let text: string;
    try {
      const buf = await fsReadFile(abs);
      if (buf.byteLength > FS_GREP_MAX_FILE_BYTES) return true;
      // Cheap binary reject before UTF-8 decode of the whole buffer.
      const sample = buf.subarray(0, Math.min(buf.byteLength, 8192));
      if (sample.includes(0)) return true;
      text = buf.toString("utf8");
    } catch {
      return true;
    }
    forEachLine(text, (line, lineNo) => {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push({
          path: rel,
          line: lineNo,
          text: line.length > 400 ? `${line.slice(0, 400)}…` : line,
        });
        if (hits.length >= maxResults) return false;
      }
      return true;
    });
    return hits.length < maxResults;
  };

  const scopeAbs =
    scope === "." || scope === ""
      ? rootAbs
      : resolveWithinRoot(rootAbs, scope);

  const st = await fsStat(scopeAbs);
  if (st.isFile()) {
    const rel = path.relative(rootAbs, scopeAbs).replace(/\\/g, "/");
    await scanFile(rel);
    return hits;
  }
  if (!st.isDirectory()) return hits;

  await walkFilesUnder(scopeAbs, rootAbs, async (rel) => {
    if (!(await scanFile(rel))) return false;
  });
  return hits;
}

/**
 * Search file contents under root. Prefers packaged ripgrep (`--json`);
 * falls back to {@link grepWalkUnderRoot} when the binary is missing.
 * Set `XRK_FS_SEARCH=js` to force the walk.
 */
export async function grepUnderRoot(
  root: string,
  pattern: string,
  options?: FsGrepOptions,
): Promise<readonly FsGrepHit[]> {
  if (!pattern || typeof pattern !== "string") {
    throw new Error("grep pattern required");
  }
  const { preferJsSearch, RipgrepUnavailableError, grepWithRipgrep } =
    await import("./ripgrep.js");
  if (!preferJsSearch()) {
    try {
      return await grepWithRipgrep(root, pattern, options);
    } catch (err) {
      if (!(err instanceof RipgrepUnavailableError)) throw err;
    }
  }
  return grepWalkUnderRoot(root, pattern, options);
}
