import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  createSessionDrainHub,
} from "@xrkseek/core-session";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { WebSocket } from "ws";
import {
  createFaceOnlyServer,
  faceMethodFromPath,
  isFaceWsPath,
} from "../src/index.js";
import { createFaceRuntime } from "../src/runtime.js";

describe("faceMethodFromPath", () => {
  it("accepts /api/face/* and dotted /api/*", () => {
    expect(faceMethodFromPath("/api/face/session.prompt")).toBe("session.prompt");
    expect(faceMethodFromPath("/api/session.prompt")).toBe("session.prompt");
    expect(faceMethodFromPath("/api/host.describe")).toBe("host.describe");
  });

  it("does not steal REST paths", () => {
    expect(faceMethodFromPath("/api/sessions")).toBeUndefined();
    expect(faceMethodFromPath("/api/chat")).toBeUndefined();
    expect(faceMethodFromPath("/api/sessions/x/admit")).toBeUndefined();
    expect(faceMethodFromPath("/api/respond")).toBeUndefined();
    expect(faceMethodFromPath("/api/commands/execute")).toBe("commands/execute");
    expect(faceMethodFromPath("/api/goals/create")).toBe("goals/create");
    expect(faceMethodFromPath("/api/messageFeedback/put")).toBe(
      "messageFeedback/put",
    );
  });

  it("recognizes dual WS paths", () => {
    expect(isFaceWsPath("/api/events.mux")).toBe(true);
    expect(isFaceWsPath("/api/face/events.host")).toBe(true);
    expect(isFaceWsPath("/api/chat")).toBe(false);
  });
});

describe("native DeepSeek paths over HTTP/WS", () => {
  it("POST /api/host.describe + mux WS", async () => {
    const store = createMemorySessionStore();
    const agents = new Map<
      string,
      ReturnType<ReturnType<typeof createMinimalComposition>["createAgent"]>
    >();
    const hub = createSessionDrainHub({
      createDrain: (sessionId) => async ({ signal }) => {
        const agent = agents.get(sessionId);
        if (!agent) return;
        while (agent.pendingAdmits().length > 0) {
          if (signal.aborted) throw new DOMException("aborted", "AbortError");
          await agent.continueTurn({ signal });
        }
      },
    });
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: {
        wake: (id) => hub.wake(id),
        cancel: (id) => hub.cancel(id),
        isActive: (id) => hub.isActive(id),
      },
      resolveAgent: async (sessionId) => {
        let a = agents.get(sessionId);
        if (!a) {
          a = createMinimalComposition({
            workspaceRoot: process.cwd(),
            sessionStore: store,
            sessionId,
            assemble: true,
            llm: createReplayAdapter([{ content: "ok" }]),
          }).createAgent();
          agents.set(sessionId, a);
        }
        return a;
      },
    });

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) =>
        req.headers.authorization === "Bearer k" ||
        req.headers["x-api-key"] === "k",
    });
    const { port } = await face.listen();
    const base = `http://127.0.0.1:${port}`;

    const describeRes = await fetch(`${base}/api/host.describe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer k",
      },
      body: JSON.stringify({ rpcId: "r1", payload: {} }),
    });
    expect(describeRes.status).toBe(200);
    const body = (await describeRes.json()) as {
      result: { ok: boolean };
    };
    expect(body.result.ok).toBe(true);

    // REST-like path must 404 on face-only server (not claimed)
    const sessions = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer k",
      },
      body: JSON.stringify({}),
    });
    expect(sessions.status).toBe(404);

    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events.host`, {
        headers: { authorization: "Bearer k" },
      });
      const t = setTimeout(() => {
        ws.close();
        resolve();
      }, 400);
      ws.on("message", (data) => {
        frames.push(JSON.parse(String(data)));
        clearTimeout(t);
        ws.close();
        resolve();
      });
      ws.on("open", () => {
        void fetch(`${base}/api/session.create`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer k",
          },
          body: JSON.stringify({ rpcId: "c1", payload: {} }),
        });
      });
      ws.on("error", (err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    expect(frames.length).toBeGreaterThan(0);
    const payload = (frames[0] as { payload: { type: string } }).payload;
    expect(payload.type).toBe("host/session-added");

    const badRespond = await fetch(`${base}/api/respond`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer k",
      },
      body: JSON.stringify({ type: "client-request", rpcId: "nope" }),
    });
    expect(badRespond.status).toBe(200);
    expect(await badRespond.json()).toEqual({
      accepted: false,
      reason: "bad-response",
    });

    await face.close();
  });
});
