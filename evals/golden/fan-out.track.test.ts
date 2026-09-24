/**
 * Golden track: fan-out
 * Parallel subagent children honor maxActiveChildren (delegation fan-out cap).
 */
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { AgentHandle } from "@xrkseek/core-agent";
import {
  bindSubagentTools,
  createFaceRuntime,
  type FaceDrain,
} from "@xrkseek/server-face";

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

function drain(active: Set<string>): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive(sessionId: string) {
      return active.has(sessionId);
    },
    async run() {},
  };
}

describe("golden/fan-out", () => {
  it("rejects a third active child when maxActiveChildren=2", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(active),
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("eval-fanout-parent");
    const childA = runtime.ensureSession("eval-fanout-a");
    const childB = runtime.ensureSession("eval-fanout-b");
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
    expect(runtime.subagents.listDelegated(parent)).toHaveLength(2);

    const tools = createToolRegistry();
    bindSubagentTools(tools, {
      runtime,
      parentSessionId: parent,
      maxActiveChildren: 2,
    });
    const out = await tools.get("subagent")!.execute({
      prompt: "third parallel child must fail",
    });
    expect(out.isError).toBe(true);
    expect(String(out.content)).toMatch(/max active children/);
  });
});
