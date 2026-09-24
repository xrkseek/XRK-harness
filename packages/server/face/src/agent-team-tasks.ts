/**
 * Thin Agent Teams task board — delivery / result / pause-takeover beside the
 * collaboration graph. Not a DSH Cordis TeamService port: in-memory + optional
 * JSON sidecar, keyed by root (parent) session.
 */
import { readFileSync } from "node:fs";
import { tryWriteJsonSidecar } from "./json-sidecar.js";
import type { AgentTeamSpawnRole } from "./agent-team-roles.js";

export type AgentTeamTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "paused";

export interface AgentTeamTask {
  readonly id: string;
  readonly parentSessionId: string;
  readonly title: string;
  readonly status: AgentTeamTaskStatus;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly childSessionId?: string;
  readonly role?: AgentTeamSpawnRole;
  /** Managed worktree checkout path when spawn used worktree isolation. */
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
  readonly worktreeId?: string;
  /** Human owns the child after interrupt takeover (suppress auto-steer). */
  readonly humanOwned?: boolean;
  readonly resultPreview?: string;
  readonly schemaValid?: boolean;
  readonly schemaErrors?: readonly string[];
}

interface PersistShape {
  readonly tasks: AgentTeamTask[];
}

function newTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentTeamTaskBoard {
  private readonly tasks = new Map<string, AgentTeamTask>();
  /** In-memory only — schemas are large and session-scoped. */
  private readonly schemas = new Map<string, Readonly<Record<string, unknown>>>();
  private readonly persistPath: string | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) this.load();
  }

  get(taskId: string): AgentTeamTask | undefined {
    return this.tasks.get(taskId.trim());
  }

  list(parentSessionId: string): readonly AgentTeamTask[] {
    const parent = parentSessionId.trim();
    return [...this.tasks.values()]
      .filter((t) => t.parentSessionId === parent)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Create a pending/in_progress task when spawning a teammate. */
  open(input: {
    readonly parentSessionId: string;
    readonly title: string;
    readonly childSessionId?: string;
    readonly role?: AgentTeamSpawnRole;
    readonly taskId?: string;
    readonly now?: number;
  }): AgentTeamTask {
    const now = input.now ?? Date.now();
    const id = (input.taskId?.trim() || newTaskId()).slice(0, 80);
    const existing = this.tasks.get(id);
    if (existing) {
      const next: AgentTeamTask = {
        ...existing,
        title: input.title.trim() || existing.title,
        status: "in_progress",
        revision: existing.revision + 1,
        updatedAt: now,
        ...(input.childSessionId
          ? { childSessionId: input.childSessionId }
          : {}),
        ...(input.role ? { role: input.role } : {}),
        humanOwned: false,
      };
      this.tasks.set(id, next);
      this.save();
      return next;
    }
    const task: AgentTeamTask = {
      id,
      parentSessionId: input.parentSessionId.trim(),
      title: input.title.trim() || id,
      status: input.childSessionId ? "in_progress" : "pending",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      ...(input.childSessionId
        ? { childSessionId: input.childSessionId }
        : {}),
      ...(input.role ? { role: input.role } : {}),
    };
    this.tasks.set(id, task);
    this.save();
    return task;
  }

  /** Bind a child session after create (when id was known before spawn). */
  bindChild(taskId: string, childSessionId: string, now = Date.now()): AgentTeamTask | undefined {
    const prev = this.tasks.get(taskId.trim());
    if (!prev) return undefined;
    const next: AgentTeamTask = {
      ...prev,
      childSessionId,
      status: prev.status === "pending" ? "in_progress" : prev.status,
      revision: prev.revision + 1,
      updatedAt: now,
      humanOwned: false,
    };
    this.tasks.set(prev.id, next);
    this.save();
    return next;
  }

  findByChild(childSessionId: string): AgentTeamTask | undefined {
    const id = childSessionId.trim();
    for (const task of this.tasks.values()) {
      if (task.childSessionId === id) return task;
    }
    return undefined;
  }

  /** Attach managed worktree lease fields to a Teams task. */
  bindWorktree(
    taskId: string,
    worktree: {
      readonly path: string;
      readonly branch: string;
      readonly id?: string;
    },
    now = Date.now(),
  ): AgentTeamTask | undefined {
    const prev = this.tasks.get(taskId.trim());
    if (!prev) return undefined;
    const next: AgentTeamTask = {
      ...prev,
      worktreePath: worktree.path,
      worktreeBranch: worktree.branch,
      ...(worktree.id ? { worktreeId: worktree.id } : {}),
      revision: prev.revision + 1,
      updatedAt: now,
    };
    this.tasks.set(prev.id, next);
    this.save();
    return next;
  }

  /** Attach an output_schema for later validation (not persisted). */
  setOutputSchema(
    taskId: string,
    schema: Readonly<Record<string, unknown>>,
  ): void {
    this.schemas.set(taskId.trim(), schema);
  }

  outputSchemaOf(taskId: string): Readonly<Record<string, unknown>> | undefined {
    return this.schemas.get(taskId.trim());
  }

  outputSchemaForChild(
    childSessionId: string,
  ): Readonly<Record<string, unknown>> | undefined {
    const task = this.findByChild(childSessionId);
    if (!task) return undefined;
    return this.schemas.get(task.id);
  }

  /**
   * Soft-pause / human takeover after interrupt.
   * Marks the task paused + humanOwned (completion steer already suppressed).
   */
  markTakeover(childSessionId: string, now = Date.now()): AgentTeamTask | undefined {
    const prev = this.findByChild(childSessionId);
    if (!prev) return undefined;
    const next: AgentTeamTask = {
      ...prev,
      status: "paused",
      humanOwned: true,
      revision: prev.revision + 1,
      updatedAt: now,
    };
    this.tasks.set(prev.id, next);
    this.save();
    return next;
  }

  /** Resume after send_message — clear humanOwned, back to in_progress. */
  markResumed(childSessionId: string, now = Date.now()): AgentTeamTask | undefined {
    const prev = this.findByChild(childSessionId);
    if (!prev) return undefined;
    if (!prev.humanOwned && prev.status === "in_progress") return prev;
    const next: AgentTeamTask = {
      ...prev,
      status: "in_progress",
      humanOwned: false,
      revision: prev.revision + 1,
      updatedAt: now,
    };
    this.tasks.set(prev.id, next);
    this.save();
    return next;
  }

  complete(
    taskId: string,
    input: {
      readonly ok: boolean;
      readonly preview?: string;
      readonly schemaValid?: boolean;
      readonly schemaErrors?: readonly string[];
      readonly now?: number;
    },
  ): AgentTeamTask | undefined {
    const prev = this.tasks.get(taskId.trim());
    if (!prev) return undefined;
    const now = input.now ?? Date.now();
    const preview = input.preview?.trim();
    const next: AgentTeamTask = {
      ...prev,
      status: input.ok ? "completed" : "failed",
      revision: prev.revision + 1,
      updatedAt: now,
      humanOwned: false,
      ...(preview
        ? {
            resultPreview:
              preview.length > 500 ? `${preview.slice(0, 500)}…` : preview,
          }
        : {}),
      ...(input.schemaValid !== undefined
        ? { schemaValid: input.schemaValid }
        : {}),
      ...(input.schemaErrors && input.schemaErrors.length > 0
        ? { schemaErrors: input.schemaErrors.slice(0, 8) }
        : {}),
    };
    this.tasks.set(prev.id, next);
    this.save();
    return next;
  }

  /** Complete by child session id (foreground wait / idle notice). */
  completeByChild(
    childSessionId: string,
    input: {
      readonly ok: boolean;
      readonly preview?: string;
      readonly schemaValid?: boolean;
      readonly schemaErrors?: readonly string[];
      readonly now?: number;
    },
  ): AgentTeamTask | undefined {
    const prev = this.findByChild(childSessionId);
    if (!prev) return undefined;
    return this.complete(prev.id, input);
  }

  private load(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as PersistShape;
      if (!Array.isArray(raw.tasks)) return;
      for (const row of raw.tasks) {
        if (!row || typeof row !== "object") continue;
        if (typeof row.id !== "string" || !row.id.trim()) continue;
        if (typeof row.parentSessionId !== "string") continue;
        this.tasks.set(row.id, row);
      }
    } catch {
      /* missing / corrupt → empty */
    }
  }

  private save(): void {
    const file = this.persistPath;
    if (!file) return;
    tryWriteJsonSidecar(file, { tasks: [...this.tasks.values()] });
  }
}

export function agentTeamTasksPath(
  subagentPersistPath?: string,
): string | undefined {
  if (!subagentPersistPath?.trim()) return undefined;
  return subagentPersistPath.replace(/[^/\\]+$/, "agent-team-tasks.json");
}
