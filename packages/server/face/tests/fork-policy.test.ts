import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createPolicyEngine, denyProviderIds } from "@xrkseek/policy";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import type { FaceDrain } from "../src/context.js";
import {
  modelSelectionFromPrefix,
  resolveForkCut,
} from "../src/fork-cut.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function appendCompletedTurn(
  store: ReturnType<typeof createMemorySessionStore>,
  sessionId: string,
  turn: number,
  prompt: string,
  opts?: {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
  },
): void {
  const turnId = `t${turn}`;
  const base = turn * 100;
  store.append(sessionId, {
    type: "turn/start",
    ts: base,
    turnId,
  });
  store.append(sessionId, {
    type: "user/message",
    ts: base + 1,
    turnId,
    content: prompt,
  });
  if (opts?.provider && opts?.model) {
    store.append(sessionId, {
      type: "request/header",
      ts: base + 2,
      turnId,
      reason: turn === 1 ? "initial" : "change",
      header: {
        config: {
          provider: opts.provider,
          model: opts.model,
          ...(opts.reasoningEffort
            ? { reasoningEffort: opts.reasoningEffort }
            : {}),
        },
      },
    });
  }
  store.append(sessionId, {
    type: "assistant/message",
    ts: base + 3,
    turnId,
    stepId: `s${turn}`,
    content: `reply ${turn}`,
  });
  store.append(sessionId, {
    type: "turn/end",
    ts: base + 4,
    turnId,
    reason: { kind: "completed" },
  });
}

describe("resolveForkCut", () => {
  it("maps atSeq to the first turn/end at or after the wire seq", () => {
    const events = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "a" },
      { type: "turn/end", ts: 3, turnId: "t1", reason: { kind: "completed" } },
      { type: "prompt/admitted", ts: 4, admitId: "q1", content: "b", delivery: "queue" },
      { type: "turn/start", ts: 5, turnId: "t2" },
      { type: "user/message", ts: 6, turnId: "t2", content: "b" },
      { type: "turn/end", ts: 7, turnId: "t2", reason: { kind: "completed" } },
    ] as const;
    // Wire seq of user/message in turn 1 is 2 → cut through first turn/end (index 2).
    expect(resolveForkCut(events, { atSeq: 2 })).toEqual({
      ok: true,
      cut: 3,
      atSeq: 2,
    });
    // Omitted / past-end → last completed turn (excludes nothing after last end).
    expect(resolveForkCut(events, {})).toEqual({ ok: true, cut: 7 });
    expect(resolveForkCut(events, { atSeq: 99 })).toEqual({
      ok: true,
      cut: 7,
      atSeq: 99,
    });
  });

  it("rejects atSeq below 1 (Face seq is 1-based)", () => {
    const events = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "turn/end", ts: 2, turnId: "t1", reason: { kind: "completed" } },
    ] as const;
    const r = resolveForkCut(events, { atSeq: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-payload");
  });

  it("excludes an open trailing turn when atSeq is omitted", () => {
    const events = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "a" },
      { type: "turn/end", ts: 3, turnId: "t1", reason: { kind: "completed" } },
      { type: "turn/start", ts: 4, turnId: "t2" },
      { type: "user/message", ts: 5, turnId: "t2", content: "open" },
    ] as const;
    expect(resolveForkCut(events, {})).toEqual({ ok: true, cut: 3 });
  });

  it("rejects an in-log anchor whose turn is still open", () => {
    const events = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "a" },
      { type: "turn/end", ts: 3, turnId: "t1", reason: { kind: "completed" } },
      { type: "turn/start", ts: 4, turnId: "t2" },
      { type: "user/message", ts: 5, turnId: "t2", content: "open" },
    ] as const;
    const r = resolveForkCut(events, { atSeq: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("fork-unavailable");
  });
});

describe("Face session.fork", () => {
  it("cuts at turn/end and excludes later inputs and model settings", async () => {
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

    appendCompletedTurn(store, parentId, 1, "A", {
      provider: "inherited-provider",
      model: "inherited-model",
      reasoningEffort: "high",
    });
    const afterFirst = store.get(parentId).events.length;
    // Post-turn inbox + later model change must not enter the child.
    store.append(parentId, {
      type: "prompt/admitted",
      ts: 50,
      admitId: "later-b",
      content: "B",
      delivery: "queue",
    });
    appendCompletedTurn(store, parentId, 2, "B", {
      provider: "later-provider",
      model: "later-model",
    });
    runtime.sessionModels.set(parentId, {
      provider: "later-provider",
      model: "later-model",
    });

    const assistantSeq = (() => {
      const events = store.get(parentId).events;
      for (let i = 0; i < events.length; i++) {
        if (
          events[i]!.type === "assistant/message" &&
          (events[i] as { turnId?: string }).turnId === "t1"
        ) {
          return i + 1;
        }
      }
      return 1;
    })();

    const forked = await dispatchFaceMethod(runtime, "session.fork", "f1", {
      sessionId: parentId,
      atSeq: assistantSeq,
      newSessionId: "fork-turn-cut",
    });
    expect(forked.result.ok).toBe(true);
    if (!forked.result.ok) return;
    const child = forked.result.value as {
      sessionId: string;
      parentSessionId: string;
      eventCount: number;
      atSeq: number;
    };
    expect(child.parentSessionId).toBe(parentId);
    expect(child.sessionId).toBe("fork-turn-cut");
    expect(child.eventCount).toBe(afterFirst);
    expect(child.atSeq).toBe(assistantSeq);

    const childEvents = store.get(child.sessionId).events;
    expect(childEvents.some((e) => e.type === "prompt/admitted")).toBe(false);
    expect(
      childEvents.some(
        (e) =>
          e.type === "user/message" &&
          (e as { content?: string }).content === "B",
      ),
    ).toBe(false);
    expect(modelSelectionFromPrefix(childEvents)).toEqual({
      provider: "inherited-provider",
      model: "inherited-model",
      reasoningEffort: "high",
    });
    expect(runtime.sessionModels.get(child.sessionId)).toEqual({
      provider: "inherited-provider",
      model: "inherited-model",
      reasoningEffort: "high",
    });

    const omitted = await dispatchFaceMethod(runtime, "session.fork", "f2", {
      sessionId: parentId,
      newSessionId: "fork-last-turn",
    });
    expect(omitted.result.ok).toBe(true);
    if (omitted.result.ok) {
      const v = omitted.result.value as { eventCount: number };
      // Last completed turn includes turn 2; still excludes nothing after its end.
      expect(v.eventCount).toBe(store.get(parentId).events.length);
    }

    const open = await dispatchFaceMethod(runtime, "session.fork", "f3", {
      sessionId: parentId,
      atSeq: store.get(parentId).events.length + 10,
      newSessionId: "fork-past-end",
    });
    expect(open.result.ok).toBe(true);

    const clash = await dispatchFaceMethod(runtime, "session.fork", "f4", {
      sessionId: parentId,
      newSessionId: "fork-turn-cut",
    });
    expect(clash.result.ok).toBe(false);
    if (!clash.result.ok) {
      expect(clash.result.error.code).toBe("session-conflict");
    }
  });

  it("keeps legacy beforeSeq as a raw exclusive offset", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
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
    const partial = await dispatchFaceMethod(runtime, "session.fork", "f", {
      sessionId: parentId,
      beforeSeq: 1,
      newSessionId: "fork-raw",
    });
    expect(partial.result.ok).toBe(true);
    if (partial.result.ok) {
      const v = partial.result.value as { eventCount: number; beforeSeq: number };
      expect(v.eventCount).toBe(1);
      expect(v.beforeSeq).toBe(1);
    }
  });

  it("rejects fork when the log has no completed turn", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) return;
    const parentId = (created.result.value as { sessionId: string }).sessionId;
    const forked = await dispatchFaceMethod(runtime, "session.fork", "f", {
      sessionId: parentId,
    });
    expect(forked.result.ok).toBe(false);
    if (!forked.result.ok) {
      expect(forked.result.error.code).toBe("fork-unavailable");
    }
  });

  it("marks UI forks as origin=fork and keeps them out of delegated lists", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) return;
    const parentId = (created.result.value as { sessionId: string }).sessionId;
    appendCompletedTurn(store, parentId, 1, "A");
    const forked = await dispatchFaceMethod(runtime, "session.fork", "f", {
      sessionId: parentId,
      newSessionId: "ui-fork",
    });
    expect(forked.result.ok).toBe(true);
    if (!forked.result.ok) return;
    const link = runtime.subagents.getByChild("ui-fork");
    expect(link?.mode).toBe("fork");
    expect(runtime.subagents.listDelegated(parentId)).toEqual([]);
    const listed = await dispatchFaceMethod(runtime, "session.list", "l", {});
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const items = (listed.result.value as { items: { sessionId: string; origin?: string }[] })
      .items;
    const child = items.find((i) => i.sessionId === "ui-fork");
    expect(child?.origin).toBe("fork");
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
      model: "deepseek-v4-flash",
    });
    expect(denied.result.ok).toBe(false);
    if (!denied.result.ok) {
      expect(denied.result.error.code).toBe("policy-denied");
      expect(denied.result.error.details).toMatchObject({
        kind: "provider.use",
      });
    }
  });
});
