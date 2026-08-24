import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  estimateMessageContent,
  estimateSystemTokens,
  estimateToolsTokens,
  newSession,
} from "@xrkseek/core-session";
import { createContextHeadersProjectionUnit } from "../src/projections/units/context-headers.js";
import {
  createContextTimelineProjectionUnit,
} from "../src/projections/units/context-timeline.js";
import {
  createFaceProjectionRegistry,
  installDefaultFaceProjections,
} from "../src/projections/index.js";

function driveAll(
  registry: ReturnType<typeof createFaceProjectionRegistry>,
  sessionId: string,
  store: ReturnType<typeof createMemorySessionStore>,
): void {
  const events = store.get(sessionId).events;
  for (let i = 0; i < events.length; i++) {
    registry.drive(sessionId, events[i]!, i + 1);
  }
}

describe("contextTimeline projection", () => {
  it("always views a dsh-context-valid shape from init", () => {
    const unit = createContextTimelineProjectionUnit();
    const view = unit.wire!.view(unit.init());
    expect(view.current.total).toBe(0);
    expect(Array.isArray(view.requests)).toBe(true);
    expect(Array.isArray(view.events)).toBe(true);
    expect(Array.isArray(view.nodes)).toBe(true);
    expect(Array.isArray(view.archive)).toBe(true);
    expect(Array.isArray(view.toolList)).toBe(true);
  });

  it("folds user messages and headers into nodes + item counts", () => {
    const unit = createContextTimelineProjectionUnit();
    let state = unit.init();
    const apply = (ev: Parameters<typeof unit.apply>[1]) => {
      state = unit.apply(state, ev);
    };

    apply({
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    apply({
      type: "step/start",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
    });
    apply({
      type: "user/message",
      ts: 3,
      turnId: "t1",
      content: "在吗",
    });
    apply({
      type: "request/header",
      ts: 4,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-v4-flash" },
        system: "You are helpful.",
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    });

    const view = unit.wire!.view(state);
    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0]!.cat).toBe("user");
    expect(view.nodes[0]!.text).toBe("在吗");
    expect(view.current.user).toBeGreaterThan(0);
    expect(view.toolList).toHaveLength(1);
    expect(view.toolList[0]!.name).toBe("read_file");
    expect(view.current.system).toBe(
      estimateSystemTokens("You are helpful."),
    );
    expect(view.current.tools).toBe(
      estimateToolsTokens([
        {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
        },
      ]),
    );
    expect(view.requests).toHaveLength(1);
    expect(view.requests[0]!.turn).toBe(1);
    expect(view.requests[0]!.step).toBe(1);
    expect(view.current.total).toBe(
      view.current.system +
        view.current.tools +
        view.current.user,
    );
  });

  it("folds assistant, tool results, and inject sources into node cats", () => {
    const unit = createContextTimelineProjectionUnit();
    let state = unit.init();
    const apply = (ev: Parameters<typeof unit.apply>[1]) => {
      state = unit.apply(state, ev);
    };

    apply({
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "run",
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: [{ name: "x", description: "y" }],
      },
    });
    apply({
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "ok",
      toolCalls: [{ id: "tc1", name: "bash", arguments: "{}" }],
    });
    apply({
      type: "tool/result",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      result: {
        toolCallId: "tc1",
        name: "bash",
        content: "done",
      },
    });

    const view = unit.wire!.view(state);
    expect(view.nodes.map((n) => n.cat)).toEqual([
      "inject",
      "assistant",
      "tool",
    ]);
    expect(view.current.inject).toBeGreaterThan(0);
    expect(view.current.assistant).toBeGreaterThan(0);
    expect(view.current.tool).toBeGreaterThan(0);
  });

  it("registers with default install and exposes non-zero browser counts", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);

    store.append(session.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "hello",
    });
    store.append(session.id, {
      type: "request/header",
      ts: 3,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "p", model: "m" },
        system: "sys",
        tools: [
          {
            name: "grep",
            description: "search",
            parameters: { type: "object" },
          },
        ],
      },
    });
    driveAll(registry, session.id, store);

    const snap = registry.snapshot(session.id);
    const timeline = snap.values.contextTimeline!;
    const headers = snap.values.contextHeaders!;

    expect(timeline.nodes.length).toBe(1);
    expect(timeline.toolList.length).toBe(1);
    expect(timeline.current.user).toBe(
      estimateMessageContent("hello"),
    );
    expect(headers.headers.length).toBe(1);
    expect(headers.headers[0]!.system).toBe("sys");
    expect(headers.headers[0]!.tools.length).toBe(1);
  });
});

describe("contextHeaders projection", () => {
  it("appends header epochs with seq and tool schema rows", () => {
    const unit = createContextHeadersProjectionUnit();
    let state = unit.init();
    state = unit.apply(state, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    });
    state = unit.apply(state, {
      type: "request/header",
      ts: 2,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "p", model: "m" },
        system: "Be concise.",
        tools: [
          {
            name: "bash",
            description: "Run shell",
            parameters: { type: "object" },
          },
        ],
      },
    });

    const view = unit.wire!.view(state);
    expect(view.headers).toHaveLength(1);
    expect(view.headers[0]!.seq).toBe(2);
    expect(view.headers[0]!.system).toBe("Be concise.");
    expect(view.headers[0]!.tools[0]).toMatchObject({
      name: "bash",
      description: "Run shell",
      schema: { type: "object" },
    });
    expect(view.headers[0]!.tools[0]!.tokens).toBeGreaterThan(0);
  });
});
