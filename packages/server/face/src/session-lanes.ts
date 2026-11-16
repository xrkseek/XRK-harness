/**
 * Turn-start `<session_lanes>` — this session's live 主线 / 支线 / open todos
 * plus verbs to pin, refresh, and switch after completion.
 *
 * Dynamic every turn (long or short). Skill playbooks stay optional; this card
 * is the always-on awareness so agents keep anchoring work.
 */

import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";

const TITLE_MAX = 80;
const TIP_MAX = 120;
const TODO_LINES_MAX = 6;

function clip(value: string, max: number): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

type TodoRow = {
  readonly content?: string;
  readonly status?: string;
};

function openTodos(
  runtime: FaceRuntime,
  sessionId: string,
): ReadonlyArray<{ readonly content: string; readonly status: string }> {
  const raw = runtime.projections.stateOf(sessionId, "todos") as
    | ReadonlyArray<TodoRow>
    | null
    | undefined;
  if (!raw || raw.length === 0) return [];
  return raw
    .filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .map((t) => ({
      content: typeof t.content === "string" ? t.content : "",
      status: typeof t.status === "string" ? t.status : "pending",
    }))
    .filter((t) => t.content.length > 0);
}

function allTodosSettled(runtime: FaceRuntime, sessionId: string): boolean {
  const raw = runtime.projections.stateOf(sessionId, "todos") as
    | ReadonlyArray<TodoRow>
    | null
    | undefined;
  if (!raw || raw.length === 0) return false;
  return raw.every(
    (t) => t.status === "completed" || t.status === "cancelled",
  );
}

/**
 * Compact lanes card for this session (parents + delegated children).
 * Empty only when the session is unknown.
 */
export function formatSessionLanes(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const bind = runtime.sessionThreads.bindOf(workspaceId, sessionId);
  const thread = bind
    ? runtime.sessionThreads.get(workspaceId, bind.threadId)
    : undefined;
  const sideline =
    bind?.sideline?.trim() ||
    runtime.presence.get(sessionId)?.tips?.trim() ||
    "";
  const todos = openTodos(runtime, sessionId);
  const settled = allTodosSettled(runtime, sessionId);
  const child = Boolean(runtime.subagents.getByChild(sessionId));

  // State first; one verb line; no lecture (posture/board own their facts).
  const lines: string[] = [
    child
      ? "delegated — mint your own 主线 (do not copy the parent pin)."
      : "pin lasting missions; peers see them on the collab board.",
    thread
      ? `主线: id=${thread.id} 「${clip(thread.title, TITLE_MAX)}」` +
        (thread.brief.trim()
          ? ` · brief=${clip(thread.brief, TIP_MAX)}`
          : "")
      : "主线: none — thread_upsert({ title, brief }) when the mission is clear.",
    sideline
      ? `支线: ${clip(sideline, TIP_MAX)}`
      : "支线: none — presence_set({ tips }) for start / blocked / waiting / done.",
  ];

  if (todos.length > 0) {
    lines.push(`todo open (${todos.length}):`);
    for (const row of todos.slice(0, TODO_LINES_MAX)) {
      lines.push(`- [${row.status}] ${clip(row.content, TIP_MAX)}`);
    }
    if (todos.length > TODO_LINES_MAX) {
      lines.push(`- … +${todos.length - TODO_LINES_MAX} more`);
    }
  } else if (settled) {
    lines.push(
      "todo: settled — presence_set done → thread_delete|thread_upsert next → todo_write.",
    );
  } else {
    lines.push("todo: none — multi-step → todo_write (not into 主线).");
  }

  lines.push(
    "done → complete todos → presence_set → thread_delete|thread_upsert next. Anti: empty brief · micro-step pins · skip tips.",
  );
  return lines.join("\n");
}

export function createSessionLanesFragmentProvider(runtime: FaceRuntime): {
  readonly id: "session-lanes";
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
    id: "session-lanes",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const value = formatSessionLanes(runtime, sessionId);
      if (!value) return [];
      return [
        {
          id: "additional_context.session_lanes",
          kind: "additional_context",
          text: `<session_lanes>\n${value}\n</session_lanes>`,
          phase: "turn-start",
          // Between posture (8.5) and collab board (8) — always visible.
          priority: 8.25,
        },
      ];
    },
  };
}
