import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { foldRequestHeader } from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createRoutingLlmAdapter } from "@xrkseek/llm-registry";
import {
  diffToolRegistryNames,
  forgetRequestHeaderCache,
  maybeAppendRequestHeader,
} from "../src/request-header-log.js";

describe("diffToolRegistryNames", () => {
  it("sorts added and removed; ignores schema-only identity", () => {
    expect(
      diffToolRegistryNames(
        [
          { name: "bash", description: "a", parameters: { type: "object" } },
          { name: "read", description: "b", parameters: { type: "object" } },
        ],
        [
          { name: "read", description: "changed", parameters: { type: "object" } },
          { name: "write", description: "c", parameters: { type: "object" } },
        ],
      ),
    ).toEqual({ added: ["write"], removed: ["bash"] });
  });
});

describe("maybeAppendRequestHeader", () => {
  beforeEach(() => {
    forgetRequestHeaderCache();
  });

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

  it("auto path skips system-only churn; explicit reason still logs system rewrite", () => {
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
      system: "base system",
      tools: [
        {
          name: "bash",
          description: "shell",
          parameters: { type: "object" },
        },
      ],
    });
    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1001,
      system: "base system\n+inject noise",
      tools: [
        {
          name: "bash",
          description: "shell",
          parameters: { type: "object" },
        },
      ],
    });
    expect(
      store.get(sessionId).events.filter((e) => e.type === "request/header"),
    ).toHaveLength(1);

    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1002,
      reason: "change",
      system: "after compact",
      tools: [
        {
          name: "bash",
          description: "shell",
          parameters: { type: "object" },
        },
      ],
    });
    const headers = store
      .get(sessionId)
      .events.filter((e) => e.type === "request/header");
    expect(headers).toHaveLength(2);
    expect(headers[1]).toMatchObject({
      reason: "change",
      header: { system: "after compact" },
    });
    expect(
      store.get(sessionId).events.filter(
        (e) =>
          e.type === "user/message" &&
          e.source?.kind === "tool-registry",
      ),
    ).toHaveLength(0);
  });

  it("emits tool-registry inject on name add/remove; skips schema-only", () => {
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
      tools: [
        {
          name: "bash",
          description: "shell",
          parameters: { type: "object" },
        },
      ],
    });
    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1001,
      tools: [
        {
          name: "bash",
          description: "shell v2",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
        },
      ],
    });
    expect(
      store.get(sessionId).events.filter(
        (e) =>
          e.type === "user/message" &&
          e.source?.kind === "tool-registry",
      ),
    ).toHaveLength(0);

    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1002,
      tools: [
        {
          name: "bash",
          description: "shell v2",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
        },
        {
          name: "read_file",
          description: "read",
          parameters: { type: "object" },
        },
      ],
    });
    const updates = store
      .get(sessionId)
      .events.filter(
        (e) =>
          e.type === "user/message" &&
          e.source?.kind === "tool-registry",
      );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      source: {
        kind: "tool-registry",
        form: "update",
        added: ["read_file"],
        removed: [],
      },
    });
    expect(String(updates[0]!.content)).toContain("Added: read_file");

    maybeAppendRequestHeader({
      store,
      sessionId,
      turnId: "turn_1",
      llm,
      now: () => 1003,
      tools: [
        {
          name: "read_file",
          description: "read",
          parameters: { type: "object" },
        },
      ],
    });
    const updates2 = store
      .get(sessionId)
      .events.filter(
        (e) =>
          e.type === "user/message" &&
          e.source?.kind === "tool-registry",
      );
    expect(updates2).toHaveLength(2);
    expect(updates2[1]).toMatchObject({
      source: {
        kind: "tool-registry",
        form: "update",
        added: [],
        removed: ["bash"],
      },
    });
  });
});
