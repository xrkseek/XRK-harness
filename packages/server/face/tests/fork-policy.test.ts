import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createPolicyEngine, denyProviderIds } from "@xrkseek/policy";
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

describe("Face session.fork", () => {
  it("forks full log and optional beforeSeq boundary", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const parentId = (created.result.value as { sessionId: string }).sessionId;

    store.append(parentId, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "one",
    });
    store.append(parentId, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "two",
    });

    const parentEvents = store.get(parentId).events.length;
    expect(parentEvents).toBeGreaterThanOrEqual(2);

    const forked = await dispatchFaceMethod(runtime, "session.fork", "f1", {
      sessionId: parentId,
    });
    expect(forked.result.ok).toBe(true);
    if (!forked.result.ok) return;
    const child = forked.result.value as {
      sessionId: string;
      parentSessionId: string;
      eventCount: number;
    };
    expect(child.parentSessionId).toBe(parentId);
    expect(child.sessionId).not.toBe(parentId);
    expect(child.eventCount).toBe(parentEvents);
    expect(store.get(child.sessionId).events).toHaveLength(parentEvents);

    const partial = await dispatchFaceMethod(runtime, "session.fork", "f2", {
      sessionId: parentId,
      beforeSeq: 1,
      newSessionId: "fork-partial",
    });
    expect(partial.result.ok).toBe(true);
    if (partial.result.ok) {
      const v = partial.result.value as { sessionId: string; eventCount: number };
      expect(v.sessionId).toBe("fork-partial");
      expect(v.eventCount).toBe(1);
    }

    const clash = await dispatchFaceMethod(runtime, "session.fork", "f3", {
      sessionId: parentId,
      newSessionId: "fork-partial",
    });
    expect(clash.result.ok).toBe(false);
    if (!clash.result.ok) {
      expect(clash.result.error.code).toBe("session-conflict");
    }
  });
});

describe("Face policy provider.use", () => {
  it("selectModel denied by policy", async () => {
    const store = createMemorySessionStore();
    const policy = createPolicyEngine({
      rules: [denyProviderIds(["deepseek"], { reason: "no deepseek" })],
    });
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      policy,
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const denied = await dispatchFaceMethod(runtime, "session.selectModel", "m1", {
      sessionId,
      provider: "deepseek",
      model: "deepseek-chat",
    });
    expect(denied.result.ok).toBe(false);
    if (!denied.result.ok) {
      expect(denied.result.error.code).toBe("model-unavailable");
    }
  });
});
