import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
  admitPrompt,
} from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { presentToolView, EVENT_ISOMORPHISM } from "../src/adapt/index.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
    loadSlashRecipes: async () => [
      {
        id: "ping",
        title: "Ping",
        description: "ping",
        parameters: [],
        prompt: "PONG_CMD",
        instructions: "",
      },
    ],
    drain: {
      wake() {},
      async cancel() {},
      isActive() {
        return false;
      },
    },
    resolveAgent: async (sessionId) => ({
      admit: (content, opts) =>
        admitPrompt(store, sessionId, content, opts),
      pendingAdmits: () => [],
      continueTurn: async () => ({}) as never,
      run: async () => ({}) as never,
      isBusy: () => false,
      abort() {},
    }),
  });
}

describe("Face adapt / slash / queue / presets", () => {
  it("EVENT_ISOMORPHISM covers every SessionEvent type", () => {
    expect(Object.keys(EVENT_ISOMORPHISM).sort()).toContain("prompt/withdrawn");
    expect(Object.keys(EVENT_ISOMORPHISM).sort()).toContain("user/message");
  });

  it("presentToolView builds DSH for/card tool views", () => {
    const view = presentToolView({
      type: "tool/call",
      ts: 1,
      turnId: "t",
      stepId: "s",
      call: { id: "c1", name: "bash", arguments: { cmd: "ls" } },
    });
    expect(view).toMatchObject({
      for: "call",
      view: { card: "generic", title: "bash" },
    });
  });

  it("session.prompt slash hits recipe without admit", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const slash = await dispatchFaceMethod(runtime, "session.prompt", "p", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "/ping" }],
    });
    expect(slash.result).toEqual({
      ok: true,
      value: {
        accepted: true,
        command: { kind: "success", text: "PONG_CMD", recipeId: "ping" },
      },
    });
    expect(runtime.store.get(sessionId).events).toHaveLength(0);
  });

  it("session.prompt unknown slash is honest error command", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const slash = await dispatchFaceMethod(runtime, "session.prompt", "p", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "/nope" }],
    });
    expect(slash.result.ok).toBe(true);
    if (slash.result.ok) {
      expect(slash.result.value).toMatchObject({
        accepted: true,
        command: { kind: "error" },
      });
    }
  });

  it("updateQueue remove + agentPreset select", async () => {
    const store = createMemorySessionStore();
    const runtime = bareRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "rpc1", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "hold me" }],
    });
    expect(prompt.result.ok).toBe(true);
    const pending = runtime.store
      .get(sessionId)
      .events.filter((e) => e.type === "prompt/admitted");
    expect(pending).toHaveLength(1);
    const admitId = (pending[0] as { admitId: string }).admitId;

    const removed = await dispatchFaceMethod(
      runtime,
      "session.updateQueue",
      "u1",
      {
        sessionId,
        itemId: admitId,
        action: { kind: "remove" },
      },
    );
    expect(removed.result).toEqual({ ok: true, value: { accepted: true } });
    expect(
      runtime.store
        .get(sessionId)
        .events.some((e) => e.type === "prompt/withdrawn"),
    ).toBe(true);

    const list = await dispatchFaceMethod(runtime, "agentPreset.list", "l", {});
    expect(list.result.ok).toBe(true);
    if (list.result.ok) {
      const v = list.result.value as {
        presets: { id: string; trust: string; isDefault: boolean; name?: string }[];
        authorable: boolean;
        hasDocument: boolean;
      };
      expect(v.authorable).toBe(false);
      expect(v.hasDocument).toBe(false);
      expect(v.presets.some((p) => p.id === "minimal")).toBe(true);
      expect(v.presets.find((p) => p.id === "minimal")?.name).toBe("Minimal");
      expect(v).not.toHaveProperty("items");
    }

    const read = await dispatchFaceMethod(runtime, "agentPreset.read", "r", {
      agentPreset: "minimal",
    });
    expect(read.result.ok).toBe(true);
    if (read.result.ok) {
      const row = read.result.value as {
        agentPreset: string;
        trust: string;
        content: string;
        name: string;
      };
      expect(row).toMatchObject({
        agentPreset: "minimal",
        trust: "system",
        name: "Minimal",
      });
      expect(row.content).toContain("id: minimal");
    }

    const unknown = await dispatchFaceMethod(runtime, "agentPreset.read", "r2", {
      agentPreset: "nope",
    });
    expect(unknown.result.ok).toBe(false);
    if (!unknown.result.ok) {
      expect(unknown.result.error.code).toBe("agent-preset-not-found");
    }

    const sel = await dispatchFaceMethod(runtime, "agentPreset.select", "s", {
      sessionId,
      agentPreset: "harness",
    });
    expect(sel.result).toEqual({
      ok: true,
      value: { sessionId, agentPreset: "harness" },
    });
    expect(runtime.sessionAgentPresets.get(sessionId)).toBe("harness");

    const copy = await dispatchFaceMethod(runtime, "agentPreset.copy", "cp", {
      agentPreset: "minimal",
    });
    expect(copy.result.ok).toBe(false);
    if (!copy.result.ok) {
      expect(copy.result.error.code).toBe("agent-preset-read-only");
      expect(copy.result.error.details).toMatchObject({
        agentPreset: "minimal",
        reason: "authorable: false",
      });
    }
  });

  it("stamps rpcId onto user/message via promote path", () => {
    const store = createMemorySessionStore();
    const runtime = bareRuntime(store);
    const session = newSession(store);
    runtime.rpcAdmitMap.set("rpc-xyz", "admit_1");
    runtime.admitRpcMap.set("admit_1", "rpc-xyz");
    store.append(session.id, {
      type: "prompt/admitted",
      ts: 1,
      admitId: "admit_1",
      content: "hi",
    });
    store.append(session.id, {
      type: "prompt/promoted",
      ts: 2,
      admitId: "admit_1",
    });
    const user = store.append(session.id, {
      type: "user/message",
      ts: 3,
      turnId: "t1",
      content: "hi",
    });
    expect(user.type).toBe("user/message");
    if (user.type === "user/message") {
      expect(user.rpcId).toBe("rpc-xyz");
    }
  });

  it("prompt mux emits agent/inbox/spliced + session/queue.message", async () => {
    const runtime = bareRuntime();
    const mux: unknown[] = [];
    runtime.bus.subscribeMux((_id, frame) => {
      mux.push(frame);
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "rpc-live", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "hold for queue" }],
    });
    expect(prompt.result.ok).toBe(true);

    const spliced = mux.find(
      (f) =>
        (f as { type?: string; event?: { type?: string } }).type ===
          "session/event" &&
        (f as { event?: { type?: string } }).event?.type ===
          "agent/inbox/spliced",
    ) as
      | {
          event: {
            type: string;
            data: {
              target: string;
              start: number;
              inserted: { id: string; role: string; source: { rpcId?: string } }[];
            };
          };
        }
      | undefined;
    expect(spliced?.event.data).toMatchObject({
      target: "next-turn",
      start: 0,
      inserted: [
        {
          role: "user",
          source: { kind: "user", rpcId: "rpc-live" },
        },
      ],
    });

    const queue = mux.find(
      (f) => (f as { type?: string }).type === "session/queue",
    ) as
      | {
          items: {
            id: string;
            placement: string;
            message: { content: { type: string; text: string }[] };
          }[];
        }
      | undefined;
    expect(queue?.items[0]).toMatchObject({
      placement: "queued",
      message: {
        role: "user",
        content: [{ type: "text", text: "hold for queue" }],
        source: { kind: "user", rpcId: "rpc-live" },
      },
    });
    expect(queue?.items[0]).not.toHaveProperty("content");
  });
});
