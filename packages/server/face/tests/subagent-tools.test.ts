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

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    expect(tools.get("subagent")).toBeTruthy();
    expect(tools.get("list_agents")).toBeTruthy();
    expect(tools.get("send_message")).toBeTruthy();
    expect(tools.get("interrupt_agent")).toBeTruthy();

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
});
