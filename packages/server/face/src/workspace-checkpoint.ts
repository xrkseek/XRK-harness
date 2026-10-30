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

/**
 * Why the last Host pre-turn snapshot produced no point, per workspace.
 *
 * {@link snapshotSessionWorkspace} is best-effort by design (a turn must never
 * wait on git), but "best effort" used to mean "silent": a Host without git, a
 * snapshot that blew its budget and a workspace the store could not write all
 * surfaced to the user as `Unknown checkpoint seq:38` — the one answer that
 * explains nothing. Keep the failure around so `/rollback` can say what
 * actually happened.
 */
interface SnapshotFailure {
  readonly at: number;
  readonly code: string;
  readonly message: string;
}

const snapshotFailures = new Map<string, SnapshotFailure>();
const snapshotSuccessAt = new Map<string, number>();
/** Per-workspace in-flight snapshot (coalesce, never queue a third). */
const snapshotsInFlight = new Map<string, Promise<unknown>>();

/** Test seam: forget recorded snapshot health. */
export function clearSnapshotHealth(): void {
  snapshotFailures.clear();
  snapshotSuccessAt.clear();
  snapshotsInFlight.clear();
}

function noteSnapshotFailure(
  workspaceDir: string,
  code: string,
  message: string,
): void {
  snapshotFailures.set(workspaceDir, { at: Date.now(), code, message });
}

function noteSnapshotSuccess(workspaceDir: string): void {
  snapshotSuccessAt.set(workspaceDir, Date.now());
}

/**
 * Upper bound for one `snapshotSessionWorkspace` call. The store's per-command
 * timeout should win first; this races the whole call so a runner that never
 * settles (or a hung fs call) still degrades to "no checkpoint" instead of
 * blocking the drain queue. Skips the turn's point, never the turn.
 */
export const SNAPSHOT_TIMEOUT_MS = 20_000;

/**
 * Soft budget for Host drain pre-turn snapshots when the tool barrier must
 * wait (LLM returned tools before git finished). Overlaps the model call via
 * `beforeTools`; prefer skip over stalling Queue/Steer. Manual
 * `session.checkpoint.snapshot` still uses {@link SNAPSHOT_TIMEOUT_MS}.
 */
export const SNAPSHOT_DRAIN_BUDGET_MS = 5_000;

function timeoutAfter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

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
 * Shadow git lives under `{XRK_HOME}/checkpoints/<workspace-id>` — product
 * data is gathered in the XRK home, never inside the workspace.
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
  // The store disables `maintenance.auto` so git never grabs the object lock
  // underneath a concurrent snapshot — which also means nothing else packs the
  // loose objects those commits produce. Pack once per process on first use:
  // `gc --auto` detaches itself (gc.autoDetach) and no-ops while the loose
  // count is under `gc.auto`. An injected runner means a test double, which is
  // not expected to answer `count-objects`.
  if (runGit === undefined && defaultRunner === undefined) {
    void store.reclaim().catch(() => undefined);
  }
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
        : err.code === "timed-out"
          ? "checkpoint-timeout"
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
 *
 * Hard deadline: race the snapshot against `opts.budgetMs` (default
 * {@link SNAPSHOT_TIMEOUT_MS}). Host drain should pass
 * {@link SNAPSHOT_DRAIN_BUDGET_MS} so large worktrees cannot pin Queue/Steer.
 */
export async function snapshotSessionWorkspace(
  runtime: FaceRuntime,
  sessionId: string,
  opts?: {
    readonly label?: string;
    readonly seq?: number;
    /** Whole-call race budget; default {@link SNAPSHOT_TIMEOUT_MS}. */
    readonly budgetMs?: number;
  },
): Promise<WorkspaceCheckpointRecord | undefined> {
  if (process.env.XRK_CHECKPOINTS === "0") {
    return undefined;
  }
  if (!runtime.store.has(sessionId)) return undefined;
  const workspaceDir = resolveSessionCwd(runtime, sessionId);
  // Coalesce: if the previous point for this workspace is still running (a
  // slow `add -A` outlives its budget), skip instead of stacking snapshots.
  // The running one still records its point when it finishes.
  if (snapshotsInFlight.has(workspaceDir)) return undefined;
  const seq = opts?.seq ?? readSessionEvents(runtime.store, sessionId).length;
  const store = workspaceCheckpointStoreForSession(runtime, sessionId);
  const budgetMs =
    opts?.budgetMs !== undefined && opts.budgetMs > 0
      ? opts.budgetMs
      : SNAPSHOT_TIMEOUT_MS;
  const work = (async (): Promise<WorkspaceCheckpointRecord> => {
    try {
      const record = await store.snapshot({
        sessionId,
        seq,
        ...(opts?.label ? { label: opts.label } : { label: "pre-turn" }),
      });
      noteSnapshotSuccess(workspaceDir);
      return record;
    } catch (err) {
      noteSnapshotFailure(
        workspaceDir,
        err instanceof WorkspaceCheckpointError
          ? err.code
          : "snapshot-failed",
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  })();
  let tracked!: Promise<WorkspaceCheckpointRecord>;
  tracked = work.finally(() => {
    if (snapshotsInFlight.get(workspaceDir) === tracked) {
      snapshotsInFlight.delete(workspaceDir);
    }
  });
  snapshotsInFlight.set(workspaceDir, tracked);
  try {
    const record = await Promise.race([
      tracked,
      timeoutAfter(budgetMs).then(() => {
        throw new WorkspaceCheckpointError(
          "timed-out",
          `workspace snapshot exceeded ${budgetMs}ms; skipped`,
        );
      }),
    ]);
    return record;
  } catch (err) {
    // The budget expired but the git work did not: let it finish in the
    // background so the point still lands (the next turn can rewind to it).
    // Only the *return value* is skipped, never the snapshot.
    if (err instanceof WorkspaceCheckpointError && err.code === "timed-out") {
      noteSnapshotFailure(workspaceDir, "timed-out", err.message);
      void tracked.catch(() => undefined);
    }
    return undefined;
  }
}

/**
 * One-line reason `/rollback` has nothing to restore to, or `undefined` when
 * the workspace has recorded points and no recent failure.
 *
 * Callers pass the already-loaded rows so the message can distinguish
 * "no point at or before this seq" from "this Host never took a point".
 */
export function checkpointDiagnostic(
  runtime: FaceRuntime,
  sessionId: string,
  rows: readonly WorkspaceCheckpointRecord[],
): string | undefined {
  if (process.env.XRK_CHECKPOINTS === "0") {
    return "Workspace checkpoints are disabled on this Host (XRK_CHECKPOINTS=0), so Restore has nothing to revert to.";
  }
  let workspaceDir: string;
  try {
    workspaceDir = resolveSessionCwd(runtime, sessionId);
  } catch {
    return undefined;
  }
  const failure = snapshotFailures.get(workspaceDir);
  const okAt = snapshotSuccessAt.get(workspaceDir) ?? 0;
  if (rows.length > 0) {
    if (failure !== undefined && failure.at > okAt) {
      return `Latest snapshot attempt for ${workspaceDir} failed (${failure.code}): ${failure.message}`;
    }
    return undefined;
  }
  if (failure !== undefined && failure.at > okAt) {
    return `No snapshot was recorded for ${workspaceDir}: ${failure.code} — ${failure.message}`;
  }
  return `No workspace snapshot has completed for ${workspaceDir} on this Host yet. Restore needs \`git\` on PATH and a writable ${workspaceDir}; set XRK_CHECKPOINTS=0 to turn snapshots off explicitly.`;
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
  diagnostic?: string,
): string {
  if (rows.length === 0) {
    return [
      "No workspace checkpoints for this session yet. Host snapshots before each turn when git is available (set XRK_CHECKPOINTS=0 to disable).",
      ...(diagnostic ? [`Diagnosis: ${diagnostic}`] : []),
    ].join("\n");
  }
  const lines = rows.map((r, i) => {
    const label = r.label ? ` ${r.label}` : "";
    return `${i + 1}. ${r.id.slice(0, 12)}  seq=${r.seq}  files=${r.fileCount}${label}`;
  });
  return [
    "Workspace checkpoints (shadow git; does not rewrite chat — use Branch / session.fork for lineage):",
    ...lines,
    "Restore: /rollback <n|id> · preview: /rollback plan <n|id> · prune extras: /rollback <n|id> --prune",
    ...(diagnostic ? [`Note: ${diagnostic}`] : []),
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

export function formatRestoreResult(
  result: RestoreResult & {
    readonly chatSeq?: number;
    readonly eventCount?: number;
    readonly chatAhead?: boolean;
    readonly chatTruncated?: boolean;
  },
): string {
  const removed =
    result.removed.length === 0
      ? ""
      : ` Removed ${result.removed.length} extra path(s).`;
  const base = `Restored workspace from ${result.id.slice(0, 12)} (${result.restored} paths).${removed}`;
  if (result.chatTruncated) {
    return `${base} Chat truncated to checkpoint seq ${String(result.chatSeq ?? "?")} (${String(result.eventCount ?? "?")} events kept).`;
  }
  if (result.chatAhead) {
    return `${base} Warning: chat still has ${String(result.eventCount)} events while files match seq ${String(result.chatSeq)} — pass truncateChat or use session.truncate / Branch.`;
  }
  return `${base} Chat lineage unchanged — use Branch for a forked session.`;
}
