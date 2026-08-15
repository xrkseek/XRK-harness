import { describe, expect, it } from "vitest";
import {
  checkRepeatedToolCall,
  createLoopDetectionTracker,
  createMistakeTracker,
  emptyLoopState,
  toolCallSignature,
} from "../src/index.js";

describe("toolCallSignature", () => {
  it("is key-order independent", () => {
    expect(toolCallSignature({ b: 1, a: 2 })).toBe(
      toolCallSignature({ a: 2, b: 1 }),
    );
  });
});

describe("checkRepeatedToolCall", () => {
  it("soft only at exact threshold; hard at >= hard", () => {
    let state = emptyLoopState();
    const cfg = { softThreshold: 3, hardThreshold: 5 };
    const args = { path: "x" };
    const kinds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { next, verdict } = checkRepeatedToolCall(state, "read", args, cfg);
      state = next;
      kinds.push(verdict.kind);
    }
    expect(kinds).toEqual(["ok", "ok", "soft", "ok", "hard"]);
  });

  it("resets when signature changes", () => {
    const tracker = createLoopDetectionTracker({
      softThreshold: 2,
      hardThreshold: 4,
    });
    expect(tracker.inspect("a", { n: 1 }).kind).toBe("ok");
    expect(tracker.inspect("a", { n: 1 }).kind).toBe("soft");
    expect(tracker.inspect("a", { n: 2 }).kind).toBe("ok");
  });
});

describe("mistake tracker", () => {
  it("resets after productive tools", () => {
    const m = createMistakeTracker({ maxConsecutiveMistakes: 3 });
    m.onTurnToolStats({ ok: 0, failed: 1 });
    m.onTurnToolStats({ ok: 0, failed: 1 });
    expect(m.consecutive).toBe(2);
    m.onTurnToolStats({ ok: 1, failed: 0 });
    expect(m.consecutive).toBe(0);
  });

  it("stops at max consecutive all-fail turns", () => {
    const m = createMistakeTracker({ maxConsecutiveMistakes: 2 });
    expect(m.onTurnToolStats({ ok: 0, failed: 1 })?.action).toBe("continue");
    const hit = m.onTurnToolStats({ ok: 0, failed: 1 });
    expect(hit?.action).toBe("stop");
    expect(hit?.atLimit).toBe(true);
  });

  it("forceAtLimit jumps to max", () => {
    const m = createMistakeTracker({ maxConsecutiveMistakes: 6 });
    const r = m.record({ reason: "tool_loop_hard", forceAtLimit: true });
    expect(r.action).toBe("stop");
    expect(r.consecutive).toBe(6);
  });
});
