import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { applyToolDynamicSchema, createToolRegistry } from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { deriveSessionKind } from "../src/session-kind.js";
import { bindSessionThreadTools } from "../src/session-thread-tools.js";
import { bindAgentRosterTools } from "../src/agent-roster-tools.js";
import { bindSessionQueryTools } from "../src/session-query-tools.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";
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

describe("session kind + dynamic tool copy", () => {
  it("derives orchestrator / coding_parent / delegated_child", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-kind-"));
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const xy = await dispatchFaceMethod(runtime, "session.create", "xy", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    if (!xy.result.ok) throw new Error("xy");
    const xyId = (xy.result.value as { sessionId: string }).sessionId;
    expect(deriveSessionKind(runtime, xyId)).toBe("orchestrator");

    const codingRoot = path.join(root, "code");
    const { workspace } = runtime.workspaces.create(codingRoot);
    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;
    expect(deriveSessionKind(runtime, parentId)).toBe("coding_parent");

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!child.result.ok) throw new Error("child");
    const childId = (child.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "one-shot",
      label: "build",
      role: "worker",
    });
    const sib = await dispatchFaceMethod(runtime, "session.create", "s", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!sib.result.ok) throw new Error("sib");
    const sibId = (sib.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: sibId,
      mode: "one-shot",
      label: "scout",
      role: "researcher",
    });
    expect(deriveSessionKind(runtime, childId)).toBe("delegated_child");

    const parentTools = createToolRegistry();
    bindSessionThreadTools(parentTools, { runtime, sessionId: parentId });
    const parentMsg = applyToolDynamicSchema(parentTools.get("thread_message")!);
    expect(parentMsg.description).toContain("another parent session");
    expect(parentMsg.description).not.toContain("Live siblings");

    const childTools = createToolRegistry();
    bindSessionThreadTools(childTools, {
      runtime,
      sessionId: childId,
      messageOnly: true,
    });
    const childMsg = applyToolDynamicSchema(childTools.get("thread_message")!);
    expect(childMsg.description).toContain(`Live siblings: ${sibId}`);
    expect(childMsg.description).toContain("send_message");

    const roster = createToolRegistry();
    bindAgentRosterTools(roster, {
      runtime,
      sessionId: childId,
      listOnly: true,
    });
    const listed = applyToolDynamicSchema(roster.get("team_list")!);
    expect(listed.description).toContain("Read-only");
    expect(listed.description).toContain("mem_seed_");

    const query = createToolRegistry();
    bindSessionQueryTools(query, { runtime, parentSessionId: childId });
    const inspect = applyToolDynamicSchema(query.get("session_inspect")!);
    expect(inspect.description).toContain("squad board");

    const parentQuery = createToolRegistry();
    bindSessionQueryTools(parentQuery, { runtime, parentSessionId: parentId });
    const parentInspect = applyToolDynamicSchema(
      parentQuery.get("session_inspect")!,
    );
    expect(parentInspect.description).toContain("collab board");
    expect(parentInspect.description).not.toContain("squad board");
  });
});
