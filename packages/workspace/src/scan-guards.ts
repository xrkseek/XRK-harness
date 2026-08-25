/**
 * Bounded filesystem walks for workspace inject (Codex / DSH parity).
 * Skips dependency trees and VCS dirs; caps recursion depth.
 */

/** Directory names never descended during markdown / skill scans. */
export const SCAN_EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".pnpm-store",
  "coverage",
  ".artifacts",
  ".release",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Default max depth for `rules/` style trees (home + workspace). */
export const DEFAULT_MARKDOWN_DIR_MAX_DEPTH = 8;

export function shouldSkipScanDir(name: string): boolean {
  if (!name || name === "." || name === "..") return true;
  return SCAN_EXCLUDED_DIR_NAMES.has(name.toLowerCase());
}

export function nextScanDepth(
  depth: number,
  maxDepth: number = DEFAULT_MARKDOWN_DIR_MAX_DEPTH,
): number | null {
  if (depth >= maxDepth) return null;
  return depth + 1;
}
