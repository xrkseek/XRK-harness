import path from "node:path";
import { TerminalError } from "./types.js";

export function resolvePtyCwd(workspaceRoot: string, userCwd?: string): string {
  const rootAbs = path.resolve(workspaceRoot);
  if (userCwd === undefined || userCwd.trim().length === 0) return rootAbs;
  const targetAbs = path.isAbsolute(userCwd)
    ? path.resolve(userCwd)
    : path.resolve(rootAbs, userCwd);
  const rel = path.relative(rootAbs, targetAbs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new TerminalError(
      `cwd "${userCwd}" resolves outside the workspace`,
      "PTY_PATH",
    );
  }
  return targetAbs;
}
