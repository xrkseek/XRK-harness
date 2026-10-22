import { describe, expect, it } from "vitest";
import {
  createListWorkSlice,
  maybeYieldListWork,
  throwIfListCancelled,
} from "../src/list-work-slice.js";

describe("list work slice", () => {
  it("does not yield while within the slice budget", async () => {
    let yields = 0;
    let t = 0;
    const slice = createListWorkSlice({
      sliceMs: 16,
      now: () => t,
      yieldFn: async () => {
        yields += 1;
      },
    });
    t = 10;
    await maybeYieldListWork(slice);
    expect(yields).toBe(0);
  });

  it("yields once the slice is exhausted then rebuilds the deadline", async () => {
    let yields = 0;
    let t = 0;
    const slice = createListWorkSlice({
      sliceMs: 16,
      now: () => t,
      yieldFn: async () => {
        yields += 1;
        t += 1;
      },
    });
    t = 20;
    await maybeYieldListWork(slice);
    expect(yields).toBe(1);
    expect(slice.deadline).toBe(t + 16);
  });

  it("throws AbortError on cancel instead of continuing", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfListCancelled(ac.signal)).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});
