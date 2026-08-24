import { describe, expect, it } from "vitest";
import { createCostUsageProjectionUnit } from "../src/projections/units/cost-usage.js";

describe("costUsage projection", () => {
  it("estimates non-zero cost from request/header route + usage", () => {
    const unit = createCostUsageProjectionUnit();
    let state = unit.init();

    state = unit.apply(state, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-chat" },
      },
    });
    state = unit.apply(state, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 1000, outputTokens: 200 },
    });

    const view = unit.wire!.view(state);
    expect(view.input).toBe(1000);
    expect(view.output).toBe(200);
    expect(view.cost).toBeGreaterThan(0);
    expect(view.byProviderModel["deepseek:deepseek-chat"]?.cost).toBeGreaterThan(
      0,
    );
  });
});
