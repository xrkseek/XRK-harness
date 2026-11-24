/**
 * Wait for a peer session's next assistant reply after a steer/queue prompt.
 * Shared by thread_message and workspace_session_prompt.
 */

import {
  readSessionEvents,
  sessionHasPendingSteer,
} from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import {
  describeChildOutcome,
  formatDescribedChildOutcome,
  lastAssistantBodyText,
} from "./adapt/subagent-notice.js";
import { isChildSessionActive } from "./external-agent-runtime.js";
import {
  raceDrainRunSlice,
  waitForSignalOrSlice,
} from "./wait-drain-idle.js";
import {
  mergeWaitSignals,
  shouldSoftYieldWait,
} from "./wait-yield.js";

export const PEER_WAIT_DEFAULT_MS = 10 * 60 * 1000;
export const PEER_WAIT_MIN_MS = 1_000;
const PEER_POLL_MS = 300;

export function clampPeerWaitMs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(
      PEER_WAIT_DEFAULT_MS,
      Math.max(PEER_WAIT_MIN_MS, Math.floor(raw)),
    );
  }
  return PEER_WAIT_DEFAULT_MS;
}

export type PeerWaitResult =
  | { readonly reply: string }
  | { readonly error: string }
  /** Mutual wait:true cycle — caller must downgrade to async and continue. */
  | { readonly mutualWait: true }
  /**
   * Soft-detach (session.yieldWait / steer) — peer keeps running; reply
   * should fall back to async handoff.
   */
  | { readonly yielded: true };

export async function waitForPeerAssistantReply(
  runtime: FaceRuntime,
  targetId: string,
  seqAtSend: number,
  timeoutMs: number,
  signal?: AbortSignal,
  opts?: {
    /** Return `{ mutualWait: true }` when this becomes true (polled each slice). */
    readonly shouldBreak?: () => boolean;
    /**
     * Session that owns the wait tool (waiter). Attaches to WaitYieldHub so
     * UI 「停止等待」 / steer soft-detach this wait.
     */
    readonly yieldSessionId?: string;
  },
): Promise<PeerWaitResult> {
  const deadline = Date.now() + timeoutMs;
  const stillRunning = () => isChildSessionActive(runtime, targetId);
  const yieldSessionId = opts?.yieldSessionId?.trim() || "";
  const attachment = yieldSessionId
    ? runtime.waitYield.attach(yieldSessionId, {
        kind: "peer_wait",
        label: targetId,
      })
    : undefined;
  const pendingSteer = () =>
    Boolean(yieldSessionId && sessionHasPendingSteer(runtime.store, yieldSessionId));
  try {
    while (stillRunning() || Date.now() < deadline) {
      if (signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      if (attachment?.signal.aborted || pendingSteer()) {
        return { yielded: true };
      }
      if (opts?.shouldBreak?.()) return { mutualWait: true };
      if (!stillRunning()) {
        const events = readSessionEvents(runtime.store, targetId);
        if (events.length > seqAtSend) {
          const reply = lastAssistantBodyText(events.slice(seqAtSend)).trim();
          if (reply) return { reply };
          if (Date.now() > deadline) break;
        }
      }
      if (Date.now() > deadline) break;
      const remaining = Math.max(0, deadline - Date.now());
      const merged = mergeWaitSignals(signal, attachment?.signal);
      if (
        stillRunning() &&
        runtime.drain.run &&
        !runtime.externalAgents.has(targetId)
      ) {
        try {
          const run = runtime.drain.run.bind(runtime.drain);
          await raceDrainRunSlice({
            run: () => run(targetId),
            sliceMs: Math.min(PEER_POLL_MS * 20, remaining),
            ...(merged ? { signal: merged } : {}),
          });
        } catch (err) {
          if (
            shouldSoftYieldWait({
              yieldSignal: attachment?.signal,
              turnSignal: signal,
              err,
              pendingSteer: pendingSteer(),
            })
          ) {
            return { yielded: true };
          }
          if (err instanceof Error && err.name === "AbortError") throw err;
          /* keep polling */
        }
      } else {
        try {
          await waitForSignalOrSlice({
            sliceMs: Math.min(PEER_POLL_MS, remaining),
            ...(merged ? { signal: merged } : {}),
          });
        } catch (err) {
          if (
            shouldSoftYieldWait({
              yieldSignal: attachment?.signal,
              turnSignal: signal,
              err,
              pendingSteer: pendingSteer(),
            })
          ) {
            return { yielded: true };
          }
          throw err;
        }
      }
    }
    const events = readSessionEvents(runtime.store, targetId);
    const slice = events.slice(seqAtSend);
    const reply = lastAssistantBodyText(slice).trim();
    if (reply) return { reply };
    const detail = formatDescribedChildOutcome(describeChildOutcome(slice));
    return {
      error: stillRunning()
        ? `${targetId} still running after ${timeoutMs}ms (${detail})`
        : `${targetId} stopped without an assistant reply (${detail})`,
    };
  } finally {
    attachment?.dispose();
  }
}
