import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import {
  parseEventWindowPayload,
  readSessionEventWindow,
  SESSION_EVENT_WINDOW_MAX,
} from "../src/session-event-window.js";

describe("session event window", () => {
  it("clamps before/after and maps Face seq to store indices", () => {
    const store = createMemorySessionStore();
    const id = newSession(store).id;
    for (let i = 0; i < 5; i += 1) {
      store.append(id, {
        type: "user/message",
        ts: i + 1,
        turnId: `t${i}`,
        content: `m${i}`,
        source: { kind: "user" },
      });
    }
    const window = readSessionEventWindow(store, {
      sessionId: id,
      seq: 3,
      before: 1,
      after: 1,
    });
    expect(window).toEqual({
      sessionId: id,
      seq: 3,
      startSeq: 2,
      endSeq: 4,
      events: [
        { seq: 2, type: "user/message", ts: 2 },
        { seq: 3, type: "user/message", ts: 3 },
        { seq: 4, type: "user/message", ts: 4 },
      ],
    });
  });

  it("rejects out-of-range seq; clamps oversize before/after", () => {
    const store = createMemorySessionStore();
    const id = newSession(store).id;
    store.append(id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "only",
      source: { kind: "user" },
    });
    expect(
      readSessionEventWindow(store, {
        sessionId: id,
        seq: 9,
        before: 0,
        after: 0,
      }),
    ).toBeUndefined();

    const clamped = parseEventWindowPayload({
      sessionId: id,
      seq: 1,
      before: SESSION_EVENT_WINDOW_MAX + 1,
      after: -1,
    });
    expect(clamped.ok).toBe(false);

    const ok = parseEventWindowPayload({
      sessionId: id,
      seq: 1,
      before: SESSION_EVENT_WINDOW_MAX + 1,
      after: 0,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.before).toBe(SESSION_EVENT_WINDOW_MAX);
    }
  });
});
