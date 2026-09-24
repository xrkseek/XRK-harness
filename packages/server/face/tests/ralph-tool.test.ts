import { describe, expect, it } from "vitest";
import {
  validateRalphReport,
  RALPH_MAX_HANDOFF_CHARS,
} from "../src/ralph-tool.js";

describe("ralph report validation", () => {
  it("accepts continue / complete / blocked shapes", () => {
    expect(
      validateRalphReport({
        status: "continue",
        summary: "still going",
        evidence: ["a"],
        nextSteps: ["b"],
        blocker: "",
      }).status,
    ).toBe("continue");
    expect(
      validateRalphReport({
        status: "complete",
        summary: "done",
        evidence: ["shipped"],
        nextSteps: [],
        blocker: "",
      }).status,
    ).toBe("complete");
    expect(
      validateRalphReport({
        status: "blocked",
        summary: "stuck",
        evidence: [],
        nextSteps: [],
        blocker: "missing key",
      }).status,
    ).toBe("blocked");
  });

  it("rejects invalid complete / oversized reports", () => {
    expect(() =>
      validateRalphReport({
        status: "complete",
        summary: "done",
        evidence: [],
        nextSteps: [],
        blocker: "",
      }),
    ).toThrow(/evidence/);
    expect(() =>
      validateRalphReport(
        {
          status: "continue",
          summary: "x".repeat(100),
          evidence: ["y".repeat(100)],
          nextSteps: ["z".repeat(100)],
          blocker: "",
        },
        80,
      ),
    ).toThrow(/maxHandoffChars/);
    expect(RALPH_MAX_HANDOFF_CHARS).toBeGreaterThan(1000);
  });
});
