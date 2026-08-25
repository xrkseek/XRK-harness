import path from "node:path";

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

/**
 * Resolve a user path under `root`. Relative paths join the root; absolute
 * paths are allowed only when they still land inside the root (DSH / Codex).
 */
export function resolveWithinRoot(root: string, userPath: string): string {
  const rootAbs = path.resolve(root);
  const targetAbs = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(rootAbs, userPath);
  const rel = path.relative(rootAbs, targetAbs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new PathEscapeError(`path escapes workspace root: ${userPath}`);
  }
  return targetAbs;
}
