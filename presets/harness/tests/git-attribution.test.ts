import { describe, expect, it } from "vitest";
import {
  formatGitAttributionGuidance,
  GIT_COAUTHOR,
} from "../git-attribution.js";

describe("formatGitAttributionGuidance", () => {
  it("includes fixed xrkseek trailer when on / default", () => {
    const text = formatGitAttributionGuidance();
    expect(text).toContain(`Co-authored-by: ${GIT_COAUTHOR}`);
    expect(text).toMatch(/do not change git config/i);
  });

  it("is empty when off (feature absent)", () => {
    expect(formatGitAttributionGuidance({ enabled: false })).toBe("");
  });
});
