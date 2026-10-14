import type { FaceRuntime } from "../context.js";
import type { HostFrame } from "../types.js";
import { resolveSessionCwd } from "../session-cwd.js";
import { sessionListHints } from "@xrkseek/core-session";
import { effectiveSessionAgentPreset } from "../session-agent-preset.js";

/**
 * DSH `sessionListFields` + `sessionBlank` for `host/session-added`.
 * Subagent rows need parent + origin or the captured shell will not nest them.
 */
export function sessionAddedFrame(
  runtime: FaceRuntime,
  sessionId: string,
): Extract<HostFrame, { type: "host/session-added" }> {
  const hints = sessionListHints(runtime.store, sessionId);
  const blank = !hints.hasTurnStart && !hints.hasCommandRun;
  const cwd = resolveSessionCwd(runtime, sessionId);
  const agentPreset = effectiveSessionAgentPreset(runtime, sessionId);
  const lineage = runtime.subagents.getByChild(sessionId);
  const forkParent = runtime.forkLineage.getByChild(sessionId);
  const parentOrigin =
    lineage && lineage.mode !== "fork"
      ? {
          parentSessionId: lineage.parentSessionId,
          origin: "subagent" as const,
        }
      : forkParent || (lineage && lineage.mode === "fork")
        ? {
            parentSessionId:
              forkParent?.parentSessionId ?? lineage!.parentSessionId,
            origin: "fork" as const,
          }
        : undefined;
  return {
    type: "host/session-added",
    sessionId,
    blank,
    cwd,
    agentPreset,
    ...(parentOrigin ?? {}),
  };
}

export function publishSessionAdded(
  runtime: FaceRuntime,
  sessionId: string,
): void {
  runtime.bus.publishHost(sessionAddedFrame(runtime, sessionId));
}
