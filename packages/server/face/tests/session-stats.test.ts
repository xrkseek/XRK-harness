import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import {
  createFaceProjectionRegistry,
  createSessionStatsProjectionUnit,
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

describe("Face sessionStats projection", () => {
  it("is registered by default install", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);
    expect(registry.snapshot(session.id).values.sessionStats).toEqual({
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
    });
  });

  it("counts step/end and folds llm/ttft/tool wall times", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionStatsProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 100, turnId: "t1" });
    store.append(session.id, {
      type: "step/start",
      ts: 110,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 140,
      turnId: "t1",
      stepId: "s1",
      text: "hi",
      kind: "text",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 200,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
    });
    store.append(session.id, {
      type: "tool/call",
      ts: 210,
      turnId: "t1",
      stepId: "s1",
      call: { id: "c1", name: "grep", arguments: {} },
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 250,
      turnId: "t1",
      stepId: "s1",
      result: {
        toolCallId: "c1",
        name: "grep",
        content: "ok",
      },
    });
    store.append(session.id, {
      type: "step/end",
      ts: 260,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "turn/end",
      ts: 270,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.sessionStats).toEqual({
      turns: 1,
      steps: 1,
      llmMs: 90,
      toolMs: 40,
      ttftMs: 30,
      ttftSteps: 1,
      decodeMs: 0,
      decodeTokens: 0,
    });
  });

  it("folds decodeMs/decodeTokens from assistant/message.usage after TTFT", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionStatsProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 100, turnId: "t1" });
    store.append(session.id, {
      type: "step/start",
      ts: 110,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 140,
      turnId: "t1",
      stepId: "s1",
      text: "hi",
      kind: "text",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 200,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 12, outputTokens: 5 },
    });
    store.append(session.id, {
      type: "step/end",
      ts: 210,
      turnId: "t1",
      stepId: "s1",
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.sessionStats).toEqual({
      turns: 1,
      steps: 1,
      llmMs: 90,
      toolMs: 0,
      ttftMs: 30,
      ttftSteps: 1,
      decodeMs: 60,
      decodeTokens: 5,
    });
  });

  it("does not count cancelled stream time without assistant/message", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionStatsProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 1, turnId: "t1" });
    store.append(session.id, {
      type: "step/start",
      ts: 10,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 20,
      turnId: "t1",
      stepId: "s1",
      text: "partial",
    });
    store.append(session.id, {
      type: "step/end",
      ts: 30,
      turnId: "t1",
      stepId: "s1",
    });
    driveAll(registry, session.id, store);

    const stats = registry.snapshot(session.id).values.sessionStats;
    expect(stats).toMatchObject({ turns: 1, steps: 1, llmMs: 0, ttftSteps: 0 });
  });

  it("opens the first-token boundary on reasoning, not on the trailing tool call", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionStatsProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 100, turnId: "t1" });
    store.append(session.id, {
      type: "step/start",
      ts: 110,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 1110,
      turnId: "t1",
      stepId: "s1",
      text: "thinking...",
      kind: "reasoning",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 6100,
      turnId: "t1",
      stepId: "s1",
      text: '{"path":"a.cs"}',
      kind: "tool-call",
      toolCallId: "call_1",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 6200,
      turnId: "t1",
      stepId: "s1",
      content: "",
      usage: { inputTokens: 20, outputTokens: 8192, reasoningTokens: 8000 },
    });
    store.append(session.id, {
      type: "step/end",
      ts: 6210,
      turnId: "t1",
      stepId: "s1",
    });
    driveAll(registry, session.id, store);

    // Reasoning is generated output and outputTokens already counts it, so the
    // boundary lands on the reasoning delta: TTFT covers the thinking start
    // (1000ms), not the whole 5990ms up to the tool call. Excluding reasoning
    // read the same turn as 5990ms TTFT and a 100ms decode window over 8192
    // tokens — 81920 tok/s.
    expect(registry.snapshot(session.id).values.sessionStats).toMatchObject({
      ttftMs: 1000,
      ttftSteps: 1,
      decodeMs: 5090,
      decodeTokens: 8192,
    });
  });

  it("drops decode windows too short to time a model stream", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionStatsProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 100, turnId: "t1" });
    store.append(session.id, {
      type: "step/start",
      ts: 110,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/chunk",
      ts: 140,
      turnId: "t1",
      stepId: "s1",
      text: "hi",
      kind: "text",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 142,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 12, outputTokens: 1836 },
    });
    store.append(session.id, {
      type: "step/end",
      ts: 150,
      turnId: "t1",
      stepId: "s1",
    });
    driveAll(registry, session.id, store);

    // A 2ms window measures write batching, not decode speed: 1836 tokens over
    // it reads as 918000 tok/s. The step still contributes model time and TTFT
    // — only the throughput sample is withheld.
    expect(registry.snapshot(session.id).values.sessionStats).toMatchObject({
      llmMs: 32,
      ttftMs: 30,
      ttftSteps: 1,
      decodeMs: 0,
      decodeTokens: 0,
    });
  });
});
