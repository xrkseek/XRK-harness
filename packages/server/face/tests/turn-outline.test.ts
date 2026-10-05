import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { FaceWireIdMaps } from "../src/adapt/index.js";
import {
  createFaceProjectionRegistry,
  createTurnOutlineProjectionUnit,
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

describe("Face turnOutline projection", () => {
  it("is registered by default install", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);
    expect(registry.snapshot(session.id).values.turnOutline).toEqual([]);
  });

  it("folds turn/start seq, first human prompt, and turn/end response", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 100, turnId: "t1" });
    store.append(session.id, {
      type: "user/message",
      ts: 110,
      turnId: "t1",
      content: "hello world",
    });
    store.append(session.id, {
      type: "step/start",
      ts: 120,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 200,
      turnId: "t1",
      stepId: "s1",
      content: "hi there",
    });
    store.append(session.id, {
      type: "step/end",
      ts: 210,
      turnId: "t1",
      stepId: "s1",
    });
    store.append(session.id, {
      type: "turn/end",
      ts: 220,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "hello world", response: "hi there" },
    ]);
  });

  it("keeps first human prompt and ignores inject sources", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 1, turnId: "t1" });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "skill body",
      source: { kind: "skill-catalog", form: "catalog", entries: [] },
    });
    store.append(session.id, {
      type: "user/message",
      ts: 3,
      turnId: "t1",
      content: "first ask",
    });
    store.append(session.id, {
      type: "user/message",
      ts: 4,
      turnId: "t1",
      content: "steer later",
    });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "first ask", response: "" },
    ]);
  });

  it("numbers turns by first-seen turnId order", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());

    store.append(session.id, { type: "turn/start", ts: 1, turnId: "a" });
    store.append(session.id, {
      type: "turn/end",
      ts: 2,
      turnId: "a",
      reason: { kind: "completed" },
    });
    store.append(session.id, { type: "turn/start", ts: 3, turnId: "b" });
    driveAll(registry, session.id, store);

    expect(registry.snapshot(session.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "", response: "" },
      { turn: 2, seq: 3, prompt: "", response: "" },
    ]);
  });

  it("turn numbers match FaceWireIdMaps and seq is the turn/start watermark", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());
    const ids = new FaceWireIdMaps();

    store.append(session.id, { type: "turn/start", ts: 1, turnId: "t-a" });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t-a",
      content: "ask",
    });
    store.append(session.id, { type: "turn/start", ts: 3, turnId: "t-b" });
    driveAll(registry, session.id, store);

    expect(ids.turn(session.id, "t-a")).toBe(1);
    expect(ids.turn(session.id, "t-b")).toBe(2);
    expect(registry.snapshot(session.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "ask", response: "" },
      { turn: 2, seq: 3, prompt: "", response: "" },
    ]);
  });

  it("keeps mux quiet on draft-only assistant/message until turn/end", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());
    const pushed: Array<{ key: string; value: unknown; seq: number }> = [];
    registry.onChanged((_id, key, value, seq) => {
      pushed.push({ key, value, seq });
    });

    store.append(session.id, { type: "turn/start", ts: 1, turnId: "t1" });
    registry.drive(session.id, store.get(session.id).events[0]!, 1);
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "ask",
    });
    registry.drive(session.id, store.get(session.id).events[1]!, 2);
    store.append(session.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      content: "partial reply",
    });
    registry.drive(session.id, store.get(session.id).events[2]!, 3);
    store.append(session.id, {
      type: "assistant/message",
      ts: 4,
      turnId: "t1",
      stepId: "s1",
      content: "final reply",
    });
    registry.drive(session.id, store.get(session.id).events[3]!, 4);

    expect(pushed.filter((row) => row.key === "turnOutline")).toEqual([
      {
        key: "turnOutline",
        value: [{ turn: 1, seq: 1, prompt: "", response: "" }],
        seq: 1,
      },
      {
        key: "turnOutline",
        value: [{ turn: 1, seq: 1, prompt: "ask", response: "" }],
        seq: 2,
      },
    ]);

    store.append(session.id, {
      type: "turn/end",
      ts: 5,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    registry.drive(session.id, store.get(session.id).events[4]!, 5);
    expect(pushed.filter((row) => row.key === "turnOutline").at(-1)).toEqual({
      key: "turnOutline",
      value: [{ turn: 1, seq: 1, prompt: "ask", response: "final reply" }],
      seq: 5,
    });
  });

  it("dedups a repeated turnId anywhere in the log, not just adjacent", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());
    const ids = new FaceWireIdMaps();

    // t-a starts; t-b starts; then a stray t-a turn/start replays after
    // history paging. The wire numbers it 1 again (FaceWireIdMaps caches by
    // first seen) — the outline must not mint a third entry for it, or the
    // rail would show a phantom turn and the ladder would drift from the
    // transcript on every replay.
    store.append(session.id, { type: "turn/start", ts: 1, turnId: "t-a" });
    store.append(session.id, { type: "turn/start", ts: 3, turnId: "t-b" });
    store.append(session.id, { type: "turn/start", ts: 5, turnId: "t-a" });
    driveAll(registry, session.id, store);

    expect(ids.turn(session.id, "t-a")).toBe(1);
    expect(ids.turn(session.id, "t-b")).toBe(2);
    expect(registry.snapshot(session.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "", response: "" },
      { turn: 2, seq: 2, prompt: "", response: "" },
    ]);
  });

  it("keeps one session's draft out of a fresh session's outline", () => {
    const store = createMemorySessionStore();
    const first = newSession(store);
    const second = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTurnOutlineProjectionUnit());

    // First session streams an assistant reply mid-turn, leaving a draft.
    const events: Parameters<typeof registry.drive>[1][] = [];
    const drive = (event: Parameters<typeof registry.drive>[1], seq: number) => {
      registry.drive(first.id, event, seq);
    };
    drive({ type: "turn/start", ts: 1, turnId: "t1" }, 1);
    drive(
      {
        type: "assistant/message",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        content: "streaming reply",
      },
      2,
    );
    void events;

    // Second session starts clean: its outline must not pre-carry turn 1's
    // response draft from the first session (init returning a shared constant
    // would have leaked it into the new session's fold).
    registry.drive(second.id, { type: "turn/start", ts: 1, turnId: "u1" }, 1);
    expect(registry.snapshot(second.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "", response: "" },
    ]);
  });
});
