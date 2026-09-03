import { describe, expect, expectTypeOf, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  SessionLogOffset,
  SessionSeq,
  SessionSeqCursor,
  createMemorySessionStore,
  eventAt,
  eventCount,
  lastSessionEvent,
  readSessionEvents,
  resolveHalfOpenEventRange,
  sessionEventAt,
  sessionEventCount,
  sessionEventsFrom,
  snapshotEvents,
  type SessionLogOffset as SessionLogOffsetType,
  type SessionSeq as SessionSeqType,
  type SessionSeqCursor as SessionSeqCursorType,
} from "../src/index.js";

describe("Session log positions", () => {
  it("admits non-negative safe integers into distinct sequence roles", () => {
    const seq = SessionSeq(3);
    const offset = SessionLogOffset(4);
    expect(seq).toBe(3);
    expect(offset).toBe(4);
    expectTypeOf(seq).toEqualTypeOf<SessionSeqType>();
    expectTypeOf(offset).toEqualTypeOf<SessionLogOffsetType>();
    expectTypeOf(seq).not.toEqualTypeOf<SessionLogOffsetType>();
    expectTypeOf<SessionSeqCursorType>().toEqualTypeOf<SessionSeqType | -1>();
    expect(SessionSeqCursor(-1)).toBe(-1);
    expect(SessionSeqCursor(2)).toBe(2);
  });

  it.each([-1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid Session sequence positions (%s)",
    (value) => {
      expect(() => SessionSeq(value)).toThrow(/SessionSeq must be a non-negative safe integer/);
      expect(() => SessionLogOffset(value)).toThrow(/SessionLogOffset must be a non-negative safe integer/);
    },
  );

  it("rejects invalid SessionSeqCursor values other than -1", () => {
    expect(() => SessionSeqCursor(-2)).toThrow(/SessionSeq/);
    expect(() => SessionSeqCursor(0.5)).toThrow(/SessionSeq/);
  });
});

describe("Session event accessors", () => {
  it("reads by seq, reuses full-range identity, and exposes store helpers", () => {
    const store = createMemorySessionStore();
    const created = store.create("typed");
    store.append(created.id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "a",
    } satisfies SessionEvent);
    store.append(created.id, {
      type: "user/message",
      ts: 2,
      turnId: "t",
      content: "b",
    } satisfies SessionEvent);
    const record = store.get("typed");

    expect(eventCount(record)).toBe(2);
    expect(sessionEventCount(store, "typed")).toBe(2);
    expect(eventAt(record, SessionSeq(0))?.type).toBe("user/message");
    expect(sessionEventAt(store, "typed", SessionSeq(1))).toMatchObject({ content: "b" });
    expect(sessionEventAt(store, "typed", SessionSeq(9))).toBeUndefined();
    expect(lastSessionEvent(store, "typed")).toMatchObject({ content: "b" });

    const full = snapshotEvents(record);
    expect(full).toBe(record.events);
    expect(readSessionEvents(store, "typed")).toBe(record.events);
    expect(store.get("typed").events).toBe(record.events);
    expect(snapshotEvents(record, SessionLogOffset(1)).map((e) => e.type)).toEqual([
      "user/message",
    ]);
    expect(snapshotEvents(record, SessionLogOffset(0), SessionLogOffset(1))).toHaveLength(1);

    expect(readSessionEvents(store, "typed").map((e) => e.content)).toEqual(["a", "b"]);
    expect(
      readSessionEvents(store, "typed", SessionLogOffset(1)).map((e) => e.content),
    ).toEqual(["b"]);
    expect(sessionEventsFrom(store, "typed", SessionLogOffset(1)).map((e) => e.content)).toEqual([
      "b",
    ]);

    const range = resolveHalfOpenEventRange(2, 1);
    expect(range).toEqual({ from: 1, to: 2 });
  });
});
