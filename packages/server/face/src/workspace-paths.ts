/**
 * Workspace path title helper (Host Face).
 * Drive roots (`C:\`) keep the complete root spelling; ordinary dirs use basename.
 * Absolute-path acceptance for create reuses {@link fullyQualified} (browse picker).
 */

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
