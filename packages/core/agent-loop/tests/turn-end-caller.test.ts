import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("onTurnEnd + tool extras attribution", () => {
  it("passes sessionId/turnId into tools and fires onTurnEnd completed", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const seen: { sessionId?: string; runId?: string; callId?: string }[] = [];
    const ends: { sessionId: string; turnId: string; completion: string }[] =
      [];
    tools.register({
      name: "probe",
      description: "probe",
      parameters: { type: "object" },
      async execute(_args, _signal, extras) {
        seen.push({
          sessionId: extras?.sessionId,
          runId: extras?.runId,
          callId: extras?.callId,
        });
        return { content: "ok" };
      },
    });
    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "probe", arguments: {} }],
      },
      { content: "done" },
    ]);
    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
      onTurnEnd: (ctx) => {
        ends.push(ctx);
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sessionId).toBe(session.id);
    expect(seen[0]?.callId).toBe("c1");
    expect(seen[0]?.runId).toBeTruthy();
    expect(ends).toEqual([
      {
        sessionId: session.id,
        turnId: seen[0]!.runId,
        completion: "completed",
      },
    ]);
  });
});
