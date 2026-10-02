import { describe, expect, it } from "vitest";
import { createAutoReviewProjectionUnit } from "../src/projections/units/auto-review.js";

describe("autoReview projection", () => {
  it("toggles enabled via /auto-review command/run", () => {
    const unit = createAutoReviewProjectionUnit();
    let state = unit.init();
    expect(unit.wire!.view(state).enabled).toBe(false);

    state = unit.apply(state, {
      type: "command/run",
      ts: 1,
      commandId: "c1",
      name: "auto-review",
      args: " on",
      source: { kind: "user" },
    });
    expect(unit.wire!.view(state).enabled).toBe(true);

    state = unit.apply(state, {
      type: "command/run",
      ts: 2,
      commandId: "c2",
      name: "auto-review",
      args: " off",
      source: { kind: "user" },
    });
    expect(unit.wire!.view(state).enabled).toBe(false);
  });

  it("overlays live tool-pre allows/denies/verdictsUsed/recentDenies", () => {
    const live = {
      allows: 3,
      denies: 2,
      verdictsUsed: 5,
      failuresUsed: 1,
      fallbacks: 0,
      neverRejects: 0,
      avgDurationMs: 0,
      recentDenies: [
        { reviewId: "r1", toolName: "bash" },
        { reviewId: "r2", toolName: "write_file" },
      ],
    };
    const unit = createAutoReviewProjectionUnit({
      readLiveStats: () => live,
    });
    const state = unit.init();
    const snap = unit.wire!.view(state);
    expect(snap.enabled).toBe(false);
    expect(snap.allows).toBe(3);
    expect(snap.denies).toBe(2);
    expect(snap.verdictsUsed).toBe(5);
    expect(snap.failuresUsed).toBe(1);
    expect(snap.recentDenies).toEqual(live.recentDenies);
    expect(snap.circuit).toBeNull();
  });

  it("overlays live fallbacks/neverRejects/avgDurationMs (else 0)", () => {
    const empty = createAutoReviewProjectionUnit();
    expect(empty.wire!.view(empty.init())).toMatchObject({
      fallbacks: 0,
      neverRejects: 0,
      avgDurationMs: 0,
    });

    const live = {
      allows: 1,
      denies: 2,
      verdictsUsed: 4,
      failuresUsed: 0,
      fallbacks: 7,
      neverRejects: 2,
      avgDurationMs: 42,
      recentDenies: [],
    };
    const unit = createAutoReviewProjectionUnit({
      readLiveStats: () => live,
    });
    const snap = unit.wire!.view(unit.init());
    expect(snap.fallbacks).toBe(7);
    expect(snap.neverRejects).toBe(2);
    expect(snap.avgDurationMs).toBe(42);
  });

  it("keeps fold counters when no live reader is wired", () => {
    const unit = createAutoReviewProjectionUnit();
    let state = unit.init();
    state = {
      ...state,
      allows: 1,
      denies: 4,
      fallbacks: 3,
      neverRejects: 4,
      verdictsUsed: 5,
      totalDurationMs: 100,
      verdictSamples: 2,
      recentDenies: [{ reviewId: "x", toolName: "rm" }],
    };
    const snap = unit.wire!.view(state);
    expect(snap.allows).toBe(1);
    expect(snap.denies).toBe(4);
    expect(snap.fallbacks).toBe(3);
    expect(snap.neverRejects).toBe(4);
    expect(snap.avgDurationMs).toBe(50);
    expect(snap.verdictsUsed).toBe(5);
    expect(snap.recentDenies).toEqual([{ reviewId: "x", toolName: "rm" }]);
    expect(snap.circuit).toBeNull();
  });
});
