/**
 * Wait for a peer session's next assistant reply after a steer/queue prompt.
 * Shared by thread_message and workspace_session_prompt.
 */

import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import { isChildSessionActive } from "./external-agent-runtime.js";
import { raceDrainRunSlice } from "./wait-drain-idle.js";

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

export async function waitForPeerAssistantReply(
  runtime: FaceRuntime,
  targetId: string,
  seqAtSend: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ readonly reply: string } | { readonly error: string }> {
  const deadline = Date.now() + timeoutMs;
  const stillRunning = () => isChildSessionActive(runtime, targetId);
  while (stillRunning() || Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
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
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        /* keep polling */
      }
    } else {
      await new Promise((r) =>
        setTimeout(r, Math.min(PEER_POLL_MS, remaining)),
      );
    }
  }
  const events = readSessionEvents(runtime.store, targetId);
  const reply = lastAssistantBodyText(events.slice(seqAtSend)).trim();
  if (reply) return { reply };
  return {
    error: stillRunning()
      ? `${targetId} still running after ${timeoutMs}ms`
      : `${targetId} idle with no assistant reply`,
  };
}
