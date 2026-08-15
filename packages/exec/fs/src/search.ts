import { readdir, readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import path from "node:path";
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

async function walkFiles(
  absDir: string,
  rootAbs: string,
  out: string[],
  maxResults: number,
): Promise<void> {
  if (out.length >= maxResults) return;
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= maxResults) return;
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(abs, rootAbs, out, maxResults);
      continue;
    }
    if (ent.isFile()) {
      const rel = path.relative(rootAbs, abs).replace(/\\/g, "/");
      out.push(rel);
    }
  }
}

/**
 * List files under `root` matching `pattern` (posix paths relative to root).
 */
export async function globUnderRoot(
  root: string,
  pattern: string,
  options?: FsGlobOptions,
): Promise<readonly string[]> {
  const rootAbs = path.resolve(root);
  const maxResults = options?.maxResults ?? 200;
  if (!pattern || typeof pattern !== "string") {
    throw new Error("glob pattern required");
  }
  const all: string[] = [];
  await walkFiles(rootAbs, rootAbs, all, Math.max(maxResults * 4, 2000));
  const matched: string[] = [];
  for (const rel of all) {
    if (matchGlob(rel, pattern)) {
      matched.push(rel);
      if (matched.length >= maxResults) break;
    }
  }
  return matched;
}

/**
 * Search file contents under root for a JS RegExp `pattern` string.
 */
export async function grepUnderRoot(
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

  let files: string[] = [];
  const scopeAbs =
    scope === "." || scope === ""
      ? rootAbs
      : resolveWithinRoot(rootAbs, scope);

  const st = await fsStat(scopeAbs);
  if (st.isFile()) {
    const rel = path.relative(rootAbs, scopeAbs).replace(/\\/g, "/");
    files = [rel];
  } else if (st.isDirectory()) {
    const gathered: string[] = [];
    await walkFiles(scopeAbs, rootAbs, gathered, 5000);
    files = gathered;
  }

  if (fileGlob) {
    files = files.filter((f) => matchGlob(f, fileGlob));
  }

  const hits: FsGrepHit[] = [];
  for (const rel of files) {
    if (hits.length >= maxResults) break;
    const abs = resolveWithinRoot(rootAbs, rel);
    let text: string;
    try {
      const buf = await fsReadFile(abs);
      if (buf.byteLength > 1_000_000) continue;
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= maxResults) break;
      const line = lines[i] ?? "";
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push({
          path: rel,
          line: i + 1,
          text: line.length > 400 ? `${line.slice(0, 400)}…` : line,
        });
      }
    }
  }
  return hits;
}
