/**
 * Turn-start collab board: parent roster + 主线, or delegated-child squad.
 * 主线 rows are a discovery aid — messaging does not require a pin.
 * Seed AGENTS.md / skills stay on standing inject — this fragment is ids only.
 * Identity matrix: docs/session-identity.md.
 */
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { formatRosterCatalog } from "./agent-roster-store.js";
import { listWorkspaceThreadCatalog } from "./session-thread-tools.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveAgentPresetProfile } from "./presets-catalog.js";
import { isAgentHomeSession } from "./agent-home-boundary.js";
import { IM_WORKSPACE_ID } from "./im-workspace.js";
import { XIANGYANG_WORKSPACE_ID } from "./xiangyang-workspace.js";
import { readWorkspaceDiscoverySettings } from "./workspace-discovery.js";
import type { FaceSubagentLink } from "./subagent-registry.js";
import { sunflowerFormalName } from "./catalog-seed-labels.js";
import {
  DEFAULT_SEAT_TITLE_SCHEME,
  readSeatTitles,
  readUiLocalePreference,
  seatTitlesForScheme,
  type SeatTitleLocale,
  type SeatTitles,
} from "./seat-titles.js";

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
  /** Formal seat / member name. */
  readonly identity?: string;
  readonly nickname?: string;
  /** Roster role or seat duty one-liner. */
  readonly duty?: string;
  /** Open todo count from standing plan projection. */
  readonly todoOpen?: number;
  readonly sideline?: string;
  /** Bound 主线 title when pinned (parents only). */
  readonly mainline?: string;
  readonly self?: boolean;
  readonly running?: boolean;
}

/** How the parent session should read the team + 主线 board. */
export type CollabBoardSurface = "coding" | "im" | "qichuang" | "agent-home";

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
  /**
   * @deprecated Ignored — idle boards no longer dump unbound peers
   * (session_search). Kept optional so old call sites type-check.
   */
  readonly unboundPeers?: readonly CollabBoardPeerRow[];
  /** Live Settings titles — defaults office×zh when omitted (tests). */
  readonly titles?: SeatTitles;
  /** Locale sunflower formal name — defaults zh 向日葵 when omitted (tests). */
  readonly sunflower?: string;
}): string {
  const now = input.now ?? Date.now();
  const cutoff = now - COLLAB_BOARD_THREAD_WINDOW_MS;
  const recent = input.threads.filter((row) => row.updatedAt >= cutoff);
  const canSpawn = input.canSpawn !== false;
  const surface = input.surface ?? "coding";
  const t = input.titles
    ?? seatTitlesForScheme(DEFAULT_SEAT_TITLE_SCHEME, "zh");
  const sunflower = input.sunflower ?? sunflowerFormalName("zh");
  const mgrWs = `${t.manager}工作区`;
  const agentWs = `${t.agent}工作区`;
  // Ids + lane spout. Dispatch chains live in <session_posture> (when present).
  // Lane rule said once here — tools only reinforce when opened.
  const teamLead =
    surface === "im"
      ? "Roster (IM): channel→im_send · spawn+workspace_id · mint→向阳"
      : surface === "qichuang"
        ? `Roster (向阳·${mgrWs}): config/team_home/create-WS · peer=其它${mgrWs} · specialty→${agentWs}`
        : surface === "agent-home"
          ? `Roster (${agentWs}): specialty · ${t.boss} may speak · never ${mgrWs} coding`
          : canSpawn
            ? `Roster (${mgrWs}): spawn member_id · peer=其它${t.manager}(含${sunflower}) · specialty→${agentWs} · WS create/delete→向阳`
            : "Roster (no subagent): skill-load matching work";
  const peerLane =
    surface === "qichuang"
      ? `thread_message same-lane|向阳↔${agentWs} (其它${t.manager} id from workspace_session_prompt) · *=you`
      : surface === "agent-home"
        ? `thread_message ${agentWs}↔${agentWs}|↔向阳 · never coding ${mgrWs} · *=you`
        : `thread_message same-lane only · never ${agentWs} · *=you`;
  const lines = [teamLead];
  if (input.membersCatalog.trim()) lines.push(input.membersCatalog);
  if (recent.length === 0) {
    // Idle: do NOT dump unbound parent peers (that ate spawn-ids savings).
    // Find peers via session_search / thread_list — same progressive bar as
    // roster briefs → team_list. `unboundPeers` kept on the type for tests /
    // callers but ignored on the idle path.
    lines.push(`Peers: none · find via session_search · ${peerLane}`);
  } else {
    lines.push(`Peers · ${peerLane}`);
    for (const thread of recent) {
      const sessions = thread.sessions
        .map((s) => {
          const mark = s.self ? "*" : "";
          const tip = s.sideline ? ` · 支线=${clipBrief(s.sideline)}` : "";
          return `${s.sessionId}${mark}${tip}`;
        })
        .join("; ");
      const brief = thread.brief ? ` — ${clipBrief(thread.brief)}` : "";
      lines.push(
        `- 主线 ${thread.id} 「${thread.title}」${brief}${sessions ? ` · ${sessions}` : ""}`,
      );
    }
  }
  return lines.join("\n").slice(0, BOARD_MAX_CHARS);
}

function clipBrief(value: string): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= BRIEF_MAX ? one : `${one.slice(0, BRIEF_MAX - 1)}…`;
}

function countOpenTodos(runtime: FaceRuntime, sessionId: string): number | undefined {
  const todos = runtime.projections.stateOf(sessionId, "todos") as
    | ReadonlyArray<{ readonly status?: string }>
    | null
    | undefined;
  if (!todos || todos.length === 0) return undefined;
  return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .length;
}

function peerIdentityBits(
  runtime: FaceRuntime,
  sessionId: string,
  titles: SeatTitles,
  locale: SeatTitleLocale,
): {
  readonly identity?: string;
  readonly nickname?: string;
  readonly duty?: string;
} {
  const identity = runtime.sessionIdentities.get(sessionId);
  if (identity) {
    const home = runtime.agentRoster.findHome(identity.memberId);
    const member = home
      ? runtime.agentRoster.get(home.rosterWorkspaceId, identity.memberId)
      : undefined;
    const name = member?.name?.trim() || identity.memberId;
    const nick = member?.nickname?.trim();
    const duty = member?.role?.trim() || member?.playbook?.trim().slice(0, 80);
    return {
      identity: name,
      ...(nick ? { nickname: nick } : {}),
      ...(duty ? { duty } : {}),
    };
  }
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  if (badge === "qichuang") {
    return {
      identity: sunflowerFormalName(locale),
      duty: "admin/orchestrator",
    };
  }
  if (badge === "im") return { identity: "IM", duty: "channel orchestrator" };
  return { identity: titles.manager, duty: "coding parent" };
}

/**
 * Parent sessions in this workspace with no 主线 bind — so agents can still
 * collaborate when the pin catalog is empty.
 */
export function listUnboundParentPeers(
  runtime: FaceRuntime,
  workspaceId: string,
  selfId: string,
  titles?: SeatTitles,
  locale?: SeatTitleLocale,
): CollabBoardPeerRow[] {
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const resolvedLocale = locale ?? readUiLocalePreference(localeUser);
  const resolvedTitles = titles
    ?? readSeatTitles(presenceUser, resolvedLocale);
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
    const mainline = bind
      ? runtime.sessionThreads.get(workspaceId, bind.threadId)?.title
      : undefined;
    const who = peerIdentityBits(
      runtime,
      id,
      resolvedTitles,
      resolvedLocale,
    );
    const todoOpen = countOpenTodos(runtime, id);
    const hints = runtime.store.listHints?.(id);
    const sortAt = Math.max(hints?.lastEventTs ?? 0, meta?.lastPromptAt ?? 0);
    scored.push({
      sessionId: id,
      ...(title ? { title } : {}),
      ...who,
      ...(todoOpen !== undefined ? { todoOpen } : {}),
      ...(sideline ? { sideline } : {}),
      ...(mainline?.trim() ? { mainline: mainline.trim() } : {}),
      ...(id === selfId ? { self: true } : {}),
      ...(runtime.drain.isActive(id) ? { running: true } : {}),
      sortAt,
    });
  }
  scored.sort((a, b) => b.sortAt - a.sortAt || a.sessionId.localeCompare(b.sessionId));
  return scored.slice(0, UNBOUND_PEER_MAX).map(({ sortAt: _sortAt, ...row }) => row);
}

/** One sibling row on the delegated-child squad board. */
export interface TeamMateRow {
  readonly sessionId: string;
  readonly label: string;
  readonly self?: boolean;
  readonly memberId?: string;
  readonly role?: string;
  readonly nickname?: string;
  readonly duty?: string;
  readonly todoOpen?: number;
  readonly sideline?: string;
  /** Child-owned 主线 title when pinned (ownLane). */
  readonly mainline?: string;
  readonly running?: boolean;
}

export interface TeamMateOwnTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly resultPreview?: string;
}

/** Pure formatter for delegated-child squad (testable without a runtime). */
export function formatTeamMateBoardText(input: {
  readonly parentSessionId: string;
  readonly mates: readonly TeamMateRow[];
  readonly ownTask?: TeamMateOwnTask;
}): string {
  // Same facts as before; dense so child turns stay cheap.
  const lines = [
    `squad · parent=${input.parentSessionId} · *=you · siblings→thread_message · mint own 主线 (thread_upsert) · parent↔you=send_message/followup_task · FINAL→parent`,
  ];
  if (input.mates.length === 0) {
    lines.push("Teammates: none");
  } else {
    lines.push("Teammates:");
    for (const mate of input.mates) {
      const mark = mate.self ? "*" : "";
      const who = mate.nickname
        ? ` who=${clipBrief(mate.label)}（${clipBrief(mate.nickname)}）`
        : ` who=${clipBrief(mate.label)}`;
      const member = mate.memberId ? ` member=${mate.memberId}` : "";
      const duty = mate.duty
        ? ` duty=${clipBrief(mate.duty)}`
        : mate.role
          ? ` duty=${mate.role}`
          : "";
      const todos =
        mate.todoOpen !== undefined ? ` todo_open=${mate.todoOpen}` : "";
      const tip = mate.sideline ? ` 支线=${clipBrief(mate.sideline)}` : "";
      const main = mate.mainline
        ? ` 主线=「${clipBrief(mate.mainline)}」`
        : " 主线=none";
      const run = mate.running ? " · running" : "";
      lines.push(
        `- ${mate.sessionId}${mark}${who}${member}${duty}${todos}${tip}${main}${run}`,
      );
    }
  }
  if (input.ownTask) {
    lines.push(
      `your_task: ${input.ownTask.id} 「${clipBrief(input.ownTask.title)}」 status=${input.ownTask.status}` +
        (input.ownTask.resultPreview
          ? ` · ${clipBrief(input.ownTask.resultPreview)}`
          : ""),
    );
  }
  return lines.join("\n").slice(0, BOARD_MAX_CHARS);
}

function mateSideline(runtime: FaceRuntime, childId: string): string | undefined {
  const tip = runtime.presence.get(childId)?.tips;
  return tip?.trim() ? tip.trim() : undefined;
}

function mateMainline(
  runtime: FaceRuntime,
  childId: string,
): string | undefined {
  const wsId = runtime.workspaces.workspaceIdOf(childId);
  if (!wsId) return undefined;
  const bind = runtime.sessionThreads.bindOf(wsId, childId);
  if (!bind) return undefined;
  const title = runtime.sessionThreads.get(wsId, bind.threadId)?.title?.trim();
  return title || undefined;
}

function linkToMateRow(
  runtime: FaceRuntime,
  link: FaceSubagentLink,
  selfId: string,
): TeamMateRow {
  const sideline = mateSideline(runtime, link.childSessionId);
  const mainline = mateMainline(runtime, link.childSessionId);
  const todoOpen = countOpenTodos(runtime, link.childSessionId);
  let nickname: string | undefined;
  let duty: string | undefined;
  if (link.memberId) {
    const home = runtime.agentRoster.findHome(link.memberId);
    const member = home
      ? runtime.agentRoster.get(home.rosterWorkspaceId, link.memberId)
      : undefined;
    nickname = member?.nickname?.trim() || undefined;
    duty =
      member?.role?.trim() ||
      link.role?.trim() ||
      member?.playbook?.trim().slice(0, 80) ||
      undefined;
  } else if (link.role) {
    duty = link.role.trim();
  }
  return {
    sessionId: link.childSessionId,
    label: link.label.trim() || "subagent",
    ...(link.childSessionId === selfId ? { self: true } : {}),
    ...(link.memberId ? { memberId: link.memberId } : {}),
    ...(link.role ? { role: link.role } : {}),
    ...(nickname ? { nickname } : {}),
    ...(duty ? { duty } : {}),
    ...(todoOpen !== undefined ? { todoOpen } : {}),
    ...(sideline ? { sideline } : {}),
    ...(mainline ? { mainline } : {}),
    ...(runtime.drain.isActive(link.childSessionId) ? { running: true } : {}),
  };
}

/**
 * Squad board for a delegated child (same-parent siblings + own task).
 * Empty when the session is not a tool-delegated child.
 */
export function formatTeamMateBoard(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const selfLink = runtime.subagents.getByChild(sessionId);
  if (!selfLink || selfLink.mode === "fork") return "";
  const siblings = runtime.subagents.listDelegated(selfLink.parentSessionId);
  // siblingScope=none: board shows only self (+ own task), not other children.
  const scope = readWorkspaceDiscoverySettings(runtime).siblingScope;
  const visible =
    scope === "none"
      ? siblings.filter((link) => link.childSessionId === sessionId)
      : siblings;
  const mates = visible.map((link) => linkToMateRow(runtime, link, sessionId));
  const task = runtime.agentTeamTasks.findByChild(sessionId);
  return formatTeamMateBoardText({
    parentSessionId: selfLink.parentSessionId,
    mates,
    ...(task
      ? {
          ownTask: {
            id: task.id,
            title: task.title,
            status: task.status,
            ...(task.resultPreview ? { resultPreview: task.resultPreview } : {}),
          },
        }
      : {}),
  });
}

/** Parent roster+主线 board, or delegated-child squad board. */
export function formatCollabBoard(
  runtime: FaceRuntime,
  sessionId: string,
  now = Date.now(),
): string {
  const childBoard = formatTeamMateBoard(runtime, sessionId);
  if (childBoard) return childBoard;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const canSpawn = resolveAgentPresetProfile(badge).subagents.mode === "on";
  const surface: CollabBoardSurface = isAgentHomeSession(runtime, sessionId)
    ? "agent-home"
    : badge === "im" || workspaceId === IM_WORKSPACE_ID
      ? "im"
      : badge === "qichuang" || workspaceId === XIANGYANG_WORKSPACE_ID
        ? "qichuang"
        : "coding";
  const threads = listWorkspaceThreadCatalog(runtime, workspaceId, sessionId);
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const locale = readUiLocalePreference(localeUser);
  const titles = readSeatTitles(presenceUser, locale);
  return formatCollabBoardText({
    // Spawn-ids only — briefs via team_list (session-tool-copy contract).
    // Idle boards omit unbound peer tables — session_search finds them.
    membersCatalog: formatRosterCatalog(
      runtime.agentRoster.listVisible(workspaceId),
      { density: "spawn-ids" },
    ),
    threads,
    canSpawn,
    surface,
    titles,
    sunflower: sunflowerFormalName(locale),
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
