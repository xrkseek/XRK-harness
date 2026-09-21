import { posix } from "node:path";
import { PathEscapeError } from "@xrkseek/exec-fs";

/** Normalize an absolute POSIX remote path (no host cwd). */
export function normalizeRemoteAbs(abs: string): string {
  const n = posix.normalize(abs);
  if (!posix.isAbsolute(n)) {
    throw new PathEscapeError(`remote path must be absolute: ${abs}`);
  }
  // Strip trailing slash except root.
  return n === "/" ? "/" : n.replace(/\/+$/, "");
}

/** True when `candidate` is `root` or a descendant (POSIX lexical). */
export function isRemotelyInside(root: string, candidate: string): boolean {
  const rootAbs = normalizeRemoteAbs(root);
  const candAbs = normalizeRemoteAbs(candidate);
  const rel = posix.relative(rootAbs, candAbs);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith("../") && !posix.isAbsolute(rel))
  );
}

/**
 * Resolve a user path under a remote workspace root.
 * Relative paths join the root; absolute paths must stay inside.
 */
export function resolveWithinRemoteRoot(
  root: string,
  userPath: string,
): string {
  const rootAbs = normalizeRemoteAbs(root);
  const targetAbs = posix.isAbsolute(userPath)
    ? normalizeRemoteAbs(userPath)
    : normalizeRemoteAbs(posix.join(rootAbs, userPath));
  if (!isRemotelyInside(rootAbs, targetAbs)) {
    throw new PathEscapeError(`path escapes workspace root: ${userPath}`);
  }
  return targetAbs;
}
