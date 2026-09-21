import type {
  SessionEvent,
  WorkspaceChangesSummary,
} from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

/** Wire view: durable summary plus Face 1-based seq of the announcing event. */
export type WorkspaceChangesProjected = WorkspaceChangesSummary & {
  readonly seq: number;
};

function parseSummary(value: unknown): WorkspaceChangesProjected {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("workspaceChanges summary invalid");
  }
  const turnId = (value as { turnId?: unknown }).turnId;
  const cwd = (value as { cwd?: unknown }).cwd;
  const filesRaw = (value as { files?: unknown }).files;
  const total = (value as { total?: unknown }).total;
  const added = (value as { added?: unknown }).added;
  const deleted = (value as { deleted?: unknown }).deleted;
  const seq = (value as { seq?: unknown }).seq;
  if (typeof turnId !== "string" || typeof cwd !== "string") {
    throw new Error("workspaceChanges.turnId/cwd must be string");
  }
  if (!Array.isArray(filesRaw)) {
    throw new Error("workspaceChanges.files must be array");
  }
  if (
    typeof total !== "number" ||
    typeof added !== "number" ||
    typeof deleted !== "number"
  ) {
    throw new Error("workspaceChanges totals must be numbers");
  }
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
    throw new Error("workspaceChanges.seq must be a positive integer");
  }
  const files: {
    path: string;
    display: string;
    added: number;
    deleted: number;
    binary?: true;
    oversized?: true;
  }[] = [];
  for (const row of filesRaw) {
    if (!row || typeof row !== "object") {
      throw new Error("workspaceChanges file row invalid");
    }
    const path = (row as { path?: unknown }).path;
    const display = (row as { display?: unknown }).display;
    const fAdded = (row as { added?: unknown }).added;
    const fDeleted = (row as { deleted?: unknown }).deleted;
    if (
      typeof path !== "string" ||
      typeof display !== "string" ||
      typeof fAdded !== "number" ||
      typeof fDeleted !== "number"
    ) {
      throw new Error("workspaceChanges file fields invalid");
    }
    const binary = (row as { binary?: unknown }).binary;
    const oversized = (row as { oversized?: unknown }).oversized;
    files.push({
      path,
      display,
      added: fAdded,
      deleted: fDeleted,
      ...(binary === true ? { binary: true as const } : {}),
      ...(oversized === true ? { oversized: true as const } : {}),
    });
  }
  const snapshotRaw = (value as { snapshot?: unknown }).snapshot;
  let snapshot: WorkspaceChangesSummary["snapshot"];
  if (snapshotRaw !== undefined) {
    if (!snapshotRaw || typeof snapshotRaw !== "object") {
      throw new Error("workspaceChanges.snapshot invalid");
    }
    const before = (snapshotRaw as { before?: unknown }).before;
    const after = (snapshotRaw as { after?: unknown }).after;
    if (typeof before !== "string" || typeof after !== "string") {
      throw new Error("workspaceChanges.snapshot before/after must be string");
    }
    snapshot = { before, after };
  }
  return {
    turnId,
    cwd,
    files,
    total,
    added,
    deleted,
    seq,
    ...(snapshot ? { snapshot } : {}),
  };
}

/**
 * DSH workspace-changes projection: one summary per turnId (same-turn replace).
 * `seq` is the Face 1-based index of the announcing `workspace/changes` event
 * (needed by `changes.fileDiff`).
 */
export function createWorkspaceChangesProjectionUnit(): ProjectionDefinition<
  "workspaceChanges",
  WorkspaceChangesProjected[],
  readonly WorkspaceChangesProjected[]
> {
  return {
    key: "workspaceChanges",
    stateVersion: 2,
    init: () => [],
    apply(state, event: SessionEvent, seq: number): WorkspaceChangesProjected[] {
      if (event.type !== "workspace/changes") return state;
      const next = state.filter((s) => s.turnId !== event.turnId);
      next.push({ ...event.summary, seq });
      return next;
    },
    wire: {
      view: (state) => state,
      parse(value: unknown): readonly WorkspaceChangesProjected[] {
        if (!Array.isArray(value)) {
          throw new Error("workspaceChanges projection must be an array");
        }
        return value.map(parseSummary);
      },
    },
  };
}
