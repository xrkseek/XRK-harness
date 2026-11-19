/**
 * Face bookkeeping after an in-place log cut (`replacePrefix` / truncate).
 * Shared by `session.truncate` and optional checkpoint `truncateChat`.
 */
import {
  readSessionEvents,
  sessionEventCount,
} from "@xrkseek/core-session";
import { forgetSessionProcessCaches } from "@xrkseek/core-agent-loop";
import type { FaceRuntime } from "./context.js";
import { clearStatusSnapshotCache } from "./status-snapshot-cache.js";

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
  // Soft-poll Overview must not keep a pre-cut delivery.queued note.
  clearStatusSnapshotCache(sessionId);
  // Mirror pathAllowlist: drop then re-seed from the *remaining* log so
  // edit-resubmit / truncate does not leave expand empty until the next
  // tool_search (hydrate only runs on first ToolRegistry bind).
  runtime.toolDisclosure.forget(sessionId);
  runtime.toolDisclosure.hydrate(runtime.store, sessionId);
  runtime.pathAllowlist.forget(sessionId);
  runtime.pathAllowlist.hydrate(runtime.store, sessionId);
  runtime.listProjectionCache.forget(sessionId);
  runtime.projections.evictSession(sessionId);
  void runtime.projections.snapshot(sessionId);
  // Truncate breaks the provider prefix — drop series baseline + header cache.
  forgetSessionProcessCaches(sessionId);
  return n;
}
