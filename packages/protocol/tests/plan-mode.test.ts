import { describe, expect, it } from "vitest";
import {
  applyPlanUnitEvent,
  foldPlanMode,
  foldPlanUnit,
  pendingPlanTarget,
  viewPlanProjection,
  type SessionEvent,
} from "../src/index.js";

function ev(partial: SessionEvent): SessionEvent {
  return partial;
}

describe("foldPlanMode", () => {
  it("empty log is inactive; last plan/mode wins", () => {
    expect(foldPlanMode([])).toBe(false);
    expect(
      foldPlanMode([
        ev({ type: "plan/mode", ts: 1, active: true }),
        ev({ type: "plan/mode", ts: 2, active: false }),
        ev({ type: "plan/mode", ts: 3, active: true }),
      ]),
    ).toBe(true);
  });
});

describe("plan unit fold", () => {
  it("command/run plan with args queues until plan/mode", () => {
    let state = foldPlanUnit([]);
    expect(viewPlanProjection(state)).toEqual({ active: false, pending: false });

    state = applyPlanUnitEvent(
      state,
      ev({
        type: "command/run",
        ts: 1,
        commandId: "c1",
        name: "plan",
        args: "",
        source: { kind: "user" },
      }),
    );
    expect(viewPlanProjection(state)).toEqual({ active: false, pending: true });

    const events: SessionEvent[] = [
      {
        type: "command/run",
        ts: 1,
        commandId: "c1",
        name: "plan",
        args: "",
        source: { kind: "user" },
      },
    ];
    expect(pendingPlanTarget(events)).toBe(true);

    events.push({ type: "plan/mode", ts: 2, active: true });
    expect(viewPlanProjection(foldPlanUnit(events))).toEqual({
      active: true,
      pending: false,
    });
    expect(pendingPlanTarget(events)).toBeNull();
  });

  it("omitted args and off args", () => {
    const active: SessionEvent[] = [{ type: "plan/mode", ts: 1, active: true }];
    active.push({
      type: "command/run",
      ts: 2,
      commandId: "c2",
      name: "plan",
      source: { kind: "user" },
    });
    expect(viewPlanProjection(foldPlanUnit(active))).toEqual({
      active: true,
      pending: false,
    });
    active.push({
      type: "command/run",
      ts: 3,
      commandId: "c3",
      name: "plan",
      args: " off",
      source: { kind: "user" },
    });
    expect(viewPlanProjection(foldPlanUnit(active))).toEqual({
      active: true,
      pending: true,
    });
    expect(pendingPlanTarget(active)).toBe(false);
  });
});
