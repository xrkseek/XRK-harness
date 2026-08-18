import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import type { AgentHandle } from "@xrkseek/core-agent";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import type { FaceDrain } from "../src/context.js";

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

describe("Face subagent", () => {
  it("create-with-parent + list/history/prompt/interrupt", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    expect(parent.result.ok).toBe(true);
    if (!parent.result.ok) return;
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      label: "worker",
    });
    expect(child.result.ok).toBe(true);
    if (!child.result.ok) return;
    const childId = (child.result.value as { sessionId: string }).sessionId;

    const listed = await dispatchFaceMethod(runtime, "subagent.list", "l", {
      parentSessionId: parentId,
    });
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const catalog = listed.result.value as {
      parentAvailable: boolean;
      entries: { kind: string; id: string; mode: string; label?: string }[];
    };
    expect(catalog.parentAvailable).toBe(true);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      kind: "child",
      id: childId,
      mode: "continuable",
      label: "worker",
    });

    const hist = await dispatchFaceMethod(runtime, "subagent.history", "h", {
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
    });
    expect(hist.result.ok).toBe(true);

    const missing = await dispatchFaceMethod(runtime, "subagent.history", "h2", {
      parentSessionId: parentId,
      childSessionId: "nope",
      mode: "continuable",
    });
    expect(missing.result.ok).toBe(false);
    if (!missing.result.ok) {
      expect(missing.result.error.code).toBe("subagent-not-found");
    }

    const prompted = await dispatchFaceMethod(runtime, "subagent.prompt", "pr", {
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
      content: [{ type: "text", text: "go" }],
    });
    // resolveAgent throws — prompt still admits then wakes; agent resolve may fail async
    expect(prompted.result.ok).toBe(true);
    if (prompted.result.ok) {
      expect(
        (prompted.result.value as { messageId: string }).messageId,
      ).toBeTruthy();
    }

    const stopped = await dispatchFaceMethod(runtime, "subagent.interrupt", "i", {
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
    });
    expect(stopped.result.ok).toBe(true);
    if (stopped.result.ok) {
      expect(stopped.result.value).toEqual({ accepted: true });
    }
  });

  it("session.fork registers a continuable child", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;
    const forked = await dispatchFaceMethod(runtime, "session.fork", "f", {
      sessionId: parentId,
    });
    expect(forked.result.ok).toBe(true);
    if (!forked.result.ok) return;
    const childId = (forked.result.value as { sessionId: string }).sessionId;
    const listed = await dispatchFaceMethod(runtime, "subagent.list", "l", {
      parentSessionId: parentId,
    });
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const entries = (
        listed.result.value as { entries: { id: string }[] }
      ).entries;
      expect(entries.map((e) => e.id)).toContain(childId);
    }
  });
});
