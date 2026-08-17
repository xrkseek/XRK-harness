import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
} from "@xrkseek/core-session";
import { WebSocket } from "ws";
import { createFaceOnlyServer } from "../src/index.js";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";

describe("mux reconnect baseline", () => {
  it("replays session/subscribed + session/queue for pending admits", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
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
        setApprovalHandler() {},
      }),
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "rpc-q", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "still waiting" }],
    });
    expect(prompt.result.ok).toBe(true);

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) =>
        req.headers.authorization === "Bearer k" ||
        req.headers["x-api-key"] === "k",
    });
    const { port } = await face.listen();

    const frames: { payload: { type: string; sessionId?: string; items?: unknown[] } }[] =
      [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`, {
        headers: { authorization: "Bearer k" },
      });
      const done = () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      };
      const timer = setTimeout(done, 800);
      ws.on("message", (data) => {
        const env = JSON.parse(String(data)) as {
          payload: { type: string; sessionId?: string; items?: unknown[] };
        };
        frames.push(env);
        const types = frames.map((f) => f.payload.type);
        if (
          types.includes("session/subscribed") &&
          types.includes("session/queue")
        ) {
          done();
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const subscribed = frames.find((f) => f.payload.type === "session/subscribed");
    expect(subscribed?.payload.sessionId).toBe(sessionId);

    const queue = frames.find((f) => f.payload.type === "session/queue");
    expect(queue?.payload.sessionId).toBe(sessionId);
    expect(queue?.payload.items).toHaveLength(1);
    expect(queue?.payload.items?.[0]).toMatchObject({
      placement: "queued",
      message: {
        role: "user",
        content: [{ type: "text", text: "still waiting" }],
        source: { kind: "user", rpcId: "rpc-q" },
      },
    });

    await face.close();
  });
});
