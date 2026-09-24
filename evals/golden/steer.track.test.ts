/**
 * Golden track: steer (Codex turn/steer · Hermes steer/queue shape)
 * - Steer promotes ahead of older queue admits
 * - Multiple pending steers coalesce into one turn; queues stay pending
 * Shell UX labels this as 插队 vs 排队; steer ≠ Stop/cancel.
 */
import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
  listPendingAdmits,
  newSession,
  promoteAdmitsForTurn,
  promoteNextAdmit,
} from "@xrkseek/core-session";

describe("golden/steer", () => {
  it("steer promotes ahead of older queue admits", () => {
    const store = createMemorySessionStore();
    const s = newSession(store, "eval-steer");
    admitPrompt(store, s.id, "queued-first");
    admitPrompt(store, s.id, "steer-later", { delivery: "steer" });
    admitPrompt(store, s.id, "queued-second");

    const first = promoteNextAdmit(store, s.id);
    expect(first.content).toBe("steer-later");
    expect(first.delivery).toBe("steer");

    const second = promoteNextAdmit(store, s.id);
    expect(second.content).toBe("queued-first");
    expect(second.delivery).toBe("queue");
  });

  it("promoteAdmitsForTurn coalesces pending steers and leaves queues", () => {
    const store = createMemorySessionStore();
    const s = newSession(store, "eval-steer-batch");
    admitPrompt(store, s.id, "q1");
    const s1 = admitPrompt(store, s.id, "steer-a", { delivery: "steer" });
    const s2 = admitPrompt(store, s.id, "steer-b", { delivery: "steer" });
    admitPrompt(store, s.id, "q2");

    const batch = promoteAdmitsForTurn(store, s.id);
    expect(batch.steerBatch).toBe(true);
    expect(batch.delivery).toBe("steer");
    expect(batch.content).toBe("steer-a\n\nsteer-b");
    expect(batch.receipts.map((r) => r.admitId)).toEqual([
      s1.admitId,
      s2.admitId,
    ]);
    expect(
      listPendingAdmits(store.get(s.id).events).map((p) => p.content),
    ).toEqual(["q1", "q2"]);
  });
});
