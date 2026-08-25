import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKDOWN_DIR_MAX_DEPTH,
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
});
