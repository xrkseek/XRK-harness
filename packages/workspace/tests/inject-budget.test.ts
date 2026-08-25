import { describe, expect, it } from "vitest";
import {
  boundInstructionFile,
  clipToBudget,
  createInjectBudget,
  MAX_INSTRUCTION_FILE_BYTES,
} from "../src/inject-budget.js";

describe("inject budget", () => {
  it("clips shared budget and records truncation events", () => {
    const budget = createInjectBudget(10);
    expect(clipToBudget("a", "hello", budget)).toBe("hello");
    expect(budget.left).toBe(5);
    expect(clipToBudget("b", "world-wide", budget)).toBe("world\n[truncated]");
    expect(budget.left).toBe(0);
    expect(budget.events).toHaveLength(1);
    expect(budget.events[0]).toMatchObject({
      section: "b",
      originalChars: 10,
      keptChars: 5,
    });
  });

  it("bounds per-file reads before budget clipping", () => {
    const huge = "x".repeat(MAX_INSTRUCTION_FILE_BYTES + 10);
    const bounded = boundInstructionFile(huge);
    expect(bounded.startsWith("x".repeat(MAX_INSTRUCTION_FILE_BYTES))).toBe(true);
    expect(bounded).toContain("[file truncated]");
  });
});
