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

/** Hard caps for workspace inject walks (roots / dirs / entries / file bytes). */
export const DEFAULT_SCAN_MAX_ROOTS = 32;
export const DEFAULT_SCAN_MAX_DIRS = 4_000;
export const DEFAULT_SCAN_MAX_ENTRIES = 20_000;
export const DEFAULT_SCAN_MAX_FILE_BYTES = 1_048_576;

export interface ScanBudget {
  readonly maxRoots: number;
  readonly maxDirs: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  roots: number;
  dirs: number;
  entries: number;
  /** Set once any cap refuses further work. */
  stopped: boolean;
}

export function createScanBudget(
  partial?: Partial<
    Pick<ScanBudget, "maxRoots" | "maxDirs" | "maxEntries" | "maxFileBytes">
  >,
): ScanBudget {
  return {
    maxRoots: partial?.maxRoots ?? DEFAULT_SCAN_MAX_ROOTS,
    maxDirs: partial?.maxDirs ?? DEFAULT_SCAN_MAX_DIRS,
    maxEntries: partial?.maxEntries ?? DEFAULT_SCAN_MAX_ENTRIES,
    maxFileBytes: partial?.maxFileBytes ?? DEFAULT_SCAN_MAX_FILE_BYTES,
    roots: 0,
    dirs: 0,
    entries: 0,
    stopped: false,
  };
}

function stop(budget: ScanBudget): false {
  budget.stopped = true;
  return false;
}

export function claimScanRoot(budget: ScanBudget): boolean {
  if (budget.stopped) return false;
  if (budget.roots >= budget.maxRoots) return stop(budget);
  budget.roots += 1;
  return true;
}

export function claimScanDir(budget: ScanBudget): boolean {
  if (budget.stopped) return false;
  if (budget.dirs >= budget.maxDirs) return stop(budget);
  budget.dirs += 1;
  return true;
}

/** Count one file. Oversized files are skipped without consuming an entry. */
export function claimScanEntry(budget: ScanBudget, bytes: number): boolean {
  if (budget.stopped) return false;
  if (bytes > budget.maxFileBytes) return false;
  if (budget.entries >= budget.maxEntries) return stop(budget);
  budget.entries += 1;
  return true;
}
