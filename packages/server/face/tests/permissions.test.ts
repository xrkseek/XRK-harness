import { describe, expect, it, vi } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "@xrkseek/core-tools";
import { createReadOnlyToolPre } from "@xrkseek/policy";
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

describe("Face permission presets", () => {
  it("pins workspace-write on session.create and projects permissions", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    expect(runtime.store.get(sessionId).events.map((e) => e.type)).toEqual([
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
    ]);

    const snap = runtime.projections.snapshot(sessionId).values.permissions as {
      currentValue: string;
      options: { value: string }[];
    };
    expect(snap.currentValue).toBe("workspace-write");
    expect(snap.options.map((o) => o.value)).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
  });

  it("/permission switches preset; empty reports current; unknown errors", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const empty = await dispatchFaceMethod(runtime, "commands/execute", "e0", {
      args: { agentId: sessionId, line: "/permission" },
    });
    expect(empty.result.ok).toBe(true);
    if (empty.result.ok) {
      expect(empty.result.value).toMatchObject({
        result: {
          kind: "success",
          text: expect.stringContaining("workspace-write"),
        },
      });
    }

    const ro = await dispatchFaceMethod(runtime, "commands/execute", "e1", {
      args: { agentId: sessionId, line: "/permission read-only" },
    });
    expect(ro.result.ok).toBe(true);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "read-only" });

    const again = await dispatchFaceMethod(runtime, "commands/execute", "e2", {
      args: { agentId: sessionId, line: "/permission read-only" },
    });
    expect(again.result.ok).toBe(true);
    const presets = runtime.store
      .get(sessionId)
      .events.filter((e) => e.type === "permission/preset");
    expect(presets).toHaveLength(2);

    const bad = await dispatchFaceMethod(runtime, "commands/execute", "e3", {
      args: { agentId: sessionId, line: "/permission not-a-preset" },
    });
    expect(bad.result.ok).toBe(true);
    if (bad.result.ok) {
      expect(bad.result.value).toMatchObject({
        result: { kind: "error", text: expect.stringContaining("unknown preset") },
      });
    }

    const danger = await dispatchFaceMethod(runtime, "commands/execute", "e4", {
      args: { agentId: sessionId, line: "/permission danger-full-access" },
    });
    expect(danger.result.ok).toBe(true);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });
  });

  it("refuses sandbox mode change while hasPtyActivity is true", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      hasPtyActivity: () => true,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const blocked = await dispatchFaceMethod(runtime, "commands/execute", "b", {
      args: { agentId: sessionId, line: "/permission read-only" },
    });
    expect(blocked.result.ok).toBe(true);
    if (blocked.result.ok) {
      expect(blocked.result.value).toMatchObject({
        result: {
          kind: "error",
          text: expect.stringContaining("cannot change sandbox mode"),
        },
      });
    }
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "workspace-write" });
  });

  it("approval never auto-allows without approval/requested", async () => {
    const store = createMemorySessionStore();
    const mux: unknown[] = [];
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    runtime.bus.subscribeMux((_id, frame) => mux.push(frame));

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    await dispatchFaceMethod(runtime, "commands/execute", "sw", {
      args: { agentId: sessionId, line: "/permission danger-full-access" },
    });

    const pipeline = createToolPipeline();
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "ran" }));
    reg.register({
      name: "danger",
      description: "d",
      parameters: {},
      execute: body,
    });
    pipeline.onPre(async () => ({ action: "ask", reason: "need human" }));

    const out = await runToolDetailed({
      registry: reg,
      call: { id: "call_1", name: "danger", arguments: {} },
      pipeline,
    });
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("ran");
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);
    expect(
      mux.some(
        (f) =>
          typeof f === "object" &&
          f !== null &&
          (f as { type?: string }).type === "approval/requested",
      ),
    ).toBe(false);
  });

  it("read-only pre denies apply_edit", async () => {
    const pipeline = createToolPipeline();
    pipeline.onPre(createReadOnlyToolPre());
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "wrote" }));
    reg.register({
      name: "apply_edit",
      description: "w",
      parameters: {},
      execute: body,
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "c", name: "apply_edit", arguments: {} },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.result.isError).toBe(true);
  });
});
