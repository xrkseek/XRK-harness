import path from "node:path";

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

export function resolveWithinRoot(root: string, userPath: string): string {
  if (path.isAbsolute(userPath)) {
    throw new PathEscapeError(`absolute paths are not allowed: ${userPath}`);
  }
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(rootAbs, userPath);
  const rel = path.relative(rootAbs, targetAbs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new PathEscapeError(`path escapes workspace root: ${userPath}`);
  }
  return targetAbs;
}
