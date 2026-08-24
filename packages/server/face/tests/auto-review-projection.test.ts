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
});
