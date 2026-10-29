import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createStdTools,
  createToolRegistry,
} from "@xrkseek/core-tools";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createBareFaceRuntime({
    store,
    resolveAgent: admittingAgentResolve(store),
  });
}

describe("Face plan mode (retired)", () => {
  it("legacy plan agentPreset maps to harness without seeding plan mode", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      cwd: runtime.workspaceRoot,
      agentPreset: "plan",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    expect((created.result.value as { agentPreset?: string }).agentPreset).toBe(
      "harness",
    );
    expect(runtime.projections.snapshot(sessionId).values.plan).toEqual({
      active: false,
      pending: false,
    });
  });

  it("/plan replies retired and does not commit plan/mode", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      cwd: runtime.workspaceRoot,
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    expect(runtime.projections.snapshot(sessionId).values.plan).toEqual({
      active: false,
      pending: false,
    });

    const on = await dispatchFaceMethod(runtime, "commands/execute", "e1", {
      args: { agentId: sessionId, line: "/plan" },
    });
    expect(on.result.ok).toBe(true);
    if (on.result.ok) {
      expect(on.result.value).toMatchObject({
        result: {
          kind: "success",
          text: expect.stringContaining("Plan mode is retired"),
        },
      });
    }
    expect(runtime.projections.snapshot(sessionId).values.plan).toEqual({
      active: false,
      pending: false,
    });
    const types = runtime.store.get(sessionId).events.map((e) => e.type);
    expect(types).toContain("command/run");
    // Settles pending from command/run — inactive only, never activate.
    expect(types).toContain("plan/mode");
    const mode = runtime.store
      .get(sessionId)
      .events.filter((e) => e.type === "plan/mode")
      .at(-1) as { active?: boolean } | undefined;
    expect(mode?.active).toBe(false);
  });

  it("/plan <message> does not steer or activate plan", async () => {
    const store = createMemorySessionStore();
    const runtime = bareRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      cwd: runtime.workspaceRoot,
    });
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/plan draft the migration" },
    });
    expect(exec.result.ok).toBe(true);
    expect(runtime.projections.snapshot(sessionId).values.plan).toEqual({
      active: false,
      pending: false,
    });
    expect(
      store.get(sessionId).events.some((e) => e.type === "prompt/admitted"),
    ).toBe(false);
  });

  it("bindSessionAgent unregisters exit_plan_mode from std catalog", async () => {
    const store = createMemorySessionStore();
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    expect(tools.get("exit_plan_mode")).toBeTruthy();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: async (sessionId) => {
        const handle = await admittingAgentResolve(store)(sessionId);
        return { ...handle, tools };
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      cwd: runtime.workspaceRoot,
    });
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await runtime.resolveAgent(sessionId);
    expect(tools.get("exit_plan_mode")).toBeUndefined();
  });
});
