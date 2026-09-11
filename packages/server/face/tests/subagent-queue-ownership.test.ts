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
    expect(pending[1]?.admitId).not.toBe(b.admitId);
    expect(pending[2]?.admitId).not.toBe(c.admitId);
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
    admitPrompt(store, "s", "c");
    const maps = {
      admitRpcMap: new Map<string, string>([[b.admitId, "rpc-b"]]),
      rpcAdmitMap: new Map<string, string>([["rpc-b", b.admitId]]),
    };
    const head = rewritePendingAdmit(store, "s", b.admitId, "b2", "queue", maps);
    expect(maps.admitRpcMap.get(head.admitId)).toBe("rpc-b");
    expect(maps.rpcAdmitMap.get("rpc-b")).toBe(head.admitId);
    expect(
      listPendingAdmits(store.get("s").events, "s").map((row) => row.content),
    ).toEqual(["a", "b2", "c"]);
    expect(listPendingAdmits(store.get("s").events, "s")[0]?.admitId).toBe(
      a.admitId,
    );
  });
});
