import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  createSessionProjectionRegistry,
  type ProjectionDefinition,
} from "../src/index.js";

function userMessage(ts: number, content: string): SessionEvent {
  return {
    type: "user/message",
    ts,
    turnId: `t-${ts}`,
    content,
  };
}

describe("createSessionProjectionRegistry", () => {
  it("keeps host-only keys off snapshot and onChanged; stateOf reads fold state", () => {
    const events: SessionEvent[] = [];
    const registry = createSessionProjectionRegistry({
      getEvents: () => events,
    });

    const hostOnly: ProjectionDefinition<"secret", { n: number }> = {
      key: "secret",
      stateVersion: 1,
      init: () => ({ n: 0 }),
      apply(state, event) {
        if (event.type !== "user/message") return state;
        return { n: state.n + 1 };
      },
    };
    const wired: ProjectionDefinition<"visible", { n: number }, number> = {
      key: "visible",
      stateVersion: 1,
      init: () => ({ n: 0 }),
      apply(state, event) {
        if (event.type !== "user/message") return state;
        return { n: state.n + 1 };
      },
      wire: {
        view: (state) => state.n,
        parse(value) {
          if (typeof value !== "number") throw new Error("expected number");
          return value;
        },
      },
    };

    registry.register(hostOnly);
    registry.register(wired);

    const changes: { key: string; value: unknown }[] = [];
    registry.onChanged((_id, key, value) => {
      changes.push({ key, value });
    });

    const ev = userMessage(1, "hi");
    events.push(ev);
    registry.drive("s1", ev, 1);

    expect(registry.snapshot("s1").values).toEqual({ visible: 1 });
    expect(registry.snapshot("s1").values).not.toHaveProperty("secret");
    expect(changes.map((c) => c.key)).toEqual(["visible"]);
    expect(registry.stateOf("s1", "secret")).toEqual({ n: 1 });
    expect(registry.stateOf("s1", "visible")).toEqual({ n: 1 });
    expect(registry.stateOf("s1", "missing")).toBeUndefined();

    const cp = registry.checkpoint("s1");
    expect(cp.secret?.val).toEqual({ n: 1 });
    expect(cp.visible?.val).toEqual({ n: 1 });
    expect(registry.viewCheckpoint(cp)).toEqual({ visible: 1 });
    expect(registry.viewCheckpoint(cp)).not.toHaveProperty("secret");
  });

  it("restoreFloor + restore cold-fold a usable checkpoint tail (DSH ladder)", () => {
    const events: SessionEvent[] = [];
    const registry = createSessionProjectionRegistry({
      getEvents: () => events,
    });
    registry.register({
      key: "count",
      stateVersion: 1,
      init: () => ({ n: 0 }),
      apply(state, event) {
        if (event.type !== "user/message") return state;
        return { n: state.n + 1 };
      },
      wire: {
        view: (s) => s.n,
        parse: (v) => Number(v),
      },
    });

    for (const ts of [1, 2]) {
      const ev = userMessage(ts, `m${ts}`);
      events.push(ev);
      registry.drive("s1", ev, ts);
    }
    expect(registry.snapshot("s1").values.count).toBe(2);
    const cp = registry.checkpoint("s1");
    expect(cp.count?.seq).toBe(2);

    const floor = registry.restoreFloor(cp);
    expect(floor).toBe(2);
    const third = userMessage(3, "m3");
    const cold = registry.restore(cp, [third], 3);
    expect(cold.snapshot.values.count).toBe(3);
    expect(cold.checkpoint.count?.seq).toBe(3);
    expect(cold.checkpoint.count?.val).toEqual({ n: 3 });
  });

  it("restore throws when baseSeq>0 and checkpoint row is unusable", () => {
    const registry = createSessionProjectionRegistry({
      getEvents: () => [],
    });
    registry.register({
      key: "count",
      stateVersion: 2,
      init: () => ({ n: 0 }),
      apply: (state) => state,
      wire: {
        view: (s) => s.n,
        parse: (v) => Number(v),
      },
    });
    expect(() =>
      registry.restore(
        { count: { ver: 1, seq: 0, val: { n: 9 } } },
        [userMessage(1, "x")],
        1,
      ),
    ).toThrow(/re-read from seq 0/);
  });

  it("stays quiet when apply returns the same reference", () => {
    const events: SessionEvent[] = [];
    const registry = createSessionProjectionRegistry({
      getEvents: () => events,
    });
    registry.register({
      key: "quiet",
      stateVersion: 1,
      init: () => ({ ok: true }),
      apply: (state) => state,
      wire: {
        view: (state) => state.ok,
        parse: (v) => Boolean(v),
      },
    });
    const changes: string[] = [];
    registry.onChanged((_id, key) => changes.push(key));
    const ev = userMessage(1, "x");
    events.push(ev);
    registry.drive("s1", ev, 1);
    expect(changes).toEqual([]);
  });

  it("late register folds history before first drive", () => {
    const events: SessionEvent[] = [userMessage(1, "a"), userMessage(2, "b")];
    const registry = createSessionProjectionRegistry({
      getEvents: () => events,
    });
    registry.register({
      key: "count",
      stateVersion: 1,
      init: () => ({ n: 0 }),
      apply(state, event) {
        if (event.type !== "user/message") return state;
        return { n: state.n + 1 };
      },
      wire: {
        view: (s) => s.n,
        parse: (v) => Number(v),
      },
    });
    expect(registry.snapshot("s1").values.count).toBe(2);
  });
});
