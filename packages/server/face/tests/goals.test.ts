import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  listPendingAdmits,
  newSession,
} from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { DEFAULT_MAX_GOAL_ROUNDS } from "../src/goal-store.js";

function bareRuntime(
  store = createMemorySessionStore(),
  extra?: { goalPersistPath?: string },
) {
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
    drain: {
      wake() {},
      async cancel() {},
      isActive() {
        return false;
      },
    },
    resolveAgent: async () => {
      throw new Error("unused");
    },
    ...extra,
  });
}

describe("goals remotes", () => {
  it("creates a projection, CAS-pauses, and /goal logs a command pair", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const runtime = bareRuntime(store);

    const created = await dispatchFaceMethod(runtime, "goals/create", "g1", {
      args: {
        agentId: session.id,
        request: { objective: "ship the exporter", maxGoalRounds: 3 },
      },
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const ref = (created.result.value as { ref: { id: string; revision: number } })
      .ref;
    expect(ref.revision).toBe(1);
    const snap = runtime.projections.snapshot(session.id).values.goal as {
      goal: { phase: string; objective: string; roundsStarted: number };
    };
    expect(snap.goal.phase).toBe("active");
    expect(snap.goal.objective).toBe("ship the exporter");
    expect(snap.goal.roundsStarted).toBe(1);
    expect(
      store.get(session.id).events.some((e) => e.type === "prompt/admitted"),
    ).toBe(true);

    const paused = await dispatchFaceMethod(runtime, "goals/pause", "g2", {
      args: { agentId: session.id, ref },
    });
    expect(paused.result.ok).toBe(true);
    if (!paused.result.ok) return;
    const pausedView = paused.result.value as { phase: string; revision: number };
    expect(pausedView.phase).toBe("paused");
    expect(pausedView.revision).toBe(2);

    const stale = await dispatchFaceMethod(runtime, "goals/resume", "g3", {
      args: { agentId: session.id, ref },
    });
    expect(stale.result.ok).toBe(false);

    const session2 = newSession(store);
    const slash = await dispatchFaceMethod(runtime, "commands/execute", "c1", {
      args: { agentId: session2.id, line: "/goal write tests" },
    });
    expect(slash.result.ok).toBe(true);
    const types = store.get(session2.id).events.map((e) => e.type);
    expect(types).toContain("command/run");
    expect(types).toContain("command/done");
    expect(runtime.goals.get(session2.id)?.objective).toBe("write tests");
    expect(runtime.goals.get(session2.id)?.maxGoalRounds).toBe(
      DEFAULT_MAX_GOAL_ROUNDS,
    );
  });

  it("blocks after maxGoalRounds on turn/end", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const runtime = bareRuntime(store);
    const created = await dispatchFaceMethod(runtime, "goals/create", "g1", {
      args: {
        agentId: session.id,
        request: { objective: "tiny", maxGoalRounds: 1 },
      },
    });
    expect(created.result.ok).toBe(true);
    const pending = listPendingAdmits(store.get(session.id).events, session.id);
    expect(pending.length).toBeGreaterThan(0);
    store.append(session.id, {
      type: "prompt/promoted",
      ts: 9,
      admitId: pending[0]!.admitId,
    });
    store.append(session.id, {
      type: "turn/start",
      ts: 10,
      turnId: "t-end",
    });
    store.append(session.id, {
      type: "turn/end",
      ts: 11,
      turnId: "t-end",
    });
    const goal = runtime.goals.get(session.id);
    expect(goal?.phase).toBe("blocked");
    expect(goal?.blockedReason?.code).toBe("max-rounds");
  });

  it("rehydrates from goals.json without starting another round", async () => {
    const persist = path.join(mkdtempSync(path.join(tmpdir(), "xrk-goals-")), "goals.json");
    const store = createMemorySessionStore();
    const session = newSession(store);
    const first = bareRuntime(store, { goalPersistPath: persist });
    const created = await dispatchFaceMethod(first, "goals/create", "g1", {
      args: { agentId: session.id, request: { objective: "persist me" } },
    });
    expect(created.result.ok).toBe(true);
    const saved = first.goals.get(session.id);
    expect(saved?.roundsStarted).toBe(1);
    const disk = JSON.parse(readFileSync(persist, "utf8")) as {
      goals: Record<string, { objective: string }>;
    };
    expect(disk.goals[session.id]?.objective).toBe("persist me");

    const admitsBefore = listPendingAdmits(
      store.get(session.id).events,
      session.id,
    ).length;
    const second = bareRuntime(store, { goalPersistPath: persist });
    const restored = second.goals.get(session.id);
    expect(restored?.id).toBe(saved?.id);
    expect(restored?.revision).toBe(saved?.revision);
    expect(restored?.roundsStarted).toBe(1);
    expect(restored?.objective).toBe("persist me");
    expect(
      listPendingAdmits(store.get(session.id).events, session.id).length,
    ).toBe(admitsBefore);
    const snap = second.projections.snapshot(session.id).values.goal as {
      goal: { id: string };
    };
    expect(snap.goal.id).toBe(saved?.id);
  });
});
