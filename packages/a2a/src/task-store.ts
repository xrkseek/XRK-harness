/**
 * In-memory A2A task registry (Hermes `TaskStore` subset): create on send,
 * query via tasks/get|list, cancel resets the turn tracker at the adapter.
 * No push / SSE watchers in this slice.
 */

import { randomUUID } from "node:crypto";
import {
  ROLE_AGENT,
  STATE_COMPLETED,
  STATE_SUBMITTED,
  TERMINAL_STATES,
  textMessage,
} from "./protocol.js";

export interface A2aTaskRecord {
  readonly taskId: string;
  readonly contextId: string;
  readonly peer: string;
  state: string;
  reply: string;
  readonly createdAt: number;
}

const MAX_TERMINAL = 500;

function nowIso(): string {
  return new Date().toISOString();
}

/** Render a stored record as an A2A v1.0 Task (no createdAt — strict ProtoJSON). */
export function buildTask(
  taskId: string,
  contextId: string,
  state: string,
  agentText = "",
): Record<string, unknown> {
  const task: Record<string, unknown> = {
    id: taskId,
    contextId,
    status: { state, timestamp: nowIso() },
  };
  if (agentText) {
    const status = task.status as Record<string, unknown>;
    status.message = textMessage(ROLE_AGENT, agentText, contextId);
    if (state === STATE_COMPLETED) {
      task.artifacts = [
        {
          artifactId: randomUUID().replace(/-/g, ""),
          parts: [{ text: agentText }],
        },
      ];
    }
  }
  return task;
}

export class TaskStore {
  private readonly tasks = new Map<string, A2aTaskRecord>();

  create(
    taskId: string,
    contextId: string,
    peer: string,
  ): A2aTaskRecord {
    const rec: A2aTaskRecord = {
      taskId,
      contextId,
      peer,
      state: STATE_SUBMITTED,
      reply: "",
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, rec);
    return { ...rec };
  }

  get(taskId: string): A2aTaskRecord | undefined {
    const rec = this.tasks.get(taskId);
    return rec ? { ...rec } : undefined;
  }

  setState(taskId: string, state: string): void {
    const rec = this.tasks.get(taskId);
    if (!rec || TERMINAL_STATES.has(rec.state)) return;
    rec.state = state;
  }

  /**
   * Transition to a terminal state. Idempotent when already terminal.
   * @returns updated copy, or undefined if missing / already terminal.
   */
  complete(
    taskId: string,
    state: string,
    reply = "",
  ): A2aTaskRecord | undefined {
    const rec = this.tasks.get(taskId);
    if (!rec || TERMINAL_STATES.has(rec.state)) return undefined;
    rec.state = state;
    rec.reply = reply;
    this.trimTerminal();
    return { ...rec };
  }

  /**
   * Newest-first page. Returns `{ records, nextOffset, total }` where
   * `nextOffset` is 0 when there is no further page (Hermes ListTasks).
   */
  list(options: {
    readonly contextId?: string;
    readonly state?: string;
    readonly pageSize?: number;
    readonly offset?: number;
  } = {}): {
    readonly records: A2aTaskRecord[];
    readonly nextOffset: number;
    readonly total: number;
  } {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 50, 100));
    const offset = Math.max(0, options.offset ?? 0);
    const contextId = options.contextId?.trim() ?? "";
    const state = options.state?.trim() ?? "";
    const all = [...this.tasks.values()]
      .filter(
        (r) =>
          (!contextId || r.contextId === contextId) &&
          (!state || r.state === state),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r }));
    const total = all.length;
    const page = all.slice(offset, offset + pageSize);
    const nextOffset =
      offset + pageSize < total ? offset + pageSize : 0;
    return { records: page, nextOffset, total };
  }

  static toTask(
    rec: A2aTaskRecord,
    includeArtifacts = true,
  ): Record<string, unknown> {
    const task = buildTask(rec.taskId, rec.contextId, rec.state, rec.reply);
    if (!includeArtifacts) delete task.artifacts;
    return task;
  }

  private trimTerminal(): void {
    const terminal = [...this.tasks.entries()].filter(([, r]) =>
      TERMINAL_STATES.has(r.state),
    );
    const overflow = terminal.length - MAX_TERMINAL;
    if (overflow <= 0) return;
    for (let i = 0; i < overflow; i++) {
      this.tasks.delete(terminal[i]![0]);
    }
  }
}
