// R8: cold session.history first page without full-log hydrate.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

type HistoryValue = {
  events: {
    event: {
      seq: number;
      type: string;
      data?: { turn?: number; content?: unknown };
    };
  }[];
  hasMore: boolean;
};

let dir = "";
const openStores: Array<{ close(): void }> = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-hist-cold-"));
});

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()!.close();
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

describe("session.history cold tail (R8)", () => {
  it("keeps absolute seq and whole-log turn numbers on a cold first page", async () => {
    const store = createPersistentSessionStore(dir);
    openStores.push(store);
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: unusedAgentResolve(),
    });
    const session = newSession(store);
    for (let i = 1; i <= 8; i++) {
      const turnId = `t${String(i)}`;
      store.append(session.id, { type: "turn/start", ts: i * 10, turnId });
      store.append(session.id, {
        type: "user/message",
        ts: i * 10 + 1,
        turnId,
        content: `ask ${String(i)}`,
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 10 + 2,
        turnId,
        stepId: `s${String(i)}`,
        content: `reply ${String(i)}`,
      });
      store.append(session.id, {
        type: "turn/end",
        ts: i * 10 + 3,
        turnId,
        reason: { kind: "completed" },
      });
    }
    store.flush?.(session.id);
    expect(store.releaseResident?.(session.id)).toBe(true);
    expect(store.isLoaded?.(session.id)).toBe(false);

    const tail = await dispatchFaceMethod(runtime, "session.history", "tail", {
      sessionId: session.id,
      maxMessages: 2,
    });
    expect(tail.result.ok).toBe(true);
    if (!tail.result.ok) throw new Error("tail history failed");
    const value = tail.result.value as HistoryValue;
    expect(value.hasMore).toBe(true);
    expect(store.isLoaded?.(session.id)).toBe(false);

    const firstSeq = value.events[0]?.event.seq;
    expect(firstSeq).toBeGreaterThan(1);
    // maxMessages=2 → last turn's user+assistant only; wire turn stays whole-log.
    const turnStart = value.events.find((row) => row.event.type === "turn/start");
    expect(turnStart?.event.data?.turn).toBe(8);

    const older = await dispatchFaceMethod(runtime, "session.history", "older", {
      sessionId: session.id,
      beforeSeq: firstSeq,
      maxMessages: 2,
    });
    expect(older.result.ok).toBe(true);
    if (!older.result.ok) throw new Error("older history failed");
    const olderValue = older.result.value as HistoryValue;
    const olderTail = olderValue.events.at(-1)?.event.seq;
    expect(olderTail).toBe((firstSeq as number) - 1);
  });
});
