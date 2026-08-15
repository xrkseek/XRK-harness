import { describe, expect, it } from "vitest";
import { createAgent } from "../src/index.js";
import {
  createMemorySessionStore,
  createSessionDrainHub,
  deriveMessages,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import type { LlmAdapter } from "@xrkseek/llm";

const llm: LlmAdapter = {
  async chat() {
    return { content: "ack", toolCalls: [] };
  },
};

/** Poll until predicate is true (tool mid-turn probes). */
async function waitFor(
  check: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("continueTurn + admit", () => {
  it("admit-only then continueTurn promotes", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-admit");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools: createToolRegistry(),
    });

    const receipt = agent.admit("queued hello");
    expect(agent.pendingAdmits()).toHaveLength(1);
    expect(deriveMessages(store.get(session.id).events)).toEqual([]);

    const result = await agent.continueTurn();
    expect(result.text).toBe("ack");
    expect(result.admitId).toBe(receipt.admitId);
    expect(agent.pendingAdmits()).toHaveLength(0);
    expect(deriveMessages(store.get(session.id).events)).toEqual([
      { role: "user", content: "queued hello" },
      { role: "assistant", content: "ack", toolCalls: [] },
    ]);
  });

  it("continueTurn with text skips pending", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-skip");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools: createToolRegistry(),
    });
    agent.admit("still pending");
    await agent.continueTurn({ text: "direct" });
    expect(agent.pendingAdmits()).toHaveLength(1);
    expect(deriveMessages(store.get(session.id).events)[0]).toEqual({
      role: "user",
      content: "direct",
    });
  });

  it("one continueTurn promotes exactly one queue admit (delivery §3)", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-one");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools: createToolRegistry(),
    });

    const a = agent.admit("first");
    const b = agent.admit("second");
    expect(agent.pendingAdmits()).toHaveLength(2);

    const r1 = await agent.continueTurn();
    expect(r1.admitId).toBe(a.admitId);
    expect(agent.pendingAdmits().map((p) => p.content)).toEqual(["second"]);
    expect(
      deriveMessages(store.get(session.id).events).filter(
        (m) => m.role === "user",
      ),
    ).toEqual([{ role: "user", content: "first" }]);

    const r2 = await agent.continueTurn();
    expect(r2.admitId).toBe(b.admitId);
    expect(agent.pendingAdmits()).toHaveLength(0);
  });

  it("does not promote while a multi-step turn is still running", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-mid");
    const tools = createToolRegistry();
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((r) => {
      releaseTool = r;
    });
    let midPending = -1;

    // createAgent after tools register needs agent ref inside execute — bind late.
    let agent!: ReturnType<typeof createAgent>;

    tools.register({
      name: "hold",
      description: "hold",
      parameters: { type: "object" },
      async execute() {
        agent.admit("arrived-during-turn");
        midPending = agent.pendingAdmits().length;
        await toolGate;
        return { content: "held" };
      },
    });

    agent = createAgent({
      sessionId: session.id,
      store,
      llm: createReplayAdapter([
        {
          content: "",
          toolCalls: [{ id: "c1", name: "hold", arguments: {} }],
        },
        { content: "done" },
      ]),
      tools,
      safety: false,
    });

    agent.admit("start");
    const turnP = agent.continueTurn();
    await waitFor(() => midPending >= 0);
    expect(midPending).toBe(1);
    expect(agent.pendingAdmits()[0]?.content).toBe("arrived-during-turn");
    releaseTool();
    await turnP;

    expect(agent.pendingAdmits().map((p) => p.content)).toEqual([
      "arrived-during-turn",
    ]);
    const users = deriveMessages(store.get(session.id).events).filter(
      (m) => m.role === "user",
    );
    expect(users).toEqual([{ role: "user", content: "start" }]);
  });

  it("drain hub promotes one queue per continueTurn until empty", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-drain");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm: createReplayAdapter([
        { content: "a-out" },
        { content: "b-out" },
      ]),
      tools: createToolRegistry(),
    });

    agent.admit("qa");
    agent.admit("qb");

    const hub = createSessionDrainHub({
      createDrain: () => async ({ signal }) => {
        while (agent.pendingAdmits().length > 0) {
          if (signal.aborted) {
            throw new DOMException("aborted", "AbortError");
          }
          await agent.continueTurn({ signal });
        }
      },
    });

    await hub.run(session.id);
    expect(agent.pendingAdmits()).toHaveLength(0);
    const users = deriveMessages(store.get(session.id).events)
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(users).toEqual(["qa", "qb"]);
  });

  it("coalesces pending steers into one turn (single step quota)", async () => {
    let chatCalls = 0;
    const countingLlm: LlmAdapter = {
      id: "count",
      async chat() {
        chatCalls += 1;
        return { content: "steered", toolCalls: [] };
      },
    };
    const store = createMemorySessionStore();
    const session = store.create("s-steer-batch");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm: countingLlm,
      tools: createToolRegistry(),
      maxSteps: 3,
    });

    agent.admit("queue-wait");
    const a = agent.admit("fix A", { delivery: "steer" });
    const b = agent.admit("fix B", { delivery: "steer" });

    const result = await agent.continueTurn();
    expect(result.steerBatch).toBe(true);
    expect(result.admitIds).toEqual([a.admitId, b.admitId]);
    expect(chatCalls).toBe(1);
    expect(result.steps).toBe(1);
    expect(agent.pendingAdmits().map((p) => p.content)).toEqual(["queue-wait"]);
    expect(
      deriveMessages(store.get(session.id).events).filter(
        (m) => m.role === "user",
      ),
    ).toEqual([{ role: "user", content: "fix A\n\nfix B" }]);
  });
});
