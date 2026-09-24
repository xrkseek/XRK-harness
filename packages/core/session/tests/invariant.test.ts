import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  InvariantError,
  createInvariantRegistry,
  wrapSessionStore,
} from "@xrkseek/runtime-invariants";
import {
  assertSessionLogInvariants,
  installCoreSessionInvariant,
} from "../src/invariant.js";
import { createMemorySessionStore } from "../src/index.js";

function validTurn(): SessionEvent[] {
  return [
    { type: "turn/start", ts: 1, turnId: "t1" },
    { type: "step/start", ts: 2, turnId: "t1", stepId: "s1" },
    {
      type: "assistant/message",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      toolCalls: [{ id: "c1", name: "echo", arguments: { text: "a" } }],
    },
    {
      type: "tool/call",
      ts: 4,
      turnId: "t1",
      stepId: "s1",
      call: { id: "c1", name: "echo", arguments: { text: "a" } },
    },
    {
      type: "tool/result",
      ts: 5,
      turnId: "t1",
      stepId: "s1",
      result: { toolCallId: "c1", name: "echo", content: "ok" },
    },
    { type: "step/end", ts: 6, turnId: "t1", stepId: "s1" },
    {
      type: "turn/end",
      ts: 7,
      turnId: "t1",
      reason: { kind: "completed" },
    },
  ];
}

describe("core-session invariant companion", () => {
  it("accepts a well-formed turn/step/tool enclosure", () => {
    expect(() => assertSessionLogInvariants(validTurn())).not.toThrow();
  });

  it("rejects tool/result without a prior tool/call", () => {
    expect(() =>
      assertSessionLogInvariants([
        { type: "turn/start", ts: 1, turnId: "t1" },
        { type: "step/start", ts: 2, turnId: "t1", stepId: "s1" },
        {
          type: "tool/result",
          ts: 3,
          turnId: "t1",
          stepId: "s1",
          result: { toolCallId: "c1", name: "echo", content: "ok" },
        },
      ]),
    ).toThrow(/no prior tool\/call/);
  });

  it("fail-fast wraps SessionStore.append before commit", () => {
    const registry = createInvariantRegistry();
    installCoreSessionInvariant(registry);
    const store = wrapSessionStore(createMemorySessionStore(), registry);
    const session = store.create();
    store.append(session.id, { type: "turn/start", ts: 1, turnId: "t1" });
    expect(() =>
      store.append(session.id, {
        type: "turn/start",
        ts: 2,
        turnId: "t2",
      }),
    ).toThrow(InvariantError);
    expect(store.get(session.id).events).toHaveLength(1);
  });
});
