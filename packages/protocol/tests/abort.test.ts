import { describe, expect, it } from "vitest";
import { combineAbortSignals } from "../src/abort.js";

describe("combineAbortSignals", () => {
  it("returns the only signal unchanged", () => {
    const ctrl = new AbortController();
    expect(combineAbortSignals([ctrl.signal])).toBe(ctrl.signal);
  });

  it("aborts when either input aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const fused = combineAbortSignals([a.signal, b.signal]);
    expect(fused.aborted).toBe(false);
    a.abort("caller");
    expect(fused.aborted).toBe(true);
  });

  it("throws when given no signals", () => {
    expect(() => combineAbortSignals([])).toThrow(/no signals/);
  });
});
