/**
 * Dynamic catalog copy for collab tools — keyed by {@link SessionKind}.
 * Static ToolDefinition.description stays short; materializeTools merges these.
 */
import type { FaceRuntime } from "./context.js";
import { formatRosterCatalog } from "./agent-roster-store.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import {
  deriveSessionKind,
  orchestratorSurface,
  type OrchestratorSurface,
  type SessionKind,
} from "./session-kind.js";

export function threadMessageDescription(input: {
  readonly kind: SessionKind;
  readonly messageOnly?: boolean;
  /** Live sibling ids for delegated children (optional). */
  readonly siblingIds?: readonly string[];
}): string {
  if (input.messageOnly || input.kind === "delegated_child") {
    const ids =
      input.siblingIds && input.siblingIds.length > 0
        ? ` Live siblings: ${input.siblingIds.join(", ")}.`
        : " Ids: turn-start squad board or session_inspect.";
    return (
      "Message a sibling (same parent) or team peer-edge by session_id." +
      ids +
      " wait=true (default) returns their next assistant message. " +
      "Parent→child uses send_message / followup_task."
    );
  }
  return (
    "Message another parent session by session_id (any workspace). " +
    "主线 pin is optional — do not thread_switch first. " +
    "Peer keeps its own chat. Delivery is steer. wait=true (default) returns the next assistant message."
  );
}

/** One-line pack share flow for tool descriptions (avoid duplicating prose). */
export function packShareFlowHint(): string {
  return (
    "Share: team_import card=JSON (thin, ready) or pack=path|attachment:sha256:… " +
    "(advanced zip/dir; ready=false). " +
    "scope=global|workspace — global visible in every workspace; workspace = this canvas only " +
    "(defaults: card→workspace, pack→global). " +
    "Not-ready → team_list envPrep → prep → team_ready → subagent member_id. " +
    "Missing id here? It may be workspace-scoped elsewhere — re-import scope=global or open that workspace. " +
    "Never team_save an advanced id; never auto-run pack scripts; pack skills are child-only."
  );
}

/** Short visibility note for import tool results. */
export function rosterScopeVisibility(
  scope: "global" | "workspace",
  rosterWorkspaceId: string,
): string {
  return scope === "global"
    ? "global — visible in every workspace team_list"
    : `workspace — only canvas ${rosterWorkspaceId}; other workspaces will not see this id`;
}

export function teamListDescription(input: {
  readonly listOnly: boolean;
  readonly catalog: string;
}): string {
  const head = input.listOnly
    ? "Read-only roster (no team_save/import/ready). Siblings: squad board + thread_message."
    : `Member = name + duty + playbook (not SKILL.md). Mint thin: team_save. Spawn: subagent member_id. ${packShareFlowHint()}`;
  return `${head}\n${input.catalog}`;
}

export function workspaceListDescription(
  surface: OrchestratorSurface | undefined,
): string {
  const hint =
    surface === "im"
      ? "Coding child: subagent(workspace_id) or workspace_session_prompt → thread_message."
      : surface === "qichuang"
        ? "No nested subagent — workspace_session_prompt → keep session_id → thread_message."
        : "Peer: workspace_session_prompt → thread_message (主线 optional).";
  return `List Face workspaces (id, title, path, session count). ${hint}`;
}

export function workspaceSessionPromptDescription(input: {
  readonly surface: OrchestratorSurface | undefined;
  /** Fallback label when not orchestrator (coding). */
  readonly codingLabel?: string;
}): string {
  const from =
    input.surface === "im"
      ? "IM peer (not your child). Coding child = subagent(workspace_id)."
      : input.surface === "qichuang"
        ? "Qichuang peer only — no nested subagent. Implement there."
        : `${input.codingLabel ?? "coding"} peer. Nested work here → subagent.`;
  return `${from} Keep sessionId → thread_message. wait=true returns the peer reply.`;
}

export function subagentDescription(input: {
  readonly base: string;
  readonly surface: OrchestratorSurface | undefined;
  readonly catalog: string;
}): string {
  const cross =
    input.surface === "im"
      ? "Cross-workspace: workspace_list then workspace_id (or cwd). inherit_context must be false."
      : "Stay in this workspace — workspace_id / cwd are IM-only.";
  return `${input.base} ${cross}\nPrefer member_id:\n${input.catalog}`;
}

export function listAgentsDescription(kind: SessionKind): string {
  const scope =
    kind === "delegated_child"
      ? "Only children you spawned (teammates → squad board)."
      : "Your direct children (peers → thread_message).";
  return `${scope} Rows: id, label, mode, running, model, inbox, outcome. Caps: child_gap on capability.`;
}

export function sendMessageDescription(): string {
  return (
    "Parent→child (agent_id). Siblings/peers → thread_message. " +
    "steer = next tool-step; queue = wait idle. New task → followup_task. " +
    "Confirms delivery; answer arrives as steer notice."
  );
}

export function followupTaskDescription(): string {
  return (
    "New task for a continuable child (agent_id); wakes a steer turn. " +
    "Stay inside child_gap caps. Confirms delivery only — Host steers the result."
  );
}

export function teamGraphDescription(): string {
  return (
    "Collaboration graph for this session: delegates (from spawn) + peer. " +
    "Same-parent siblings are auto peer-linked (label=sibling) on attach — announce works without manual link. " +
    "action=view (default) · neighbors · link/unlink · role · remove · announce (fans send_message to peer neighbors)."
  );
}

export function interruptAgentDescription(): string {
  return (
    "Stop a running child (agent_id). Parent gets a progress notice; later idle completion is suppressed. " +
    "takeover=true pauses the task board for human ownership. " +
    "To stop and read the last answer in one call, prefer close_agent."
  );
}

export function closeAgentDescription(): string {
  return (
    "Stop a child and return a snapshot (running/idle + last assistant text). " +
    "Same interrupt path as interrupt_agent; use when you need the salvaged answer now. " +
    "takeover=true pauses the task board. Codex morph: close_agent."
  );
}

export function waitAgentDescription(): string {
  return (
    "Block until listed children are idle, then return their last assistant text. " +
    "Use when this turn's next step needs that answer. " +
    "After a background handoff with nothing else to do here, end the turn — Host steers completion."
  );
}

export function sessionInspectDescription(kind: SessionKind): string {
  const who =
    kind === "delegated_child"
      ? "Use ids from the turn-start squad board. Same-cwd transcript is session_read."
      : "Any known id (collab board, workspace_session_prompt, spawn). Same-cwd transcript is session_read.";
  return (
    "Metadata only: badge, permission, model, cwd, memberId, parent/child, presence, delivery, fleet, teamTasks. " +
    who
  );
}

/** Sibling session ids under the same parent (excludes self). */
export function listSiblingSessionIds(
  runtime: FaceRuntime,
  sessionId: string,
): readonly string[] {
  const self = runtime.subagents.getByChild(sessionId);
  if (!self || self.mode === "fork") return [];
  return runtime.subagents
    .listDelegated(self.parentSessionId)
    .map((link) => link.childSessionId)
    .filter((id) => id !== sessionId);
}

/** Live catalog string for the session's canvas workspace. */
export function liveRosterCatalog(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const ws = canvasWorkspaceIdForSession(runtime, sessionId);
  return formatRosterCatalog(runtime.agentRoster.listVisible(ws));
}

/** Convenience: kind + surface for one session. */
export function sessionToolContext(
  runtime: FaceRuntime,
  sessionId: string,
): {
  readonly kind: SessionKind;
  readonly surface: OrchestratorSurface | undefined;
} {
  return {
    kind: deriveSessionKind(runtime, sessionId),
    surface: orchestratorSurface(runtime, sessionId),
  };
}
