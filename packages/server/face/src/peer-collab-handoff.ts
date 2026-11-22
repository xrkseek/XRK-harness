/**
 * Session-collab report-back (thread_message / workspace_session_prompt).
 *
 * Same discipline as subagent courier×handoff — one channel per stretch:
 *
 * | Mode | Channel | When |
 * |------|---------|------|
 * | wait:true success | tool result only | clear waiters; no async notice |
 * | wait:false | async steer notice + wake | peer idle after seqAtSend |
 * | wait aborted / timed out with peer still live | promote to async arm | don't drop the reply |
 * | peer Stop | stop notice (partial answer) | suppress completion for that stretch |
 *
 * Waiters are keyed by peer session. Completing or stopping a peer delivers
 * to every armed waiter exactly once for the current idle epoch.
 */

import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { boundChildAnswer } from "./adapt/subagent-answer-bound.js";
import {
  describeChildOutcome,
  formatDescribedChildOutcome,
  lastAssistantBodyText,
} from "./adapt/subagent-notice.js";
import { isChildSessionActive } from "./external-agent-runtime.js";
import { peerCollabHandoffSource } from "./message-source.js";

export type PeerCollabWaitMode = "async" | "sync-promoted";

export type PeerCollabWaiter = {
  readonly waiterSessionId: string;
  /** Event length of the peer log when the prompt was sent. */
  readonly seqAtSend: number;
  readonly mode: PeerCollabWaitMode;
  /** Idle epoch of the peer when armed (stale delivers drop). */
  readonly epoch: number;
};

/** Alias of `peerCollabHandoffSource` (durable handoff tag for peer → waiter). */
export const peerCollabNoticeSource = peerCollabHandoffSource;

export function formatPeerCollabCompletionNotice(input: {
  readonly peerSessionId: string;
  readonly answer: string;
  readonly outcomeLine?: string;
}): string {
  const head = `[会话协作] Session ${input.peerSessionId} finished a turn.`;
  const bits = [head];
  if (input.outcomeLine?.trim()) {
    bits.push(`Outcome: ${input.outcomeLine.trim()}`);
  }
  // Informational only: models that treat every handoff as "must reply"
  // reopen the peer with thread_message and loop (向日葵↔经理 zip).
  bits.push(
    "Informational — do not thread_message back unless you have a new ask. Courtesy acks cause ping-pong.",
  );
  const body = input.answer.trim();
  if (body) {
    bits.push("", body);
  } else {
    bits.push("", "(no assistant text — inspect the peer session if needed)");
  }
  return bits.join("\n");
}

export function formatPeerCollabStopHandoffNotice(input: {
  readonly peerSessionId: string;
  readonly why: string;
  readonly answer: string;
}): string {
  const bits = [
    `[会话协作] Session ${input.peerSessionId} ${input.why}.`,
    "Waiting turn will not get a tool reply — re-prompt if you still need work.",
  ];
  const body = input.answer.trim();
  if (body) {
    bits.push("", "Partial answer so far:", body);
  }
  return bits.join("\n");
}

/**
 * In-memory waiter registry. Lives on FaceRuntime for the Host process.
 */
export class FacePeerCollabWaiters {
  /** peerSessionId → waiters */
  private readonly byPeer = new Map<string, PeerCollabWaiter[]>();
  /** peerSessionId → idle epoch (bumped when peer goes running). */
  private readonly epoch = new Map<string, number>();
  /** peerSessionId → suppress completion for this idle stretch (after stop). */
  private readonly suppressCompletion = new Set<string>();
  /** Dedup stop notices per peer idle stretch. */
  private readonly stopSent = new Set<string>();

  currentEpoch(peerSessionId: string): number {
    return this.epoch.get(peerSessionId) ?? 0;
  }

  /**
   * Peer drain went running — new stretch may complete / stop again.
   * Re-stamp any already-armed waiters onto this epoch so a prompt that
   * armed while the peer was still idle (or between turns) still delivers
   * when this stretch settles.
   */
  markRunning(peerSessionId: string): void {
    const id = peerSessionId.trim();
    if (!id) return;
    const next = this.currentEpoch(id) + 1;
    this.epoch.set(id, next);
    this.suppressCompletion.delete(id);
    this.stopSent.delete(id);
    const prev = this.byPeer.get(id);
    if (prev?.length) {
      this.byPeer.set(
        id,
        prev.map((w) => ({ ...w, epoch: next })),
      );
    }
  }

  /**
   * Arm a waiter for async (or sync-promoted) handoff when the peer goes idle.
   * Replaces any prior arm from the same waiter→peer pair.
   */
  arm(input: {
    readonly peerSessionId: string;
    readonly waiterSessionId: string;
    readonly seqAtSend: number;
    readonly mode?: PeerCollabWaitMode;
  }): void {
    const peer = input.peerSessionId.trim();
    const waiter = input.waiterSessionId.trim();
    if (!peer || !waiter || peer === waiter) return;
    const row: PeerCollabWaiter = {
      waiterSessionId: waiter,
      seqAtSend: Math.max(0, Math.floor(input.seqAtSend)),
      mode: input.mode ?? "async",
      epoch: this.currentEpoch(peer),
    };
    const prev = this.byPeer.get(peer) ?? [];
    const next = prev.filter((w) => w.waiterSessionId !== waiter);
    next.push(row);
    this.byPeer.set(peer, next);
  }

  /** Drop waiters after a sync wait already returned the reply in the tool. */
  clearWaiter(peerSessionId: string, waiterSessionId: string): void {
    const peer = peerSessionId.trim();
    const waiter = waiterSessionId.trim();
    const prev = this.byPeer.get(peer);
    if (!prev?.length) return;
    const next = prev.filter((w) => w.waiterSessionId !== waiter);
    if (next.length === 0) this.byPeer.delete(peer);
    else this.byPeer.set(peer, next);
  }

  /**
   * Drop every arm where this session is the waiter (waiting on someone else).
   * Used by in-place truncate / edit-resubmit so a later peer idle does not
   * steer a `[会话协作]` notice into a rewritten transcript.
   */
  clearAsWaiter(waiterSessionId: string): void {
    const waiter = waiterSessionId.trim();
    if (!waiter) return;
    for (const [peer, list] of [...this.byPeer.entries()]) {
      const next = list.filter((w) => w.waiterSessionId !== waiter);
      if (next.length === 0) this.byPeer.delete(peer);
      else this.byPeer.set(peer, next);
    }
  }

  /** Stop path: suppress completion and snapshot waiters once. */
  takeStopWaiters(peerSessionId: string): readonly PeerCollabWaiter[] {
    const peer = peerSessionId.trim();
    if (!peer) return [];
    if (this.stopSent.has(peer)) return [];
    this.stopSent.add(peer);
    this.suppressCompletion.add(peer);
    const waiters = this.byPeer.get(peer) ?? [];
    this.byPeer.delete(peer);
    return waiters;
  }

  /**
   * Idle path: return waiters for this epoch and clear the ones we return.
   * By default only `async` (wait:false) — `sync-promoted` stays armed so a
   * successful wait:true tool result is not doubled by an idle steer.
   * Pass `includePromoted` after a failed sync wait to flush the leftover arm.
   * Empty when suppressed (stop already notified) or no matching arms.
   */
  takeIdleWaiters(
    peerSessionId: string,
    opts?: { readonly includePromoted?: boolean },
  ): readonly PeerCollabWaiter[] {
    const peer = peerSessionId.trim();
    if (!peer) return [];
    if (this.suppressCompletion.has(peer)) return [];
    const epoch = this.currentEpoch(peer);
    const prev = this.byPeer.get(peer) ?? [];
    const taken: PeerCollabWaiter[] = [];
    const keep: PeerCollabWaiter[] = [];
    for (const w of prev) {
      if (w.epoch !== epoch) {
        keep.push(w);
        continue;
      }
      if (w.mode === "async" || opts?.includePromoted) {
        taken.push(w);
      } else {
        keep.push(w);
      }
    }
    if (keep.length === 0) this.byPeer.delete(peer);
    else this.byPeer.set(peer, keep);
    return taken;
  }

  listForPeer(peerSessionId: string): readonly PeerCollabWaiter[] {
    return this.byPeer.get(peerSessionId.trim()) ?? [];
  }

  /**
   * True when `waiterSessionId` currently holds a sync-promoted arm on
   * `peerSessionId` (blocked in wait:true for that peer's next reply).
   */
  isSyncWaitingFor(
    waiterSessionId: string,
    peerSessionId: string,
  ): boolean {
    const waiter = waiterSessionId.trim();
    const peer = peerSessionId.trim();
    if (!waiter || !peer) return false;
    return (this.byPeer.get(peer) ?? []).some(
      (w) => w.waiterSessionId === waiter && w.mode === "sync-promoted",
    );
  }

  /**
   * Downgrade one waiter→peer arm from sync-promoted to async (keep seqAtSend).
   * No-op when missing or already async.
   */
  downgradeToAsync(
    peerSessionId: string,
    waiterSessionId: string,
  ): boolean {
    const peer = peerSessionId.trim();
    const waiter = waiterSessionId.trim();
    const prev = this.byPeer.get(peer);
    if (!prev?.length) return false;
    let changed = false;
    const next = prev.map((w) => {
      if (w.waiterSessionId !== waiter || w.mode !== "sync-promoted") return w;
      changed = true;
      return { ...w, mode: "async" as const };
    });
    if (!changed) return false;
    this.byPeer.set(peer, next);
    return true;
  }
}

/**
 * Mutual wait:true (A waits for B while B waits for A) deadlocks both drains —
 * neither can finish the tool call that must produce the other's reply.
 * Downgrade both arms to async and wake both so each turn can continue; the
 * reply arrives later as a `[会话协作]` handoff steer.
 *
 * @returns true when a mutual sync wait was broken.
 */
export function breakMutualPeerSyncWait(input: {
  readonly runtime: FaceRuntime;
  readonly peerSessionId: string;
  readonly waiterSessionId: string;
}): boolean {
  const peer = input.peerSessionId.trim();
  const waiter = input.waiterSessionId.trim();
  if (!peer || !waiter || peer === waiter) return false;
  const waiters = input.runtime.peerCollabWaiters;
  // Peer is sync-waiting for us → cycle.
  if (!waiters.isSyncWaitingFor(peer, waiter)) return false;
  waiters.downgradeToAsync(peer, waiter);
  waiters.downgradeToAsync(waiter, peer);
  input.runtime.drain.wake(peer);
  input.runtime.drain.wake(waiter);
  return true;
}

/** Tool / Status copy when mutual wait:true was downgraded to async. */
export function formatMutualPeerWaitAsyncNotice(
  peerSessionId: string,
): string {
  return (
    `delivered to ${peerSessionId} (async — peer is also wait:true on this session; ` +
    `blocking would deadlock both turns). Reply arrives as [会话协作] handoff. ` +
    `For simultaneous 会话协作 prefer wait=false.`
  );
}

/**
 * Arm after a successful peer prompt (wait:true → sync-promoted; wait:false → async).
 * Fast-path for wait:false: if an assistant reply already exists after seqAtSend
 * (peer finished before we armed), flush now. Do **not** flush merely because
 * the peer is not yet marked active — that races the drain start and empties
 * the arm before the turn begins.
 */
export function armPeerCollabAfterPrompt(input: {
  readonly runtime: FaceRuntime;
  readonly peerSessionId: string;
  readonly waiterSessionId: string;
  readonly seqAtSend: number;
  readonly wait: boolean;
}): void {
  input.runtime.peerCollabWaiters.arm({
    peerSessionId: input.peerSessionId,
    waiterSessionId: input.waiterSessionId,
    seqAtSend: input.seqAtSend,
    mode: input.wait ? "sync-promoted" : "async",
  });
  // Overview mutual 委派方: both sessions paint each other on the left stack.
  // Label `collab` (not auto-mesh `sibling`) so Status can include the edge.
  input.runtime.agentTeams.linkPeers(
    input.waiterSessionId,
    input.peerSessionId,
    "collab",
  );
  if (input.wait) return;
  const slice = readSessionEvents(
    input.runtime.store,
    input.peerSessionId,
  ).slice(Math.max(0, input.seqAtSend));
  if (!lastAssistantBodyText(slice).trim()) return;
  deliverPeerCollabIdleHandoffs(input.runtime, input.peerSessionId);
}

/**
 * After a sync wait fails (timeout / quiet peer), if the peer is already idle
 * flush sync-promoted arms so the waiter still gets a completion/empty notice.
 */
export function flushPeerCollabIfPeerIdle(
  runtime: FaceRuntime,
  peerSessionId: string,
): void {
  if (isChildSessionActive(runtime, peerSessionId)) return;
  deliverPeerCollabIdleHandoffs(runtime, peerSessionId, {
    includePromoted: true,
  });
}

/**
 * wait:true aborted or timed out while the peer may still be live.
 *
 * Sync-promoted arms are skipped by the normal idle deliver path (so a
 * successful tool reply is not doubled). After a failed sync wait we must
 * downgrade to async — otherwise the peer's later reply is never steered as
 * `[会话协作]` and the waiter looks stuck / "context reset" (RC.2 zip
 * `sess_mwlyd4o4_czvp5f`: thread_message → Error: tool call aborted).
 *
 * @returns true when a sync-promoted arm was downgraded to async.
 */
export function promoteFailedSyncPeerWait(input: {
  readonly runtime: FaceRuntime;
  readonly peerSessionId: string;
  readonly waiterSessionId: string;
}): boolean {
  const peer = input.peerSessionId.trim();
  const waiter = input.waiterSessionId.trim();
  if (!peer || !waiter || peer === waiter) return false;
  const changed = input.runtime.peerCollabWaiters.downgradeToAsync(peer, waiter);
  // Peer already quiet → flush now (includePromoted covers a race where the
  // arm was still sync when idle fired). Peer still running → async arm
  // delivers on the next drain-idle.
  flushPeerCollabIfPeerIdle(input.runtime, peer);
  return changed;
}

/** Drop the arm when wait:true already returned the reply in the tool result. */
export function clearPeerCollabAfterSyncReply(input: {
  readonly runtime: FaceRuntime;
  readonly peerSessionId: string;
  readonly waiterSessionId: string;
}): void {
  input.runtime.peerCollabWaiters.clearWaiter(
    input.peerSessionId,
    input.waiterSessionId,
  );
}

export function deliverPeerCollabIdleHandoffs(
  runtime: FaceRuntime,
  peerSessionId: string,
  opts?: { readonly includePromoted?: boolean },
): void {
  const waiters = runtime.peerCollabWaiters.takeIdleWaiters(
    peerSessionId,
    opts,
  );
  if (waiters.length === 0) return;
  const events = readSessionEvents(runtime.store, peerSessionId);
  for (const w of waiters) {
    const slice = events.slice(w.seqAtSend);
    const raw = lastAssistantBodyText(slice).trim();
    const answer = raw
      ? boundChildAnswer(w.waiterSessionId, peerSessionId, raw)
      : "";
    const outcome = formatDescribedChildOutcome(describeChildOutcome(slice));
    const text = formatPeerCollabCompletionNotice({
      peerSessionId,
      answer,
      ...(outcome ? { outcomeLine: outcome } : {}),
    });
    void runtime
      .resolveAgent(w.waiterSessionId)
      .then((agent) => {
        agent.admit(text, {
          delivery: "steer",
          source: peerCollabNoticeSource(runtime, peerSessionId),
        });
        runtime.drain.wake(w.waiterSessionId);
      })
      .catch(() => undefined);
  }
}

export function deliverPeerCollabStopHandoffs(
  runtime: FaceRuntime,
  peerSessionId: string,
  why: string,
): void {
  const waiters = runtime.peerCollabWaiters.takeStopWaiters(peerSessionId);
  if (waiters.length === 0) return;
  const events = readSessionEvents(runtime.store, peerSessionId);
  for (const w of waiters) {
    const slice = events.slice(w.seqAtSend);
    const raw = lastAssistantBodyText(slice).trim();
    const answer = raw
      ? boundChildAnswer(w.waiterSessionId, peerSessionId, raw)
      : "";
    const text = formatPeerCollabStopHandoffNotice({
      peerSessionId,
      why,
      answer,
    });
    void runtime
      .resolveAgent(w.waiterSessionId)
      .then((agent) => {
        agent.admit(text, {
          delivery: "steer",
          source: peerCollabNoticeSource(runtime, peerSessionId),
        });
        runtime.drain.wake(w.waiterSessionId);
      })
      .catch(() => undefined);
  }
}
