import { describe, expect, it } from "vitest";
import { sessionStatsProjectionDefinition as def } from "../src/projection.js";

type Ev = Parameters<typeof def.apply>[1];

function ev(partial: {
  type: Ev["type"];
  time: number;
  data?: Record<string, unknown>;
}): Ev {
  return {
    type: partial.type,
    time: partial.time,
    data: (partial.data ?? {}) as Ev["data"],
  } as Ev;
}

describe("sessionStats live view", () => {
  it("surfaces the open step before step/end", () => {
    let state = def.init();
    state = def.apply(
      state,
      ev({ type: "step/start", time: 10, data: { turn: 1, step: 1 } }),
    );
    expect(def.view(state)).toMatchObject({ turns: 1, steps: 1 });

    state = def.apply(
      state,
      ev({
        type: "assistant/message",
        time: 40,
        data: { turn: 1, step: 1, usage: { outputTokens: 3 } },
      }),
    );
    // Still live — no dip between assemble and step/end.
    expect(def.view(state)).toMatchObject({ turns: 1, steps: 1 });
    expect(state.llmMs).toBe(30);

    state = def.apply(
      state,
      ev({ type: "step/end", time: 41, data: { turn: 1, step: 1 } }),
    );
    expect(def.view(state)).toMatchObject({ turns: 1, steps: 1 });
    expect(state.openStep).toBeNull();
  });

  it("does not double-count a second step in the same turn until closed", () => {
    let state = def.init();
    state = def.apply(
      state,
      ev({ type: "step/start", time: 1, data: { turn: 1, step: 1 } }),
    );
    state = def.apply(
      state,
      ev({ type: "step/end", time: 2, data: { turn: 1, step: 1 } }),
    );
    expect(def.view(state)).toMatchObject({ turns: 1, steps: 1 });

    state = def.apply(
      state,
      ev({ type: "step/start", time: 3, data: { turn: 1, step: 2 } }),
    );
    // Same turn already counted — only steps bump live.
    expect(def.view(state)).toMatchObject({ turns: 1, steps: 2 });
  });

  it("ignores duplicate assistant/message on an assembled open step", () => {
    let state = def.init();
    state = def.apply(
      state,
      ev({ type: "step/start", time: 10, data: { turn: 2, step: 1 } }),
    );
    state = def.apply(
      state,
      ev({
        type: "assistant/message",
        time: 20,
        data: { turn: 2, step: 1, usage: { outputTokens: 1 } },
      }),
    );
    const afterFirst = state.llmMs;
    state = def.apply(
      state,
      ev({
        type: "assistant/message",
        time: 99,
        data: { turn: 2, step: 1, usage: { outputTokens: 9 } },
      }),
    );
    expect(state.llmMs).toBe(afterFirst);
    expect(def.view(state)).toMatchObject({ turns: 1, steps: 1 });
  });
});
