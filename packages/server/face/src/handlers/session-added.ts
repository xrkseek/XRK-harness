import type { FaceRuntime } from "../context.js";
import type { HostFrame } from "../types.js";
import { resolveSessionCwd } from "../session-cwd.js";

/**
 * DSH `sessionListFields` + `sessionBlank` for `host/session-added`.
 * Subagent rows need parent + origin or the captured shell will not nest them.
 */
export function sessionAddedFrame(
  runtime: FaceRuntime,
  sessionId: string,
): Extract<HostFrame, { type: "host/session-added" }> {
  const events = runtime.store.get(sessionId).events;
  const blank = !events.some((e) => e.type === "turn/start");
  const cwd = resolveSessionCwd(runtime, sessionId);
  const agentPreset = runtime.sessionAgentPresets.get(sessionId);
  const lineage = runtime.subagents.getByChild(sessionId);
  return {
    type: "host/session-added",
    sessionId,
    blank,
    cwd,
    ...(agentPreset ? { agentPreset } : {}),
    ...(lineage
      ? {
          parentSessionId: lineage.parentSessionId,
          origin: "subagent" as const,
        }
      : {}),
  };
}

export function publishSessionAdded(
  runtime: FaceRuntime,
  sessionId: string,
): void {
  runtime.bus.publishHost(sessionAddedFrame(runtime, sessionId));
}
