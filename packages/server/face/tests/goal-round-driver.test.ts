import { describe, expect, it } from "vitest";
import {
  decideGoalTurnEnd,
  renderGoalRoundPrompt,
} from "../src/goal-round-driver.js";

const base = {
  objective: "ship exporter",
  phase: "active" as const,
  activation: "armed" as const,
  maxGoalRounds: 4,
  roundsStarted: 1,
};

describe("goal-round-driver", () => {
  it("renders a retained <goal_round> prompt", () => {
    const text = renderGoalRoundPrompt(base, 2);
    expect(text).toContain("<goal_round>");
    expect(text).toContain('Objective: "ship exporter"');
    expect(text).toContain("Round: 2/4");
    expect(text).toContain("update_goal");
  });

  it("continues when armed under the round cap", () => {
    const decision = decideGoalTurnEnd({
      goal: base,
      hasPendingAdmits: false,
      turnReasonKind: "completed",
    });
    expect(decision.kind).toBe("continue");
    if (decision.kind === "continue") {
      expect(decision.round).toBe(2);
      expect(decision.prompt).toContain("Round: 2/4");
    }
  });

  it("blocks at maxGoalRounds", () => {
    const decision = decideGoalTurnEnd({
      goal: { ...base, roundsStarted: 4 },
      hasPendingAdmits: false,
    });
    expect(decision).toMatchObject({
      kind: "block",
      code: "max-rounds",
    });
  });

  it("disarms on max-tokens turn end", () => {
    const decision = decideGoalTurnEnd({
      goal: base,
      hasPendingAdmits: false,
      turnReasonKind: "max-tokens",
    });
    expect(decision).toMatchObject({
      kind: "disarm",
      code: "max-tokens",
    });
  });

  it("no-ops when disarmed or complete", () => {
    expect(
      decideGoalTurnEnd({
        goal: { ...base, activation: "disarmed" },
        hasPendingAdmits: false,
      }).kind,
    ).toBe("noop");
    expect(
      decideGoalTurnEnd({
        goal: { ...base, phase: "complete" },
        hasPendingAdmits: false,
      }).kind,
    ).toBe("noop");
  });
});
