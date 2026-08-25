import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
  deriveMessages,
  listPendingAdmits,
  newSession,
  promoteNextAdmit,
  promoteAdmitsForTurn,
  promotePendingSteers,
  withdrawAdmit,
  NoPendingAdmitError,
} from "../src/index.js";

describe("newSession / admit", () => {
  it("newSession creates or reuses", () => {
    const store = createMemorySessionStore();
    const a = newSession(store, "fixed");
    const b = newSession(store, "fixed");
    expect(a.id).toBe("fixed");
    expect(b.id).toBe("fixed");
    expect(newSession(store).id).not.toBe("fixed");
  });

  it("admit is not model-visible until promoted + user/message", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const receipt = admitPrompt(store, s.id, "later");
    expect(deriveMessages(store.get(s.id).events)).toEqual([]);
    expect(listPendingAdmits(store.get(s.id).events, s.id)).toHaveLength(1);

    const promoted = promoteNextAdmit(store, s.id);
    expect(promoted.admitId).toBe(receipt.admitId);
    expect(listPendingAdmits(store.get(s.id).events, s.id)).toHaveLength(0);
    // still no chat message until runTurn appends user/message
    expect(deriveMessages(store.get(s.id).events)).toEqual([]);
  });

  it("withdraw removes pending admit", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const receipt = admitPrompt(store, s.id, "x");
    withdrawAdmit(store, s.id, receipt.admitId);
    expect(listPendingAdmits(store.get(s.id).events, s.id)).toHaveLength(0);
    expect(deriveMessages(store.get(s.id).events)).toEqual([]);
  });

  it("promote with empty inbox throws", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    expect(() => promoteNextAdmit(store, s.id)).toThrow(NoPendingAdmitError);
  });

  it("default admit is queue; steer promotes ahead of older queue", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const q = admitPrompt(store, s.id, "queued-first");
    expect(q.delivery).toBe("queue");
    const events = store.get(s.id).events;
    const admitted = events.find((e) => e.type === "prompt/admitted");
    expect(
      admitted && "delivery" in admitted ? admitted.delivery : undefined,
    ).toBeUndefined();

    admitPrompt(store, s.id, "steer-later", { delivery: "steer" });
    admitPrompt(store, s.id, "queued-second");

    const first = promoteNextAdmit(store, s.id);
    expect(first.content).toBe("steer-later");
    expect(first.delivery).toBe("steer");

    const second = promoteNextAdmit(store, s.id);
    expect(second.content).toBe("queued-first");
    expect(second.delivery).toBe("queue");
  });

  it("promoteAdmitsForTurn coalesces all pending steers; leaves queues", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
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

  it("promoteAdmitsForTurn promotes one queue when no steers", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    admitPrompt(store, s.id, "a");
    admitPrompt(store, s.id, "b");
    const one = promoteAdmitsForTurn(store, s.id);
    expect(one.steerBatch).toBe(false);
    expect(one.content).toBe("a");
    expect(listPendingAdmits(store.get(s.id).events)).toHaveLength(1);
  });

  it("promotePendingSteers claims steers only; leaves queues", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    admitPrompt(store, s.id, "q1");
    admitPrompt(store, s.id, "steer-x", { delivery: "steer" });
    admitPrompt(store, s.id, "q2");

    const claimed = promotePendingSteers(store, s.id);
    expect(claimed?.content).toBe("steer-x");
    expect(claimed?.steerBatch).toBe(true);
    expect(
      listPendingAdmits(store.get(s.id).events).map((p) => p.content),
    ).toEqual(["q1", "q2"]);
    expect(promotePendingSteers(store, s.id)).toBeUndefined();
  });
});
