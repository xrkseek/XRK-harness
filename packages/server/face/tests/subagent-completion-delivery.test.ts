import { describe, expect, it } from "vitest";
import { admitPrompt, createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { idleFaceDrain } from "./helpers/bare-runtime.js";

describe("subagent completion delivery", () => {
  it("steers parent notice when a continuable child drain goes idle", async () => {
    const store = createMemorySessionStore();
    const admits: { sessionId: string; delivery?: string; content: string }[] =
      [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: idleFaceDrain,
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            admits.push({
              sessionId,
              delivery: opts?.delivery,
              content: String(content),
            });
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
      content: "child body only",
      reasoning: "child private reasoning must not enter parent",
    });

    runtime.onSessionDrainStatus(childId, false);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });

    expect(runtime.subagents.getByChild(childId)?.mode).toBe("continuable");
    expect(admits).toHaveLength(1);
    expect(admits[0]).toMatchObject({
      sessionId: parentId,
      delivery: "steer",
    });
    expect(admits[0]!.content).toContain("child body only");
    expect(admits[0]!.content).not.toContain(
      "child private reasoning must not enter parent",
    );
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

  it("drops stale in-flight idle notify after child re-enters drain (no dup)", async () => {
    const store = createMemorySessionStore();
    const admits: string[] = [];
    let releaseParent!: () => void;
    const parentGate = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    let resolveCalls = 0;
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: idleFaceDrain,
      resolveAgent: async (sessionId) => {
        resolveCalls += 1;
        if (resolveCalls === 1) await parentGate;
        return {
          admit: (content, opts) => {
            admits.push(String(content));
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => true,
          abort() {},
          setApprovalHandler() {},
        } as never;
      },
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
      content: "first-idle-body",
    });
    runtime.onSessionDrainStatus(childId, false);
    // Quick re-wake before the first resolveAgent settles.
    runtime.onSessionDrainStatus(childId, true);
    store.append(childId, {
      type: "assistant/message",
      ts: 2,
      turnId: "t2",
      stepId: "s2",
      content: "second-idle-body",
    });
    runtime.onSessionDrainStatus(childId, false);

    releaseParent();

    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(resolve)));
    });

    expect(admits).toHaveLength(1);
    expect(admits[0]).toContain("second-idle-body");
    expect(admits[0]).not.toContain("first-idle-body");
  });

  it("retries once when resolveAgent fails on the same idle stretch", async () => {
    const store = createMemorySessionStore();
    const admits: string[] = [];
    let attempts = 0;
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: idleFaceDrain,
      resolveAgent: async (sessionId) => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient resolve fail");
        return {
          admit: (content, opts) => {
            admits.push(String(content));
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        } as never;
      },
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
      content: "recovered-body",
    });
    runtime.onSessionDrainStatus(childId, false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(attempts).toBe(2);
    expect(admits).toHaveLength(1);
    expect(admits[0]).toContain("recovered-body");
  });

  it("notifies again on a later idle stretch after running:true", async () => {
    const store = createMemorySessionStore();
    const admits: string[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: idleFaceDrain,
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            admits.push(String(content));
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
      content: "turn-a",
    });
    runtime.onSessionDrainStatus(childId, false);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });
    expect(admits).toHaveLength(1);

    runtime.onSessionDrainStatus(childId, true);
    store.append(childId, {
      type: "assistant/message",
      ts: 2,
      turnId: "t2",
      stepId: "s2",
      content: "turn-b",
    });
    runtime.onSessionDrainStatus(childId, false);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });

    expect(admits).toHaveLength(2);
    expect(admits[1]).toContain("turn-b");
  });
});
