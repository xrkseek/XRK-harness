/**
 * Face harness path: prompt â†?tool â†?cancel â†?policy ask.
 * Locks the main control-plane loop without browser E2E.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createMemorySessionStore,
  createSessionDrainHub,
} from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import {
  askToolNames,
  createPolicyEngine,
} from "@xrkseek/policy";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  FaceInboxWireProjector,
  toFaceWireSessionEvent,
} from "../src/adapt/index.js";

type Agent = Awaited<
  ReturnType<ReturnType<typeof createMinimalComposition>["createAgent"]>
>;

const ECHO_PLUGIN = {
  id: "harness-path-echo",
  kind: "tools" as const,
  tools: [
    {
      name: "echo",
      description: "echo",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      async execute(args: unknown) {
        return {
          content: String((args as { text?: string }).text ?? ""),
        };
      },
    },
  ],
};

async function buildFace(opts: {
  llm: ReturnType<typeof createReplayAdapter>;
  policy?: ReturnType<typeof createPolicyEngine>;
  /** Delay before continueTurn so cancel can win the race. */
  slowMs?: number;
}) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "xrk-hp-"));
  const store = createMemorySessionStore();
  const agents = new Map<string, Agent>();
  const runtimeBox: {
    current: ReturnType<typeof createFaceRuntime> | undefined;
  } = { current: undefined };

  const hub = createSessionDrainHub({
    createDrain: (sessionId) => async ({ signal }) => {
      const agent = agents.get(sessionId);
      if (!agent) return;
      if (opts.slowMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.slowMs);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      while (agent.pendingAdmits().length > 0) {
        if (signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        await agent.continueTurn({ signal });
      }
    },
  });

  const runtime = createFaceRuntime({
    store,
    workspaceRoot,
    version: "test",
    drain: {
      wake: (id) => hub.wake(id),
      cancel: (id) => hub.cancel(id),
      isActive: (id) => hub.isActive(id),
    },
    resolveAgent: async (sessionId) => {
      let a = agents.get(sessionId);
      if (!a) {
        a = await createMinimalComposition({
          workspaceRoot,
          sessionStore: store,
          sessionId,
          assemble: true,
          llm: opts.llm,
          ...(opts.policy ? { policy: opts.policy } : {}),
          plugins: [ECHO_PLUGIN],
        }).createAgent();
        const rt = runtimeBox.current;
        if (rt) {
          a.setApprovalHandler(rt.approvals.handlerFor(sessionId));
        }
        agents.set(sessionId, a);
      }
      return a;
    },
  });
  runtimeBox.current = runtime;
  return { runtime, store, hub };
}

describe("Face harness path polish", () => {
  it("prompt â†?tool/call+result â†?final assistant (wire shapes)", async () => {
    const { runtime, store } = await buildFace({
      llm: createReplayAdapter([
        {
          content: "",
          toolCalls: [
            { id: "c1", name: "echo", arguments: { text: "hi-tool" } },
          ],
        },
        { content: "done-after-tool" },
      ]),
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "p1", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "run echo" }],
    });
    expect(prompt.result).toEqual({ ok: true, value: { accepted: true } });

    await viWaitUntil(() =>
      store
        .get(sessionId)
        .events.some(
          (e) =>
            e.type === "assistant/message" &&
            e.content === "done-after-tool",
        ),
    );

    const types = store.get(sessionId).events.map((e) => e.type);
    expect(types).toContain("prompt/admitted");
    expect(types).toContain("tool/call");
    expect(types).toContain("tool/result");
    expect(types).toContain("assistant/message");

    const inbox = new FaceInboxWireProjector();
    const wires = store
      .get(sessionId)
      .events.map((e, i) =>
        toFaceWireSessionEvent(e, i + 1, { sessionId, inbox }),
      );
    expect(wires.some((w) => w.type === "agent/inbox/spliced")).toBe(true);
    expect(wires.some((w) => w.type === "tool/call")).toBe(true);
    const toolCall = wires.find((w) => w.type === "tool/call");
    expect(toolCall?.data).toMatchObject({
      callId: "c1",
      name: "echo",
    });
  });

  it("session.cancel aborts in-flight drain and reports idle", async () => {
    const host: { type: string; running?: boolean }[] = [];
    const { runtime, hub } = await buildFace({
      llm: createReplayAdapter([{ content: "should-not-finish" }]),
      slowMs: 2000,
    });
    runtime.bus.subscribeHost((_id, frame) => {
      host.push(frame as { type: string; running?: boolean });
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    await dispatchFaceMethod(runtime, "session.prompt", "p", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "slow" }],
    });
    await viWaitUntil(() => hub.isActive(sessionId));

    const cancel = await dispatchFaceMethod(runtime, "session.cancel", "x", {
      sessionId,
    });
    expect(cancel.result).toEqual({ ok: true, value: { accepted: true } });
    await viWaitUntil(() => !hub.isActive(sessionId));
    expect(
      host.some((f) => f.type === "host/session-status" && f.running === false),
    ).toBe(true);
  });

  it("policy ask waits for session.respondApproval then runs tool", async () => {
    const { runtime, store } = await buildFace({
      llm: createReplayAdapter([
        {
          content: "",
          toolCalls: [
            { id: "c-ask", name: "echo", arguments: { text: "secret" } },
          ],
        },
        { content: "approved-done" },
      ]),
      policy: createPolicyEngine({
        rules: [askToolNames(["echo"])],
      }),
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    await dispatchFaceMethod(runtime, "session.prompt", "p", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "need approval" }],
    });

    await viWaitUntil(
      () => runtime.approvals.listPending(sessionId).length > 0,
      3000,
    );
    const approvalId = runtime.approvals.listPending(sessionId)[0]!.approvalId;
    expect(
      store.get(sessionId).events.some((e) => e.type === "approval/asked"),
    ).toBe(true);

    const responded = await dispatchFaceMethod(
      runtime,
      "session.respondApproval",
      "r",
      { sessionId, approvalId, decision: "allow" },
    );
    expect(responded.result.ok).toBe(true);

    await viWaitUntil(() =>
      store
        .get(sessionId)
        .events.some(
          (e) =>
            e.type === "assistant/message" && e.content === "approved-done",
        ),
    );
    expect(
      store.get(sessionId).events.some((e) => e.type === "tool/result"),
    ).toBe(true);
  });
});

async function viWaitUntil(
  pred: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitUntil timeout");
}
