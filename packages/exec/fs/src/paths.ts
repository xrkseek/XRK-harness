import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

/** True when `candidate` is `root` or a descendant (lexical, after resolve). */
export function isLexicallyInside(root: string, candidate: string): boolean {
  const rootAbs = path.resolve(root);
  const candAbs = path.resolve(candidate);
  const rel = path.relative(rootAbs, candAbs);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
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
  if (!isLexicallyInside(rootAbs, targetAbs)) {
    throw new PathEscapeError(`path escapes workspace root: ${userPath}`);
  }
  return targetAbs;
}

/**
 * Realpath of the deepest existing ancestor of `abs` (the path itself when
 * present). Used so a symlink under a host root cannot point at sibling home
 * files outside that root.
 */
function realpathExisting(abs: string): string {
  let cur = path.resolve(abs);
  for (;;) {
    try {
      return realpathSync(cur);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String(err.code)
          : "";
      if (code !== "ENOENT") {
        throw err;
      }
      const parent = path.dirname(cur);
      if (parent === cur) {
        throw new PathEscapeError(`path not resolvable: ${abs}`);
      }
      cur = parent;
    }
  }
}

/**
 * Absolute path allowed only when it stays under one of `hostRoots`
 * lexically **and** after symlink resolution (Codex/DSH readable-root posture).
 * Prevents `~/.xrk/spill/…` → symlink → sibling home files
 * (`host-settings.json`, credentials, …).
 */
export function resolveUnderHostRoots(
  hostRoots: readonly string[],
  userPath: string,
): string {
  if (!path.isAbsolute(userPath)) {
    throw new PathEscapeError(`host-readable path must be absolute: ${userPath}`);
  }
  const abs = path.resolve(userPath);
  let matchedRoot: string | undefined;
  for (const hostRoot of hostRoots) {
    const hostAbs = path.resolve(hostRoot);
    if (isLexicallyInside(hostAbs, abs)) {
      matchedRoot = hostAbs;
      break;
    }
  }
  if (matchedRoot === undefined) {
    throw new PathEscapeError(`path escapes host-readable roots: ${userPath}`);
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(matchedRoot);
  } catch {
    // Root not created yet — lexical match is enough until first write.
    return abs;
  }

  let realTarget: string;
  try {
    realTarget = realpathExisting(abs);
  } catch (err) {
    if (err instanceof PathEscapeError) throw err;
    throw new PathEscapeError(`path escapes host-readable roots: ${userPath}`);
  }

  if (!isLexicallyInside(realRoot, realTarget)) {
    throw new PathEscapeError(
      `path escapes host-readable roots via symlink: ${userPath}`,
    );
  }

  // Refuse symlinks whose resolved target leaves the root (incl. dangling).
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      let linked: string;
      try {
        linked = realpathSync(abs);
      } catch {
        throw new PathEscapeError(
          `path escapes host-readable roots via symlink: ${userPath}`,
        );
      }
      if (!isLexicallyInside(realRoot, linked)) {
        throw new PathEscapeError(
          `path escapes host-readable roots via symlink: ${userPath}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof PathEscapeError) throw err;
    // ENOENT — file not created yet; lexical + ancestor realpath already checked.
  }

  return abs;
}
