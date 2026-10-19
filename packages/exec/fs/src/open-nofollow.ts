/**
 * Open a path with O_NOFOLLOW when available, then re-check inode via fstat.
 * Closes the TOCTOU gap between path jailing and the actual read.
 */

import { constants } from "node:fs";
import {
  lstat,
  open as fsOpen,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { PathEscapeError, isLexicallyInside } from "./paths.js";

function openFlags(): string | number {
  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  if (noFollow === 0) return "r";
  return constants.O_RDONLY | noFollow;
}

function identityKey(st: {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}): { readonly dev: string; readonly ino: string } {
  return { dev: String(st.dev), ino: String(st.ino) };
}

function sameIdentity(
  a: { readonly dev: number | bigint; readonly ino: number | bigint },
  b: { readonly dev: number | bigint; readonly ino: number | bigint },
): boolean {
  const left = identityKey(a);
  const right = identityKey(b);
  // Windows may report ino=0; still catch mid-flight replacement when both
  // sides expose a non-zero inode.
  if (left.ino === "0" && right.ino === "0") return left.dev === right.dev;
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Resolve a final symlink and ensure the target stays inside one of `roots`.
 * Empty `roots` means open mode: follow is allowed after realpath.
 */
async function resolveOpenTarget(
  abs: string,
  roots: readonly string[],
): Promise<{ path: string; st: Awaited<ReturnType<typeof lstat>> }> {
  const st = await lstat(abs);
  if (!st.isSymbolicLink()) return { path: abs, st };
  let target: string;
  try {
    target = await realpath(abs);
  } catch {
    throw new PathEscapeError(`path escapes via dangling symlink: ${abs}`);
  }
  if (roots.length > 0) {
    const inside = roots.some((root) => isLexicallyInside(root, target));
    if (!inside) {
      throw new PathEscapeError(`path escapes workspace via symlink: ${abs}`);
    }
  }
  const targetSt = await lstat(target);
  if (targetSt.isSymbolicLink()) {
    throw new PathEscapeError(`path escapes via symlink: ${abs}`);
  }
  return { path: target, st: targetSt };
}

/**
 * Open for reading without following a final symlink component (when the OS
 * supports O_NOFOLLOW). After open, fstat must match the pre-open lstat.
 */
export async function openNoFollowRead(
  abs: string,
  roots: readonly string[] = [],
): Promise<FileHandle> {
  const { path: openPath, st: before } = await resolveOpenTarget(abs, roots);
  const fh = await fsOpen(openPath, openFlags());
  try {
    const after = await fh.stat();
    if (!sameIdentity(before, after)) {
      throw new PathEscapeError(
        `path changed between lstat and open (TOCTOU): ${abs}`,
      );
    }
    if (after.isDirectory()) {
      throw new Error(`EISDIR: ${abs}`);
    }
    return fh;
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
}

/** Read entire UTF-8 file through {@link openNoFollowRead}. */
export async function readFileNoFollow(
  abs: string,
  roots: readonly string[] = [],
): Promise<string> {
  const fh = await openNoFollowRead(abs, roots);
  try {
    const st = await fh.stat();
    if (st.size === 0) return "";
    const buf = Buffer.allocUnsafe(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}
