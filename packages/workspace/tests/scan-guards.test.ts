import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKDOWN_DIR_MAX_DEPTH,
  claimScanDir,
  claimScanEntry,
  claimScanRoot,
  createScanBudget,
  nextScanDepth,
  shouldSkipScanDir,
} from "../src/scan-guards.js";

describe("scan-guards", () => {
  it("skips dependency and VCS directories", () => {
    expect(shouldSkipScanDir("node_modules")).toBe(true);
    expect(shouldSkipScanDir(".git")).toBe(true);
    expect(shouldSkipScanDir("rules")).toBe(false);
  });

  it("caps markdown recursion depth", () => {
    expect(nextScanDepth(DEFAULT_MARKDOWN_DIR_MAX_DEPTH - 1)).toBe(
      DEFAULT_MARKDOWN_DIR_MAX_DEPTH,
    );
    expect(nextScanDepth(DEFAULT_MARKDOWN_DIR_MAX_DEPTH)).toBeNull();
  });

  it("stops a walk when a hard cap is hit and skips oversized files", () => {
    const budget = createScanBudget({ maxRoots: 1, maxDirs: 1, maxEntries: 1, maxFileBytes: 8 });
    expect(claimScanRoot(budget)).toBe(true);
    expect(claimScanRoot(budget)).toBe(false);
    expect(budget.stopped).toBe(true);
    const fresh = createScanBudget({ maxFileBytes: 4, maxEntries: 2 });
    expect(claimScanEntry(fresh, 100)).toBe(false);
    expect(fresh.stopped).toBe(false);
    expect(fresh.entries).toBe(0);
    expect(claimScanDir(fresh)).toBe(true);
    expect(claimScanEntry(fresh, 2)).toBe(true);
  });
});
