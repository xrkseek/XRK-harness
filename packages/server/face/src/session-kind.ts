/**
 * Derived engineering identity for one session. Not a badge.
 * Contract: docs/session-identity.md.
 */
import type { FaceRuntime } from "./context.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";

export type SessionKind =
  | "orchestrator"
  | "coding_parent"
  | "delegated_child"
  | "fork_clone";

export type OrchestratorSurface = "im" | "qichuang";

/** Tool-delegated child, UI fork, IM/奇创 orchestrator, else coding parent. */
export function deriveSessionKind(
  runtime: FaceRuntime,
  sessionId: string,
): SessionKind {
  const link = runtime.subagents.getByChild(sessionId);
  if (link && link.mode !== "fork") return "delegated_child";
  if (runtime.forkLineage.getByChild(sessionId)) return "fork_clone";
  if (orchestratorSurface(runtime, sessionId)) return "orchestrator";
  return "coding_parent";
}

/** IM vs 奇创 when this session is an orchestrator; otherwise undefined. */
export function orchestratorSurface(
  runtime: FaceRuntime,
  sessionId: string,
): OrchestratorSurface | undefined {
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const ws = runtime.workspaces.workspaceIdOf(sessionId);
  if (badge === "im" || ws === IM_WORKSPACE_ID) return "im";
  if (badge === "qichuang" || ws === XIANGYANG_WORKSPACE_ID) return "qichuang";
  return undefined;
}
