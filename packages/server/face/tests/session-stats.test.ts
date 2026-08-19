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
});
