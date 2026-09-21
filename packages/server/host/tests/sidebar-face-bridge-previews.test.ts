import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import type { AgentHandle } from "@xrkseek/core-agent";
import {
  createFaceRuntime,
  dispatchFaceMethod,
  type FaceDrain,
} from "@xrkseek/server-face";
import { createSidebarFaceBridgeFromFace } from "../src/sidebar-face-bridge.js";

function stubAgent(): AgentHandle {
  return {
    admit(content, options) {
      return {
        admitId: options?.admitId ?? "admit_stub",
        sessionId: "stub",
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

function drain(active = new Set<string>()): FaceDrain {
  return {
    wake() {},
    async cancel(id) {
      active.delete(id);
    },
    isActive(id) {
      return active.has(id);
    },
  };
}

describe("createSidebarFaceBridgeFromFace previews", () => {
  it("listSubagentPreviews folds children + last assistant text", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const face = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(active),
      resolveAgent: async () => stubAgent(),
    });
    const parent = await dispatchFaceMethod(face, "session.create", "p", {});
    expect(parent.result.ok).toBe(true);
    if (!parent.result.ok) return;
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(face, "session.create", "c", {
      parentSessionId: parentId,
      label: "worker",
    });
    expect(child.result.ok).toBe(true);
    if (!child.result.ok) return;
    const childId = (child.result.value as { sessionId: string }).sessionId;
    active.add(childId);

    store.append(childId, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "hello from child",
    });

    const bridge = createSidebarFaceBridgeFromFace(face);
    const { previews } = await bridge.listSubagentPreviews!(parentId);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      childSessionId: childId,
      label: "worker",
      activity: "running",
      lastAssistantPreview: "hello from child",
    });
  });

  it("getPlanPreview reads Face plan projection", async () => {
    const store = createMemorySessionStore();
    const face = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });
    const created = await dispatchFaceMethod(face, "session.create", "p", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const bridge = createSidebarFaceBridgeFromFace(face);
    expect(await bridge.getPlanPreview!(sessionId)).toEqual({
      active: false,
      pending: false,
    });

    const ev = store.append(sessionId, {
      type: "plan/mode",
      ts: 2,
      active: true,
    });
    const seq = store.get(sessionId).events.indexOf(ev) + 1;
    face.projections.drive(sessionId, ev, seq);

    expect(await bridge.getPlanPreview!(sessionId)).toEqual({
      active: true,
      pending: false,
    });
  });
});
