import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { foldRequestHeader } from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createRoutingLlmAdapter } from "@xrkseek/llm-registry";
import { maybeAppendRequestHeader } from "../src/request-header-log.js";

describe("maybeAppendRequestHeader", () => {
  it("logs request/header when routing LLM route is known", () => {
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const llm = createRoutingLlmAdapter({
      id: "route-log",
      getSelection: () => ({ provider: "deepseek", model: "deepseek-v4-flash" }),
      resolveAdapter: () => createReplayAdapter([{ content: "ok" }]),
    });

    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1000,
    });

    const header = foldRequestHeader(store.get(sessionId).events);
    expect(header).toEqual({
      config: { provider: "deepseek", model: "deepseek-v4-flash" },
    });

    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1001,
    });
    expect(
      store.get(sessionId).events.filter((e) => e.type === "request/header"),
    ).toHaveLength(1);
  });
});
