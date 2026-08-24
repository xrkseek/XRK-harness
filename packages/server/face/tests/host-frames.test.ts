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
      productDir: path.join(root, ".xrk"),
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
    expect(
      host.some(
        (f) =>
          f.type === "host/workspace-changed"
          && f.workspace.workspaceId === "ws_default",
      ),
    ).toBe(false);
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

describe("host/remote-event", () => {
  async function runtime() {
    const store = createMemorySessionStore();
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-remote-"));
    return createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
  }

  it("forwards credentials/updated on set and unset; unknown slot stays quiet", async () => {
    const rt = await runtime();
    const host = collectHost(rt);
    const ok = await dispatchFaceMethod(rt, "credentials.set", "c1", {
      slotId: "host.apiKey",
      value: "secret-test-key",
    });
    expect(ok.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "credentials/updated",
        args: ["XRK_API_KEY"],
      },
    ]);

    host.length = 0;
    const cleared = await dispatchFaceMethod(rt, "credentials.unset", "c2", {
      ref: "XRK_API_KEY",
    });
    expect(cleared.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "credentials/updated",
        args: ["XRK_API_KEY"],
      },
    ]);

    host.length = 0;
    const unknown = await dispatchFaceMethod(rt, "credentials.set", "c3", {
      slotId: "nope.key",
      value: "x",
    });
    expect(unknown.result.ok).toBe(false);
    expect(host).toEqual([]);
  });

  it("forwards llm/adapters-updated when an llm credential changes", async () => {
    const rt = await runtime();
    const host = collectHost(rt);
    const set = await dispatchFaceMethod(rt, "credentials.set", "c1", {
      slotId: "llm.openai",
      value: "sk-test",
    });
    expect(set.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "credentials/updated",
        args: ["OPENAI_API_KEY"],
      },
      {
        type: "host/remote-event",
        event: "llm/adapters-updated",
        args: [],
      },
    ]);
  });

  it("forwards settings/document-updated on mutate; llm-pi-ai ns also adapters-updated", async () => {
    const rt = await runtime();
    await dispatchFaceMethod(rt, "settings.describe", "d0", {});
    const host = collectHost(rt);
    const mut = await dispatchFaceMethod(rt, "settings.mutate", "m1", {
      ns: "ui-onboarding",
      ops: [
        {
          op: "set",
          path: ["welcomeNoticeVersion"],
          value: "2026-08-18.xrk",
        },
      ],
    });
    expect(mut.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "settings/document-updated",
        args: ["ui-onboarding", 1],
      },
    ]);

    host.length = 0;
    const llm = await dispatchFaceMethod(rt, "settings.mutate", "m2", {
      ns: "llm-pi-ai",
      ops: [{ op: "set", path: ["providers"], value: {} }],
    });
    expect(llm.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "settings/document-updated",
        args: ["llm-pi-ai", 1],
      },
      {
        type: "host/remote-event",
        event: "llm/adapters-updated",
        args: [],
      },
    ]);

    host.length = 0;
    const mcp = await dispatchFaceMethod(rt, "settings.mutate", "m3", {
      ns: "mcp",
      ops: [{ op: "set", path: ["servers"], value: [] }],
    });
    expect(mcp.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "settings/document-updated",
        args: ["mcp", 1],
      },
    ]);

    host.length = 0;
    const rejected = await dispatchFaceMethod(rt, "settings.mutate", "m4", {
      ns: "mcp",
      ops: [{ op: "set", path: ["connected"], value: [] }],
    });
    expect(rejected.result.ok).toBe(false);
    expect(host).toEqual([]);
  });

  it("forwards agent-preset/selected on select", async () => {
    const rt = await runtime();
    const created = await dispatchFaceMethod(rt, "session.create", "s", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const host = collectHost(rt);
    const sel = await dispatchFaceMethod(rt, "agentPreset.select", "p", {
      sessionId,
      agentPreset: "harness",
    });
    expect(sel.result.ok).toBe(true);
    expect(host).toEqual([
      {
        type: "host/remote-event",
        event: "agent-preset/selected",
        args: [sessionId, "harness"],
      },
    ]);
  });
});

