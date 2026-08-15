import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  assertModelVisible,
  createMemorySessionStore,
  deriveMessages,
  forkSession,
  fromJSONL,
  ModelVisibleInvariantError,
  toJSONL,
} from "../src/index.js";

function sampleTurn(): SessionEvent[] {
  return [
    { type: "turn/start", ts: 1, turnId: "t1" },
    { type: "user/message", ts: 2, turnId: "t1", content: "hi" },
    { type: "step/start", ts: 3, turnId: "t1", stepId: "s1" },
    {
      type: "assistant/message",
      ts: 4,
      turnId: "t1",
      stepId: "s1",
      content: "hello",
    },
    { type: "step/end", ts: 5, turnId: "t1", stepId: "s1" },
    { type: "turn/end", ts: 6, turnId: "t1" },
  ];
}

describe("memory session store", () => {
  it("appends frozen events", () => {
    const store = createMemorySessionStore();
    const s = store.create("a");
    const ev = store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "x",
    });
    expect(() => {
      (ev as { content: string }).content = "mutated";
    }).toThrow();
    expect(store.get("a").events[0]?.type).toBe("user/message");
  });

  it("rejects invalid events on append", () => {
    const store = createMemorySessionStore();
    const s = store.create("bad");
    expect(() =>
      store.append(s.id, {
        type: "user/message",
        ts: 1,
        turnId: "t",
      } as SessionEvent),
    ).toThrow(/content/);
  });
});

describe("deriveMessages + invariant", () => {
  it("projects user/assistant and ignores structural events", () => {
    const msgs = deriveMessages(sampleTurn());
    expect(msgs).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    assertModelVisible(sampleTurn(), msgs);
  });

  it("fails invariant when request diverges", () => {
    expect(() =>
      assertModelVisible(sampleTurn(), [{ role: "user", content: "nope" }]),
    ).toThrow(ModelVisibleInvariantError);
  });

  it("includes tool results in order", () => {
    const events: SessionEvent[] = [
      { type: "user/message", ts: 1, turnId: "t", content: "edit" },
      {
        type: "assistant/message",
        ts: 2,
        turnId: "t",
        stepId: "s",
        content: "",
        toolCalls: [{ id: "c1", name: "read", arguments: { path: "a" } }],
      },
      {
        type: "tool/call",
        ts: 3,
        turnId: "t",
        stepId: "s",
        call: { id: "c1", name: "read", arguments: { path: "a" } },
      },
      {
        type: "tool/result",
        ts: 4,
        turnId: "t",
        stepId: "s",
        result: { toolCallId: "c1", name: "read", content: "ok" },
      },
    ];
    const msgs = deriveMessages(events);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("projects safety/notice as user (typed in log)", () => {
    const events: SessionEvent[] = [
      { type: "user/message", ts: 1, turnId: "t", content: "hi" },
      {
        type: "safety/notice",
        ts: 2,
        turnId: "t",
        kind: "loop_soft",
        content: "[system] repeated",
        toolName: "echo",
        count: 3,
      },
    ];
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "user", content: "[system] repeated" },
    ]);
  });
});

describe("jsonl", () => {
  it("roundtrips", () => {
    const events = sampleTurn();
    expect(fromJSONL(toJSONL(events))).toEqual(events);
  });

  it("rejects invalid event lines", () => {
    expect(() =>
      fromJSONL('{"type":"user/message","ts":1,"turnId":"t"}\n'),
    ).toThrow(/content/);
  });
});

describe("forkSession", () => {
  it("copies events up to boundary", () => {
    const store = createMemorySessionStore();
    store.create("src");
    for (const ev of sampleTurn()) {
      store.append("src", ev);
    }
    const child = forkSession(store, "src", 3, "child");
    expect(child.events).toHaveLength(3);
    expect(store.get("src").events).toHaveLength(6);
  });
});
