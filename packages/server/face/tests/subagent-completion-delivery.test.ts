import { describe, expect, it } from "vitest";
import { admitPrompt, createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { idleFaceDrain } from "./helpers/bare-runtime.js";

describe("subagent completion delivery", () => {
  it("steers parent notice when a continuable child drain goes idle", async () => {
    const store = createMemorySessionStore();
    const admits: { sessionId: string; delivery?: string }[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: idleFaceDrain,
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            admits.push({ sessionId, delivery: opts?.delivery });
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => true,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent create failed");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      label: "research",
    });
    if (!child.result.ok) throw new Error("child create failed");
    const childId = (child.result.value as { sessionId: string }).sessionId;

    store.append(childId, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "child result",
    });

    runtime.onSessionDrainStatus(childId, false);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });

    expect(runtime.subagents.getByChild(childId)?.mode).toBe("continuable");
    expect(admits).toEqual([{ sessionId: parentId, delivery: "steer" }]);
  });

  it("skips one-shot children", async () => {
    const store = createMemorySessionStore();
    const admits: string[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: idleFaceDrain,
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            admits.push(sessionId);
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent create failed");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      mode: "one-shot",
      label: "worker",
    });
    if (!child.result.ok) throw new Error("child create failed");
    const childId = (child.result.value as { sessionId: string }).sessionId;

    runtime.onSessionDrainStatus(childId, false);
    await Promise.resolve();

    expect(admits).toEqual([]);
  });
});
