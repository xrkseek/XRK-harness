/**
 * Remote directory browse helpers for Face host.listDirectory / createDirectory
 * when Host runs with an SSH execution world (Hermes-style ssh … bash -lc).
 */

import { posix } from "node:path";
import { PathEscapeError } from "@xrkseek/exec-fs";
import {
  isRemotelyInside,
  normalizeRemoteAbs,
  resolveWithinRemoteRoot,
} from "./paths.js";
import { shQuote } from "./quote.js";
import type { SshSession } from "./session.js";

const DEFAULT_MAX_ENTRIES = 1000;

export interface SshDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly hidden: boolean;
}

export interface SshDirectoryListing {
  readonly path: string;
  readonly home: string;
  readonly crumbs: readonly SshDirectoryEntry[];
  readonly entries: readonly SshDirectoryEntry[];
  readonly truncated: boolean;
}

function ancestryCrumbs(target: string): SshDirectoryEntry[] {
  const crumbs: SshDirectoryEntry[] = [];
  let current = normalizeRemoteAbs(target);
  for (;;) {
    const parent = posix.dirname(current);
    crumbs.unshift({
      name: parent === current ? current : posix.basename(current),
      path: current,
      hidden: false,
    });
    if (parent === current) return crumbs;
    current = parent;
  }
}

async function requireOk(
  session: SshSession,
  command: string,
  label: string,
): Promise<string> {
  const r = await session.exec(command);
  if (r.exitCode !== 0) {
    const detail = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim();
    throw new Error(`ssh ${label}: ${detail}`);
  }
  return r.stdout;
}

/**
 * List direct child directories under `target` (must stay inside `root`).
 * Absent / blank path → `root`. Symlinks to directories are included.
 */
export async function listSshDirectory(
  session: SshSession,
  root: string,
  path?: string,
  options?: { readonly maxEntries?: number },
): Promise<SshDirectoryListing> {
  const home = normalizeRemoteAbs(root);
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const raw = typeof path === "string" && path.trim() ? path.trim() : home;
  let target: string;
  try {
    target = resolveWithinRemoteRoot(home, raw);
  } catch (err) {
    if (err instanceof PathEscapeError) {
      throw new Error(`cannot list "${raw}": outside remote workspace`);
    }
    throw err;
  }

  const keep = maxEntries + 1;
  const stdout = await requireOk(
    session,
    `python3 -c ${shQuote(
      [
        "import os,json,stat",
        `p=${JSON.stringify(target)}`,
        `keep=${keep}`,
        "names=[]",
        "for name in sorted(os.listdir(p)):",
        "  abs=os.path.join(p,name)",
        "  try: st=os.lstat(abs)",
        "  except OSError: continue",
        "  mode=st.st_mode",
        "  if stat.S_ISDIR(mode): names.append(name); continue",
        "  if not stat.S_ISLNK(mode): continue",
        "  try:",
        "    if os.path.isdir(abs): names.append(name)",
        "  except OSError: pass",
        "print(json.dumps(names[:keep]))",
      ].join(";"),
    )}`,
    "list-dir",
  );
  const names = JSON.parse(stdout.trim()) as string[];
  const truncated = names.length > maxEntries;
  const slice = truncated ? names.slice(0, maxEntries) : names;
  const entries: SshDirectoryEntry[] = slice.map((name) => ({
    name,
    path: posix.join(target, name),
    hidden: name.startsWith("."),
  }));
  return {
    path: target,
    home,
    crumbs: ancestryCrumbs(target),
    entries,
    truncated,
  };
}

/** Create one child directory under `parent` (must stay inside `root`). */
export async function createSshDirectory(
  session: SshSession,
  root: string,
  parent: string,
  name: string,
): Promise<{ readonly path: string }> {
  if (
    !parent.trim() ||
    !name.trim() ||
    name === "." ||
    name === ".." ||
    /[/\\]/.test(name)
  ) {
    throw new Error(
      "path required; name must be a single non-blank path segment",
    );
  }
  const home = normalizeRemoteAbs(root);
  const parentAbs = resolveWithinRemoteRoot(home, parent.trim());
  const full = resolveWithinRemoteRoot(home, posix.join(parentAbs, name.trim()));
  if (!isRemotelyInside(parentAbs, full) || posix.dirname(full) !== parentAbs) {
    throw new Error(`cannot create under "${parent}": invalid name`);
  }
  await requireOk(
    session,
    `python3 -c ${shQuote(
      [
        "import os,sys",
        `p=${JSON.stringify(full)}`,
        "os.mkdir(p)",
      ].join(";"),
    )}`,
    "mkdir",
  );
  return { path: full };
}
