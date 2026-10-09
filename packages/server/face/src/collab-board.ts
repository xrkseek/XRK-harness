/**
 * Turn-start collab board: live Agent Team catalog + parent 主线 sessions.
 * Seed AGENTS.md / skills stay on standing inject — this fragment is ids only.
 */
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { formatRosterCatalog } from "./agent-roster-store.js";
import { listWorkspaceThreadCatalog } from "./session-thread-tools.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveAgentPresetProfile } from "./presets-catalog.js";

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

export function formatCollabBoardText(input: {
  readonly membersCatalog: string;
  readonly threads: readonly CollabBoardThreadRow[];
  readonly now?: number;
  /** False for Frugal / badges with `subagents.mode === "off"`. */
  readonly canSpawn?: boolean;
}): string {
  const now = input.now ?? Date.now();
  const cutoff = now - COLLAB_BOARD_THREAD_WINDOW_MS;
  const recent = input.threads.filter((row) => row.updatedAt >= cutoff);
  const canSpawn = input.canSpawn !== false;
  const lines = [
    canSpawn
      ? "Agent Team — spawn `subagent` with member_id when a listed name or brief fits (see session_capability for permission × tool_surface). Standing skills are for that member after spawn. Playbooks stay on the member."
      : "Agent Team catalog (this badge has no subagent tools — Skill-load matching work here; see session_capability). Members:",
    input.membersCatalog,
    "",
    "主线 (parent sessions, last 24h) — `thread_message` the peer's session_id; reply returns here. Do not thread_switch to send mail (that moves *this* session onto their pin). Not a subagent.",
  ];
  if (recent.length === 0) {
    lines.push("(none)");
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

/** Live board for a parent session. Empty string for delegated children. */
export function formatCollabBoard(
  runtime: FaceRuntime,
  sessionId: string,
  now = Date.now(),
): string {
  if (runtime.subagents.getByChild(sessionId)) return "";
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const canSpawn =
    resolveAgentPresetProfile(effectiveSessionAgentPreset(runtime, sessionId))
      .subagents.mode === "on";
  return formatCollabBoardText({
    membersCatalog: formatRosterCatalog(
      runtime.agentRoster.listVisible(workspaceId),
    ),
    threads: listWorkspaceThreadCatalog(runtime, workspaceId, sessionId),
    canSpawn,
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
