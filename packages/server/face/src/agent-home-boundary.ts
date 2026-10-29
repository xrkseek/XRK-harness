/**
 * Hard lane between project workspaces and 干员 agent-home workspaces.
 * Project / 向阳 / IM sessions must not collaborate or dispatch into agent-home
 * sessions; agent-home sessions may still collaborate with each other.
 * 中文。 / English.
 */

import type { FaceRuntime } from "./context.js";

/** Collab / dispatch lane for a session. */
export type SessionCollabLane = "project" | "agent-home";

/** True when the Face workspace row is a 干员 home. */
export function isAgentHomeWorkspace(
  runtime: FaceRuntime,
  workspaceId: string,
): boolean {
  const id = workspaceId.trim();
  if (!id) return false;
  return runtime.workspaces.get(id)?.kind === "agent-home";
}

/**
 * Resolve the collab lane for a session.
 * Identity bind, agent-home workspace row, or delegated ancestry (walk parent)
 * all count as agent-home — children inherit the parent's lane even if identity
 * is only on the parent.
 */
export function sessionCollabLane(
  runtime: FaceRuntime,
  sessionId: string,
): SessionCollabLane {
  const id = sessionId.trim();
  if (!id) return "project";
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (runtime.sessionIdentities.get(cur)) return "agent-home";
    const ws = runtime.workspaces.workspaceIdOf(cur);
    if (ws && isAgentHomeWorkspace(runtime, ws)) return "agent-home";
    const link = runtime.subagents.getByChild(cur);
    if (!link || link.mode === "fork") break;
    cur = link.parentSessionId;
  }
  return "project";
}

/** True when the session is on the agent-home collab lane. */
export function isAgentHomeSession(
  runtime: FaceRuntime,
  sessionId: string,
): boolean {
  return sessionCollabLane(runtime, sessionId) === "agent-home";
}

/**
 * Refuse cross-lane messaging / dispatch: project ↔ agent-home.
 * Same-lane pairs (project↔project, agent-home↔agent-home) stay allowed.
 */
export function refuseCrossAgentHomeLane(
  runtime: FaceRuntime,
  fromSessionId: string,
  toSessionId: string,
): string | undefined {
  const fromLane = sessionCollabLane(runtime, fromSessionId);
  const toLane = sessionCollabLane(runtime, toSessionId);
  if (fromLane === toLane) return undefined;
  return fromLane === "agent-home"
    ? "agent-home sessions cannot message project workspace sessions"
    : "project workspace sessions cannot message agent-home sessions";
}

/**
 * Refuse listing / targeting a workspace that sits on the other lane from the
 * calling session (discovery that would invite illegal thread_message).
 */
export function refuseCrossAgentHomeWorkspace(
  runtime: FaceRuntime,
  fromSessionId: string,
  targetWorkspaceId: string,
): string | undefined {
  const fromLane = sessionCollabLane(runtime, fromSessionId);
  const targetIsHome = isAgentHomeWorkspace(runtime, targetWorkspaceId);
  const targetLane: SessionCollabLane = targetIsHome ? "agent-home" : "project";
  if (fromLane === targetLane) return undefined;
  return fromLane === "agent-home"
    ? "agent-home sessions cannot target project workspaces"
    : "project workspace sessions cannot target agent-home workspaces";
}
