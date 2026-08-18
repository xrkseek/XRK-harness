import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createStdTools,
  createToolRegistry,
  runToolDetailed,
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

describe("Face plan mode", () => {
  it("pins inactive plan projection; /plan commits between turns", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
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
        result: { kind: "success", text: "Plan mode on. Use /plan off to leave." },
      });
    }
    expect(runtime.projections.snapshot(sessionId).values.plan).toEqual({
      active: true,
      pending: false,
    });
    const types = runtime.store.get(sessionId).events.map((e) => e.type);
    expect(types).toContain("command/run");
    expect(types).toContain("plan/mode");
    expect(types.lastIndexOf("command/run")).toBeLessThan(
      types.lastIndexOf("plan/mode"),
    );

    const off = await dispatchFaceMethod(runtime, "commands/execute", "e2", {
      args: { agentId: sessionId, line: "/plan off" },
    });
    expect(off.result.ok).toBe(true);
    expect(runtime.projections.snapshot(sessionId).values.plan).toEqual({
      active: false,
      pending: false,
    });
  });

  it("/plan <message> steers the suffix", async () => {
    const store = createMemorySessionStore();
    const runtime = bareRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/plan draft the migration" },
    });
    expect(exec.result.ok).toBe(true);
    expect(runtime.projections.snapshot(sessionId).values.plan).toMatchObject({
      active: true,
    });
    expect(
      store.get(sessionId).events.some((e) => e.type === "prompt/admitted"),
    ).toBe(true);
  });

  it("exit_plan_mode asks plan-review and exits on Approve", async () => {
    const store = createMemorySessionStore();
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: async (sessionId) => {
        const handle = await admittingAgentResolve(store)(sessionId);
        return { ...handle, tools };
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await dispatchFaceMethod(runtime, "commands/execute", "p", {
      args: { agentId: sessionId, line: "/plan" },
    });

    await runtime.resolveAgent(sessionId);

    const runPromise = runToolDetailed({
      registry: tools,
      call: {
        id: "c1",
        name: "exit_plan_mode",
        arguments: { plan: "# Ship it\n\nDo the work." },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const pending = runtime.questions.listPending(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.questions[0]?.intent).toEqual({
      kind: "plan-review",
      approve: "Approve",
    });
    const rpcId = pending[0]!.rpcId;
    runtime.questions.respondByRpcId(rpcId, {
      ok: true,
      value: {
        sessionId,
        answer: {
          answers: [{ id: "plan-review", selected: ["Approve"] }],
        },
      },
    });
    const out = await runPromise;
    expect(out.result.isError).toBeFalsy();
    expect(out.result.content).toContain("Plan approved");
    expect(out.toolEvents.some((e) => e.type === "plan/mode")).toBe(true);
  });
});
