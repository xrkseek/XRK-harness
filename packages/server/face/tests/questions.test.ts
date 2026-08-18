import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createStdTools, createToolRegistry, runToolDetailed } from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { settleFaceRespond } from "../src/wire/respond.js";
import { createFaceOnlyServer } from "../src/attach-http.js";
import { WebSocket } from "ws";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

describe("Face question/requested (DSH user-questions)", () => {
  it("askText + respond custom; single-select rejects custom+selected", async () => {
    const store = createMemorySessionStore();
    const mux: { type?: string; questions?: { id: string }[] }[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    runtime.bus.subscribeMux((_id, frame) => mux.push(frame as { type?: string }));

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const asked = runtime.questions.ask(sessionId, [
      {
        id: "target",
        question: "Choose one",
        options: [{ label: "Code" }, { label: "Docs" }],
      },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    const pending = runtime.questions.listPending(sessionId)[0]!;
    expect(mux.some((f) => f.type === "question/requested")).toBe(true);

    expect(
      settleFaceRespond(runtime, {
        type: "client-response",
        rpcId: pending.rpcId,
        result: {
          ok: true,
          value: {
            sessionId,
            answer: {
              answers: [
                { id: "target", selected: ["Code"], custom: "nope" },
              ],
            },
          },
        },
      }),
    ).toEqual({ accepted: false, reason: "bad-response" });

    expect(
      settleFaceRespond(runtime, {
        type: "client-response",
        rpcId: pending.rpcId,
        result: {
          ok: true,
          value: {
            sessionId,
            answer: { answers: [{ id: "target", selected: [], custom: "Docs" }] },
          },
        },
      }),
    ).toEqual({ accepted: true });

    await expect(asked).resolves.toEqual({
      answers: [{ id: "target", selected: [], custom: "Docs" }],
    });
    expect(mux.some((f) => f.type === "question/resolved")).toBe(true);
  });

  it("cancelled client-response settles ASK_CANCELLED", async () => {
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
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const asked = runtime.questions.askText(sessionId, "why?");
    const pending = runtime.questions.listPending(sessionId)[0]!;
    expect(
      settleFaceRespond(runtime, {
        type: "client-response",
        rpcId: pending.rpcId,
        result: {
          ok: false,
          error: { code: "cancelled", message: "no", details: {} },
        },
      }),
    ).toEqual({ accepted: true });
    await expect(asked).rejects.toMatchObject({ code: "ASK_CANCELLED" });
  });

  it("bindAskUserTool waits for /api/respond custom text", async () => {
    const store = createMemorySessionStore();
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () =>
        ({
          admit() {
            throw new Error("unused");
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
          tools,
        }) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await runtime.resolveAgent(sessionId);

    const run = runToolDetailed({
      registry: tools,
      call: { id: "c1", name: "ask_user", arguments: { question: "path?" } },
    });
    await new Promise((r) => setTimeout(r, 20));
    const pending = runtime.questions.listPending(sessionId)[0]!;
    expect(pending.questions[0]?.question).toBe("path?");
    expect(
      settleFaceRespond(runtime, {
        type: "client-response",
        rpcId: pending.rpcId,
        result: {
          ok: true,
          value: {
            sessionId,
            answer: {
              answers: [{ id: "q0", selected: [], custom: "src/a.ts" }],
            },
          },
        },
      }),
    ).toEqual({ accepted: true });
    const out = await run;
    expect(out.result.content).toBe("src/a.ts");
    expect(out.result.isError).toBeUndefined();
  });

  it("bindAskUserTool forwards questions[] options + multi_select", async () => {
    const store = createMemorySessionStore();
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () =>
        ({
          admit() {
            throw new Error("unused");
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
          tools,
        }) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await runtime.resolveAgent(sessionId);

    const run = runToolDetailed({
      registry: tools,
      call: {
        id: "c2",
        name: "ask_user",
        arguments: {
          questions: [
            {
              id: "pkg",
              header: "Package manager",
              question: "Which manager?",
              options: [
                { label: "pnpm", description: "workspaces" },
                { label: "npm" },
              ],
            },
            {
              id: "scope",
              question: "What to touch?",
              multi_select: true,
              options: [{ label: "tests" }, { label: "docs" }],
            },
          ],
        },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const pending = runtime.questions.listPending(sessionId)[0]!;
    expect(pending.questions).toEqual([
      {
        id: "pkg",
        header: "Package manager",
        question: "Which manager?",
        options: [
          { label: "pnpm", description: "workspaces" },
          { label: "npm" },
        ],
      },
      {
        id: "scope",
        question: "What to touch?",
        multiSelect: true,
        options: [{ label: "tests" }, { label: "docs" }],
      },
    ]);
    expect(
      settleFaceRespond(runtime, {
        type: "client-response",
        rpcId: pending.rpcId,
        result: {
          ok: true,
          value: {
            sessionId,
            answer: {
              answers: [
                { id: "pkg", selected: ["pnpm"] },
                { id: "scope", selected: ["tests", "docs"] },
              ],
            },
          },
        },
      }),
    ).toEqual({ accepted: true });
    const out = await run;
    expect(out.result.content).toBe("pnpm\ntests, docs");
    expect(out.result.isError).toBeUndefined();
  });

  it("mux reconnect replays pending question/requested", async () => {
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
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    void runtime.questions.askText(sessionId, "still?");
    const pending = runtime.questions.listPending(sessionId)[0]!;

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) => req.headers.authorization === "Bearer k",
    });
    const { port } = await face.listen();
    const frames: { rpcId: string; payload: { type: string } }[] = [];
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
          rpcId: string;
          payload: { type: string };
        };
        frames.push(env);
        if (frames.some((f) => f.payload.type === "question/requested")) done();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const q = frames.find((f) => f.payload.type === "question/requested");
    expect(q?.rpcId).toBe(pending.rpcId);
    await face.close();
  });
});
