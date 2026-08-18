import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import type { FaceDrain } from "../src/context.js";
import type { HostFrame } from "../src/types.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function collectHost(runtime: ReturnType<typeof createFaceRuntime>): HostFrame[] {
  const frames: HostFrame[] = [];
  runtime.bus.subscribeHost((_id, f) => frames.push(f));
  return frames;
}

describe("Face host stream (DSH host frames)", () => {
  it("session.create with parent publishes session-added origin=subagent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-sub-"));
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const host = collectHost(runtime);

    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      parentSessionId: parentId,
      label: "worker",
    });
    if (!child.result.ok) throw new Error("child");
    const childId = (child.result.value as { sessionId: string }).sessionId;

    const added = host.filter(
      (f): f is Extract<HostFrame, { type: "host/session-added" }> =>
        f.type === "host/session-added",
    );
    expect(added[0]).toMatchObject({
      sessionId: parentId,
      blank: true,
    });
    expect(added[0]).not.toHaveProperty("parentSessionId");
    expect(added[0]).not.toHaveProperty("origin");
    expect(added[1]).toMatchObject({
      sessionId: childId,
      blank: true,
      parentSessionId: parentId,
      origin: "subagent",
    });
  });

  it("workspace.delete / insertBefore push removed + order-changed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-ws-"));
    const other = await mkdtemp(path.join(tmpdir(), "xrk-host-ws2-"));
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const host = collectHost(runtime);

    const created = await dispatchFaceMethod(runtime, "workspace.create", "c", {
      path: other,
    });
    if (!created.result.ok) throw new Error("create");
    const extraId = (
      created.result.value as { workspace: { workspaceId: string } }
    ).workspace.workspaceId;

    const reordered = await dispatchFaceMethod(
      runtime,
      "workspace.insertBefore",
      "ib",
      { workspaceId: extraId, beforeId: "ws_default" },
    );
    expect(reordered.result.ok).toBe(true);
    const order = host.find((f) => f.type === "host/workspace-order-changed");
    expect(order).toEqual({
      type: "host/workspace-order-changed",
      workspaceIds: [extraId, "ws_default"],
    });

    const deleted = await dispatchFaceMethod(runtime, "workspace.delete", "d", {
      workspaceId: extraId,
    });
    expect(deleted.result.ok).toBe(true);
    expect(
      host.some(
        (f) =>
          f.type === "host/workspace-removed" && f.workspaceId === extraId,
      ),
    ).toBe(true);
    const afterDelete = host.filter(
      (f) => f.type === "host/workspace-changed",
    );
    const lastChanged = afterDelete[afterDelete.length - 1];
    expect(lastChanged).toMatchObject({
      type: "host/workspace-changed",
      workspace: { workspaceId: "ws_default" },
    });
  });

  it("session.fork publishes session-added as subagent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-fork-"));
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const host = collectHost(runtime);
    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {});
    if (!parent.result.ok) throw new Error("parent");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;

    const forked = await dispatchFaceMethod(runtime, "session.fork", "f", {
      sessionId: parentId,
    });
    expect(forked.result.ok).toBe(true);
    if (!forked.result.ok) return;
    const childId = (forked.result.value as { sessionId: string }).sessionId;
    const added = host.filter((f) => f.type === "host/session-added");
    expect(added[added.length - 1]).toMatchObject({
      type: "host/session-added",
      sessionId: childId,
      parentSessionId: parentId,
      origin: "subagent",
    });
  });
});
