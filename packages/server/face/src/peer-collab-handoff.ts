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
import type { UserMessageSource } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { boundChildAnswer } from "./adapt/subagent-answer-bound.js";
import {
  describeChildOutcome,
  formatDescribedChildOutcome,
  lastAssistantBodyText,
} from "./adapt/subagent-notice.js";
import { isChildSessionActive } from "./external-agent-runtime.js";

export type PeerCollabWaitMode = "async" | "sync-promoted";

export type PeerCollabWaiter = {
  readonly waiterSessionId: string;
  /** Event length of the peer log when the prompt was sent. */
  readonly seqAtSend: number;
  readonly mode: PeerCollabWaitMode;
  /** Idle epoch of the peer when armed (stale delivers drop). */
  readonly epoch: number;
};

export function peerCollabNoticeSource(peerSessionId: string): UserMessageSource {
  return {
    kind: "plugin",
    plugin: "peer-collab",
    form: "notice",
    peerSessionId,
  };
}

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
          source: peerCollabNoticeSource(peerSessionId),
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
          source: peerCollabNoticeSource(peerSessionId),
        });
        runtime.drain.wake(w.waiterSessionId);
      })
      .catch(() => undefined);
  }
}
