import { describe, expect, it } from "vitest";
import { createContextTimelineProjectionUnit } from "../src/projections/units/context-timeline.js";

describe("contextTimeline projection", () => {
  it("always views a dsh-context-valid shape from init", () => {
    const unit = createContextTimelineProjectionUnit();
    const view = unit.wire!.view(unit.init());
    expect(view.current.total).toBe(0);
    expect(Array.isArray(view.requests)).toBe(true);
    expect(Array.isArray(view.events)).toBe(true);
    expect(Array.isArray(view.nodes)).toBe(true);
    expect(Array.isArray(view.archive)).toBe(true);
    expect(Array.isArray(view.toolList)).toBe(true);
  });
});
