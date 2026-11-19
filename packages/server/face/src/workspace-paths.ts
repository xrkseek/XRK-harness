/**
 * Workspace path title helper (Host Face).
 * Drive roots (`C:\`) keep the complete root spelling; ordinary dirs use basename.
 * Absolute-path acceptance for create reuses {@link fullyQualified} (browse picker).
 */

import path from "node:path";
import { posix, win32 } from "node:path";

/**
 * Derive a non-empty default title from a workspace path.
 * @param path - Workspace path (typically already absolute).
 * @param platform - Host platform; injectable for deterministic path tests.
 */
export function defaultWorkspaceTitle(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === "win32" ? win32 : posix;
  return pathApi.basename(path) || pathApi.parse(path).root || "workspace";
}

const WIN_ABS_RE = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const UNIX_ABS_RE =
  /(?:^|[\s`"'(])(\/(?:Users|home|var|tmp|opt|Volumes)\/[^\s`"')]+)/g;

function collectAbsolutePathMentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIN_ABS_RE)) {
    if (m[0]) out.push(m[0]);
  }
  for (const m of text.matchAll(UNIX_ABS_RE)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function isOutsideRoot(root: string, candidate: string): boolean {
  const absRoot = path.resolve(root);
  const absCand = path.resolve(candidate);
  const rel = path.relative(absRoot, absCand);
  return rel === "" ? false : rel.startsWith("..") || path.isAbsolute(rel);
}

/**
 * When a coding parent spawns a child that inherits the parent workspace, but
 * the prompt names absolute paths outside that root, warn so the parent does
 * not burn a whole turn believing the child cwd matches the job tree
 * (RC.2: harness inject while writing under Desktop\\function).
 */
export function outsideWorkspaceJobNotice(
  workspaceRoot: string,
  prompt: string,
): string | undefined {
  const root = workspaceRoot.trim();
  if (!root) return undefined;
  const hits = collectAbsolutePathMentions(prompt).filter((p) =>
    isOutsideRoot(root, p),
  );
  if (hits.length === 0) return undefined;
  const sample = hits[0]!;
  return (
    `Note: child inherits this session workspace (\`${root}\`). ` +
    `Prompt paths like \`${sample}\` sit outside that root — child inject/cwd stay on the parent workspace. ` +
    `Open the job folder as the workspace before spawning, or keep using absolute tool paths. ` +
    `Coding sessions cannot pass workspace_id/cwd (IM only).`
  );
}
