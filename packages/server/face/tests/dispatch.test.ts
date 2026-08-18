import { describe, expect, it, vi } from "vitest";
import {
  createMemorySessionStore,
  createSessionDrainHub,
  newSession,
} from "@xrkseek/core-session";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";

async function harness() {
  const store = createMemorySessionStore();
  const agents = new Map<string, Awaited<ReturnType<ReturnType<typeof createMinimalComposition>["createAgent"]>>>();
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
    version: "test",
    registry: createProviderRegistry(),
    drain: {
      wake: (id) => hub.wake(id),
      cancel: (id) => hub.cancel(id),
      isActive: (id) => hub.isActive(id),
    },
    resolveAgent: async (sessionId) => {
      let a = agents.get(sessionId);
      if (!a) {
        const composition = createMinimalComposition({
          workspaceRoot: process.cwd(),
          sessionStore: store,
          sessionId,
          assemble: true,
          llm: createReplayAdapter([{ content: "pong-face" }]),
        });
        a = composition.createAgent();
        agents.set(sessionId, a);
      }
      return a;
    },
  });

  return { runtime, store, hub };
}

describe("face dispatch", () => {
  it("host.describe + not-implemented fork", async () => {
    const { runtime } = await harness();
    const d = await dispatchFaceMethod(runtime, "host.describe", "r1", {});
    expect(d.result.ok).toBe(true);
    if (d.result.ok) {
      expect(d.result.value).toMatchObject({
        version: "test",
        canOpenPath: true,
      });
    }
    const fork = await dispatchFaceMethod(runtime, "session.fork", "r2", {});
    expect(fork.result.ok).toBe(false);
    if (!fork.result.ok) {
      expect(fork.result.error.code).toBe("bad-request");
    }
  });

  it("create list history prompt", async () => {
    const { runtime } = await harness();
    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("fail");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const mux: unknown[] = [];
    runtime.bus.subscribeMux((_id, f) => mux.push(f));

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "p1", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "hi there world" }],
    });
    expect(prompt.result).toEqual({ ok: true, value: { accepted: true } });

    // allow admit event to land (turn drain is best-effort in this harness)
    await new Promise((r) => setTimeout(r, 100));

    const list = await dispatchFaceMethod(runtime, "session.list", "l1", {});
    expect(list.result.ok).toBe(true);

    const hist = await dispatchFaceMethod(runtime, "session.history", "h1", {
      sessionId,
    });
    expect(hist.result.ok).toBe(true);
    if (hist.result.ok) {
      const events = (
        hist.result.value as {
          events: { event: { type: string; seq: number; time: number; data: unknown }; seq?: number }[];
        }
      ).events;
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.event.seq).toBeGreaterThan(0);
      expect(typeof events[0]?.event.time).toBe("number");
      expect(events[0]?.event).toHaveProperty("data");
      // seq lives on DSH event; entry no longer mirrors top-level seq
      expect(events[0]).not.toHaveProperty("seq");
      const projections = (
        hist.result.value as {
          projections?: { asOfSeq: number; values: Record<string, unknown> };
        }
      ).projections;
      expect(projections?.values.sessionListMetadata).toMatchObject({
        blank: expect.any(Boolean),
      });
      // title may still be null until user/message or rename
      expect(
        projections?.values.title === null ||
          typeof projections?.values.title === "string",
      ).toBe(true);
      expect(projections?.values.todos === null || Array.isArray(projections?.values.todos)).toBe(
        true,
      );
      expect(projections?.values.permissions).toMatchObject({
        currentValue: "workspace-write",
      });
      expect(projections?.values.plan).toEqual({
        active: false,
        pending: false,
      });
    }
    expect(
      mux.some(
        (f) =>
          (f as { type: string }).type === "session/queue" ||
          (f as { type: string }).type === "session/event",
      ),
    ).toBe(true);

    const renamed = await dispatchFaceMethod(runtime, "session.rename", "rn", {
      sessionId,
      title: "Face Title",
    });
    expect(renamed.result).toEqual({
      ok: true,
      value: { title: "Face Title", seq: expect.any(Number) },
    });
    if (renamed.result.ok) {
      expect(
        (renamed.result.value as { seq: number }).seq,
      ).toBeGreaterThan(0);
    }
    expect(runtime.projections.snapshot(sessionId).values.title).toBe(
      "Face Title",
    );
    expect(
      mux.some((f) => (f as { type: string }).type === "session/projection"),
    ).toBe(true);

    const list2 = await dispatchFaceMethod(runtime, "session.list", "l2", {});
    expect(list2.result.ok).toBe(true);
    if (list2.result.ok) {
      const items = (
        list2.result.value as {
          items: { sessionId: string; title: string | null }[];
        }
      ).items;
      expect(items.find((i) => i.sessionId === sessionId)?.title).toBe(
        "Face Title",
      );
    }
  });

  it("prompt returns before slow turn finishes", async () => {
    const store = createMemorySessionStore();
    newSession(store);
    const sessionId = store.list()[0]!;
    let continueStarted = false;
    let continueDone = false;
    const agents = new Map<string, ReturnType<ReturnType<typeof createMinimalComposition>["createAgent"]>>();
    const hub = createSessionDrainHub({
      createDrain: (sid) => async () => {
        continueStarted = true;
        await new Promise((r) => setTimeout(r, 200));
        const agent = agents.get(sid)!;
        while (agent.pendingAdmits().length > 0) {
          await agent.continueTurn();
        }
        continueDone = true;
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
      resolveAgent: async (sid) => {
        let a = agents.get(sid);
        if (!a) {
          a = createMinimalComposition({
            workspaceRoot: process.cwd(),
            sessionStore: store,
            sessionId: sid,
            assemble: true,
            llm: createReplayAdapter([{ content: "slow" }]),
          }).createAgent();
          agents.set(sid, a);
        }
        return a;
      },
    });

    const t0 = Date.now();
    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "p", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: "x" }],
    });
    const elapsed = Date.now() - t0;
    expect(prompt.result.ok).toBe(true);
    expect(elapsed).toBeLessThan(80);
    expect(continueDone).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(continueStarted).toBe(true);
    // Drain completion is hub/agent concern; U1 requires only that prompt does not await it.
  });

  it("selectModel + llm.providers", async () => {
    const { runtime } = await harness();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const sel = await dispatchFaceMethod(runtime, "session.selectModel", "s", {
      sessionId,
      provider: "deepseek",
      model: "deepseek-chat",
    });
    expect(sel.result.ok).toBe(true);

    const bad = await dispatchFaceMethod(runtime, "session.selectModel", "s2", {
      sessionId,
      provider: "nope",
      model: "x",
    });
    expect(bad.result.ok).toBe(false);

    const providers = await dispatchFaceMethod(runtime, "llm.providers", "lp", {});
    expect(providers.result.ok).toBe(true);
    if (providers.result.ok) {
      const list = (providers.result.value as { providers: { provider: string }[] }).providers;
      expect(list.some((p) => p.provider === "openrouter")).toBe(true);
    }
  });

  it("subagent.list parentAvailable honesty", async () => {
    const { runtime } = await harness();
    const missing = await dispatchFaceMethod(runtime, "subagent.list", "sa0", {
      parentSessionId: "no-such",
    });
    expect(missing.result.ok).toBe(true);
    if (missing.result.ok) {
      expect(missing.result.value).toEqual({
        entries: [],
        parentAvailable: false,
      });
    }

    const created = await dispatchFaceMethod(runtime, "session.create", "sa1", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const listed = await dispatchFaceMethod(runtime, "subagent.list", "sa2", {
      parentSessionId: sessionId,
    });
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      expect(listed.result.value).toEqual({
        entries: [],
        parentAvailable: true,
      });
    }

    const bad = await dispatchFaceMethod(runtime, "subagent.list", "sa3", {});
    expect(bad.result.ok).toBe(false);
  });

  it("llm.discoverModels probes GET /models and never echoes the key", async () => {
    const { runtime } = await harness();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.acme.example/v1/models");
      expect(init?.headers).toMatchObject({ authorization: "Bearer probe-key" });
      return new Response(
        JSON.stringify({
          data: [
            { id: "acme-large", name: "Acme Large", context_window: 65536 },
            { id: "acme-small" },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await dispatchFaceMethod(runtime, "llm.discoverModels", "d1", {
        settingsNs: "llm-pi-ai",
        baseURL: "https://gateway.acme.example/v1",
        api: "openai-completions",
        apiKey: "probe-key",
      });
      expect(res.result.ok).toBe(true);
      if (!res.result.ok) throw new Error("discover failed");
      expect(res.result.value).toEqual({
        models: [
          { id: "acme-large", name: "Acme Large", contextWindow: 65536 },
          { id: "acme-small" },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    try {
      const err = await dispatchFaceMethod(runtime, "llm.discoverModels", "d3", {
        settingsNs: "llm",
        baseURL: "https://gateway.acme.example/v1",
        apiKey: "wrong",
      });
      expect(err.result.ok).toBe(false);
      if (err.result.ok) throw new Error("expected fail");
      expect(err.result.error.code).toBe("model-discovery-failed");
      expect(err.result.error.message).toContain("401");
      expect(JSON.stringify(err.result.error)).not.toContain("wrong");
      expect(err.result.error.details).toEqual({
        settingsNs: "llm",
        baseURL: "https://gateway.acme.example/v1",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const unknownNs = await dispatchFaceMethod(
      runtime,
      "llm.discoverModels",
      "d4",
      { settingsNs: "llm-absent", baseURL: "https://gateway.example/v1" },
    );
    expect(unknownNs.result.ok).toBe(false);
    if (!unknownNs.result.ok) {
      expect(unknownNs.result.error.code).toBe("model-discovery-failed");
      expect(unknownNs.result.error.message).toContain("no model discovery");
    }
  });
});
