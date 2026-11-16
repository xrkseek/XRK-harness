import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { SessionToolDisclosure } from "../src/tool-disclosure.js";

describe("SessionToolDisclosure.hydrate", () => {
  it("restores expand names from the latest request/header tools", () => {
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    store.append(sessionId, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "flash" },
        tools: [
          {
            name: "tool_search",
            description: "search",
            parameters: { type: "object" },
          },
          {
            name: "mcp__fat",
            description: "deferred",
            parameters: { type: "object" },
          },
          {
            name: "bash",
            description: "shell",
            parameters: { type: "object" },
          },
        ],
      },
    });

    const disclosure = new SessionToolDisclosure();
    expect(disclosure.count(sessionId)).toBe(0);
    disclosure.hydrate(store, sessionId);
    expect(disclosure.listExpanded(sessionId)).toEqual(
      new Set(["tool_search", "mcp__fat", "bash"]),
    );

    // Idempotent merge — later expand still accumulates.
    disclosure.expand(sessionId, ["mcp__other"]);
    disclosure.hydrate(store, sessionId);
    expect(disclosure.listExpanded(sessionId).has("mcp__other")).toBe(true);
    expect(disclosure.listExpanded(sessionId).has("mcp__fat")).toBe(true);
  });

  it("no-ops when the log has no header tools", () => {
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const disclosure = new SessionToolDisclosure();
    disclosure.hydrate(store, sessionId);
    expect(disclosure.count(sessionId)).toBe(0);
  });
});
