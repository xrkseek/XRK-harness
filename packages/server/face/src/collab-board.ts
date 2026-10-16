/**
 * Turn-start collab board: live Agent Team catalog + parent 主线 sessions.
 * 主线 rows are a discovery aid — messaging does not require a pin.
 * Seed AGENTS.md / skills stay on standing inject — this fragment is ids only.
 */
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { formatRosterCatalog } from "./agent-roster-store.js";
import { listWorkspaceThreadCatalog } from "./session-thread-tools.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveAgentPresetProfile } from "./presets-catalog.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";

/** Parent 主线 rows whose thread was updated in the last day. */
export const COLLAB_BOARD_THREAD_WINDOW_MS = 24 * 60 * 60 * 1000;

const BOARD_MAX_CHARS = 3_500;
const BRIEF_MAX = 120;

export interface CollabBoardThreadRow {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly updatedAt: number;
  readonly sessions: ReadonlyArray<{
    readonly sessionId: string;
    readonly self?: boolean;
    readonly sideline?: string;
  }>;
}

/** Unpinned parent peer shown when the 主线 window is empty. */
export interface CollabBoardPeerRow {
  readonly sessionId: string;
  readonly title?: string;
  readonly sideline?: string;
  readonly self?: boolean;
  readonly running?: boolean;
}

/** How the parent session should read the team + 主线 board. */
export type CollabBoardSurface = "coding" | "im" | "qichuang";

/** Cap unbound peer rows so the board stays scannable. */
const UNBOUND_PEER_MAX = 8;

export function formatCollabBoardText(input: {
  readonly membersCatalog: string;
  readonly threads: readonly CollabBoardThreadRow[];
  readonly now?: number;
  /** False for Frugal / badges with `subagents.mode === "off"`. */
  readonly canSpawn?: boolean;
  /** Defaults to coding (full board + thread mail). */
  readonly surface?: CollabBoardSurface;
  /** Parent peers with no 主线 pin — listed when the pin window is empty. */
  readonly unboundPeers?: readonly CollabBoardPeerRow[];
}): string {
  const now = input.now ?? Date.now();
  const cutoff = now - COLLAB_BOARD_THREAD_WINDOW_MS;
  const recent = input.threads.filter((row) => row.updatedAt >= cutoff);
  const canSpawn = input.canSpawn !== false;
  const surface = input.surface ?? "coding";
  const teamLead =
    surface === "im"
      ? "Agent Team — from IM, spawn `subagent` with member_id into a coding workspace (workspace_id from workspace_list). Standing skills apply on that child. Peers: workspace_session_prompt → keep session_id → thread_message."
      : surface === "qichuang"
        ? "Agent Team — Qichuang has no nested subagents; match members for playbooks, then workspace_session_prompt (keep session_id) + thread_message. Optional thread_upsert pins the peer for discovery."
        : canSpawn
          ? "Agent Team — spawn `subagent` with member_id when a listed name or brief fits (see session_capability for permission × tool_surface). Standing skills are for that member after spawn. Playbooks stay on the member."
          : "Agent Team catalog (this badge has no subagent tools — Skill-load matching work here; see session_capability). Members:";
  const lines = [teamLead, input.membersCatalog];
  lines.push(
    "",
    "主线 (last 24h) — discovery pin so you can lock collaborators quickly. " +
      "`thread_message` any parent session_id (pin optional; reply returns here). " +
      "Do not thread_switch just to talk. Unpinned ids below / session_search. Not a subagent.",
  );
  if (recent.length === 0) {
    lines.push("(none)");
    const peers = input.unboundPeers ?? [];
    if (peers.length > 0) {
      lines.push(
        "Unpinned parents here — `thread_message` by session_id (pin optional). " +
          "`*` is you. Sideline = what they are doing now:",
      );
      for (const peer of peers) {
        const mark = peer.self ? "*" : "";
        const title = peer.title ? ` 「${clipBrief(peer.title)}」` : "";
        const tip = peer.sideline ? ` · ${clipBrief(peer.sideline)}` : "";
        const run = peer.running ? " · running" : "";
        lines.push(`- ${peer.sessionId}${mark}${title}${tip}${run}`);
      }
    }
  } else {
    for (const thread of recent) {
      const sessions = thread.sessions
        .map((s) => {
          const mark = s.self ? "*" : "";
          const tip = s.sideline ? ` · ${clipBrief(s.sideline)}` : "";
          return `${s.sessionId}${mark}${tip}`;
        })
        .join("; ");
      const brief = thread.brief ? ` — ${clipBrief(thread.brief)}` : "";
      lines.push(
        `- ${thread.id} 「${thread.title}」${brief}${sessions ? ` · ${sessions}` : ""}`,
      );
    }
  }
  return lines.join("\n").slice(0, BOARD_MAX_CHARS);
}

function clipBrief(value: string): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= BRIEF_MAX ? one : `${one.slice(0, BRIEF_MAX - 1)}…`;
}

/**
 * Parent sessions in this workspace with no 主线 bind — so agents can still
 * collaborate when the pin catalog is empty.
 */
export function listUnboundParentPeers(
  runtime: FaceRuntime,
  workspaceId: string,
  selfId: string,
): CollabBoardPeerRow[] {
  const bound = new Set(
    runtime.sessionThreads
      .listBinds(workspaceId)
      .map((row) => row.sessionId),
  );
  const archived = new Set(
    runtime.workspaces.list(runtime.store.list()).archivedSessionIds,
  );
  const scored: Array<CollabBoardPeerRow & { readonly sortAt: number }> = [];
  for (const id of runtime.store.list()) {
    if (runtime.workspaces.workspaceIdOf(id) !== workspaceId) continue;
    if (bound.has(id)) continue;
    if (runtime.subagents.getByChild(id)) continue;
    if (archived.has(id)) continue;
    const meta = runtime.projections.stateOf(id, "sessionListMetadata") as
      | { readonly blank?: boolean; readonly lastPromptAt?: number | null }
      | undefined;
    if (meta?.blank === true) continue;
    const titleRaw = runtime.projections.stateOf(id, "title") as
      | string
      | null
      | undefined;
    const title =
      typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : undefined;
    const bind = runtime.sessionThreads.bindOf(workspaceId, id);
    const tip = bind?.sideline ?? runtime.presence.get(id)?.tips;
    const sideline = tip ? tip : undefined;
    const hints = runtime.store.listHints?.(id);
    const sortAt = Math.max(hints?.lastEventTs ?? 0, meta?.lastPromptAt ?? 0);
    scored.push({
      sessionId: id,
      ...(title ? { title } : {}),
      ...(sideline ? { sideline } : {}),
      ...(id === selfId ? { self: true } : {}),
      ...(runtime.drain.isActive(id) ? { running: true } : {}),
      sortAt,
    });
  }
  scored.sort((a, b) => b.sortAt - a.sortAt || a.sessionId.localeCompare(b.sessionId));
  return scored.slice(0, UNBOUND_PEER_MAX).map(({ sortAt: _sortAt, ...row }) => row);
}

/** Live board for a parent session. Empty string for delegated children. */
export function formatCollabBoard(
  runtime: FaceRuntime,
  sessionId: string,
  now = Date.now(),
): string {
  if (runtime.subagents.getByChild(sessionId)) return "";
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const canSpawn = resolveAgentPresetProfile(badge).subagents.mode === "on";
  const surface: CollabBoardSurface =
    badge === "im" || workspaceId === IM_WORKSPACE_ID
      ? "im"
      : badge === "qichuang" || workspaceId === XIANGYANG_WORKSPACE_ID
        ? "qichuang"
        : "coding";
  const threads = listWorkspaceThreadCatalog(runtime, workspaceId, sessionId);
  const recent = threads.filter(
    (row) => row.updatedAt >= now - COLLAB_BOARD_THREAD_WINDOW_MS,
  );
  return formatCollabBoardText({
    membersCatalog: formatRosterCatalog(
      runtime.agentRoster.listVisible(workspaceId),
    ),
    threads,
    ...(recent.length === 0
      ? { unboundPeers: listUnboundParentPeers(runtime, workspaceId, sessionId) }
      : {}),
    canSpawn,
    surface,
    now,
  });
}

export function createCollabBoardFragmentProvider(runtime: FaceRuntime): {
  readonly id: "collab-board";
  readonly phases: readonly ["turn-start"];
  produce(ctx: { readonly sessionId: string }): readonly {
    readonly id: string;
    readonly kind: "additional_context";
    readonly text: string;
    readonly phase: "turn-start";
    readonly priority: number;
  }[];
} {
  return {
    id: "collab-board",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const value = formatCollabBoard(runtime, sessionId);
      if (!value) return [];
      return [
        {
          id: "additional_context.collab_board",
          kind: "additional_context",
          text: `<external_collab_board>${value}</external_collab_board>`,
          phase: "turn-start",
          priority: 8,
        },
      ];
    },
  };
}
