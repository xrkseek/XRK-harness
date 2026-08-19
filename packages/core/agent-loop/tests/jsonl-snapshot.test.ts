import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  toJSONL,
  type SessionStore,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import type { SessionEvent } from "@xrkseek/protocol";
import { runTurn } from "../src/index.js";

function stabilize(events: readonly SessionEvent[]): SessionEvent[] {
  return events.map((e) => {
    const copy = { ...e } as SessionEvent & {
      turnId?: string;
      stepId?: string;
    };
    if ("turnId" in copy && typeof copy.turnId === "string") {
      (copy as { turnId: string }).turnId = "turn_fixed";
    }
    if ("stepId" in copy && typeof copy.stepId === "string") {
      (copy as { stepId: string }).stepId = "step_fixed";
    }
    return copy;
  });
}

describe("session jsonl snapshot", () => {
  it("matches fixed fixture shape for a text turn", async () => {
    const store: SessionStore = createMemorySessionStore();
    const session = store.create("sess_fixture");
    let t = 0;
    await runTurn({
      sessionId: session.id,
      userText: "ping",
      store,
      llm: createReplayAdapter([{ content: "pong" }]),
      tools: createToolRegistry(),
      now: () => {
        t += 1;
        return t;
      },
    });
    const jsonl = toJSONL(stabilize(store.get(session.id).events));
    expect(jsonl).toBe(
      [
        '{"type":"turn/start","ts":1,"turnId":"turn_fixed"}',
        '{"type":"user/message","ts":2,"turnId":"turn_fixed","content":"ping"}',
        '{"type":"step/start","ts":3,"turnId":"turn_fixed","stepId":"step_fixed"}',
        '{"type":"assistant/message","ts":5,"turnId":"turn_fixed","stepId":"step_fixed","content":"pong"}',
        '{"type":"step/end","ts":6,"turnId":"turn_fixed","stepId":"step_fixed"}',
        '{"type":"turn/end","ts":7,"turnId":"turn_fixed","reason":{"kind":"completed"}}',
        "",
      ].join("\n"),
    );
  });
});
