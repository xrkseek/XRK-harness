import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

async function isolatedRuntime(store = createMemorySessionStore()) {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-face-approval-"));
  return createFaceRuntime({
    store,
    workspaceRoot: root,
    productDir: root,
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

describe("Face approval ask/respond", () => {
  it("request waits until session.respondApproval", async () => {
    const store = createMemorySessionStore();
    const mux: unknown[] = [];
    const runtime = await isolatedRuntime(store);
    runtime.bus.subscribeMux((_id, frame) => mux.push(frame));

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

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

    const runPromise = runToolDetailed({
      registry: reg,
      call: { id: "call_1", name: "danger", arguments: { x: 1 } },
      pipeline,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(1);
    const approvalId = runtime.approvals.listPending(sessionId)[0]!.approvalId;
    expect(
      store.get(sessionId).events.some((e) => e.type === "approval/asked"),
    ).toBe(true);
    expect(
      mux.some(
        (f) =>
          typeof f === "object" &&
          f !== null &&
          (f as { type?: string }).type === "approval/requested",
      ),
    ).toBe(true);

    const responded = await dispatchFaceMethod(
      runtime,
      "session.respondApproval",
      "r1",
      { sessionId, approvalId, decision: "allow" },
    );
    expect(responded.result.ok).toBe(true);

    const out = await runPromise;
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("ran");
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);
    expect(
      store.get(sessionId).events.some(
        (e) =>
          e.type === "approval/decided" &&
          e.decision === "allow",
      ),
    ).toBe(true);
  });

  it("deny skips tool body", async () => {
    const store = createMemorySessionStore();
    const runtime = await isolatedRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c2", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const pipeline = createToolPipeline();
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "nope" }));
    reg.register({
      name: "danger",
      description: "d",
      parameters: {},
      execute: body,
    });
    pipeline.onPre(async () => ({ action: "ask", reason: "no" }));

    const runPromise = runToolDetailed({
      registry: reg,
      call: { id: "c", name: "danger", arguments: {} },
      pipeline,
    });
    await new Promise((r) => setTimeout(r, 20));
    const approvalId = runtime.approvals.listPending(sessionId)[0]!.approvalId;
    await dispatchFaceMethod(runtime, "session.respondApproval", "r2", {
      sessionId,
      approvalId,
      decision: "deny",
    });
    const out = await runPromise;
    expect(body).not.toHaveBeenCalled();
    expect(out.skippedBody).toBe(true);
    expect(out.result.isError).toBe(true);
  });

  it("POST-equivalent respondByRpcId settles allow", async () => {
    const store = createMemorySessionStore();
    const mux: unknown[] = [];
    const runtime = await isolatedRuntime(store);
    runtime.bus.subscribeMux((_id, frame) => mux.push(frame));

    const created = await dispatchFaceMethod(runtime, "session.create", "c3", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

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

    const runPromise = runToolDetailed({
      registry: reg,
      call: { id: "call_r", name: "danger", arguments: {} },
      pipeline,
    });
    await new Promise((r) => setTimeout(r, 20));
    const pending = runtime.approvals.listPending(sessionId)[0]!;
    const requested = mux.find(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        (f as { type?: string }).type === "approval/requested",
    ) as { type: string; approvalId: string };
    expect(requested.approvalId).toBe(pending.approvalId);

    const receipt = runtime.approvals.respondByRpcId(pending.rpcId, {
      sessionId,
      approvalId: pending.approvalId,
      outcome: "allowed-once",
    });
    expect(receipt).toEqual({ accepted: true });
    expect(runtime.approvals.respondByRpcId(pending.rpcId, {})).toEqual({
      accepted: false,
      reason: "not-pending",
    });

    const out = await runPromise;
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("ran");
    expect(
      mux.some(
        (f) =>
          typeof f === "object" &&
          f !== null &&
          (f as { type?: string }).type === "approval/resolved",
      ),
    ).toBe(true);
  });
});
