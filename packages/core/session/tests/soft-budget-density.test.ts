import { describe, expect, it } from "vitest";
import {
  estimateRequestTokens,
  estimateText,
  estimateTextForSoftBudget,
} from "../src/index.js";

describe("soft-budget text density", () => {
  it("keeps ASCII at chars/4; densifies CJK for no-usage soft budget", () => {
    expect(estimateText("abcd")).toBe(1);
    expect(estimateTextForSoftBudget("abcd")).toBe(1);
    // Two CJK chars: fixed /4 → 1; soft-budget → 2.
    expect(estimateText("你好")).toBe(1);
    expect(estimateTextForSoftBudget("你好")).toBe(2);
  });

  it("estimateRequestTokens density soft-budget raises CJK message cost only", () => {
    const ascii = estimateRequestTokens({
      messages: [{ role: "user", content: "x".repeat(40) }],
    });
    const asciiSoft = estimateRequestTokens({
      messages: [{ role: "user", content: "x".repeat(40) }],
      density: "soft-budget",
    });
    expect(asciiSoft).toBe(ascii);

    const cjk = estimateRequestTokens({
      messages: [{ role: "user", content: "中".repeat(40) }],
    });
    const cjkSoft = estimateRequestTokens({
      messages: [{ role: "user", content: "中".repeat(40) }],
      density: "soft-budget",
    });
    expect(cjkSoft).toBeGreaterThan(cjk);
  });
});
