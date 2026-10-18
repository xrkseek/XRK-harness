import { afterEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  countSessionsUsingModel,
  modelSessionCapProblem,
  reserveModelSessionSlot,
  resetModelSessionCapPendingForTests,
} from "../src/model-session-cap.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
  idleFaceDrain,
} from "./helpers/bare-runtime.js";
import type { CreateFaceRuntimeOptions } from "../src/runtime.js";

afterEach(() => {
  resetModelSessionCapPendingForTests();
});

/** Drain that marks chosen session ids as active for occupancy tests. */
function activeDrain(
  active: ReadonlySet<string>,
): CreateFaceRuntimeOptions["drain"] {
  return {
    ...idleFaceDrain,
    isActive(sessionId: string) {
      return active.has(sessionId);
    },
  };
}

describe("model session cap", () => {
  it("refuses session.create when a running session already fills the route", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      drain: activeDrain(active),
      resolveAgent: admittingAgentResolve(store),
    });
    const cap = await dispatchFaceMethod(runtime, "settings.mutate", "cap", {
      ns: "agent-loop",
      ops: [
        {
          op: "set",
          path: ["maxConcurrentModelSessions"],
          value: 1,
        },
      ],
    });
    expect(cap.result.ok).toBe(true);

    const coding = runtime.workspaces.create(
      `${runtime.workspaceRoot}/cap-code`,
    ).workspace;
    const first = await dispatchFaceMethod(runtime, "session.create", "c1", {
      workspaceId: coding.workspaceId,
      agentPreset: "harness",
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) return;
    active.add(first.result.value.sessionId);

    const second = await dispatchFaceMethod(runtime, "session.create", "c2", {
      workspaceId: coding.workspaceId,
      agentPreset: "harness",
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(second.result.ok).toBe(false);
    if (!second.result.ok) {
      expect(second.result.error.code).toBe("model-session-cap");
      expect(second.result.error.message).toMatch(/deepseek\/deepseek-flash/);
      expect(second.result.error.details).toMatchObject({
        provider: "deepseek",
        model: "deepseek-flash",
        using: 1,
        max: 1,
      });
    }
  });

  it("counts pending reserves so parallel admits cannot overshoot", () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    const route = { provider: "deepseek", model: "deepseek-flash" };
    // Force ceiling 1 via empty store + pending.
    runtime.settingsNamespaces.ensure("agent-loop").user = {
      maxConcurrentModelSessions: 1,
    };
    const a = reserveModelSessionSlot(runtime, route);
    expect(a.ok).toBe(true);
    const b = reserveModelSessionSlot(runtime, route);
    expect(b.ok).toBe(false);
    if (a.ok) a.release();
    expect(modelSessionCapProblem(runtime, route)).toBeUndefined();
  });

  it("does not count blank or idle history against the cap", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    await dispatchFaceMethod(runtime, "settings.mutate", "cap-idle", {
      ns: "agent-loop",
      ops: [
        {
          op: "set",
          path: ["maxConcurrentModelSessions"],
          value: 1,
        },
      ],
    });
    const coding = runtime.workspaces.create(
      `${runtime.workspaceRoot}/cap-idle`,
    ).workspace;
    const first = await dispatchFaceMethod(runtime, "session.create", "idle1", {
      workspaceId: coding.workspaceId,
      agentPreset: "harness",
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(first.result.ok).toBe(true);

    // Blank (drain idle) must not hold the only slot.
    const second = await dispatchFaceMethod(runtime, "session.create", "idle2", {
      workspaceId: coding.workspaceId,
      agentPreset: "harness",
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(second.result.ok).toBe(true);
  });

  it("allows an independent provider/model route at the same time", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      drain: activeDrain(active),
      resolveAgent: admittingAgentResolve(store),
    });
    await dispatchFaceMethod(runtime, "settings.mutate", "cap2", {
      ns: "agent-loop",
      ops: [
        {
          op: "set",
          path: ["maxConcurrentModelSessions"],
          value: 1,
        },
      ],
    });
    const coding = runtime.workspaces.create(
      `${runtime.workspaceRoot}/cap-routes`,
    ).workspace;
    const a = await dispatchFaceMethod(runtime, "session.create", "r1", {
      workspaceId: coding.workspaceId,
      agentPreset: "harness",
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(a.result.ok).toBe(true);
    if (a.result.ok) active.add(a.result.value.sessionId);
    const b = await dispatchFaceMethod(runtime, "session.create", "r2", {
      workspaceId: coding.workspaceId,
      agentPreset: "harness",
      provider: "openai",
      model: "gpt-4o",
    });
    // openai may be unavailable as a catalog brand — cap still admits the slot;
    // create itself should succeed (pin is in-memory).
    expect(b.result.ok).toBe(true);
  });

  it("stress: 12 live sessions cannot overshoot a cap of 3 when switching routes", () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      drain: activeDrain(active),
    });
    runtime.settingsNamespaces.ensure("agent-loop").user = {
      maxConcurrentModelSessions: 3,
    };
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = store.create(`switch-${i}`).id;
      runtime.sessionModels.set(id, {
        provider: "deepseek",
        model: "deepseek-flash",
      });
      active.add(id);
      ids.push(id);
    }
    const target = { provider: "deepseek", model: "deepseek-v4-pro" };
    let admitted = 0;
    let refused = 0;
    for (const id of ids) {
      const slot = reserveModelSessionSlot(runtime, target, {
        excludeSessionId: id,
      });
      if (!slot.ok) {
        refused += 1;
        continue;
      }
      runtime.sessionModels.set(id, target);
      slot.release();
      admitted += 1;
    }
    expect(admitted).toBe(3);
    expect(refused).toBe(9);
    expect(countSessionsUsingModel(runtime, target.provider, target.model)).toBe(3);
    expect(
      countSessionsUsingModel(runtime, "deepseek", "deepseek-flash"),
    ).toBe(9);
  });
});
