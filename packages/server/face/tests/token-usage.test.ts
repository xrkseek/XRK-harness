import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  estimateAssistantSurface,
  estimateMessageContent,
  estimateSystemTokens,
  estimateToolsTokens,
  foldSurfaceTokens,
  formatCompactionForModel,
  newSession,
} from "@xrkseek/core-session";
import type { ContextCompactionEvent } from "@xrkseek/protocol";
import {
  createContextBreakdownProjectionUnit,
  createContextPressureProjectionUnit,
  createFaceProjectionRegistry,
  createTokenUsageProjectionUnit,
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

describe("Face tokenUsage / contextPressure / contextBreakdown", () => {
  it("registers meter projections by default install", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);
    expect(registry.snapshot(session.id).values.tokenUsage).toEqual({
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(registry.snapshot(session.id).values.contextPressure).toEqual({});
    expect(registry.snapshot(session.id).values.contextBreakdown).toEqual({
      systemTokens: 0,
      toolsTokens: 0,
      messageTokens: 0,
    });
  });

  it("replaces same step usage chunk with message usage (no double count)", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTokenUsageProjectionUnit());

    store.append(session.id, {
      type: "step/start",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      text: "",
      kind: "usage",
      usage: { inputTokens: 10, outputTokens: 1 },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.tokenUsage).toEqual({
      uncachedInputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("folds header contextWindow + usage pressure with surface projectedTokens", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createContextPressureProjectionUnit());

    store.append(session.id, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          contextWindow: 1_000_000,
        },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 20 },
    });
    driveAll(registry, session.id, store);

    const msgTokens = estimateMessageContent("hi");
    expect(registry.snapshot(session.id).values.contextPressure).toEqual({
      contextWindow: 1_000_000,
      pressureTokens: 120,
      // Stamp before append → projected grows by this message's surface price.
      projectedTokens: 120 + msgTokens,
    });
  });

  it("prices system/tools from request/header and messages on the surface", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createContextBreakdownProjectionUnit());

    const system = "You are terse.";
    const tools = [
      {
        name: "grep",
        description: "search",
        parameters: { type: "object", properties: {} },
      },
    ];
    store.append(session.id, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-v4-flash" },
        system,
        tools,
      },
    });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "hello world",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      content: "ok",
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.contextBreakdown).toEqual({
      systemTokens: estimateSystemTokens(system),
      toolsTokens: estimateToolsTokens(tools),
      messageTokens:
        estimateMessageContent("hello world") + estimateMessageContent("ok"),
    });
  });

  it("prices assistant toolCalls like DSH tool-call blocks", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createContextBreakdownProjectionUnit());

    const toolCalls = [
      { id: "c1", name: "grep", arguments: { pattern: "fold" } },
    ];
    store.append(session.id, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "calling",
      toolCalls,
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.contextBreakdown).toEqual({
      systemTokens: 0,
      toolsTokens: 0,
      messageTokens: estimateAssistantSurface("calling", toolCalls),
    });
  });

  it("keeps compaction surface delta 0 without shadowedTokenCount", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createContextBreakdownProjectionUnit());
    registry.register(createContextPressureProjectionUnit());

    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "long history before compact",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "ack",
      usage: { inputTokens: 50, outputTokens: 2 },
    });
    driveAll(registry, session.id, store);

    const before = registry.snapshot(session.id).values.contextBreakdown!
      .messageTokens;
    const pressureBefore = registry.snapshot(session.id).values.contextPressure!
      .projectedTokens;

    store.append(session.id, {
      type: "context/compaction",
      ts: 3,
      reason: "manual",
      summary: "summarized head that is much longer than the prior messages",
      recent: "tail kept verbatim outside the summary",
    });
    const events = store.get(session.id).events;
    registry.drive(session.id, events[events.length - 1]!, events.length);

    expect(registry.snapshot(session.id).values.contextBreakdown).toMatchObject({
      messageTokens: before,
    });
    expect(registry.snapshot(session.id).values.contextPressure).toMatchObject({
      projectedTokens: pressureBefore,
    });
  });

  it("applies shadowedTokenCount so compaction shrinks to the checkpoint price", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createContextBreakdownProjectionUnit());
    registry.register(createContextPressureProjectionUnit());

    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      usage: { inputTokens: 40, outputTokens: 4 },
    });
    driveAll(registry, session.id, store);

    const before = registry.snapshot(session.id).values.contextBreakdown!
      .messageTokens;
    expect(before).toBeGreaterThan(20);
    const pressureBefore = registry.snapshot(session.id).values.contextPressure!
      .projectedTokens;
    expect(pressureBefore).toBeGreaterThan(20);

    const summary = "short";
    const recent = "";
    const event = {
      type: "context/compaction" as const,
      ts: 3,
      reason: "manual" as const,
      summary,
      recent,
      shadowedTokenCount: before,
    };
    const checkpoint = estimateMessageContent(formatCompactionForModel(event));
    store.append(session.id, event);
    const events = store.get(session.id).events;
    registry.drive(session.id, events[events.length - 1]!, events.length);

    expect(registry.snapshot(session.id).values.contextBreakdown).toEqual({
      systemTokens: 0,
      toolsTokens: 0,
      messageTokens: checkpoint,
    });
    // Same foldSurfaceTokens signed delta on both meters (projected ≠ surface).
    const pressureAfter = registry.snapshot(session.id).values.contextPressure!
      .projectedTokens!;
    expect(pressureBefore! - pressureAfter).toBe(before - checkpoint);
  });

  it("keeps pressure surfaceTokens equal to breakdown messageTokens", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createContextBreakdownProjectionUnit());
    registry.register(createContextPressureProjectionUnit());

    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hello",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      toolCalls: [{ id: "c1", name: "read", arguments: { path: "a.ts" } }],
      usage: { inputTokens: 12, outputTokens: 2 },
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      result: {
        toolCallId: "c1",
        name: "read",
        content: "file body",
      },
    });
    driveAll(registry, session.id, store);
    const beforeBreakdown = registry.snapshot(session.id).values.contextBreakdown!
      .messageTokens;
    const beforePressure = registry.snapshot(session.id).values.contextPressure!
      .projectedTokens!;

    let surface = 0;
    for (const ev of store.get(session.id).events) {
      surface = foldSurfaceTokens(surface, ev);
    }
    store.append(session.id, {
      type: "context/compaction",
      ts: 4,
      reason: "auto",
      summary: "s",
      recent: "r",
      shadowedTokenCount: surface,
    });
    const events = store.get(session.id).events;
    registry.drive(session.id, events[events.length - 1]!, events.length);

    const breakdown = registry.snapshot(session.id).values.contextBreakdown!;
    const pressure = registry.snapshot(session.id).values.contextPressure!;
    const compactEv = events.find(
      (e): e is ContextCompactionEvent => e.type === "context/compaction",
    );
    expect(compactEv).toBeDefined();
    const checkpoint = estimateMessageContent(
      formatCompactionForModel(compactEv!),
    );
    expect(breakdown.messageTokens).toBe(checkpoint);
    expect(beforePressure - pressure.projectedTokens!).toBe(
      beforeBreakdown - checkpoint,
    );
  });
});
