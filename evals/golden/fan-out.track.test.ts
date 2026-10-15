/**
 * Golden track: fan-out
 * Parallel subagent children honor the per-model live session cap.
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
  it("rejects a third active child when the model route is full", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(active),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    runtime.settingsNamespaces.ensure("agent-loop").user = {
      maxConcurrentModelSessions: 2,
    };
    const parent = runtime.ensureSession("eval-fanout-parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    runtime.sessionModels.set(parent, {
      provider: "deepseek",
      model: "deepseek-flash",
    });
    const childA = runtime.ensureSession("eval-fanout-a");
    const childB = runtime.ensureSession("eval-fanout-b");
    for (const id of [childA, childB]) {
      runtime.sessionModels.set(id, {
        provider: "deepseek",
        model: "deepseek-flash",
      });
    }
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
    });
    const out = await tools.get("subagent")!.execute({
      prompt: "third parallel child must fail",
    });
    expect(out.isError).toBe(true);
    expect(String(out.content)).toMatch(/model session cap/);
  });
});
