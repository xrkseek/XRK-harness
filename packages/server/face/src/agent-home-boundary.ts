/**
 * Hard lane between project workspaces and 干员 agent-home workspaces.
 * Coding / IM project seats stay isolated from agent-home.
 * Exception: 向阳空间 (`ws_default`) ↔ agent-home may message and discover
 * each other both ways (speech / peer prompt), not other project canvases.
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

/** True when this session sits on the product 向阳空间 canvas. */
export function isXiangyangSession(
  runtime: FaceRuntime,
  sessionId: string,
): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  return runtime.workspaces.workspaceIdOf(id) === XIANGYANG_WORKSPACE_ID;
}

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
 * 向阳 ↔ 干员家 bridge: either side of the pair is on 向阳, the other on
 * agent-home. Other project canvases stay refused.
 */
function isXiangyangAgentHomeBridge(
  runtime: FaceRuntime,
  fromSessionId: string,
  toSessionId: string,
  fromLane: SessionCollabLane,
  toLane: SessionCollabLane,
): boolean {
  if (fromLane === toLane) return false;
  const fromXy = isXiangyangSession(runtime, fromSessionId);
  const toXy = isXiangyangSession(runtime, toSessionId);
  return (
    (fromLane === "agent-home" && toXy)
    || (toLane === "agent-home" && fromXy)
  );
}

/**
 * Refuse cross-lane messaging / dispatch: project ↔ agent-home,
 * except 向阳空间 ↔ agent-home (both directions).
 * Same-lane pairs stay allowed.
 */
export function refuseCrossAgentHomeLane(
  runtime: FaceRuntime,
  fromSessionId: string,
  toSessionId: string,
): string | undefined {
  const fromLane = sessionCollabLane(runtime, fromSessionId);
  const toLane = sessionCollabLane(runtime, toSessionId);
  if (fromLane === toLane) return undefined;
  if (
    isXiangyangAgentHomeBridge(
      runtime,
      fromSessionId,
      toSessionId,
      fromLane,
      toLane,
    )
  ) {
    return undefined;
  }
  return fromLane === "agent-home"
    ? "agent-home cannot message this project seat (only 向阳↔agent-home)"
    : "project seat cannot message agent-home (only 向阳↔agent-home)";
}

/**
 * Refuse listing / targeting a workspace that sits on the other lane from the
 * calling session — except 向阳 ↔ agent-home.
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
  const fromXy = isXiangyangSession(runtime, fromSessionId);
  const targetXy = targetWorkspaceId === XIANGYANG_WORKSPACE_ID;
  if ((fromLane === "agent-home" && targetXy) || (fromXy && targetIsHome)) {
    return undefined;
  }
  return fromLane === "agent-home"
    ? "agent-home cannot target this project workspace (only 向阳↔agent-home)"
    : "project seat cannot target agent-home (only 向阳↔agent-home)";
}
