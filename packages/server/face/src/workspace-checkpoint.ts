/**
 * Face seam for `@xrkseek/checkpoint` WorkspaceCheckpointStore.
 * One store per resolved workspace cwd; Host snapshots before continueTurn,
 * slash `/rollback` and `session.checkpoint.*` restore.
 */

import {
  WorkspaceCheckpointError,
  WorkspaceCheckpointStore,
  createProcessGitRunner,
  type GitRunner,
  type RestorePlan,
  type RestoreResult,
  type WorkspaceCheckpointRecord,
} from "@xrkseek/checkpoint";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRpcResult } from "./types.js";
import type { FaceRuntime } from "./context.js";
import { resolveSessionCwd } from "./session-cwd.js";

const stores = new Map<string, WorkspaceCheckpointStore>();

/** Injected git for tests; production uses {@link createProcessGitRunner}. */
let defaultRunner: GitRunner | undefined;

/** Test seam: replace the process git runner (or clear with `undefined`). */
export function setWorkspaceCheckpointGitRunner(
  runner: GitRunner | undefined,
): void {
  defaultRunner = runner;
  stores.clear();
}

/** Drop cached stores (tests / Host cwd swap). */
export function clearWorkspaceCheckpointStores(): void {
  stores.clear();
}

/**
 * Resolve (and cache) the checkpoint store for a workspace directory.
 * Shadow git lives under `<cwd>/.xrk/checkpoints`.
 */
export function workspaceCheckpointStoreFor(
  workspaceDir: string,
  runGit?: GitRunner,
): WorkspaceCheckpointStore {
  const key = workspaceDir;
  const hit = stores.get(key);
  if (hit) return hit;
  const store = new WorkspaceCheckpointStore({
    workspaceDir,
    runGit: runGit ?? defaultRunner ?? createProcessGitRunner(),
  });
  stores.set(key, store);
  return store;
}

export function workspaceCheckpointStoreForSession(
  runtime: FaceRuntime,
  sessionId: string,
  runGit?: GitRunner,
): WorkspaceCheckpointStore {
  return workspaceCheckpointStoreFor(
    resolveSessionCwd(runtime, sessionId),
    runGit,
  );
}

/** Map store failures to Face `ok: false` (stable code in details). */
export function checkpointFail(
  err: unknown,
): FaceRpcResult<never> {
  if (err instanceof WorkspaceCheckpointError) {
    const code =
      err.code === "bad-argument" || err.code === "unknown-checkpoint"
        ? "invalid-payload"
        : "checkpoint-failed";
    return {
      ok: false,
      error: {
        code,
        message: err.message,
        details: { checkpointCode: err.code },
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "checkpoint-failed",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}

/**
 * Host / Face: snapshot worktree before a turn mutates files.
 * Best-effort — git missing or snapshot failure must not block the turn.
 * Disabled when `XRK_CHECKPOINTS=0`.
 */
export async function snapshotSessionWorkspace(
  runtime: FaceRuntime,
  sessionId: string,
  opts?: { readonly label?: string; readonly seq?: number },
): Promise<WorkspaceCheckpointRecord | undefined> {
  if (process.env.XRK_CHECKPOINTS === "0") return undefined;
  if (!runtime.store.has(sessionId)) return undefined;
  const seq =
    opts?.seq ??
    readSessionEvents(runtime.store, sessionId).length;
  const store = workspaceCheckpointStoreForSession(runtime, sessionId);
  try {
    return await store.snapshot({
      sessionId,
      seq,
      ...(opts?.label ? { label: opts.label } : { label: "pre-turn" }),
    });
  } catch {
    return undefined;
  }
}

/**
 * Newest checkpoint for this session whose `seq` is ≤ `atSeq`
 * (Face 1-based history seq of the message / turn tail).
 */
export function findCheckpointAtOrBefore(
  store: WorkspaceCheckpointStore,
  sessionId: string,
  atSeq: number,
): WorkspaceCheckpointRecord | undefined {
  const id = sessionId.trim();
  let best: WorkspaceCheckpointRecord | undefined;
  for (const row of store.list()) {
    if (row.sessionId !== id) continue;
    if (row.seq > atSeq) continue;
    if (!best || row.seq > best.seq || row.createdAt > best.createdAt) {
      best = row;
    }
  }
  return best;
}

/** Resolve `/rollback` target: bare index (1-based newest-last list), id prefix, or `seq:N`. */
export function resolveRollbackTarget(
  store: WorkspaceCheckpointStore,
  sessionId: string,
  token: string,
): WorkspaceCheckpointRecord | undefined {
  const raw = token.trim();
  if (!raw) return undefined;

  const seqMatch = /^seq:(-?\d+)$/iu.exec(raw);
  if (seqMatch) {
    const atSeq = Number(seqMatch[1]);
    if (!Number.isFinite(atSeq)) return undefined;
    return findCheckpointAtOrBefore(store, sessionId, atSeq);
  }

  const all = store.list().filter((r) => r.sessionId === sessionId.trim());
  if (/^\d+$/u.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= all.length) return all[n - 1];
  }

  const lower = raw.toLowerCase();
  return (
    all.find((r) => r.id === raw) ??
    all.find((r) => r.id.toLowerCase().startsWith(lower))
  );
}

export function formatCheckpointList(
  rows: readonly WorkspaceCheckpointRecord[],
): string {
  if (rows.length === 0) {
    return "No workspace checkpoints for this session yet. Host snapshots before each turn when git is available (set XRK_CHECKPOINTS=0 to disable).";
  }
  const lines = rows.map((r, i) => {
    const label = r.label ? ` ${r.label}` : "";
    return `${i + 1}. ${r.id.slice(0, 12)}  seq=${r.seq}  files=${r.fileCount}${label}`;
  });
  return [
    "Workspace checkpoints (shadow git; does not rewrite chat — use Branch / session.fork for lineage):",
    ...lines,
    "Restore: /rollback <n|id> · preview: /rollback plan <n|id> · prune extras: /rollback <n|id> --prune",
  ].join("\n");
}

export function formatRestorePlan(plan: RestorePlan): string {
  const extra =
    plan.extra.length === 0
      ? "none"
      : plan.extra.slice(0, 20).join(", ") +
        (plan.extra.length > 20 ? ` (+${plan.extra.length - 20} more)` : "");
  return `Checkpoint ${plan.id.slice(0, 12)}: ${plan.fileCount} files in snapshot; untracked extras (kept unless --prune): ${extra}`;
}

export function formatRestoreResult(result: RestoreResult): string {
  const removed =
    result.removed.length === 0
      ? ""
      : ` Removed ${result.removed.length} extra path(s).`;
  return `Restored workspace from ${result.id.slice(0, 12)} (${result.restored} paths).${removed} Chat lineage unchanged — use Branch for a forked session.`;
}
