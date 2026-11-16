import { describe, expect, it } from "vitest";
import { admitPrompt, createMemorySessionStore } from "@xrkseek/core-session";
import {
  FacePeerCollabWaiters,
  armPeerCollabAfterPrompt,
  clearPeerCollabAfterSyncReply,
  deliverPeerCollabIdleHandoffs,
  deliverPeerCollabStopHandoffs,
  formatPeerCollabCompletionNotice,
  formatPeerCollabStopHandoffNotice,
} from "../src/peer-collab-handoff.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createBareFaceRuntime, idleFaceDrain } from "./helpers/bare-runtime.js";

async function createSession(
  runtime: ReturnType<typeof createBareFaceRuntime>,
  rpcId: string,
): Promise<string> {
  const created = await dispatchFaceMethod(runtime, "session.create", rpcId, {});
  if (!created.result.ok) throw new Error(`create ${rpcId}`);
  return (created.result.value as { sessionId: string }).sessionId;
}

describe("FacePeerCollabWaiters", () => {
  it("replaces prior arm from the same waiter→peer pair", () => {
    const w = new FacePeerCollabWaiters();
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "a",
      seqAtSend: 1,
      mode: "async",
    });
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "a",
      seqAtSend: 5,
      mode: "sync-promoted",
    });
    const list = w.listForPeer("peer");
    expect(list).toHaveLength(1);
    expect(list[0]?.seqAtSend).toBe(5);
    expect(list[0]?.mode).toBe("sync-promoted");
  });

  it("idle take clears waiters once; stop suppresses later idle", () => {
    const w = new FacePeerCollabWaiters();
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "a",
      seqAtSend: 0,
    });
    expect(w.takeIdleWaiters("peer")).toHaveLength(1);
    expect(w.takeIdleWaiters("peer")).toHaveLength(0);

    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "b",
      seqAtSend: 0,
    });
    expect(w.takeStopWaiters("peer").map((x) => x.waiterSessionId)).toEqual([
      "b",
    ]);
    expect(w.takeStopWaiters("peer")).toHaveLength(0);
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "c",
      seqAtSend: 0,
    });
    // Stop already sent this stretch — idle stays suppressed until markRunning.
    expect(w.takeIdleWaiters("peer")).toHaveLength(0);
    w.markRunning("peer");
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "c",
      seqAtSend: 1,
    });
    expect(w.takeIdleWaiters("peer")).toHaveLength(1);
  });

  it("re-stamps armed waiters onto the new running epoch", () => {
    const w = new FacePeerCollabWaiters();
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "a",
      seqAtSend: 0,
    });
    expect(w.listForPeer("peer")[0]?.epoch).toBe(0);
    w.markRunning("peer");
    expect(w.listForPeer("peer")[0]?.epoch).toBe(1);
    expect(w.takeIdleWaiters("peer")).toHaveLength(1);
  });

  it("idle take skips sync-promoted unless includePromoted", () => {
    const w = new FacePeerCollabWaiters();
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "sync",
      seqAtSend: 0,
      mode: "sync-promoted",
    });
    w.arm({
      peerSessionId: "peer",
      waiterSessionId: "async",
      seqAtSend: 0,
      mode: "async",
    });
    expect(w.takeIdleWaiters("peer").map((x) => x.waiterSessionId)).toEqual([
      "async",
    ]);
    expect(w.listForPeer("peer").map((x) => x.waiterSessionId)).toEqual([
      "sync",
    ]);
    expect(
      w
        .takeIdleWaiters("peer", { includePromoted: true })
        .map((x) => x.waiterSessionId),
    ).toEqual(["sync"]);
  });
});

describe("peer collab notice copy", () => {
  it("formats completion and stop notices", () => {
    expect(
      formatPeerCollabCompletionNotice({
        peerSessionId: "s1",
        answer: "done",
        outcomeLine: "ok",
      }),
    ).toContain("[会话协作] Session s1 finished a turn.");
    expect(
      formatPeerCollabStopHandoffNotice({
        peerSessionId: "s1",
        why: "stopped by the user",
        answer: "partial",
      }),
    ).toContain("Partial answer so far:");
  });
});

describe("peer collab deliver", () => {
  it("idle handoff steers the waiter and clears the arm", async () => {
    const store = createMemorySessionStore();
    const wakes: string[] = [];
    const admits: { sessionId: string; content: string }[] = [];
    const runtime = createBareFaceRuntime({
      store,
      drain: {
        ...idleFaceDrain,
        wake(id) {
          wakes.push(id);
        },
      },
      resolveAgent: async (sessionId) =>
        ({
          admit: (content: string, opts?: { delivery?: string }) => {
            admits.push({ sessionId, content: String(content) });
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          danglingPromotedAdmits: () => [],
          hasInboxWork: () => false,
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });
    const peerId = await createSession(runtime, "peer");
    const waiterId = await createSession(runtime, "waiter");
    store.append(peerId, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "peer reply body",
    });

    armPeerCollabAfterPrompt({
      runtime,
      peerSessionId: peerId,
      waiterSessionId: waiterId,
      seqAtSend: 0,
      wait: false,
    });
    deliverPeerCollabIdleHandoffs(runtime, peerId);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });

    expect(wakes).toContain(waiterId);
    expect(runtime.peerCollabWaiters.listForPeer(peerId)).toHaveLength(0);
    expect(admits).toHaveLength(1);
    expect(admits[0]?.sessionId).toBe(waiterId);
    expect(admits[0]?.content).toContain("会话协作");
    expect(admits[0]?.content).toContain("peer reply body");
  });

  it("stop handoff suppresses idle double-deliver", async () => {
    const store = createMemorySessionStore();
    const admits: string[] = [];
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: async (sessionId) =>
        ({
          admit: (content: string, opts?: { delivery?: string }) => {
            admits.push(`${sessionId}:${content}`);
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          danglingPromotedAdmits: () => [],
          hasInboxWork: () => false,
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });
    const peerId = await createSession(runtime, "peer");
    const waiterId = await createSession(runtime, "waiter");
    store.append(peerId, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "partial so far",
    });
    armPeerCollabAfterPrompt({
      runtime,
      peerSessionId: peerId,
      waiterSessionId: waiterId,
      seqAtSend: 0,
      wait: true,
    });
    deliverPeerCollabStopHandoffs(runtime, peerId, "stopped by the user");
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });
    const waiterAdmits = admits.filter((a) => a.startsWith(`${waiterId}:`));
    expect(waiterAdmits).toHaveLength(1);
    expect(waiterAdmits[0]).toMatch(/stopped by the user/);
    expect(waiterAdmits[0]).toMatch(/partial so far/);

    deliverPeerCollabIdleHandoffs(runtime, peerId);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });
    expect(admits.filter((a) => a.startsWith(`${waiterId}:`))).toHaveLength(1);
  });

  it("sync success clears the arm so idle does not re-deliver", () => {
    const runtime = createBareFaceRuntime();
    armPeerCollabAfterPrompt({
      runtime,
      peerSessionId: "peer",
      waiterSessionId: "waiter",
      seqAtSend: 0,
      wait: true,
    });
    expect(runtime.peerCollabWaiters.listForPeer("peer")).toHaveLength(1);
    clearPeerCollabAfterSyncReply({
      runtime,
      peerSessionId: "peer",
      waiterSessionId: "waiter",
    });
    expect(runtime.peerCollabWaiters.listForPeer("peer")).toHaveLength(0);
  });

  it("drain running then idle delivers via onSessionDrainStatus", async () => {
    const store = createMemorySessionStore();
    const admits: string[] = [];
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: async (sessionId) =>
        ({
          admit: (content: string, opts?: { delivery?: string }) => {
            admits.push(`${sessionId}:${String(content)}`);
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          danglingPromotedAdmits: () => [],
          hasInboxWork: () => false,
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });
    const peerId = await createSession(runtime, "peer");
    const waiterId = await createSession(runtime, "waiter");
    runtime.onSessionDrainStatus(peerId, true);
    armPeerCollabAfterPrompt({
      runtime,
      peerSessionId: peerId,
      waiterSessionId: waiterId,
      seqAtSend: 0,
      wait: false,
    });
    store.append(peerId, {
      type: "assistant/message",
      ts: 2,
      turnId: "t2",
      stepId: "s2",
      content: "drain idle answer",
    });
    runtime.onSessionDrainStatus(peerId, false);
    await new Promise<void>((resolve) => {
      queueMicrotask(() => queueMicrotask(resolve));
    });
    expect(admits.some((a) => a.includes("drain idle answer"))).toBe(true);
  });
});
