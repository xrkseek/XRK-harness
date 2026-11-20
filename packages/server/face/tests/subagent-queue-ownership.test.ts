/**
 * Continuable queue mutation: ownership fence, FIFO rewrite, cold registry.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
  listPendingAdmits,
} from "@xrkseek/core-session";
import type { AgentHandle } from "@xrkseek/core-agent";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { FaceSubagentRegistry } from "../src/subagent-registry.js";
import { toQueueItems } from "../src/queue.js";
import { rewritePendingAdmit } from "../src/update-queue-rewrite.js";
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

describe("session.updateQueue · subagent ownership + FIFO", () => {
  it("rejects queue mutation on a one-shot child", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      mode: "one-shot",
      label: "shot",
    });
    if (!child.result.ok) throw new Error("child");
    const childId = (child.result.value as { sessionId: string }).sessionId;

    const receipt = admitPrompt(store, childId, "leftover");
    const rejected = await dispatchFaceMethod(runtime, "session.updateQueue", "u", {
      sessionId: childId,
      itemId: receipt.admitId,
      action: { kind: "remove" },
    });
    expect(rejected.result.ok).toBe(false);
    if (!rejected.result.ok) {
      expect(rejected.result.error.code).toBe("subagent-not-resumable");
    }
    expect(listPendingAdmits(store.get(childId).events, childId)).toHaveLength(1);
  });

  it("edit keeps relative FIFO order of the following queue rows", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(active),
      resolveAgent: async () => stubAgent(),
    });

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      mode: "continuable",
      label: "worker",
    });
    if (!child.result.ok) throw new Error("child");
    const childId = (child.result.value as { sessionId: string }).sessionId;

    const a = admitPrompt(store, childId, "first");
    const b = admitPrompt(store, childId, "second");
    const c = admitPrompt(store, childId, "third");

    const edited = await dispatchFaceMethod(runtime, "session.updateQueue", "e", {
      sessionId: childId,
      itemId: b.admitId,
      action: {
        kind: "edit",
        content: [{ type: "text", text: "second-edited" }],
      },
    });
    expect(edited.result.ok).toBe(true);

    const pending = listPendingAdmits(store.get(childId).events, childId);
    expect(pending.map((row) => row.content)).toEqual([
      "first",
      "second-edited",
      "third",
    ]);
    expect(pending[0]?.admitId).toBe(a.admitId);
    expect(pending[1]?.admitId).toBe(b.admitId);
    expect(pending[2]?.admitId).toBe(c.admitId);
  });

  it("edit publishes one final session/queue without empty intermediates", async () => {
    // withdraw+re-admit used to publishQueue on every prompt/withdrawn /
    // prompt/admitted; clients treated the empty frames as FIFO claim.
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    runtime.admitRpcMap.set(
      admitPrompt(store, sessionId, "hold-a").admitId,
      "rpc-a",
    );
    const target = admitPrompt(store, sessionId, "edit-me");
    runtime.admitRpcMap.set(target.admitId, "rpc-edit");
    runtime.admitRpcMap.set(
      admitPrompt(store, sessionId, "hold-b").admitId,
      "rpc-b",
    );

    const queues: Array<{ readonly items: readonly { readonly id: string }[] }> = [];
    const stop = runtime.bus.subscribeMux((_rpcId, frame) => {
      if (frame.type === "session/queue" && frame.sessionId === sessionId) {
        queues.push({ items: frame.items.map((item) => ({ id: item.id })) });
      }
    });

    const edited = await dispatchFaceMethod(runtime, "session.updateQueue", "e", {
      sessionId,
      itemId: target.admitId,
      action: {
        kind: "edit",
        content: [{ type: "text", text: "edited" }],
      },
    });
    stop();
    expect(edited.result.ok).toBe(true);

    expect(queues.length).toBe(1);
    expect(queues[0]?.items).toHaveLength(3);
    expect(queues.every((frame) => frame.items.length > 0)).toBe(true);

    const pending = listPendingAdmits(store.get(sessionId).events, sessionId);
    expect(pending.map((row) => row.content)).toEqual([
      "hold-a",
      "edited",
      "hold-b",
    ]);
  });

  it("steer requires a running drain and then wakes", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const wakes: string[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: {
        wake(id) {
          wakes.push(id);
        },
        async cancel(id) {
          active.delete(id);
        },
        isActive(id) {
          return active.has(id);
        },
      },
      resolveAgent: async () => stubAgent(),
    });

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;
    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      mode: "continuable",
      label: "worker",
    });
    if (!child.result.ok) throw new Error("child");
    const childId = (child.result.value as { sessionId: string }).sessionId;

    const receipt = admitPrompt(store, childId, "hold");
    const idle = await dispatchFaceMethod(runtime, "session.updateQueue", "s0", {
      sessionId: childId,
      itemId: receipt.admitId,
      action: { kind: "steer" },
    });
    expect(idle.result.ok).toBe(false);
    if (!idle.result.ok) {
      expect(idle.result.error.code).toBe("steer-unavailable");
    }

    active.add(childId);
    const steered = await dispatchFaceMethod(runtime, "session.updateQueue", "s1", {
      sessionId: childId,
      itemId: receipt.admitId,
      action: { kind: "steer" },
    });
    expect(steered.result.ok).toBe(true);
    expect(wakes).toContain(childId);
    const pending = listPendingAdmits(store.get(childId).events, childId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.delivery).toBe("steer");
  });
});

describe("cold subagent queue reconstitution", () => {
  it("reloads registry links and republishes pending admits in FIFO order", () => {
    const dir = mkdtempSync(join(tmpdir(), "xrk-subagent-queue-"));
    try {
      const path = join(dir, "subagents.json");
      const first = new FaceSubagentRegistry(path);
      first.attach({
        parentSessionId: "parent",
        childSessionId: "child",
        mode: "continuable",
        label: "worker",
      });

      const store = createMemorySessionStore();
      store.create("child");
      admitPrompt(store, "child", "alpha");
      admitPrompt(store, "child", "beta");
      admitPrompt(store, "child", "gamma");

      const cold = new FaceSubagentRegistry(path);
      expect(cold.getByChild("child")).toMatchObject({
        parentSessionId: "parent",
        childSessionId: "child",
        mode: "continuable",
        label: "worker",
      });

      const pending = listPendingAdmits(store.get("child").events, "child");
      const items = toQueueItems(pending, new Map());
      expect(items.map((row) => row.message.content)).toEqual([
        [{ type: "text", text: "alpha" }],
        [{ type: "text", text: "beta" }],
        [{ type: "text", text: "gamma" }],
      ]);
      expect(items.every((row) => row.placement === "queued")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rewritePendingAdmit keeps tail order for unit callers", () => {
    const store = createMemorySessionStore();
    store.create("s");
    const a = admitPrompt(store, "s", "a");
    const b = admitPrompt(store, "s", "b");
    const c = admitPrompt(store, "s", "c");
    const maps = {
      admitRpcMap: new Map<string, string>([[b.admitId, "rpc-b"]]),
      rpcAdmitMap: new Map<string, string>([["rpc-b", b.admitId]]),
    };
    const head = rewritePendingAdmit(store, "s", b.admitId, "b2", "queue", maps);
    expect(head.admitId).toBe(b.admitId);
    expect(maps.admitRpcMap.get(b.admitId)).toBe("rpc-b");
    expect(maps.rpcAdmitMap.get("rpc-b")).toBe(b.admitId);
    const pending = listPendingAdmits(store.get("s").events, "s");
    expect(pending.map((row) => row.content)).toEqual(["a", "b2", "c"]);
    expect(pending.map((row) => row.admitId)).toEqual([
      a.admitId,
      b.admitId,
      c.admitId,
    ]);
    expect(pending[1]?.rpcId).toBe("rpc-b");
  });

  it("rewritePendingAdmit preserves seat/handoff source tags", () => {
    const store = createMemorySessionStore();
    store.create("s");
    const seatSource = {
      kind: "seat" as const,
      form: "speech" as const,
      channel: "parent" as const,
      fromSessionId: "sess_mgr",
      label: "经理",
    };
    const handoffSource = {
      kind: "handoff" as const,
      form: "notice" as const,
      via: "subagent" as const,
      fromSessionId: "sess_child",
      label: "发版员",
    };
    admitPrompt(store, "s", "keep", { source: seatSource });
    const edit = admitPrompt(store, "s", "edit-me", { source: handoffSource });
    admitPrompt(store, "s", "tail", {
      source: {
        kind: "plugin",
        plugin: "job-completion",
        form: "notice",
      },
    });
    const maps = {
      admitRpcMap: new Map<string, string>(),
      rpcAdmitMap: new Map<string, string>(),
    };
    rewritePendingAdmit(store, "s", edit.admitId, "edited", "steer", maps);
    const pending = listPendingAdmits(store.get("s").events, "s");
    expect(pending.map((row) => row.content)).toEqual([
      "keep",
      "edited",
      "tail",
    ]);
    expect(pending[0]?.source).toEqual(seatSource);
    expect(pending[1]?.source).toEqual(handoffSource);
    expect(pending[1]?.delivery).toBe("steer");
    expect(pending[2]?.source).toMatchObject({
      kind: "plugin",
      plugin: "job-completion",
    });
  });
});
