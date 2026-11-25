import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
  danglingPromotesForTurn,
  deriveMessages,
  listDanglingPromotedAdmits,
  listPendingAdmits,
  listSessionsNeedingInboxRecover,
  listSessionsWithPendingAdmits,
  newSession,
  promoteNextAdmit,
  promoteAdmitsForTurn,
  promotedUserMessageSource,
  promotePendingSteers,
  resolveAdmitsForTurn,
  sessionHasInboxWork,
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

  it("re-admit after withdraw with the same id is pending again", () => {
    // Queue edit rewrite keeps stable admitIds; the old closed-forever scan
    // would drop the second admit and force minting new ids.
    const store = createMemorySessionStore();
    const s = newSession(store);
    const first = admitPrompt(store, s.id, "before");
    withdrawAdmit(store, s.id, first.admitId);
    const again = admitPrompt(store, s.id, "after", { admitId: first.admitId });
    expect(again.admitId).toBe(first.admitId);
    const pending = listPendingAdmits(store.get(s.id).events, s.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      admitId: first.admitId,
      content: "after",
    });
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

  it("persists and lists optional rpcId on pending admits", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const receipt = admitPrompt(store, s.id, "echo-me", {
      delivery: "steer",
      rpcId: "client-echo-9",
    });
    expect(receipt.rpcId).toBe("client-echo-9");
    const pending = listPendingAdmits(store.get(s.id).events, s.id);
    expect(pending).toEqual([
      expect.objectContaining({
        admitId: receipt.admitId,
        content: "echo-me",
        delivery: "steer",
        rpcId: "client-echo-9",
      }),
    ]);
    const ev = store.get(s.id).events.find((e) => e.type === "prompt/admitted");
    expect(ev).toMatchObject({ rpcId: "client-echo-9" });
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

  it("does not coalesce boss steer with handoff (keeps families separate)", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const boss = admitPrompt(store, s.id, "boss cut-in", { delivery: "steer" });
    const handoff = admitPrompt(store, s.id, "child report", {
      delivery: "steer",
      source: {
        kind: "handoff",
        form: "notice",
        via: "subagent",
        fromSessionId: "sess_child",
        label: "发版员",
      },
    });
    const batch = promoteAdmitsForTurn(store, s.id);
    expect(batch.steerBatch).toBe(true);
    expect(batch.content).toBe("boss cut-in");
    expect(batch.receipts.map((r) => r.admitId)).toEqual([boss.admitId]);
    // Boss/human admits omit source; Face treats undefined as human for rpc stamp.
    expect(promotedUserMessageSource(batch.receipts)).toBeUndefined();
    expect(
      listPendingAdmits(store.get(s.id).events).map((p) => p.admitId),
    ).toEqual([handoff.admitId]);
  });

  it("does not coalesce two ask-user late answers (each questionRpcId is its own card)", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const a = admitPrompt(store, s.id, "late answer A", {
      delivery: "steer",
      source: {
        kind: "plugin",
        plugin: "ask-user",
        form: "notice",
        questionRpcId: "q_a",
      },
    });
    const b = admitPrompt(store, s.id, "late answer B", {
      delivery: "steer",
      source: {
        kind: "plugin",
        plugin: "ask-user",
        form: "notice",
        questionRpcId: "q_b",
      },
    });
    const batch = promoteAdmitsForTurn(store, s.id);
    expect(batch.receipts.map((r) => r.admitId)).toEqual([a.admitId]);
    expect(
      listPendingAdmits(store.get(s.id).events).map((p) => p.admitId),
    ).toEqual([b.admitId]);
  });

  it("does not coalesce two job-completion steers (each jobId is its own card)", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const a = admitPrompt(store, s.id, "background job bash-62 finished", {
      delivery: "steer",
      source: {
        kind: "plugin",
        plugin: "job-completion",
        form: "notice",
        jobId: "bash-62",
        summary: "bash-62 [completed]",
      },
    });
    const b = admitPrompt(store, s.id, "background job bash-64 finished", {
      delivery: "steer",
      source: {
        kind: "plugin",
        plugin: "job-completion",
        form: "notice",
        jobId: "bash-64",
        summary: "bash-64 [completed]",
      },
    });
    const batch = promoteAdmitsForTurn(store, s.id);
    expect(batch.content).toBe("background job bash-62 finished");
    expect(batch.receipts.map((r) => r.admitId)).toEqual([a.admitId]);
    expect(promotedUserMessageSource(batch.receipts)).toMatchObject({
      kind: "plugin",
      jobId: "bash-62",
    });
    expect(
      listPendingAdmits(store.get(s.id).events).map((p) => p.admitId),
    ).toEqual([b.admitId]);

    const second = promoteAdmitsForTurn(store, s.id);
    expect(second.content).toBe("background job bash-64 finished");
    expect(second.receipts.map((r) => r.admitId)).toEqual([b.admitId]);
    expect(promotedUserMessageSource(second.receipts)).toMatchObject({
      kind: "plugin",
      jobId: "bash-64",
    });
  });

  it("coalesces two handoffs from the same child; leaves a different family", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const handoffSource = {
      kind: "handoff" as const,
      form: "notice" as const,
      via: "subagent" as const,
      fromSessionId: "sess_child",
      label: "发版员",
    };
    const a = admitPrompt(store, s.id, "part A", { delivery: "steer", source: handoffSource });
    const b = admitPrompt(store, s.id, "part B", { delivery: "steer", source: handoffSource });
    admitPrompt(store, s.id, "boss later", { delivery: "steer" });
    const batch = promoteAdmitsForTurn(store, s.id);
    expect(batch.content).toBe("part A\n\npart B");
    expect(batch.receipts.map((r) => r.admitId)).toEqual([a.admitId, b.admitId]);
    expect(promotedUserMessageSource(batch.receipts)).toMatchObject({ kind: "handoff" });
    expect(
      listPendingAdmits(store.get(s.id).events).map((p) => p.content),
    ).toEqual(["boss later"]);
  });

  it("dangling close is per speech family (boss speech leaves handoff dangling)", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const handoffSource = {
      kind: "handoff" as const,
      form: "notice" as const,
      via: "subagent" as const,
      fromSessionId: "sess_child",
      label: "发版员",
    };
    const boss = admitPrompt(store, s.id, "boss cut-in", { delivery: "steer" });
    const handoff = admitPrompt(store, s.id, "child report", {
      delivery: "steer",
      source: handoffSource,
    });
    // Crash window that promoted both families before any user/message.
    store.append(s.id, {
      type: "prompt/promoted",
      ts: Date.now(),
      admitId: boss.admitId,
    });
    store.append(s.id, {
      type: "prompt/promoted",
      ts: Date.now(),
      admitId: handoff.admitId,
    });

    const first = resolveAdmitsForTurn(store, s.id);
    expect(first.content).toBe("boss cut-in");
    expect(first.receipts.map((r) => r.admitId)).toEqual([boss.admitId]);

    store.append(s.id, {
      type: "user/message",
      ts: Date.now(),
      turnId: "t-boss",
      content: "boss cut-in",
      source: { kind: "user" },
    });
    // Boss speech must not retire the handoff promote (family partition).
    expect(
      listDanglingPromotedAdmits(store.get(s.id).events, s.id).map((p) => p.admitId),
    ).toEqual([handoff.admitId]);

    const second = resolveAdmitsForTurn(store, s.id);
    expect(second.content).toBe("child report");
    expect(second.receipts.map((r) => r.admitId)).toEqual([handoff.admitId]);
    expect(promotedUserMessageSource(second.receipts)).toMatchObject({
      kind: "handoff",
    });
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

  it("listSessionsWithPendingAdmits skips empty and closed inboxes", () => {
    const store = createMemorySessionStore();
    const pending = newSession(store, "has-pending");
    const empty = newSession(store, "empty");
    const closed = newSession(store, "closed");
    admitPrompt(store, pending.id, "wait");
    const done = admitPrompt(store, closed.id, "gone");
    withdrawAdmit(store, closed.id, done.admitId);
    expect(listSessionsWithPendingAdmits(store)).toEqual(["has-pending"]);
    expect(listPendingAdmits(store.get(empty.id).events)).toHaveLength(0);
  });

  it("listDanglingPromotedAdmits recovers promote-without-user/message", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const receipt = admitPrompt(store, s.id, "crash-window", {
      delivery: "steer",
      rpcId: "echo-crash",
    });
    promoteNextAdmit(store, s.id);
    expect(listPendingAdmits(store.get(s.id).events, s.id)).toHaveLength(0);
    const dangling = listDanglingPromotedAdmits(store.get(s.id).events, s.id);
    expect(dangling).toEqual([
      expect.objectContaining({
        admitId: receipt.admitId,
        content: "crash-window",
        delivery: "steer",
        rpcId: "echo-crash",
      }),
    ]);
    expect(danglingPromotesForTurn(store.get(s.id).events, s.id)).toMatchObject({
      text: "crash-window",
      delivery: "steer",
      steerBatch: true,
    });
    expect(listSessionsNeedingInboxRecover(store)).toContain(s.id);

    store.append(s.id, {
      type: "user/message",
      ts: Date.now(),
      turnId: "t1",
      content: "crash-window",
      source: { kind: "user" },
      rpcId: "echo-crash",
    });
    expect(listDanglingPromotedAdmits(store.get(s.id).events, s.id)).toHaveLength(0);
    expect(listSessionsNeedingInboxRecover(store)).not.toContain(s.id);
  });

  it("listDanglingPromotedAdmits closes on seat speech (not only kind:user)", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const seatSource = {
      kind: "seat" as const,
      form: "speech" as const,
      channel: "parent" as const,
      fromSessionId: "sess_mgr",
    };
    const receipt = admitPrompt(store, s.id, "from-manager", {
      source: seatSource,
    });
    promoteNextAdmit(store, s.id);
    expect(listDanglingPromotedAdmits(store.get(s.id).events, s.id)).toHaveLength(1);
    store.append(s.id, {
      type: "user/message",
      ts: Date.now(),
      turnId: "t-seat",
      content: "from-manager",
      source: seatSource,
    });
    expect(listDanglingPromotedAdmits(store.get(s.id).events, s.id)).toHaveLength(0);
    // A later pending must promote, not re-resolve the settled seat admit.
    admitPrompt(store, s.id, "next");
    const resolved = resolveAdmitsForTurn(store, s.id);
    expect(resolved.text).toBe("next");
    expect(resolved.receipts[0]?.admitId).not.toBe(receipt.admitId);
  });

  it("resolveAdmitsForTurn: dangling queue wins over newer pending", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const first = admitPrompt(store, s.id, "already-promoted");
    promoteNextAdmit(store, s.id);
    admitPrompt(store, s.id, "still-pending");
    const resolved = resolveAdmitsForTurn(store, s.id);
    expect(resolved).toMatchObject({
      text: "already-promoted",
      delivery: "queue",
      steerBatch: false,
      receipts: [expect.objectContaining({ admitId: first.admitId })],
    });
    expect(listPendingAdmits(store.get(s.id).events, s.id).map((p) => p.content)).toEqual([
      "still-pending",
    ]);
    expect(sessionHasInboxWork(store.get(s.id).events, s.id)).toBe(true);
  });

  it("resolveAdmitsForTurn: dangling steers merge with remaining pending steers", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    const a = admitPrompt(store, s.id, "steer-a", { delivery: "steer" });
    admitPrompt(store, s.id, "steer-b", { delivery: "steer" });
    admitPrompt(store, s.id, "queue-wait");
    // Mid-batch crash: only the first steer was promoted.
    store.append(s.id, {
      type: "prompt/promoted",
      ts: Date.now(),
      admitId: a.admitId,
    });
    const resolved = resolveAdmitsForTurn(store, s.id);
    expect(resolved.steerBatch).toBe(true);
    expect(resolved.text).toBe("steer-a\n\nsteer-b");
    expect(
      listPendingAdmits(store.get(s.id).events, s.id).map((p) => p.content),
    ).toEqual(["queue-wait"]);
  });

  it("resolveAdmitsForTurn: hot path unchanged when nothing dangling", () => {
    const store = createMemorySessionStore();
    const s = newSession(store);
    admitPrompt(store, s.id, "q1");
    admitPrompt(store, s.id, "steer-x", { delivery: "steer" });
    const resolved = resolveAdmitsForTurn(store, s.id);
    expect(resolved).toMatchObject({
      text: "steer-x",
      delivery: "steer",
      steerBatch: true,
    });
    expect(listPendingAdmits(store.get(s.id).events, s.id).map((p) => p.content)).toEqual([
      "q1",
    ]);
  });
});
