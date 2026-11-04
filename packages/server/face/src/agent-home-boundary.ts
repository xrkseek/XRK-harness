/**
 * Hard lane between project workspaces and 干员 agent-home workspaces.
 * Project / 向阳 / IM sessions must not collaborate or dispatch into agent-home
 * sessions; agent-home sessions may still collaborate with each other.
 * 中文。 / English.
 */

import type { FaceRuntime } from "./context.js";
import {
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
} from "./agent-roster-store.js";
import {
  IM_WORKSPACE_ID,
} from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";

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
 * Which roster member is wearing this seat — the subject of the `agent`
 * memory zone. One resolver for every caller, because the same 干员 appears in
 * three shapes and must resolve to one identity:
 *
 * - dispatched child → the link's `memberId`
 * - 干员 office (agent-home identity session) → the identity binding
 * - project 经理 seat → {@link MANAGER_MEMBER_ID} (the office lead who runs
 *   this workspace; 向日葵 is a different person and never inherits it)
 *
 * Undefined for seats that are nobody in particular (tool children spawned
 * without a member, forks, plain project sessions).
 */
export function sessionSeatMemberId(
  runtime: FaceRuntime,
  sessionId: string,
): string | undefined {
  const link = runtime.subagents.getByChild(sessionId);
  if (link && link.mode !== "fork") {
    const linked = typeof link.memberId === "string" ? link.memberId.trim() : "";
    if (linked) return linked;
  }
  const identity = runtime.sessionIdentities.get(sessionId)?.memberId?.trim();
  if (identity) return identity;
  // Office lead: a top-level project-parent seat (not a delegated child, not
  // 向阳 — that workspace is 向日葵's, and the manager must not absorb it).
  if (link && link.mode !== "fork") return undefined;
  const workspaceId = runtime.workspaces.workspaceIdOf(sessionId);
  if (!workspaceId) return undefined;
  if (workspaceId === XIANGYANG_WORKSPACE_ID) return SUNFLOWER_MEMBER_ID;
  // IM is a channel surface, not an office: nobody's agent zone.
  if (workspaceId === IM_WORKSPACE_ID) return undefined;
  return MANAGER_MEMBER_ID;
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
