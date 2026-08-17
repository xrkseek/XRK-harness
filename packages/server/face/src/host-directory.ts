/**
 * Face host.listDirectory / host.createDirectory — shapes follow DSH
 * `packages/host/directory-picker-browse` (crumbs · entries · truncated).
 * Source of truth: XRKbar deepseek-harness; this is a port of the wire contract,
 * not a second design.
 */

import { mkdir, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import type { FaceRpcResult } from "./types.js";

const MAX_ENTRIES = 1000;

export interface DirectoryEntryView {
  readonly name: string;
  readonly path: string;
  readonly hidden: boolean;
}

export interface DirectoryListingView {
  readonly path: string;
  readonly home: string;
  readonly crumbs: readonly DirectoryEntryView[];
  readonly entries: readonly DirectoryEntryView[];
  readonly truncated: boolean;
}

/** Same predicate as DSH `fullyQualified` (browse picker). */
export function fullyQualified(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32"
    ? win32.isAbsolute(path) &&
        /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path);
}

function ancestryCrumbs(target: string): DirectoryEntryView[] {
  const crumbs: DirectoryEntryView[] = [];
  let current = target;
  for (;;) {
    const parent = dirname(current);
    crumbs.unshift({
      name: parent === current ? current : basename(current),
      path: current,
      hidden: false,
    });
    if (parent === current) return crumbs;
    current = parent;
  }
}

interface ListingCandidate {
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

function boundedInsert(
  window: ListingCandidate[],
  candidate: ListingCandidate,
  keep: number,
): boolean {
  if (window.length >= keep) {
    const last = window[window.length - 1]!;
    if (candidate.name.localeCompare(last.name) >= 0) return true;
  }
  let i = 0;
  while (i < window.length && window[i]!.name.localeCompare(candidate.name) < 0) {
    i += 1;
  }
  window.splice(i, 0, candidate);
  if (window.length > keep) {
    window.pop();
    return true;
  }
  return false;
}

async function directoryRow(
  parent: string,
  name: string,
  isDirectory: boolean,
  isSymbolicLink: boolean,
): Promise<DirectoryEntryView | null> {
  const full = join(parent, name);
  if (isSymbolicLink) {
    try {
      const st = await stat(full);
      if (!st.isDirectory()) return null;
    } catch {
      return null;
    }
  } else if (!isDirectory) {
    return null;
  }
  return {
    name,
    path: full,
    hidden: name.startsWith("."),
  };
}

export async function hostListDirectory(
  payload: unknown,
): Promise<FaceRpcResult<DirectoryListingView>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const rawPath = typeof p.path === "string" ? p.path : undefined;
  const home = homedir();
  if (rawPath !== undefined && !fullyQualified(rawPath)) {
    return {
      ok: false,
      error: {
        code: "directory-unreadable",
        message: `cannot list "${rawPath}": not a fully qualified path`,
      },
    };
  }
  const target = resolve(rawPath ?? home);
  const keep = MAX_ENTRIES + 1;
  const window: ListingCandidate[] = [];
  let evicted = false;
  try {
    const level = await opendir(target);
    for await (const dirent of level) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      if (
        boundedInsert(
          window,
          {
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            isSymbolicLink: dirent.isSymbolicLink(),
          },
          keep,
        )
      ) {
        evicted = true;
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "directory-unreadable",
        message: `cannot list ${target}: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const entries: DirectoryEntryView[] = [];
  let truncated = evicted;
  for (const candidate of window) {
    const row = await directoryRow(
      target,
      candidate.name,
      candidate.isDirectory,
      candidate.isSymbolicLink,
    );
    if (row === null) continue;
    if (entries.length === MAX_ENTRIES) {
      truncated = true;
      break;
    }
    entries.push(row);
  }

  return {
    ok: true,
    value: {
      path: target,
      home,
      crumbs: ancestryCrumbs(target),
      entries,
      truncated,
    },
  };
}

export async function hostCreateDirectory(
  payload: unknown,
): Promise<FaceRpcResult<{ path: string }>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const parent = typeof p.path === "string" ? p.path.trim() : "";
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (
    !parent ||
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\]/.test(name)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message:
          "path required; name must be a single non-blank path segment",
      },
    };
  }
  if (!fullyQualified(parent)) {
    return {
      ok: false,
      error: {
        code: "directory-unreadable",
        message: `cannot create under "${parent}": not a fully qualified path`,
      },
    };
  }
  const full = join(resolve(parent), name);
  try {
    await mkdir(full, { recursive: false });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "directory-create-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  return { ok: true, value: { path: full } };
}
