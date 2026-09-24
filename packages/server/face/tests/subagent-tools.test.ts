import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import {
  bindSubagentTools,
  subagentDepth,
} from "../src/subagent-tools.js";
import type { FaceDrain } from "../src/context.js";
import type { AgentHandle } from "@xrkseek/core-agent";

function stubAgent(): AgentHandle {
  return {
    admit(content, options) {
      return {
        admitId: options?.admitId ?? "a",
        sessionId: "s",
        content,
        delivery: options?.delivery ?? "queue",
      };
    },
    pendingAdmits() {
      return [];
    },
    abort() {},
    isBusy() {
      return false;
    },
    setApprovalHandler() {},
    async continueTurn() {
      return { text: "", events: [] };
    },
    async run() {
      return { text: "", events: [] };
    },
  } as AgentHandle;
}

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
    async run() {},
  };
}

describe("subagent tools", () => {
  it("tracks lineage depth and registers control tools", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("parent");
    const child = runtime.ensureSession("child");
    const grand = runtime.ensureSession("grand");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });
    runtime.subagents.attach({
      parentSessionId: child,
      childSessionId: grand,
      mode: "one-shot",
      label: "g",
    });
    expect(subagentDepth(runtime, parent)).toBe(0);
    expect(subagentDepth(runtime, child)).toBe(1);
    expect(subagentDepth(runtime, grand)).toBe(2);

    // UI/rewind fork lineage must not consume tool depth budget.
    const forked = runtime.ensureSession("forked");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: forked,
      mode: "fork",
      label: "rewind",
    });
    expect(subagentDepth(runtime, forked)).toBe(0);
    expect(runtime.subagents.listDelegated(parent).map((l) => l.childSessionId)).toEqual([
      child,
    ]);

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    expect(tools.get("subagent")).toBeTruthy();
    expect(tools.get("list_agents")).toBeTruthy();
    expect(tools.get("send_message")).toBeTruthy();
    expect(tools.get("followup_task")).toBeTruthy();
    expect(tools.get("wait_agent")).toBeTruthy();
    expect(tools.get("analytics")).toBeTruthy();
    expect(tools.get("interrupt_agent")).toBeTruthy();
    expect(tools.get("ralph")).toBeTruthy();

    const analytics = await tools.get("analytics")!.execute({});
    expect(analytics.content).toMatch(/depth: 0\//);
    expect(analytics.content).toMatch(/active: 0\//);
    expect(analytics.content).toContain(child);

    const listOut = await tools.get("list_agents")!.execute({});
    expect(listOut.content).toMatch(/quota depth/);
    expect(listOut.content).toContain(child);

    const waitBad = await tools.get("wait_agent")!.execute({
      agent_id: "missing",
    });
    expect(waitBad.isError).toBe(true);

    const waitOk = await tools.get("wait_agent")!.execute({
      agent_id: child,
      timeout_ms: 1000,
    });
    expect(waitOk.isError).not.toBe(true);
    expect(waitOk.content).toMatch(/wait_agent completed/);

    const denied = createToolRegistry();
    bindSubagentTools(denied, {
      runtime,
      parentSessionId: grand,
      maxDepth: 2,
    });
    const out = await denied.get("subagent")!.execute({
      prompt: "should fail",
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/max depth/);
  });

  it("caps concurrent active children under one parent", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: {
        wake() {},
        async cancel() {},
        isActive(sessionId: string) {
          return active.has(sessionId);
        },
        async run() {},
      },
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("parent");
    const childA = runtime.ensureSession("child-a");
    const childB = runtime.ensureSession("child-b");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: childA,
      mode: "continuable",
      label: "a",
    });
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: childB,
      mode: "continuable",
      label: "b",
    });
    active.add(childA);
    active.add(childB);

    const tools = createToolRegistry();
    bindSubagentTools(tools, {
      runtime,
      parentSessionId: parent,
      maxActiveChildren: 2,
    });
    const out = await tools.get("subagent")!.execute({ prompt: "third" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/max active children/);
  });
});
