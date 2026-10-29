/**
 * Face bookkeeping after an in-place log cut (`replacePrefix` / truncate).
 * Shared by `session.truncate` and optional checkpoint `truncateChat`.
 */
import {
  readSessionEvents,
  sessionEventCount,
} from "@xrkseek/core-session";
import { forgetRequestHeaderCache } from "@xrkseek/core-agent-loop";
import type { FaceRuntime } from "./context.js";

export function resetFaceStateAfterLogCut(
  runtime: FaceRuntime,
  sessionId: string,
): number {
  const n = sessionEventCount(runtime.store, sessionId);
  runtime.seq.ensureAtLeast(sessionId, n);
  runtime.wireIds.clear(sessionId);
  runtime.wireIds.primeFromLog(
    sessionId,
    readSessionEvents(runtime.store, sessionId),
  );
  runtime.inboxWire.clear(sessionId);
  runtime.toolDisclosure.forget(sessionId);
  runtime.pathAllowlist.forget(sessionId);
  runtime.pathAllowlist.hydrate(runtime.store, sessionId);
  runtime.listProjectionCache.forget(sessionId);
  runtime.projections.evictSession(sessionId);
  void runtime.projections.snapshot(sessionId);
  forgetRequestHeaderCache(sessionId);
  return n;
}
